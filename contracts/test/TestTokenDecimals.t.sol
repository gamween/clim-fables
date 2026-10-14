// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TestTokenDecimals} from "../src/test-tokens/TestTokenDecimals.sol";

contract TestTokenDecimalsTest is Test {
    TestTokenDecimals internal usdg;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

    function setUp() public {
        usdg = new TestTokenDecimals("clim test USDG", "tUSDG", owner, 25_000e6, 6);
    }

    function test_DecimalsAndMetadata() public view {
        assertEq(usdg.decimals(), 6);
        assertEq(usdg.symbol(), "tUSDG");
        assertEq(usdg.faucetAmount(), 25_000e6);
        assertEq(usdg.owner(), owner);
    }

    function test_EighteenDecimalsToo() public {
        TestTokenDecimals eth = new TestTokenDecimals("clim test ETH", "tETH", owner, 10e18, 18);
        assertEq(eth.decimals(), 18);
    }

    function test_FaucetAndOwnerMint() public {
        vm.prank(alice);
        usdg.faucet();
        assertEq(usdg.balanceOf(alice), 25_000e6);
        vm.prank(owner);
        usdg.mint(alice, 1e6);
        assertEq(usdg.balanceOf(alice), 25_001e6);
    }

    function test_RevertWhen_StrangerMints() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        usdg.mint(alice, 1);
    }
}
