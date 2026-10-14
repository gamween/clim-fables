// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";

/// @notice Step 2: our AccessManager (the deployer is its admin) and PokeFeeHook, deployed through the CREATE2
///         deployer at an address mined for AFTER_INITIALIZE | BEFORE_SWAP. The hook's pokeFee (both overloads) and
///         clearPoke are assigned to FEE_POKER; FEE_POKER is granted to the keeper-style bot (pool K).
///         setPoolConfig stays on ADMIN (role 0), i.e. the deployer.
/// Env: KEEPER_ADDRESS.
contract LiveAccessHook is LiveScript {
    function run() external {
        _guard();
        uint256 pk = _pk();
        address deployer = vm.addr(pk);
        address keeper = vm.envAddress("KEEPER_ADDRESS");
        uint256 deployBlock = vm.getBlockNumber();

        vm.startBroadcast(pk);
        AccessManager am = new AccessManager(deployer);
        vm.stopBroadcast();

        bytes memory args = abi.encode(IPoolManager(POOL_MANAGER), address(am));
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        (address hook, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(PokeFeeHook).creationCode, args);
        bytes4[] memory sel = new bytes4[](3);
        sel[0] = bytes4(keccak256("pokeFee(bytes32,uint24,uint40)"));
        sel[1] = bytes4(keccak256("pokeFee(bytes32,uint24,uint24,uint40)"));
        sel[2] = PokeFeeHook.clearPoke.selector;

        vm.startBroadcast(pk);
        (bool ok,) = CREATE2_FACTORY.call(abi.encodePacked(salt, type(PokeFeeHook).creationCode, args));
        require(ok && hook.code.length > 0, "LiveAccessHook: CREATE2 deployment failed");
        am.labelRole(FEE_POKER, "FEE_POKER");
        am.setTargetFunctionRole(hook, sel, FEE_POKER);
        am.grantRole(FEE_POKER, keeper, 0);
        vm.stopBroadcast();

        require(address(PokeFeeHook(hook).poolManager()) == POOL_MANAGER, "LiveAccessHook: wrong PoolManager");
        require(PokeFeeHook(hook).authority() == address(am), "LiveAccessHook: wrong authority");

        string memory o = "hook";
        vm.serializeAddress(o, "accessManager", address(am));
        vm.serializeAddress(o, "hook", hook);
        vm.serializeBytes32(o, "salt", salt);
        vm.serializeAddress(o, "keeper", keeper);
        vm.serializeBytes(o, "argsAccessManager", abi.encode(deployer));
        vm.serializeBytes(o, "argsHook", args);
        string memory json = vm.serializeUint(o, "deployBlock", deployBlock);
        _write("hook", json);
    }
}
