// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";
import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";

/// @notice Read-only. Checks the live stack on-chain (wiring, roles, pools configured and funded), then merges the
///         fragments of deployments/<chainId>/ into ../shared/deployments/robinhood-testnet.json (chain 46630) or
///         ../shared/deployments/anvil.json (a local fork). Schema: shared/src/live.ts (parseLiveDeployments).
contract LiveWriteDeployments is LiveScript {
    string internal constant TOKEN_ID = "src/test-tokens/TestTokenDecimals.sol:TestTokenDecimals";
    string internal constant SWAP_ID = "lib/uniswap-hooks/lib/v4-core/src/test/PoolSwapTest.sol:PoolSwapTest";
    string internal constant LP_ID =
        "lib/uniswap-hooks/lib/v4-core/src/test/PoolModifyLiquidityTest.sol:PoolModifyLiquidityTest";
    string internal constant AM_ID =
        "lib/uniswap-hooks/lib/openzeppelin-contracts/contracts/access/manager/AccessManager.sol:AccessManager";

    function run() external {
        _guard();
        _check();
        string memory root = "live";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deployBlock", vm.parseJsonUint(_read("tokens"), ".deployBlock"));
        vm.serializeAddress(root, "deployer", _addr("tokens", ".deployer"));
        vm.serializeString(root, "uniswap", _uniswap());
        vm.serializeString(root, "routers", _routers());
        vm.serializeString(root, "cre", _cre());
        vm.serializeAddress(root, "accessManager", _addr("hook", ".accessManager"));
        vm.serializeString(root, "roles", _roles());
        vm.serializeString(root, "tokens", _tokens());
        vm.serializeAddress(root, "hook", _addr("hook", ".hook"));
        vm.serializeString(root, "hookConfig", _hookConfig());
        vm.serializeAddress(root, "riskDesk", _addr("desk", ".riskDesk"));
        vm.serializeAddress(root, "policy", _addr("desk", ".policy"));
        vm.serializeAddress(root, "poker", _addr("desk", ".poker"));
        vm.serializeString(root, "pools", _pools());
        vm.serializeString(root, "liquidity", vm.parseJsonString(_read("pools"), ".liquidity"));
        vm.serializeUint(root, "initEthUsd", vm.parseJsonUint(_read("pools"), ".initEthUsd"));
        string memory json = vm.serializeString(root, "verify", _verify());
        string memory out = block.chainid == RH_TESTNET
            ? "../shared/deployments/robinhood-testnet.json"
            : "../shared/deployments/anvil.json";
        vm.writeJson(json, out);
    }

    function _check() internal view {
        address hook = _addr("hook", ".hook");
        AccessManager am = AccessManager(_addr("hook", ".accessManager"));
        RiskDeskV2 desk = RiskDeskV2(_addr("desk", ".riskDesk"));
        ClimFeePolicy policy = ClimFeePolicy(_addr("desk", ".policy"));
        ClimPoker poker = ClimPoker(_addr("desk", ".poker"));
        require(PokeFeeHook(hook).authority() == address(am), "hook: wrong authority");
        require(
            am.getTargetFunctionRole(hook, bytes4(keccak256("pokeFee(bytes32,uint24,uint24,uint40)"))) == FEE_POKER,
            "hook: pokeFee is not behind FEE_POKER"
        );
        require(address(policy.desk()) == address(desk), "policy: wrong desk");
        require(desk.simMode() && desk.getForwarderAddress() == MOCK_FORWARDER, "desk: not in simulation mode");
        require(address(poker.policy()) == address(policy) && poker.hook() == hook, "poker: wrong wiring");
        require(poker.poolId() == vm.parseJsonBytes32(_read("pools"), ".D.poolId") && poker.directional(), "poker: D");
        require(poker.authority() == address(am), "poker: wrong authority");
        (bool pokerIsPoker,) = am.hasRole(FEE_POKER, address(poker));
        (bool runnerOk,) = am.hasRole(CLIM_RUNNER, _addr("desk", ".runner"));
        (bool keeperOk,) = am.hasRole(FEE_POKER, _addr("hook", ".keeper"));
        require(pokerIsPoker && runnerOk && keeperOk, "roles: a grant is missing");
        require(am.getTargetFunctionRole(address(poker), ClimPoker.poke.selector) == CLIM_RUNNER, "poker: poke role");
        _checkPool(hook, ".D");
        _checkPool(hook, ".K");
        _checkPool(hook, ".F");
    }

    function _checkPool(address hook, string memory which) internal view {
        bytes32 id = vm.parseJsonBytes32(_read("pools"), string.concat(which, ".poolId"));
        (uint160 sqrtP,,,) = IStateView(STATE_VIEW).getSlot0(PoolId.wrap(id));
        require(sqrtP != 0, string.concat(which, ": not initialized"));
        require(IStateView(STATE_VIEW).getLiquidity(PoolId.wrap(id)) > 0, string.concat(which, ": no liquidity"));
        (uint24 floorPips, uint24 flatPips, uint24 capPips, bool set) = PokeFeeHook(hook).configs(PoolId.wrap(id));
        require(
            set && floorPips == HOOK_FLOOR_PIPS && flatPips == HOOK_FLAT_PIPS && capPips == HOOK_CAP_PIPS,
            string.concat(which, ": hook config")
        );
    }

    function _uniswap() internal returns (string memory) {
        string memory o = "uniswap";
        vm.serializeAddress(o, "poolManager", POOL_MANAGER);
        vm.serializeAddress(o, "stateView", STATE_VIEW);
        vm.serializeAddress(o, "poolSwapTest", _addr("tokens", ".swapRouter"));
        return vm.serializeAddress(o, "poolModifyLiquidityTest", _addr("tokens", ".lpRouter"));
    }

    function _routers() internal returns (string memory) {
        return vm.serializeAddress("routers", "arb", _addr("tokens", ".arbRouter"));
    }

    function _cre() internal returns (string memory) {
        string memory o = "cre";
        vm.serializeAddress(o, "mockForwarder", MOCK_FORWARDER);
        vm.serializeAddress(o, "keystoneForwarder", KEYSTONE_FORWARDER);
        return vm.serializeAddress(o, "simOperator", _addr("desk", ".simOperator"));
    }

    function _roles() internal returns (string memory) {
        string memory o = "roles";
        vm.serializeUint(o, "feePoker", FEE_POKER);
        vm.serializeUint(o, "climRunner", CLIM_RUNNER);
        vm.serializeAddress(o, "runner", _addr("desk", ".runner"));
        return vm.serializeAddress(o, "keeper", _addr("hook", ".keeper"));
    }

    function _token(string memory o, address a, string memory symbol, uint8 decimals) internal returns (string memory) {
        vm.serializeAddress(o, "address", a);
        vm.serializeString(o, "symbol", symbol);
        return vm.serializeUint(o, "decimals", decimals);
    }

    function _tokens() internal returns (string memory) {
        string memory o = "tokens.out";
        vm.serializeString(o, "tETH", _token("tokens.tETH", _addr("tokens", ".tETH"), "tETH", ETH_DECIMALS));
        return vm.serializeString(o, "tUSDG", _token("tokens.tUSDG", _addr("tokens", ".tUSDG"), "tUSDG", USD_DECIMALS));
    }

    function _hookConfig() internal returns (string memory) {
        string memory o = "hookConfig";
        vm.serializeUint(o, "floorPips", HOOK_FLOOR_PIPS);
        vm.serializeUint(o, "flatPips", HOOK_FLAT_PIPS);
        return vm.serializeUint(o, "capPips", HOOK_CAP_PIPS);
    }

    function _pools() internal returns (string memory) {
        string memory pools = _read("pools");
        string memory o = "pools.out";
        vm.serializeString(o, "D", _pool(pools, "D"));
        vm.serializeString(o, "K", _pool(pools, "K"));
        return vm.serializeString(o, "F", _pool(pools, "F"));
    }

    function _pool(string memory pools, string memory name) internal returns (string memory) {
        string memory base = string.concat(".", name);
        return _poolJson(
            string.concat("out.", name),
            _keyFrom(pools, base),
            vm.parseJsonBool(pools, string.concat(base, ".token0IsEth")),
            vm.parseJsonString(pools, string.concat(base, ".driver"))
        );
    }

    function _entry(string memory name, address a, string memory id, bytes memory args)
        internal
        returns (string memory)
    {
        string memory o = string.concat("verify.", name);
        vm.serializeAddress(o, "address", a);
        vm.serializeString(o, "contract", id);
        return vm.serializeBytes(o, "args", args);
    }

    function _verify() internal returns (string memory) {
        string memory t = _read("tokens");
        string memory h = _read("hook");
        string memory d = _read("desk");
        bytes memory routerArgs = vm.parseJsonBytes(t, ".argsRouter");
        string memory o = "verify";
        vm.serializeString(
            o, "tETH", _entry("tETH", _addr("tokens", ".tETH"), TOKEN_ID, vm.parseJsonBytes(t, ".argsTETH"))
        );
        vm.serializeString(
            o, "tUSDG", _entry("tUSDG", _addr("tokens", ".tUSDG"), TOKEN_ID, vm.parseJsonBytes(t, ".argsTUSDG"))
        );
        vm.serializeString(o, "swapRouter", _entry("swapRouter", _addr("tokens", ".swapRouter"), SWAP_ID, routerArgs));
        vm.serializeString(o, "arbRouter", _entry("arbRouter", _addr("tokens", ".arbRouter"), SWAP_ID, routerArgs));
        vm.serializeString(o, "lpRouter", _entry("lpRouter", _addr("tokens", ".lpRouter"), LP_ID, routerArgs));
        vm.serializeString(
            o,
            "accessManager",
            _entry("accessManager", _addr("hook", ".accessManager"), AM_ID, vm.parseJsonBytes(h, ".argsAccessManager"))
        );
        vm.serializeString(
            o,
            "hook",
            _entry(
                "hook", _addr("hook", ".hook"), "src/v2/PokeFeeHook.sol:PokeFeeHook", vm.parseJsonBytes(h, ".argsHook")
            )
        );
        vm.serializeString(
            o,
            "riskDesk",
            _entry(
                "riskDesk",
                _addr("desk", ".riskDesk"),
                "src/v2/RiskDeskV2.sol:RiskDeskV2",
                vm.parseJsonBytes(d, ".argsDesk")
            )
        );
        vm.serializeString(
            o,
            "policy",
            _entry(
                "policy",
                _addr("desk", ".policy"),
                "src/v2/ClimFeePolicy.sol:ClimFeePolicy",
                vm.parseJsonBytes(d, ".argsPolicy")
            )
        );
        return vm.serializeString(
            o,
            "poker",
            _entry(
                "poker", _addr("desk", ".poker"), "src/v2/ClimPoker.sol:ClimPoker", vm.parseJsonBytes(d, ".argsPoker")
            )
        );
    }
}
