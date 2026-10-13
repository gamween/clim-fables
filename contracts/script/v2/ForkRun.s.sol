// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IAccessManager} from "@openzeppelin/contracts/access/manager/IAccessManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {ISymmetricPokeHook} from "../../src/v2/interfaces/IOverrideFeeHook.sol";

/// @notice The recorded run: on a fork of Robinhood Chain mainnet at the start of the 7 October 2026 storm, deploy
///         clim, send the AccessManager batch the integration asks of Fables (as Fables' admin, impersonated on the
///         fork), replay the desk's reports every 30 s, poke Fables' real ETH/USDG hook and swap both ways every
///         5 minutes. Writes docs/evidence/fork-run-2026-10-07.json. Simulation only: never run with --broadcast.
contract ForkRun is Script {
    using stdJson for string;

    address internal constant HOOK = 0x06a889870C8f83640D6816319f72e2aA579b6080;
    address internal constant ACCESS_MANAGER = 0xA362D98B33A7bb5B5E2180a05f995A70FB404f30;
    address internal constant POKER_ADMIN = 0x359856655934338d798F9ccE1f181486301D36a5;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    bytes32 internal constant POOL_ID = 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551;
    uint64 internal constant FEE_POKER = 1;
    uint64 internal constant CLIM_RUNNER = 7; // a role id Fables would pick for who may call ClimPoker.poke()

    string internal constant REPORTS = "../docs/evidence/fork-reports-2026-10-07.json";
    string internal constant PARAMS = "../shared/params-fables.json";
    string internal constant OUT = "../docs/evidence/fork-run-2026-10-07.json";

    address internal forwarder = address(0xF0F0);
    address internal operator = address(0x0F0F);
    /// @dev clim's runner bot: holds CLIM_RUNNER, pokes and swaps. A forge script may not use its own address.
    address internal runner = vm.addr(uint256(keccak256("climRunner")));

    uint256[] internal tArr;
    uint256[] internal pokedArr;
    uint256[] internal fee01Arr;
    uint256[] internal fee10Arr;
    uint256[] internal swapTArr;
    uint256[] internal swapFeeArr;
    bool[] internal swapZfoArr;
    uint256 internal swapReverts;

    function _policy(RiskDeskV2 desk) internal returns (ClimFeePolicy) {
        string memory p = vm.readFile(PARAMS);
        return new ClimFeePolicy(
            desk,
            ClimFeePolicy.Params({
                etaE4: uint32(p.readUint(".etaE4")),
                sqrtHalfDtE6: uint32(p.readUint(".sqrtHalfDtE6")),
                floorPips: uint24(p.readUint(".feeFloorPips")),
                capPips: uint24(p.readUint(".feeCapPips")),
                safePips: uint24(p.readUint(".feeSafePips")),
                tauKillSec: uint32(p.readUint(".tauKillSec")),
                shortWindow: p.readUint(".sigmaWindowSec") == 300,
                // No directional premium on this pool: Fables' ETH/USDG hook is symmetric (one fee for both
                // directions), and a symmetric ClimPoker sends the higher side on both, so the premium would raise
                // the fee for both directions. The measured per-direction rule (dirSlopeE4, dirMaxPremiumPips in
                // shared/params-fables.json, from lab/out/fables-direction.json) is for directional hooks.
                dirSlopeE4: 0,
                dirMaxPremiumPips: 0,
                ethIsToken0: true // native ETH is currency0 in the ETH/USDG pool key
            })
        );
    }

    /// @dev The batch Fables' admin would send: FEE_POKER for the poker, postEvent and postEventAndPoke behind
    ///      FEE_POKER, poke behind CLIM_RUNNER, granted here to clim's runner.
    function _fablesGrants(ClimPoker poker) internal {
        IAccessManager am = IAccessManager(ACCESS_MANAGER);
        bytes4[] memory keeperSel = new bytes4[](2);
        keeperSel[0] = ClimPoker.postEvent.selector;
        keeperSel[1] = ClimPoker.postEventAndPoke.selector;
        bytes4[] memory runnerSel = new bytes4[](1);
        runnerSel[0] = ClimPoker.poke.selector;
        vm.startPrank(POKER_ADMIN);
        am.grantRole(FEE_POKER, address(poker), 0);
        am.setTargetFunctionRole(address(poker), keeperSel, FEE_POKER);
        am.labelRole(CLIM_RUNNER, "CLIM_RUNNER");
        am.setTargetFunctionRole(address(poker), runnerSel, CLIM_RUNNER);
        am.grantRole(CLIM_RUNNER, runner, 0);
        vm.stopPrank();
    }

    function _key() internal pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(USDG), 0x800000, 10, IHooks(HOOK));
    }

    function _swap(PoolSwapTest router, bool zeroForOne) internal {
        PoolSwapTest.TestSettings memory s = PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        vm.recordLogs();
        vm.startPrank(runner);
        bool ok;
        if (zeroForOne) {
            try router.swap{
                value: 0.01 ether
            }(
                _key(),
                SwapParams({
                    zeroForOne: true, amountSpecified: -0.01 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                s,
                ""
            ) {
                ok = true;
            } catch {}
        } else {
            try router.swap(
                _key(),
                SwapParams({zeroForOne: false, amountSpecified: -20e6, sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
                s,
                ""
            ) {
                ok = true;
            } catch {}
        }
        vm.stopPrank();
        if (!ok) {
            swapReverts += 1;
            return;
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == POOL_MANAGER && logs[i].topics[0] == IPoolManager.Swap.selector) {
                (,,,,, uint24 fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                swapTArr.push(block.timestamp);
                swapFeeArr.push(fee);
                swapZfoArr.push(zeroForOne);
            }
        }
    }

    function run() external {
        string memory r = vm.readFile(REPORTS);
        uint256[] memory tObs = r.readUintArray(".tObs");
        uint256[] memory s15 = r.readUintArray(".sigma15E9");
        uint256[] memory s5 = r.readUintArray(".sigma5E9");
        int256[] memory dev = r.readIntArray(".devPips");

        RiskDeskV2 desk = new RiskDeskV2(forwarder, operator);
        ClimFeePolicy policy = _policy(desk);
        // symmetric hook (one fee for both directions); TTL from the lab parameters
        uint40 ttl = uint40(vm.readFile(PARAMS).readUint(".pokeTtlSec"));
        ClimPoker poker = new ClimPoker(policy, HOOK, POOL_ID, false, ttl, ACCESS_MANAGER);
        _fablesGrants(poker);

        PoolSwapTest router = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        vm.deal(runner, 10 ether);

        for (uint256 i; i < tObs.length; i++) {
            vm.warp(tObs[i] + 2);
            vm.prank(forwarder, operator);
            desk.onReport(
                "",
                abi.encode(
                    uint40(tObs[i]), uint32(s15[i]), uint32(s5[i]), int32(dev[i]), uint16(3), uint8(4), uint16(10_000)
                )
            );
            vm.prank(runner);
            (uint24 poked,) = poker.poke();
            tArr.push(block.timestamp);
            pokedArr.push(poked);
            fee01Arr.push(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true));
            fee10Arr.push(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, false));
            if (i % 10 == 0) {
                _swap(router, true);
                if (i == 0) {
                    // the first ETH sale funds the USDG side; approve once
                    vm.prank(runner);
                    (bool ok,) = USDG.call(
                        abi.encodeWithSignature("approve(address,uint256)", address(router), type(uint256).max)
                    );
                    require(ok, "approve");
                }
                _swap(router, false);
            }
        }

        string memory o = "run";
        vm.serializeString(o, "note", "Simulation on a fork of Robinhood Chain mainnet; nothing was sent to mainnet");
        vm.serializeUint(o, "forkBlock", block.number);
        vm.serializeAddress(o, "hook", HOOK);
        vm.serializeBytes32(o, "poolId", POOL_ID);
        vm.serializeAddress(o, "climPoker", address(poker));
        vm.serializeUint(o, "t", tArr);
        vm.serializeUint(o, "pokedPips", pokedArr);
        vm.serializeUint(o, "currentFee0For1Pips", fee01Arr);
        vm.serializeUint(o, "currentFee1For0Pips", fee10Arr);
        vm.serializeUint(o, "swapT", swapTArr);
        vm.serializeUint(o, "swapFeePips", swapFeeArr);
        vm.serializeBool(o, "swapZeroForOne", swapZfoArr);
        string memory json = vm.serializeUint(o, "swapReverts", swapReverts);
        vm.writeJson(json, OUT);
    }
}
