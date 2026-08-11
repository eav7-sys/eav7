// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PartnerTrancheVault — 10% privado em 4 partes (só o dono)
/// @notice Gerenciador na carteira nativa EAV7:
///   1) Gênese deposita 10% neste contrato
///   2) Owner (msg.sender = carteira desbloqueada) chama `arm(total)`
///   3) Owner cola endereço do parceiro → `releaseTo(addr)` envia 1/4
///   4) Próxima liberação só após cooldown (default 12 meses)
/// @dev Validação = assinatura da chave do owner no device. Sem relayer.
contract PartnerTrancheVault {
    uint8 public constant TRANCHE_COUNT = 4;

    address public owner;
    bool public paused;

    uint128 public trancheSize;
    uint8 public releasedCount;
    uint64 public nextReleaseAt;
    uint64 public cooldownBlocks;

    address[TRANCHE_COUNT] public beneficiaries;
    uint128[TRANCHE_COUNT] public releasedAmounts;
    uint64[TRANCHE_COUNT] public releasedAt;

    event OwnerTransferred(address indexed previous, address indexed next);
    event Paused(bool paused);
    event Armed(uint128 total, uint128 trancheSize, uint64 cooldownBlocks);
    event CooldownUpdated(uint64 cooldownBlocks);
    event TrancheReleased(
        uint8 indexed index,
        address indexed to,
        uint256 amount,
        uint64 nextReleaseAt
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    constructor(address owner_) {
        require(owner_ != address(0), "zero");
        owner = owner_;
        cooldownBlocks = 31_536_000; // 12 meses @ ≈1 blk/s
        emit OwnerTransferred(address(0), owner_);
        emit CooldownUpdated(cooldownBlocks);
    }

    receive() external payable {}

    function transferOwner(address next) external onlyOwner {
        require(next != address(0), "zero");
        emit OwnerTransferred(owner, next);
        owner = next;
    }

    function setPaused(bool v) external onlyOwner {
        paused = v;
        emit Paused(v);
    }

    function setCooldown(uint64 blocks_) external onlyOwner {
        require(trancheSize == 0, "armed");
        require(blocks_ > 0, "cooldown");
        cooldownBlocks = blocks_;
        emit CooldownUpdated(blocks_);
    }

    function arm(uint128 total) external onlyOwner {
        require(trancheSize == 0, "armed");
        require(total > 0 && total % TRANCHE_COUNT == 0, "total");
        require(address(this).balance >= total, "balance");
        trancheSize = total / TRANCHE_COUNT;
        emit Armed(total, trancheSize, cooldownBlocks);
    }

    function remainingTranches() public view returns (uint8) {
        return TRANCHE_COUNT - releasedCount;
    }

    function canReleaseNow() public view returns (bool) {
        return trancheSize > 0
            && releasedCount < TRANCHE_COUNT
            && !paused
            && block.number >= nextReleaseAt;
    }

    /// @notice Só o owner (carteira nativa) libera. Destino ≠ owner / vault (anti self-deal).
    function releaseTo(address to) external onlyOwner whenNotPaused {
        require(trancheSize > 0, "not-armed");
        require(releasedCount < TRANCHE_COUNT, "done");
        require(block.number >= nextReleaseAt, "cooldown");
        require(to != address(0), "zero");
        require(to != owner, "no-owner");
        require(to != address(this), "no-self");
        require(address(this).balance >= trancheSize, "liquidity");

        uint8 index = releasedCount;
        beneficiaries[index] = to;
        releasedAmounts[index] = trancheSize;
        releasedAt[index] = uint64(block.number);
        releasedCount = index + 1;
        nextReleaseAt = uint64(block.number) + cooldownBlocks;

        (bool ok, ) = to.call{value: uint256(trancheSize)}("");
        require(ok, "transfer");

        emit TrancheReleased(index, to, trancheSize, nextReleaseAt);
    }
}