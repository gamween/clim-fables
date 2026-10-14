// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {TestTokenDecimals} from "../../src/test-tokens/TestTokenDecimals.sol";

/// @notice Step 1 of the live stack: tETH (18 decimals) and tUSDG (6), minted to the deployer, and three Uniswap v4
///         test routers (the testnet has none): a retail PoolSwapTest, an arbitrage-only PoolSwapTest (so the
///         dashboard tells arbitrage by Swap.sender) and a PoolModifyLiquidityTest.
///         Public faucet: 10 tETH and 25,000 tUSDG per address per hour.
/// Env: MINT_TETH (whole tokens, default 1,000,000), MINT_TUSDG (whole tokens, default 10,000,000,000).
contract LiveTokens is LiveScript {
    function run() external {
        _guard();
        uint256 pk = _pk();
        address deployer = vm.addr(pk);
        uint256 mintEth = vm.envOr("MINT_TETH", uint256(1_000_000)) * 1e18;
        uint256 mintUsd = vm.envOr("MINT_TUSDG", uint256(10_000_000_000)) * 1e6;
        uint256 deployBlock = vm.getBlockNumber();
        bytes memory argsEth = abi.encode("clim test ETH", "tETH", deployer, uint256(10e18), ETH_DECIMALS);
        bytes memory argsUsd = abi.encode("clim test USDG", "tUSDG", deployer, uint256(25_000e6), USD_DECIMALS);

        vm.startBroadcast(pk);
        TestTokenDecimals teth = new TestTokenDecimals("clim test ETH", "tETH", deployer, 10e18, ETH_DECIMALS);
        TestTokenDecimals tusdg = new TestTokenDecimals("clim test USDG", "tUSDG", deployer, 25_000e6, USD_DECIMALS);
        teth.mint(deployer, mintEth);
        tusdg.mint(deployer, mintUsd);
        PoolSwapTest swapRouter = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        PoolSwapTest arbRouter = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(IPoolManager(POOL_MANAGER));
        vm.stopBroadcast();

        string memory o = "tokens";
        vm.serializeAddress(o, "deployer", deployer);
        vm.serializeAddress(o, "tETH", address(teth));
        vm.serializeAddress(o, "tUSDG", address(tusdg));
        vm.serializeAddress(o, "swapRouter", address(swapRouter));
        vm.serializeAddress(o, "arbRouter", address(arbRouter));
        vm.serializeAddress(o, "lpRouter", address(lpRouter));
        vm.serializeBytes(o, "argsTETH", argsEth);
        vm.serializeBytes(o, "argsTUSDG", argsUsd);
        vm.serializeBytes(o, "argsRouter", abi.encode(POOL_MANAGER));
        string memory json = vm.serializeUint(o, "deployBlock", deployBlock);
        _write("tokens", json);
    }
}
