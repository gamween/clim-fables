// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";
import {IRiskDeskV2} from "../../src/v2/interfaces/IRiskDeskV2.sol";
import {FLAG_DEGRADED} from "../../src/interfaces/IRiskDesk.sol";
import {DeskV2Helpers} from "./utils/DeskV2Helpers.sol";

contract RiskDeskV2Test is DeskV2Helpers {
    RiskDeskV2 internal desk;

    function setUp() public {
        vm.warp(T0);
        desk = new RiskDeskV2(forwarder, operator);
    }

    function test_StartsEmpty() public view {
        (uint40 tObs, uint32 s15, uint32 s5, int32 dev, uint16 k, uint8 flags, uint32 seq) = desk.state();
        assertEq(tObs, 0);
        assertEq(s15, 0);
        assertEq(s5, 0);
        assertEq(dev, 0);
        assertEq(k, 0);
        assertEq(flags, 0);
        assertEq(seq, 0);
        assertTrue(desk.simMode());
    }

    function test_AcceptsAReportAndStoresEveryField() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_100, SIGMA_48, -1_234, 3, 4, 12_000));
        (uint40 tObs, uint32 s15, uint32 s5, int32 dev, uint16 k, uint8 flags, uint32 seq) = desk.state();
        assertEq(tObs, T0);
        assertEq(s15, SIGMA_100);
        assertEq(s5, SIGMA_48);
        assertEq(dev, -1_234);
        assertEq(k, 12_000);
        assertEq(flags, 0);
        assertEq(seq, 1);
    }

    function test_EmitsRiskReportedV2() public {
        vm.expectEmit(true, false, false, true, address(desk));
        emit IRiskDeskV2.RiskReportedV2(1, T0, SIGMA_100, SIGMA_48, SIGMA_100, SIGMA_48, 50, 3, 4, 10_000);
        _deliverV2(desk, _reportV2(T0, SIGMA_100, SIGMA_48, 50, 3, 4, 10_000));
    }

    function test_EnvelopeAppliesToEachWindowSeparately() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_100, SIGMA_48, 0, 3, 4, 10_000));
        vm.warp(T0 + 30);
        _deliverV2(desk, _reportV2(T0 + 30, SIGMA_10, SIGMA_300, 0, 3, 4, 10_000));
        (, uint32 s15, uint32 s5,,,,) = desk.state();
        assertEq(s15, (SIGMA_100 * 8) / 10); // falls at most to 80 %
        assertEq(s5, SIGMA_48 * 2); // rises at most x2
    }

    function test_DevIsClamped() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, 2_000_000));
        (,,, int32 dev,,,) = desk.state();
        assertEq(dev, 1_000_000);
        vm.warp(T0 + 30);
        _deliverV2(desk, _reportV2(T0 + 30, SIGMA_48, -2_000_000));
        (,,, dev,,,) = desk.state();
        assertEq(dev, -1_000_000);
    }

    function test_DegradedWhenVenuesDisagree() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, SIGMA_48, 0, 26, 4, 10_000));
        (,,,,, uint8 flags,) = desk.state();
        assertEq(flags, FLAG_DEGRADED);
    }

    function test_KIsClamped() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, SIGMA_48, 0, 3, 4, 5_000));
        (,,,, uint16 k,,) = desk.state();
        assertEq(k, 10_000);
    }

    function test_RevertWhen_TooSoon() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, 0));
        vm.expectRevert(abi.encodeWithSelector(RiskDeskV2.StaleReport.selector, T0 + 19, T0));
        _deliverV2(desk, _reportV2(T0 + 19, SIGMA_48, 0));
    }

    function test_RevertWhen_FromTheFuture() public {
        vm.expectRevert(abi.encodeWithSelector(RiskDeskV2.FutureReport.selector, T0 + 31, uint256(T0)));
        _deliverV2(desk, _reportV2(T0 + 31, SIGMA_48, 0));
    }

    function test_RevertWhen_TooFewSources() public {
        vm.expectRevert(abi.encodeWithSelector(RiskDeskV2.TooFewSources.selector, uint8(2)));
        _deliverV2(desk, _reportV2(T0, SIGMA_48, SIGMA_48, 0, 3, 2, 10_000));
    }

    function test_RevertWhen_SimOriginIsNotTheOperator() public {
        vm.prank(forwarder, attacker);
        vm.expectRevert(abi.encodeWithSelector(RiskDeskV2.NotSimOperator.selector, attacker));
        desk.onReport("", _reportV2(T0, SIGMA_48, 0));
    }

    function test_RevertWhen_NotTheForwarder() public {
        vm.prank(attacker, operator);
        vm.expectRevert();
        desk.onReport("", _reportV2(T0, SIGMA_48, 0));
    }

    function test_DisableSimIsOwnerOnly() public {
        vm.prank(attacker);
        vm.expectRevert();
        desk.disableSim();
        desk.disableSim();
        assertFalse(desk.simMode());
    }
}
