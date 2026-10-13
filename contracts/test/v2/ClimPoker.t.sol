// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IAccessManaged} from "@openzeppelin/contracts/access/manager/IAccessManaged.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {FLAG_DEGRADED} from "../../src/interfaces/IRiskDesk.sol";
import {MockDeskV2} from "./mocks/MockDeskV2.sol";
import {MockPokeHook} from "./mocks/MockPokeHook.sol";

/// @notice ClimPoker under an AccessManager set up the way Fables would: FEE_POKER (1) on postEvent and
///         postEventAndPoke, CLIM_RUNNER (7, a role Fables creates) on poke.
contract ClimPokerTest is Test {
    uint64 internal constant FEE_POKER = 1;
    uint64 internal constant CLIM_RUNNER = 7;
    uint40 internal constant T0 = 1_760_000_000;
    uint32 internal constant SIGMA_48 = 85_475;
    bytes32 internal constant POOL = keccak256("pool");

    AccessManager internal am;
    MockDeskV2 internal desk;
    MockPokeHook internal hook;
    ClimFeePolicy internal policy;
    address internal keeper = makeAddr("fablesKeeper");
    address internal runner = makeAddr("climRunner");
    address internal anyone = makeAddr("anyone");

    function setUp() public {
        vm.warp(T0);
        am = new AccessManager(address(this));
        am.grantRole(FEE_POKER, keeper, 0);
        am.grantRole(CLIM_RUNNER, keeper, 0);
        am.grantRole(CLIM_RUNNER, runner, 0);
        desk = new MockDeskV2();
        hook = new MockPokeHook();
        policy = new ClimFeePolicy(
            desk,
            ClimFeePolicy.Params({
                etaE4: 25_093,
                sqrtHalfDtE6: 707_107,
                floorPips: 700,
                capPips: 6_000,
                safePips: 3_000,
                tauKillSec: 180,
                shortWindow: false,
                dirSlopeE4: 5_000,
                dirMaxPremiumPips: 1_000,
                ethIsToken0: true
            })
        );
        desk.set(T0, SIGMA_48, SIGMA_48, 1_000, 0);
    }

    function _poker(bool directional, uint40 ttl) internal returns (ClimPoker p) {
        p = new ClimPoker(policy, address(hook), POOL, directional, ttl, address(am));
        bytes4[] memory keeperSel = new bytes4[](2);
        keeperSel[0] = ClimPoker.postEvent.selector;
        keeperSel[1] = ClimPoker.postEventAndPoke.selector;
        am.setTargetFunctionRole(address(p), keeperSel, FEE_POKER);
        bytes4[] memory runnerSel = new bytes4[](1);
        runnerSel[0] = ClimPoker.poke.selector;
        am.setTargetFunctionRole(address(p), runnerSel, CLIM_RUNNER);
    }

    function _poker(bool directional) internal returns (ClimPoker) {
        return _poker(directional, 600);
    }

    function test_SymmetricPokeSendsTheHigherSideToTheOldHook() public {
        ClimPoker p = _poker(false);
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastPool(), POOL);
        assertEq(hook.last0For1(), 1_200); // max of 700 and 1_200: a symmetric hook gets the toxic side's fee
        assertEq(hook.last1For0(), 1_200);
        assertEq(hook.lastTtl(), 600);
    }

    function test_DirectionalPokeSendsBothSides() public {
        ClimPoker p = _poker(true);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 700);
        assertEq(hook.last1For0(), 1_200);
    }

    function test_FablesKeeperCanPokeToo() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.poke();
        assertEq(hook.pokes(), 1);
    }

    function test_RevertWhen_DeskIsBlind() public {
        ClimPoker p = _poker(false);
        vm.warp(T0 + 181);
        vm.prank(runner);
        vm.expectRevert(ClimPoker.DeskBlind.selector);
        p.poke();
        assertEq(hook.pokes(), 0);
    }

    function test_DegradedDeskPokesAtLeastTheSafeFee() public {
        ClimPoker p = _poker(true);
        desk.set(T0, SIGMA_48, SIGMA_48, 0, FLAG_DEGRADED);
        vm.expectEmit(true, false, false, true, address(p));
        emit ClimPoker.Poked(2, T0, 3_000, 3_000, policy.MODE_DEGRADED(), false, T0 + 600, runner);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 3_000);
        assertEq(hook.last1For0(), 3_000);
    }

    function test_EventOverrideComposesWithMax() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(4_000, 900, T0 + 300);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 4_000);
        assertEq(hook.last1For0(), 1_200);
    }

    function test_SymmetricPokeWithAnEvent() public {
        ClimPoker p = _poker(false);
        vm.prank(keeper);
        p.postEvent(4_000, 900, T0 + 300);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 4_000);
        assertEq(hook.last1For0(), 4_000);
        assertEq(hook.lastTtl(), 300); // the event raised the fee, so the override ends with the event
    }

    function test_PostEventAndPoke() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        (uint24 f01, uint24 f10) = p.postEventAndPoke(5_000, 5_000, T0 + 300);
        assertEq(f01, 5_000);
        assertEq(f10, 5_000);
        assertEq(hook.last0For1(), 5_000);
        assertEq(hook.last1For0(), 5_000);
        assertEq(hook.lastTtl(), 300);
        (uint24 e01, uint24 e10, uint40 expiry) = p.eventOverride();
        assertEq(e01, 5_000);
        assertEq(e10, 5_000);
        assertEq(expiry, T0 + 300);
    }

    function test_ExpiredEventIsIgnored() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(4_000, 4_000, T0 + 100);
        vm.warp(T0 + 101);
        desk.set(T0 + 101, SIGMA_48, SIGMA_48, 0, 0);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 700);
        assertEq(hook.lastTtl(), 600);
    }

    function test_EventFeeIsClampedToThePolicyCap() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(9_000, 9_000, T0 + 300);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 6_000);
    }

    function test_RevertWhen_TheHookRejectsTheFee() public {
        ClimPoker p = _poker(true);
        hook.setCap(1_000);
        vm.prank(runner);
        vm.expectRevert(MockPokeHook.FeeAboveCap.selector);
        p.poke();
    }

    function test_TtlIsAnchoredToTheObservation() public {
        ClimPoker p = _poker(true);
        vm.warp(T0 + 150); // still fresh (tauKillSec 180), but the observation is 150 s old
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 450);
    }

    function test_TtlFromAFutureObservationNeverExceedsTheConfiguredTtl() public {
        ClimPoker p = _poker(true);
        desk.set(T0 + 30, SIGMA_48, SIGMA_48, 0, 0);
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 600);
    }

    function test_TtlIsAtLeastOneSecond() public {
        ClimPoker p = _poker(true, 60);
        vm.warp(T0 + 100); // fresh for the policy, but past tObs + ttl
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 1);
    }

    function test_TtlIsLimitedByARaisingEvent() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(4_000, 0, T0 + 100);
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 100);
    }

    function test_TtlIgnoresAnEventBelowTheDeskFee() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(500, 500, T0 + 100);
        vm.expectEmit(true, false, false, true, address(p));
        emit ClimPoker.Poked(1, T0, 700, 1_200, 0, false, T0 + 600, runner);
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 600);
    }

    function test_RevertWhen_AStrangerPokes() public {
        ClimPoker p = _poker(true);
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, anyone));
        p.poke();
        assertEq(hook.pokes(), 0);
    }

    function test_RevertWhen_AStrangerPostsAnEvent() public {
        ClimPoker p = _poker(true);
        vm.startPrank(anyone);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, anyone));
        p.postEvent(4_000, 4_000, T0 + 300);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, anyone));
        p.postEventAndPoke(4_000, 4_000, T0 + 300);
        vm.stopPrank();
    }

    function test_RevertWhen_TheRunnerPostsAnEvent() public {
        ClimPoker p = _poker(true);
        vm.prank(runner);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, runner));
        p.postEvent(500, 500, T0 + 300);
    }

    function test_RevertWhen_EventExpiryIsBeyondMaxTtl() public {
        ClimPoker p = _poker(true);
        vm.startPrank(keeper);
        p.postEvent(4_000, 4_000, T0 + 72 hours);
        vm.expectRevert(abi.encodeWithSelector(ClimPoker.InvalidExpiry.selector, T0 + 72 hours + 1));
        p.postEvent(4_000, 4_000, T0 + 72 hours + 1);
        vm.stopPrank();
    }

    function test_EventPostedCarriesTheSender() public {
        ClimPoker p = _poker(true);
        vm.expectEmit(true, false, false, true, address(p));
        emit ClimPoker.EventPosted(keeper, 4_000, 900, T0 + 300);
        vm.prank(keeper);
        p.postEvent(4_000, 900, T0 + 300);
    }

    function test_PokedEventCarriesWhatWasSent() public {
        ClimPoker p = _poker(true);
        vm.expectEmit(true, false, false, true, address(p));
        emit ClimPoker.Poked(1, T0, 700, 1_200, 0, false, T0 + 600, runner);
        vm.prank(runner);
        p.poke();
    }

    function test_RevertWhen_ConfigIsInvalid() public {
        vm.expectRevert(ClimPoker.InvalidConfig.selector);
        new ClimPoker(policy, address(hook), POOL, false, 0, address(am));
        vm.expectRevert(ClimPoker.InvalidConfig.selector);
        new ClimPoker(policy, address(hook), POOL, false, 72 hours + 1, address(am));
        vm.expectRevert(ClimPoker.InvalidConfig.selector);
        new ClimPoker(policy, address(hook), POOL, false, 600, address(0));
    }
}
