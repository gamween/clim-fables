// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {BaseOverrideFee} from "@openzeppelin/uniswap-hooks/fee/BaseOverrideFee.sol";
import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title PokeFeeHook
/// @notice A Uniswap v4 hook with a flat LP fee and bounded, expiring overrides ("pokes"), exposing the same public
///         interface as Fables' override hooks so clim's live reference pools on Robinhood Chain testnet behave like
///         Fables' pools. Clean-room: written from Fables' published ABI and observed on-chain behavior only, none
///         of Fables' source (which is not open source) was used.
///         Fee rule: flat; under a live poke, max(poke, max(floor, flat / 2)); never above the cap.
contract PokeFeeHook is BaseOverrideFee, AccessManaged {
    struct Config {
        uint24 floorPips;
        uint24 flatPips;
        uint24 capPips;
        bool set;
    }

    struct Poke {
        uint24 fee0For1;
        uint24 fee1For0;
        uint40 expiry;
    }

    uint256 public constant MAX_POKE_DISCOUNT_BPS = 5_000;
    uint40 public constant MAX_TTL = 72 hours;

    mapping(PoolId => Config) public configs;
    mapping(PoolId => Poke) public pokes;

    event PoolConfigured(bytes32 indexed poolId, uint24 floorPips, uint24 flatPips, uint24 maxFee);
    event FeePoked(bytes32 indexed poolId, uint24 fee, uint40 expiry);
    event FeePoked(bytes32 indexed poolId, uint24 fee0For1, uint24 fee1For0, uint40 expiry);
    event PokeCleared(bytes32 indexed poolId);

    error InvalidConfig();
    error PoolNotConfigured(bytes32 poolId);
    error FeeOutOfBounds(uint24 fee);
    error InvalidTtl(uint40 ttl);

    constructor(IPoolManager poolManager_, address authority) BaseHook(poolManager_) AccessManaged(authority) {}

    function setPoolConfig(PoolKey calldata key, uint24 floorPips, uint24 flatPips, uint24 capPips)
        external
        restricted
    {
        if (floorPips == 0 || floorPips > flatPips || flatPips > capPips || capPips > LPFeeLibrary.MAX_LP_FEE) {
            revert InvalidConfig();
        }
        PoolId id = key.toId();
        configs[id] = Config(floorPips, flatPips, capPips, true);
        emit PoolConfigured(PoolId.unwrap(id), floorPips, flatPips, capPips);
    }

    function pokeFee(bytes32 poolId, uint24 fee, uint40 ttl) external restricted {
        uint40 expiry = _poke(poolId, fee, fee, ttl);
        emit FeePoked(poolId, fee, expiry);
    }

    function pokeFee(bytes32 poolId, uint24 fee0For1, uint24 fee1For0, uint40 ttl) external restricted {
        uint40 expiry = _poke(poolId, fee0For1, fee1For0, ttl);
        emit FeePoked(poolId, fee0For1, fee1For0, expiry);
    }

    function clearPoke(bytes32 poolId) external restricted {
        delete pokes[PoolId.wrap(poolId)];
        emit PokeCleared(poolId);
    }

    /// @notice The LP fee a swap in this direction pays right now, in pips.
    function currentFee(bytes32 poolId, bool zeroForOne) public view returns (uint24) {
        Config memory c = configs[PoolId.wrap(poolId)];
        if (!c.set) revert PoolNotConfigured(poolId);
        uint256 fee = c.flatPips;
        Poke memory p = pokes[PoolId.wrap(poolId)];
        if (p.expiry > block.timestamp) {
            uint256 poked = zeroForOne ? p.fee0For1 : p.fee1For0;
            uint256 pokeFloor = (uint256(c.flatPips) * (10_000 - MAX_POKE_DISCOUNT_BPS)) / 10_000;
            if (c.floorPips > pokeFloor) pokeFloor = c.floorPips;
            fee = poked > pokeFloor ? poked : pokeFloor;
        }
        return uint24(fee > c.capPips ? c.capPips : fee);
    }

    function _poke(bytes32 poolId, uint24 f01, uint24 f10, uint40 ttl) private returns (uint40 expiry) {
        Config memory c = configs[PoolId.wrap(poolId)];
        if (!c.set) revert PoolNotConfigured(poolId);
        if (f01 > c.capPips || f01 < c.floorPips) revert FeeOutOfBounds(f01);
        if (f10 > c.capPips || f10 < c.floorPips) revert FeeOutOfBounds(f10);
        if (ttl == 0 || ttl > MAX_TTL) revert InvalidTtl(ttl);
        expiry = uint40(block.timestamp) + ttl;
        pokes[PoolId.wrap(poolId)] = Poke(f01, f10, expiry);
    }

    function _getFee(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (uint24)
    {
        return currentFee(PoolId.unwrap(key.toId()), params.zeroForOne);
    }
}
