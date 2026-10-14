// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";

/// @notice Step 4: RiskDeskV2 (MockKeystoneForwarder, simulation mode, the CRE operator as simOperator),
///         ClimFeePolicy with every parameter from shared/params-fables.json including the per-direction premium,
///         and a directional ClimPoker on pool D, governed by our AccessManager with the batch Fables would send:
///         FEE_POKER for the poker, postEvent and postEventAndPoke behind FEE_POKER, poke behind CLIM_RUNNER (7),
///         CLIM_RUNNER granted to clim's runner bot.
/// Env: SIM_OPERATOR, RUNNER_ADDRESS.
contract LiveDesk is LiveScript {
    using stdJson for string;

    struct Deployed {
        address desk;
        address policy;
        address poker;
    }

    function run() external {
        _guard();
        address simOp = vm.envAddress("SIM_OPERATOR");
        address runner = vm.envAddress("RUNNER_ADDRESS");
        uint256 deployBlock = vm.getBlockNumber();
        Deployed memory x = _deploy(simOp, runner);
        _record(x, simOp, runner, deployBlock);
    }

    function _deploy(address simOp, address runner) internal returns (Deployed memory x) {
        AccessManager am = AccessManager(_addr("hook", ".accessManager"));
        ClimFeePolicy.Params memory params = _params();
        require(
            params.floorPips >= HOOK_FLOOR_PIPS && params.capPips <= HOOK_CAP_PIPS,
            "LiveDesk: the policy band must sit inside the hook band"
        );
        vm.startBroadcast(_pk());
        RiskDeskV2 desk = new RiskDeskV2(MOCK_FORWARDER, simOp);
        ClimFeePolicy policy = new ClimFeePolicy(desk, params);
        ClimPoker poker = new ClimPoker(policy, _addr("hook", ".hook"), _poolD(), true, _ttl(), address(am));
        _grant(am, poker, runner);
        vm.stopBroadcast();
        x = Deployed(address(desk), address(policy), address(poker));
    }

    function _record(Deployed memory x, address simOp, address runner, uint256 deployBlock) internal {
        string memory o = "desk";
        vm.serializeAddress(o, "riskDesk", x.desk);
        vm.serializeAddress(o, "policy", x.policy);
        vm.serializeAddress(o, "poker", x.poker);
        vm.serializeAddress(o, "simOperator", simOp);
        vm.serializeAddress(o, "runner", runner);
        vm.serializeBytes(o, "argsDesk", abi.encode(MOCK_FORWARDER, simOp));
        vm.serializeBytes(o, "argsPolicy", abi.encode(x.desk, _params()));
        vm.serializeBytes(
            o,
            "argsPoker",
            abi.encode(x.policy, _addr("hook", ".hook"), _poolD(), true, _ttl(), _addr("hook", ".accessManager"))
        );
        string memory json = vm.serializeUint(o, "deployBlock", deployBlock);
        _write("desk", json);
    }

    function _poolD() internal view returns (bytes32) {
        return vm.parseJsonBytes32(_read("pools"), ".D.poolId");
    }

    function _ttl() internal view returns (uint40) {
        return uint40(vm.readFile(PARAMS_PATH).readUint(".pokeTtlSec"));
    }

    function _params() internal view returns (ClimFeePolicy.Params memory) {
        string memory p = vm.readFile(PARAMS_PATH);
        bool dir = p.readBool(".dirEnabled");
        return ClimFeePolicy.Params({
            etaE4: uint32(p.readUint(".etaE4")),
            sqrtHalfDtE6: uint32(p.readUint(".sqrtHalfDtE6")),
            floorPips: uint24(p.readUint(".feeFloorPips")),
            capPips: uint24(p.readUint(".feeCapPips")),
            safePips: uint24(p.readUint(".feeSafePips")),
            tauKillSec: uint32(p.readUint(".tauKillSec")),
            shortWindow: p.readUint(".sigmaWindowSec") == 300,
            // pool D's hook takes one fee per direction, so the measured premium is used here (unlike the fork run
            // on Fables' symmetric ETH/USDG hook)
            dirSlopeE4: dir ? uint32(p.readUint(".dirSlopeE4")) : 0,
            dirMaxPremiumPips: dir ? uint24(p.readUint(".dirMaxPremiumPips")) : 0,
            ethIsToken0: vm.parseJsonBool(_read("pools"), ".token0IsEth")
        });
    }

    function _grant(AccessManager am, ClimPoker poker, address runner) internal {
        bytes4[] memory keeperSel = new bytes4[](2);
        keeperSel[0] = ClimPoker.postEvent.selector;
        keeperSel[1] = ClimPoker.postEventAndPoke.selector;
        bytes4[] memory runnerSel = new bytes4[](1);
        runnerSel[0] = ClimPoker.poke.selector;
        am.grantRole(FEE_POKER, address(poker), 0);
        am.setTargetFunctionRole(address(poker), keeperSel, FEE_POKER);
        am.labelRole(CLIM_RUNNER, "CLIM_RUNNER");
        am.setTargetFunctionRole(address(poker), runnerSel, CLIM_RUNNER);
        am.grantRole(CLIM_RUNNER, runner, 0);
    }
}
