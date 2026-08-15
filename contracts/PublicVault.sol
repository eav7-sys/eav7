// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PublicVault — LBP líquido (≤ MAX_EAVM_CALLDATA 3072 bytes)
interface ILpSeeder {
    function seedAndLock(uint256 eav7Amount, uint256 unlockTime) external payable;
}

contract PublicVault {
    error X();

    address public immutable admin;
    address public immutable relayer;
    address public lpSeeder;

    bool public lbpOpen;
    bool public finalized;

    uint64 public lbpDeadline;
    uint128 public lbpAllocated;
    uint128 public lbpSold;
    uint128 public lpSeedAllocated;
    uint128 public bufferAllocated;

    mapping(address => uint128) public grantTotal;
    mapping(address => uint128) public grantReleased;
    mapping(bytes32 => bool) public paymentUsed;

    constructor(address admin_, address relayer_) {
        if (admin_ == address(0) || relayer_ == address(0)) revert X();
        admin = admin_;
        relayer = relayer_;
    }

    receive() external payable {}

    function setLpSeeder(address next) external {
        if (msg.sender != admin || next == address(0) || finalized) revert X();
        lpSeeder = next;
    }

    function setBuckets(uint128 lbp_, uint128 lpSeed_, uint128 buffer_) external {
        if (msg.sender != admin || lbpOpen || finalized) revert X();
        lbpAllocated = lbp_;
        lpSeedAllocated = lpSeed_;
        bufferAllocated = buffer_;
    }

    function openLbp(uint64 deadlineBlock) external {
        if (msg.sender != admin || lbpOpen || finalized || lbpAllocated == 0) revert X();
        if (deadlineBlock != 0 && deadlineBlock <= block.number) revert X();
        lbpOpen = true;
        lbpDeadline = deadlineBlock;
    }

    function grant(address account, uint256 amount, bytes32 paymentId, bytes32) external {
        if (msg.sender != relayer || !lbpOpen || finalized) revert X();
        if (lbpDeadline != 0 && block.number > lbpDeadline) revert X();
        if (account == address(0) || amount == 0 || paymentUsed[paymentId]) revert X();
        if (lbpSold + uint128(amount) > lbpAllocated) revert X();
        paymentUsed[paymentId] = true;
        lbpSold += uint128(amount);
        grantTotal[account] += uint128(amount);
    }

    function release() external {
        uint256 amt = uint256(grantTotal[msg.sender]) - uint256(grantReleased[msg.sender]);
        if (amt == 0) revert X();
        grantReleased[msg.sender] = grantTotal[msg.sender];
        (bool ok, ) = payable(msg.sender).call{value: amt}("");
        if (!ok) revert X();
    }

    function finalizeToLp() external {
        if (!lbpOpen || finalized) revert X();
        if (!((lbpDeadline > 0 && block.number > lbpDeadline) || lbpSold >= lbpAllocated)) revert X();
        if (lpSeeder == address(0)) revert X();
        finalized = true;
        lbpOpen = false;
        uint256 toLp = uint256(lpSeedAllocated) + (uint256(lbpAllocated) - uint256(lbpSold));
        ILpSeeder(lpSeeder).seedAndLock{value: toLp}(toLp, block.timestamp + 18 * 30 days);
    }
}
