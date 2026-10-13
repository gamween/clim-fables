// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "../receiver/ReceiverTemplate.sol";
import {FLAG_DEGRADED} from "../interfaces/IRiskDesk.sol";
import {IRiskDeskV2} from "./interfaces/IRiskDeskV2.sol";

/// @title RiskDeskV2
/// @notice Stores what the clim CRE workflow measures for Fables' pool: 15-minute and 5-minute ETH realized
///         volatility and the venue-versus-pool price gap. Same guards as v1's RiskDesk: report spacing, clock skew,
///         a quorum of venues, a volatility envelope per window. The owner cannot set sigma or the gap directly, but
///         chooses which forwarder and workflow to trust (ReceiverTemplate), which decides what gets reported; so once
///         the desk is configured, ownership should go to a timelock or be renounced (see docs/security.md).
///         The owner can also end simulation mode for good, switching to the production forwarder in the same call.
contract RiskDeskV2 is ReceiverTemplate, IRiskDeskV2 {
    /// @notice ABI layout of the CRE report: abi.encode(uint40,uint32,uint32,int32,uint16,uint8,uint16).
    struct Report {
        uint40 tObs;
        uint32 sigma15E9;
        uint32 sigma5E9;
        int32 devPips;
        uint16 dispBp;
        uint8 nSources;
        uint16 kE4;
    }

    struct State {
        uint40 tObs;
        uint32 sigma15E9;
        uint32 sigma5E9;
        int32 devPips;
        uint16 kE4;
        uint8 flags;
        uint32 seq;
    }

    uint32 public constant SIGMA_MIN_E9 = 17_807; // 10 %/yr
    uint32 public constant SIGMA_MAX_E9 = 1_780_730; // 1000 %/yr
    uint16 public constant K_MIN_E4 = 10_000;
    uint16 public constant K_MAX_E4 = 20_000;
    uint16 public constant DISP_MAX_BP = 25;
    int32 public constant DEV_MAX_PIPS = 1_000_000;
    uint40 public constant MIN_GAP = 20;
    uint40 public constant MAX_SKEW = 30;
    uint8 public constant MIN_SOURCES = 3;
    /// @notice A report more than this after the last one restarts the envelope: after an outage the measurement is
    ///         taken as is (within the absolute bounds), not ramped from a stale value.
    uint40 public constant RESET_GAP = 180;

    /// @notice EOA allowed to originate reports while simulation mode is on (the `cre workflow simulate --broadcast` key).
    address public immutable simOperator;
    /// @notice True until disableSim() is called. MockKeystoneForwarder checks no signature, so tx.origin is the guard.
    bool public simMode;

    State private s_state;

    event SimDisabled(address forwarder);

    error ZeroSimOperator();
    error WorkflowNotPinned();
    error NotSimOperator(address origin);
    error StaleReport(uint40 tObs, uint40 lastTObs);
    error FutureReport(uint40 tObs, uint256 blockTimestamp);
    error TooFewSources(uint8 nSources);

    constructor(address forwarder, address simOperator_) ReceiverTemplate(forwarder) {
        if (simOperator_ == address(0)) revert ZeroSimOperator();
        simOperator = simOperator_;
        simMode = true;
    }

    /// @inheritdoc IRiskDeskV2
    function state()
        external
        view
        returns (uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 kE4, uint8 flags, uint32 seq)
    {
        State memory s = s_state;
        return (s.tObs, s.sigma15E9, s.sigma5E9, s.devPips, s.kE4, s.flags, s.seq);
    }

    /// @notice Irreversibly stops accepting reports on the sole basis of tx.origin, and in the same call trusts the
    ///         production forwarder, so the desk never accepts unsigned reports from the simulation forwarder without
    ///         the tx.origin guard. The workflow must already be pinned (expected workflow id or author).
    /// @param prodForwarder The production KeystoneForwarder, which verifies the DON's signatures.
    function disableSim(address prodForwarder) external onlyOwner {
        if (prodForwarder == address(0)) revert InvalidForwarderAddress();
        if (this.getExpectedWorkflowId() == bytes32(0) && this.getExpectedAuthor() == address(0)) {
            revert WorkflowNotPinned();
        }
        setForwarderAddress(prodForwarder);
        simMode = false;
        emit SimDisabled(prodForwarder);
    }

    function _processReport(bytes calldata report) internal override {
        Report memory r = abi.decode(report, (Report));
        State memory s = s_state;

        // solhint-disable-next-line avoid-tx-origin
        if (simMode && tx.origin != simOperator) revert NotSimOperator(tx.origin);
        if (s.seq != 0 && r.tObs < s.tObs + MIN_GAP) revert StaleReport(r.tObs, s.tObs);
        if (r.tObs > block.timestamp + MAX_SKEW) revert FutureReport(r.tObs, block.timestamp);
        if (r.nSources < MIN_SOURCES) revert TooFewSources(r.nSources);

        bool first = s.seq == 0 || r.tObs > s.tObs + RESET_GAP;
        State memory n = State({
            tObs: r.tObs,
            sigma15E9: _envelope(r.sigma15E9, s.sigma15E9, first),
            sigma5E9: _envelope(r.sigma5E9, s.sigma5E9, first),
            devPips: r.devPips > DEV_MAX_PIPS ? DEV_MAX_PIPS : (r.devPips < -DEV_MAX_PIPS ? -DEV_MAX_PIPS : r.devPips),
            kE4: r.kE4 < K_MIN_E4 ? K_MIN_E4 : (r.kE4 > K_MAX_E4 ? K_MAX_E4 : r.kE4),
            flags: r.dispBp > DISP_MAX_BP ? FLAG_DEGRADED : 0,
            seq: s.seq + 1
        });
        s_state = n;
        _emitReported(n, r);
    }

    /// @dev Separate frame keeps the 11-field event under the stack limit without via-IR.
    function _emitReported(State memory n, Report memory r) private {
        emit RiskReportedV2(
            n.seq,
            r.tObs,
            n.sigma15E9,
            n.sigma5E9,
            r.sigma15E9,
            r.sigma5E9,
            n.devPips,
            r.dispBp,
            r.nSources,
            n.kE4,
            n.flags
        );
    }

    /// @dev Volatility rises fast (x2 per report) and decays slowly (x0.8 per report); the first report, and the
    ///      first one after RESET_GAP of silence, only get the absolute bounds.
    function _envelope(uint32 reported, uint32 prev, bool first) internal pure returns (uint32) {
        uint256 lo = SIGMA_MIN_E9;
        uint256 hi = SIGMA_MAX_E9;
        if (!first) {
            uint256 down = (uint256(prev) * 8) / 10;
            uint256 up = uint256(prev) * 2;
            if (down > lo) lo = down;
            if (up < hi) hi = up;
        }
        if (reported < lo) return uint32(lo);
        if (reported > hi) return uint32(hi);
        return reported;
    }
}
