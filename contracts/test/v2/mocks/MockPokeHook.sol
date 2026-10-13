// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ISymmetricPokeHook, IDirectionalPokeHook} from "../../../src/v2/interfaces/IOverrideFeeHook.sol";

/// @notice Records the last poke; reverts like Fables' hooks above `cap`.
contract MockPokeHook {
    bytes32 public lastPool;
    uint24 public last0For1;
    uint24 public last1For0;
    uint40 public lastTtl;
    uint256 public pokes;
    uint24 public cap = 6_000;

    error FeeAboveCap();

    function pokeFee(bytes32 poolId, uint24 fee, uint40 ttl) external {
        if (fee > cap) revert FeeAboveCap();
        (lastPool, last0For1, last1For0, lastTtl) = (poolId, fee, fee, ttl);
        pokes += 1;
    }

    function pokeFee(bytes32 poolId, uint24 f01, uint24 f10, uint40 ttl) external {
        if (f01 > cap || f10 > cap) revert FeeAboveCap();
        (lastPool, last0For1, last1For0, lastTtl) = (poolId, f01, f10, ttl);
        pokes += 1;
    }
}
