// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";

import {ClimFeePolicy, POLICY_MODE_BLIND} from "./ClimFeePolicy.sol";
import {ISymmetricPokeHook, IDirectionalPokeHook} from "./interfaces/IOverrideFeeHook.sol";

/// @title ClimPoker
/// @notice The adapter a Fables pool grants its FEE_POKER role to. It is governed by Fables' own AccessManager (the
///         one that guards their hook): clim holds no admin power over it, and only the roles Fables grants can call
///         it. The fee always comes from clim's policy (the desk's public state), never from the caller; Fables'
///         keeper adds event overrides (CPI, FOMC...) and the poke sends max(clim's fee, live event fee) per direction.
///         Fables' hook still enforces its own floor, cap and TTL. A blind desk means no poke: the last override
///         expires and the pool falls back to its flat fee.
///
///         Intended setup, one AccessManager batch by Fables' admin:
///         - grantRole(FEE_POKER, poker, 0): the poker may call the hook's pokeFee;
///         - setTargetFunctionRole(poker, [postEvent, postEventAndPoke], FEE_POKER): Fables' keeper posts its event
///           overrides through the poker, so they compose with clim's fee in the hook's one override slot;
///         - setTargetFunctionRole(poker, [poke], CLIM_RUNNER) with a role id Fables picks, granted to clim's runner
///           bot and to Fables' keeper.
///         Revoking FEE_POKER from the poker stops everything at once.
contract ClimPoker is AccessManaged {
    struct EventOverride {
        uint24 fee0For1;
        uint24 fee1For0;
        uint40 expiry;
    }

    uint40 public constant MAX_TTL = 72 hours;

    ClimFeePolicy public immutable policy;
    address public immutable hook;
    bytes32 public immutable poolId;
    bool public immutable directional;
    uint40 public immutable ttl;

    EventOverride public eventOverride;

    /// @param seq Desk report the fee comes from.
    /// @param tObs Observation time of that report.
    /// @param mode Policy mode (0 normal, 1 degraded).
    /// @param eventApplied True when a live event override raised at least one side above clim's fee.
    /// @param expiry When the override sent to the hook ends.
    /// @param caller Who triggered the poke.
    event Poked(
        uint32 indexed seq,
        uint40 tObs,
        uint24 fee0For1,
        uint24 fee1For0,
        uint8 mode,
        bool eventApplied,
        uint40 expiry,
        address caller
    );
    event EventPosted(address indexed by, uint24 fee0For1, uint24 fee1For0, uint40 expiry);

    error InvalidConfig();
    error DeskBlind();
    error InvalidExpiry(uint40 expiry);

    constructor(
        ClimFeePolicy policy_,
        address hook_,
        bytes32 poolId_,
        bool directional_,
        uint40 ttl_,
        address authority_
    ) AccessManaged(authority_) {
        if (
            address(policy_) == address(0) || hook_ == address(0) || authority_ == address(0) || ttl_ == 0
                || ttl_ > MAX_TTL
        ) {
            revert InvalidConfig();
        }
        policy = policy_;
        hook = hook_;
        poolId = poolId_;
        directional = directional_;
        ttl = ttl_;
    }

    /// @notice Records an event fee per direction, live until `expiry`; the next poke sends max(clim's fee, event fee).
    ///         It replaces any previous event. A zero fee leaves that side to clim, and a past expiry clears the event.
    ///         Restricted to the roles Fables assigns (FEE_POKER in the intended setup).
    function postEvent(uint24 fee0For1, uint24 fee1For0, uint40 expiry) external restricted {
        _postEvent(fee0For1, fee1For0, expiry);
    }

    /// @notice postEvent() then poke() in one call, so an event fee reaches the hook at once.
    function postEventAndPoke(uint24 fee0For1, uint24 fee1For0, uint40 expiry)
        external
        restricted
        returns (uint24, uint24)
    {
        _postEvent(fee0For1, fee1For0, expiry);
        return _poke();
    }

    /// @notice Sends clim's current fee, composed with any live event fee, to the hook. Restricted to the roles Fables
    ///         assigns (CLIM_RUNNER in the intended setup).
    function poke() external restricted returns (uint24 fee0For1, uint24 fee1For0) {
        return _poke();
    }

    function _postEvent(uint24 fee0For1, uint24 fee1For0, uint40 expiry) private {
        if (expiry > block.timestamp + MAX_TTL) revert InvalidExpiry(expiry);
        eventOverride = EventOverride(fee0For1, fee1For0, expiry);
        emit EventPosted(msg.sender, fee0For1, fee1For0, expiry);
    }

    function _poke() private returns (uint24 fee0For1, uint24 fee1For0) {
        (uint24 d01, uint24 d10, uint8 mode) = policy.quoteDirectional();
        if (mode == POLICY_MODE_BLIND) revert DeskBlind();
        if (!directional) {
            // one fee for both sides: the toxic side's
            if (d10 > d01) d01 = d10;
            else d10 = d01;
        }
        uint40 eventExpiry;
        (fee0For1, fee1For0, eventExpiry) = _withEvent(d01, d10);
        bool applied = fee0For1 != d01 || fee1For0 != d10;

        (uint40 tObs, uint32 seq) = policy.lastObservation();
        uint40 ttlSend = _ttlSend(tObs, applied ? eventExpiry : 0);
        if (directional) IDirectionalPokeHook(hook).pokeFee(poolId, fee0For1, fee1For0, ttlSend);
        else ISymmetricPokeHook(hook).pokeFee(poolId, fee0For1, ttlSend);
        emit Poked(seq, tObs, fee0For1, fee1For0, mode, applied, uint40(block.timestamp) + ttlSend, msg.sender);
    }

    /// @dev max(clim's fee, live event fee) per side, the event clamped to the policy cap; a symmetric hook gets the
    ///      higher side on both.
    function _withEvent(uint24 d01, uint24 d10) private view returns (uint24 f01, uint24 f10, uint40 expiry) {
        (f01, f10) = (d01, d10);
        EventOverride memory e = eventOverride;
        if (e.expiry <= block.timestamp) return (f01, f10, 0);
        uint24 cap = policy.capPips();
        uint24 e01 = e.fee0For1 > cap ? cap : e.fee0For1;
        uint24 e10 = e.fee1For0 > cap ? cap : e.fee1For0;
        if (e01 > f01) f01 = e01;
        if (e10 > f10) f10 = e10;
        if (!directional) {
            if (f10 > f01) f01 = f10;
            else f10 = f01;
        }
        expiry = e.expiry;
    }

    /// @dev The override lives until tObs + ttl (a fee is never trusted longer than its observation allows), never
    ///      longer than `ttl` (a future tObs within the desk's skew does not extend it), ends with an event that
    ///      raised it, and lasts at least 1 s (the hook rejects 0).
    function _ttlSend(uint40 tObs, uint40 eventExpiry) private view returns (uint40) {
        uint256 end = uint256(tObs) + ttl;
        if (eventExpiry != 0 && eventExpiry < end) end = eventExpiry;
        if (end <= block.timestamp) return 1;
        uint256 left = end - block.timestamp;
        return left > ttl ? ttl : uint40(left);
    }
}
