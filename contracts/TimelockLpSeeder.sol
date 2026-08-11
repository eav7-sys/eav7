// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Router mínimo estilo UniswapV2 addLiquidityETH — plugar endereço real no launch.
interface IAmmRouter02 {
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    )
        external
        payable
        returns (uint amountToken, uint amountETH, uint liquidity);
}

/// @title TimelockLpSeeder — escrow EAV7 (+ stables) até lock; opcional seed AMM
/// @notice Fluxo autónomo:
///   1) PublicVault.finalizeToLp{value: eav7} → seedAndLock
///   2) Ops deposita USDT/stable via depositStable (caixa da private)
///   3) Se `ammRouter` + `pairToken` setados → tenta addLiquidity; senão fica escrow até unlock
contract TimelockLpSeeder {
    address public admin;
    address public vault;
    address public ammRouter;
    address public pairToken; // USDT/USDC ERC20 no ambiente EVM/espelho; address(0) = só escrow nativo
    address public lpToken; // preenchido se o router devolver LP para este contrato

    uint256 public lockedEav7;
    uint256 public lockedStable;
    uint256 public unlockTime;
    uint256 public lpBalance;
    bool public seeded;
    bool public ammSeeded;

    event VaultUpdated(address vault);
    event AmmConfigured(address router, address pairToken);
    event Seeded(uint256 eav7Amount, uint256 unlockTime);
    event StableDeposited(uint256 amount, address from);
    event AmmLiquidityAdded(uint256 eav7Used, uint256 stableUsed, uint256 liquidity);
    event Claimed(address indexed to, uint256 eav7, uint256 stable, uint256 lp);

    modifier onlyAdmin() {
        require(msg.sender == admin, "admin");
        _;
    }

    constructor(address admin_, address vault_) {
        require(admin_ != address(0) && vault_ != address(0), "zero");
        admin = admin_;
        vault = vault_;
    }

    function setVault(address v) external onlyAdmin {
        require(v != address(0) && !seeded, "state");
        vault = v;
        emit VaultUpdated(v);
    }

    function configureAmm(address router, address pairToken_, address lpToken_) external onlyAdmin {
        require(!ammSeeded, "amm");
        ammRouter = router;
        pairToken = pairToken_;
        lpToken = lpToken_;
        emit AmmConfigured(router, pairToken_);
    }

    /// @dev Chamado por PublicVault.finalizeToLp{value: amount}
    function seedAndLock(uint256 eav7Amount, uint256 unlockTime_) external payable {
        require(msg.sender == vault, "vault");
        require(!seeded, "seeded");
        require(msg.value == eav7Amount && eav7Amount > 0, "amount");
        require(unlockTime_ > block.timestamp, "unlock");
        seeded = true;
        lockedEav7 = eav7Amount;
        unlockTime = unlockTime_;
        emit Seeded(eav7Amount, unlockTime_);
    }

    /// @notice Caixa da private sale (stable) para o lado USDT do pool.
    /// @dev Em EAVM nativo sem ERC20, ops pode enviar value e marcar amount=msg.value com pairToken=0.
    function depositStable(uint256 amount) external payable onlyAdmin {
        require(seeded && !ammSeeded, "state");
        if (pairToken == address(0)) {
            require(msg.value == amount && amount > 0, "native-stable");
            lockedStable += amount;
        } else {
            require(amount > 0, "amount");
            // transferFrom admin → this (ops aprova antes)
            (bool ok, bytes memory data) = pairToken.call(
                abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
            );
            require(ok && (data.length == 0 || abi.decode(data, (bool))), "xfer");
            lockedStable += amount;
        }
        emit StableDeposited(amount, msg.sender);
    }

    /// @notice Tenta criar liquidez no AMM; se router ausente, no-op seguro (escrow continua).
    function trySeedAmm(uint256 deadline) external onlyAdmin {
        require(seeded && !ammSeeded, "state");
        require(ammRouter != address(0) && pairToken != address(0), "no-amm");
        require(lockedEav7 > 0 && lockedStable > 0, "balances");
        require(deadline >= block.timestamp, "deadline");

        uint256 eav7 = lockedEav7;
        uint256 stable = lockedStable;

        // approve router
        (bool aok, ) = pairToken.call(
            abi.encodeWithSignature("approve(address,uint256)", ammRouter, stable)
        );
        require(aok, "approve");

        // Nota: em EVM clássico EAV7 seria WETH/token; aqui usamos value=eav7 como lado "ETH".
        (bool ok, bytes memory ret) = ammRouter.call{value: eav7}(
            abi.encodeWithSelector(
                IAmmRouter02.addLiquidityETH.selector,
                pairToken,
                stable,
                0,
                0,
                address(this),
                deadline
            )
        );
        require(ok, "addLiquidity");
        (, , uint256 liquidity) = abi.decode(ret, (uint256, uint256, uint256));

        lockedEav7 = 0;
        lockedStable = 0;
        lpBalance = liquidity;
        ammSeeded = true;
        emit AmmLiquidityAdded(eav7, stable, liquidity);
    }

    function claimTo(address to) external onlyAdmin {
        require(seeded && block.timestamp >= unlockTime, "lock");
        uint256 e7 = lockedEav7;
        uint256 st = lockedStable;
        uint256 lp = lpBalance;
        lockedEav7 = 0;
        lockedStable = 0;
        lpBalance = 0;

        if (e7 > 0) {
            (bool ok, ) = payable(to).call{value: e7}("");
            require(ok, "e7");
        }
        if (st > 0 && pairToken == address(0)) {
            (bool ok2, ) = payable(to).call{value: st}("");
            require(ok2, "st");
        } else if (st > 0) {
            (bool ok3, bytes memory d) = pairToken.call(
                abi.encodeWithSignature("transfer(address,uint256)", to, st)
            );
            require(ok3 && (d.length == 0 || abi.decode(d, (bool))), "st-erc20");
        }
        if (lp > 0) {
            require(lpToken != address(0), "lp-token");
            (bool ok4, bytes memory d4) = lpToken.call(
                abi.encodeWithSignature("transfer(address,uint256)", to, lp)
            );
            require(ok4 && (d4.length == 0 || abi.decode(d4, (bool))), "lp");
        }
        emit Claimed(to, e7, st, lp);
    }

    receive() external payable {}
}
