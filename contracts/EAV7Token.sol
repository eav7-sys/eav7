// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title EAV7Token — ERC20 mínimo e completo para a EAVM.
/// @notice Referência de token em contrato: mesma interface que o ecossistema
/// Ethereum já conhece, executando na EAVM. Compilar com --evm-version shanghai:
/// a EAVM implementa PUSH0 mas não os opcodes de Cancun (MCOPY/TLOAD/TSTORE).
contract EAV7Token {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    /// @notice Quem pode emitir novas unidades. address(0) = emissão encerrada para sempre.
    address public minter;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterChanged(address indexed from, address indexed to);

    error NotMinter();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(string memory _name, string memory _symbol, uint8 _decimals, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        minter = msg.sender;
        totalSupply = _initialSupply;
        balanceOf[msg.sender] = _initialSupply;
        emit Transfer(address(0), msg.sender, _initialSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        // Allowance infinita não é decrementada — padrão de mercado, poupa uma escrita.
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - value;
        }
        _move(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external {
        if (msg.sender != minter) revert NotMinter();
        totalSupply += value;
        unchecked { balanceOf[to] += value; }
        emit Transfer(address(0), to, value);
    }

    /// @notice Encerra a emissão de forma irreversível. É o que um holder verifica
    /// para saber que o supply não pode mais ser diluído.
    function renounceMinter() external {
        if (msg.sender != minter) revert NotMinter();
        emit MinterChanged(minter, address(0));
        minter = address(0);
    }

    function _move(address from, address to, uint256 value) private {
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
