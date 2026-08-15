// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TimelockLpSeeder — escrow EAV7 pós-LBP (AMM pluga depois; v1 só lock)
/// @dev AMM (configureAmm / trySeedAmm) fica para contrato seguinte — bytecode
///      precisa caber no teto eth_sendRawTransaction da rede.
contract TimelockLpSeeder {
    error Unauthorized();
    error BadState();
    error BadArgs();

    address public admin;
    address public vault;

    uint256 public lockedEav7;
    uint256 public unlockTime;
    bool public seeded;

    event VaultUpdated(address vault);
    event Seeded(uint256 eav7Amount, uint256 unlockTime);
    event Claimed(address indexed to, uint256 eav7);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address admin_, address vault_) {
        if (admin_ == address(0) || vault_ == address(0)) revert BadArgs();
        admin = admin_;
        vault = vault_;
    }

    function setVault(address v) external onlyAdmin {
        if (v == address(0) || seeded) revert BadState();
        vault = v;
        emit VaultUpdated(v);
    }

    function seedAndLock(uint256 eav7Amount, uint256 unlockTime_) external payable {
        if (msg.sender != vault) revert Unauthorized();
        if (seeded) revert BadState();
        if (msg.value != eav7Amount || eav7Amount == 0) revert BadArgs();
        if (unlockTime_ <= block.timestamp) revert BadArgs();
        seeded = true;
        lockedEav7 = eav7Amount;
        unlockTime = unlockTime_;
        emit Seeded(eav7Amount, unlockTime_);
    }

    function claimTo(address to) external onlyAdmin {
        if (!seeded || block.timestamp < unlockTime) revert BadState();
        if (to == address(0)) revert BadArgs();
        uint256 e7 = lockedEav7;
        lockedEav7 = 0;
        if (e7 > 0) {
            (bool ok, ) = payable(to).call{value: e7}("");
            if (!ok) revert BadArgs();
        }
        emit Claimed(to, e7);
    }

    receive() external payable {}
}
