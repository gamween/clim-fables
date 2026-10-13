// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimFeeMath} from "../../src/libraries/ClimFeeMath.sol";
import {FLAG_DEGRADED} from "../../src/interfaces/IRiskDesk.sol";
import {MockDeskV2} from "./mocks/MockDeskV2.sol";

contract ClimFeePolicyTest is Test {
    uint40 internal constant T0 = 1_760_000_000;
    uint32 internal constant SIGMA_48 = 85_475;
    uint32 internal constant SIGMA_300 = 534_217;
    uint32 internal constant SIGMA_1000 = 1_780_730;
    uint32 internal constant ETA_E4 = 25_093;
    uint32 internal constant SQRT_HALF_DT_E6 = 707_107; // dt = 1 s

    MockDeskV2 internal desk;

    function setUp() public {
        vm.warp(T0);
        desk = new MockDeskV2();
    }

    function _params(bool shortWindow, uint32 slopeE4, uint24 maxPrem)
        internal
        pure
        returns (ClimFeePolicy.Params memory)
    {
        return ClimFeePolicy.Params({
            etaE4: ETA_E4,
            sqrtHalfDtE6: SQRT_HALF_DT_E6,
            floorPips: 700,
            capPips: 6_000,
            safePips: 3_000,
            tauKillSec: 180,
            shortWindow: shortWindow,
            dirSlopeE4: slopeE4,
            dirMaxPremiumPips: maxPrem
        });
    }

    function _fee(uint32 sigma) internal pure returns (uint24) {
        return ClimFeeMath.feePips(sigma, ETA_E4, SQRT_HALF_DT_E6, 10_000, 700, 6_000);
    }

    function test_CalmSitsAtTheFloor() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        desk.set(T0, SIGMA_48, SIGMA_48, 0, 0);
        (uint24 fee, uint8 mode) = p.quote();
        assertEq(fee, 700);
        assertEq(mode, p.MODE_NORMAL());
    }

    function test_StormFollowsTheChosenWindow() public {
        ClimFeePolicy long = new ClimFeePolicy(desk, _params(false, 0, 0));
        ClimFeePolicy short = new ClimFeePolicy(desk, _params(true, 0, 0));
        desk.set(T0, SIGMA_300, SIGMA_1000, 0, 0);
        (uint24 a,) = long.quote();
        (uint24 b,) = short.quote();
        assertEq(a, _fee(SIGMA_300));
        assertEq(b, _fee(SIGMA_1000));
        assertGt(b, a);
    }

    function test_BlindWhenSilentOrNeverReported() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        (uint24 fee, uint8 mode) = p.quote();
        assertEq(mode, p.MODE_BLIND());
        assertEq(fee, 3_000);
        desk.set(T0, SIGMA_48, SIGMA_48, 0, 0);
        vm.warp(T0 + 181);
        (fee, mode) = p.quote();
        assertEq(mode, p.MODE_BLIND());
    }

    function test_DegradedChargesAtLeastSafe() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        desk.set(T0, SIGMA_48, SIGMA_48, 0, FLAG_DEGRADED);
        (uint24 fee, uint8 mode) = p.quote();
        assertEq(mode, p.MODE_DEGRADED());
        assertEq(fee, 3_000);
    }

    function test_DirectionalPremiumOnTheToxicSide() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 5_000, 1_000));
        // venue 10 bp above the pool: buyers of ETH (one-for-zero) are toxic; premium = 0.5 * 1_000 pips = 500
        desk.set(T0, SIGMA_48, SIGMA_48, 1_000, 0);
        (uint24 f01, uint24 f10,) = p.quoteDirectional();
        assertEq(f01, 700);
        assertEq(f10, 1_200);
        // venue below the pool: sellers of ETH (zero-for-one) are toxic
        desk.set(T0, SIGMA_48, SIGMA_48, -1_000, 0);
        (f01, f10,) = p.quoteDirectional();
        assertEq(f01, 1_200);
        assertEq(f10, 700);
    }

    function test_DirectionalPremiumIsCappedTwice() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 10_000, 1_000));
        desk.set(T0, SIGMA_48, SIGMA_48, 50_000, 0);
        (, uint24 f10,) = p.quoteDirectional();
        assertEq(f10, 1_700); // premium capped at 1_000
        ClimFeePolicy q = new ClimFeePolicy(desk, _params(false, 10_000, 6_000));
        desk.set(T0, SIGMA_1000, SIGMA_1000, 50_000, 0);
        (, f10,) = q.quoteDirectional();
        assertEq(f10, 6_000); // never above the cap
    }

    function test_NoPremiumWhenDisabled() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        desk.set(T0, SIGMA_48, SIGMA_48, 50_000, 0);
        (uint24 f01, uint24 f10,) = p.quoteDirectional();
        assertEq(f01, f10);
    }

    function test_RevertWhen_InvalidParams() public {
        ClimFeePolicy.Params memory bad = _params(false, 0, 0);
        bad.safePips = 6_001;
        vm.expectRevert(ClimFeePolicy.InvalidParams.selector);
        new ClimFeePolicy(desk, bad);
        bad = _params(false, 0, 6_001);
        vm.expectRevert(ClimFeePolicy.InvalidParams.selector);
        new ClimFeePolicy(desk, bad);
    }

    function testFuzz_FeeAlwaysWithinBounds(uint32 s15, uint32 s5, int32 dev, uint16 k) public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(true, 7_000, 2_000));
        desk.set(T0, s15, s5, dev, 0);
        desk.setK(uint16(bound(k, 10_000, 20_000)));
        (uint24 f01, uint24 f10,) = p.quoteDirectional();
        assertGe(f01, 700);
        assertGe(f10, 700);
        assertLe(f01, 6_000);
        assertLe(f10, 6_000);
    }
}
