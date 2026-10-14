# Security: the threat model of clim × Fables

What can go wrong with clim's contracts and its Chainlink CRE desk, what the contracts do about it, and the fee a pool
pays as a result. Every claim points at the code, a test or an evidence file. Test files: `contracts/test/v2/` (unit),
`contracts/test/fork/` (a Robinhood Chain mainnet fork against Fables' real ETH/USDG hook and AccessManager),
`cre/risk-desk/*.test.ts` (the workflow), `bots/test/live/` (the runner). clim × Fables is a showcase, not affiliated
with Fables; no external audit has been done.

Rerun every test cited here:

```bash
cd contracts && forge test                                                          # unit tests; the fork suites skip without an RPC
cd contracts && RH_MAINNET_RPC_URL=<archive RPC, chain 4663> forge test --match-contract 'FablesForkTest|Level2BatchForkTest'
cd cre/risk-desk && bun install && bun test
cd bots && bun test test/live
```

## 1. Who controls what

| Component | Controlled by | Can change | Cannot change | Where |
|---|---|---|---|---|
| `RiskDeskV2` (data) | its owner (on testnet: the deployer `0x53aB...5A82`, read with `cast call 0x63f543430982685387C83e4ec55E5a26fd1371Ef "owner()(address)" --rpc-url https://rpc.testnet.chain.robinhood.com`) | which forwarder and which workflow (id, author, name) it trusts; ending simulation mode, once | sigma or the gap: only `_processReport` writes the state | `contracts/src/v2/RiskDeskV2.sol`, `contracts/src/receiver/ReceiverTemplate.sol` |
| `ClimFeePolicy` (policy) | nobody | nothing: every parameter is `immutable` and there is no owner | | `contracts/src/v2/ClimFeePolicy.sol` |
| `ClimPoker` (action) | Fables' AccessManager (its `authority`) | who may call `poke`, `postEvent`, `postEventAndPoke` (Fables' roles) | the fee: `poke()` takes no argument and reads the policy | `contracts/src/v2/ClimPoker.sol` |
| `PokeFeeHook` (clim's testnet hook only) | clim's testnet AccessManager | pool configs (ADMIN), overrides (FEE_POKER) | | `contracts/src/v2/PokeFeeHook.sol` |
| CRE desk (simulation today) | clim's operator key, `RiskDeskV2.simOperator` | what is reported, within the desk's guards | anything outside the guards (section 2) | `cre/risk-desk/`, `shared/deployments/robinhood-testnet.json` (`cre`) |

clim holds no role on Fables' AccessManager and no admin power over `ClimPoker`: the batch Fables would send grants
roles to `ClimPoker` and to accounts, never to clim's admin ([`docs/integrate/README.md`](integrate/README.md),
level 2).

## 2. `RiskDeskV2`: what the desk accepts

| Guard | Rule (code) | Tests (`contracts/test/v2/RiskDeskV2.t.sol`) |
|---|---|---|
| Forwarder | only the configured forwarder calls `onReport` | `test_RevertWhen_NotTheForwarder` |
| Simulation operator | while `simMode`, `tx.origin` must be `simOperator` (the mock forwarder checks no signature) | `test_RevertWhen_SimOriginIsNotTheOperator` |
| Spacing | `tObs` at least `MIN_GAP` = 20 s after the last report | `test_RevertWhen_TooSoon`, `test_AcceptsAReportExactlyMinGapLater` |
| Clock skew | `tObs` at most `MAX_SKEW` = 30 s ahead of the block | `test_RevertWhen_FromTheFuture`, `test_AcceptsAReportExactlyMaxSkewAhead` |
| Quorum | at least `MIN_SOURCES` = 3 venues | `test_RevertWhen_TooFewSources` |
| Volatility envelope | per window, at most x2 up and x0.8 down per report, always within 10 %/yr to 1,000 %/yr | `test_EnvelopeAppliesToEachWindowSeparately`, `test_FirstReportIsClampedToTheAbsoluteBounds`, `testFuzz_AppliedSigmaStaysInTheEnvelope` |
| After an outage | a report more than `RESET_GAP` = 180 s after the last one gets only the absolute bounds, no ramp from a stale sigma | `test_ReportAfterAnOutageIsTakenAsIs`, `test_ReportExactlyResetGapLaterIsStillRamped` |
| Gap and multiplier | `devPips` clamped to +-1,000,000; `kE4` to 10,000 to 20,000 | `test_DevIsClamped`, `test_KIsClamped` |
| Venue disagreement | dispersion above `DISP_MAX_BP` = 25 bp sets `FLAG_DEGRADED` | `test_DegradedWhenVenuesDisagree`, `test_EmitsTheDegradedFlag` |

**The owner.** The owner cannot set sigma or the gap, but it picks the forwarder and the workflow, which decides what
gets reported (`setForwarderAddress`, `setExpectedWorkflowId`, `setExpectedAuthor`, `setExpectedWorkflowName` in
`ReceiverTemplate.sol`). So once the desk is configured, its ownership goes to a timelock or is renounced. The
template is one-step `Ownable`: a transfer to a wrong address is final. Today, on testnet, the owner is the deployer
key.

**Leaving simulation.** `disableSim(prodForwarder)` requires a non-zero forwarder and a pinned workflow (an expected
id or author), sets the forwarder and switches `simMode` off in the same call; nothing switches it back on.
Tests: `test_DisableSimIsOwnerOnly`, `test_RevertWhen_DisableSimWithoutAForwarder`,
`test_RevertWhen_DisableSimWithoutAPinnedWorkflow`, `test_DisableSimSwitchesToTheProductionForwarderAtOnce`,
`test_DisableSimAcceptsAPinnedAuthorAlone`.

**A compromised operator key (simulation mode).** It can write any report the guards accept: sigma anywhere in 10 to
1,000 %/yr (at once after 180 s of silence, otherwise doubling at most every 20 s) and any gap. The fee that results
still stays inside the policy's band, 700 to 6,000 pips (7 to 60 bp) on the testnet policy
(`testFuzz_FeeAlwaysWithinBounds` in `ClimFeePolicy.t.sol`), and it cannot lower a live event override of Fables'
keeper (section 4). On a DON this key is gone: the KeystoneForwarder accepts only reports signed by the DON.

## 3. `ClimFeePolicy`: the fee

`fee = clamp(ceil(eta * k * sigma * sqrt(dtEff / 2)), floor, cap)` (`ClimFeeMath.sol`), with every parameter
immutable and taken from [`shared/params-fables.json`](../shared/params-fables.json). Tests in
`contracts/test/v2/ClimFeePolicy.t.sol`:

- Bounds: the fee stays in `[floor, cap]` for any desk state: `testFuzz_FeeAlwaysWithinBounds`,
  `testFuzz_UnclampedKStaysWithinBounds`; invalid parameters revert at deployment: `test_RevertWhen_InvalidParams`.
- Modes: normal; degraded (venues disagree), at least the safe fee: `test_DegradedChargesAtLeastSafe`; blind (no
  report for more than `tauKillSec`, or none yet): `test_BlindWhenSilentOrNeverReported`,
  `test_FreshUntilTauKillThenBlind`.
- Direction: the premium goes to the side the gap makes toxic, for either currency order, and is capped by
  `dirMaxPremiumPips` and by the cap: `test_DirectionalPremiumOnTheToxicSide`,
  `test_DirectionalPremiumWhenEthIsToken1`, `test_DirectionalPremiumIsCappedTwice`, `test_NoPremiumWhenDisabled`.

## 4. `ClimPoker`: the action

Tests in `contracts/test/v2/ClimPoker.t.sol` unless named otherwise.

- **Only the roles Fables grants.** `poke`, `postEvent` and `postEventAndPoke` are `restricted` by Fables'
  AccessManager: `test_RevertWhen_AStrangerPokes`, `test_RevertWhen_AStrangerPostsAnEvent`,
  `test_RevertWhen_TheRunnerPostsAnEvent`, `test_FablesKeeperCanPokeToo`; on the fork,
  `test_AStrangerCannotOverwriteTheKeepersOverride` (`FablesFork.t.sol`) and `test_AStrangerCannotSendTheBatch`
  (`Level2Batch.t.sol`).
- **No caller chooses the fee.** `poke()` has no parameter; the fee is the policy's, composed with Fables' event as
  `max(policy fee, event fee)` per side, the event clamped to the policy's cap and living at most 72 h:
  `test_EventOverrideComposesWithMax`, `test_EventFeeIsClampedToThePolicyCap`, `test_ExpiredEventIsIgnored`,
  `test_RevertWhen_EventExpiryIsBeyondMaxTtl`, `test_PostEventAndPoke`; on the fork, `test_EventOverrideOnTop` and
  `test_KeeperPostsAnEventAndPokesInOneCall`.
- **A blind desk means no poke.** `test_RevertWhen_DeskIsBlind`; on the fork, `test_BlindDeskDoesNotPoke`.
- **TTL anchored to the observation.** The override ends at `tObs + ttl`, never lasts more than `ttl`, ends with an
  event that raised it, and lasts at least 1 s: `test_TtlIsAnchoredToTheObservation`,
  `test_TtlFromAFutureObservationNeverExceedsTheConfiguredTtl`, `test_TtlIsLimitedByARaisingEvent`,
  `test_TtlIgnoresAnEventBelowTheDeskFee`, `test_TtlIsAtLeastOneSecond`; `ttl` itself is 1 s to 72 h:
  `test_RevertWhen_ConfigIsInvalid`.
- **The hook has the last word.** A fee the hook refuses reverts the whole poke: `test_RevertWhen_TheHookRejectsTheFee`;
  on the fork, against Fables' real hook, `test_PokeAboveALoweredHookCapReverts`.
- **Revocation is one call.** Revoking FEE_POKER from the poker stops every poke: `test_RevokedRoleStopsPokes`
  (`FablesFork.t.sol`), `test_RevocationStopsEveryPoke` (`Level2Batch.t.sol`).
- **Events for indexers.** `Poked` carries what was sent and who sent it: `test_PokedEventCarriesWhatWasSent`,
  `test_EventPostedCarriesTheSender`, `test_DegradedDeskPokesAtLeastTheSafeFee`.

**A compromised runner key** (CLIM_RUNNER) can call `poke()` as often as it pays gas for; each call sends the policy's
current fee and cannot extend the override past `tObs + ttl`. **A compromised keeper key** gains nothing through
`ClimPoker` that FEE_POKER on the hook does not already give it: its events can only raise a side, up to the policy's
cap, for at most 72 h.

## 5. `PokeFeeHook`: clim's testnet hook

`PokeFeeHook` runs clim's live reference pools D, K and F on Robinhood Chain testnet. It is an independent
implementation written from Fables' published ABI and documented behavior; no Fables code is copied, and it never
touches Fables' pools. Rule: the flat fee; under a live override, `max(override, max(floor, flat / 2))`; never above
the cap. Tests in `contracts/test/v2/PokeFeeHook.t.sol`: `test_FlatFeeWithoutPoke`, `test_SymmetricPokeIsCharged`,
`test_DirectionalPokeIsChargedPerSide`, `test_PokeBelowHalfTheFlatIsRaisedToIt`, `test_PokeExpiresBackToFlat`,
`test_ClearPoke`, `test_RevertWhen_OutOfBoundsOrBadTtl`, `test_RevertWhen_CallerLacksTheRole`,
`test_RevertWhen_AStrangerConfiguresAPool`, `test_RevertWhen_PoolConfigIsInvalid`,
`test_RevertWhen_PoolKeyUsesAnotherHook`, `test_RevertWhen_PoolIsNotConfigured`; its `FeePoked` topics equal Fables':
`test_EventTopicsMatchFablesSignatures`, and on the fork `test_FeePokedTopicMatchesPokeFeeHook`.

**The keeper key can poke any pool on clim's testnet hook.** One AccessManager guards the hook, and roles are per
function, not per pool: FEE_POKER (held by the keeper-style bot's key `0xD211...52dA` and by `ClimPoker`) may call
both `pokeFee` and `clearPoke` for any pool, D included, and `postEvent` on `ClimPoker`. The bot only pokes K. Read it
on chain:

```bash
RPC=https://rpc.testnet.chain.robinhood.com; AM=0x61859758b20441995FCDb8b8BC144B1eBEeC2e3E; HOOK=0xBb4afdfd08921e0731199e565eC11724B09b9080
cast call $AM "getTargetFunctionRole(address,bytes4)(uint64)" $HOOK $(cast sig "pokeFee(bytes32,uint24,uint24,uint40)") --rpc-url $RPC   # 1
cast call $AM "getTargetFunctionRole(address,bytes4)(uint64)" $HOOK $(cast sig "clearPoke(bytes32)") --rpc-url $RPC                       # 1
cast call $AM "hasRole(uint64,address)(bool,uint32)" 1 0xD211632FA3db919f874eED688A0908a2a2a652dA --rpc-url $RPC                         # true 0
```

On Fables' side the same holds for their three FEE_POKER keys and their hooks; that is their configuration.

## 6. The CRE path

**Today: simulation.** The workflow runs in the CRE simulator (`cre workflow simulate --broadcast`), one node, on the
maintainer's Mac. Its report goes through the `MockKeystoneForwarder` (`0x0b93...3885`), which checks no signature,
so the trust anchor is the operator EOA: `RiskDeskV2` accepts a report only when `tx.origin` is `simOperator`
(`0x636D...5C07`). On chain today: `simMode()` is `true`, `getForwarderAddress()` is the mock forwarder, no workflow
is pinned.

**Later: a DON.** Once DON deploy access is granted (requested 2026-10-06, pending): deploy the workflow, pin it
(`setExpectedWorkflowId`, or `setExpectedAuthor` with a name), call `disableSim(KeystoneForwarder)`, which switches
forwarder and mode in one transaction, then hand ownership to a timelock or renounce it. The KeystoneForwarder for
`robinhood-testnet` is `0x8E6E...AF19` (`shared/deployments/robinhood-testnet.json`).

**What the workflow checks before it reports** (`cre/risk-desk/`): a venue counts only if its last closed candle is at
most 120 s old (`isFresh` in `estimator.test.ts`); at least 3 of 4 must count, otherwise no report ("no report when
fewer than 3 venues answer", `workflow.test.ts`); the farthest venue from the median sets the dispersion (degraded
above 25 bp); the run skips if the desk's last report is under 20 s old ("skips when the last report is younger than
MIN_GAP (20 s)"); an unreadable pool gives a gap of 0, so no directional premium ("pool unreadable: devPips 0").

## 7. Failure modes and the fee that results

"Flat" is the hook's flat fee: 7 bp on Fables' ETH/USDG pool, 700 pips on clim's testnet pools.

| Failure | What happens | Fee on a pool driven by `ClimPoker` | Proof |
|---|---|---|---|
| One venue stale or down, 3 still fresh | the desk reports from the 3 | normal | `estimate` "median-close: 3 fresh venues out of 4" (`estimator.test.ts`) |
| Fewer than 3 fresh venues | no report; the desk ages | as "desk silent" below | "no report when fewer than 3 venues answer" (`workflow.test.ts`); `test_RevertWhen_TooFewSources` |
| Venues disagree by more than 25 bp | `FLAG_DEGRADED`; the policy is degraded | at least the safe fee (30 bp), still poked | `test_DegradedWhenVenuesDisagree`, `test_DegradedChargesAtLeastSafe`, `test_DegradedDeskPokesAtLeastTheSafeFee` |
| Desk silent (CRE outage, Mac asleep or offline, operator out of gas) | blind after `tauKillSec` (180 s); `poke()` reverts `DeskBlind` | the last poke's fee until `tObs + 600 s`, then flat | `contracts/test/v2/Outage.t.sol` (6 tests); on the fork `test_BlindDeskDoesNotPoke`, `test_OverrideExpiresBackToFablesFlatFee`; the live drill of 2026-10-14 (814 s outage, pool D at 700/700 pips during it), [`docs/sessions/2026-10-14.md`](sessions/2026-10-14.md) |
| Desk back after more than 180 s | the first report is taken as is, no ramp | normal from the next poke | `test_ReportAfterAnOutageIsTakenAsIs`, `test_FirstReportAfterTheOutageIsTakenAsIsAndPokesAgain` |
| Runner bot down, desk running | no poke | the last poke's fee until `tObs + 600 s`, then flat | `test_PoolDKeepsItsLastOverrideUntilItsTtlThenFallsBackToFlat` |
| A lagging RPC node makes the runner's poke simulation revert `DeskBlind` | the runner retries 3 times, 2 s apart, then skips that report | the next report is poked | "waits 2 s and simulates again until the node catches up", "still DeskBlind after 3 retries" (`bots/test/live/runner.test.ts`) |
| Report delivered late but accepted | the override is anchored to `tObs` | ends at `tObs + 600 s` | `test_TtlIsAnchoredToTheObservation` |
| Report with a future `tObs` (up to 30 s) | accepted; fresh until `tObs + 180 s` | the override never lasts more than 600 s | `test_AcceptsAReportExactlyMaxSkewAhead`, `test_TtlFromAFutureObservationNeverExceedsTheConfiguredTtl` |
| Report more than 30 s ahead, or under 20 s after the last | rejected | unchanged | `test_RevertWhen_FromTheFuture`, `test_RevertWhen_TooSoon` |
| Forged report (another forwarder or origin) | rejected | unchanged | `test_RevertWhen_NotTheForwarder`, `test_RevertWhen_SimOriginIsNotTheOperator` |
| Fables lowers the hook's cap below the policy's (or raises its floor above) | a poke outside the new band reverts in the hook | the last override until it expires, then flat | `test_PokeAboveALoweredHookCapReverts` (fork, cap lowered to 3,000 pips) |
| Fables revokes FEE_POKER from `ClimPoker` | every poke reverts | the last override until it expires, then flat | `test_RevokedRoleStopsPokes`, `test_RevocationStopsEveryPoke` |
| Desk blind while Fables' keeper wants to post an event | `postEventAndPoke` reverts `DeskBlind`; `postEvent` alone records the event | the keeper pokes the hook directly meanwhile; the first poke after the desk is back sends `max(clim, event)` | `test_WhileBlindTheKeeperCanStillPostAnEvent` |
| Chain reorganization | not covered by a test | `ClimPoker` reads the desk in the same transaction as it pokes (`_poke` calls `policy.quoteDirectional()`), so a poke never applies a report from another branch; a reorganized report or poke disappears with its block, the hook keeps what the canonical chain wrote, and the next report and poke rewrite it | code: `ClimPoker._poke` |

## 8. Documented design choices

- **Last writer wins in the hook's one override slot.** Fables' hook keeps one override per pool. If the keeper keeps
  poking the hook directly while CLIM_RUNNER pokes through `ClimPoker`, each overwrites the other, and a clim poke can
  replace a higher keeper override with clim's lower fee: `test_ADirectKeeperPokeIsOverwrittenByTheNextClimPoke`
  (`Level2Batch.t.sol`). The intended setup routes the keeper's event overrides through `postEvent` /
  `postEventAndPoke`, where they compose as `max`: `test_AnEventPostedThroughThePokerSurvivesTheNextClimPoke`.
- **The policy's band sits inside the hook's band (deployment invariant).** The testnet policy's band is 700 to
  6,000 pips; Fables' ETH/USDG hook takes 100 to 6,000 (spec §2). If Fables lowers the cap or raises the floor past
  the policy's, pokes outside the new band revert (section 7); redeploy the policy with the new band.
- **Desk owner: timelock or renounce.** Section 2. Until then, the owner key is trusted with the forwarder and the
  workflow choice.
- **Blind is not degraded.** Blind (no report for more than 180 s) means no poke at all and a return to flat when the
  last override expires; degraded (venues disagree beyond 25 bp) still pokes, at least the safe fee (30 bp).
- **A one-fee hook gets the higher side.** A symmetric `ClimPoker` sends the higher of the two directional fees to
  both directions (`test_SymmetricPokeSendsTheHigherSideToTheOldHook`), so a directional premium would raise the fee
  both ways. Keep `dirSlopeE4 = 0` for ETH/USDG until it moves to a per-direction hook; the recorded fork run does
  (`contracts/script/v2/ForkRun.s.sol` forces both directional parameters to 0). Pool D on testnet is per-direction
  (`ClimPoker.directional()` is `true`), so the premium is live there.
- **A future `tObs` up to 30 s** extends the desk's freshness window by as much; the override sent to the hook is
  still capped at `ttl` (section 7).
- **The keeper key can poke any pool on clim's testnet AccessManager** (section 5).
- **Simulation trusts one EOA** (section 6).

## 9. Out of scope

- Fables' own contracts and keys: their hook's source, verified on Sourcify, is UNLICENSED and never copied; clim
  uses only their published ABI (`contracts/src/v2/interfaces/IOverrideFeeHook.sol`).
- Whether clim's fee is the right fee: that is the lab's question, published as measured in `lab/out/`, including
  where Fables' keeper does better. Nothing here claims clim sets better fees.
- Ordering inside a block: a swap pays the fee the hook holds when it executes (`test_ASwapPaysThePokedFee`, fork);
  clim does not try to land a poke before any given swap.
- The CRE platform (DON consensus, the forwarders' signature checks) and the venues' APIs.
- clim's testnet tokens, routers and bots, which hold no value, and the frozen v1 contracts on Ethereum Sepolia (tag
  `token2049-submission` of DVB-ANS/clim).
