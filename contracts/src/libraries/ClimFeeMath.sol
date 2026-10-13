// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ClimFeeMath
/// @notice fee_pips = clamp(ceil(sigmaE9 * etaE4 * sqrtHalfDtE6 * kE4 / 1e17), feeMinPips, feeMaxPips).
/// @dev The fee is eta standard deviations of the price move over half a block:
///      sigma (per sqrt-second, 1e9) * eta (1e4) * sqrt(blockTime / 2) (1e6) * k (1e4) = fee * 1e23,
///      and 1 pip = 1e-6, so dividing by 1e17 yields pips. The largest possible product is
///      (2^32)^3 * 2^16 = 2^112, far below 2^256: no overflow for any input.
///      Precondition: feeMinPips <= feeMaxPips (its callers' constructors check it).
library ClimFeeMath {
    uint256 internal constant SCALE = 1e17;

    function feePips(
        uint32 sigmaE9,
        uint32 etaE4,
        uint32 sqrtHalfDtE6,
        uint16 kE4,
        uint24 feeMinPips,
        uint24 feeMaxPips
    ) internal pure returns (uint24) {
        uint256 num = uint256(sigmaE9) * etaE4 * sqrtHalfDtE6 * kE4;
        uint256 raw = (num + SCALE - 1) / SCALE; // ceil: round in favor of LPs
        if (raw < feeMinPips) return feeMinPips;
        if (raw > feeMaxPips) return feeMaxPips;
        return uint24(raw);
    }
}
