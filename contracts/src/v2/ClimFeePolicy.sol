// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {FLAG_DEGRADED} from "../interfaces/IRiskDesk.sol";
import {ClimFeeMath} from "../libraries/ClimFeeMath.sol";
import {IRiskDeskV2} from "./interfaces/IRiskDeskV2.sol";

/// @title ClimFeePolicy
/// @notice Turns the desk's state into the fee clim recommends for one Fables pool:
///         fee = clamp(ceil(eta * k * sigma * sqrt(dtEff / 2)), floor, cap), sigma from the 5- or 15-minute window,
///         at least `safe` when the desk is blind or degraded. quoteDirectional() adds a premium on the side the
///         venue-pool gap points to: premium = min(dirMax, dirSlope * |gap|), still capped.
///         Every parameter is immutable and comes from the lab (shared/params-fables.json).
contract ClimFeePolicy {
    uint8 public constant MODE_NORMAL = 0;
    uint8 public constant MODE_DEGRADED = 1;
    uint8 public constant MODE_BLIND = 2;

    struct Params {
        uint32 etaE4;
        uint32 sqrtHalfDtE6;
        uint24 floorPips;
        uint24 capPips;
        uint24 safePips;
        uint32 tauKillSec;
        bool shortWindow;
        uint32 dirSlopeE4;
        uint24 dirMaxPremiumPips;
    }

    IRiskDeskV2 public immutable desk;
    uint32 public immutable etaE4;
    uint32 public immutable sqrtHalfDtE6;
    uint24 public immutable floorPips;
    uint24 public immutable capPips;
    uint24 public immutable safePips;
    uint32 public immutable tauKillSec;
    bool public immutable shortWindow;
    uint32 public immutable dirSlopeE4;
    uint24 public immutable dirMaxPremiumPips;

    error InvalidParams();

    constructor(IRiskDeskV2 desk_, Params memory p) {
        if (
            address(desk_) == address(0) || p.etaE4 == 0 || p.sqrtHalfDtE6 == 0 || p.tauKillSec == 0 || p.floorPips == 0
                || p.floorPips > p.safePips || p.safePips > p.capPips || p.capPips > LPFeeLibrary.MAX_LP_FEE
                || p.dirMaxPremiumPips > p.capPips
        ) revert InvalidParams();
        desk = desk_;
        etaE4 = p.etaE4;
        sqrtHalfDtE6 = p.sqrtHalfDtE6;
        floorPips = p.floorPips;
        capPips = p.capPips;
        safePips = p.safePips;
        tauKillSec = p.tauKillSec;
        shortWindow = p.shortWindow;
        dirSlopeE4 = p.dirSlopeE4;
        dirMaxPremiumPips = p.dirMaxPremiumPips;
    }

    /// @notice One fee for both directions, and the desk's mode.
    function quote() public view returns (uint24 fee, uint8 mode) {
        (fee, mode,) = _quote();
    }

    /// @notice One fee per swap direction (zero-for-one sells ETH, one-for-zero buys it), and the desk's mode.
    function quoteDirectional() external view returns (uint24 fee0For1, uint24 fee1For0, uint8 mode) {
        int32 dev;
        uint24 base;
        (base, mode, dev) = _quote();
        fee0For1 = base;
        fee1For0 = base;
        if (dirSlopeE4 == 0 || dev == 0) return (fee0For1, fee1For0, mode);
        uint256 absDev = dev > 0 ? uint256(int256(dev)) : uint256(-int256(dev));
        uint256 premium = (uint256(dirSlopeE4) * absDev) / 10_000;
        if (premium > dirMaxPremiumPips) premium = dirMaxPremiumPips;
        uint256 toxic = uint256(base) + premium;
        if (toxic > capPips) toxic = capPips;
        // venue above the pool: buyers of ETH (one-for-zero) are toxic; below: sellers (zero-for-one)
        if (dev > 0) fee1For0 = uint24(toxic);
        else fee0For1 = uint24(toxic);
    }

    function _quote() private view returns (uint24 fee, uint8 mode, int32 dev) {
        (uint40 tObs, uint32 s15, uint32 s5, int32 devPips, uint16 kE4, uint8 flags,) = desk.state();
        uint16 k = kE4 == 0 ? 10_000 : kE4;
        fee = ClimFeeMath.feePips(shortWindow ? s5 : s15, etaE4, sqrtHalfDtE6, k, floorPips, capPips);
        dev = devPips;
        if (tObs == 0 || block.timestamp > uint256(tObs) + tauKillSec) {
            return (fee > safePips ? fee : safePips, MODE_BLIND, dev);
        }
        if (flags & FLAG_DEGRADED != 0) {
            return (fee > safePips ? fee : safePips, MODE_DEGRADED, dev);
        }
        return (fee, MODE_NORMAL, dev);
    }
}
