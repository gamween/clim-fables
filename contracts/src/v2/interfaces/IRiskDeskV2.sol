// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRiskDeskV2
/// @notice Read side of the clim x Fables risk desk: two volatility windows and the venue-versus-pool price gap,
///         published by a Chainlink CRE workflow.
interface IRiskDeskV2 {
    /// @param seq Report counter, starts at 1.
    /// @param tObs DON observation time (unix seconds).
    /// @param sigma15Applied 15-minute realized volatility after the envelope, per sqrt-second, times 1e9.
    /// @param sigma5Applied 5-minute realized volatility after the envelope, per sqrt-second, times 1e9.
    /// @param sigma15Reported 15-minute volatility as reported.
    /// @param sigma5Reported 5-minute volatility as reported.
    /// @param devPips (venue price - pool price) / pool price, times 1e6, clamped to +-1e6.
    /// @param dispBp Venue dispersion in basis points.
    /// @param nSources Venues that passed the freshness filter.
    /// @param kE4 Model-risk multiplier applied, times 1e4 (clamped to [10_000, 20_000]).
    /// @param flags State flags after this report (bit 0: degraded, the venues disagree beyond DISP_MAX_BP).
    event RiskReportedV2(
        uint32 indexed seq,
        uint40 tObs,
        uint32 sigma15Applied,
        uint32 sigma5Applied,
        uint32 sigma15Reported,
        uint32 sigma5Reported,
        int32 devPips,
        uint16 dispBp,
        uint8 nSources,
        uint16 kE4,
        uint8 flags
    );

    /// @notice Latest accepted state, packed in one storage slot.
    function state()
        external
        view
        returns (uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 kE4, uint8 flags, uint32 seq);
}
