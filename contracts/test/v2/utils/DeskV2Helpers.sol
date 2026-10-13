// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DeskHelpers} from "../../utils/DeskHelpers.sol";
import {RiskDeskV2} from "../../../src/v2/RiskDeskV2.sol";

/// @notice Report encoding and delivery for RiskDeskV2, the way MockKeystoneForwarder delivers.
abstract contract DeskV2Helpers is DeskHelpers {
    function _reportV2(uint40 tObs, uint32 s15, uint32 s5, int32 devPips, uint16 dispBp, uint8 nSources, uint16 kE4)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(tObs, s15, s5, devPips, dispBp, nSources, kE4);
    }

    /// @dev Healthy report: both windows at `sigmaE9`, 4 venues, 3 bp dispersion, k = 1.
    function _reportV2(uint40 tObs, uint32 sigmaE9, int32 devPips) internal pure returns (bytes memory) {
        return _reportV2(tObs, sigmaE9, sigmaE9, devPips, 3, 4, 10_000);
    }

    function _deliverV2(RiskDeskV2 desk, bytes memory report) internal {
        vm.prank(forwarder, operator);
        desk.onReport("", report);
    }
}
