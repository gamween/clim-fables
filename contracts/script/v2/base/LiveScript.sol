// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Shared plumbing of the plan 03 deploy scripts: clim's live reference stack on Robinhood Chain testnet
///         (or on a local anvil fork of it, run as chain 31337). Each step writes a JSON fragment to
///         deployments/<chainId>/; 14_LiveWriteDeployments checks everything on-chain and merges the fragments into
///         ../shared/deployments/robinhood-testnet.json (chain 46630) or ../shared/deployments/anvil.json (a fork).
///         Env: PRIVATE_KEY (contracts/.env, loaded by forge). Never runs on Robinhood Chain mainnet.
abstract contract LiveScript is Script {
    // Robinhood Chain testnet, checked with cast on 2026-10-13 (plan 03, "Facts").
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant MOCK_FORWARDER = 0x0b93082D9b3C7C97fAcd250082899BAcf3af3885;
    address internal constant KEYSTONE_FORWARDER = 0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19;
    uint256 internal constant RH_TESTNET = 46_630;
    uint256 internal constant RH_MAINNET = 4_663;

    // AccessManager roles, as in Fables' setup and the fork run.
    uint64 internal constant FEE_POKER = 1;
    uint64 internal constant CLIM_RUNNER = 7;

    // Fables' ETH/USDG config, used for the three pools.
    uint24 internal constant HOOK_FLOOR_PIPS = 100;
    uint24 internal constant HOOK_FLAT_PIPS = 700;
    uint24 internal constant HOOK_CAP_PIPS = 6_000;

    // The three PoolKeys share currencies, the dynamic-fee flag and the hook: tick spacing tells them apart.
    int24 internal constant TICK_SPACING_D = 10;
    int24 internal constant TICK_SPACING_K = 11;
    int24 internal constant TICK_SPACING_F = 12;

    uint8 internal constant ETH_DECIMALS = 18;
    uint8 internal constant USD_DECIMALS = 6;

    string internal constant PARAMS_PATH = "../shared/params-fables.json";

    function _pk() internal view returns (uint256) {
        return vm.envUint("PRIVATE_KEY");
    }

    /// @dev Never Robinhood Chain mainnet; the RPC must be the testnet or a fork of it (the PoolManager is there).
    function _guard() internal view {
        require(block.chainid != RH_MAINNET, "LiveScript: never on Robinhood Chain mainnet");
        require(POOL_MANAGER.code.length > 0, "LiveScript: no Uniswap v4 PoolManager on this chain");
    }

    function _dir() internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), "/");
    }

    function _path(string memory name) internal view returns (string memory) {
        return string.concat(_dir(), name, ".json");
    }

    function _write(string memory name, string memory json) internal {
        vm.createDir(_dir(), true);
        vm.writeJson(json, _path(name));
    }

    function _read(string memory name) internal view returns (string memory) {
        return vm.readFile(_path(name));
    }

    function _addr(string memory name, string memory key) internal view returns (address) {
        return vm.parseJsonAddress(_read(name), key);
    }

    /// @notice sqrtPriceX96 of a pool of tETH and tUSDG at `ethUsd` dollars per ETH, for either token order.
    ///         Raw price = token1 base units per token0 base unit.
    function sqrtPriceX96FromEthUsd(uint256 ethUsd, bool token0IsEth, uint8 ethDecimals, uint8 usdDecimals)
        public
        pure
        returns (uint160)
    {
        require(ethUsd > 0 && ethUsd < 1e9, "LiveScript: INIT_ETH_USD out of range");
        uint256 ratioX192 = token0IsEth
            ? Math.mulDiv(ethUsd << 192, uint256(10) ** usdDecimals, uint256(10) ** ethDecimals)
            : Math.mulDiv((uint256(10) ** ethDecimals) << 192, 1, ethUsd * uint256(10) ** usdDecimals);
        return uint160(Math.sqrt(ratioX192));
    }

    function _keyJson(string memory o, PoolKey memory k) internal returns (string memory) {
        vm.serializeAddress(o, "currency0", Currency.unwrap(k.currency0));
        vm.serializeAddress(o, "currency1", Currency.unwrap(k.currency1));
        vm.serializeUint(o, "fee", k.fee);
        vm.serializeInt(o, "tickSpacing", k.tickSpacing);
        return vm.serializeAddress(o, "hooks", address(k.hooks));
    }

    function _poolJson(string memory o, PoolKey memory k, bool token0IsEth, string memory driver)
        internal
        returns (string memory)
    {
        vm.serializeString(o, "key", _keyJson(string.concat(o, ".key"), k));
        vm.serializeBytes32(o, "poolId", PoolId.unwrap(k.toId()));
        vm.serializeBool(o, "token0IsEth", token0IsEth);
        return vm.serializeString(o, "driver", driver);
    }

    function _keyFrom(string memory json, string memory base) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(vm.parseJsonAddress(json, string.concat(base, ".key.currency0"))),
            currency1: Currency.wrap(vm.parseJsonAddress(json, string.concat(base, ".key.currency1"))),
            fee: uint24(vm.parseJsonUint(json, string.concat(base, ".key.fee"))),
            tickSpacing: int24(vm.parseJsonInt(json, string.concat(base, ".key.tickSpacing"))),
            hooks: IHooks(vm.parseJsonAddress(json, string.concat(base, ".key.hooks")))
        });
    }
}
