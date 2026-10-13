// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IAccessManaged} from "@openzeppelin/contracts/access/manager/IAccessManaged.sol";

import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";

contract PokeFeeHookTest is Deployers {
    uint64 internal constant FEE_POKER = 1;
    uint40 internal constant T0 = 1_760_000_000;
    address internal constant HOOK_ADDRESS =
        address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) ^ (0x5555 << 144));

    AccessManager internal am;
    PokeFeeHook internal hook;
    PoolId internal id;
    address internal poker = makeAddr("poker");

    function setUp() public {
        vm.warp(T0);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        am = new AccessManager(address(this));
        deployCodeTo("PokeFeeHook.sol:PokeFeeHook", abi.encode(manager, address(am)), HOOK_ADDRESS);
        hook = PokeFeeHook(HOOK_ADDRESS);
        bytes4[] memory sel = new bytes4[](3);
        sel[0] = bytes4(keccak256("pokeFee(bytes32,uint24,uint40)"));
        sel[1] = bytes4(keccak256("pokeFee(bytes32,uint24,uint24,uint40)"));
        sel[2] = PokeFeeHook.clearPoke.selector;
        am.setTargetFunctionRole(address(hook), sel, FEE_POKER);
        am.grantRole(FEE_POKER, poker, 0);
        (key, id) =
            initPool(currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, 10, SQRT_PRICE_1_1);
        hook.setPoolConfig(key, 100, 700, 6_000);
        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(10),
                tickUpper: TickMath.maxUsableTick(10),
                liquidityDelta: 1e21,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _swapFee(bool zeroForOne) internal returns (uint24 fee) {
        vm.recordLogs();
        swap(key, zeroForOne, -1e15, ZERO_BYTES);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == IPoolManager.Swap.selector) {
                (,,,,, fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return fee;
            }
        }
        revert("no Swap event");
    }

    function _id() internal view returns (bytes32) {
        return PoolId.unwrap(id);
    }

    function test_FlatFeeWithoutPoke() public {
        assertEq(hook.currentFee(_id(), true), 700);
        assertEq(_swapFee(true), 700);
    }

    function test_SymmetricPokeIsCharged() public {
        vm.prank(poker);
        hook.pokeFee(_id(), 2_500, 600);
        assertEq(_swapFee(true), 2_500);
        assertEq(_swapFee(false), 2_500);
    }

    function test_DirectionalPokeIsChargedPerSide() public {
        vm.prank(poker);
        hook.pokeFee(_id(), 900, 3_000, 600);
        assertEq(_swapFee(true), 900);
        assertEq(_swapFee(false), 3_000);
    }

    function test_PokeBelowHalfTheFlatIsRaisedToIt() public {
        vm.prank(poker);
        hook.pokeFee(_id(), 200, 600);
        assertEq(hook.currentFee(_id(), true), 350);
    }

    function test_PokeExpiresBackToFlat() public {
        vm.prank(poker);
        hook.pokeFee(_id(), 2_500, 600);
        vm.warp(T0 + 600);
        assertEq(hook.currentFee(_id(), true), 700);
    }

    function test_ClearPoke() public {
        vm.startPrank(poker);
        hook.pokeFee(_id(), 2_500, 600);
        hook.clearPoke(_id());
        vm.stopPrank();
        assertEq(hook.currentFee(_id(), false), 700);
    }

    function test_RevertWhen_OutOfBoundsOrBadTtl() public {
        vm.startPrank(poker);
        vm.expectRevert(abi.encodeWithSelector(PokeFeeHook.FeeOutOfBounds.selector, uint24(6_001)));
        hook.pokeFee(_id(), 6_001, 600);
        vm.expectRevert(abi.encodeWithSelector(PokeFeeHook.FeeOutOfBounds.selector, uint24(99)));
        hook.pokeFee(_id(), 99, 600);
        vm.expectRevert(abi.encodeWithSelector(PokeFeeHook.InvalidTtl.selector, uint40(0)));
        hook.pokeFee(_id(), 1_000, 0);
        vm.expectRevert(abi.encodeWithSelector(PokeFeeHook.InvalidTtl.selector, uint40(72 hours + 1)));
        hook.pokeFee(_id(), 1_000, 72 hours + 1);
        vm.stopPrank();
    }

    function test_RevertWhen_CallerLacksTheRole() public {
        vm.expectRevert();
        vm.prank(makeAddr("stranger"));
        hook.pokeFee(_id(), 1_000, 600);
    }

    function test_EmitsFablesCompatibleEvents() public {
        vm.expectEmit(true, false, false, true, address(hook));
        emit PokeFeeHook.FeePoked(_id(), 2_500, uint40(T0 + 600));
        vm.prank(poker);
        hook.pokeFee(_id(), 2_500, 600);
    }

    function test_EmitsTheDirectionalEvent() public {
        vm.expectEmit(true, false, false, true, address(hook));
        emit PokeFeeHook.FeePoked(_id(), 900, 3_000, uint40(T0 + 600));
        vm.prank(poker);
        hook.pokeFee(_id(), 900, 3_000, 600);
    }

    /// @dev Same topic0 as Fables' hooks, so one indexer reads both.
    function test_EventTopicsMatchFablesSignatures() public {
        vm.recordLogs();
        vm.startPrank(poker);
        hook.pokeFee(_id(), 2_500, 600);
        hook.pokeFee(_id(), 900, 3_000, 600);
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        assertEq(logs[0].topics[0], keccak256("FeePoked(bytes32,uint24,uint40)"));
        assertEq(logs[1].topics[0], keccak256("FeePoked(bytes32,uint24,uint24,uint40)"));
        assertEq(logs[0].topics[1], _id());
    }

    function test_RevertWhen_AStrangerConfiguresAPool() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, stranger));
        hook.setPoolConfig(key, 100, 700, 6_000);
    }

    function test_RevertWhen_PoolConfigIsInvalid() public {
        vm.expectRevert(PokeFeeHook.InvalidConfig.selector);
        hook.setPoolConfig(key, 0, 700, 6_000);
        vm.expectRevert(PokeFeeHook.InvalidConfig.selector);
        hook.setPoolConfig(key, 800, 700, 6_000);
        vm.expectRevert(PokeFeeHook.InvalidConfig.selector);
        hook.setPoolConfig(key, 100, 700, 600);
        vm.expectRevert(PokeFeeHook.InvalidConfig.selector);
        hook.setPoolConfig(key, 100, 700, uint24(LPFeeLibrary.MAX_LP_FEE) + 1);
    }

    function test_RevertWhen_PoolKeyUsesAnotherHook() public {
        PoolKey memory other = key;
        other.hooks = IHooks(makeAddr("otherHook"));
        vm.expectRevert(PokeFeeHook.InvalidConfig.selector);
        hook.setPoolConfig(other, 100, 700, 6_000);
    }

    function test_RevertWhen_PoolIsNotConfigured() public {
        (PoolKey memory k2,) =
            initPool(currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, SQRT_PRICE_1_1);
        vm.expectRevert();
        swap(k2, true, -1e15, ZERO_BYTES);
    }
}
