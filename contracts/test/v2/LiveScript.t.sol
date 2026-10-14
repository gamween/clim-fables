// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiveScript} from "../../script/v2/base/LiveScript.sol";

contract LiveScriptHarness is LiveScript {}

/// @dev Expected values: floor(sqrt(price x 2^192)) computed with Python's math.isqrt; the tick is
///      floor(ln(raw price) / ln(1.0001)), with raw price 2500 x 1e6 / 1e18 = 2.5e-9 (USDG units per wei).
contract LiveScriptTest is Test {
    LiveScriptHarness internal s = new LiveScriptHarness();

    function test_EthToken0_18And6Decimals() public view {
        uint160 p = s.sqrtPriceX96FromEthUsd(2500, true, 18, 6);
        assertEq(p, 3_961_408_125_713_216_879_677_197);
        assertEq(TickMath.getTickAtSqrtPrice(p), -198_080);
    }

    function test_UsdToken0_18And6Decimals() public view {
        uint160 p = s.sqrtPriceX96FromEthUsd(2500, false, 18, 6);
        assertEq(p, 1_584_563_250_285_286_751_870_879_006_720_000);
        assertEq(TickMath.getTickAtSqrtPrice(p), 198_079);
    }

    function test_SameDecimalsIsTheHumanPrice() public view {
        assertEq(s.sqrtPriceX96FromEthUsd(2500, true, 18, 18), 3_961_408_125_713_216_879_677_197_516_800);
    }

    function test_RevertWhen_PriceOutOfRange() public {
        vm.expectRevert(bytes("LiveScript: INIT_ETH_USD out of range"));
        s.sqrtPriceX96FromEthUsd(0, true, 18, 6);
    }
}
