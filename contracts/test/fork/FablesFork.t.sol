// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IAccessManager} from "@openzeppelin/contracts/access/manager/IAccessManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {ClimFeeMath} from "../../src/libraries/ClimFeeMath.sol";
import {ISymmetricPokeHook} from "../../src/v2/interfaces/IOverrideFeeHook.sol";

/// @notice Runs against Fables' deployed ETH/USDG hook on a fork of Robinhood Chain mainnet (nothing is sent to
///         mainnet). Proves that a ClimPoker granted FEE_POKER drives the real hook within its bounds, composes with
///         an event override, stops when the desk is blind, and stops for good when the role is revoked.
contract FablesForkTest is Test {
    address internal constant HOOK = 0x06a889870C8f83640D6816319f72e2aA579b6080;
    address internal constant ACCESS_MANAGER = 0xA362D98B33A7bb5B5E2180a05f995A70FB404f30;
    address internal constant POKER_ADMIN = 0x359856655934338d798F9ccE1f181486301D36a5;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    bytes32 internal constant POOL_ID = 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551;
    uint64 internal constant FEE_POKER = 1;
    uint32 internal constant SIGMA_48 = 85_475;
    uint32 internal constant SIGMA_1000 = 1_780_730;
    uint32 internal constant ETA_E4 = 25_093;
    uint32 internal constant SQRT_HALF_DT_E6 = 707_107;

    address internal forwarder = makeAddr("forwarder");
    address internal operator = makeAddr("operator");
    address internal keeper = makeAddr("fablesKeeper");
    RiskDeskV2 internal desk;
    ClimFeePolicy internal policy;
    ClimPoker internal poker;
    uint40 internal t0;

    function setUp() public {
        string memory rpc = vm.envOr("RH_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        t0 = uint40(block.timestamp);
        desk = new RiskDeskV2(forwarder, operator);
        policy = new ClimFeePolicy(
            desk,
            ClimFeePolicy.Params({
                etaE4: ETA_E4,
                sqrtHalfDtE6: SQRT_HALF_DT_E6,
                floorPips: 700,
                capPips: 6_000,
                safePips: 3_000,
                tauKillSec: 180,
                shortWindow: false,
                dirSlopeE4: 0,
                dirMaxPremiumPips: 0,
                ethIsToken0: true
            })
        );
        poker = new ClimPoker(policy, HOOK, POOL_ID, false, 600, address(this));
        poker.setEventKeeper(keeper);
        vm.prank(POKER_ADMIN);
        IAccessManager(ACCESS_MANAGER).grantRole(FEE_POKER, address(poker), 0);
    }

    function _report(uint32 sigma) internal {
        vm.prank(forwarder, operator);
        desk.onReport("", abi.encode(uint40(block.timestamp), sigma, sigma, int32(0), uint16(3), uint8(4), uint16(10_000)));
    }

    function _expected(uint32 sigma) internal pure returns (uint24) {
        return ClimFeeMath.feePips(sigma, ETA_E4, SQRT_HALF_DT_E6, 10_000, 700, 6_000);
    }

    function _key() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDG),
            fee: 0x800000,
            tickSpacing: 10,
            hooks: IHooks(HOOK)
        });
    }

    function test_PoolKeyMatchesThePoolId() public pure {
        assertEq(PoolId.unwrap(_key().toId()), POOL_ID);
    }

    function test_PokeSetsTheRealHooksFee() public {
        _report(SIGMA_48);
        poker.poke();
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), _expected(SIGMA_48));
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, false), _expected(SIGMA_48));
    }

    function test_StormRaisesTheFee() public {
        // a first report gets only the absolute bounds, so a storm shows at once (later ones move at most x2)
        _report(SIGMA_1000 / 2);
        poker.poke();
        uint24 fee = ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true);
        assertEq(fee, _expected(SIGMA_1000 / 2));
        assertGt(fee, 700);
        assertLe(fee, 6_000);
    }

    function test_OverrideExpiresBackToFablesFlatFee() public {
        _report(SIGMA_48);
        poker.poke();
        vm.warp(block.timestamp + 600);
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), 700);
    }

    function test_BlindDeskDoesNotPoke() public {
        _report(SIGMA_48);
        vm.warp(block.timestamp + 181);
        vm.expectRevert(ClimPoker.DeskBlind.selector);
        poker.poke();
    }

    function test_EventOverrideOnTop() public {
        _report(SIGMA_48);
        vm.prank(keeper);
        poker.postEvent(6_000, 6_000, uint40(block.timestamp + 300));
        poker.poke();
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), 6_000);
    }

    function test_RevokedRoleStopsPokes() public {
        _report(SIGMA_48);
        vm.prank(POKER_ADMIN);
        IAccessManager(ACCESS_MANAGER).revokeRole(FEE_POKER, address(poker));
        vm.expectRevert();
        poker.poke();
    }

    function test_ASwapPaysThePokedFee() public {
        _report(SIGMA_1000 / 2);
        poker.poke();
        uint24 expected = ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true);
        PoolSwapTest router = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        vm.deal(address(this), 1 ether);
        vm.recordLogs();
        router.swap{value: 0.01 ether}(
            _key(),
            SwapParams({zeroForOne: true, amountSpecified: -0.01 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint24 paid;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == POOL_MANAGER && logs[i].topics[0] == IPoolManager.Swap.selector) {
                (,,,,, paid) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
            }
        }
        assertEq(paid, expected);
    }

    receive() external payable {}
}
