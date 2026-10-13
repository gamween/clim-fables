// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRiskDeskV2} from "../../../src/v2/interfaces/IRiskDeskV2.sol";

/// @notice Settable desk state for policy and poker tests.
contract MockDeskV2 is IRiskDeskV2 {
    uint40 public tObs;
    uint32 public sigma15E9;
    uint32 public sigma5E9;
    int32 public devPips;
    uint16 public kE4 = 10_000;
    uint8 public flags;
    uint32 public seq;

    function set(uint40 tObs_, uint32 s15, uint32 s5, int32 dev, uint8 flags_) external {
        tObs = tObs_;
        sigma15E9 = s15;
        sigma5E9 = s5;
        devPips = dev;
        flags = flags_;
        seq += 1;
    }

    function setK(uint16 k) external {
        kE4 = k;
    }

    function state() external view returns (uint40, uint32, uint32, int32, uint16, uint8, uint32) {
        return (tObs, sigma15E9, sigma5E9, devPips, kE4, flags, seq);
    }
}
