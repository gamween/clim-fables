# clim × Fables plan 02: contracts and the fork run

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the on-chain side of clim × Fables: `RiskDeskV2` (data), `ClimFeePolicy` (immutable parameters from the lab), `ClimPoker` (calls Fables' `pokeFee`), an independent `PokeFeeHook` (written from Fables' published ABI) for our testnet pools, fork tests against Fables' real ETH/USDG hook on Robinhood Chain mainnet, and a recorded run (`npm run demo:fork`).

**Architecture:** Data, policy and action are three contracts with one job each. `ClimPoker` holds Fables' FEE_POKER role, is governed by Fables' own AccessManager (only roles Fables grants can call it; clim holds no admin power), and talks to Fables' hook through interfaces written from Fables' published ABI only. Everything is checked on an anvil fork of Robinhood Chain mainnet; nothing is sent to mainnet.

**Tech Stack:** Foundry (solc 0.8.26, cancun), Uniswap v4 core and periphery, OpenZeppelin Contracts 5.5 (`AccessManaged`, `AccessManager`), OpenZeppelin uniswap-hooks (`BaseOverrideFee`), the vendored Chainlink `ReceiverTemplate`.

Spec: `docs/superpowers/specs/2026-10-13-clim-fables-design.md` §5.3, §5.4, §5.7, §5.8. Depends on plan 01 for `shared/params-fables.json` (Task 9 only).

---

## Facts used by this plan

Robinhood Chain mainnet (4663), read on 2026-10-13:

| Item | Value |
|---|---|
| Fables ETH/USDG hook (FablesRampETH) | `0x06a889870C8f83640D6816319f72e2aA579b6080` |
| Its AccessManager | `0xA362D98B33A7bb5B5E2180a05f995A70FB404f30` |
| FEE_POKER role id | `1` (label "FEE_POKER"); POKER_ADMIN is role `5`, ADMIN role `0` |
| POKER_ADMIN and ADMIN holder | `0x359856655934338d798F9ccE1f181486301D36a5` |
| Fables' keeper (FEE_POKER holder on ETH/USDG) | `0x1B6a8808E1D26dba66bA11E52997803C43CAd429` |
| ETH/USDG PoolId | `0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551` |
| ETH/USDG PoolKey | currency0 `address(0)` (native ETH), currency1 USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, fee `0x800000` (dynamic), tickSpacing `10`, hooks = the hook above |
| Pool config | floor 100 pips, flat 700 pips, cap 6,000 pips; under an override the hook charges `max(poke, max(floor, flat × 50 %))`, capped |
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| CLIM_RUNNER role id | none yet: a new role Fables would create for who may call `ClimPoker.poke()`; `7` in the tests and the run |
| Fork block for the fork suite | `87_780_000` (2026-10-13 19:59 UTC), pinned so runs are reproducible |

Fables' published ABI (verified source on Sourcify; signatures only, no code copied):
- old generation (ETH/USDG): `pokeFee(bytes32 poolId, uint24 fee, uint40 ttl)` selector `0x8aebf0c1`; `clearPoke(bytes32)` `0x5f4934a8`; `currentFee(bytes32 poolId, bool zeroForOne) view returns (uint24)` `0x15452022`; events `FeePoked(bytes32 indexed poolId, uint24 fee, uint40 expiry)`, `PokeCleared(bytes32 indexed poolId)`, `PoolConfigured(bytes32 indexed poolId, uint24 floorPips, uint24 flatPips, uint24 maxFee)`.
- new generation: `pokeFee(bytes32 poolId, uint24 fee0For1, uint24 fee1For0, uint40 ttl)` selector `0x3f740010`; event `FeePoked(bytes32 indexed poolId, uint24 fee0For1, uint24 fee1For0, uint40 expiry)`.
- `pokeFee` reverts above the cap, below the floor, or with a TTL of 0 or above 72 h.
- `setPoolConfig((address,address,uint24,int24,address),uint24,uint24,uint24)` (PoolKey, floor, flat, max fee), callable by Fables' admin; a poke outside the band reverts with custom error `0x652853ee` (selector observed on the fork).
- AccessManager: `grantRole(uint64,address,uint32)` selector `0x25c471a0`; `setTargetFunctionRole(address,bytes4[],uint64)`; `labelRole(uint64,string)`.

Direction convention used everywhere: `devPips` = (venue price − pool price) / pool price × 1e6. A positive gap means the pool is cheap: buyers of ETH are the toxic side, and they swap one-for-zero (they pay USDG, currency1). So a positive gap puts the premium on `fee1For0` when ETH is currency0 (ETH/USDG); `ClimFeePolicy.Params.ethIsToken0 = false` flips it to `fee0For1` for a pool where ETH is currency1.

Environment: `RH_MAINNET_RPC_URL` (an archive RPC, e.g. Alchemy `https://robinhood-mainnet.g.alchemy.com/v2/<key>`) in `contracts/.env`. Fork tests skip when it is unset.

## File structure

| File | Responsibility |
|---|---|
| `contracts/src/v2/interfaces/IRiskDeskV2.sol` | Read side of the v2 desk and its event |
| `contracts/src/v2/RiskDeskV2.sol` | Stores sigma 15 min, sigma 5 min and the venue-pool gap from CRE reports, with v1's guards |
| `contracts/src/v2/ClimFeePolicy.sol` | Immutable parameters; `quote()` and `quoteDirectional()` from the desk |
| `contracts/src/v2/interfaces/IOverrideFeeHook.sol` | `ISymmetricPokeHook` and `IDirectionalPokeHook`, from Fables' published ABI |
| `contracts/src/v2/ClimPoker.sol` | Holds FEE_POKER, governed by Fables' AccessManager; composes the desk's fee with the keeper's event override and calls `pokeFee` |
| `contracts/src/v2/PokeFeeHook.sol` | Independent v4 hook with the same public override interface (from the published ABI), for our testnet pools |
| `contracts/test/v2/utils/DeskV2Helpers.sol` | Report encoding and delivery for v2 tests |
| `contracts/test/v2/mocks/MockDeskV2.sol`, `MockPokeHook.sol` | Test doubles |
| `contracts/test/v2/*.t.sol` | Unit tests |
| `contracts/test/fork/FablesFork.t.sol` | Fork tests against Fables' real hook |
| `contracts/script/v2/ForkRun.s.sol`, `contracts/script/v2/fork-run.sh` | The recorded run |
| `lab/scripts/export_fork_reports.py` | Desk reports for the run window, from the lab data |

All `forge` commands run from `contracts/`.

---

### Task 1: Foundry configuration for Robinhood Chain

**Files:**
- Modify: `contracts/foundry.toml`
- Modify: `contracts/.env.example`

- [ ] **Step 1: Add the endpoints and the evidence write permission**

In `contracts/foundry.toml`, replace the `fs_permissions` block and the `[rpc_endpoints]` block with:

```toml
fs_permissions = [
  { access = "read", path = "../shared" },
  { access = "write", path = "../shared/deployments" },
  { access = "read-write", path = "./deployments" },
  { access = "read", path = "./test/fixtures" },
  { access = "read-write", path = "../docs/evidence" },
]
```

```toml
[rpc_endpoints]
sepolia = "${SEPOLIA_RPC_URL}"
robinhood = "${RH_MAINNET_RPC_URL}"
robinhood_testnet = "${RH_TESTNET_RPC_URL}"
anvil = "http://127.0.0.1:8545"
```

Append, so `forge fmt --check` leaves the vendored Chainlink receiver and the fixtures byte-identical to upstream:

```toml
[fmt]
# vendored code (Chainlink cre-templates) and fixtures keep their upstream formatting
ignore = ["src/receiver/*.sol", "test/fixtures/**"]
```

- [ ] **Step 2: Document the variables**

Append to `contracts/.env.example`:

```bash
# Robinhood Chain mainnet, read only (fork tests and the fork run). An archive RPC is needed to fork a past block.
RH_MAINNET_RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/<key>
# Robinhood Chain testnet (chain 46630), used by plan 03.
RH_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
```

- [ ] **Step 3: Check the build still passes**

Run: `forge build -q && forge test -q 2>&1 | tail -2`
Expected: `73 tests passed, 0 failed, 2 skipped`.

- [ ] **Step 4: Commit**

```bash
git add contracts/foundry.toml contracts/.env.example
git commit -m "chore(contracts): Robinhood Chain endpoints and evidence write permission"
```

### Task 2: `RiskDeskV2`

**Files:**
- Create: `contracts/src/v2/interfaces/IRiskDeskV2.sol`
- Create: `contracts/src/v2/RiskDeskV2.sol`
- Modify: `contracts/src/receiver/ReceiverTemplate.sol` (`setForwarderAddress` becomes `public`)
- Create: `contracts/test/v2/utils/DeskV2Helpers.sol`
- Test: `contracts/test/v2/RiskDeskV2.t.sol`

- [ ] **Step 1: Write the interface**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRiskDeskV2
/// @notice Read side of the clim x Fables risk desk: two volatility windows and the venue-versus-pool price gap,
///         published by a Chainlink CRE workflow.
interface IRiskDeskV2 {
    /// @param seq Report counter, starts at 1.
    /// @param tObs DON observation time (unix seconds).
    /// @param sigma15Applied 15-minute realized volatility after the envelope, per sqrt-second, times 1e9.
    /// @param sigma5Applied 5-minute realized volatility after the envelope, per sqrt-second, times 1e9.
    /// @param sigma15Reported 15-minute volatility as reported.
    /// @param sigma5Reported 5-minute volatility as reported.
    /// @param devPips (venue price - pool price) / pool price, times 1e6, clamped to +-1e6.
    /// @param dispBp Venue dispersion in basis points.
    /// @param nSources Venues that passed the freshness filter.
    /// @param kE4 Model-risk multiplier applied, times 1e4 (clamped to [10_000, 20_000]).
    /// @param flags State flags after this report (bit 0: degraded, the venues disagree beyond DISP_MAX_BP).
    event RiskReportedV2(
        uint32 indexed seq,
        uint40 tObs,
        uint32 sigma15Applied,
        uint32 sigma5Applied,
        uint32 sigma15Reported,
        uint32 sigma5Reported,
        int32 devPips,
        uint16 dispBp,
        uint8 nSources,
        uint16 kE4,
        uint8 flags
    );

    /// @notice Latest accepted state, packed in one storage slot.
    function state()
        external
        view
        returns (uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 kE4, uint8 flags, uint32 seq);
}
```

- [ ] **Step 2: Write the test helpers**

```solidity
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
```

- [ ] **Step 3: Write the failing tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";
import {IRiskDeskV2} from "../../src/v2/interfaces/IRiskDeskV2.sol";
import {FLAG_DEGRADED} from "../../src/interfaces/IRiskDesk.sol";
import {ReceiverTemplate} from "../../src/receiver/ReceiverTemplate.sol";
import {DeskV2Helpers} from "./utils/DeskV2Helpers.sol";

contract RiskDeskV2Test is DeskV2Helpers {
    RiskDeskV2 internal desk;
    address internal prodForwarder = makeAddr("keystoneForwarder");

    function setUp() public {
        vm.warp(T0);
        desk = new RiskDeskV2(forwarder, operator);
    }

    function test_StartsEmpty() public view {
        (uint40 tObs, uint32 s15, uint32 s5, int32 dev, uint16 k, uint8 flags, uint32 seq) = desk.state();
        assertEq(tObs, 0);
        assertEq(s15, 0);
        assertEq(s5, 0);
        assertEq(dev, 0);
        assertEq(k, 0);
        assertEq(flags, 0);
        assertEq(seq, 0);
        assertTrue(desk.simMode());
    }

    function test_AcceptsAReportAndStoresEveryField() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_100, SIGMA_48, -1_234, 3, 4, 12_000));
        (uint40 tObs, uint32 s15, uint32 s5, int32 dev, uint16 k, uint8 flags, uint32 seq) = desk.state();
        assertEq(tObs, T0);
        assertEq(s15, SIGMA_100);
        assertEq(s5, SIGMA_48);
        assertEq(dev, -1_234);
        assertEq(k, 12_000);
        assertEq(flags, 0);
        assertEq(seq, 1);
    }

    function test_EmitsRiskReportedV2() public {
        vm.expectEmit(true, false, false, true, address(desk));
        emit IRiskDeskV2.RiskReportedV2(1, T0, SIGMA_100, SIGMA_48, SIGMA_100, SIGMA_48, 50, 3, 4, 10_000, 0);
        _deliverV2(desk, _reportV2(T0, SIGMA_100, SIGMA_48, 50, 3, 4, 10_000));
    }

    function test_EmitsTheDegradedFlag() public {
        vm.expectEmit(true, false, false, true, address(desk));
        emit IRiskDeskV2.RiskReportedV2(1, T0, SIGMA_48, SIGMA_48, SIGMA_48, SIGMA_48, 0, 26, 4, 10_000, FLAG_DEGRADED);
        _deliverV2(desk, _reportV2(T0, SIGMA_48, SIGMA_48, 0, 26, 4, 10_000));
    }

    function test_EnvelopeAppliesToEachWindowSeparately() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_100, SIGMA_48, 0, 3, 4, 10_000));
        vm.warp(T0 + 30);
        _deliverV2(desk, _reportV2(T0 + 30, SIGMA_10, SIGMA_300, 0, 3, 4, 10_000));
        (, uint32 s15, uint32 s5,,,,) = desk.state();
        assertEq(s15, (SIGMA_100 * 8) / 10); // falls at most to 80 %
        assertEq(s5, SIGMA_48 * 2); // rises at most x2
    }

    function test_DevIsClamped() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, 2_000_000));
        (,,, int32 dev,,,) = desk.state();
        assertEq(dev, 1_000_000);
        vm.warp(T0 + 30);
        _deliverV2(desk, _reportV2(T0 + 30, SIGMA_48, -2_000_000));
        (,,, dev,,,) = desk.state();
        assertEq(dev, -1_000_000);
    }

    function test_DegradedWhenVenuesDisagree() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, SIGMA_48, 0, 26, 4, 10_000));
        (,,,,, uint8 flags,) = desk.state();
        assertEq(flags, FLAG_DEGRADED);
    }

    function test_KIsClamped() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, SIGMA_48, 0, 3, 4, 5_000));
        (,,,, uint16 k,,) = desk.state();
        assertEq(k, 10_000);
    }

    function test_RevertWhen_TooSoon() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, 0));
        vm.expectRevert(abi.encodeWithSelector(RiskDeskV2.StaleReport.selector, T0 + 19, T0));
        _deliverV2(desk, _reportV2(T0 + 19, SIGMA_48, 0));
    }

    function test_RevertWhen_FromTheFuture() public {
        vm.expectRevert(abi.encodeWithSelector(RiskDeskV2.FutureReport.selector, T0 + 31, uint256(T0)));
        _deliverV2(desk, _reportV2(T0 + 31, SIGMA_48, 0));
    }

    function test_RevertWhen_TooFewSources() public {
        vm.expectRevert(abi.encodeWithSelector(RiskDeskV2.TooFewSources.selector, uint8(2)));
        _deliverV2(desk, _reportV2(T0, SIGMA_48, SIGMA_48, 0, 3, 2, 10_000));
    }

    function test_RevertWhen_SimOriginIsNotTheOperator() public {
        vm.prank(forwarder, attacker);
        vm.expectRevert(abi.encodeWithSelector(RiskDeskV2.NotSimOperator.selector, attacker));
        desk.onReport("", _reportV2(T0, SIGMA_48, 0));
    }

    function test_RevertWhen_NotTheForwarder() public {
        vm.prank(attacker, operator);
        vm.expectRevert();
        desk.onReport("", _reportV2(T0, SIGMA_48, 0));
    }

    function test_AcceptsAReportExactlyMinGapLater() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_48, 0));
        vm.warp(T0 + 20);
        _deliverV2(desk, _reportV2(T0 + 20, SIGMA_48, 0));
        (uint40 tObs,,,,,, uint32 seq) = desk.state();
        assertEq(tObs, T0 + 20);
        assertEq(seq, 2);
    }

    function test_AcceptsAReportExactlyMaxSkewAhead() public {
        _deliverV2(desk, _reportV2(T0 + 30, SIGMA_48, 0));
        (uint40 tObs,,,,,,) = desk.state();
        assertEq(tObs, T0 + 30);
    }

    function test_FirstReportIsClampedToTheAbsoluteBounds() public {
        _deliverV2(desk, _reportV2(T0, type(uint32).max, 1, 0, 3, 4, 10_000));
        (, uint32 s15, uint32 s5,,,,) = desk.state();
        assertEq(s15, desk.SIGMA_MAX_E9());
        assertEq(s5, desk.SIGMA_MIN_E9());
    }

    function test_ReportAfterAnOutageIsTakenAsIs() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_10, 0));
        // more than RESET_GAP later: the measurement is not ramped from a stale value
        uint40 t = T0 + desk.RESET_GAP() + 1;
        vm.warp(t);
        _deliverV2(desk, _reportV2(t, SIGMA_300, 0));
        (, uint32 s15,,,,,) = desk.state();
        assertEq(s15, SIGMA_300);
    }

    function test_ReportExactlyResetGapLaterIsStillRamped() public {
        _deliverV2(desk, _reportV2(T0, SIGMA_10, 0));
        uint40 t = T0 + desk.RESET_GAP();
        vm.warp(t);
        _deliverV2(desk, _reportV2(t, SIGMA_300, 0));
        (, uint32 s15,,,,,) = desk.state();
        assertEq(s15, SIGMA_10 * 2);
    }

    /// @dev Applied sigma stays in the absolute bounds, and inside x0.8 / x2 of the previous one unless RESET_GAP passed.
    function testFuzz_AppliedSigmaStaysInTheEnvelope(uint32 first, uint32 second, uint40 gap) public {
        gap = uint40(bound(gap, 20, 600));
        _deliverV2(desk, _reportV2(T0, first, 0));
        (, uint32 prev,,,,,) = desk.state();
        assertGe(prev, desk.SIGMA_MIN_E9());
        assertLe(prev, desk.SIGMA_MAX_E9());

        vm.warp(T0 + gap);
        _deliverV2(desk, _reportV2(T0 + gap, second, 0));
        (, uint32 next,,,,,) = desk.state();
        assertGe(next, desk.SIGMA_MIN_E9());
        assertLe(next, desk.SIGMA_MAX_E9());
        if (gap <= desk.RESET_GAP()) {
            assertGe(uint256(next), (uint256(prev) * 8) / 10);
            assertLe(uint256(next), uint256(prev) * 2);
        }
    }

    function test_DisableSimIsOwnerOnly() public {
        desk.setExpectedAuthor(makeAddr("workflowOwner"));
        vm.prank(attacker);
        vm.expectRevert();
        desk.disableSim(prodForwarder);
    }

    function test_RevertWhen_DisableSimWithoutAForwarder() public {
        desk.setExpectedAuthor(makeAddr("workflowOwner"));
        vm.expectRevert(ReceiverTemplate.InvalidForwarderAddress.selector);
        desk.disableSim(address(0));
    }

    function test_RevertWhen_DisableSimWithoutAPinnedWorkflow() public {
        vm.expectRevert(RiskDeskV2.WorkflowNotPinned.selector);
        desk.disableSim(prodForwarder);
        assertTrue(desk.simMode());
    }

    function test_DisableSimSwitchesToTheProductionForwarderAtOnce() public {
        desk.setExpectedWorkflowId(keccak256("workflow"));
        vm.expectEmit(address(desk));
        emit RiskDeskV2.SimDisabled(prodForwarder);
        desk.disableSim(prodForwarder);
        assertFalse(desk.simMode());
        assertEq(desk.getForwarderAddress(), prodForwarder);
        // the simulation forwarder is no longer trusted
        vm.prank(forwarder, operator);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, forwarder, prodForwarder));
        desk.onReport("", _reportV2(T0, SIGMA_48, 0));
    }

    function test_DisableSimAcceptsAPinnedAuthorAlone() public {
        desk.setExpectedAuthor(makeAddr("workflowOwner"));
        desk.disableSim(prodForwarder);
        assertFalse(desk.simMode());
    }
}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `forge test --match-path test/v2/RiskDeskV2.t.sol -q`
Expected: compilation error, `RiskDeskV2.sol` not found.

- [ ] **Step 5: Implement `RiskDeskV2`**

`disableSim(prodForwarder)` sets the production forwarder in the same call, so in the vendored `ReceiverTemplate.sol` change `setForwarderAddress` from `external` to `public` (no ABI change) and add above it the line `` ///      clim: `public` instead of upstream's `external`, so RiskDeskV2.disableSim() can set it in the same call. ``

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "../receiver/ReceiverTemplate.sol";
import {FLAG_DEGRADED} from "../interfaces/IRiskDesk.sol";
import {IRiskDeskV2} from "./interfaces/IRiskDeskV2.sol";

/// @title RiskDeskV2
/// @notice Stores what the clim CRE workflow measures for Fables' pool: 15-minute and 5-minute ETH realized
///         volatility and the venue-versus-pool price gap. Same guards as v1's RiskDesk: report spacing, clock skew,
///         a quorum of venues, a volatility envelope per window. The owner cannot set sigma or the gap directly, but
///         chooses which forwarder and workflow to trust (ReceiverTemplate), which decides what gets reported; so once
///         the desk is configured, ownership should go to a timelock or be renounced (see docs/security.md).
///         The owner can also end simulation mode for good, switching to the production forwarder in the same call.
contract RiskDeskV2 is ReceiverTemplate, IRiskDeskV2 {
    /// @notice ABI layout of the CRE report: abi.encode(uint40,uint32,uint32,int32,uint16,uint8,uint16).
    struct Report {
        uint40 tObs;
        uint32 sigma15E9;
        uint32 sigma5E9;
        int32 devPips;
        uint16 dispBp;
        uint8 nSources;
        uint16 kE4;
    }

    struct State {
        uint40 tObs;
        uint32 sigma15E9;
        uint32 sigma5E9;
        int32 devPips;
        uint16 kE4;
        uint8 flags;
        uint32 seq;
    }

    uint32 public constant SIGMA_MIN_E9 = 17_807; // 10 %/yr
    uint32 public constant SIGMA_MAX_E9 = 1_780_730; // 1000 %/yr
    uint16 public constant K_MIN_E4 = 10_000;
    uint16 public constant K_MAX_E4 = 20_000;
    uint16 public constant DISP_MAX_BP = 25;
    int32 public constant DEV_MAX_PIPS = 1_000_000;
    uint40 public constant MIN_GAP = 20;
    uint40 public constant MAX_SKEW = 30;
    uint8 public constant MIN_SOURCES = 3;
    /// @notice A report more than this after the last one restarts the envelope: after an outage the measurement is
    ///         taken as is (within the absolute bounds), not ramped from a stale value.
    uint40 public constant RESET_GAP = 180;

    /// @notice EOA allowed to originate reports while simulation mode is on (the `cre workflow simulate --broadcast` key).
    address public immutable simOperator;
    /// @notice True until disableSim() is called. MockKeystoneForwarder checks no signature, so tx.origin is the guard.
    bool public simMode;

    State private s_state;

    event SimDisabled(address forwarder);

    error ZeroSimOperator();
    error WorkflowNotPinned();
    error NotSimOperator(address origin);
    error StaleReport(uint40 tObs, uint40 lastTObs);
    error FutureReport(uint40 tObs, uint256 blockTimestamp);
    error TooFewSources(uint8 nSources);

    constructor(address forwarder, address simOperator_) ReceiverTemplate(forwarder) {
        if (simOperator_ == address(0)) revert ZeroSimOperator();
        simOperator = simOperator_;
        simMode = true;
    }

    /// @inheritdoc IRiskDeskV2
    function state()
        external
        view
        returns (uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 kE4, uint8 flags, uint32 seq)
    {
        State memory s = s_state;
        return (s.tObs, s.sigma15E9, s.sigma5E9, s.devPips, s.kE4, s.flags, s.seq);
    }

    /// @notice Irreversibly stops accepting reports on the sole basis of tx.origin, and in the same call trusts the
    ///         production forwarder, so the desk never accepts unsigned reports from the simulation forwarder without
    ///         the tx.origin guard. The workflow must already be pinned (expected workflow id or author).
    /// @param prodForwarder The production KeystoneForwarder, which verifies the DON's signatures.
    function disableSim(address prodForwarder) external onlyOwner {
        if (prodForwarder == address(0)) revert InvalidForwarderAddress();
        if (this.getExpectedWorkflowId() == bytes32(0) && this.getExpectedAuthor() == address(0)) {
            revert WorkflowNotPinned();
        }
        setForwarderAddress(prodForwarder);
        simMode = false;
        emit SimDisabled(prodForwarder);
    }

    function _processReport(bytes calldata report) internal override {
        Report memory r = abi.decode(report, (Report));
        State memory s = s_state;

        // solhint-disable-next-line avoid-tx-origin
        if (simMode && tx.origin != simOperator) revert NotSimOperator(tx.origin);
        if (s.seq != 0 && r.tObs < s.tObs + MIN_GAP) revert StaleReport(r.tObs, s.tObs);
        if (r.tObs > block.timestamp + MAX_SKEW) revert FutureReport(r.tObs, block.timestamp);
        if (r.nSources < MIN_SOURCES) revert TooFewSources(r.nSources);

        bool first = s.seq == 0 || r.tObs > s.tObs + RESET_GAP;
        State memory n = State({
            tObs: r.tObs,
            sigma15E9: _envelope(r.sigma15E9, s.sigma15E9, first),
            sigma5E9: _envelope(r.sigma5E9, s.sigma5E9, first),
            devPips: r.devPips > DEV_MAX_PIPS ? DEV_MAX_PIPS : (r.devPips < -DEV_MAX_PIPS ? -DEV_MAX_PIPS : r.devPips),
            kE4: r.kE4 < K_MIN_E4 ? K_MIN_E4 : (r.kE4 > K_MAX_E4 ? K_MAX_E4 : r.kE4),
            flags: r.dispBp > DISP_MAX_BP ? FLAG_DEGRADED : 0,
            seq: s.seq + 1
        });
        s_state = n;
        _emitReported(n, r);
    }

    /// @dev Separate frame keeps the 11-field event under the stack limit without via-IR.
    function _emitReported(State memory n, Report memory r) private {
        emit RiskReportedV2(
            n.seq,
            r.tObs,
            n.sigma15E9,
            n.sigma5E9,
            r.sigma15E9,
            r.sigma5E9,
            n.devPips,
            r.dispBp,
            r.nSources,
            n.kE4,
            n.flags
        );
    }

    /// @dev Volatility rises fast (x2 per report) and decays slowly (x0.8 per report); the first report, and the
    ///      first one after RESET_GAP of silence, only get the absolute bounds.
    function _envelope(uint32 reported, uint32 prev, bool first) internal pure returns (uint32) {
        uint256 lo = SIGMA_MIN_E9;
        uint256 hi = SIGMA_MAX_E9;
        if (!first) {
            uint256 down = (uint256(prev) * 8) / 10;
            uint256 up = uint256(prev) * 2;
            if (down > lo) lo = down;
            if (up < hi) hi = up;
        }
        if (reported < lo) return uint32(lo);
        if (reported > hi) return uint32(hi);
        return reported;
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `forge test --match-path test/v2/RiskDeskV2.t.sol -q`
Expected: `24 passed` (the envelope fuzz test runs 1,000 cases). The 11-field `RiskReportedV2` is emitted from its own `private` frame (`_emitReported`) to stay under the stack limit; do not enable via-IR (v1 builds without it).

- [ ] **Step 7: Commit**

```bash
git add contracts/src/v2/interfaces/IRiskDeskV2.sol contracts/src/v2/RiskDeskV2.sol contracts/test/v2
git commit -m "feat(contracts): RiskDeskV2 with two volatility windows and the venue-pool gap"
```

### Task 3: `ClimFeePolicy`

**Files:**
- Create: `contracts/src/v2/ClimFeePolicy.sol`
- Create: `contracts/test/v2/mocks/MockDeskV2.sol`
- Test: `contracts/test/v2/ClimFeePolicy.t.sol`

- [ ] **Step 1: Write the desk double**

```solidity
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
```

- [ ] **Step 2: Write the failing tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimFeeMath} from "../../src/libraries/ClimFeeMath.sol";
import {FLAG_DEGRADED} from "../../src/interfaces/IRiskDesk.sol";
import {MockDeskV2} from "./mocks/MockDeskV2.sol";

contract ClimFeePolicyTest is Test {
    uint40 internal constant T0 = 1_760_000_000;
    uint32 internal constant SIGMA_48 = 85_475;
    uint32 internal constant SIGMA_300 = 534_217;
    uint32 internal constant SIGMA_1000 = 1_780_730;
    uint32 internal constant ETA_E4 = 25_093;
    uint32 internal constant SQRT_HALF_DT_E6 = 707_107; // dt = 1 s

    MockDeskV2 internal desk;

    function setUp() public {
        vm.warp(T0);
        desk = new MockDeskV2();
    }

    function _params(bool shortWindow, uint32 slopeE4, uint24 maxPrem)
        internal
        pure
        returns (ClimFeePolicy.Params memory)
    {
        return _params(shortWindow, slopeE4, maxPrem, true);
    }

    function _params(bool shortWindow, uint32 slopeE4, uint24 maxPrem, bool ethIsToken0)
        internal
        pure
        returns (ClimFeePolicy.Params memory)
    {
        return ClimFeePolicy.Params({
            etaE4: ETA_E4,
            sqrtHalfDtE6: SQRT_HALF_DT_E6,
            floorPips: 700,
            capPips: 6_000,
            safePips: 3_000,
            tauKillSec: 180,
            shortWindow: shortWindow,
            dirSlopeE4: slopeE4,
            dirMaxPremiumPips: maxPrem,
            ethIsToken0: ethIsToken0
        });
    }

    function _fee(uint32 sigma) internal pure returns (uint24) {
        return ClimFeeMath.feePips(sigma, ETA_E4, SQRT_HALF_DT_E6, 10_000, 700, 6_000);
    }

    function test_CalmSitsAtTheFloor() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        desk.set(T0, SIGMA_48, SIGMA_48, 0, 0);
        (uint24 fee, uint8 mode) = p.quote();
        assertEq(fee, 700);
        assertEq(mode, p.MODE_NORMAL());
    }

    function test_StormFollowsTheChosenWindow() public {
        ClimFeePolicy long = new ClimFeePolicy(desk, _params(false, 0, 0));
        ClimFeePolicy short = new ClimFeePolicy(desk, _params(true, 0, 0));
        desk.set(T0, SIGMA_300, SIGMA_1000, 0, 0);
        (uint24 a,) = long.quote();
        (uint24 b,) = short.quote();
        assertEq(a, _fee(SIGMA_300));
        assertEq(b, _fee(SIGMA_1000));
        assertGt(b, a);
    }

    function test_BlindWhenSilentOrNeverReported() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        (uint24 fee, uint8 mode) = p.quote();
        assertEq(mode, p.MODE_BLIND());
        assertEq(fee, 3_000);
        desk.set(T0, SIGMA_48, SIGMA_48, 0, 0);
        vm.warp(T0 + 181);
        (fee, mode) = p.quote();
        assertEq(mode, p.MODE_BLIND());
    }

    function test_DegradedChargesAtLeastSafe() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        desk.set(T0, SIGMA_48, SIGMA_48, 0, FLAG_DEGRADED);
        (uint24 fee, uint8 mode) = p.quote();
        assertEq(mode, p.MODE_DEGRADED());
        assertEq(fee, 3_000);
    }

    function test_DirectionalPremiumOnTheToxicSide() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 5_000, 1_000));
        // venue 10 bp above the pool: buyers of ETH (one-for-zero) are toxic; premium = 0.5 * 1_000 pips = 500
        desk.set(T0, SIGMA_48, SIGMA_48, 1_000, 0);
        (uint24 f01, uint24 f10,) = p.quoteDirectional();
        assertEq(f01, 700);
        assertEq(f10, 1_200);
        // venue below the pool: sellers of ETH (zero-for-one) are toxic
        desk.set(T0, SIGMA_48, SIGMA_48, -1_000, 0);
        (f01, f10,) = p.quoteDirectional();
        assertEq(f01, 1_200);
        assertEq(f10, 700);
    }

    function test_DirectionalPremiumWhenEthIsToken1() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 5_000, 1_000, false));
        // ETH is currency1: buyers of ETH pay currency0, so they swap zero-for-one
        desk.set(T0, SIGMA_48, SIGMA_48, 1_000, 0);
        (uint24 f01, uint24 f10,) = p.quoteDirectional();
        assertEq(f01, 1_200);
        assertEq(f10, 700);
        // venue below the pool: sellers of ETH (one-for-zero) are toxic
        desk.set(T0, SIGMA_48, SIGMA_48, -1_000, 0);
        (f01, f10,) = p.quoteDirectional();
        assertEq(f01, 700);
        assertEq(f10, 1_200);
    }

    function test_LastObservationReadsTheDesk() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        desk.set(T0 - 7, SIGMA_48, SIGMA_48, 0, 0);
        desk.set(T0 - 3, SIGMA_48, SIGMA_48, 0, 0);
        (uint40 tObs, uint32 seq) = p.lastObservation();
        assertEq(tObs, T0 - 3);
        assertEq(seq, 2);
    }

    function test_FreshUntilTauKillThenBlind() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        desk.set(T0, SIGMA_48, SIGMA_48, 0, 0);
        vm.warp(T0 + 180);
        (uint24 fee, uint8 mode) = p.quote();
        assertEq(mode, p.MODE_NORMAL());
        assertEq(fee, 700);
        vm.warp(T0 + 181);
        (fee, mode) = p.quote();
        assertEq(mode, p.MODE_BLIND());
        assertEq(fee, 3_000);
    }

    /// @dev The desk clamps k to [1, 2]; a desk that does not (here a mock) still cannot push the fee out of bounds.
    function testFuzz_UnclampedKStaysWithinBounds(uint16 k, uint32 sigma, int32 dev) public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(true, 7_000, 2_000));
        desk.set(T0, sigma, sigma, dev, 0);
        desk.setK(k);
        (uint24 f01, uint24 f10,) = p.quoteDirectional();
        assertGe(f01, 700);
        assertGe(f10, 700);
        assertLe(f01, 6_000);
        assertLe(f10, 6_000);
    }

    function test_DirectionalPremiumIsCappedTwice() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 10_000, 1_000));
        desk.set(T0, SIGMA_48, SIGMA_48, 50_000, 0);
        (, uint24 f10,) = p.quoteDirectional();
        assertEq(f10, 1_700); // premium capped at 1_000
        ClimFeePolicy q = new ClimFeePolicy(desk, _params(false, 10_000, 6_000));
        desk.set(T0, SIGMA_1000, SIGMA_1000, 50_000, 0);
        (, f10,) = q.quoteDirectional();
        assertEq(f10, 6_000); // never above the cap
    }

    function test_NoPremiumWhenDisabled() public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(false, 0, 0));
        desk.set(T0, SIGMA_48, SIGMA_48, 50_000, 0);
        (uint24 f01, uint24 f10,) = p.quoteDirectional();
        assertEq(f01, f10);
    }

    function test_RevertWhen_InvalidParams() public {
        ClimFeePolicy.Params memory bad = _params(false, 0, 0);
        bad.safePips = 6_001;
        vm.expectRevert(ClimFeePolicy.InvalidParams.selector);
        new ClimFeePolicy(desk, bad);
        bad = _params(false, 0, 6_001);
        vm.expectRevert(ClimFeePolicy.InvalidParams.selector);
        new ClimFeePolicy(desk, bad);
    }

    function testFuzz_FeeAlwaysWithinBounds(uint32 s15, uint32 s5, int32 dev, uint16 k) public {
        ClimFeePolicy p = new ClimFeePolicy(desk, _params(true, 7_000, 2_000));
        desk.set(T0, s15, s5, dev, 0);
        desk.setK(uint16(bound(k, 10_000, 20_000)));
        (uint24 f01, uint24 f10,) = p.quoteDirectional();
        assertGe(f01, 700);
        assertGe(f10, 700);
        assertLe(f01, 6_000);
        assertLe(f10, 6_000);
    }
}
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `forge test --match-path test/v2/ClimFeePolicy.t.sol -q`
Expected: compilation error, `ClimFeePolicy.sol` not found.

- [ ] **Step 4: Implement `ClimFeePolicy`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {FLAG_DEGRADED} from "../interfaces/IRiskDesk.sol";
import {ClimFeeMath} from "../libraries/ClimFeeMath.sol";
import {IRiskDeskV2} from "./interfaces/IRiskDeskV2.sol";

/// @dev Policy modes, file-level so other contracts compare against them without a call (solc does not expose another
///      contract's constants); ClimFeePolicy re-exports them as MODE_* for off-chain readers.
uint8 constant POLICY_MODE_NORMAL = 0;
uint8 constant POLICY_MODE_DEGRADED = 1;
uint8 constant POLICY_MODE_BLIND = 2;

/// @title ClimFeePolicy
/// @notice Turns the desk's state into the fee clim recommends for one Fables pool:
///         fee = clamp(ceil(eta * k * sigma * sqrt(dtEff / 2)), floor, cap), sigma from the 5- or 15-minute window,
///         at least `safe` when the desk is blind or degraded. quoteDirectional() adds a premium on the side the
///         venue-pool gap points to: premium = min(dirMax, dirSlope * |gap|), still capped. A positive gap (venue
///         above the pool: ETH is cheap in the pool) makes ETH buyers toxic; they swap one-for-zero when ETH is
///         currency0 and zero-for-one when ETH is currency1 (`ethIsToken0`).
///         Every parameter is immutable and comes from the lab (shared/params-fables.json).
contract ClimFeePolicy {
    uint8 public constant MODE_NORMAL = POLICY_MODE_NORMAL;
    uint8 public constant MODE_DEGRADED = POLICY_MODE_DEGRADED;
    uint8 public constant MODE_BLIND = POLICY_MODE_BLIND;

    struct Params {
        uint32 etaE4;
        uint32 sqrtHalfDtE6;
        uint24 floorPips;
        uint24 capPips;
        uint24 safePips;
        uint32 tauKillSec;
        bool shortWindow;
        uint32 dirSlopeE4;
        uint24 dirMaxPremiumPips;
        bool ethIsToken0;
    }

    IRiskDeskV2 public immutable desk;
    uint32 public immutable etaE4;
    uint32 public immutable sqrtHalfDtE6;
    uint24 public immutable floorPips;
    uint24 public immutable capPips;
    uint24 public immutable safePips;
    uint32 public immutable tauKillSec;
    bool public immutable shortWindow;
    uint32 public immutable dirSlopeE4;
    uint24 public immutable dirMaxPremiumPips;
    bool public immutable ethIsToken0;

    error InvalidParams();

    constructor(IRiskDeskV2 desk_, Params memory p) {
        if (
            address(desk_) == address(0) || p.etaE4 == 0 || p.sqrtHalfDtE6 == 0 || p.tauKillSec == 0 || p.floorPips == 0
                || p.floorPips > p.safePips || p.safePips > p.capPips || p.capPips > LPFeeLibrary.MAX_LP_FEE
                || p.dirMaxPremiumPips > p.capPips
        ) revert InvalidParams();
        desk = desk_;
        etaE4 = p.etaE4;
        sqrtHalfDtE6 = p.sqrtHalfDtE6;
        floorPips = p.floorPips;
        capPips = p.capPips;
        safePips = p.safePips;
        tauKillSec = p.tauKillSec;
        shortWindow = p.shortWindow;
        dirSlopeE4 = p.dirSlopeE4;
        dirMaxPremiumPips = p.dirMaxPremiumPips;
        ethIsToken0 = p.ethIsToken0;
    }

    /// @notice One fee for both directions, and the desk's mode.
    function quote() public view returns (uint24 fee, uint8 mode) {
        (fee, mode,) = _quote();
    }

    /// @notice The desk's last observation time and report counter (0, 0 before the first report).
    function lastObservation() external view returns (uint40 tObs, uint32 seq) {
        (tObs,,,,,, seq) = desk.state();
    }

    /// @notice One fee per swap direction (zero-for-one pays currency0 for currency1), and the desk's mode.
    function quoteDirectional() external view returns (uint24 fee0For1, uint24 fee1For0, uint8 mode) {
        int32 dev;
        uint24 base;
        (base, mode, dev) = _quote();
        fee0For1 = base;
        fee1For0 = base;
        if (dirSlopeE4 == 0 || dev == 0) return (fee0For1, fee1For0, mode);
        uint256 absDev = dev > 0 ? uint256(int256(dev)) : uint256(-int256(dev));
        uint256 premium = (uint256(dirSlopeE4) * absDev) / 10_000;
        if (premium > dirMaxPremiumPips) premium = dirMaxPremiumPips;
        uint256 toxic = uint256(base) + premium;
        if (toxic > capPips) toxic = capPips;
        // venue above the pool: buyers of ETH are toxic; below: sellers. Buying ETH is one-for-zero when ETH is
        // currency0 and zero-for-one when it is currency1.
        if ((dev > 0) == ethIsToken0) fee1For0 = uint24(toxic);
        else fee0For1 = uint24(toxic);
    }

    function _quote() private view returns (uint24 fee, uint8 mode, int32 dev) {
        (uint40 tObs, uint32 s15, uint32 s5, int32 devPips, uint16 kE4, uint8 flags,) = desk.state();
        uint16 k = kE4 == 0 ? 10_000 : kE4;
        fee = ClimFeeMath.feePips(shortWindow ? s5 : s15, etaE4, sqrtHalfDtE6, k, floorPips, capPips);
        dev = devPips;
        if (tObs == 0 || block.timestamp > uint256(tObs) + tauKillSec) {
            return (fee > safePips ? fee : safePips, MODE_BLIND, dev);
        }
        if (flags & FLAG_DEGRADED != 0) {
            return (fee > safePips ? fee : safePips, MODE_DEGRADED, dev);
        }
        return (fee, MODE_NORMAL, dev);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `forge test --match-path test/v2/ClimFeePolicy.t.sol -q`
Expected: `13 passed` (the two fuzz tests run 1,000 cases each).

- [ ] **Step 6: Commit**

```bash
git add contracts/src/v2/ClimFeePolicy.sol contracts/test/v2/mocks/MockDeskV2.sol contracts/test/v2/ClimFeePolicy.t.sol
git commit -m "feat(contracts): ClimFeePolicy, clim's fee for a Fables pool with an optional per-direction premium"
```

### Task 4: Override-fee hook interfaces and `ClimPoker`

**Files:**
- Create: `contracts/src/v2/interfaces/IOverrideFeeHook.sol`
- Create: `contracts/src/v2/ClimPoker.sol`
- Create: `contracts/test/v2/mocks/MockPokeHook.sol`
- Test: `contracts/test/v2/ClimPoker.t.sol`

- [ ] **Step 1: Write the interfaces**

```solidity
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
```

- [ ] **Step 2: Write the hook double**

```solidity
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

    function setCap(uint24 cap_) external {
        cap = cap_;
    }

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
```

- [ ] **Step 3: Write the failing tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IAccessManaged} from "@openzeppelin/contracts/access/manager/IAccessManaged.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {FLAG_DEGRADED} from "../../src/interfaces/IRiskDesk.sol";
import {MockDeskV2} from "./mocks/MockDeskV2.sol";
import {MockPokeHook} from "./mocks/MockPokeHook.sol";

/// @notice ClimPoker under an AccessManager set up the way Fables would: FEE_POKER (1) on postEvent and
///         postEventAndPoke, CLIM_RUNNER (7, a role Fables creates) on poke.
contract ClimPokerTest is Test {
    uint64 internal constant FEE_POKER = 1;
    uint64 internal constant CLIM_RUNNER = 7;
    uint40 internal constant T0 = 1_760_000_000;
    uint32 internal constant SIGMA_48 = 85_475;
    bytes32 internal constant POOL = keccak256("pool");

    AccessManager internal am;
    MockDeskV2 internal desk;
    MockPokeHook internal hook;
    ClimFeePolicy internal policy;
    address internal keeper = makeAddr("fablesKeeper");
    address internal runner = makeAddr("climRunner");
    address internal anyone = makeAddr("anyone");

    function setUp() public {
        vm.warp(T0);
        am = new AccessManager(address(this));
        am.grantRole(FEE_POKER, keeper, 0);
        am.grantRole(CLIM_RUNNER, keeper, 0);
        am.grantRole(CLIM_RUNNER, runner, 0);
        desk = new MockDeskV2();
        hook = new MockPokeHook();
        policy = new ClimFeePolicy(
            desk,
            ClimFeePolicy.Params({
                etaE4: 25_093,
                sqrtHalfDtE6: 707_107,
                floorPips: 700,
                capPips: 6_000,
                safePips: 3_000,
                tauKillSec: 180,
                shortWindow: false,
                dirSlopeE4: 5_000,
                dirMaxPremiumPips: 1_000,
                ethIsToken0: true
            })
        );
        desk.set(T0, SIGMA_48, SIGMA_48, 1_000, 0);
    }

    function _poker(bool directional, uint40 ttl) internal returns (ClimPoker p) {
        p = new ClimPoker(policy, address(hook), POOL, directional, ttl, address(am));
        bytes4[] memory keeperSel = new bytes4[](2);
        keeperSel[0] = ClimPoker.postEvent.selector;
        keeperSel[1] = ClimPoker.postEventAndPoke.selector;
        am.setTargetFunctionRole(address(p), keeperSel, FEE_POKER);
        bytes4[] memory runnerSel = new bytes4[](1);
        runnerSel[0] = ClimPoker.poke.selector;
        am.setTargetFunctionRole(address(p), runnerSel, CLIM_RUNNER);
    }

    function _poker(bool directional) internal returns (ClimPoker) {
        return _poker(directional, 600);
    }

    function test_SymmetricPokeSendsTheHigherSideToTheOldHook() public {
        ClimPoker p = _poker(false);
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastPool(), POOL);
        assertEq(hook.last0For1(), 1_200); // max of 700 and 1_200: a symmetric hook gets the toxic side's fee
        assertEq(hook.last1For0(), 1_200);
        assertEq(hook.lastTtl(), 600);
    }

    function test_DirectionalPokeSendsBothSides() public {
        ClimPoker p = _poker(true);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 700);
        assertEq(hook.last1For0(), 1_200);
    }

    function test_FablesKeeperCanPokeToo() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.poke();
        assertEq(hook.pokes(), 1);
    }

    function test_RevertWhen_DeskIsBlind() public {
        ClimPoker p = _poker(false);
        vm.warp(T0 + 181);
        vm.prank(runner);
        vm.expectRevert(ClimPoker.DeskBlind.selector);
        p.poke();
        assertEq(hook.pokes(), 0);
    }

    function test_DegradedDeskPokesAtLeastTheSafeFee() public {
        ClimPoker p = _poker(true);
        desk.set(T0, SIGMA_48, SIGMA_48, 0, FLAG_DEGRADED);
        vm.expectEmit(true, false, false, true, address(p));
        emit ClimPoker.Poked(2, T0, 3_000, 3_000, policy.MODE_DEGRADED(), false, T0 + 600, runner);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 3_000);
        assertEq(hook.last1For0(), 3_000);
    }

    function test_EventOverrideComposesWithMax() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(4_000, 900, T0 + 300);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 4_000);
        assertEq(hook.last1For0(), 1_200);
    }

    function test_SymmetricPokeWithAnEvent() public {
        ClimPoker p = _poker(false);
        vm.prank(keeper);
        p.postEvent(4_000, 900, T0 + 300);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 4_000);
        assertEq(hook.last1For0(), 4_000);
        assertEq(hook.lastTtl(), 300); // the event raised the fee, so the override ends with the event
    }

    function test_PostEventAndPoke() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        (uint24 f01, uint24 f10) = p.postEventAndPoke(5_000, 5_000, T0 + 300);
        assertEq(f01, 5_000);
        assertEq(f10, 5_000);
        assertEq(hook.last0For1(), 5_000);
        assertEq(hook.last1For0(), 5_000);
        assertEq(hook.lastTtl(), 300);
        (uint24 e01, uint24 e10, uint40 expiry) = p.eventOverride();
        assertEq(e01, 5_000);
        assertEq(e10, 5_000);
        assertEq(expiry, T0 + 300);
    }

    function test_ExpiredEventIsIgnored() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(4_000, 4_000, T0 + 100);
        vm.warp(T0 + 101);
        desk.set(T0 + 101, SIGMA_48, SIGMA_48, 0, 0);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 700);
        assertEq(hook.lastTtl(), 600);
    }

    function test_EventFeeIsClampedToThePolicyCap() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(9_000, 9_000, T0 + 300);
        vm.prank(runner);
        p.poke();
        assertEq(hook.last0For1(), 6_000);
    }

    function test_RevertWhen_TheHookRejectsTheFee() public {
        ClimPoker p = _poker(true);
        hook.setCap(1_000);
        vm.prank(runner);
        vm.expectRevert(MockPokeHook.FeeAboveCap.selector);
        p.poke();
    }

    function test_TtlIsAnchoredToTheObservation() public {
        ClimPoker p = _poker(true);
        vm.warp(T0 + 150); // still fresh (tauKillSec 180), but the observation is 150 s old
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 450);
    }

    function test_TtlFromAFutureObservationNeverExceedsTheConfiguredTtl() public {
        ClimPoker p = _poker(true);
        desk.set(T0 + 30, SIGMA_48, SIGMA_48, 0, 0);
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 600);
    }

    function test_TtlIsAtLeastOneSecond() public {
        ClimPoker p = _poker(true, 60);
        vm.warp(T0 + 100); // fresh for the policy, but past tObs + ttl
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 1);
    }

    function test_TtlIsLimitedByARaisingEvent() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(4_000, 0, T0 + 100);
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 100);
    }

    function test_TtlIgnoresAnEventBelowTheDeskFee() public {
        ClimPoker p = _poker(true);
        vm.prank(keeper);
        p.postEvent(500, 500, T0 + 100);
        vm.expectEmit(true, false, false, true, address(p));
        emit ClimPoker.Poked(1, T0, 700, 1_200, 0, false, T0 + 600, runner);
        vm.prank(runner);
        p.poke();
        assertEq(hook.lastTtl(), 600);
    }

    function test_RevertWhen_AStrangerPokes() public {
        ClimPoker p = _poker(true);
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, anyone));
        p.poke();
        assertEq(hook.pokes(), 0);
    }

    function test_RevertWhen_AStrangerPostsAnEvent() public {
        ClimPoker p = _poker(true);
        vm.startPrank(anyone);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, anyone));
        p.postEvent(4_000, 4_000, T0 + 300);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, anyone));
        p.postEventAndPoke(4_000, 4_000, T0 + 300);
        vm.stopPrank();
    }

    function test_RevertWhen_TheRunnerPostsAnEvent() public {
        ClimPoker p = _poker(true);
        vm.prank(runner);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, runner));
        p.postEvent(500, 500, T0 + 300);
    }

    function test_RevertWhen_EventExpiryIsBeyondMaxTtl() public {
        ClimPoker p = _poker(true);
        vm.startPrank(keeper);
        p.postEvent(4_000, 4_000, T0 + 72 hours);
        vm.expectRevert(abi.encodeWithSelector(ClimPoker.InvalidExpiry.selector, T0 + 72 hours + 1));
        p.postEvent(4_000, 4_000, T0 + 72 hours + 1);
        vm.stopPrank();
    }

    function test_EventPostedCarriesTheSender() public {
        ClimPoker p = _poker(true);
        vm.expectEmit(true, false, false, true, address(p));
        emit ClimPoker.EventPosted(keeper, 4_000, 900, T0 + 300);
        vm.prank(keeper);
        p.postEvent(4_000, 900, T0 + 300);
    }

    function test_PokedEventCarriesWhatWasSent() public {
        ClimPoker p = _poker(true);
        vm.expectEmit(true, false, false, true, address(p));
        emit ClimPoker.Poked(1, T0, 700, 1_200, 0, false, T0 + 600, runner);
        vm.prank(runner);
        p.poke();
    }

    function test_RevertWhen_ConfigIsInvalid() public {
        vm.expectRevert(ClimPoker.InvalidConfig.selector);
        new ClimPoker(policy, address(hook), POOL, false, 0, address(am));
        vm.expectRevert(ClimPoker.InvalidConfig.selector);
        new ClimPoker(policy, address(hook), POOL, false, 72 hours + 1, address(am));
        vm.expectRevert(ClimPoker.InvalidConfig.selector);
        new ClimPoker(policy, address(hook), POOL, false, 600, address(0));
    }
}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `forge test --match-path test/v2/ClimPoker.t.sol -q`
Expected: compilation error, `ClimPoker.sol` not found.

- [ ] **Step 5: Implement `ClimPoker`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";

import {ClimFeePolicy, POLICY_MODE_BLIND} from "./ClimFeePolicy.sol";
import {ISymmetricPokeHook, IDirectionalPokeHook} from "./interfaces/IOverrideFeeHook.sol";

/// @title ClimPoker
/// @notice The adapter a Fables pool grants its FEE_POKER role to. It is governed by Fables' own AccessManager (the
///         one that guards their hook): clim holds no admin power over it, and only the roles Fables grants can call
///         it. The fee always comes from clim's policy (the desk's public state), never from the caller; Fables'
///         keeper adds event overrides (CPI, FOMC...) and the poke sends max(clim's fee, live event fee) per direction.
///         Fables' hook still enforces its own floor, cap and TTL. A blind desk means no poke: the last override
///         expires and the pool falls back to its flat fee.
///
///         Intended setup, one AccessManager batch by Fables' admin:
///         - grantRole(FEE_POKER, poker, 0): the poker may call the hook's pokeFee;
///         - setTargetFunctionRole(poker, [postEvent, postEventAndPoke], FEE_POKER): Fables' keeper posts its event
///           overrides through the poker, so they compose with clim's fee in the hook's one override slot;
///         - setTargetFunctionRole(poker, [poke], CLIM_RUNNER) with a role id Fables picks, granted to clim's runner
///           bot and to Fables' keeper.
///         Revoking FEE_POKER from the poker stops everything at once.
contract ClimPoker is AccessManaged {
    struct EventOverride {
        uint24 fee0For1;
        uint24 fee1For0;
        uint40 expiry;
    }

    uint40 public constant MAX_TTL = 72 hours;

    ClimFeePolicy public immutable policy;
    address public immutable hook;
    bytes32 public immutable poolId;
    bool public immutable directional;
    uint40 public immutable ttl;

    EventOverride public eventOverride;

    /// @param seq Desk report the fee comes from.
    /// @param tObs Observation time of that report.
    /// @param mode Policy mode (0 normal, 1 degraded).
    /// @param eventApplied True when a live event override raised at least one side above clim's fee.
    /// @param expiry When the override sent to the hook ends.
    /// @param caller Who triggered the poke.
    event Poked(
        uint32 indexed seq,
        uint40 tObs,
        uint24 fee0For1,
        uint24 fee1For0,
        uint8 mode,
        bool eventApplied,
        uint40 expiry,
        address caller
    );
    event EventPosted(address indexed by, uint24 fee0For1, uint24 fee1For0, uint40 expiry);

    error InvalidConfig();
    error DeskBlind();
    error InvalidExpiry(uint40 expiry);

    constructor(
        ClimFeePolicy policy_,
        address hook_,
        bytes32 poolId_,
        bool directional_,
        uint40 ttl_,
        address authority_
    ) AccessManaged(authority_) {
        if (
            address(policy_) == address(0) || hook_ == address(0) || authority_ == address(0) || ttl_ == 0
                || ttl_ > MAX_TTL
        ) {
            revert InvalidConfig();
        }
        policy = policy_;
        hook = hook_;
        poolId = poolId_;
        directional = directional_;
        ttl = ttl_;
    }

    /// @notice Records an event fee per direction, live until `expiry`; the next poke sends max(clim's fee, event fee).
    ///         It replaces any previous event. A zero fee leaves that side to clim, and a past expiry clears the event.
    ///         Restricted to the roles Fables assigns (FEE_POKER in the intended setup).
    function postEvent(uint24 fee0For1, uint24 fee1For0, uint40 expiry) external restricted {
        _postEvent(fee0For1, fee1For0, expiry);
    }

    /// @notice postEvent() then poke() in one call, so an event fee reaches the hook at once.
    function postEventAndPoke(uint24 fee0For1, uint24 fee1For0, uint40 expiry)
        external
        restricted
        returns (uint24, uint24)
    {
        _postEvent(fee0For1, fee1For0, expiry);
        return _poke();
    }

    /// @notice Sends clim's current fee, composed with any live event fee, to the hook. Restricted to the roles Fables
    ///         assigns (CLIM_RUNNER in the intended setup).
    function poke() external restricted returns (uint24 fee0For1, uint24 fee1For0) {
        return _poke();
    }

    function _postEvent(uint24 fee0For1, uint24 fee1For0, uint40 expiry) private {
        if (expiry > block.timestamp + MAX_TTL) revert InvalidExpiry(expiry);
        eventOverride = EventOverride(fee0For1, fee1For0, expiry);
        emit EventPosted(msg.sender, fee0For1, fee1For0, expiry);
    }

    function _poke() private returns (uint24 fee0For1, uint24 fee1For0) {
        (uint24 d01, uint24 d10, uint8 mode) = policy.quoteDirectional();
        if (mode == POLICY_MODE_BLIND) revert DeskBlind();
        if (!directional) {
            // one fee for both sides: the toxic side's
            if (d10 > d01) d01 = d10;
            else d10 = d01;
        }
        uint40 eventExpiry;
        (fee0For1, fee1For0, eventExpiry) = _withEvent(d01, d10);
        bool applied = fee0For1 != d01 || fee1For0 != d10;

        (uint40 tObs, uint32 seq) = policy.lastObservation();
        uint40 ttlSend = _ttlSend(tObs, applied ? eventExpiry : 0);
        if (directional) IDirectionalPokeHook(hook).pokeFee(poolId, fee0For1, fee1For0, ttlSend);
        else ISymmetricPokeHook(hook).pokeFee(poolId, fee0For1, ttlSend);
        emit Poked(seq, tObs, fee0For1, fee1For0, mode, applied, uint40(block.timestamp) + ttlSend, msg.sender);
    }

    /// @dev max(clim's fee, live event fee) per side, the event clamped to the policy cap; a symmetric hook gets the
    ///      higher side on both.
    function _withEvent(uint24 d01, uint24 d10) private view returns (uint24 f01, uint24 f10, uint40 expiry) {
        (f01, f10) = (d01, d10);
        EventOverride memory e = eventOverride;
        if (e.expiry <= block.timestamp) return (f01, f10, 0);
        uint24 cap = policy.capPips();
        uint24 e01 = e.fee0For1 > cap ? cap : e.fee0For1;
        uint24 e10 = e.fee1For0 > cap ? cap : e.fee1For0;
        if (e01 > f01) f01 = e01;
        if (e10 > f10) f10 = e10;
        if (!directional) {
            if (f10 > f01) f01 = f10;
            else f10 = f01;
        }
        expiry = e.expiry;
    }

    /// @dev The override lives until tObs + ttl (a fee is never trusted longer than its observation allows), never
    ///      longer than `ttl` (a future tObs within the desk's skew does not extend it), ends with an event that
    ///      raised it, and lasts at least 1 s (the hook rejects 0).
    function _ttlSend(uint40 tObs, uint40 eventExpiry) private view returns (uint40) {
        uint256 end = uint256(tObs) + ttl;
        if (eventExpiry != 0 && eventExpiry < end) end = eventExpiry;
        if (end <= block.timestamp) return 1;
        uint256 left = end - block.timestamp;
        return left > ttl ? ttl : uint40(left);
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `forge test --match-path test/v2/ClimPoker.t.sol -q`
Expected: `23 passed`.

- [ ] **Step 7: Commit**

```bash
git add contracts/src/v2/interfaces/IOverrideFeeHook.sol contracts/src/v2/ClimPoker.sol contracts/test/v2/mocks/MockPokeHook.sol contracts/test/v2/ClimPoker.t.sol
git commit -m "feat(contracts): ClimPoker, the FEE_POKER adapter composing clim's fee with Fables' event overrides"
```

### Task 5: Independent `PokeFeeHook` for our testnet pools

**Files:**
- Create: `contracts/src/v2/PokeFeeHook.sol`
- Test: `contracts/test/v2/PokeFeeHook.t.sol`

- [ ] **Step 1: Write the failing tests**

```solidity
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `forge test --match-path test/v2/PokeFeeHook.t.sol -q`
Expected: compilation error, `PokeFeeHook.sol` not found.

- [ ] **Step 3: Implement `PokeFeeHook`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {BaseOverrideFee} from "@openzeppelin/uniswap-hooks/fee/BaseOverrideFee.sol";
import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title PokeFeeHook
/// @notice A Uniswap v4 hook with a flat LP fee and bounded, expiring overrides ("pokes"), exposing the same public
///         interface as Fables' override hooks so clim's live reference pools on Robinhood Chain testnet behave like
///         Fables' pools. Independent implementation written from Fables' published ABI and documented behavior (fee
///         bounds, TTL, the half-flat floor under an override); no Fables code is copied.
///         Fee rule: flat; under a live poke, max(poke, max(floor, flat / 2)); never above the cap.
contract PokeFeeHook is BaseOverrideFee, AccessManaged {
    struct Config {
        uint24 floorPips;
        uint24 flatPips;
        uint24 capPips;
        bool set;
    }

    struct Poke {
        uint24 fee0For1;
        uint24 fee1For0;
        uint40 expiry;
    }

    uint256 public constant MAX_POKE_DISCOUNT_BPS = 5_000;
    uint40 public constant MAX_TTL = 72 hours;

    mapping(PoolId => Config) public configs;
    mapping(PoolId => Poke) public pokes;

    event PoolConfigured(bytes32 indexed poolId, uint24 floorPips, uint24 flatPips, uint24 maxFee);
    event FeePoked(bytes32 indexed poolId, uint24 fee, uint40 expiry);
    event FeePoked(bytes32 indexed poolId, uint24 fee0For1, uint24 fee1For0, uint40 expiry);
    event PokeCleared(bytes32 indexed poolId);

    error InvalidConfig();
    error PoolNotConfigured(bytes32 poolId);
    error FeeOutOfBounds(uint24 fee);
    error InvalidTtl(uint40 ttl);

    constructor(IPoolManager poolManager_, address authority) BaseHook(poolManager_) AccessManaged(authority) {}

    function setPoolConfig(PoolKey calldata key, uint24 floorPips, uint24 flatPips, uint24 capPips)
        external
        restricted
    {
        if (address(key.hooks) != address(this)) revert InvalidConfig();
        if (floorPips == 0 || floorPips > flatPips || flatPips > capPips || capPips > LPFeeLibrary.MAX_LP_FEE) {
            revert InvalidConfig();
        }
        PoolId id = key.toId();
        configs[id] = Config(floorPips, flatPips, capPips, true);
        emit PoolConfigured(PoolId.unwrap(id), floorPips, flatPips, capPips);
    }

    function pokeFee(bytes32 poolId, uint24 fee, uint40 ttl) external restricted {
        uint40 expiry = _poke(poolId, fee, fee, ttl);
        emit FeePoked(poolId, fee, expiry);
    }

    function pokeFee(bytes32 poolId, uint24 fee0For1, uint24 fee1For0, uint40 ttl) external restricted {
        uint40 expiry = _poke(poolId, fee0For1, fee1For0, ttl);
        emit FeePoked(poolId, fee0For1, fee1For0, expiry);
    }

    function clearPoke(bytes32 poolId) external restricted {
        delete pokes[PoolId.wrap(poolId)];
        emit PokeCleared(poolId);
    }

    /// @notice The LP fee a swap in this direction pays right now, in pips.
    function currentFee(bytes32 poolId, bool zeroForOne) public view returns (uint24) {
        Config memory c = configs[PoolId.wrap(poolId)];
        if (!c.set) revert PoolNotConfigured(poolId);
        uint256 fee = c.flatPips;
        Poke memory p = pokes[PoolId.wrap(poolId)];
        if (p.expiry > block.timestamp) {
            uint256 poked = zeroForOne ? p.fee0For1 : p.fee1For0;
            uint256 pokeFloor = (uint256(c.flatPips) * (10_000 - MAX_POKE_DISCOUNT_BPS)) / 10_000;
            if (c.floorPips > pokeFloor) pokeFloor = c.floorPips;
            fee = poked > pokeFloor ? poked : pokeFloor;
        }
        return uint24(fee > c.capPips ? c.capPips : fee);
    }

    function _poke(bytes32 poolId, uint24 f01, uint24 f10, uint40 ttl) private returns (uint40 expiry) {
        Config memory c = configs[PoolId.wrap(poolId)];
        if (!c.set) revert PoolNotConfigured(poolId);
        if (f01 > c.capPips || f01 < c.floorPips) revert FeeOutOfBounds(f01);
        if (f10 > c.capPips || f10 < c.floorPips) revert FeeOutOfBounds(f10);
        if (ttl == 0 || ttl > MAX_TTL) revert InvalidTtl(ttl);
        expiry = uint40(block.timestamp) + ttl;
        pokes[PoolId.wrap(poolId)] = Poke(f01, f10, expiry);
    }

    function _getFee(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (uint24)
    {
        return currentFee(PoolId.unwrap(key.toId()), params.zeroForOne);
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `forge test --match-path test/v2/PokeFeeHook.t.sol -q`
Expected: `15 passed`. If the compiler rejects the two `FeePoked` overloads at the `emit` sites, keep both event declarations and write the emits as `emit FeePoked(poolId, fee, expiry);` with explicitly typed local variables (`uint24 f = fee; uint40 e = expiry;`), which resolves the overload by argument count; do not rename the events, their topics must match Fables' so one decoder reads both.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/v2/PokeFeeHook.sol contracts/test/v2/PokeFeeHook.t.sol
git commit -m "feat(contracts): independent PokeFeeHook with Fables' public override interface, for testnet pools"
```

### Task 6: Fork tests against Fables' real hook

**Files:**
- Test: `contracts/test/fork/FablesFork.t.sol`

- [ ] **Step 1: Write the fork tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IAccessManager} from "@openzeppelin/contracts/access/manager/IAccessManager.sol";
import {IAccessManaged} from "@openzeppelin/contracts/access/manager/IAccessManaged.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
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
import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";
import {ISymmetricPokeHook} from "../../src/v2/interfaces/IOverrideFeeHook.sol";

/// @notice Fables' pool configuration entry point, from their published ABI
///         (`setPoolConfig((address,address,uint24,int24,address),uint24,uint24,uint24)`).
interface IFablesPoolConfig {
    function setPoolConfig(PoolKey calldata key, uint24 floorPips, uint24 flatPips, uint24 maxFee) external;
}

/// @notice Runs against Fables' deployed ETH/USDG hook on a fork of Robinhood Chain mainnet (nothing is sent to
///         mainnet), pinned to FORK_BLOCK so the run is reproducible. Fables' admin sends the AccessManager batch the
///         integration asks for; the tests prove that ClimPoker drives the real hook within its bounds, only for the
///         roles Fables grants, composes with an event override, stops when the desk is blind, and stops for good
///         when the role is revoked.
contract FablesForkTest is Test {
    /// @dev A Robinhood Chain mainnet block of 2026-10-13, after the ETH/USDG config of 2026-09-06.
    uint256 internal constant FORK_BLOCK = 87_780_000;
    address internal constant HOOK = 0x06a889870C8f83640D6816319f72e2aA579b6080;
    address internal constant ACCESS_MANAGER = 0xA362D98B33A7bb5B5E2180a05f995A70FB404f30;
    address internal constant POKER_ADMIN = 0x359856655934338d798F9ccE1f181486301D36a5;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    bytes32 internal constant POOL_ID = 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551;
    address internal constant FABLES_KEEPER = 0x1B6a8808E1D26dba66bA11E52997803C43CAd429;
    /// @dev Custom error Fables' hook reverts with when a poked fee is outside its band.
    bytes4 internal constant FABLES_FEE_OUT_OF_BOUNDS = 0x652853ee;
    uint64 internal constant FEE_POKER = 1;
    /// @dev A role id Fables would pick for who may trigger ClimPoker.poke() (clim's runner and their keeper).
    uint64 internal constant CLIM_RUNNER = 7;
    uint32 internal constant SIGMA_48 = 85_475;
    uint32 internal constant SIGMA_1000 = 1_780_730;
    uint32 internal constant ETA_E4 = 25_093;
    uint32 internal constant SQRT_HALF_DT_E6 = 707_107;

    address internal forwarder = makeAddr("forwarder");
    address internal operator = makeAddr("operator");
    address internal keeper = FABLES_KEEPER;
    address internal runner = makeAddr("climRunner");
    RiskDeskV2 internal desk;
    ClimFeePolicy internal policy;
    ClimPoker internal poker;
    uint40 internal t0;

    function setUp() public {
        string memory rpc = vm.envOr("RH_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, FORK_BLOCK);
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
        poker = new ClimPoker(policy, HOOK, POOL_ID, false, 600, ACCESS_MANAGER);
        _fablesGrants();
    }

    /// @dev The AccessManager batch Fables' admin would send (impersonated on the fork).
    function _fablesGrants() internal {
        IAccessManager am = IAccessManager(ACCESS_MANAGER);
        bytes4[] memory keeperSel = new bytes4[](2);
        keeperSel[0] = ClimPoker.postEvent.selector;
        keeperSel[1] = ClimPoker.postEventAndPoke.selector;
        bytes4[] memory runnerSel = new bytes4[](1);
        runnerSel[0] = ClimPoker.poke.selector;
        vm.startPrank(POKER_ADMIN);
        am.grantRole(FEE_POKER, address(poker), 0);
        am.setTargetFunctionRole(address(poker), keeperSel, FEE_POKER);
        am.labelRole(CLIM_RUNNER, "CLIM_RUNNER");
        am.setTargetFunctionRole(address(poker), runnerSel, CLIM_RUNNER);
        am.grantRole(CLIM_RUNNER, runner, 0);
        am.grantRole(CLIM_RUNNER, keeper, 0);
        vm.stopPrank();
    }

    function _report(uint32 sigma) internal {
        vm.prank(forwarder, operator);
        desk.onReport(
            "", abi.encode(uint40(block.timestamp), sigma, sigma, int32(0), uint16(3), uint8(4), uint16(10_000))
        );
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
        vm.prank(runner);
        poker.poke();
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), _expected(SIGMA_48));
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, false), _expected(SIGMA_48));
    }

    function test_StormRaisesTheFee() public {
        // a first report gets only the absolute bounds, so a storm shows at once (later ones move at most x2)
        _report(SIGMA_1000 / 2);
        vm.prank(runner);
        poker.poke();
        uint24 fee = ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true);
        assertEq(fee, _expected(SIGMA_1000 / 2));
        assertGt(fee, 700);
        assertLe(fee, 6_000);
    }

    function test_OverrideExpiresBackToFablesFlatFee() public {
        _report(SIGMA_48);
        vm.prank(runner);
        poker.poke();
        vm.warp(block.timestamp + 600);
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), 700);
    }

    function test_BlindDeskDoesNotPoke() public {
        _report(SIGMA_48);
        vm.warp(block.timestamp + 181);
        vm.prank(runner);
        vm.expectRevert(ClimPoker.DeskBlind.selector);
        poker.poke();
    }

    function test_EventOverrideOnTop() public {
        _report(SIGMA_48);
        vm.prank(keeper);
        poker.postEvent(6_000, 6_000, uint40(block.timestamp + 300));
        vm.prank(runner);
        poker.poke();
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), 6_000);
    }

    function test_RevokedRoleStopsPokes() public {
        _report(SIGMA_48);
        vm.prank(POKER_ADMIN);
        IAccessManager(ACCESS_MANAGER).revokeRole(FEE_POKER, address(poker));
        vm.prank(runner);
        vm.expectRevert();
        poker.poke();
    }

    function test_ASwapPaysThePokedFee() public {
        _report(SIGMA_1000 / 2);
        vm.prank(runner);
        poker.poke();
        uint24 expected = ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true);
        PoolSwapTest router = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        vm.deal(address(this), 1 ether);
        vm.recordLogs();
        router.swap{
            value: 0.01 ether
        }(
            _key(),
            SwapParams({
                zeroForOne: true, amountSpecified: -0.01 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
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

    function test_FablesKeeperHoldsFeePokerAtTheForkBlock() public view {
        (bool isMember,) = IAccessManager(ACCESS_MANAGER).hasRole(FEE_POKER, FABLES_KEEPER);
        assertTrue(isMember);
    }

    /// @dev Review finding C1: with a permissionless poke, anyone could overwrite the keeper's override (Fables' hook
    ///      has one slot per pool) with clim's lower fee. Now only the roles Fables grants can poke.
    function test_AStrangerCannotOverwriteTheKeepersOverride() public {
        _report(SIGMA_48);
        vm.prank(keeper);
        ISymmetricPokeHook(HOOK).pokeFee(POOL_ID, 5_000, 7_200);
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), 5_000);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, stranger));
        poker.poke();
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), 5_000);
    }

    function test_KeeperPostsAnEventAndPokesInOneCall() public {
        _report(SIGMA_48);
        vm.prank(keeper);
        (uint24 f01, uint24 f10) = poker.postEventAndPoke(5_000, 5_000, uint40(block.timestamp + 300));
        assertEq(f01, 5_000);
        assertEq(f10, 5_000);
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true), 5_000);
        assertEq(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, false), 5_000);
    }

    /// @dev Documented deployment invariant: the policy's band [floor, cap] must sit inside the hook's. If Fables lowers
    ///      the hook's cap below the policy's (or raises its floor above), a poke outside the new band reverts in the
    ///      hook: the pool keeps its last override until it expires, then its flat fee. Nothing worse happens.
    function test_PokeAboveALoweredHookCapReverts() public {
        vm.prank(POKER_ADMIN);
        IFablesPoolConfig(HOOK).setPoolConfig(_key(), 100, 700, 3_000);

        _report(SIGMA_1000);
        assertGt(_expected(SIGMA_1000), 3_000);
        vm.prank(runner);
        // the hook's own fee-bound error (selector observed on the fork at FORK_BLOCK: pokeFee(pool, 3_160, 600))
        vm.expectRevert(FABLES_FEE_OUT_OF_BOUNDS);
        poker.poke();
    }

    /// @dev Fables' hook and PokeFeeHook emit the same symmetric FeePoked topic, so one indexer reads both.
    function test_FeePokedTopicMatchesPokeFeeHook() public {
        bytes32 expected = keccak256("FeePoked(bytes32,uint24,uint40)");
        _report(SIGMA_48);
        vm.recordLogs();
        vm.prank(runner);
        poker.poke();
        assertEq(_firstTopic(HOOK), expected);

        address ours = address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) ^ (0x5555 << 144));
        AccessManager am = new AccessManager(address(this));
        deployCodeTo("PokeFeeHook.sol:PokeFeeHook", abi.encode(POOL_MANAGER, address(am)), ours);
        PoolKey memory key = _key();
        key.hooks = IHooks(ours);
        PokeFeeHook(ours).setPoolConfig(key, 100, 700, 6_000);
        vm.recordLogs();
        PokeFeeHook(ours).pokeFee(PoolId.unwrap(key.toId()), 1_000, 600);
        assertEq(_firstTopic(ours), expected);
    }

    function _firstTopic(address emitter) internal returns (bytes32) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == emitter) return logs[i].topics[0];
        }
        revert("no log");
    }

    receive() external payable {}
}
```

- [ ] **Step 2: Run without the RPC to see the suite skip**

Run: `RH_MAINNET_RPC_URL= forge test --match-path test/fork/FablesFork.t.sol -q`
Expected: every test skipped (forge loads `contracts/.env` by itself, so the variable is emptied on the command line).

- [ ] **Step 3: Run on the fork**

Run: `forge test --match-path test/fork/FablesFork.t.sol -vv`
Expected: `13 passed`.

If a test fails, read the revert before changing anything:
- `grantRole` reverting means POKER_ADMIN is not the admin of role 1 at the fork block: read `getRoleAdmin(1)` with `cast call 0xA362D98B33A7bb5B5E2180a05f995A70FB404f30 "getRoleAdmin(uint64)(uint64)" 1 --rpc-url $RH_MAINNET_RPC_URL`, then `getRoleMembers` is not in AccessManager, so read `RoleGranted` logs for that admin role and prank its holder instead. Record the finding in the session log.
- `test_ASwapPaysThePokedFee` reverting inside the hook means Fables gates who may swap (for example through its router). Keep the test, change it to `vm.expectRevert()` around the swap with a comment naming the revert data, and add to the session log that swaps on the fork go through Fables' router only; the run in Task 8 then records `currentFee` instead of swap fees.
- `setTargetFunctionRole` or `labelRole` reverting means `0x3598…36a5` no longer holds ADMIN (role 0) at the fork block: prank the current ADMIN holder instead and record it.
- `test_PokeAboveALoweredHookCapReverts` failing on `setPoolConfig` means the hook restricts it to another role or the selector changed: read the revert, prank the right holder, or skip the test with a comment if the selector is gone.
- `test_OverrideExpiresBackToFablesFlatFee` returning a different value means the pool config changed since 2026-10-13: read `PoolConfigured` logs and update the expected flat fee.

- [ ] **Step 4: Commit**

```bash
git add contracts/test/fork/FablesFork.t.sol docs/sessions
git commit -m "test(contracts): ClimPoker drives Fables' real ETH/USDG hook on a Robinhood Chain fork"
```

### Task 7: Desk reports for the run window (lab export)

**Files:**
- Create: `lab/scripts/export_fork_reports.py`

The run replays the 7 October 2026 storm, 01:40 to 03:10 UTC (`1791337200` to `1791342600`), the window `lab/out/fables-storm-2026-10-07.json` already studies.

Revised 2026-10-14 (plan 03 Task 2 Step 12): the reports' `sigma15E9` and `sigma5E9` come from the live desk's estimator, `sigmaEstimator` in `shared/params-fables.json` (venue-range since then), through `scripts/study_estimator.py`'s `minute_venues` and `desk_sigma`, so this export needs plan 03 Task 2's 1-minute candles of Binance, Coinbase and Kraken. The first version used Binance 1 s alone; the code below is the revised one.

- [ ] **Step 1: Write the export**

```python
"""Desk reports for the fork run (offline): what clim's live desk would have published every 30 s on 2026-10-07,
01:40-03:10 UTC, with the volatility estimator it computes (sigmaEstimator in shared/params-fables.json) and Fables'
pool prices.

    uv run python scripts/export_fork_reports.py     # docs/evidence/fork-reports-2026-10-07.json

Fields are parallel arrays so Foundry reads them with parseJsonUintArray / parseJsonIntArray. sigma15E9 and sigma5E9
come from the live estimator through scripts/study_estimator.py's loaders: venue-range and median-close on the
1-minute candles of Binance (USDT converted to USD), Coinbase and Kraken (Hyperliquid has no history), binance-1s on
Binance 1 s. devPips is Binance 1 s (USD) against the pool; the run's symmetric poker uses no directional premium, so
it does not move the fee. Three venues stand in for the live desk's four; the run script (ForkRun.s.sol) fixes dispBp
3, nSources 4 and kE4 10000 in every report so the desk accepts it, and the file says so.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import RAW, load_window  # noqa: E402
from study_estimator import desk_sigma, minute_venues  # noqa: E402

from clim_lab import markout as mk  # noqa: E402
from clim_lab import robin  # noqa: E402
from clim_lab.data import LAB_DIR, SHARED_DIR  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.units import sigma_e9_from_per_sqrt_s  # noqa: E402

START = 1_791_337_200  # 2026-10-07 01:40:00 UTC
END = 1_791_342_600  # 2026-10-07 03:10:00 UTC
OUT = LAB_DIR.parent / "docs" / "evidence" / "fork-reports-2026-10-07.json"


def main() -> None:
    estimator = json.loads((SHARED_DIR / "params-fables.json").read_text())["sigmaEstimator"]
    w = load_window()
    venues = minute_venues()
    t_obs = np.arange(START, END, 30, dtype=np.int64)
    s15 = desk_sigma(estimator, w, venues, t_obs, 900)
    s5 = desk_sigma(estimator, w, venues, t_obs, 300)
    pool = mk.pool_price_at(t_obs, w.t, w.swaps.log_price)
    dev = (np.exp(w.venue.at(t_obs - 1) - pool) - 1.0) * 1e6
    clock = robin.BlockClock.from_json(RAW / "blocks.json")
    out = {
        "generatedAt": now_iso(),
        "window": {"start": int(START), "end": int(END)},
        "forkBlock": clock.block_at(START - 120),  # last sampled block at or before 2 minutes ahead of the first report, so the run only warps forward
        "sigmaEstimator": estimator,
        "note": (
            f"lab replay: sigma15E9 and sigma5E9 from the live desk's estimator ({estimator}, sigmaEstimator in "
            "shared/params-fables.json), on the 1-minute candles of Binance (ETHUSDT converted to USD), Coinbase and "
            "Kraken for the multi-venue estimators; devPips from Binance 1 s (USD) against the pool (no effect on "
            "this symmetric run); because three replayed venues stand in for the live desk's four, the run fixes "
            "dispBp 3, nSources 4 and kE4 10000 in every report"
        ),
        "tObs": [int(t) for t in t_obs],
        "sigma15E9": [sigma_e9_from_per_sqrt_s(float(x)) for x in s15],
        "sigma5E9": [sigma_e9_from_per_sqrt_s(float(x)) for x in s5],
        "devPips": [int(round(float(x))) for x in dev],
    }
    write_json(OUT, out)
    print(
        f"{len(t_obs)} reports, fork block {out['forkBlock']}, sigma from {estimator}, "
        f"peak sigma5 {max(out['sigma5E9'])}"
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run (from `lab/`): `uv run python scripts/export_fork_reports.py`
Expected: `180 reports, fork block …, sigma from <sigmaEstimator>, peak sigma5 …`.

- [ ] **Step 3: Commit**

```bash
git add lab/scripts/export_fork_reports.py docs/evidence/fork-reports-2026-10-07.json
git commit -m "feat(lab): desk reports for the 7 October fork run"
```

### Task 8: The recorded run (`npm run demo:fork`)

**Files:**
- Create: `contracts/script/v2/ForkRun.s.sol`
- Create: `contracts/script/v2/fork-run.sh`
- Modify: `package.json` (root, `scripts`)

- [ ] **Step 1: Write the run script**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IAccessManager} from "@openzeppelin/contracts/access/manager/IAccessManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {ISymmetricPokeHook} from "../../src/v2/interfaces/IOverrideFeeHook.sol";

/// @notice The recorded run: on a fork of Robinhood Chain mainnet at the start of the 7 October 2026 storm, deploy
///         clim, send the AccessManager batch the integration asks of Fables (as Fables' admin, impersonated on the
///         fork), replay the desk's reports every 30 s, poke Fables' real ETH/USDG hook and swap both ways every
///         5 minutes. Writes docs/evidence/fork-run-2026-10-07.json. Simulation only: never run with --broadcast.
contract ForkRun is Script {
    using stdJson for string;

    address internal constant HOOK = 0x06a889870C8f83640D6816319f72e2aA579b6080;
    address internal constant ACCESS_MANAGER = 0xA362D98B33A7bb5B5E2180a05f995A70FB404f30;
    address internal constant POKER_ADMIN = 0x359856655934338d798F9ccE1f181486301D36a5;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    bytes32 internal constant POOL_ID = 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551;
    uint64 internal constant FEE_POKER = 1;
    uint64 internal constant CLIM_RUNNER = 7; // a role id Fables would pick for who may call ClimPoker.poke()

    string internal constant REPORTS = "../docs/evidence/fork-reports-2026-10-07.json";
    string internal constant PARAMS = "../shared/params-fables.json";
    string internal constant OUT = "../docs/evidence/fork-run-2026-10-07.json";

    address internal forwarder = address(0xF0F0);
    address internal operator = address(0x0F0F);
    /// @dev clim's runner bot: holds CLIM_RUNNER, pokes and swaps. A forge script may not use its own address.
    address internal runner = vm.addr(uint256(keccak256("climRunner")));

    uint256[] internal tArr;
    uint256[] internal pokedArr;
    uint256[] internal fee01Arr;
    uint256[] internal fee10Arr;
    uint256[] internal swapTArr;
    uint256[] internal swapFeeArr;
    bool[] internal swapZfoArr;
    uint256 internal swapReverts;

    function _policy(RiskDeskV2 desk) internal returns (ClimFeePolicy) {
        string memory p = vm.readFile(PARAMS);
        return new ClimFeePolicy(
            desk,
            ClimFeePolicy.Params({
                etaE4: uint32(p.readUint(".etaE4")),
                sqrtHalfDtE6: uint32(p.readUint(".sqrtHalfDtE6")),
                floorPips: uint24(p.readUint(".feeFloorPips")),
                capPips: uint24(p.readUint(".feeCapPips")),
                safePips: uint24(p.readUint(".feeSafePips")),
                tauKillSec: uint32(p.readUint(".tauKillSec")),
                shortWindow: p.readUint(".sigmaWindowSec") == 300,
                // No directional premium on this pool: Fables' ETH/USDG hook is symmetric (one fee for both
                // directions), and a symmetric ClimPoker sends the higher side on both, so the premium would raise
                // the fee for both directions. The measured per-direction rule (dirSlopeE4, dirMaxPremiumPips in
                // shared/params-fables.json, from lab/out/fables-direction.json) is for directional hooks.
                dirSlopeE4: 0,
                dirMaxPremiumPips: 0,
                ethIsToken0: true // native ETH is currency0 in the ETH/USDG pool key
            })
        );
    }

    /// @dev The batch Fables' admin would send: FEE_POKER for the poker, postEvent and postEventAndPoke behind
    ///      FEE_POKER, poke behind CLIM_RUNNER, granted here to clim's runner.
    function _fablesGrants(ClimPoker poker) internal {
        IAccessManager am = IAccessManager(ACCESS_MANAGER);
        bytes4[] memory keeperSel = new bytes4[](2);
        keeperSel[0] = ClimPoker.postEvent.selector;
        keeperSel[1] = ClimPoker.postEventAndPoke.selector;
        bytes4[] memory runnerSel = new bytes4[](1);
        runnerSel[0] = ClimPoker.poke.selector;
        vm.startPrank(POKER_ADMIN);
        am.grantRole(FEE_POKER, address(poker), 0);
        am.setTargetFunctionRole(address(poker), keeperSel, FEE_POKER);
        am.labelRole(CLIM_RUNNER, "CLIM_RUNNER");
        am.setTargetFunctionRole(address(poker), runnerSel, CLIM_RUNNER);
        am.grantRole(CLIM_RUNNER, runner, 0);
        vm.stopPrank();
    }

    function _key() internal pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(USDG), 0x800000, 10, IHooks(HOOK));
    }

    function _swap(PoolSwapTest router, bool zeroForOne) internal {
        PoolSwapTest.TestSettings memory s = PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        vm.recordLogs();
        vm.startPrank(runner);
        bool ok;
        if (zeroForOne) {
            try router.swap{
                value: 0.01 ether
            }(
                _key(),
                SwapParams({
                    zeroForOne: true, amountSpecified: -0.01 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                s,
                ""
            ) {
                ok = true;
            } catch {}
        } else {
            try router.swap(
                _key(),
                SwapParams({zeroForOne: false, amountSpecified: -20e6, sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
                s,
                ""
            ) {
                ok = true;
            } catch {}
        }
        vm.stopPrank();
        if (!ok) {
            swapReverts += 1;
            return;
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == POOL_MANAGER && logs[i].topics[0] == IPoolManager.Swap.selector) {
                (,,,,, uint24 fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                swapTArr.push(block.timestamp);
                swapFeeArr.push(fee);
                swapZfoArr.push(zeroForOne);
            }
        }
    }

    /// @dev The reports must come from the estimator the parameters name (lab/scripts/export_fork_reports.py).
    function _checkEstimator(string memory r) internal view returns (string memory estimator) {
        estimator = vm.readFile(PARAMS).readString(".sigmaEstimator");
        require(
            keccak256(bytes(r.readString(".sigmaEstimator"))) == keccak256(bytes(estimator)),
            "reports and params name different estimators: rerun lab/scripts/export_fork_reports.py"
        );
    }

    function run() external {
        string memory r = vm.readFile(REPORTS);
        string memory estimator = _checkEstimator(r);
        uint256[] memory tObs = r.readUintArray(".tObs");
        uint256[] memory s15 = r.readUintArray(".sigma15E9");
        uint256[] memory s5 = r.readUintArray(".sigma5E9");
        int256[] memory dev = r.readIntArray(".devPips");

        RiskDeskV2 desk = new RiskDeskV2(forwarder, operator);
        ClimFeePolicy policy = _policy(desk);
        // symmetric hook (one fee for both directions); TTL from the lab parameters
        uint40 ttl = uint40(vm.readFile(PARAMS).readUint(".pokeTtlSec"));
        ClimPoker poker = new ClimPoker(policy, HOOK, POOL_ID, false, ttl, ACCESS_MANAGER);
        _fablesGrants(poker);

        PoolSwapTest router = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        vm.deal(runner, 10 ether);

        for (uint256 i; i < tObs.length; i++) {
            vm.warp(tObs[i] + 2);
            vm.prank(forwarder, operator);
            desk.onReport(
                "",
                abi.encode(
                    uint40(tObs[i]), uint32(s15[i]), uint32(s5[i]), int32(dev[i]), uint16(3), uint8(4), uint16(10_000)
                )
            );
            vm.prank(runner);
            (uint24 poked,) = poker.poke();
            tArr.push(block.timestamp);
            pokedArr.push(poked);
            fee01Arr.push(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, true));
            fee10Arr.push(ISymmetricPokeHook(HOOK).currentFee(POOL_ID, false));
            if (i % 10 == 0) {
                _swap(router, true);
                if (i == 0) {
                    // the first ETH sale funds the USDG side; approve once
                    vm.prank(runner);
                    (bool ok,) = USDG.call(
                        abi.encodeWithSignature("approve(address,uint256)", address(router), type(uint256).max)
                    );
                    require(ok, "approve");
                }
                _swap(router, false);
            }
        }

        string memory o = "run";
        vm.serializeString(o, "note", "Simulation on a fork of Robinhood Chain mainnet; nothing was sent to mainnet");
        vm.serializeUint(o, "forkBlock", block.number);
        vm.serializeAddress(o, "hook", HOOK);
        vm.serializeBytes32(o, "poolId", POOL_ID);
        vm.serializeAddress(o, "climPoker", address(poker));
        vm.serializeString(o, "sigmaEstimator", estimator);
        vm.serializeUint(o, "etaE4", vm.readFile(PARAMS).readUint(".etaE4"));
        vm.serializeUint(o, "t", tArr);
        vm.serializeUint(o, "pokedPips", pokedArr);
        vm.serializeUint(o, "currentFee0For1Pips", fee01Arr);
        vm.serializeUint(o, "currentFee1For0Pips", fee10Arr);
        vm.serializeUint(o, "swapT", swapTArr);
        vm.serializeUint(o, "swapFeePips", swapFeeArr);
        vm.serializeBool(o, "swapZeroForOne", swapZfoArr);
        string memory json = vm.serializeUint(o, "swapReverts", swapReverts);
        vm.writeJson(json, OUT);
    }
}
```

- [ ] **Step 2: Write the wrapper**

```bash
#!/usr/bin/env bash
# The recorded fork run (simulation only). Usage: npm run demo:fork
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
: "${RH_MAINNET_RPC_URL:?set RH_MAINNET_RPC_URL (archive RPC) in contracts/.env}"
BLOCK=$(jq -r .forkBlock ../docs/evidence/fork-reports-2026-10-07.json)
forge script script/v2/ForkRun.s.sol:ForkRun --fork-url "$RH_MAINNET_RPC_URL" --fork-block-number "$BLOCK" -vv
jq '{sigmaEstimator, etaE4, pokes: (.pokedPips | length), minPokedPips: (.pokedPips | min), maxPokedPips: (.pokedPips | max), swaps: (.swapFeePips | length), swapReverts}' \
  ../docs/evidence/fork-run-2026-10-07.json
```

Make it executable: `chmod +x contracts/script/v2/fork-run.sh`.

- [ ] **Step 3: Add the npm script**

In the root `package.json`, add to `scripts`:

```json
"demo:fork": "bash contracts/script/v2/fork-run.sh"
```

- [ ] **Step 4: Run it**

Run (from the repository root): `npm run demo:fork`
Expected: the forge script completes and the summary prints `sigmaEstimator` and `etaE4` as in `shared/params-fables.json`, `pokes: 180`, a `minPokedPips` of 700 and a `maxPokedPips` above 700, `swaps: 36` and `swapReverts: 0`. The script stops with "reports and params name different estimators" if the reports were exported for another estimator. If `swapReverts` is 36, Fables gates direct swaps (see Task 6 Step 3): the run's evidence is then the `currentFee` series, and the session log and the app say so.

- [ ] **Step 5: Check the evidence against the hook's rule**

Run:
```bash
jq -e '[.pokedPips, .currentFee0For1Pips] | transpose | all(.[0] == .[1])' docs/evidence/fork-run-2026-10-07.json
```
Expected: `true` (Fables' hook charges exactly what ClimPoker posted, since clim never posts below Fables' flat fee). Each poke is 2 s after its report, so the override sent lasts 598 s (anchored to the observation).

- [ ] **Step 6: Commit**

```bash
git add contracts/script/v2 package.json docs/evidence/fork-run-2026-10-07.json docs/sessions
git commit -m "feat: recorded fork run, ClimPoker driving Fables' ETH/USDG hook through the 7 October storm"
```

### Task 9: ABIs, full suite and push

**Files:**
- Modify: `contracts/script/export-abis.sh`

- [ ] **Step 1: Export the v2 ABIs**

In `contracts/script/export-abis.sh`, add these lines to the `for artifact in` list (before `TestToken.sol/TestToken`):

```bash
  RiskDeskV2.sol/RiskDeskV2 \
  IRiskDeskV2.sol/IRiskDeskV2 \
  ClimFeePolicy.sol/ClimFeePolicy \
  ClimPoker.sol/ClimPoker \
  PokeFeeHook.sol/PokeFeeHook \
  IOverrideFeeHook.sol/ISymmetricPokeHook \
  IOverrideFeeHook.sol/IDirectionalPokeHook \
```

Run: `contracts/script/export-abis.sh`
Expected: the new files listed under `../shared/abis/`.

- [ ] **Step 2: Run the whole suite, with and without the fork**

Run:
```bash
forge test -q 2>&1 | tail -2
set -a; source .env; set +a; forge test -q 2>&1 | tail -2
forge fmt --check
```
Expected: without the RPC, all v1 and v2 unit tests pass and the fork suites skip; with it, the Fables fork suite passes too; `forge fmt --check` prints nothing (run `forge fmt` and commit if it does).

- [ ] **Step 3: Log and push**

Append to `docs/sessions/<today>.md`: the unit and fork test counts, the fork run summary (pokes, max fee posted, swaps, reverts), and any Task 6 finding. Then:

```bash
git add contracts/script/export-abis.sh shared/abis docs/sessions
git commit -m "chore(contracts): export clim x Fables ABIs"
git push
```
