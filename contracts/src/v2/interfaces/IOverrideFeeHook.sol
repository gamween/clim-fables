// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The public override entry points of Fables' hooks, written from their published ABI (function
///         signatures only; no Fables code is copied). `poolId` is a Uniswap v4 PoolId (bytes32 in the ABI).

/// @dev Fables' first-generation hooks (e.g. ETH/USDG): one fee for both directions.
interface ISymmetricPokeHook {
    function pokeFee(bytes32 poolId, uint24 fee, uint40 ttl) external;
    function clearPoke(bytes32 poolId) external;
    function currentFee(bytes32 poolId, bool zeroForOne) external view returns (uint24);
}

/// @dev Fables' newer hooks: one fee per swap direction.
interface IDirectionalPokeHook {
    function pokeFee(bytes32 poolId, uint24 fee0For1, uint24 fee1For0, uint40 ttl) external;
    function clearPoke(bytes32 poolId) external;
    function currentFee(bytes32 poolId, bool zeroForOne) external view returns (uint24);
}
