// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";

import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";

/// @notice What the live reference pools do while the maintainer's Mac is asleep or offline (plan 03 Task 23): the
///         stack of the testnet (desk, policy, directional poker on D, keeper pokes on K, F flat, hook config 100 / 700 /
///         6,000) with no report, no poke and no keeper post from the last ones until the desk is back.
contract OutageTest is Deployers {
    uint64 internal constant FEE_POKER = 1;
    uint64 internal constant CLIM_RUNNER = 7;
    uint40 internal constant T0 = 1_760_000_000;
    uint32 internal constant SIGMA_48 = 85_475; // 48 %/yr per sqrt-second, x 1e9
    uint32 internal constant SIGMA_300 = 534_217; // 300 %/yr
    uint24 internal constant FLAT = 700;
    uint24 internal constant KEEPER_FEE = 1_480;
    uint40 internal constant KEEPER_TTL = 7_200;
    uint40 internal constant POKE_TTL = 600;
    address internal constant HOOK_ADDRESS =
        address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) ^ (0x7777 << 144));

    AccessManager internal am;
    PokeFeeHook internal hook;
    RiskDeskV2 internal desk;
    ClimFeePolicy internal policy;
    ClimPoker internal poker;
    PoolKey internal keyD;
    PoolKey internal keyK;
    PoolKey internal keyF;
    address internal forwarder = makeAddr("mockForwarder");
    address internal operator = makeAddr("creOperator");
    address internal runner = makeAddr("runner");
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(T0);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        am = new AccessManager(address(this));
        deployCodeTo("PokeFeeHook.sol:PokeFeeHook", abi.encode(manager, address(am)), HOOK_ADDRESS);
        hook = PokeFeeHook(HOOK_ADDRESS);
        keyD = _pool(10);
        keyK = _pool(11);
        keyF = _pool(12);

        desk = new RiskDeskV2(forwarder, operator);
        policy = new ClimFeePolicy(
            desk,
            ClimFeePolicy.Params({
                etaE4: 175_198,
                sqrtHalfDtE6: 850_890,
                floorPips: 700,
                capPips: 6_000,
                safePips: 3_000,
                tauKillSec: 180,
                shortWindow: true,
                dirSlopeE4: 2_753,
                dirMaxPremiumPips: 567,
                ethIsToken0: true
            })
        );
        poker = new ClimPoker(policy, address(hook), _id(keyD), true, POKE_TTL, address(am));

        bytes4[] memory hookSel = new bytes4[](3);
        hookSel[0] = bytes4(keccak256("pokeFee(bytes32,uint24,uint40)"));
        hookSel[1] = bytes4(keccak256("pokeFee(bytes32,uint24,uint24,uint40)"));
        hookSel[2] = PokeFeeHook.clearPoke.selector;
        am.setTargetFunctionRole(address(hook), hookSel, FEE_POKER);
        bytes4[] memory pokeSel = new bytes4[](1);
        pokeSel[0] = ClimPoker.poke.selector;
        am.setTargetFunctionRole(address(poker), pokeSel, CLIM_RUNNER);
        am.grantRole(FEE_POKER, address(poker), 0);
        am.grantRole(FEE_POKER, keeper, 0);
        am.grantRole(CLIM_RUNNER, runner, 0);
    }

    function _pool(int24 spacing) internal returns (PoolKey memory k) {
        (k,) = initPool(
            currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, spacing, SQRT_PRICE_1_1
        );
        hook.setPoolConfig(k, 100, FLAT, 6_000);
        modifyLiquidityRouter.modifyLiquidity(
            k,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(spacing),
                tickUpper: TickMath.maxUsableTick(spacing),
                liquidityDelta: 1e21,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _id(PoolKey memory k) internal pure returns (bytes32) {
        return PoolId.unwrap(k.toId());
    }

    function _report(uint40 tObs, uint32 sigmaE9) internal {
        vm.prank(forwarder, operator);
        desk.onReport("", abi.encode(tObs, sigmaE9, sigmaE9, int32(0), uint16(3), uint8(4), uint16(10_000)));
    }

    /// @dev The fee a small swap pays, read from PoolManager's Swap event.
    function _swapFee(PoolKey memory k, bool zeroForOne) internal returns (uint24 fee) {
        vm.recordLogs();
        swap(k, zeroForOne, -1e15, ZERO_BYTES);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == IPoolManager.Swap.selector) {
                (,,,,, fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return fee;
            }
        }
        revert("no Swap event");
    }

    function _fees(PoolKey memory k) internal view returns (uint24 f01, uint24 f10) {
        return (hook.currentFee(_id(k), true), hook.currentFee(_id(k), false));
    }

    /// @dev Last report at T0, D poked from it, K poked by the keeper, then the Mac sleeps.
    function _lastActionsBeforeTheOutage() internal returns (uint24 d01, uint24 d10) {
        _report(T0, SIGMA_48);
        vm.prank(runner);
        (d01, d10) = poker.poke();
        vm.prank(keeper);
        hook.pokeFee(_id(keyK), KEEPER_FEE, KEEPER_TTL);
    }

    function test_BeforeTheOutageEachPoolChargesItsDriversFee() public {
        (uint24 d01, uint24 d10) = _lastActionsBeforeTheOutage();
        (uint24 a, uint24 b) = _fees(keyD);
        assertEq(a, d01);
        assertEq(b, d10);
        assertGt(d01, FLAT); // 48 %/yr is above the floor: D is not at its flat fee
        (a, b) = _fees(keyK);
        assertEq(a, KEEPER_FEE);
        assertEq(b, KEEPER_FEE);
        (a, b) = _fees(keyF);
        assertEq(a, FLAT);
        assertEq(b, FLAT);
    }

    function test_DeskGoesBlindAfterTauKillAndThePokerStops() public {
        _lastActionsBeforeTheOutage();
        vm.warp(T0 + 180);
        (,, uint8 mode) = policy.quoteDirectional();
        assertEq(mode, policy.MODE_NORMAL()); // still fresh at exactly tauKillSec
        vm.warp(T0 + 181);
        (,, mode) = policy.quoteDirectional();
        assertEq(mode, policy.MODE_BLIND());
        vm.prank(runner);
        vm.expectRevert(ClimPoker.DeskBlind.selector);
        poker.poke(); // the runner logs this as a skip, never as an error
    }

    function test_PoolDKeepsItsLastOverrideUntilItsTtlThenFallsBackToFlat() public {
        (uint24 d01, uint24 d10) = _lastActionsBeforeTheOutage();
        vm.warp(T0 + POKE_TTL - 1);
        (uint24 a, uint24 b) = _fees(keyD);
        assertEq(a, d01);
        assertEq(b, d10);
        vm.warp(T0 + POKE_TTL); // the override ends at tObs + 600
        (a, b) = _fees(keyD);
        assertEq(a, FLAT);
        assertEq(b, FLAT);
        assertEq(_swapFee(keyD, true), FLAT); // Fables' flat 7 bp, what a trader pays
        assertEq(_swapFee(keyD, false), FLAT);
    }

    function test_PoolKKeepsTheKeepersLastPokeForItsTtl() public {
        _lastActionsBeforeTheOutage();
        vm.warp(T0 + KEEPER_TTL - 1);
        (uint24 a,) = _fees(keyK);
        assertEq(a, KEEPER_FEE);
        assertEq(_swapFee(keyK, true), KEEPER_FEE);
        vm.warp(T0 + KEEPER_TTL);
        (a,) = _fees(keyK);
        assertEq(a, FLAT);
    }

    function test_PoolFStaysFlatThroughout() public {
        _lastActionsBeforeTheOutage();
        uint40[4] memory at = [T0 + 1, T0 + 181, T0 + POKE_TTL, T0 + KEEPER_TTL];
        for (uint256 i; i < at.length; i++) {
            vm.warp(at[i]);
            assertEq(_swapFee(keyF, i % 2 == 0), FLAT);
        }
    }

    function test_FirstReportAfterTheOutageIsTakenAsIsAndPokesAgain() public {
        _lastActionsBeforeTheOutage();
        uint40 back = T0 + 900; // 15 minutes later, more than RESET_GAP (180 s)
        vm.warp(back);
        _report(back, SIGMA_300);
        (, uint32 s15, uint32 s5,,,, uint32 seq) = desk.state();
        assertEq(seq, 2);
        assertEq(s5, SIGMA_300); // not ramped from 48 %/yr (x2 per report would give 96 %/yr)
        assertEq(s15, SIGMA_300);
        (uint24 q01, uint24 q10, uint8 mode) = policy.quoteDirectional();
        assertEq(mode, policy.MODE_NORMAL());
        vm.prank(runner);
        poker.poke();
        (uint24 a, uint24 b) = _fees(keyD);
        assertEq(a, q01);
        assertEq(b, q10);
    }
}
