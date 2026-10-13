// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {MockDeskV2} from "./mocks/MockDeskV2.sol";
import {MockPokeHook} from "./mocks/MockPokeHook.sol";

contract ClimPokerTest is Test {
    uint40 internal constant T0 = 1_760_000_000;
    uint32 internal constant SIGMA_48 = 85_475;
    uint32 internal constant SIGMA_300 = 534_217;
    bytes32 internal constant POOL = keccak256("pool");

    MockDeskV2 internal desk;
    MockPokeHook internal hook;
    ClimFeePolicy internal policy;
    address internal keeper = makeAddr("fablesKeeper");
    address internal anyone = makeAddr("anyone");

    function setUp() public {
        vm.warp(T0);
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
                dirMaxPremiumPips: 1_000
            })
        );
        desk.set(T0, SIGMA_48, SIGMA_48, 1_000, 0);
    }

    function _poker(bool directional) internal returns (ClimPoker p) {
        p = new ClimPoker(policy, address(hook), POOL, directional, 600, address(this));
        p.setEventKeeper(keeper);
    }

    function test_SymmetricPokeSendsTheHigherSideToTheOldHook() public {
        ClimPoker p = _poker(false);
        vm.prank(anyone);
        p.poke();
        assertEq(hook.lastPool(), POOL);
        assertEq(hook.last0For1(), 1_200); // max of 700 and 1_200: a symmetric hook gets the toxic side's fee
        assertEq(hook.last1For0(), 1_200);
        assertEq(hook.lastTtl(), 600);
    }

    function test_DirectionalPokeSendsBothSides() public {
        ClimPoker p = _poker(true);
        p.poke();
        assertEq(hook.last0For1(), 700);
        assertEq(hook.last1For0(), 1_200);
    }

    function test_RevertWhen_DeskIsBlind() public {
        ClimPoker p = _poker(false);
        vm.warp(T0 + 181);
        vm.expectRevert(ClimPoker.DeskBlind.selector);
        p.poke();
        assertEq(hook.pokes(), 0);
    }

    function test_EventOverrideComposesWithMax() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(4_000, 900, T0 + 300);
        p.poke();
        assertEq(hook.last0For1(), 4_000);
        assertEq(hook.last1For0(), 1_200);
    }

    function test_ExpiredEventIsIgnored() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(4_000, 4_000, T0 + 100);
        vm.warp(T0 + 101);
        desk.set(T0 + 101, SIGMA_48, SIGMA_48, 0, 0);
        p.poke();
        assertEq(hook.last0For1(), 700);
    }

    function test_EventFeeIsClampedToThePolicyCap() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(9_000, 9_000, T0 + 300);
        p.poke();
        assertEq(hook.last0For1(), 6_000);
    }

    function test_OnlyTheEventKeeperPostsEvents() public {
        ClimPoker p = _poker(true);
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(ClimPoker.NotEventKeeper.selector, anyone));
        p.postEvent(4_000, 4_000, T0 + 300);
    }

    function test_OnlyTheOwnerSetsTheEventKeeper() public {
        ClimPoker p = _poker(true);
        vm.prank(anyone);
        vm.expectRevert();
        p.setEventKeeper(anyone);
    }

    function test_RevertWhen_TtlIsZeroOrAbove72h() public {
        vm.expectRevert(ClimPoker.InvalidConfig.selector);
        new ClimPoker(policy, address(hook), POOL, false, 0, address(this));
        vm.expectRevert(ClimPoker.InvalidConfig.selector);
        new ClimPoker(policy, address(hook), POOL, false, 72 hours + 1, address(this));
    }

    function test_PokedEventCarriesWhatWasSent() public {
        ClimPoker p = _poker(true);
        vm.expectEmit(false, false, false, true, address(p));
        emit ClimPoker.Poked(700, 1_200, 0, false, uint40(T0 + 600));
        p.poke();
    }
}
