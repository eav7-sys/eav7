// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title EcosystemVault — bucket “parceiro estratégico” como programa aberto
/// @notice 10% do gênese: infra / apps / liquidity / buffer.
///   - Council `award` dentro do orçamento da categoria (milestones em evento)
///   - Rounds Merkle opcionais (RFP) → claim sem council por grant
///   - Buffer só após `bufferUnlockBlock`
///   - Vesting padrão whitepaper: cliff 12m + linear 36m
/// @dev Admin bootstrap (fundação multisig); meta = transferir council para set eleito.
contract EcosystemVault {
    uint8 public constant CAT_INFRA = 0;
    uint8 public constant CAT_APPS = 1;
    uint8 public constant CAT_LIQUIDITY = 2;
    uint8 public constant CAT_BUFFER = 3;
    uint8 public constant CAT_COUNT = 4;

    address public admin;
    address public council;
    bool public paused;
    bool public bucketsLocked;

    uint64 public defaultCliff;
    uint64 public defaultDuration;
    uint64 public bufferUnlockBlock;

    uint128[CAT_COUNT] public allocated;
    uint128[CAT_COUNT] public spent;

    struct Grant {
        uint128 total;
        uint128 released;
        uint64 start;
        uint64 cliff;
        uint64 duration;
        uint8 category;
    }

    struct Round {
        bytes32 root;
        uint64 deadline;
        uint8 category;
        bool active;
    }

    mapping(address => Grant) public grants;
    mapping(bytes32 => bool) public leafUsed;
    mapping(uint256 => Round) public rounds;
    uint256 public nextRoundId;

    event AdminTransferred(address indexed previous, address indexed next);
    event CouncilTransferred(address indexed previous, address indexed next);
    event Paused(bool paused);
    event BucketsSet(uint128 infra, uint128 apps, uint128 liquidity, uint128 buffer);
    event BucketsLocked();
    event DefaultsUpdated(uint64 cliff, uint64 duration);
    event BufferUnlockSet(uint64 unlockBlock);
    event Awarded(
        address indexed account,
        uint8 indexed category,
        uint256 amount,
        bytes32 indexed milestoneId,
        string reason
    );
    event RoundOpened(uint256 indexed roundId, uint8 category, bytes32 root, uint64 deadline);
    event Claimed(address indexed account, uint256 indexed roundId, uint256 amount, bytes32 leaf);
    event Released(address indexed account, uint256 amount);
    event BufferDrawn(address indexed to, uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "admin");
        _;
    }

    modifier onlyCouncil() {
        require(msg.sender == council, "council");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    constructor(address admin_, address council_) {
        require(admin_ != address(0) && council_ != address(0), "zero");
        admin = admin_;
        council = council_;
        // Whitepaper partner: cliff 12m + linear 36m ⇒ duration from start = 48m @ 1 blk/s
        defaultCliff = 31_536_000;
        defaultDuration = 126_144_000;
        emit AdminTransferred(address(0), admin_);
        emit CouncilTransferred(address(0), council_);
        emit DefaultsUpdated(defaultCliff, defaultDuration);
    }

    receive() external payable {}

    function transferAdmin(address next) external onlyAdmin {
        require(next != address(0), "zero");
        emit AdminTransferred(admin, next);
        admin = next;
    }

    function transferCouncil(address next) external onlyAdmin {
        require(next != address(0), "zero");
        emit CouncilTransferred(council, next);
        council = next;
    }

    function setPaused(bool v) external onlyAdmin {
        paused = v;
        emit Paused(v);
    }

    function setDefaults(uint64 cliffBlocks, uint64 durationBlocks) external onlyAdmin {
        require(!bucketsLocked, "locked");
        require(durationBlocks > cliffBlocks, "defaults");
        defaultCliff = cliffBlocks;
        defaultDuration = durationBlocks;
        emit DefaultsUpdated(cliffBlocks, durationBlocks);
    }

    /// @notice Orçamentos fixos do programa (e7). Somam o saldo esperado do bucket.
    function setBuckets(uint128 infra, uint128 apps, uint128 liquidity, uint128 buffer)
        external
        onlyAdmin
    {
        require(!bucketsLocked, "locked");
        require(infra + apps + liquidity + buffer > 0, "empty");
        allocated[CAT_INFRA] = infra;
        allocated[CAT_APPS] = apps;
        allocated[CAT_LIQUIDITY] = liquidity;
        allocated[CAT_BUFFER] = buffer;
        emit BucketsSet(infra, apps, liquidity, buffer);
    }

    function lockBuckets() external onlyAdmin {
        require(!bucketsLocked, "locked");
        require(allocated[CAT_INFRA] + allocated[CAT_APPS] + allocated[CAT_LIQUIDITY] + allocated[CAT_BUFFER] > 0, "empty");
        bucketsLocked = true;
        emit BucketsLocked();
    }

    function setBufferUnlock(uint64 unlockBlock) external onlyAdmin {
        require(bufferUnlockBlock == 0, "set");
        require(unlockBlock > block.number, "past");
        bufferUnlockBlock = unlockBlock;
        emit BufferUnlockSet(unlockBlock);
    }

    function remaining(uint8 category) public view returns (uint256) {
        require(category < CAT_COUNT, "cat");
        uint256 a = allocated[category];
        uint256 s = spent[category];
        return a > s ? a - s : 0;
    }

    /// @notice Grant discricionário do council dentro do orçamento (não Buffer).
    function award(
        uint8 category,
        address beneficiary,
        uint256 amount,
        bytes32 milestoneId,
        string calldata reason
    ) external onlyCouncil whenNotPaused {
        require(bucketsLocked, "buckets");
        require(category < CAT_BUFFER, "cat"); // buffer via drawBuffer
        require(beneficiary != address(0), "beneficiary");
        require(amount > 0 && amount <= type(uint128).max, "amount");
        require(milestoneId != bytes32(0), "milestone");
        require(grants[beneficiary].total == 0, "exists");
        require(amount <= remaining(category), "budget");

        spent[category] = uint128(uint256(spent[category]) + amount);
        _writeGrant(beneficiary, amount, category, defaultCliff, defaultDuration);
        emit Awarded(beneficiary, category, amount, milestoneId, reason);
    }

    /// @notice Abre round Merkle (RFP) numa categoria grantável.
    function openRound(uint8 category, bytes32 root, uint64 deadlineBlock)
        external
        onlyCouncil
        whenNotPaused
        returns (uint256 roundId)
    {
        require(bucketsLocked, "buckets");
        require(category < CAT_BUFFER, "cat");
        require(root != bytes32(0), "root");
        roundId = nextRoundId++;
        rounds[roundId] = Round({root: root, deadline: deadlineBlock, category: category, active: true});
        emit RoundOpened(roundId, category, root, deadlineBlock);
    }

    /// @dev leaf = keccak256(abi.encodePacked(roundId, index, account, amount))
    function claimRound(
        uint256 roundId,
        uint256 index,
        uint256 amount,
        bytes32[] calldata proof
    ) external whenNotPaused {
        Round memory r = rounds[roundId];
        require(r.active && r.root != bytes32(0), "round");
        require(r.deadline == 0 || block.number <= r.deadline, "deadline");
        require(amount > 0 && amount <= type(uint128).max, "amount");
        require(grants[msg.sender].total == 0, "exists");
        require(amount <= remaining(r.category), "budget");

        bytes32 leaf = keccak256(abi.encodePacked(roundId, index, msg.sender, amount));
        require(!leafUsed[leaf], "leaf");
        require(_verify(proof, r.root, leaf), "proof");

        leafUsed[leaf] = true;
        spent[r.category] = uint128(uint256(spent[r.category]) + amount);
        _writeGrant(msg.sender, amount, r.category, defaultCliff, defaultDuration);
        emit Claimed(msg.sender, roundId, amount, leaf);
    }

    function drawBuffer(address to, uint256 amount) external onlyCouncil whenNotPaused {
        require(bucketsLocked, "buckets");
        require(bufferUnlockBlock != 0 && block.number >= bufferUnlockBlock, "locked");
        require(to != address(0), "to");
        require(amount > 0 && amount <= type(uint128).max, "amount");
        require(amount <= remaining(CAT_BUFFER), "budget");
        require(address(this).balance >= amount, "liquidity");

        spent[CAT_BUFFER] = uint128(uint256(spent[CAT_BUFFER]) + amount);
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "transfer");
        emit BufferDrawn(to, amount);
    }

    function vested(address account, uint256 height) public view returns (uint256) {
        Grant memory g = grants[account];
        if (g.total == 0) return 0;
        uint256 start = uint256(g.start);
        uint256 cliffEnd = start + uint256(g.cliff);
        uint256 end = start + uint256(g.duration);
        if (height < cliffEnd) return 0;
        if (height >= end) return g.total;
        uint256 elapsed = height - cliffEnd;
        uint256 span = end - cliffEnd;
        return (uint256(g.total) * elapsed) / span;
    }

    function releasable(address account) public view returns (uint256) {
        uint256 v = vested(account, block.number);
        Grant memory g = grants[account];
        if (v <= g.released) return 0;
        return v - uint256(g.released);
    }

    function release() external whenNotPaused {
        uint256 amount = releasable(msg.sender);
        require(amount > 0, "nothing");
        Grant storage g = grants[msg.sender];
        g.released = uint128(uint256(g.released) + amount);
        require(address(this).balance >= amount, "liquidity");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer");
        emit Released(msg.sender, amount);
    }

    function _writeGrant(
        address account,
        uint256 amount,
        uint8 category,
        uint64 cliffBlocks,
        uint64 durationBlocks
    ) private {
        grants[account] = Grant({
            total: uint128(amount),
            released: 0,
            start: uint64(block.number),
            cliff: cliffBlocks,
            duration: durationBlocks,
            category: category
        });
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) private pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; ) {
            bytes32 p = proof[i];
            if (computed <= p) {
                computed = keccak256(abi.encodePacked(computed, p));
            } else {
                computed = keccak256(abi.encodePacked(p, computed));
            }
            unchecked {
                ++i;
            }
        }
        return computed == root;
    }
}
