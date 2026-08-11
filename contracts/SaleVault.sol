// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SaleVault — private sale with automated delivery
/// @notice Two paths:
///   1) Merkle `claim` (pre-frozen list)
///   2) Relayer `grant` after off-chain payment confirmation
/// @dev Amounts in e7. Times in blocks (~1 s/block).
contract SaleVault {
    address public admin;
    address public relayer;
    bytes32 public merkleRoot;
    bool public open;
    bool public autoOpen;
    bool public paused;
    uint64 public claimDeadline;
    address public sweepTo;
    uint64 public defaultCliff;
    uint64 public defaultDuration;
    /// @dev Cap for relayer `grant` path (e7). Required when opening with autoOpen.
    uint128 public saleAllocated;
    uint128 public saleSold;

    struct Grant {
        uint128 total;
        uint128 released;
        uint64 start;
        uint64 cliff;
        uint64 duration;
    }

    mapping(address => Grant) public grants;
    mapping(bytes32 => bool) public leafUsed;
    /// @dev paymentId = keccak256(chainId ‖ txHash ‖ logIndex) — anti double-credit
    mapping(bytes32 => bool) public paymentUsed;

    event AdminTransferred(address indexed previous, address indexed next);
    event RelayerUpdated(address indexed relayer);
    event MerkleRootSet(bytes32 root);
    event SaleAllocated(uint128 amount);
    event SaleOpened(uint64 claimDeadline, bool autoEnabled);
    event SalePaused(bool paused);
    event DefaultsUpdated(uint64 cliff, uint64 duration);
    event Claimed(address indexed account, uint256 amount, uint64 cliff, uint64 duration, bytes32 leaf);
    event Granted(
        address indexed account,
        uint256 amount,
        uint64 cliff,
        uint64 duration,
        bytes32 indexed paymentId,
        string rail
    );
    event Released(address indexed account, uint256 amount);
    event Swept(address indexed to, uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "admin");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "relayer");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    constructor(address admin_, address sweepTo_, address relayer_) {
        require(admin_ != address(0) && sweepTo_ != address(0) && relayer_ != address(0), "zero");
        admin = admin_;
        sweepTo = sweepTo_;
        relayer = relayer_;
        // Whitepaper private: cliff 12m + linear 24m ⇒ duration from start = 36m @ 1 blk/s
        defaultCliff = 31_536_000;
        defaultDuration = 94_608_000;
        emit AdminTransferred(address(0), admin_);
        emit RelayerUpdated(relayer_);
        emit DefaultsUpdated(defaultCliff, defaultDuration);
    }

    receive() external payable {}

    function transferAdmin(address next) external onlyAdmin {
        require(next != address(0), "zero");
        emit AdminTransferred(admin, next);
        admin = next;
    }

    function setRelayer(address next) external onlyAdmin {
        require(next != address(0), "zero");
        relayer = next;
        emit RelayerUpdated(next);
    }

    function setSweepTo(address next) external onlyAdmin {
        require(next != address(0), "zero");
        sweepTo = next;
    }

    function setPaused(bool v) external onlyAdmin {
        paused = v;
        emit SalePaused(v);
    }

    /// @notice Vesting defaults freeze once the sale is open.
    function setDefaults(uint64 cliffBlocks, uint64 durationBlocks) external onlyAdmin {
        require(!open, "open");
        require(durationBlocks > cliffBlocks, "defaults");
        defaultCliff = cliffBlocks;
        defaultDuration = durationBlocks;
        emit DefaultsUpdated(cliffBlocks, durationBlocks);
    }

    function setSaleAllocated(uint128 amount) external onlyAdmin {
        require(!open, "open");
        require(amount > 0, "zero");
        saleAllocated = amount;
        emit SaleAllocated(amount);
    }

    function setMerkleRoot(bytes32 root) external onlyAdmin {
        require(root != bytes32(0), "root");
        merkleRoot = root;
        emit MerkleRootSet(root);
    }

    /// @notice Opens sale. `enableAuto` allows relayer `grant` (requires saleAllocated).
    function openSale(uint64 deadlineBlock, bool enableAuto) external onlyAdmin {
        require(!open, "open");
        require(enableAuto || merkleRoot != bytes32(0), "mode");
        if (enableAuto) {
            require(saleAllocated > 0, "cap");
        }
        open = true;
        autoOpen = enableAuto;
        claimDeadline = deadlineBlock;
        emit SaleOpened(deadlineBlock, enableAuto);
    }

    /// @dev leaf = keccak256(abi.encodePacked(index, account, amount, cliff, duration))
    function claim(
        uint256 index,
        uint256 amount,
        uint64 cliffBlocks,
        uint64 durationBlocks,
        bytes32[] calldata proof
    ) external whenNotPaused {
        require(open && merkleRoot != bytes32(0), "merkle");
        require(claimDeadline == 0 || block.number <= claimDeadline, "deadline");
        require(amount > 0 && amount <= type(uint128).max, "amount");
        require(durationBlocks > cliffBlocks, "vest");
        require(grants[msg.sender].total == 0, "exists");

        bytes32 leaf = keccak256(abi.encodePacked(index, msg.sender, amount, cliffBlocks, durationBlocks));
        require(!leafUsed[leaf], "leaf");
        require(_verify(proof, merkleRoot, leaf), "proof");

        leafUsed[leaf] = true;
        _writeGrant(msg.sender, amount, cliffBlocks, durationBlocks);
        emit Claimed(msg.sender, amount, cliffBlocks, durationBlocks, leaf);
    }

    /// @notice Automated delivery after payment confirmation by the relayer.
    function grant(
        address beneficiary,
        uint256 amount,
        bytes32 paymentId,
        string calldata rail
    ) external onlyRelayer whenNotPaused {
        require(open && autoOpen, "auto");
        require(claimDeadline == 0 || block.number <= claimDeadline, "deadline");
        require(beneficiary != address(0), "beneficiary");
        require(amount > 0 && amount <= type(uint128).max, "amount");
        require(paymentId != bytes32(0), "payment");
        require(!paymentUsed[paymentId], "replay");
        require(grants[beneficiary].total == 0, "exists");
        require(uint256(saleSold) + amount <= uint256(saleAllocated), "cap");

        paymentUsed[paymentId] = true;
        saleSold = uint128(uint256(saleSold) + amount);
        _writeGrant(beneficiary, amount, defaultCliff, defaultDuration);
        emit Granted(beneficiary, amount, defaultCliff, defaultDuration, paymentId, rail);
    }

    /// @notice Cliff then linear over (duration - cliff). 0 until cliff ends.
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

    function sweepExcess(uint256 maxAmount) external onlyAdmin {
        require(open && claimDeadline != 0 && block.number > claimDeadline, "early");
        require(maxAmount > 0, "zero");
        uint256 bal = address(this).balance;
        uint256 send = maxAmount < bal ? maxAmount : bal;
        require(send > 0, "empty");
        (bool ok, ) = sweepTo.call{value: send}("");
        require(ok, "transfer");
        emit Swept(sweepTo, send);
    }

    function _writeGrant(address account, uint256 amount, uint64 cliffBlocks, uint64 durationBlocks) private {
        grants[account] = Grant({
            total: uint128(amount),
            released: 0,
            start: uint64(block.number),
            cliff: cliffBlocks,
            duration: durationBlocks
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
