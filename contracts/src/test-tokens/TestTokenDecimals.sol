// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TestToken} from "./TestToken.sol";

/// @title TestTokenDecimals
/// @notice TestToken with chosen decimals, for clim's live reference pools on Robinhood Chain testnet: tETH (18) and
///         tUSDG (6, like Fables' USDG). Owner mint and public faucet as in TestToken. Testnet only.
contract TestTokenDecimals is TestToken {
    uint8 private immutable i_decimals;

    constructor(string memory name_, string memory symbol_, address owner_, uint256 faucetAmount_, uint8 decimals_)
        TestToken(name_, symbol_, owner_, faucetAmount_)
    {
        i_decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return i_decimals;
    }
}
