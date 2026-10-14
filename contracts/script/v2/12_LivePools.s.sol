// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";

/// @notice Step 3: pools D, K and F of tETH/tUSDG on PokeFeeHook, all with the dynamic-fee flag, Fables' ETH/USDG
///         config (floor 100, flat 700, cap 6,000 pips) and the same full-range liquidity L, sized so that D holds
///         LIQ_TETH tETH at the initial price. Tick spacings 10 (D), 11 (K), 12 (F) are the only difference between
///         the PoolKeys; with full-range positions they do not change the prices.
/// Env: INIT_ETH_USD (whole dollars, the current venue price), LIQ_TETH (whole tokens per pool, default 1,000).
contract LivePools is LiveScript {
    using StateLibrary for IPoolManager;

    function run() external {
        _guard();
        uint256 pk = _pk();
        string memory tokens = _read("tokens");
        address teth = vm.parseJsonAddress(tokens, ".tETH");
        address tusdg = vm.parseJsonAddress(tokens, ".tUSDG");
        address lpRouter = vm.parseJsonAddress(tokens, ".lpRouter");
        address hook = _addr("hook", ".hook");
        bool token0IsEth = teth < tusdg;
        uint256 ethUsd = vm.envUint("INIT_ETH_USD");
        uint160 sqrtP = sqrtPriceX96FromEthUsd(ethUsd, token0IsEth, ETH_DECIMALS, USD_DECIMALS);
        PoolKey[3] memory keys;
        keys[0] = _newKey(teth, tusdg, TICK_SPACING_D, hook);
        keys[1] = _newKey(teth, tusdg, TICK_SPACING_K, hook);
        keys[2] = _newKey(teth, tusdg, TICK_SPACING_F, hook);
        uint128 liquidity = _liquidityFor(sqrtP, token0IsEth, vm.envOr("LIQ_TETH", uint256(1_000)) * 1e18);

        vm.startBroadcast(pk);
        IERC20(teth).approve(lpRouter, type(uint256).max);
        IERC20(tusdg).approve(lpRouter, type(uint256).max);
        for (uint256 i; i < 3; i++) {
            IPoolManager(POOL_MANAGER).initialize(keys[i], sqrtP);
            PokeFeeHook(hook).setPoolConfig(keys[i], HOOK_FLOOR_PIPS, HOOK_FLAT_PIPS, HOOK_CAP_PIPS);
            PoolModifyLiquidityTest(lpRouter).modifyLiquidity(keys[i], _fullRange(keys[i], liquidity), "");
        }
        vm.stopBroadcast();

        for (uint256 i; i < 3; i++) {
            require(IPoolManager(POOL_MANAGER).getLiquidity(keys[i].toId()) == liquidity, "LivePools: liquidity");
        }

        string memory o = "pools";
        vm.serializeString(o, "D", _poolJson("pools.D", keys[0], token0IsEth, "ClimPoker (directional)"));
        vm.serializeString(
            o,
            "K",
            _poolJson(
                "pools.K",
                keys[1],
                token0IsEth,
                "keeper-style bot (imitation of the pattern observed on Fables' pool, not Fables' code)"
            )
        );
        vm.serializeString(o, "F", _poolJson("pools.F", keys[2], token0IsEth, "none (flat 7 bp)"));
        vm.serializeBool(o, "token0IsEth", token0IsEth);
        vm.serializeUint(o, "initEthUsd", ethUsd);
        vm.serializeUint(o, "sqrtPriceX96", sqrtP);
        string memory json = vm.serializeString(o, "liquidity", vm.toString(uint256(liquidity)));
        _write("pools", json);
    }

    function _newKey(address teth, address tusdg, int24 spacing, address hook) internal pure returns (PoolKey memory) {
        (address c0, address c1) = teth < tusdg ? (teth, tusdg) : (tusdg, teth);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), LPFeeLibrary.DYNAMIC_FEE_FLAG, spacing, IHooks(hook));
    }

    function _fullRange(PoolKey memory k, uint128 liquidity) internal pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({
            tickLower: TickMath.minUsableTick(k.tickSpacing),
            tickUpper: TickMath.maxUsableTick(k.tickSpacing),
            liquidityDelta: int256(uint256(liquidity)),
            salt: 0
        });
    }

    /// @dev L from D's full range: the tETH side is [price, max] when tETH is token0, [min, price] otherwise.
    function _liquidityFor(uint160 sqrtP, bool token0IsEth, uint256 ethAmount) internal pure returns (uint128) {
        int24 lower = TickMath.minUsableTick(TICK_SPACING_D);
        int24 upper = TickMath.maxUsableTick(TICK_SPACING_D);
        return token0IsEth
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtP, TickMath.getSqrtPriceAtTick(upper), ethAmount)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(lower), sqrtP, ethAmount);
    }
}
