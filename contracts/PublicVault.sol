// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PublicVault — distribuição pública automatizada (líquida no TGE)
/// @notice Espelho do SaleVault para o bucket público (45%):
///   - Pagamentos off-chain (mesmas rails) → relayer.grant líquido (sem cliff)
///   - LBP/janela com deadline; ao terminar, finalizeToLp() sem ação por comprador
///   - Admin só: openLbp, setLpRouter, pause, emerência — nunca grant manual
/// @dev LP router real (Uniswap etc.) pluga em ILpSeeder; até lá finalize emite evento + escrow.
interface ILpSeeder {
    /// @notice Recebe EAV7 (msg.value ou transfer prévia) + sinal para seedar par e lockar LP
    function seedAndLock(uint256 eav7Amount, uint256 unlockTime) external payable;
}

contract PublicVault {
    address public admin;
    address public relayer;
    address public sweepTo;
    address public lpSeeder;

    bool public paused;
    bool public lbpOpen;
    bool public finalized;

    uint64 public lbpDeadline; // altura de bloco (como SaleVault.claimDeadline)
    uint128 public lbpAllocated; // e7 reservados à janela pública
    uint128 public lbpSold;
    uint128 public lpSeedAllocated;
    uint128 public bufferAllocated;
    uint128 public incentivesAllocated;

    /// @dev grant líquido: cliff=0 duration=0 ⇒ tudo liberável na hora (ou balance credit)
    struct Grant {
        uint128 total;
        uint128 released;
    }

    mapping(address => Grant) public grants;
    mapping(bytes32 => bool) public paymentUsed;

    event AdminTransferred(address indexed previous, address indexed next);
    event RelayerUpdated(address indexed relayer);
    event LpSeederUpdated(address indexed seeder);
    event LbpOpened(uint64 deadline, uint128 lbpAllocated);
    event LbpFinalized(uint256 toLp, address seeder);
    event Paused(bool paused);
    event Granted(address indexed account, uint256 amount, bytes32 indexed paymentId, string rail);
    event Released(address indexed account, uint256 amount);
    event BucketsSet(uint128 lbp, uint128 lpSeed, uint128 buffer, uint128 incentives);

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
        emit AdminTransferred(address(0), admin_);
        emit RelayerUpdated(relayer_);
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

    function setLpSeeder(address next) external onlyAdmin {
        require(next != address(0), "zero");
        require(!finalized, "finalized");
        lpSeeder = next;
        emit LpSeederUpdated(next);
    }

    function setPaused(bool v) external onlyAdmin {
        paused = v;
        emit Paused(v);
    }

    /// @notice Partição 30/50/15/5 do bucket público (em e7). Chamado 1× no setup.
    function setBuckets(
        uint128 lbp_,
        uint128 lpSeed_,
        uint128 buffer_,
        uint128 incentives_
    ) external onlyAdmin {
        require(!lbpOpen && !finalized, "live");
        lbpAllocated = lbp_;
        lpSeedAllocated = lpSeed_;
        bufferAllocated = buffer_;
        incentivesAllocated = incentives_;
        emit BucketsSet(lbp_, lpSeed_, buffer_, incentives_);
    }

    /// @notice Única ação humana “de produto” no TGE: abrir a janela pública.
    /// @param deadlineBlock altura máxima (inclusive) para grants; 0 = sem teto de bloco.
    function openLbp(uint64 deadlineBlock) external onlyAdmin whenNotPaused {
        require(!lbpOpen && !finalized, "state");
        require(lbpAllocated > 0, "buckets");
        require(deadlineBlock == 0 || deadlineBlock > block.number, "deadline");
        lbpOpen = true;
        lbpDeadline = deadlineBlock;
        emit LbpOpened(deadlineBlock, lbpAllocated);
    }

    /// @notice Relayer após pagamento confirmado — entrega líquida (sem vesting).
    function grant(
        address account,
        uint256 amount,
        bytes32 paymentId,
        string calldata rail
    ) external onlyRelayer whenNotPaused {
        require(lbpOpen && !finalized, "lbp");
        require(lbpDeadline == 0 || block.number <= lbpDeadline, "deadline");
        require(account != address(0) && amount > 0, "args");
        require(!paymentUsed[paymentId], "payment");
        require(lbpSold + uint128(amount) <= lbpAllocated, "sold-out");
        paymentUsed[paymentId] = true;
        lbpSold += uint128(amount);
        grants[account].total += uint128(amount);
        emit Granted(account, amount, paymentId, rail);
    }

    /// @notice Comprador (ou anyone) saca saldo líquido creditado.
    function release() external whenNotPaused {
        Grant storage g = grants[msg.sender];
        uint256 amt = uint256(g.total) - uint256(g.released);
        require(amt > 0, "zero");
        g.released = g.total;
        (bool ok, ) = payable(msg.sender).call{value: amt}("");
        require(ok, "xfer");
        emit Released(msg.sender, amt);
    }

    /// @notice Autónomo por sold-out ou após deadline de bloco; qualquer um pode chamar.
    function finalizeToLp() external whenNotPaused {
        require(lbpOpen && !finalized, "state");
        require(
            (lbpDeadline > 0 && block.number > lbpDeadline) || lbpSold >= lbpAllocated,
            "early"
        );
        require(lpSeeder != address(0), "seeder");
        finalized = true;
        lbpOpen = false;

        uint256 unsold = uint256(lbpAllocated) - uint256(lbpSold);
        uint256 toLp = uint256(lpSeedAllocated) + unsold;
        uint256 unlockTime = block.timestamp + 18 * 30 days;

        // Native e7 balance assumed funded at genesis into this contract.
        ILpSeeder(lpSeeder).seedAndLock{value: toLp}(toLp, unlockTime);
        emit LbpFinalized(toLp, lpSeeder);
    }

    function sweepBuffer(address to, uint256 amount) external onlyAdmin {
        require(finalized, "not-final");
        require(to != address(0) && amount > 0 && amount <= bufferAllocated, "args");
        bufferAllocated -= uint128(amount);
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "xfer");
    }

    function remainingLbp() external view returns (uint256) {
        return uint256(lbpAllocated) - uint256(lbpSold);
    }
}
