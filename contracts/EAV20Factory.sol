// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./EAV20.sol";
import "./EAV20Managed.sol";

/// @title EAV20Factory — deploy oficial mínimo / managed (plano 19)
contract EAV20Factory {
    enum Kind {
        Minimal,
        Managed
    }

    event TokenCreated(
        address indexed token,
        address indexed owner,
        string symbol,
        Kind kind
    );

    function createMinimal(
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        address recipient
    ) external returns (address token) {
        token = address(new EAV20(name_, symbol_, decimals_, initialSupply, recipient));
        emit TokenCreated(token, msg.sender, symbol_, Kind.Minimal);
    }

    function createManaged(
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        address recipient,
        address owner_
    ) external returns (address token) {
        address own = owner_ == address(0) ? msg.sender : owner_;
        token = address(new EAV20Managed(name_, symbol_, decimals_, initialSupply, recipient, own));
        emit TokenCreated(token, own, symbol_, Kind.Managed);
    }
}
