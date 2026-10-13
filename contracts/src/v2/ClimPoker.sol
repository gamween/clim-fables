// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {ClimFeePolicy} from "./ClimFeePolicy.sol";
import {ISymmetricPokeHook, IDirectionalPokeHook} from "./interfaces/IOverrideFeeHook.sol";

/// @title ClimPoker
/// @notice The adapter a Fables pool grants its FEE_POKER role to. Anyone may call poke(): the fee always comes from
///         clim's policy (the desk's public state), never from the caller. Fables' keeper keeps posting event
///         overrides (CPI, FOMC...) through postEvent(); poke() sends max(clim's fee, live event fee) per direction.
///         Fables' hook still enforces its own floor, cap and TTL. A blind desk means no poke: the last override
///         expires after `ttl` and the pool falls back to its flat fee. Revoking the role stops everything.
contract ClimPoker is Ownable2Step {
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

    address public eventKeeper;
    EventOverride public eventOverride;

    event Poked(uint24 fee0For1, uint24 fee1For0, uint8 mode, bool eventApplied, uint40 expiry);
    event EventKeeperSet(address keeper);
    event EventPosted(uint24 fee0For1, uint24 fee1For0, uint40 expiry);

    error InvalidConfig();
    error DeskBlind();
    error NotEventKeeper(address caller);

    constructor(ClimFeePolicy policy_, address hook_, bytes32 poolId_, bool directional_, uint40 ttl_, address owner_)
        Ownable(owner_)
    {
        if (address(policy_) == address(0) || hook_ == address(0) || ttl_ == 0 || ttl_ > MAX_TTL) {
            revert InvalidConfig();
        }
        policy = policy_;
        hook = hook_;
        poolId = poolId_;
        directional = directional_;
        ttl = ttl_;
    }

    function setEventKeeper(address keeper) external onlyOwner {
        eventKeeper = keeper;
        emit EventKeeperSet(keeper);
    }

    /// @notice Fables' keeper posts an event fee per direction until `expiry` (0 fees clear nothing: max() ignores them).
    function postEvent(uint24 fee0For1, uint24 fee1For0, uint40 expiry) external {
        if (msg.sender != eventKeeper) revert NotEventKeeper(msg.sender);
        eventOverride = EventOverride(fee0For1, fee1For0, expiry);
        emit EventPosted(fee0For1, fee1For0, expiry);
    }

    /// @notice Sends clim's current fee (composed with any live event fee) to the hook.
    function poke() external returns (uint24 fee0For1, uint24 fee1For0) {
        uint8 mode;
        (fee0For1, fee1For0, mode) = policy.quoteDirectional();
        if (mode == policy.MODE_BLIND()) revert DeskBlind();

        EventOverride memory e = eventOverride;
        bool applied = e.expiry > block.timestamp;
        if (applied) {
            uint24 cap = policy.capPips();
            uint24 e01 = e.fee0For1 > cap ? cap : e.fee0For1;
            uint24 e10 = e.fee1For0 > cap ? cap : e.fee1For0;
            if (e01 > fee0For1) fee0For1 = e01;
            if (e10 > fee1For0) fee1For0 = e10;
        }

        if (directional) {
            IDirectionalPokeHook(hook).pokeFee(poolId, fee0For1, fee1For0, ttl);
        } else {
            uint24 f = fee0For1 > fee1For0 ? fee0For1 : fee1For0;
            fee0For1 = f;
            fee1For0 = f;
            ISymmetricPokeHook(hook).pokeFee(poolId, f, ttl);
        }
        emit Poked(fee0For1, fee1For0, mode, applied, uint40(block.timestamp) + ttl);
    }
}
