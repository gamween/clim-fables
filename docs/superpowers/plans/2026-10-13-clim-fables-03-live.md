# clim × Fables plan 03: the live desk and reference pools on Robinhood Chain testnet

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run clim's Chainlink CRE desk v2 every 30 s on Robinhood Chain testnet, feeding three live reference pools (D driven by `ClimPoker`, K poked by a keeper-style bot, F flat 7 bp) that bots trade against real venue prices, with every contract verified on Sourcify and Blockscout, gas measured, the processes supervised by launchd on the maintainer's Mac with every outage handled and recorded, and the Sepolia v1 stack stopped at the end.

**Architecture:** The lab first measures which volatility estimator the live desk can compute (the lab's own uses Binance 1 s prices, the desk reads four venues' 1-minute candles) and re-decides `etaE4` for it. Foundry scripts deploy our AccessManager, an independent `PokeFeeHook` hosting the three pools of test tokens, `RiskDeskV2`, `ClimFeePolicy` and a directional `ClimPoker`, first on an anvil fork of the testnet, then on the testnet. The CRE workflow `cre/risk-desk` becomes v2 (two volatility windows, the venue-versus-pool gap, a config switch for the target pool) and runs in the CRE simulator with `--broadcast`; Bun bots (runner, keeper, arbitrage, retail) and a status script run beside it. The long-running processes run on the maintainer's Mac as launchd LaunchAgents; they resume cleanly after a sleep, a reboot, a network loss or a crash, and an outage record derived from the desk's on-chain reports shows every gap.

**Tech Stack:** Python 3.12 + numpy (lab, uv), Foundry (solc 0.8.26) + Uniswap v4 + OpenZeppelin 5.5, Chainlink CRE TypeScript SDK 1.23.0 + CRE CLI v1.37.0, Bun 1.3.9 + viem 2.57.3 (bots, shared).

Spec: `docs/superpowers/specs/2026-10-13-clim-fables-design.md` §2, §4, §5.2, §5.7, §5.8. Master plan: `docs/superpowers/plans/2026-10-13-clim-fables-00-master.md` Task 4. Conventions and facts from plans 01 and 02.

**Gate (master plan, Task 4):** CRE desk reporting on Robinhood testnet; pools D, K, F live with bots; contracts verified on Sourcify and Blockscout; Sepolia bots stopped.

---

## Facts used by this plan (checked on 2026-10-13)

Robinhood Chain testnet (chain id `46630`, settles to Ethereum Sepolia, about 0.1 s blocks, 1 s timestamps), read with `cast`:

| Item | Value | Check |
|---|---|---|
| Public RPC | `https://rpc.testnet.chain.robinhood.com` | `cast chain-id` = 46630 |
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | 24,009 bytes of code |
| StateView (same address on mainnet) | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` | 3,531 bytes; `poolManager()` = the PoolManager |
| CREATE2 deployer (forge `CREATE2_FACTORY`) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | 69 bytes |
| Multicall3 (viem `robinhoodTestnet`) | `0xcA11bde05977b3631167028862bE2a173976CA11` | 3,808 bytes |
| MockKeystoneForwarder (CRE simulation) | `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` | `typeAndVersion()` = "MockKeystoneForwarder 1.0.0"; the address is inside the CRE CLI v1.37.0 binary |
| KeystoneForwarder (DON) | `0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19` | 8,591 bytes |
| PoolSwapTest, PoolModifyLiquidityTest | not looked up | we deploy our own (Task 6), as v1 did for its arbitrage router, so the routers are ours and verified |
| Gas price | base fee 10,000,000 wei (0.01 gwei); a plain transfer estimates 24,338 gas | `cast gas-price`, `cast estimate` |
| CRE chain name and selector | `robinhood-testnet`, `2032988798112970440` | `@chainlink/cre-sdk` 1.23.0 `generated/networks.js`; the CLI binary lists the name |
| Deployer `0x53aB240f6cffC204FC22ac6722D9632d753a5A82` | 0.8635 Sepolia ETH, 0 testnet ETH | `cast balance` |

Funding route (Sepolia ETH to Robinhood Chain testnet), verified on Sepolia with read-only calls:

| Item | Value |
|---|---|
| Delayed Inbox (Sepolia) | `0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4`, `bridge()` = `0x96295BDad104eaD97cC08797b3dC68efF59CcF30` |
| Bridge → Rollup | `rollup()` = `0xdc5F8E399DBd8a9F5F87AeC4C23Beb12431b386D`, whose `chainId()` = 46630 |
| State | `paused()` = false; `nativeToken()` reverts (ETH is the gas token) |
| `depositEth()` | `cast call --value 0.01ether` returns a message number (683,991 on 2026-10-13); `cast estimate` 195,136 gas. An EOA deposit credits the same address on L2 (no aliasing for EOAs). Robinhood's docs give about 10 minutes for a deposit |
| Sources | Robinhood docs, contracts page, testnet L1 table (https://docs.robinhood.com/chain/contracts); the Arbitrum bridge UI with this chain (https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain-testnet&sourceChain=sepolia); faucet https://faucet.testnet.chain.robinhood.com (listed by https://docs.orbitflare.com/robinhood-chain.md) |

Venue APIs for sub-minute data (probed 2026-10-13):

| Venue | Sub-minute candles | History over 2026-09-07 to 2026-10-12 |
|---|---|---|
| Binance | yes: `api/v3/klines?interval=1s` (also on `data-api.binance.vision`) | daily 1 s and 1 m zips on `data.binance.vision` |
| Coinbase | no: `granularity=ONE_SECOND` is rejected ("not a valid value"); its trades endpoint returns at most 100 trades (about 2 minutes) | 1-minute candles via `api.exchange.coinbase.com/products/ETH-USD/candles?granularity=60` (300 per call) |
| Kraken | no: OHLC intervals start at 1 minute (`interval=0` gives `EGeneral:Invalid arguments`) | OHLC serves only its last 720 candles; the `Trades` endpoint serves history (1,000 trades per call, about 30 minutes of ETHUSD per call), from which 1-minute OHLC is rebuilt |
| Hyperliquid | no: `interval: "1s"` fails to deserialize | `candleSnapshot` serves only its last 5,000 candles (a 2026-09-07 request returns `[]`), so it cannot be replayed over the window |

Gas measured in v1 (Sepolia, `bots/out/cre-runs.jsonl` and the running Sepolia arbitrage log): CRE report through the mock forwarder median 175,253 gas (14,663 runs); arbitrage swap median 160,193 gas (12,203 receipts).

Contracts as built (plan 02, `contracts/src/v2/`):
- `RiskDeskV2(address forwarder, address simOperator)`; report `abi.encode(uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 dispBp, uint8 nSources, uint16 kE4)`; `state()` returns `(uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 kE4, uint8 flags, uint32 seq)`; event `RiskReportedV2(uint32 indexed seq, uint40 tObs, uint32 sigma15Applied, uint32 sigma5Applied, uint32 sigma15Reported, uint32 sigma5Reported, int32 devPips, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 flags)`; `MIN_GAP` 20 s, `MAX_SKEW` 30 s, `MIN_SOURCES` 3, `DISP_MAX_BP` 25, `DEV_MAX_PIPS` 1,000,000, `K_MIN_E4` 10,000.
- `ClimFeePolicy(IRiskDeskV2 desk, Params p)`, `Params = (uint32 etaE4, uint32 sqrtHalfDtE6, uint24 floorPips, uint24 capPips, uint24 safePips, uint32 tauKillSec, bool shortWindow, uint32 dirSlopeE4, uint24 dirMaxPremiumPips, bool ethIsToken0)`; `quote()`, `quoteDirectional()` → `(uint24 fee0For1, uint24 fee1For0, uint8 mode)`, `lastObservation()`; modes 0 normal, 1 degraded, 2 blind.
- `ClimPoker(ClimFeePolicy policy, address hook, bytes32 poolId, bool directional, uint40 ttl, address authority)`; `poke()`, `postEvent(...)`, `postEventAndPoke(...)` are `restricted`; event `Poked(uint32 indexed seq, uint40 tObs, uint24 fee0For1, uint24 fee1For0, uint8 mode, bool eventApplied, uint40 expiry, address caller)`; error `DeskBlind()`.
- `PokeFeeHook(IPoolManager poolManager, address authority)`, flags `AFTER_INITIALIZE | BEFORE_SWAP`; `setPoolConfig(PoolKey, floor, flat, cap)`, `pokeFee(bytes32,uint24,uint40)`, `pokeFee(bytes32,uint24,uint24,uint40)`, `clearPoke(bytes32)` are `restricted`; `currentFee(bytes32,bool)`; under a live poke the fee is `max(poke, max(floor, flat / 2))`, capped.
- AccessManager roles used by `ForkRun.s.sol`: FEE_POKER `1` (the hook's `pokeFee` and `clearPoke`, ClimPoker's `postEvent` and `postEventAndPoke`), CLIM_RUNNER `7` (ClimPoker's `poke`). Functions with no role assigned need ADMIN (`0`), held by the AccessManager's initial admin.
- `TestToken` has 18 decimals hard-wired; the brief asks for tUSDG with 6 decimals like USDG, hence `TestTokenDecimals` (Task 4).
- `shared/params-fables.json` (plan 01): `etaE4` 175,198, `sqrtHalfDtE6` 850,890, `sigmaWindowSec` 300, floor 700, cap 6,000, safe 3,000, `tauKillSec` 180, `pokeTtlSec` 600, `dirEnabled` true with `dirStatus` "experimental" (plan 01 review r2), `dirSlopeE4` 2,753, `dirMaxPremiumPips` 567. Task 2 may change `etaE4` and adds `sigmaEstimator`.

Checked while writing this plan, on scratch copies outside the repository (nothing sent to a real chain): the plan's contracts and scripts compile and the contracts suite gives 156 passed, 3 skipped; `deploy-live.sh` then `live-smoke.sh` run clean on an anvil fork of the testnet (anvil's public test keys); the CRE workflow's 48 tests pass, `tsc` and `cre workflow build` succeed, and dry runs of `rh-testnet-settings` and `rh-shadow-settings` complete in the CRE simulator on `robinhood-testnet` (the shadow run read Fables' mainnet pool at 2,507.48 against a venue mid of 2,506.55, devPips -369); `shared` gives 72 tests passing and `bots` 91, both typecheck; the runner, keeper, arbitrage, retail, fund, status, gas and verify scripts ran against a fork answering as chain 46630; `study_estimator.py` reproduced study 2's `binance-1s` result on stand-in minute data. Task 23 (added 2026-10-14) was checked the same way on a scratch copy: `shared` 77 and `bots` 111 tests pass and both typecheck, the six generated plists pass `plutil -lint`, the supervised loop was run with a forced 120 s clock jump and a streak of failing ticks (it wrote the `wake` and `rpc-errors` records and backed off 2, 4, 8 s), and `Outage.t.sol` passes (6 tests) beside the contracts suite; no launchd job was installed. Code blocks below are those versions.

The running Sepolia v1 stack lives in another checkout, `/Users/fianso/Development/hackathons/clim/bots` (processes `bun run cre-loop --pair live`, `bun src/sim-loop.ts --pair live`, `bash scripts/sim-loop.sh staging-settings --broadcast`, `bun run arb --pair live`, `bun run noise --pair live`, `bun run status --pair live --watch`). Nothing in this repository is running, so `cre/risk-desk` is changed in place (its Sepolia version stays at tag `token2049-submission` and in that checkout). Every v2 process started by this plan has a command line without `--pair live` and without `staging-settings`, so the shutdown patterns of Task 26 can never hit it.

## Decisions taken in this plan (beyond the brief)

- **Keys.** Six testnet keys, so no two processes share a nonce:

| Key | Where | Role on testnet |
|---|---|---|
| Deployer `0x53aB…5A82` | `contracts/.env` `PRIVATE_KEY`, copied to `bots/.env` `DEPLOYER_PRIVATE_KEY` | deploys; AccessManager admin (role 0, so `setPoolConfig`); TestToken owner (mints); funds the others |
| CRE operator | `cre/.env` `CRE_ETH_PRIVATE_KEY` (64 hex, no `0x`), new | `RiskDeskV2.simOperator`: sends every report through the mock forwarder |
| Runner | `bots/.env` `RUNNER_PRIVATE_KEY`, new | CLIM_RUNNER: calls `ClimPoker.poke()` after each new desk report |
| Keeper | `bots/.env` `KEEPER_PRIVATE_KEY`, new | FEE_POKER on our AccessManager: pokes pool K. FEE_POKER is per function, not per pool, so this key could poke D or F too; only the keeper bot holds it and it pokes K only (stated in `docs/security.md` by plan 04) |
| Arbitrage | `bots/.env` `ARB_RH_PRIVATE_KEY`, new | trades D, K, F back to the venue price through its own router |
| Retail | `bots/.env` `NOISE_RH_PRIVATE_KEY`, new | mirrored retail flow on D, K, F |

- **Three pools, one hook.** The PoolKeys share currencies, the dynamic-fee flag and the hook, so they differ by tick spacing: D 10 (Fables' ETH/USDG spacing), K 11, F 12. Each gets the same full-range liquidity L, so spacing does not change their prices.
- **Config of each pool on the hook:** Fables' ETH/USDG config, floor 100, flat 700, cap 6,000 pips. The policy band (700 to 6,000) sits inside it, as the security notes require.
- **D's policy** uses the measured per-direction premium (`dirSlopeE4`, `dirMaxPremiumPips` from `shared/params-fables.json`, `dirEnabled` true), `directional = true`, and `ethIsToken0` from the deployed token order. `dirStatus` is `experimental` (the rule clears its gate on the five weeks pooled but in 3 of 5 weeks only): pool D shows it running, and plan 04 labels it experimental wherever it appears.
- **devPips target** is a config switch in the workflow: `pool.source = "evm"` reads pool D's slot0 on Robinhood testnet with the CRE EVM read capability; `pool.source = "http"` reads Fables' mainnet ETH/USDG pool with a JSON-RPC `eth_call` over the HTTP capability (shadow mode: a read, never a write). The shadow target writes to a placeholder desk (`0x…dEaD`) and is run as a dry run only.
- **Venue mid** for devPips is the median of real-time tickers (USD, Binance converted with Kraken's USDT/USD, v1's source; the lab converts with Coinbase's USDT-USD 1-minute closes, the same market on another venue), as the lab used 1 s prices; with fewer than 3 tickers it falls back to the median 1-minute close. If the pool cannot be read, devPips is 0 (no directional premium), and the log says so.
- **The volatility estimator** is a workflow config field (`sigmaEstimator`) with all three candidates implemented and tested, synced from `shared/params-fables.json`, so the CRE tasks are the same whichever estimator Task 2 picks.
- **Public RPCs** for the testnet everywhere (deploy, CRE, bots), so no keyed URL appears in a command or a log; `bots/.env` may override `RH_TESTNET_RPC_URL` if the public endpoint rate-limits.
- **Runs on the maintainer's Mac** (his decision, 2026-10-14), not on a server: six launchd LaunchAgents `fi.clim-fables.<name>` (desk, runner, keeper, arb, noise, outages), installed at go-live (Task 25). The Mac's sleep is his (his Pauline app owns `pmset disablesleep`): nothing in this plan keeps the Mac awake (no `caffeinate`, no `pmset`). Outages are handled (resume after a wall-clock jump, nonce re-sync, stale actions dropped, capped backoff) and recorded from the chain in `bots/out/outages.json` (Task 23); plan 04's app shows those windows as measured.

## File structure

| File | Responsibility |
|---|---|
| `lab/clim_lab/venue.py` (modify) | Add 1-minute OHLC per venue (`MinuteOhlc`), OHLC from trades, the median-close and range (Parkinson) estimators |
| `lab/clim_lab/policy.py` (modify) | Add `choose_estimator`, the written decision rule |
| `lab/scripts/fables_fetch.py` (modify) | Add `binance1m`, `coinbase1m`, `kraken1m` fetches |
| `lab/scripts/study_estimator.py` (create) | The estimator measurement (Task 2) → `lab/out/fables-estimator.json` |
| `lab/scripts/decide_fables_params.py` (modify) | `etaE4` and `sigmaEstimator` from the estimator study |
| `lab/scripts/export_keeper_map.py` (create) | Keeper fee by 5-minute volatility → `shared/keeper-map-fables.json` |
| `lab/tests/test_venue.py`, `test_policy.py`, `test_fables_outputs.py` (modify) | Tests of the above |
| `contracts/src/test-tokens/TestTokenDecimals.sol` (create) | TestToken with chosen decimals (tUSDG 6) |
| `contracts/script/v2/base/LiveScript.sol` (create) | Testnet addresses, roles, fragment I/O, price helper, mainnet guard |
| `contracts/script/v2/10_LiveTokens.s.sol` … `14_LiveWriteDeployments.s.sol` (create) | Tokens and routers; AccessManager and hook; pools; desk, policy, poker and roles; merged deployments file |
| `contracts/script/v2/deploy-live.sh`, `live-smoke.sh`, `verify-live.sh` (create) | Run the deploy scripts, smoke-test a fork, verify on Sourcify and Blockscout |
| `contracts/test/TestTokenDecimals.t.sol`, `contracts/test/v2/LiveScript.t.sol` (create) | Unit tests |
| `shared/src/live.ts`, `shared/src/abisV2.ts` (create) | Parser of `shared/deployments/robinhood-testnet.json`; typed v2 ABI fragments |
| `cre/risk-desk/{venues,estimator,pool,report,workflow}.ts` (modify/create) | Desk v2: OHLC and tickers, three estimators, pool mid, v2 report, workflow |
| `cre/risk-desk/config.{testnet,shadow,production}.json`, `workflow.yaml`, `../project.yaml`, `scripts/sync-config.ts` | Targets `rh-testnet-settings`, `rh-shadow-settings`, `rh-production-settings` |
| `bots/src/live/lib/*.ts` (create) | Env, deployments loader, chain reads, directional arbitrage, retail flow, keeper map, env-file merge, log tail, gas summary |
| `bots/src/live/{desk-loop,runner,keeper,arb,noise}.ts` (create; Task 23 modifies) | The five live processes; Task 23 adds resume after a wall-clock jump, nonce re-sync, stale-action drops and backoff |
| `bots/src/live/scripts/{keys,fund,status,gas,verify-live}.ts` (create) | Keys, funding, status (Task 23 adds the launchd jobs and the outage record), gas evidence, final on-chain checks |
| `shared/src/outages.ts` (create) | Outage windows from consecutive `RiskReportedV2` reports, for the bots and plan 04's app |
| `bots/src/live/lib/{supervise,supervisor,outages,launchd}.ts` (create) | Wake detection and backoff (pure), the supervised loop and local outage records, the outage scan state, the launchd plist generator |
| `bots/src/live/scripts/{outages,launchd}.ts` (create) | `bots/out/outages.json` from the chain; install, uninstall, logs and print of the LaunchAgents |
| `cre/scripts/sim-loop.sh` (modify) | `CRE_BIN`, the CRE CLI's absolute path for the launchd desk job |
| `contracts/test/v2/Outage.t.sol` (create) | Pools D, K, F during an outage and after it |
| `docs/runbook.md`, `cre/README.md`, `docs/feedback/cre-friction-log.md`, `docs/sessions/*.md` (modify) | Operations and records |

---

## Part A: the estimator decision (lab)

### Task 1: Lab, the desk-feasible volatility estimators

**Files:**
- Modify: `lab/clim_lab/venue.py` (append after `rv_window`)
- Modify: `lab/clim_lab/policy.py` (append)
- Test: `lab/tests/test_venue.py` (append), `lab/tests/test_policy.py` (append)

- [ ] **Step 1: Write the failing tests for the venue estimators**

Append to `lab/tests/test_venue.py`:

```python
# --- desk-feasible estimators (plan 03 Task 1) ---


def _ramp_venue(t0, n, scale=1.0, half_range=0.001):
    """Closes 2000 * exp(0.001 i), high/low at +-half_range in log around the close."""
    rows = []
    for i in range(n):
        c = 2000.0 * math.exp(0.001 * i) * scale
        rows.append([t0 + 60 * i, c, c * math.exp(half_range), c * math.exp(-half_range), c])
    return venue.ohlc_from_rows(rows)


def test_ohlc_from_rows_fills_empty_minutes_with_the_previous_close():
    v = venue.ohlc_from_rows([[0, 10, 11, 9, 10], [120, 12, 13, 11, 12]])
    assert list(v.open_t) == [0, 60, 120]
    assert list(v.close) == [10, 10, 12]
    assert list(v.high) == [11, 10, 13]
    assert list(v.low) == [9, 10, 11]


def test_ohlc_from_rows_converts_a_usdt_venue_with_the_last_closed_rate():
    usdt = MinuteSeries(np.array([60, 120], dtype=np.int64), np.log(np.array([0.5, 0.25])))
    v = venue.ohlc_from_rows([[0, 10, 12, 8, 10], [60, 10, 12, 8, 10]], usd_per_quote=usdt)
    assert list(v.close) == pytest.approx([5.0, 2.5])
    assert list(v.high) == pytest.approx([6.0, 3.0])


def test_ohlc_from_rows_rejects_bad_input():
    with pytest.raises(ValueError):
        venue.ohlc_from_rows([])
    with pytest.raises(ValueError):
        venue.ohlc_from_rows([[30, 1, 1, 1, 1]])


def test_ohlc_from_trades_builds_minutes_in_order():
    rows = venue.ohlc_from_trades([(0.5, 10.0), (30.0, 12.0), (59.9, 11.0), (61.0, 9.0)])
    assert rows == [[0, 10.0, 12.0, 10.0, 11.0], [60, 9.0, 9.0, 9.0, 9.0]]
    with pytest.raises(ValueError):
        venue.ohlc_from_trades([(61.0, 9.0), (0.5, 10.0)])


def test_median_close_rv_matches_hand_computation():
    t0 = 60_000
    venues = [_ramp_venue(t0, 30), _ramp_venue(t0, 30, 1.0002), _ramp_venue(t0, 30, 0.9999)]
    t_obs = np.array([t0 + 60 * 20 + 10])
    rv5 = venue.median_close_rv(venues, t_obs, 300)
    rv15 = venue.median_close_rv(venues, t_obs, 900)
    assert rv5[0] == pytest.approx(math.sqrt(5 * 0.001**2 / 300))
    assert rv15[0] == pytest.approx(math.sqrt(15 * 0.001**2 / 900))


def test_range_rv_is_the_median_of_each_venue_parkinson_volatility():
    t0 = 60_000
    venues = [_ramp_venue(t0, 30, half_range=h) for h in (0.001, 0.002, 0.003)]
    rv = venue.range_rv(venues, np.array([t0 + 60 * 20 + 10]), 300)
    # median venue: ln(H/L) = 0.004 on every candle
    assert rv[0] == pytest.approx(math.sqrt(0.004**2 / (4 * math.log(2)) / 60))


def test_desk_estimators_use_only_closed_minutes():
    t0 = 60_000
    venues = [_ramp_venue(t0, 30) for _ in range(3)]
    # at t0 + 1,200 exactly, minute [t0 + 1,140, t0 + 1,200) has just closed; one second earlier it has not
    a = venue.median_close_rv(venues, np.array([t0 + 1_200]), 300)
    b = venue.median_close_rv(venues, np.array([t0 + 1_199]), 300)
    assert a[0] == pytest.approx(b[0])  # constant returns: same value, but from windows one minute apart
    with pytest.raises(ValueError):
        venue.median_close_rv(venues, np.array([t0 + 200]), 900)


def test_desk_estimators_reject_partial_minutes():
    v = _ramp_venue(60_000, 30)
    with pytest.raises(ValueError):
        venue.median_close_rv([v], np.array([61_500]), 90)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd lab && uv run pytest tests/test_venue.py -q`
Expected: FAIL with `AttributeError: module 'clim_lab.venue' has no attribute 'ohlc_from_rows'` (8 new tests failing, the 9 existing ones passing).

- [ ] **Step 3: Implement the estimators**

In `lab/clim_lab/venue.py`, change the imports at the top to:

```python
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .data import MinuteSeries, SecondSeries, _forward_fill
```

and append at the end of the file:

```python
# --- Desk-feasible estimators (plan 03 Task 1): what the live CRE desk can compute from four venues' 1-minute
# candles, replayed on the lab's venues. Conventions match cre/risk-desk/estimator.ts: a candle counts once its
# minute has ended; a report at t_obs uses the minutes closed at or before t_obs.

PARKINSON = 1.0 / (4.0 * math.log(2.0))


@dataclass(frozen=True)
class MinuteOhlc:
    """One venue's 1-minute candles in USD on a contiguous 60 s grid (open_t[i] = open_t[0] + 60 i).
    A minute without trades repeats the previous close as its high, low and close."""

    open_t: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray


def ohlc_from_rows(rows, usd_per_quote: MinuteSeries | None = None) -> MinuteOhlc:
    """[[open_s, open, high, low, close], ...] (any order, gaps allowed) -> MinuteOhlc. usd_per_quote converts a
    USDT-quoted venue: each minute is multiplied by the USDT-USD close of the last minute closed at or before its own
    close."""
    if len(rows) == 0:
        raise ValueError("no candles")
    by_t = {int(r[0]): r for r in rows}
    ts = np.array(sorted(by_t), dtype=np.int64)
    if np.any(ts % 60):
        raise ValueError("open times must be whole minutes")
    raw = np.array([[float(x) for x in by_t[int(t)][2:5]] for t in ts], dtype=np.float64)  # high, low, close
    n = int((ts[-1] - ts[0]) // 60) + 1
    pos = (ts - ts[0]) // 60
    has = np.zeros(n, dtype=bool)
    has[pos] = True
    src = np.zeros(n, dtype=np.int64)
    src[pos] = np.arange(len(ts))
    marker = np.where(has, np.arange(n), 0)
    np.maximum.accumulate(marker, out=marker)
    close = raw[src[marker], 2]
    high = np.where(has, raw[src, 0], close)
    low = np.where(has, raw[src, 1], close)
    open_t = ts[0] + 60 * np.arange(n, dtype=np.int64)
    if usd_per_quote is not None:
        idx = np.searchsorted(usd_per_quote.close_t, open_t + 60, side="right") - 1
        if idx[0] < 0:
            raise ValueError("no USDT-USD minute closed before the first candle")
        f = np.exp(usd_per_quote.logp[idx])
        high, low, close = high * f, low * f, close * f
    return MinuteOhlc(open_t, high, low, close)


def ohlc_from_trades(trades) -> list[list[float]]:
    """(unix seconds, price) trades in time order -> [[open_s, open, high, low, close], ...] for minutes with trades."""
    out: list[list[float]] = []
    last_t = -math.inf
    for t, p in trades:
        if t < last_t:
            raise ValueError("trades must be in time order")
        last_t = t
        m = int(t // 60) * 60
        if out and out[-1][0] == m:
            row = out[-1]
            row[2] = max(row[2], p)
            row[3] = min(row[3], p)
            row[4] = p
        else:
            out.append([m, p, p, p, p])
    return out


def _minutes(window_sec: int) -> int:
    if window_sec % 60 or window_sec < 60:
        raise ValueError("the window must be a whole number of minutes")
    return window_sec // 60


def _common_grid(venues: list[MinuteOhlc]) -> tuple[np.ndarray, list[np.ndarray]]:
    t0 = max(int(v.open_t[0]) for v in venues)
    t1 = min(int(v.open_t[-1]) for v in venues)
    if t1 < t0:
        raise ValueError("the venues do not overlap")
    grid = np.arange(t0, t1 + 60, 60, dtype=np.int64)
    return grid, [(grid - int(v.open_t[0])) // 60 for v in venues]


def _window_index(grid: np.ndarray, t_obs, n: int) -> np.ndarray:
    """[len(t_obs), n] indexes into grid of the n minutes ending with the last minute closed at or before t_obs."""
    last_open = (np.asarray(t_obs, dtype=np.int64) // 60) * 60 - 60
    end = (last_open - int(grid[0])) // 60
    idx = end[:, None] - np.arange(n - 1, -1, -1, dtype=np.int64)[None, :]
    if idx.min() < 0 or idx.max() >= len(grid):
        raise ValueError("not enough minutes for the window")
    return idx


def median_close_rv(venues: list[MinuteOhlc], t_obs, window_sec: int) -> np.ndarray:
    """Realized volatility per sqrt second over window_sec from the cross-venue median of 1-minute closes
    (window_sec / 60 returns). The CRE desk's `median-close` estimator."""
    n = _minutes(window_sec)
    grid, take = _common_grid(venues)
    med = np.log(np.median(np.vstack([v.close[i] for v, i in zip(venues, take)]), axis=0))
    idx = _window_index(grid, t_obs, n + 1)
    r = np.diff(med[idx], axis=1)
    return np.sqrt((r * r).sum(axis=1) / window_sec)


def range_rv(venues: list[MinuteOhlc], t_obs, window_sec: int) -> np.ndarray:
    """Median across venues of each venue's Parkinson volatility per sqrt second over its window_sec / 60 one-minute
    candles: sqrt(mean(ln(high / low)^2) / (4 ln 2) / 60 s). The CRE desk's `venue-range` estimator."""
    n = _minutes(window_sec)
    grid, take = _common_grid(venues)
    idx = _window_index(grid, t_obs, n)
    per = []
    for v, i in zip(venues, take):
        u = np.log(v.high[i] / v.low[i]) ** 2 * PARKINSON
        per.append(np.sqrt(u[idx].mean(axis=1) / 60.0))
    return np.median(np.vstack(per), axis=0)
```

- [ ] **Step 4: Run the venue tests**

Run: `cd lab && uv run pytest tests/test_venue.py -q`
Expected: `17 passed`.

- [ ] **Step 5: Write the failing test for the decision rule**

Append to `lab/tests/test_policy.py`:

```python
def _est(arb, pearson):
    return {"arbVsKeeperPct": arb, "corrKeeper": {"pearson": pearson}}


def test_choose_estimator_prefers_the_better_multi_venue_estimator():
    r = {"median-close": _est(-1.0, 0.70), "venue-range": _est(-3.0, 0.60), "binance-1s": _est(-3.5, 0.83)}
    assert policy.choose_estimator(r) == "venue-range"


def test_choose_estimator_breaks_close_calls_on_correlation():
    r = {"median-close": _est(-2.6, 0.75), "venue-range": _est(-3.0, 0.60), "binance-1s": _est(-3.5, 0.83)}
    assert policy.choose_estimator(r) == "median-close"


def test_choose_estimator_takes_binance_1s_only_when_it_wins_by_more_than_a_point():
    r = {"median-close": _est(2.0, 0.70), "venue-range": _est(1.5, 0.60), "binance-1s": _est(-4.4, 0.83)}
    assert policy.choose_estimator(r) == "binance-1s"
    r["binance-1s"] = _est(1.2, 0.83)  # beats median-close (the multi-venue pick, by correlation) by 0.8 point only
    assert policy.choose_estimator(r) == "median-close"
```

- [ ] **Step 6: Run it to see it fail**

Run: `cd lab && uv run pytest tests/test_policy.py -q`
Expected: FAIL with `AttributeError: module 'clim_lab.policy' has no attribute 'choose_estimator'`.

- [ ] **Step 7: Implement the rule**

Append to `lab/clim_lab/policy.py`:

```python
MULTI_VENUE_ESTIMATORS = ("median-close", "venue-range")
SINGLE_VENUE_ESTIMATOR = "binance-1s"


def choose_estimator(results: dict, tolerance_pts: float = 1.0) -> str:
    """The volatility estimator the live desk computes (plan 03 Task 1), from results[name] = {"arbVsKeeperPct",
    "corrKeeper": {"pearson"}} measured at equal average fee with Fables' keeper.

    1. Among the multi-venue estimators, the lower arbitrage loss; within tolerance_pts, the higher Pearson
       correlation with the keeper's fee.
    2. binance-1s (one exchange decides sigma) replaces it only if its loss is lower by more than tolerance_pts:
       clim's pitch is a baseline no single venue controls, so a single-venue estimator must earn its place.
    """
    a, b = MULTI_VENUE_ESTIMATORS
    ra, rb = results[a]["arbVsKeeperPct"], results[b]["arbVsKeeperPct"]
    if abs(ra - rb) < tolerance_pts:
        best = max(MULTI_VENUE_ESTIMATORS, key=lambda k: results[k]["corrKeeper"]["pearson"])
    else:
        best = a if ra < rb else b
    if results[SINGLE_VENUE_ESTIMATOR]["arbVsKeeperPct"] < results[best]["arbVsKeeperPct"] - tolerance_pts:
        return SINGLE_VENUE_ESTIMATOR
    return best
```

- [ ] **Step 8: Run the lab suite**

Run: `cd lab && uv run pytest -q`
Expected: no failure; the passed count is the previous one plus the 11 new tests (plan 01 ended at 150 passed, 1 skipped, so `161 passed, 1 skipped`).

- [ ] **Step 9: Commit**

```bash
git add lab/clim_lab/venue.py lab/clim_lab/policy.py lab/tests/test_venue.py lab/tests/test_policy.py
git commit -m "feat(lab): desk-feasible volatility estimators and the rule that picks one" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 2: Lab, measure the estimators on the five weeks and re-decide `etaE4`

**Files:**
- Modify: `lab/scripts/fables_fetch.py` (three subcommands)
- Create: `lab/scripts/study_estimator.py`
- Modify: `lab/scripts/decide_fables_params.py`
- Modify: `lab/tests/test_fables_outputs.py`
- Output: `lab/out/fables-estimator.json`, `shared/params-fables.json`

- [ ] **Step 1: Confirm which venues serve sub-minute data (option c of the brief)**

Run each and compare with the expected answer (read-only public endpoints):

```bash
curl -s "https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=2" | head -c 120; echo
curl -s "https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD/candles?granularity=ONE_SECOND&limit=2" | head -c 120; echo
curl -s "https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=0" | head -c 120; echo
curl -s -X POST https://api.hyperliquid.xyz/info -H 'content-type: application/json' -d '{"type":"candleSnapshot","req":{"coin":"ETH","interval":"1s","startTime":1791926000000,"endTime":1791926300000}}' | head -c 120; echo
curl -s -X POST https://api.hyperliquid.xyz/info -H 'content-type: application/json' -d '{"type":"candleSnapshot","req":{"coin":"ETH","interval":"1m","startTime":1788739200000,"endTime":1788742800000}}' | head -c 120; echo
```

Expected: Binance returns two `[[<ms>,"...` rows; Coinbase `"granularity" ... is not a valid value`; Kraken `{"error":["EGeneral:Invalid arguments"]}`; Hyperliquid `Failed to deserialize the JSON body` for `1s` and `[]` for 1-minute candles of 2026-09-07. So only Binance has sub-minute candles, and Hyperliquid cannot be replayed. The third candidate is therefore `venue-range`: a range estimator on each venue's 1-minute high and low, which every venue serves live and which carries more information than five closes. If an answer differs (an API added 1 s candles), write it in the session log and stop: the candidate list must be revisited with the maintainer before measuring.

- [ ] **Step 2: Add the three fetches**

In `lab/scripts/fables_fetch.py`, update the module docstring's command list by adding these lines after the `usdt` line:

```
    uv run python scripts/fables_fetch.py binance1m                 # Binance ETHUSDT 1 min OHLC (daily zips)
    uv run python scripts/fables_fetch.py coinbase1m                # Coinbase ETH-USD 1 min OHLC
    uv run python scripts/fables_fetch.py kraken1m                  # Kraken ETHUSD 1 min OHLC rebuilt from trades
```

Add these functions before `def main()`:

```python
def _save_ohlc(path: Path, rows) -> None:
    """[[open_s, open, high, low, close], ...] deduplicated by open time, ascending (plan 03 Task 2)."""
    by_t = {int(r[0]): [int(r[0])] + [float(x) for x in r[1:5]] for r in rows}
    path.write_text(json.dumps([by_t[t] for t in sorted(by_t)]))


def cmd_binance1m(args) -> None:
    path = RAW / "binance_ethusdt_1m.json"
    if path.exists() and not args.refresh:
        print(f"{path} exists")
        return
    rows = []
    for day in _days():
        url = f"https://data.binance.vision/data/spot/daily/klines/ETHUSDT/1m/ETHUSDT-1m-{day}.zip"
        z = zipfile.ZipFile(io.BytesIO(_get(url, timeout=300)))
        for line in z.read(z.namelist()[0]).decode().splitlines():
            cols = line.strip().split(",")
            if len(cols) < 5:
                continue
            t = int(cols[0])
            t = t // 1_000_000 if t > 10**14 else t // 1_000
            rows.append([t, cols[1], cols[2], cols[3], cols[4]])
    _save_ohlc(path, rows)
    print(f"wrote {path}: {len(rows)} minutes")


def cmd_coinbase1m(args) -> None:
    path = RAW / "coinbase_ethusd_1m.json"
    if path.exists() and not args.refresh:
        print(f"{path} exists")
        return
    rows = []
    t = START - PAD_BEFORE
    while t < END + PAD_AFTER:
        t2 = min(t + 300 * 60, END + PAD_AFTER)
        q = {
            "granularity": 60,
            "start": datetime.fromtimestamp(t, timezone.utc).isoformat(),
            "end": datetime.fromtimestamp(t2, timezone.utc).isoformat(),
        }
        url = "https://api.exchange.coinbase.com/products/ETH-USD/candles?" + urllib.parse.urlencode(q)
        for c in json.loads(_get(url)):  # [time, low, high, open, close, volume], newest first
            rows.append([int(c[0]), c[3], c[2], c[1], c[4]])
        t = t2
        time.sleep(0.35)
    _save_ohlc(path, rows)
    print(f"wrote {path}: {len(rows)} minutes")


def cmd_kraken1m(args) -> None:
    """Kraken's OHLC keeps only its last 720 candles, so the minutes are rebuilt from the public trade history
    (1,000 trades per call, `since` is a nanosecond cursor). Resumable through a partial file."""
    path = RAW / "kraken_ethusd_1m.json"
    partial = RAW / "kraken_ethusd_1m.partial.json"
    if path.exists() and not args.refresh:
        print(f"{path} exists")
        return
    end = END + PAD_AFTER
    if partial.exists():
        state = json.loads(partial.read_text())
    else:
        state = {"since": str((START - PAD_BEFORE) * 10**9), "rows": [], "pending": []}
    calls = 0
    while True:
        url = f"https://api.kraken.com/0/public/Trades?pair=ETHUSD&since={state['since']}&count=1000"
        doc = json.loads(_get(url))
        if doc.get("error"):
            raise RuntimeError(f"Kraken error: {doc['error']}")
        res = doc["result"]
        trades = next(v for k, v in res.items() if k != "last")
        pending = state["pending"] + [[float(x[2]), float(x[0])] for x in trades]  # [time s, price]
        done = len(trades) == 0 or pending[-1][0] >= end
        # minutes before the last one seen are complete; the last one may continue in the next call
        cut = end if done else (int(pending[-1][0]) // 60) * 60
        state["rows"] += venue.ohlc_from_trades([(t, p) for t, p in pending if t < min(cut, end)])
        state["pending"] = [] if done else [tp for tp in pending if tp[0] >= cut]
        state["since"] = res["last"]
        calls += 1
        if done:
            break
        if calls % 20 == 0:
            RAW.mkdir(parents=True, exist_ok=True)
            partial.write_text(json.dumps(state))
            print(f"  {calls} calls, up to {datetime.fromtimestamp(pending[-1][0], timezone.utc):%Y-%m-%d %H:%M}", flush=True)
        time.sleep(1.1)  # Kraken's public rate limit
    rows = [r for r in state["rows"] if START - PAD_BEFORE <= r[0] < end]
    _save_ohlc(path, rows)
    partial.unlink(missing_ok=True)
    print(f"wrote {path}: {len(rows)} minutes with trades, {calls} calls")
```

In `main()`, replace the subcommand tuple and the dispatch dictionary with:

```python
    for name in ("blocks", "check-clock", "logs", "binance", "usdt", "binance1m", "coinbase1m", "kraken1m"):
        sp = b if name == "blocks" else sub.add_parser(name)
        sp.add_argument("--refresh", action="store_true")
    args = p.parse_args()
    {
        "blocks": cmd_blocks,
        "check-clock": cmd_check_clock,
        "logs": cmd_logs,
        "binance": cmd_binance,
        "usdt": cmd_usdt,
        "binance1m": cmd_binance1m,
        "coinbase1m": cmd_coinbase1m,
        "kraken1m": cmd_kraken1m,
    }[args.cmd](args)
```

- [ ] **Step 3: Fetch the minutes (network, read only)**

Run (the Kraken fetch takes about 35 minutes; it resumes if interrupted):

```bash
cd lab
uv run python scripts/fables_fetch.py binance1m
uv run python scripts/fables_fetch.py coinbase1m
uv run python scripts/fables_fetch.py kraken1m
```

Expected: `wrote .../binance_ethusdt_1m.json: 53280 minutes` (37 whole days, 2026-09-06 to 2026-10-12), `wrote .../coinbase_ethusd_1m.json: <about 50,400> minutes`, and `wrote .../kraken_ethusd_1m.json: <about 49,000> minutes with trades, <about 1,800> calls`. Kraken and Coinbase have fewer rows than minutes because a minute without trades has no candle (`ohlc_from_rows` fills it). If a count is below 45,000, the fetch stopped early: rerun with `--refresh`.

- [ ] **Step 4: Write the output contract test**

Append to `lab/tests/test_fables_outputs.py`:

```python
ESTIMATORS = ("median-close", "venue-range", "binance-1s")


def test_estimator_output():
    d = _load("fables-estimator.json")
    assert set(d["estimators"]) == set(ESTIMATORS)
    assert d["chosen"] in ESTIMATORS
    assert d["windowSec"] in (300, 900)
    for name in ESTIMATORS:
        e = d["estimators"][name]
        assert e["etaE4"] > 0
        assert e["meanFeeBp"] == pytest.approx(d["keeper"]["meanFeeBp"], rel=0.01)
        assert -1 <= e["corrKeeper"]["pearson"] <= 1 and -1 <= e["corrKeeper"]["spearman"] <= 1
        assert -1 <= e["corrWithBinance1s"] <= 1
        assert "arbVsKeeperPctEvery15s" in e
    assert d["estimators"]["binance-1s"]["corrWithBinance1s"] == pytest.approx(1.0)
    assert any("favours binance-1s" in c for c in d["caveats"])
    assert d["chosenEtaE4"] == d["estimators"][d["chosen"]]["etaE4"]
```

and in `test_params_fables`, after the `assert d["decidedBy"] == ...` line, add:

```python
    assert d["sigmaEstimator"] in ("median-close", "venue-range", "binance-1s")
    est = OUT_DIR / "fables-estimator.json"
    if est.exists():
        assert d["etaE4"] == json.loads(est.read_text())["chosenEtaE4"]
```

- [ ] **Step 5: Run the tests to see them fail or skip**

Run: `cd lab && uv run pytest tests/test_fables_outputs.py -q`
Expected: `test_estimator_output` SKIPPED ("fables-estimator.json not generated yet") and `test_params_fables` FAILED with `KeyError: 'sigmaEstimator'`.

- [ ] **Step 6: Write the study**

Create `lab/scripts/study_estimator.py`:

```python
"""Plan 03 Task 2: which volatility estimator the live CRE desk computes (offline).

    uv run python scripts/study_estimator.py     # lab/out/fables-estimator.json

The lab calibrated clim's fee on Binance 1 s prices (5 s returns), which the desk cannot read from four venues. Three
desk-feasible estimators are compared on the five-week window, each at equal average fee with Fables' keeper, with the
machinery of study 2 (scripts/study_window.py): reports every 30 s with 2 s latency, the myopic arbitrageur on the 1 s
venue path, and the keeper's own fee path as the reference.

- median-close: realized volatility of the cross-venue median of 1-minute closes;
- venue-range: median across venues of each venue's Parkinson volatility on its 1-minute high and low;
- binance-1s: the lab's estimator (Binance 1 s, 5 s returns), which the desk can fetch from Binance alone.

Venues replayed: Binance (USDT converted with Coinbase USDT-USD), Coinbase, Kraken (minutes rebuilt from trades).
Hyperliquid serves only its last 5,000 one-minute candles, so it cannot be replayed; the live desk uses it as a fourth
venue. The rule (clim_lab.policy.choose_estimator) is fixed before the run.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import DESK_LATENCY_SEC, END, RAW, REPORT_SEC, START, keeper_fee_per_second, load_window  # noqa: E402

from clim_lab import venue  # noqa: E402
from clim_lab.constants import SECONDS_PER_YEAR  # noqa: E402
from clim_lab.data import OUT_DIR, load_1m_pairs_json  # noqa: E402
from clim_lab.desk import log_bands  # noqa: E402
from clim_lab.policy import calibrate_eta, choose_estimator, policy_fee_pips  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.sim import run_arb  # noqa: E402

FLOOR, CAP = 700, 6_000
ESTIMATORS = ("median-close", "venue-range", "binance-1s")


def _ranks(x: np.ndarray) -> np.ndarray:
    r = np.empty(len(x))
    r[np.argsort(x, kind="stable")] = np.arange(len(x))
    return r


def _venues() -> list[venue.MinuteOhlc]:
    usdt = load_1m_pairs_json(RAW / "usdtusd_1m.json")

    def rows(name: str):
        # Binance's day files start before the USDT-USD minutes (fetched from START - 3,600): keep the study span
        return [r for r in json.loads((RAW / f"{name}_1m.json").read_text()) if START - 3_600 <= r[0] < END + 600]

    return [
        venue.ohlc_from_rows(rows("binance_ethusdt"), usd_per_quote=usdt),
        venue.ohlc_from_rows(rows("coinbase_ethusd")),
        venue.ohlc_from_rows(rows("kraken_ethusd")),
    ]


def main() -> None:
    dt = json.loads((OUT_DIR / "fables-dt-eff.json").read_text())["chosen"]["dtEffSec"]
    win = int(json.loads((OUT_DIR / "fables-window.json").read_text())["chosenWindowSec"])
    w = load_window()
    seconds = np.arange(START, END, dtype=np.int64)
    keeper = keeper_fee_per_second(w, START, END).astype(np.float64)
    t_obs = np.arange(START - REPORT_SEC, END, REPORT_SEC, dtype=np.int64)
    rep_idx = np.searchsorted(t_obs + DESK_LATENCY_SEC, seconds, side="right") - 1
    keeper_rep = keeper[np.clip(t_obs + DESK_LATENCY_SEC - START, 0, len(keeper) - 1)]
    x = w.venue.at(seconds)

    def arb(fee_pips: np.ndarray, step: int = 1) -> float:
        # the arbitrageur acts every `step` seconds on the subsampled venue path and fees (as study 2's sensitivity)
        return run_arb(x[::step], log_bands(fee_pips[::step])).arb

    arb_keeper = arb(keeper)
    arb_keeper_15 = arb(keeper, 15)

    venues = _venues()
    sig = {
        "median-close": venue.median_close_rv(venues, t_obs, win),
        "venue-range": venue.range_rv(venues, t_obs, win),
        "binance-1s": venue.rv_window(w.venue, t_obs, window_sec=win, step_sec=5),
    }
    est = {}
    for name in ESTIMATORS:
        s = sig[name]
        s_sec = s[rep_idx]
        eta = calibrate_eta(s_sec, dt, FLOOR, CAP, keeper.mean())
        fee_sec = policy_fee_pips(s_sec, eta, dt, FLOOR, CAP)
        fee_rep = policy_fee_pips(s, eta, dt, FLOOR, CAP)
        est[name] = {
            "etaE4": int(round(eta * 1e4)),
            "meanFeeBp": float(fee_sec.mean() / 100),
            "meanSigmaPctYr": float(s.mean() * np.sqrt(SECONDS_PER_YEAR) * 100),
            "corrWithBinance1s": float(np.corrcoef(s, sig["binance-1s"])[0, 1]),
            "corrKeeper": {
                "pearson": float(np.corrcoef(fee_rep, keeper_rep)[0, 1]),
                "spearman": float(np.corrcoef(_ranks(fee_rep), _ranks(keeper_rep))[0, 1]),
            },
            "sharePctAtFloor": float(100 * (fee_sec <= FLOOR).mean()),
            "sharePctAtCap": float(100 * (fee_sec >= CAP).mean()),
            "arbVsKeeperPct": float(100 * (arb(fee_sec) / arb_keeper - 1)),
            "arbVsKeeperPctEvery15s": float(100 * (arb(fee_sec, 15) / arb_keeper_15 - 1)),
        }
    chosen = choose_estimator(est)
    out = {
        "generatedAt": now_iso(),
        "window": {"start": int(START), "end": int(END)},
        "dtEffSec": dt,
        "windowSec": win,
        "keeper": {"meanFeeBp": float(keeper.mean() / 100)},
        "venues": [
            "binance (ETHUSDT 1 min, USDT converted with Coinbase USDT-USD)",
            "coinbase (ETH-USD 1 min)",
            "kraken (ETHUSD 1 min rebuilt from the public trade history)",
        ],
        "excluded": {
            "hyperliquid": "its API serves only the last 5,000 one-minute candles, so the window cannot be replayed",
        },
        "estimators": est,
        "chosen": chosen,
        "chosenEtaE4": est[chosen]["etaE4"],
        "rule": (
            "prefer a multi-venue estimator (median-close or venue-range): the lower arbitrage loss at equal average "
            "fee, within 1 point the higher Pearson correlation with the keeper; binance-1s only if it loses less "
            "than that estimator by more than 1 point"
        ),
        "caveats": [
            "three venues replayed, four live (Hyperliquid has no history); the live median can differ slightly",
            "the simulated arbitrageur trades on the Binance 1 s path binance-1s is computed from, which favours "
            "binance-1s (study 2's caveat); the rule's 1-point margin for a multi-venue estimator is partly for this",
            "1 s grid: the simulator ranks estimators, it does not predict dollars; arbVsKeeperPctEvery15s (the "
            "arbitrageur acting every 15 s) is reported as robustness and not used by the rule",
            "in-sample: eta is fitted on the same five weeks the comparison runs on; one price path, no confidence interval",
        ],
    }
    write_json(OUT_DIR / "fables-estimator.json", out)
    print(f"chosen {chosen} (etaE4 {est[chosen]['etaE4']}); arbitrage vs keeper "
          f"{ {k: round(v['arbVsKeeperPct'], 2) for k, v in est.items()} }")


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Run the study**

Run: `cd lab && uv run python scripts/study_estimator.py`
Expected: one line `chosen <name> (etaE4 <n>); arbitrage vs keeper {'median-close': <x>, 'venue-range': <y>, 'binance-1s': -4.38}`. The `binance-1s` figure must reproduce study 2's 300 s result (-4.38 %, etaE4 175,198): that is the check that the machinery is the same (it did, in a dry run of this script on stand-in minute data while the plan was written). If it does not, stop and compare with `scripts/study_window.py` before going on. The run takes about 10 seconds after the data is loaded.

- [ ] **Step 8: Feed the decision into the parameters**

In `lab/scripts/decide_fables_params.py`, replace the docstring's second bullet with:

```
- sigmaWindowSec from study 2; sigmaEstimator and etaE4 from the estimator study (plan 03 Task 2: eta at equal average
  fee with the keeper, for the estimator the live desk computes); pStar = 1 / (eta + 1) is the model-implied
  probability of an arbitrage per interval at dtEffSec, kept for reference and not used on-chain.
```

and replace the body of `main()` from `win = ...` down to the `out = {` line with:

```python
    win = json.loads((OUT_DIR / "fables-window.json").read_text())
    est = json.loads((OUT_DIR / "fables-estimator.json").read_text())
    dire = json.loads((OUT_DIR / "fables-direction.json").read_text())
    dt_eff = dt["chosen"]["dtEffSec"]
    w = str(win["chosenWindowSec"])
    if est["windowSec"] != int(w):
        raise SystemExit("fables-estimator.json was computed for another window: rerun scripts/study_estimator.py")
    eta_e4 = est["chosenEtaE4"]
    rule = dire["rule"]
    out = {
```

then, inside `out`, add `"sigmaEstimator": est["chosen"],` after `"sigmaWindowSec": int(w),`, and replace the `"sources"` list with:

```python
        "sources": [
            "lab/out/fables-dt-eff.json",
            "lab/out/fables-window.json",
            "lab/out/fables-estimator.json",
            "lab/out/fables-direction.json",
        ],
```

- [ ] **Step 9: Regenerate the parameters and run the tests**

Run:

```bash
cd lab && uv run python scripts/decide_fables_params.py && uv run pytest -q
git diff --stat ../shared/params-fables.json && git diff ../shared/params-fables.json
```

Expected: the printed JSON has `"sigmaEstimator": "<chosen>"` and `"etaE4": <chosenEtaE4>`; the suite passes with no failure (one more test than after Task 1); the diff shows only `etaE4`, `pStar`, `sigmaEstimator`, `sources` and `generatedAt` changing (`etaE4` is unchanged if `binance-1s` was chosen).

- [ ] **Step 10: Record the outcome**

Append to `docs/sessions/<today>.md` (create the file with the heading `# Session log · <today>` if it does not exist) a bullet in this shape, every number copied from `lab/out/fables-estimator.json`:

```markdown
- (lab) Estimator for the live desk (plan 03 Task 2): on 2026-09-07 to 2026-10-12, equal average fee with the keeper (<keeper.meanFeeBp> bp), 300 s window: median-close etaE4 <n>, Pearson <p>, arbitrage vs keeper <x> %; venue-range etaE4 <n>, Pearson <p>, <y> %; binance-1s etaE4 175,198, Pearson 0.833, -4.38 %. Correlation of each with binance-1s: <a>, <b>. Chosen: <name> by the rule in `clim_lab.policy.choose_estimator` (multi-venue first; binance-1s only if it loses more than 1 point less). `shared/params-fables.json`: etaE4 <old> -> <new>, sigmaEstimator <name>. Venues replayed: Binance, Coinbase, Kraken (from trades); Hyperliquid has no history. The fork-run evidence (`docs/evidence/fork-run-2026-10-07.json`) keeps the parameters it was recorded with (etaE4 175,198, Binance 1 s reports); `ForkRun.s.sol` reads the current file, so a rerun would differ: plan 04 states which parameters each piece of evidence used.
```

- [ ] **Step 11: Commit**

```bash
git add lab/scripts/fables_fetch.py lab/scripts/study_estimator.py lab/scripts/decide_fables_params.py lab/tests/test_fables_outputs.py lab/out/fables-estimator.json shared/params-fables.json docs/sessions/
git commit -m "feat(lab): live desk estimator measured on Fables' five weeks, etaE4 re-decided for it" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 3: Lab, the keeper-style map for pool K

**Files:**
- Create: `lab/scripts/export_keeper_map.py`
- Modify: `lab/tests/test_fables_outputs.py`
- Output: `shared/keeper-map-fables.json`

`lab/out/fables-windows.json` has the keeper's median fee by 15-minute volatility in six coarse bins; pool K's bot uses 5-minute volatility (the window the keeper tracks best, Pearson 0.83), so this small export rebuilds the table from the keeper's own pokes over the five weeks.

- [ ] **Step 1: Write the output contract test**

Append to `lab/tests/test_fables_outputs.py`:

```python
def test_keeper_map():
    p = SHARED_DIR / "keeper-map-fables.json"
    if not p.exists():
        pytest.skip("keeper-map-fables.json not generated yet")
    d = json.loads(p.read_text())
    n = len(d["edgesPctYr"])
    assert n == len(d["feePips"]) == len(d["samples"]) == len(d["medianFeePips"])
    assert d["edgesPctYr"][0] == 0 and d["edgesPctYr"] == sorted(d["edgesPctYr"])
    assert all(700 <= f <= 6_000 for f in d["feePips"])
    assert d["feePips"] == sorted(d["feePips"])  # monotone in volatility
    assert sum(d["samples"]) == d["pokes"] > 1_000
    assert 60 <= d["postEverySec"] <= 600
    assert d["ttlSec"] == 7_200
    assert "not Fables' code" in d["what"]
```

- [ ] **Step 2: Run it to see it skip**

Run: `cd lab && uv run pytest tests/test_fables_outputs.py::test_keeper_map -q`
Expected: `1 skipped`.

- [ ] **Step 3: Write the export**

Create `lab/scripts/export_keeper_map.py`:

```python
"""The keeper-style twin's fee map (offline): how Fables' keeper set its ETH/USDG fee against 5-minute volatility.

    uv run python scripts/export_keeper_map.py     # shared/keeper-map-fables.json

Pool K on Robinhood Chain testnet is poked by a small bot (bots/src/live/keeper.ts) that imitates the pattern observed
on Fables' pool: about every 180 s, the fee this table gives at the current 5-minute realized volatility, with a
7,200 s TTL. It is an imitation of the observed pattern, not Fables' code (which is not public).
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import END, START, load_window  # noqa: E402

from clim_lab.constants import SECONDS_PER_YEAR  # noqa: E402
from clim_lab.data import SHARED_DIR  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.venue import rv_window  # noqa: E402

EDGES_PCT_YR = [0, 20, 30, 40, 50, 60, 80, 100, 150, 200]  # bin i is [edge i, edge i+1); the last is open-ended
CLAMP = (700, 6_000)


def main() -> None:
    w = load_window()
    pokes = sorted((p for p in w.pokes if START <= p.t < END), key=lambda p: p.key)
    t = np.array([p.t for p in pokes], dtype=np.int64)
    fee = np.array([p.fee_pips for p in pokes], dtype=np.int64)
    sigma = rv_window(w.venue, t, window_sec=300, step_sec=5)
    pct = sigma * np.sqrt(SECONDS_PER_YEAR) * 100
    bins = np.searchsorted(np.array(EDGES_PCT_YR, dtype=np.float64), pct, side="right") - 1
    medians: list[int | None] = []
    samples: list[int] = []
    for i in range(len(EDGES_PCT_YR)):
        sel = fee[bins == i]
        samples.append(int(len(sel)))
        medians.append(int(np.median(sel)) if len(sel) else None)
    filled, prev = [], CLAMP[0]
    for m in medians:  # an empty bin takes the bin below it
        prev = prev if m is None else m
        filled.append(prev)
    fee_pips = np.clip(np.maximum.accumulate(np.array(filled, dtype=np.int64)), *CLAMP)
    gaps = np.diff(t)
    ttl = np.array([p.expiry - p.t for p in pokes], dtype=np.int64)
    out = {
        "generatedAt": now_iso(),
        "source": "lab/scripts/export_keeper_map.py",
        "what": (
            "Fee of the keeper-style twin (pool K) by 5-minute volatility: the median fee Fables' keeper posted on its "
            "ETH/USDG pool in each volatility bin, 2026-09-07 to 2026-10-12. An imitation of the observed pattern, "
            "not Fables' code."
        ),
        "sigma": "RV over 300 s from 5 s returns of Binance ETHUSDT 1 s, as each poke was posted (lab estimator)",
        "pokes": int(len(pokes)),
        "edgesPctYr": EDGES_PCT_YR,
        "medianFeePips": medians,
        "samples": samples,
        "feePips": [int(f) for f in fee_pips],
        "clampPips": list(CLAMP),
        "postEverySec": int(np.median(gaps)),
        "ttlSec": int(np.median(ttl)),
    }
    write_json(SHARED_DIR / "keeper-map-fables.json", out)
    print(f"{len(pokes)} pokes; fee by bin {out['feePips']}; every {out['postEverySec']} s, TTL {out['ttlSec']} s")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the export and the test**

Run:

```bash
cd lab && uv run python scripts/export_keeper_map.py && uv run pytest tests/test_fables_outputs.py -q
```

Expected: `5088 pokes; fee by bin [700, 700, 811, 1016, 1466, 2272, 3357, 4237, 5004, 5004]; every 179 s, TTL 7200 s` (the output of this script when this plan was written; the last bin, above 200 %/yr, has 12 pokes with a median of 4,893 pips and takes the bin below it through the monotone fill), then all output tests pass.

- [ ] **Step 5: Commit**

```bash
git add lab/scripts/export_keeper_map.py lab/tests/test_fables_outputs.py shared/keeper-map-fables.json
git commit -m "feat(lab): keeper-style fee map by 5-minute volatility for testnet pool K" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

## Part B: contracts, deployment and funding

### Task 4: `TestTokenDecimals` (tUSDG with 6 decimals)

**Files:**
- Create: `contracts/src/test-tokens/TestTokenDecimals.sol`
- Test: `contracts/test/TestTokenDecimals.t.sol`
- Modify: `contracts/script/export-abis.sh`

- [ ] **Step 1: Write the failing test**

Create `contracts/test/TestTokenDecimals.t.sol`:

```solidity
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd contracts && forge test --match-path test/TestTokenDecimals.t.sol`
Expected: compilation error `Source "src/test-tokens/TestTokenDecimals.sol" not found`.

- [ ] **Step 3: Implement**

Create `contracts/src/test-tokens/TestTokenDecimals.sol`:

```solidity
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
```

- [ ] **Step 4: Run the tests**

Run: `cd contracts && forge fmt src/test-tokens test/TestTokenDecimals.t.sol && forge test --match-path test/TestTokenDecimals.t.sol`
Expected: `4 passed`.

- [ ] **Step 5: Export its ABI**

In `contracts/script/export-abis.sh`, add `  TestTokenDecimals.sol/TestTokenDecimals \` on the line after `  TestToken.sol/TestToken \`. Run `contracts/script/export-abis.sh`; expected: the list of written files now includes `../shared/abis/TestTokenDecimals.json`.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/test-tokens/TestTokenDecimals.sol contracts/test/TestTokenDecimals.t.sol contracts/script/export-abis.sh shared/abis/TestTokenDecimals.json
git commit -m "feat(contracts): TestTokenDecimals for 6-decimal tUSDG on the testnet pools" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 5: `LiveScript`, the base of the testnet deploy scripts

**Files:**
- Create: `contracts/script/v2/base/LiveScript.sol`
- Test: `contracts/test/v2/LiveScript.t.sol`

- [ ] **Step 1: Write the failing test**

Create `contracts/test/v2/LiveScript.t.sol`:

```solidity
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd contracts && forge test --match-path test/v2/LiveScript.t.sol`
Expected: compilation error `Source "script/v2/base/LiveScript.sol" not found`.

- [ ] **Step 3: Implement**

Create `contracts/script/v2/base/LiveScript.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Shared plumbing of the plan 03 deploy scripts: clim's live reference stack on Robinhood Chain testnet
///         (or on a local anvil fork of it, run as chain 31337). Each step writes a JSON fragment to
///         deployments/<chainId>/; 14_LiveWriteDeployments checks everything on-chain and merges the fragments into
///         ../shared/deployments/robinhood-testnet.json (chain 46630) or ../shared/deployments/anvil.json (a fork).
///         Env: PRIVATE_KEY (contracts/.env, loaded by forge). Never runs on Robinhood Chain mainnet.
abstract contract LiveScript is Script {
    // Robinhood Chain testnet, checked with cast on 2026-10-13 (plan 03, "Facts").
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant MOCK_FORWARDER = 0x0b93082D9b3C7C97fAcd250082899BAcf3af3885;
    address internal constant KEYSTONE_FORWARDER = 0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19;
    uint256 internal constant RH_TESTNET = 46_630;
    uint256 internal constant RH_MAINNET = 4_663;

    // AccessManager roles, as in Fables' setup and the fork run.
    uint64 internal constant FEE_POKER = 1;
    uint64 internal constant CLIM_RUNNER = 7;

    // Fables' ETH/USDG config, used for the three pools.
    uint24 internal constant HOOK_FLOOR_PIPS = 100;
    uint24 internal constant HOOK_FLAT_PIPS = 700;
    uint24 internal constant HOOK_CAP_PIPS = 6_000;

    // The three PoolKeys share currencies, the dynamic-fee flag and the hook: tick spacing tells them apart.
    int24 internal constant TICK_SPACING_D = 10;
    int24 internal constant TICK_SPACING_K = 11;
    int24 internal constant TICK_SPACING_F = 12;

    uint8 internal constant ETH_DECIMALS = 18;
    uint8 internal constant USD_DECIMALS = 6;

    string internal constant PARAMS_PATH = "../shared/params-fables.json";

    function _pk() internal view returns (uint256) {
        return vm.envUint("PRIVATE_KEY");
    }

    /// @dev Never Robinhood Chain mainnet; the RPC must be the testnet or a fork of it (the PoolManager is there).
    function _guard() internal view {
        require(block.chainid != RH_MAINNET, "LiveScript: never on Robinhood Chain mainnet");
        require(POOL_MANAGER.code.length > 0, "LiveScript: no Uniswap v4 PoolManager on this chain");
    }

    function _dir() internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), "/");
    }

    function _path(string memory name) internal view returns (string memory) {
        return string.concat(_dir(), name, ".json");
    }

    function _write(string memory name, string memory json) internal {
        vm.createDir(_dir(), true);
        vm.writeJson(json, _path(name));
    }

    function _read(string memory name) internal view returns (string memory) {
        return vm.readFile(_path(name));
    }

    function _addr(string memory name, string memory key) internal view returns (address) {
        return vm.parseJsonAddress(_read(name), key);
    }

    /// @notice sqrtPriceX96 of a pool of tETH and tUSDG at `ethUsd` dollars per ETH, for either token order.
    ///         Raw price = token1 base units per token0 base unit.
    function sqrtPriceX96FromEthUsd(uint256 ethUsd, bool token0IsEth, uint8 ethDecimals, uint8 usdDecimals)
        public
        pure
        returns (uint160)
    {
        require(ethUsd > 0 && ethUsd < 1e9, "LiveScript: INIT_ETH_USD out of range");
        uint256 ratioX192 = token0IsEth
            ? Math.mulDiv(ethUsd << 192, uint256(10) ** usdDecimals, uint256(10) ** ethDecimals)
            : Math.mulDiv((uint256(10) ** ethDecimals) << 192, 1, ethUsd * uint256(10) ** usdDecimals);
        return uint160(Math.sqrt(ratioX192));
    }

    function _keyJson(string memory o, PoolKey memory k) internal returns (string memory) {
        vm.serializeAddress(o, "currency0", Currency.unwrap(k.currency0));
        vm.serializeAddress(o, "currency1", Currency.unwrap(k.currency1));
        vm.serializeUint(o, "fee", k.fee);
        vm.serializeInt(o, "tickSpacing", k.tickSpacing);
        return vm.serializeAddress(o, "hooks", address(k.hooks));
    }

    function _poolJson(string memory o, PoolKey memory k, bool token0IsEth, string memory driver)
        internal
        returns (string memory)
    {
        vm.serializeString(o, "key", _keyJson(string.concat(o, ".key"), k));
        vm.serializeBytes32(o, "poolId", PoolId.unwrap(k.toId()));
        vm.serializeBool(o, "token0IsEth", token0IsEth);
        return vm.serializeString(o, "driver", driver);
    }

    function _keyFrom(string memory json, string memory base) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(vm.parseJsonAddress(json, string.concat(base, ".key.currency0"))),
            currency1: Currency.wrap(vm.parseJsonAddress(json, string.concat(base, ".key.currency1"))),
            fee: uint24(vm.parseJsonUint(json, string.concat(base, ".key.fee"))),
            tickSpacing: int24(vm.parseJsonInt(json, string.concat(base, ".key.tickSpacing"))),
            hooks: IHooks(vm.parseJsonAddress(json, string.concat(base, ".key.hooks")))
        });
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd contracts && forge fmt script/v2/base test/v2/LiveScript.t.sol && forge test --match-path test/v2/LiveScript.t.sol`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add contracts/script/v2/base/LiveScript.sol contracts/test/v2/LiveScript.t.sol
git commit -m "feat(contracts): LiveScript base for the Robinhood testnet deploy scripts" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 6: Deploy scripts 10 and 11 (tokens, routers, AccessManager, PokeFeeHook)

**Files:**
- Create: `contracts/script/v2/10_LiveTokens.s.sol`
- Create: `contracts/script/v2/11_LiveAccessHook.s.sol`

These scripts are exercised end to end on an anvil fork in Task 10 before anything is broadcast to the testnet.

- [ ] **Step 1: Write `10_LiveTokens.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {TestTokenDecimals} from "../../src/test-tokens/TestTokenDecimals.sol";

/// @notice Step 1 of the live stack: tETH (18 decimals) and tUSDG (6), minted to the deployer, and three Uniswap v4
///         test routers (the testnet has none): a retail PoolSwapTest, an arbitrage-only PoolSwapTest (so the
///         dashboard tells arbitrage by Swap.sender) and a PoolModifyLiquidityTest.
///         Public faucet: 10 tETH and 25,000 tUSDG per address per hour.
/// Env: MINT_TETH (whole tokens, default 1,000,000), MINT_TUSDG (whole tokens, default 10,000,000,000).
contract LiveTokens is LiveScript {
    function run() external {
        _guard();
        uint256 pk = _pk();
        address deployer = vm.addr(pk);
        uint256 mintEth = vm.envOr("MINT_TETH", uint256(1_000_000)) * 1e18;
        uint256 mintUsd = vm.envOr("MINT_TUSDG", uint256(10_000_000_000)) * 1e6;
        uint256 deployBlock = vm.getBlockNumber();
        bytes memory argsEth = abi.encode("clim test ETH", "tETH", deployer, uint256(10e18), ETH_DECIMALS);
        bytes memory argsUsd = abi.encode("clim test USDG", "tUSDG", deployer, uint256(25_000e6), USD_DECIMALS);

        vm.startBroadcast(pk);
        TestTokenDecimals teth = new TestTokenDecimals("clim test ETH", "tETH", deployer, 10e18, ETH_DECIMALS);
        TestTokenDecimals tusdg = new TestTokenDecimals("clim test USDG", "tUSDG", deployer, 25_000e6, USD_DECIMALS);
        teth.mint(deployer, mintEth);
        tusdg.mint(deployer, mintUsd);
        PoolSwapTest swapRouter = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        PoolSwapTest arbRouter = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(IPoolManager(POOL_MANAGER));
        vm.stopBroadcast();

        string memory o = "tokens";
        vm.serializeAddress(o, "deployer", deployer);
        vm.serializeAddress(o, "tETH", address(teth));
        vm.serializeAddress(o, "tUSDG", address(tusdg));
        vm.serializeAddress(o, "swapRouter", address(swapRouter));
        vm.serializeAddress(o, "arbRouter", address(arbRouter));
        vm.serializeAddress(o, "lpRouter", address(lpRouter));
        vm.serializeBytes(o, "argsTETH", argsEth);
        vm.serializeBytes(o, "argsTUSDG", argsUsd);
        vm.serializeBytes(o, "argsRouter", abi.encode(POOL_MANAGER));
        string memory json = vm.serializeUint(o, "deployBlock", deployBlock);
        _write("tokens", json);
    }
}
```

- [ ] **Step 2: Write `11_LiveAccessHook.s.sol`**

```solidity
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
```

- [ ] **Step 3: Format and compile**

Run: `cd contracts && forge fmt script/v2 && forge build`
Expected: `Compiler run successful` (warnings about unused variables in vendored code are pre-existing).

- [ ] **Step 4: Commit**

```bash
git add contracts/script/v2/10_LiveTokens.s.sol contracts/script/v2/11_LiveAccessHook.s.sol
git commit -m "feat(contracts): live stack deploy steps 1-2, test tokens, routers, AccessManager and PokeFeeHook" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 7: Deploy scripts 12 to 14, the driver script and the fork smoke test

**Files:**
- Create: `contracts/script/v2/12_LivePools.s.sol`
- Create: `contracts/script/v2/13_LiveDesk.s.sol`
- Create: `contracts/script/v2/14_LiveWriteDeployments.s.sol`
- Create: `contracts/script/v2/deploy-live.sh`, `contracts/script/v2/live-smoke.sh`

- [ ] **Step 1: Write `12_LivePools.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";

/// @notice Step 3: pools D, K and F of tETH/tUSDG on PokeFeeHook, all with the dynamic-fee flag, Fables' ETH/USDG
///         config (floor 100, flat 700, cap 6,000 pips) and the same full-range liquidity L, sized so that D holds
///         LIQ_TETH tETH at the initial price. Tick spacings 10 (D), 11 (K), 12 (F) are the only difference between
///         the PoolKeys; with full-range positions they do not change the prices.
/// Env: INIT_ETH_USD (whole dollars, the current venue price), LIQ_TETH (whole tokens per pool, default 1,000).
contract LivePools is LiveScript {
    using StateLibrary for IPoolManager;

    function run() external {
        _guard();
        uint256 pk = _pk();
        string memory tokens = _read("tokens");
        address teth = vm.parseJsonAddress(tokens, ".tETH");
        address tusdg = vm.parseJsonAddress(tokens, ".tUSDG");
        address lpRouter = vm.parseJsonAddress(tokens, ".lpRouter");
        address hook = _addr("hook", ".hook");
        bool token0IsEth = teth < tusdg;
        uint256 ethUsd = vm.envUint("INIT_ETH_USD");
        uint160 sqrtP = sqrtPriceX96FromEthUsd(ethUsd, token0IsEth, ETH_DECIMALS, USD_DECIMALS);
        PoolKey[3] memory keys;
        keys[0] = _newKey(teth, tusdg, TICK_SPACING_D, hook);
        keys[1] = _newKey(teth, tusdg, TICK_SPACING_K, hook);
        keys[2] = _newKey(teth, tusdg, TICK_SPACING_F, hook);
        uint128 liquidity = _liquidityFor(sqrtP, token0IsEth, vm.envOr("LIQ_TETH", uint256(1_000)) * 1e18);

        vm.startBroadcast(pk);
        IERC20(teth).approve(lpRouter, type(uint256).max);
        IERC20(tusdg).approve(lpRouter, type(uint256).max);
        for (uint256 i; i < 3; i++) {
            IPoolManager(POOL_MANAGER).initialize(keys[i], sqrtP);
            PokeFeeHook(hook).setPoolConfig(keys[i], HOOK_FLOOR_PIPS, HOOK_FLAT_PIPS, HOOK_CAP_PIPS);
            PoolModifyLiquidityTest(lpRouter).modifyLiquidity(keys[i], _fullRange(keys[i], liquidity), "");
        }
        vm.stopBroadcast();

        for (uint256 i; i < 3; i++) {
            require(IPoolManager(POOL_MANAGER).getLiquidity(keys[i].toId()) == liquidity, "LivePools: liquidity");
        }

        string memory o = "pools";
        vm.serializeString(o, "D", _poolJson("pools.D", keys[0], token0IsEth, "ClimPoker (directional)"));
        vm.serializeString(
            o,
            "K",
            _poolJson(
                "pools.K",
                keys[1],
                token0IsEth,
                "keeper-style bot (imitation of the pattern observed on Fables' pool, not Fables' code)"
            )
        );
        vm.serializeString(o, "F", _poolJson("pools.F", keys[2], token0IsEth, "none (flat 7 bp)"));
        vm.serializeBool(o, "token0IsEth", token0IsEth);
        vm.serializeUint(o, "initEthUsd", ethUsd);
        vm.serializeUint(o, "sqrtPriceX96", sqrtP);
        string memory json = vm.serializeString(o, "liquidity", vm.toString(uint256(liquidity)));
        _write("pools", json);
    }

    function _newKey(address teth, address tusdg, int24 spacing, address hook) internal pure returns (PoolKey memory) {
        (address c0, address c1) = teth < tusdg ? (teth, tusdg) : (tusdg, teth);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), LPFeeLibrary.DYNAMIC_FEE_FLAG, spacing, IHooks(hook));
    }

    function _fullRange(PoolKey memory k, uint128 liquidity) internal pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({
            tickLower: TickMath.minUsableTick(k.tickSpacing),
            tickUpper: TickMath.maxUsableTick(k.tickSpacing),
            liquidityDelta: int256(uint256(liquidity)),
            salt: 0
        });
    }

    /// @dev L from D's full range: the tETH side is [price, max] when tETH is token0, [min, price] otherwise.
    function _liquidityFor(uint160 sqrtP, bool token0IsEth, uint256 ethAmount) internal pure returns (uint128) {
        int24 lower = TickMath.minUsableTick(TICK_SPACING_D);
        int24 upper = TickMath.maxUsableTick(TICK_SPACING_D);
        return token0IsEth
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtP, TickMath.getSqrtPriceAtTick(upper), ethAmount)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(lower), sqrtP, ethAmount);
    }
}
```

- [ ] **Step 2: Write `13_LiveDesk.s.sol`**

Deployment and recording are split across functions: a single `run()` holding every local hits solc's "Stack too deep" without via-IR (checked while writing this plan).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";

/// @notice Step 4: RiskDeskV2 (MockKeystoneForwarder, simulation mode, the CRE operator as simOperator),
///         ClimFeePolicy with every parameter from shared/params-fables.json including the per-direction premium,
///         and a directional ClimPoker on pool D, governed by our AccessManager with the batch Fables would send:
///         FEE_POKER for the poker, postEvent and postEventAndPoke behind FEE_POKER, poke behind CLIM_RUNNER (7),
///         CLIM_RUNNER granted to clim's runner bot.
/// Env: SIM_OPERATOR, RUNNER_ADDRESS.
contract LiveDesk is LiveScript {
    using stdJson for string;

    struct Deployed {
        address desk;
        address policy;
        address poker;
    }

    function run() external {
        _guard();
        address simOp = vm.envAddress("SIM_OPERATOR");
        address runner = vm.envAddress("RUNNER_ADDRESS");
        uint256 deployBlock = vm.getBlockNumber();
        Deployed memory x = _deploy(simOp, runner);
        _record(x, simOp, runner, deployBlock);
    }

    function _deploy(address simOp, address runner) internal returns (Deployed memory x) {
        AccessManager am = AccessManager(_addr("hook", ".accessManager"));
        ClimFeePolicy.Params memory params = _params();
        require(
            params.floorPips >= HOOK_FLOOR_PIPS && params.capPips <= HOOK_CAP_PIPS,
            "LiveDesk: the policy band must sit inside the hook band"
        );
        vm.startBroadcast(_pk());
        RiskDeskV2 desk = new RiskDeskV2(MOCK_FORWARDER, simOp);
        ClimFeePolicy policy = new ClimFeePolicy(desk, params);
        ClimPoker poker = new ClimPoker(policy, _addr("hook", ".hook"), _poolD(), true, _ttl(), address(am));
        _grant(am, poker, runner);
        vm.stopBroadcast();
        x = Deployed(address(desk), address(policy), address(poker));
    }

    function _record(Deployed memory x, address simOp, address runner, uint256 deployBlock) internal {
        string memory o = "desk";
        vm.serializeAddress(o, "riskDesk", x.desk);
        vm.serializeAddress(o, "policy", x.policy);
        vm.serializeAddress(o, "poker", x.poker);
        vm.serializeAddress(o, "simOperator", simOp);
        vm.serializeAddress(o, "runner", runner);
        vm.serializeBytes(o, "argsDesk", abi.encode(MOCK_FORWARDER, simOp));
        vm.serializeBytes(o, "argsPolicy", abi.encode(x.desk, _params()));
        vm.serializeBytes(
            o,
            "argsPoker",
            abi.encode(x.policy, _addr("hook", ".hook"), _poolD(), true, _ttl(), _addr("hook", ".accessManager"))
        );
        string memory json = vm.serializeUint(o, "deployBlock", deployBlock);
        _write("desk", json);
    }

    function _poolD() internal view returns (bytes32) {
        return vm.parseJsonBytes32(_read("pools"), ".D.poolId");
    }

    function _ttl() internal view returns (uint40) {
        return uint40(vm.readFile(PARAMS_PATH).readUint(".pokeTtlSec"));
    }

    function _params() internal view returns (ClimFeePolicy.Params memory) {
        string memory p = vm.readFile(PARAMS_PATH);
        bool dir = p.readBool(".dirEnabled");
        return ClimFeePolicy.Params({
            etaE4: uint32(p.readUint(".etaE4")),
            sqrtHalfDtE6: uint32(p.readUint(".sqrtHalfDtE6")),
            floorPips: uint24(p.readUint(".feeFloorPips")),
            capPips: uint24(p.readUint(".feeCapPips")),
            safePips: uint24(p.readUint(".feeSafePips")),
            tauKillSec: uint32(p.readUint(".tauKillSec")),
            shortWindow: p.readUint(".sigmaWindowSec") == 300,
            // pool D's hook takes one fee per direction, so the measured premium is used here (unlike the fork run
            // on Fables' symmetric ETH/USDG hook)
            dirSlopeE4: dir ? uint32(p.readUint(".dirSlopeE4")) : 0,
            dirMaxPremiumPips: dir ? uint24(p.readUint(".dirMaxPremiumPips")) : 0,
            ethIsToken0: vm.parseJsonBool(_read("pools"), ".token0IsEth")
        });
    }

    function _grant(AccessManager am, ClimPoker poker, address runner) internal {
        bytes4[] memory keeperSel = new bytes4[](2);
        keeperSel[0] = ClimPoker.postEvent.selector;
        keeperSel[1] = ClimPoker.postEventAndPoke.selector;
        bytes4[] memory runnerSel = new bytes4[](1);
        runnerSel[0] = ClimPoker.poke.selector;
        am.grantRole(FEE_POKER, address(poker), 0);
        am.setTargetFunctionRole(address(poker), keeperSel, FEE_POKER);
        am.labelRole(CLIM_RUNNER, "CLIM_RUNNER");
        am.setTargetFunctionRole(address(poker), runnerSel, CLIM_RUNNER);
        am.grantRole(CLIM_RUNNER, runner, 0);
    }
}
```

- [ ] **Step 3: Write `14_LiveWriteDeployments.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {LiveScript} from "./base/LiveScript.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";
import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";

/// @notice Read-only. Checks the live stack on-chain (wiring, roles, pools configured and funded), then merges the
///         fragments of deployments/<chainId>/ into ../shared/deployments/robinhood-testnet.json (chain 46630) or
///         ../shared/deployments/anvil.json (a local fork). Schema: shared/src/live.ts (parseLiveDeployments).
contract LiveWriteDeployments is LiveScript {
    string internal constant TOKEN_ID = "src/test-tokens/TestTokenDecimals.sol:TestTokenDecimals";
    string internal constant SWAP_ID = "lib/uniswap-hooks/lib/v4-core/src/test/PoolSwapTest.sol:PoolSwapTest";
    string internal constant LP_ID =
        "lib/uniswap-hooks/lib/v4-core/src/test/PoolModifyLiquidityTest.sol:PoolModifyLiquidityTest";
    string internal constant AM_ID =
        "lib/uniswap-hooks/lib/openzeppelin-contracts/contracts/access/manager/AccessManager.sol:AccessManager";

    function run() external {
        _guard();
        _check();
        string memory root = "live";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deployBlock", vm.parseJsonUint(_read("tokens"), ".deployBlock"));
        vm.serializeAddress(root, "deployer", _addr("tokens", ".deployer"));
        vm.serializeString(root, "uniswap", _uniswap());
        vm.serializeString(root, "routers", _routers());
        vm.serializeString(root, "cre", _cre());
        vm.serializeAddress(root, "accessManager", _addr("hook", ".accessManager"));
        vm.serializeString(root, "roles", _roles());
        vm.serializeString(root, "tokens", _tokens());
        vm.serializeAddress(root, "hook", _addr("hook", ".hook"));
        vm.serializeString(root, "hookConfig", _hookConfig());
        vm.serializeAddress(root, "riskDesk", _addr("desk", ".riskDesk"));
        vm.serializeAddress(root, "policy", _addr("desk", ".policy"));
        vm.serializeAddress(root, "poker", _addr("desk", ".poker"));
        vm.serializeString(root, "pools", _pools());
        vm.serializeString(root, "liquidity", vm.parseJsonString(_read("pools"), ".liquidity"));
        vm.serializeUint(root, "initEthUsd", vm.parseJsonUint(_read("pools"), ".initEthUsd"));
        string memory json = vm.serializeString(root, "verify", _verify());
        string memory out = block.chainid == RH_TESTNET
            ? "../shared/deployments/robinhood-testnet.json"
            : "../shared/deployments/anvil.json";
        vm.writeJson(json, out);
    }

    function _check() internal view {
        address hook = _addr("hook", ".hook");
        AccessManager am = AccessManager(_addr("hook", ".accessManager"));
        RiskDeskV2 desk = RiskDeskV2(_addr("desk", ".riskDesk"));
        ClimFeePolicy policy = ClimFeePolicy(_addr("desk", ".policy"));
        ClimPoker poker = ClimPoker(_addr("desk", ".poker"));
        require(PokeFeeHook(hook).authority() == address(am), "hook: wrong authority");
        require(
            am.getTargetFunctionRole(hook, bytes4(keccak256("pokeFee(bytes32,uint24,uint24,uint40)"))) == FEE_POKER,
            "hook: pokeFee is not behind FEE_POKER"
        );
        require(address(policy.desk()) == address(desk), "policy: wrong desk");
        require(desk.simMode() && desk.getForwarderAddress() == MOCK_FORWARDER, "desk: not in simulation mode");
        require(address(poker.policy()) == address(policy) && poker.hook() == hook, "poker: wrong wiring");
        require(poker.poolId() == vm.parseJsonBytes32(_read("pools"), ".D.poolId") && poker.directional(), "poker: D");
        require(poker.authority() == address(am), "poker: wrong authority");
        (bool pokerIsPoker,) = am.hasRole(FEE_POKER, address(poker));
        (bool runnerOk,) = am.hasRole(CLIM_RUNNER, _addr("desk", ".runner"));
        (bool keeperOk,) = am.hasRole(FEE_POKER, _addr("hook", ".keeper"));
        require(pokerIsPoker && runnerOk && keeperOk, "roles: a grant is missing");
        require(am.getTargetFunctionRole(address(poker), ClimPoker.poke.selector) == CLIM_RUNNER, "poker: poke role");
        _checkPool(hook, ".D");
        _checkPool(hook, ".K");
        _checkPool(hook, ".F");
    }

    function _checkPool(address hook, string memory which) internal view {
        bytes32 id = vm.parseJsonBytes32(_read("pools"), string.concat(which, ".poolId"));
        (uint160 sqrtP,,,) = IStateView(STATE_VIEW).getSlot0(PoolId.wrap(id));
        require(sqrtP != 0, string.concat(which, ": not initialized"));
        require(IStateView(STATE_VIEW).getLiquidity(PoolId.wrap(id)) > 0, string.concat(which, ": no liquidity"));
        (uint24 floorPips, uint24 flatPips, uint24 capPips, bool set) = PokeFeeHook(hook).configs(PoolId.wrap(id));
        require(
            set && floorPips == HOOK_FLOOR_PIPS && flatPips == HOOK_FLAT_PIPS && capPips == HOOK_CAP_PIPS,
            string.concat(which, ": hook config")
        );
    }

    function _uniswap() internal returns (string memory) {
        string memory o = "uniswap";
        vm.serializeAddress(o, "poolManager", POOL_MANAGER);
        vm.serializeAddress(o, "stateView", STATE_VIEW);
        vm.serializeAddress(o, "poolSwapTest", _addr("tokens", ".swapRouter"));
        return vm.serializeAddress(o, "poolModifyLiquidityTest", _addr("tokens", ".lpRouter"));
    }

    function _routers() internal returns (string memory) {
        return vm.serializeAddress("routers", "arb", _addr("tokens", ".arbRouter"));
    }

    function _cre() internal returns (string memory) {
        string memory o = "cre";
        vm.serializeAddress(o, "mockForwarder", MOCK_FORWARDER);
        vm.serializeAddress(o, "keystoneForwarder", KEYSTONE_FORWARDER);
        return vm.serializeAddress(o, "simOperator", _addr("desk", ".simOperator"));
    }

    function _roles() internal returns (string memory) {
        string memory o = "roles";
        vm.serializeUint(o, "feePoker", FEE_POKER);
        vm.serializeUint(o, "climRunner", CLIM_RUNNER);
        vm.serializeAddress(o, "runner", _addr("desk", ".runner"));
        return vm.serializeAddress(o, "keeper", _addr("hook", ".keeper"));
    }

    function _token(string memory o, address a, string memory symbol, uint8 decimals) internal returns (string memory) {
        vm.serializeAddress(o, "address", a);
        vm.serializeString(o, "symbol", symbol);
        return vm.serializeUint(o, "decimals", decimals);
    }

    function _tokens() internal returns (string memory) {
        string memory o = "tokens.out";
        vm.serializeString(o, "tETH", _token("tokens.tETH", _addr("tokens", ".tETH"), "tETH", ETH_DECIMALS));
        return vm.serializeString(o, "tUSDG", _token("tokens.tUSDG", _addr("tokens", ".tUSDG"), "tUSDG", USD_DECIMALS));
    }

    function _hookConfig() internal returns (string memory) {
        string memory o = "hookConfig";
        vm.serializeUint(o, "floorPips", HOOK_FLOOR_PIPS);
        vm.serializeUint(o, "flatPips", HOOK_FLAT_PIPS);
        return vm.serializeUint(o, "capPips", HOOK_CAP_PIPS);
    }

    function _pools() internal returns (string memory) {
        string memory pools = _read("pools");
        string memory o = "pools.out";
        vm.serializeString(o, "D", _pool(pools, "D"));
        vm.serializeString(o, "K", _pool(pools, "K"));
        return vm.serializeString(o, "F", _pool(pools, "F"));
    }

    function _pool(string memory pools, string memory name) internal returns (string memory) {
        string memory base = string.concat(".", name);
        return _poolJson(
            string.concat("out.", name),
            _keyFrom(pools, base),
            vm.parseJsonBool(pools, string.concat(base, ".token0IsEth")),
            vm.parseJsonString(pools, string.concat(base, ".driver"))
        );
    }

    function _entry(string memory name, address a, string memory id, bytes memory args)
        internal
        returns (string memory)
    {
        string memory o = string.concat("verify.", name);
        vm.serializeAddress(o, "address", a);
        vm.serializeString(o, "contract", id);
        return vm.serializeBytes(o, "args", args);
    }

    function _verify() internal returns (string memory) {
        string memory t = _read("tokens");
        string memory h = _read("hook");
        string memory d = _read("desk");
        bytes memory routerArgs = vm.parseJsonBytes(t, ".argsRouter");
        string memory o = "verify";
        vm.serializeString(o, "tETH", _entry("tETH", _addr("tokens", ".tETH"), TOKEN_ID, vm.parseJsonBytes(t, ".argsTETH")));
        vm.serializeString(o, "tUSDG", _entry("tUSDG", _addr("tokens", ".tUSDG"), TOKEN_ID, vm.parseJsonBytes(t, ".argsTUSDG")));
        vm.serializeString(o, "swapRouter", _entry("swapRouter", _addr("tokens", ".swapRouter"), SWAP_ID, routerArgs));
        vm.serializeString(o, "arbRouter", _entry("arbRouter", _addr("tokens", ".arbRouter"), SWAP_ID, routerArgs));
        vm.serializeString(o, "lpRouter", _entry("lpRouter", _addr("tokens", ".lpRouter"), LP_ID, routerArgs));
        vm.serializeString(
            o, "accessManager", _entry("accessManager", _addr("hook", ".accessManager"), AM_ID, vm.parseJsonBytes(h, ".argsAccessManager"))
        );
        vm.serializeString(
            o, "hook", _entry("hook", _addr("hook", ".hook"), "src/v2/PokeFeeHook.sol:PokeFeeHook", vm.parseJsonBytes(h, ".argsHook"))
        );
        vm.serializeString(
            o, "riskDesk", _entry("riskDesk", _addr("desk", ".riskDesk"), "src/v2/RiskDeskV2.sol:RiskDeskV2", vm.parseJsonBytes(d, ".argsDesk"))
        );
        vm.serializeString(
            o, "policy", _entry("policy", _addr("desk", ".policy"), "src/v2/ClimFeePolicy.sol:ClimFeePolicy", vm.parseJsonBytes(d, ".argsPolicy"))
        );
        return vm.serializeString(
            o, "poker", _entry("poker", _addr("desk", ".poker"), "src/v2/ClimPoker.sol:ClimPoker", vm.parseJsonBytes(d, ".argsPoker"))
        );
    }
}
```

`desk.getForwarderAddress()` is the vendored `ReceiverTemplate` getter (`contracts/src/receiver/ReceiverTemplate.sol:54`). Forge's `serializeString` embeds a value that is a JSON object as an object and keeps any other string as a string (checked with forge 1.4.2: a 30-digit decimal string stays a string), which is how the nested objects and the `liquidity` string are written.

- [ ] **Step 4: Write the driver**

Create `contracts/script/v2/deploy-live.sh` and make it executable (`chmod +x`):

```bash
#!/usr/bin/env bash
# Deploys clim's live reference stack (plan 03): tokens and routers, AccessManager and PokeFeeHook, pools D/K/F with
# liquidity, RiskDeskV2 + ClimFeePolicy + ClimPoker with the roles, then writes shared/deployments/robinhood-testnet.json
# (chain 46630) or shared/deployments/anvil.json (a local fork run as chain 31337).
# Usage: contracts/script/v2/deploy-live.sh <rpc-url>     (FROM=12 resumes at step 12 after a failure)
# Env: PRIVATE_KEY (contracts/.env, loaded by forge), SIM_OPERATOR, RUNNER_ADDRESS, KEEPER_ADDRESS, INIT_ETH_USD;
#      optional LIQ_TETH (default 1000), MINT_TETH, MINT_TUSDG.
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC="${1:?usage: script/v2/deploy-live.sh <rpc-url>}"
CHAIN=$(cast chain-id --rpc-url "$RPC")
if [ "$CHAIN" = "4663" ]; then
  echo "refusing: chain 4663 is Robinhood Chain mainnet" >&2
  exit 1
fi
: "${SIM_OPERATOR:?export SIM_OPERATOR (bun run live:keys --exports)}"
: "${RUNNER_ADDRESS:?export RUNNER_ADDRESS}"
: "${KEEPER_ADDRESS:?export KEEPER_ADDRESS}"
: "${INIT_ETH_USD:?export INIT_ETH_USD (whole dollars)}"
FROM="${FROM:-10}"
for step in 10_LiveTokens:LiveTokens 11_LiveAccessHook:LiveAccessHook 12_LivePools:LivePools 13_LiveDesk:LiveDesk; do
  n="${step%%_*}"
  if [ "$n" -lt "$FROM" ]; then continue; fi
  echo "=== chain ${CHAIN}: ${step%%:*}"
  forge script "script/v2/${step%%:*}.s.sol:${step##*:}" --rpc-url "$RPC" --broadcast --slow --gas-estimate-multiplier 200 -v
done
echo "=== chain ${CHAIN}: 14_LiveWriteDeployments"
forge script script/v2/14_LiveWriteDeployments.s.sol:LiveWriteDeployments --rpc-url "$RPC" -v
if [ "$CHAIN" = "46630" ]; then OUT=../shared/deployments/robinhood-testnet.json; else OUT=../shared/deployments/anvil.json; fi
jq '{chainId, hook, riskDesk, policy, poker, pools: (.pools | map_values(.poolId))}' "$OUT"
```

- [ ] **Step 5: Write the fork smoke test**

Create `contracts/script/v2/live-smoke.sh` and make it executable:

```bash
#!/usr/bin/env bash
# End-to-end smoke test of the live stack on a local anvil fork of Robinhood Chain testnet (chain 31337), after
# deploy-live.sh: one desk report through the MockKeystoneForwarder (as the CRE operator), ClimPoker.poke() (as the
# runner), one keeper poke on K (1,480 pips, 7,200 s), then a small swap each way on D, K and F, printing the fee each
# swap paid (the last field of PoolManager's Swap event). Fork only: it impersonates the stack's addresses.
# Usage: contracts/script/v2/live-smoke.sh [rpc-url, default http://127.0.0.1:8545]
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC="${1:-http://127.0.0.1:8545}"
if [ "$(cast chain-id --rpc-url "$RPC")" != "31337" ]; then
  echo "live-smoke.sh runs on a local fork (chain 31337) only" >&2
  exit 1
fi
DEP=../shared/deployments/anvil.json
j() { jq -r "$1" "$DEP"; }
DESK=$(j .riskDesk); POLICY=$(j .policy); POKER=$(j .poker); HOOK=$(j .hook); FWD=$(j .cre.mockForwarder)
OP=$(j .cre.simOperator); RUNNER=$(j .roles.runner); KEEPER=$(j .roles.keeper); DEPLOYER=$(j .deployer)
ROUTER=$(j .uniswap.poolSwapTest); PM=$(j .uniswap.poolManager)
for A in "$OP" "$RUNNER" "$KEEPER" "$DEPLOYER"; do
  cast rpc anvil_impersonateAccount "$A" --rpc-url "$RPC" >/dev/null
  cast rpc anvil_setBalance "$A" 0x8AC7230489E80000 --rpc-url "$RPC" >/dev/null
done
send() { cast send "$@" --unlocked --rpc-url "$RPC" --json; }
gas() { cast to-dec "$(jq -r .gasUsed)"; }

NOW=$(cast block latest --field timestamp --rpc-url "$RPC")
REPORT=$(cast abi-encode "f(uint40,uint32,uint32,int32,uint16,uint8,uint16)" "$NOW" 85475 85475 1200 3 4 10000)
RAW=$(cast concat-hex "0x01$(printf '%0216d' 0)" "$REPORT")
echo "report gasUsed $(send "$FWD" "report(address,bytes,bytes,bytes[])" "$DESK" "$RAW" 0x "[]" --from "$OP" | gas)"
echo "desk state: $(cast call "$DESK" 'state()(uint40,uint32,uint32,int32,uint16,uint8,uint32)' --rpc-url "$RPC" | tr '\n' ' ')"
echo "policy quoteDirectional: $(cast call "$POLICY" 'quoteDirectional()(uint24,uint24,uint8)' --rpc-url "$RPC" | tr '\n' ' ')"
echo "poke gasUsed $(send "$POKER" "poke()" --from "$RUNNER" | gas)"
echo "keeper poke gasUsed $(send "$HOOK" "pokeFee(bytes32,uint24,uint40)" "$(j .pools.K.poolId)" 1480 7200 --from "$KEEPER" | gas)"

for T in "$(j .tokens.tETH.address)" "$(j .tokens.tUSDG.address)"; do
  send "$T" "approve(address,uint256)" "$ROUTER" "$(cast max-uint)" --from "$DEPLOYER" >/dev/null
done
SWAP_TOPIC=$(cast sig-event "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
PM_LC=$(echo "$PM" | tr 'A-F' 'a-f')
if [ "$(j .pools.D.token0IsEth)" = "true" ]; then A0=-1000000000000000; A1=-2500000; else A0=-2500000; A1=-1000000000000000; fi
MIN=4295128740
MAX=1461446703485210103287273052203988822378723970341
swap_fee() { # $1 PoolKey tuple, $2 zeroForOne, $3 amountSpecified (negative: exact input), $4 price limit
  send "$ROUTER" "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)" \
    "$1" "($2,$3,$4)" "(false,false)" 0x --from "$DEPLOYER" |
    jq -r --arg pm "$PM_LC" --arg t "$SWAP_TOPIC" \
      '.logs[] | select((.address | ascii_downcase) == $pm and .topics[0] == $t) | .data' |
    python3 -c "import sys; print(int(sys.stdin.read().strip()[-64:], 16))"
}
for P in D K F; do
  KEY="($(j .pools.$P.key.currency0),$(j .pools.$P.key.currency1),$(j .pools.$P.key.fee),$(j .pools.$P.key.tickSpacing),$(j .pools.$P.key.hooks))"
  ID=$(j .pools.$P.poolId)
  F01=$(cast call "$HOOK" 'currentFee(bytes32,bool)(uint24)' "$ID" true --rpc-url "$RPC")
  F10=$(cast call "$HOOK" 'currentFee(bytes32,bool)(uint24)' "$ID" false --rpc-url "$RPC")
  echo "$P currentFee zeroForOne $F01 oneForZero $F10 | swap paid zeroForOne $(swap_fee "$KEY" true "$A0" "$MIN") oneForZero $(swap_fee "$KEY" false "$A1" "$MAX")"
done
```

- [ ] **Step 6: Compile**

Run: `cd contracts && forge fmt script/v2 && forge build && bash -n script/v2/deploy-live.sh && bash -n script/v2/live-smoke.sh && echo ok`
Expected: `Compiler run successful` then `ok`.

- [ ] **Step 7: Run the whole contracts suite**

Run: `cd contracts && RH_MAINNET_RPC_URL= SEPOLIA_RPC_URL= forge test && forge fmt --check && echo fmt-clean`
Expected: the plan 02 count (148 passed, 3 skipped) plus 8 new tests: `156 passed, 3 skipped`, then `fmt-clean`.

- [ ] **Step 8: Commit**

```bash
git add contracts/script/v2/12_LivePools.s.sol contracts/script/v2/13_LiveDesk.s.sol contracts/script/v2/14_LiveWriteDeployments.s.sol contracts/script/v2/deploy-live.sh contracts/script/v2/live-smoke.sh
git commit -m "feat(contracts): live stack deploy steps 3-5, pools D/K/F, desk, policy and poker, deployments file" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 8: `shared`, the live deployments parser and the v2 ABI fragments

**Files:**
- Create: `shared/src/live.ts`, `shared/src/abisV2.ts`
- Modify: `shared/src/index.ts`, `shared/package.json`
- Test: `shared/test/live.test.ts`, `shared/test/abisV2.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `shared/test/live.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { DYNAMIC_FEE_FLAG, liveOrientation, parseLiveDeployments, poolIdFromKey, type PoolKey } from "../src/index";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const TETH = A(0xe7);
const TUSDG = A(0xf0); // > tETH: tETH is currency0
const HOOK = "0x0000000000000000000000000000000000001080" as const;

function key(tickSpacing: number): PoolKey {
  return { currency0: TETH, currency1: TUSDG, fee: DYNAMIC_FEE_FLAG, tickSpacing, hooks: HOOK };
}
function pool(tickSpacing: number, driver: string) {
  const k = key(tickSpacing);
  return { key: k, poolId: poolIdFromKey(k), token0IsEth: true, driver };
}
function raw() {
  return {
    chainId: 46630,
    deployBlock: 134_550_720,
    deployer: A(1),
    uniswap: { poolManager: A(2), stateView: A(3), poolSwapTest: A(4), poolModifyLiquidityTest: A(5) },
    routers: { arb: A(6) },
    cre: { mockForwarder: A(7), keystoneForwarder: A(8), simOperator: A(9) },
    accessManager: A(10),
    roles: { feePoker: 1, climRunner: 7, runner: A(11), keeper: A(12) },
    tokens: {
      tETH: { address: TETH, symbol: "tETH", decimals: 18 },
      tUSDG: { address: TUSDG, symbol: "tUSDG", decimals: 6 },
    },
    hook: HOOK,
    hookConfig: { floorPips: 100, flatPips: 700, capPips: 6000 },
    riskDesk: A(13),
    policy: A(14),
    poker: A(15),
    pools: { D: pool(10, "ClimPoker (directional)"), K: pool(11, "keeper-style bot"), F: pool(12, "none (flat 7 bp)") },
    liquidity: "123456789012345678901234",
    initEthUsd: 2500,
    verify: {},
  };
}

describe("parseLiveDeployments", () => {
  test("accepts the file 14_LiveWriteDeployments writes", () => {
    const d = parseLiveDeployments(raw());
    expect(d.chainId).toBe(46630);
    expect(d.pools.D.poolId).toBe(poolIdFromKey(key(10)));
    expect(d.pools.K.key.tickSpacing).toBe(11);
    expect(d.tokens.tUSDG.decimals).toBe(6);
    expect(d.liquidity).toBe(123456789012345678901234n);
    expect(d.roles.climRunner).toBe(7);
  });
  test("orientation of a pool: ETH token0 with 18 and 6 decimals", () => {
    const d = parseLiveDeployments(raw());
    expect(liveOrientation(d, d.pools.D)).toEqual({ token0IsEth: true, decimals0: 18, decimals1: 6 });
  });
  test("rejects another chain unless allowed (a local fork runs as 31337)", () => {
    const r = { ...raw(), chainId: 31337 };
    expect(() => parseLiveDeployments(r)).toThrow(/chainId/);
    expect(parseLiveDeployments(r, [31337]).chainId).toBe(31337);
  });
  test("rejects a poolId that does not match its key", () => {
    const r = raw();
    r.pools.K.poolId = `0x${"00".repeat(32)}` as `0x${string}`;
    expect(() => parseLiveDeployments(r)).toThrow(/pools.K.poolId/);
  });
  test("rejects a pool on another hook or without the dynamic-fee flag", () => {
    const r = raw();
    const k = { ...key(12), fee: 700 };
    r.pools.F = { key: k, poolId: poolIdFromKey(k), token0IsEth: true, driver: "x" };
    expect(() => parseLiveDeployments(r)).toThrow(/dynamic fee flag/);
  });
  test("rejects a wrong token order flag", () => {
    const r = raw();
    r.pools.D.token0IsEth = false;
    expect(() => parseLiveDeployments(r)).toThrow(/token0IsEth/);
  });
});
```

Create `shared/test/abisV2.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toEventSelector, toFunctionSelector, type AbiParameter } from "viem";
import { accessManagerAbi, climFeePolicyAbi, climPokerAbi, pokeFeeHookAbi, poolManagerSwapEventAbi, riskDeskV2Abi } from "../src/abisV2";

type Item = { type: string; name?: string; inputs?: readonly AbiParameter[]; outputs?: readonly AbiParameter[] };
function typeOf(p: AbiParameter): string {
  if (p.type.startsWith("tuple") && "components" in p && p.components) return `(${p.components.map(typeOf).join(",")})${p.type.slice(5)}`;
  return p.type;
}
function canonical(item: Item): string {
  const ins = (item.inputs ?? []).map((p) => `${typeOf(p)}${"indexed" in p && p.indexed ? " indexed" : ""}`);
  return `${item.type} ${item.name}(${ins.join(",")}) -> (${(item.outputs ?? []).map(typeOf).join(",")})`;
}

const ABI_DIR = join(import.meta.dir, "..", "abis");
const OURS: Array<[string, readonly Item[]]> = [
  ["RiskDeskV2", riskDeskV2Abi],
  ["ClimFeePolicy", climFeePolicyAbi],
  ["ClimPoker", climPokerAbi],
  ["PokeFeeHook", pokeFeeHookAbi],
  ["IPoolManager", poolManagerSwapEventAbi],
];

describe("v2 fragments match the compiled contracts (shared/abis/*.json)", () => {
  for (const [name, fragments] of OURS) {
    const file = join(ABI_DIR, `${name}.json`);
    test.skipIf(!existsSync(file))(`${name}: every fragment exists with the same signature`, () => {
      const compiled = new Set((JSON.parse(readFileSync(file, "utf8")) as Item[]).map(canonical));
      for (const f of fragments) expect(compiled.has(canonical(f))).toBe(true);
    });
  }
});

describe("selectors", () => {
  test("both pokeFee overloads and currentFee", () => {
    const sels = pokeFeeHookAbi.flatMap((x) => (x.type === "function" ? [toFunctionSelector(x)] : []));
    expect(sels).toContain(toFunctionSelector("function pokeFee(bytes32,uint24,uint40)"));
    expect(sels).toContain(toFunctionSelector("function pokeFee(bytes32,uint24,uint24,uint40)"));
    expect(sels).toContain("0x15452022"); // currentFee(bytes32,bool), as on Fables' hook
  });
  test("AccessManager.hasRole(uint64,address)", () => {
    expect(toFunctionSelector(accessManagerAbi[0])).toBe(toFunctionSelector("function hasRole(uint64,address)"));
  });
  test("RiskReportedV2 topic", () => {
    expect(toEventSelector(riskDeskV2Abi[1])).toBe(
      toEventSelector("event RiskReportedV2(uint32 indexed,uint40,uint32,uint32,uint32,uint32,int32,uint16,uint8,uint16,uint8)"),
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd shared && bun test`
Expected: FAIL with `Export named 'parseLiveDeployments' not found` and `Cannot find module '../src/abisV2'`.

- [ ] **Step 3: Write the ABI fragments**

Create `shared/src/abisV2.ts`:

```ts
// Typed ABI fragments of the clim × Fables contracts (contracts/src/v2) and the external ones the live bots read.
// test/abisV2.test.ts checks them against shared/abis/*.json (contracts/script/export-abis.sh).

/** contracts/src/v2/RiskDeskV2.sol */
export const riskDeskV2Abi = [
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tObs", type: "uint40" },
      { name: "sigma15E9", type: "uint32" },
      { name: "sigma5E9", type: "uint32" },
      { name: "devPips", type: "int32" },
      { name: "kE4", type: "uint16" },
      { name: "flags", type: "uint8" },
      { name: "seq", type: "uint32" },
    ],
  },
  {
    type: "event",
    name: "RiskReportedV2",
    inputs: [
      { name: "seq", type: "uint32", indexed: true },
      { name: "tObs", type: "uint40", indexed: false },
      { name: "sigma15Applied", type: "uint32", indexed: false },
      { name: "sigma5Applied", type: "uint32", indexed: false },
      { name: "sigma15Reported", type: "uint32", indexed: false },
      { name: "sigma5Reported", type: "uint32", indexed: false },
      { name: "devPips", type: "int32", indexed: false },
      { name: "dispBp", type: "uint16", indexed: false },
      { name: "nSources", type: "uint8", indexed: false },
      { name: "kE4", type: "uint16", indexed: false },
      { name: "flags", type: "uint8", indexed: false },
    ],
  },
] as const;

/** contracts/src/v2/ClimFeePolicy.sol: mode 0 normal, 1 degraded, 2 blind. */
export const climFeePolicyAbi = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fee", type: "uint24" },
      { name: "mode", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "quoteDirectional",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fee0For1", type: "uint24" },
      { name: "fee1For0", type: "uint24" },
      { name: "mode", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "lastObservation",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tObs", type: "uint40" },
      { name: "seq", type: "uint32" },
    ],
  },
] as const;

/** contracts/src/v2/ClimPoker.sol */
export const climPokerAbi = [
  {
    type: "function",
    name: "poke",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "fee0For1", type: "uint24" },
      { name: "fee1For0", type: "uint24" },
    ],
  },
  {
    type: "event",
    name: "Poked",
    inputs: [
      { name: "seq", type: "uint32", indexed: true },
      { name: "tObs", type: "uint40", indexed: false },
      { name: "fee0For1", type: "uint24", indexed: false },
      { name: "fee1For0", type: "uint24", indexed: false },
      { name: "mode", type: "uint8", indexed: false },
      { name: "eventApplied", type: "bool", indexed: false },
      { name: "expiry", type: "uint40", indexed: false },
      { name: "caller", type: "address", indexed: false },
    ],
  },
  { type: "error", name: "DeskBlind", inputs: [] },
  { type: "error", name: "AccessManagedUnauthorized", inputs: [{ name: "caller", type: "address" }] },
] as const;

/** contracts/src/v2/PokeFeeHook.sol (the same public interface as Fables' override hooks). */
export const pokeFeeHookAbi = [
  {
    type: "function",
    name: "pokeFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "fee", type: "uint24" },
      { name: "ttl", type: "uint40" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pokeFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "fee0For1", type: "uint24" },
      { name: "fee1For0", type: "uint24" },
      { name: "ttl", type: "uint40" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "currentFee",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "zeroForOne", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint24" }],
  },
  {
    type: "event",
    name: "FeePoked",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "fee", type: "uint24", indexed: false },
      { name: "expiry", type: "uint40", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeePoked",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "fee0For1", type: "uint24", indexed: false },
      { name: "fee1For0", type: "uint24", indexed: false },
      { name: "expiry", type: "uint40", indexed: false },
    ],
  },
  { type: "error", name: "FeeOutOfBounds", inputs: [{ name: "fee", type: "uint24" }] },
  { type: "error", name: "InvalidTtl", inputs: [{ name: "ttl", type: "uint40" }] },
  { type: "error", name: "PoolNotConfigured", inputs: [{ name: "poolId", type: "bytes32" }] },
  { type: "error", name: "AccessManagedUnauthorized", inputs: [{ name: "caller", type: "address" }] },
] as const;

/** OpenZeppelin AccessManager (5.x): hasRole(roleId, account) -> (isMember, executionDelay). */
export const accessManagerAbi = [
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "roleId", type: "uint64" },
      { name: "account", type: "address" },
    ],
    outputs: [
      { name: "isMember", type: "bool" },
      { name: "executionDelay", type: "uint32" },
    ],
  },
] as const;

/** Uniswap v4 PoolManager Swap event (v4-core IPoolManager); `fee` is the LP fee the swap paid, in pips. */
export const poolManagerSwapEventAbi = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "int128", indexed: false },
      { name: "amount1", type: "int128", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
      { name: "fee", type: "uint24", indexed: false },
    ],
  },
] as const;
```

- [ ] **Step 4: Write the parser**

Create `shared/src/live.ts`:

```ts
// Typed, validated loader for shared/deployments/robinhood-testnet.json, written by
// contracts/script/v2/14_LiveWriteDeployments.s.sol: clim's live reference stack on Robinhood Chain testnet.
// Runtime-agnostic (the bots load the file and pass it in; plan 04's app parses it the same way).
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { DYNAMIC_FEE_FLAG, poolIdFromKey, type PoolKey, type TokenEntry } from "./config";
import type { PairOrientation } from "./price";

export const RH_TESTNET_CHAIN_ID = 46630;
export const LIVE_POOLS = ["D", "K", "F"] as const;
export type LivePoolName = (typeof LIVE_POOLS)[number];
export type LivePool = { name: LivePoolName; key: PoolKey; poolId: Hex; token0IsEth: boolean; driver: string };

export type LiveDeployments = {
  chainId: number;
  deployBlock: number;
  deployer: Address;
  uniswap: { poolManager: Address; stateView: Address; poolSwapTest: Address; poolModifyLiquidityTest: Address };
  routers: { arb: Address };
  cre: { mockForwarder: Address; keystoneForwarder: Address; simOperator: Address };
  accessManager: Address;
  roles: { feePoker: number; climRunner: number; runner: Address; keeper: Address };
  tokens: { tETH: TokenEntry; tUSDG: TokenEntry };
  hook: Address;
  hookConfig: { floorPips: number; flatPips: number; capPips: number };
  riskDesk: Address;
  policy: Address;
  poker: Address;
  pools: Record<LivePoolName, LivePool>;
  liquidity: bigint;
  initEthUsd: number;
};

type Json = Record<string, unknown>;

function jobj(v: unknown, path: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${path}: expected an object`);
  return v as Json;
}
function jaddr(v: unknown, path: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new Error(`${path}: expected an address, got ${String(v)}`);
  return getAddress(v);
}
function jint(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${path}: expected an integer in [${min}, ${max}], got ${String(v)}`);
  }
  return v;
}
function jtoken(v: unknown, path: string, decimals: number): TokenEntry {
  const o = jobj(v, path);
  if (typeof o.symbol !== "string") throw new Error(`${path}.symbol: expected a string`);
  return { address: jaddr(o.address, `${path}.address`), symbol: o.symbol, decimals: jint(o.decimals, `${path}.decimals`, decimals, decimals) };
}

function jpool(v: unknown, name: LivePoolName, hook: Address, tETH: TokenEntry, tUSDG: TokenEntry): LivePool {
  const path = `pools.${name}`;
  const o = jobj(v, path);
  const k = jobj(o.key, `${path}.key`);
  const key: PoolKey = {
    currency0: jaddr(k.currency0, `${path}.key.currency0`),
    currency1: jaddr(k.currency1, `${path}.key.currency1`),
    fee: jint(k.fee, `${path}.key.fee`, 0, DYNAMIC_FEE_FLAG),
    tickSpacing: jint(k.tickSpacing, `${path}.key.tickSpacing`, 1, 32767),
    hooks: jaddr(k.hooks, `${path}.key.hooks`),
  };
  if (typeof o.poolId !== "string" || o.poolId.toLowerCase() !== poolIdFromKey(key)) {
    throw new Error(`${path}.poolId does not match keccak256(abi.encode(key)) = ${poolIdFromKey(key)}`);
  }
  if (key.fee !== DYNAMIC_FEE_FLAG) throw new Error(`${path}.key.fee must be the dynamic fee flag 0x800000`);
  if (key.hooks !== hook) throw new Error(`${path}.key.hooks must be the hook ${hook}`);
  const pair = [tETH.address, tUSDG.address].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  if (key.currency0 !== pair[0] || key.currency1 !== pair[1]) throw new Error(`${path}.key: currencies must be tETH and tUSDG, sorted`);
  if (o.token0IsEth !== (key.currency0 === tETH.address)) throw new Error(`${path}.token0IsEth does not match the token order`);
  if (typeof o.driver !== "string") throw new Error(`${path}.driver: expected a string`);
  return { name, key, poolId: poolIdFromKey(key), token0IsEth: o.token0IsEth as boolean, driver: o.driver };
}

export function parseLiveDeployments(raw: unknown, allowedChainIds: readonly number[] = [RH_TESTNET_CHAIN_ID]): LiveDeployments {
  const o = jobj(raw, "deployments");
  const chainId = jint(o.chainId, "chainId", 1, Number.MAX_SAFE_INTEGER);
  if (!allowedChainIds.includes(chainId)) throw new Error(`chainId must be one of ${allowedChainIds.join(", ")}, got ${chainId}`);
  const u = jobj(o.uniswap, "uniswap");
  const c = jobj(o.cre, "cre");
  const r = jobj(o.roles, "roles");
  const t = jobj(o.tokens, "tokens");
  const hc = jobj(o.hookConfig, "hookConfig");
  const tETH = jtoken(t.tETH, "tokens.tETH", 18);
  const tUSDG = jtoken(t.tUSDG, "tokens.tUSDG", 6);
  const hook = jaddr(o.hook, "hook");
  const p = jobj(o.pools, "pools");
  const pools = {
    D: jpool(p.D, "D", hook, tETH, tUSDG),
    K: jpool(p.K, "K", hook, tETH, tUSDG),
    F: jpool(p.F, "F", hook, tETH, tUSDG),
  };
  if (new Set(LIVE_POOLS.map((n) => pools[n].poolId)).size !== 3) throw new Error("pools: D, K and F must be three pools");
  if (typeof o.liquidity !== "string" || !/^[0-9]+$/.test(o.liquidity)) throw new Error("liquidity: expected a decimal string");
  return {
    chainId,
    deployBlock: jint(o.deployBlock, "deployBlock", 0, Number.MAX_SAFE_INTEGER),
    deployer: jaddr(o.deployer, "deployer"),
    uniswap: {
      poolManager: jaddr(u.poolManager, "uniswap.poolManager"),
      stateView: jaddr(u.stateView, "uniswap.stateView"),
      poolSwapTest: jaddr(u.poolSwapTest, "uniswap.poolSwapTest"),
      poolModifyLiquidityTest: jaddr(u.poolModifyLiquidityTest, "uniswap.poolModifyLiquidityTest"),
    },
    routers: { arb: jaddr(jobj(o.routers, "routers").arb, "routers.arb") },
    cre: {
      mockForwarder: jaddr(c.mockForwarder, "cre.mockForwarder"),
      keystoneForwarder: jaddr(c.keystoneForwarder, "cre.keystoneForwarder"),
      simOperator: jaddr(c.simOperator, "cre.simOperator"),
    },
    accessManager: jaddr(o.accessManager, "accessManager"),
    roles: {
      feePoker: jint(r.feePoker, "roles.feePoker", 0, Number.MAX_SAFE_INTEGER),
      climRunner: jint(r.climRunner, "roles.climRunner", 0, Number.MAX_SAFE_INTEGER),
      runner: jaddr(r.runner, "roles.runner"),
      keeper: jaddr(r.keeper, "roles.keeper"),
    },
    tokens: { tETH, tUSDG },
    hook,
    hookConfig: {
      floorPips: jint(hc.floorPips, "hookConfig.floorPips", 1, 1_000_000),
      flatPips: jint(hc.flatPips, "hookConfig.flatPips", 1, 1_000_000),
      capPips: jint(hc.capPips, "hookConfig.capPips", 1, 1_000_000),
    },
    riskDesk: jaddr(o.riskDesk, "riskDesk"),
    policy: jaddr(o.policy, "policy"),
    poker: jaddr(o.poker, "poker"),
    pools,
    liquidity: BigInt(o.liquidity),
    initEthUsd: jint(o.initEthUsd, "initEthUsd", 1, 1_000_000_000),
  };
}

/** How a live pool's token0/token1 map to ETH/USD, for the price helpers in ./price. */
export function liveOrientation(d: LiveDeployments, pool: LivePool): PairOrientation {
  return pool.token0IsEth
    ? { token0IsEth: true, decimals0: d.tokens.tETH.decimals, decimals1: d.tokens.tUSDG.decimals }
    : { token0IsEth: false, decimals0: d.tokens.tUSDG.decimals, decimals1: d.tokens.tETH.decimals };
}
```

Replace `shared/src/index.ts` with:

```ts
export * from "./abis";
export * from "./abisV2";
export * from "./config";
export * from "./live";
export * from "./price";
export * from "./report";
export * from "./units";
```

In `shared/package.json`, add to `"exports"` after the `"./config"` line:

```json
    "./live": "./src/live.ts",
    "./abis-v2": "./src/abisV2.ts",
    "./params-fables.json": "./params-fables.json",
    "./keeper-map-fables.json": "./keeper-map-fables.json",
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `bun install && cd shared && bun test && bun run typecheck`
Expected: `0 fail` with 14 new tests (6 in `live.test.ts`; 5 ABI checks and 3 selector checks in `abisV2.test.ts`, all running because plan 02 exported every ABI they read), and `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add shared/src/live.ts shared/src/abisV2.ts shared/src/index.ts shared/package.json shared/test/live.test.ts shared/test/abisV2.test.ts bun.lock
git commit -m "feat(shared): live testnet deployments parser and v2 ABI fragments" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 9: Bots, the testnet keys

**Files:**
- Create: `bots/src/live/lib/envfile.ts`, `bots/src/live/scripts/keys.ts`
- Modify: `bots/package.json`, `bots/.env.example`, `cre/.env.example`
- Test: `bots/test/live/envfile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `bots/test/live/envfile.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseEnvText, setMissing } from "../../src/live/lib/envfile";

describe("env files", () => {
  test("parse KEY=VALUE, skip comments and blanks, strip quotes", () => {
    const m = parseEnvText('# comment\n\nA=1\nB="two"\n  C = 3 \nbroken\n');
    expect([...m.entries()]).toEqual([
      ["A", "1"],
      ["B", "two"],
      ["C", "3"],
    ]);
  });
  test("setMissing appends new keys and keeps existing values", () => {
    const r = setMissing("# keys\nA=1\n", [
      ["A", "9"],
      ["B", "2"],
    ]);
    expect(r.text).toBe("# keys\nA=1\nB=2\n");
    expect(r.added).toEqual(["B"]);
  });
  test("setMissing fills an empty value in place (a copied .env.example)", () => {
    const r = setMissing("A=\nB=x\n", [["A", "1"]]);
    expect(r.text).toBe("A=1\nB=x\n");
    expect(r.added).toEqual(["A"]);
  });
  test("setMissing on an empty file", () => {
    expect(setMissing("", [["A", "1"]]).text).toBe("A=1\n");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd bots && bun test test/live/envfile.test.ts`
Expected: FAIL with `Cannot find module '../../src/live/lib/envfile'`.

- [ ] **Step 3: Implement**

Create `bots/src/live/lib/envfile.ts`:

```ts
// Minimal .env editing for keys.ts: read KEY=VALUE pairs and add missing keys without touching anything else.

/** KEY=VALUE lines (comments, blanks and malformed lines ignored; surrounding quotes stripped; the last one wins). */
export function parseEnvText(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^["']|["']$/g, ""));
  }
  return out;
}

/** Sets each key that is absent or empty (an empty line is filled in place); keeps every other line as is. */
export function setMissing(text: string, entries: ReadonlyArray<readonly [string, string]>): { text: string; added: string[] } {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const added: string[] = [];
  for (const [k, v] of entries) {
    const i = lines.findIndex((l) => l.trim().startsWith(`${k}=`));
    if (i >= 0) {
      const current = (lines[i] ?? "").trim().slice(k.length + 1).trim();
      if (current !== "") continue;
      lines[i] = `${k}=${v}`;
    } else {
      lines.push(`${k}=${v}`);
    }
    added.push(k);
  }
  return { text: lines.length > 0 ? `${lines.join("\n")}\n` : "", added };
}
```

Create `bots/src/live/scripts/keys.ts`:

```ts
// Creates the testnet keys plan 03 needs, once, and never prints a secret.
//   bots/.env: DEPLOYER_PRIVATE_KEY (copied from contracts/.env PRIVATE_KEY), RUNNER_, KEEPER_, ARB_RH_ and
//              NOISE_RH_PRIVATE_KEY (new);
//   cre/.env:  CRE_ETH_PRIVATE_KEY (new; 64 hex without 0x, the CRE CLI's format): the testnet desk's simOperator.
// Existing values are kept. Prints addresses only; --exports prints `export NAME=0x...` lines for deploy-live.sh.
// Usage (from bots/): bun run live:keys [--exports]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hasFlag } from "../../lib/env";
import { parseEnvText, setMissing } from "../lib/envfile";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const BOTS_ENV = join(ROOT, "bots", ".env");
const CRE_ENV = join(ROOT, "cre", ".env");
const CONTRACTS_ENV = join(ROOT, "contracts", ".env");
const read = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");
const hex = (k: string): Hex => (k.startsWith("0x") ? k : `0x${k}`) as Hex;
const addressOf = (k: string | undefined, name: string): Address => {
  if (!k) throw new Error(`${name} is not set`);
  return privateKeyToAccount(hex(k)).address;
};

const deployer = parseEnvText(read(CONTRACTS_ENV)).get("PRIVATE_KEY");
if (!deployer) throw new Error("contracts/.env has no PRIVATE_KEY");

const bots = setMissing(read(BOTS_ENV), [
  ["DEPLOYER_PRIVATE_KEY", hex(deployer)],
  ["RUNNER_PRIVATE_KEY", generatePrivateKey()],
  ["KEEPER_PRIVATE_KEY", generatePrivateKey()],
  ["ARB_RH_PRIVATE_KEY", generatePrivateKey()],
  ["NOISE_RH_PRIVATE_KEY", generatePrivateKey()],
]);
writeFileSync(BOTS_ENV, bots.text, { mode: 0o600 });
const cre = setMissing(read(CRE_ENV), [["CRE_ETH_PRIVATE_KEY", generatePrivateKey().slice(2)]]);
writeFileSync(CRE_ENV, cre.text, { mode: 0o600 });

const b = parseEnvText(bots.text);
const addresses: Record<string, Address> = {
  DEPLOYER_ADDRESS: addressOf(b.get("DEPLOYER_PRIVATE_KEY"), "DEPLOYER_PRIVATE_KEY"),
  SIM_OPERATOR: addressOf(parseEnvText(cre.text).get("CRE_ETH_PRIVATE_KEY"), "CRE_ETH_PRIVATE_KEY"),
  RUNNER_ADDRESS: addressOf(b.get("RUNNER_PRIVATE_KEY"), "RUNNER_PRIVATE_KEY"),
  KEEPER_ADDRESS: addressOf(b.get("KEEPER_PRIVATE_KEY"), "KEEPER_PRIVATE_KEY"),
  ARB_ADDRESS: addressOf(b.get("ARB_RH_PRIVATE_KEY"), "ARB_RH_PRIVATE_KEY"),
  NOISE_ADDRESS: addressOf(b.get("NOISE_RH_PRIVATE_KEY"), "NOISE_RH_PRIVATE_KEY"),
};
if (hasFlag("--exports")) {
  for (const [k, v] of Object.entries(addresses)) console.log(`export ${k}=${v}`);
} else {
  const added = [...bots.added.map((k) => `bots/.env ${k}`), ...cre.added.map((k) => `cre/.env ${k}`)];
  console.log(added.length > 0 ? `created: ${added.join(", ")}` : "no new key (all present)");
  for (const [k, v] of Object.entries(addresses)) console.log(`${k.padEnd(16)} ${v}`);
}
```

In `bots/package.json`, add to `"scripts"` after `"forge-report"`:

```json
    "live:keys": "bun src/live/scripts/keys.ts",
```

Append to `bots/.env.example`:

```bash

# --- clim × Fables live stack on Robinhood Chain testnet (plan 03). `bun run live:keys` fills these. ---
# Public RPC by default; set a keyed endpoint here only if the public one rate-limits.
RH_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
# DEPLOYER_PRIVATE_KEY above is copied from contracts/.env PRIVATE_KEY (TestToken owner, AccessManager admin).
RUNNER_PRIVATE_KEY=
KEEPER_PRIVATE_KEY=
ARB_RH_PRIVATE_KEY=
NOISE_RH_PRIVATE_KEY=
```

Replace the comment lines of `cre/.env.example` above `CRE_ETH_PRIVATE_KEY=` with:

```bash
# Copy to cre/.env (gitignored), or let `cd bots && bun run live:keys` create it. Testnet keys only.
# The key `cre workflow simulate --broadcast` sends reports from, through the MockKeystoneForwarder of the target
# chain. Its address must be RiskDeskV2's simOperator (plan 03: SIM_OPERATOR), otherwise every report is rejected.
# 64 hex characters, no 0x.
```

- [ ] **Step 4: Run the tests, then create the keys**

Run:

```bash
cd bots && bun test test/live/envfile.test.ts && bun run live:keys
```

Expected: `4 pass`, then `created: bots/.env DEPLOYER_PRIVATE_KEY, bots/.env RUNNER_PRIVATE_KEY, ..., cre/.env CRE_ETH_PRIVATE_KEY` and six address lines, `DEPLOYER_ADDRESS 0x53aB240f6cffC204FC22ac6722D9632d753a5A82` first. No private key is printed. Check `git status --short bots/.env cre/.env` prints nothing (both are gitignored).

- [ ] **Step 5: Commit**

```bash
git add bots/src/live/lib/envfile.ts bots/src/live/scripts/keys.ts bots/test/live/envfile.test.ts bots/package.json bots/.env.example cre/.env.example
git commit -m "feat(bots): testnet key setup for the live stack, addresses only on screen" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 10: Rehearsal on an anvil fork of Robinhood Chain testnet

Nothing is sent to any real chain in this task.

- [ ] **Step 1: Start the fork**

Run in the background (Bash `run_in_background`, or a second terminal), from the repository root:

```bash
mkdir -p .local && anvil --fork-url https://rpc.testnet.chain.robinhood.com --chain-id 31337 --port 8545 > .local/anvil-rh-fork.log 2>&1
```

Expected after a few seconds: `cast chain-id --rpc-url http://127.0.0.1:8545` prints `31337` and `cast codesize 0x8366a39CC670B4001A1121B8F6A443A643e40951 --rpc-url http://127.0.0.1:8545` prints `24009`.

- [ ] **Step 2: Deploy on the fork**

Run from `contracts/` in one shell command (exports do not survive between tool calls):

```bash
cd contracts && eval "$(cd ../bots && bun run --silent live:keys --exports)" \
  && export INIT_ETH_USD=$(curl -s https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD | jq -r '.price | tonumber | floor') \
  && cast rpc anvil_setBalance "$DEPLOYER_ADDRESS" 0x56BC75E2D63100000 --rpc-url http://127.0.0.1:8545 >/dev/null \
  && echo "INIT_ETH_USD=$INIT_ETH_USD" && script/v2/deploy-live.sh http://127.0.0.1:8545
```

Expected: `=== chain 31337: 10_LiveTokens` … `13_LiveDesk`, each forge run ending with `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.`, then `14_LiveWriteDeployments` with no `require` failure, then the JSON summary with `"chainId": 31337`, five addresses and three distinct pool ids. If `HookMiner: could not find salt` appears, rerun once (it mines from salt 0 and skips addresses with code); if it persists, stop and report.

- [ ] **Step 3: Check the file with the shared parser**

Run: `cd bots && bun -e 'import { parseLiveDeployments } from "@clim/shared"; const raw = await Bun.file("../shared/deployments/anvil.json").json(); const d = parseLiveDeployments(raw, [31337]); console.log(d.pools.D.key.tickSpacing, d.pools.K.key.tickSpacing, d.pools.F.key.tickSpacing, d.tokens.tUSDG.decimals, d.liquidity > 0n)'`
Expected: `10 11 12 6 true`.

- [ ] **Step 4: Smoke-test the stack**

Run: `contracts/script/v2/live-smoke.sh`
Expected, in this shape (cast adds scientific notation in brackets after large numbers, e.g. `85475 [8.547e4]`):

```text
report gasUsed <n>
desk state: <now> 85475 85475 1200 10000 0 1
policy quoteDirectional: <f01> <f10> 0
poke gasUsed <n>
keeper poke gasUsed <n>
D currentFee zeroForOne <f01> oneForZero <f10> | swap paid zeroForOne <f01> oneForZero <f10>
K currentFee zeroForOne 1480 oneForZero 1480 | swap paid zeroForOne 1480 oneForZero 1480
F currentFee zeroForOne 700 oneForZero 700 | swap paid zeroForOne 700 oneForZero 700
```

where `<f01> <f10>` are the policy's two fees: the base fee `ceil(85475 × etaE4 × 850890 × 10000 / 1e17)` on one side and the base plus `min(567, floor(2753 × 1200 / 10000) = 330)` on the toxic side. With `devPips = +1200` (venue above the pool, ETH buyers toxic) the premium is on `fee1For0` when tETH is token0 and on `fee0For1` otherwise. With etaE4 175,198 the base is 1,275 and the toxic side 1,605. Every "swap paid" equals the "currentFee" beside it. A rehearsal of this plan's scripts on 2026-10-13 (anvil's public test keys, tUSDG sorted first) printed `report gasUsed 94727`, `poke gasUsed 96839`, `keeper poke gasUsed 63147`, `policy quoteDirectional: 1605 1275 0` and `D currentFee zeroForOne 1605 oneForZero 1275 | swap paid zeroForOne 1605 oneForZero 1275`.

- [ ] **Step 5: Record the fork gas and stop the fork**

Sum the deployment gas from the broadcast receipts:

```bash
cd contracts && python3 -c "
import json
total = 0
for s in ('10_LiveTokens', '11_LiveAccessHook', '12_LivePools', '13_LiveDesk'):
    total += sum(int(r['gasUsed'], 16) for r in json.load(open(f'broadcast/{s}.s.sol/31337/run-latest.json'))['receipts'])
print(total)"
```

Expected: one number, the total deployment gas (about 15 to 25 million). Then stop anvil (`pkill -f "anvil --fork-url https://rpc.testnet.chain.robinhood.com"`) and append to the session log: `(contracts) Fork rehearsal (plan 03 Task 10): deploy-live.sh and live-smoke.sh pass on an anvil fork of Robinhood testnet; deployment <n> gas; report <n>, poke <n>, keeper poke <n> gas (L2 execution only: anvil does not add Arbitrum's L1 component); D fees <f01>/<f10>, K 1480, F 700, each swap paid the hook's current fee.`

- [ ] **Step 6: Commit the session log**

```bash
git add docs/sessions/
git commit -m "docs: plan 03 fork rehearsal of the live stack" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 11: Fund the deployer on Robinhood Chain testnet

This task sends one transaction on Ethereum Sepolia from the testnet deployer key. That is allowed: it is a testnet key on a testnet. Nothing here touches any mainnet.

**Budget** (gas price 0.01 gwei = 1e-8 ETH per million gas; v1's measured gas per transaction; Task 25 replaces these with testnet measurements):

| Flow | Rate | Gas per tx | ETH per day |
|---|---|---|---|
| Desk reports (CRE operator) | 2,880/day | about 180k | 0.0052 |
| `poke()` (runner) | 2,880/day | about 100k | 0.0029 |
| Keeper pokes on K | 480/day | about 60k | 0.0003 |
| Arbitrage (3 pools) | up to 3 per 2 s poll when out of band; budget 8,000/day | about 165k | 0.013 |
| Retail (`NOISE_ORDERS_PER_TICK` 0.2 every 10 s, mirrored to 3 pools) | 5,200/day | about 165k | 0.0086 |
| **Total** | | | **about 0.03 ETH/day** |
| Deployment (one time, Task 10 total × 2 margin) | | about 40M | 0.0004 |

0.5 ETH bridged runs the stack for about two weeks with margin; the Sepolia balance keeps about 0.36 ETH for v1's Sepolia loop until Task 26 stops it. If the base fee rises, the per-day cost scales with it (Task 25 measures it).

- [ ] **Step 1: Check balances and simulate the deposit (read only)**

Run (one command; `contracts/.env` is sourced without printing it):

```bash
cd contracts && set -a && source .env && set +a \
  && cast balance 0x53aB240f6cffC204FC22ac6722D9632d753a5A82 --ether --rpc-url "$SEPOLIA_RPC_URL" \
  && cast balance 0x53aB240f6cffC204FC22ac6722D9632d753a5A82 --ether --rpc-url https://rpc.testnet.chain.robinhood.com \
  && cast call 0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4 "bridge()(address)" --rpc-url "$SEPOLIA_RPC_URL" \
  && cast call 0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4 "depositEth()(uint256)" --value 0.5ether --from 0x53aB240f6cffC204FC22ac6722D9632d753a5A82 --rpc-url "$SEPOLIA_RPC_URL"
```

Expected: about `0.86`, `0.000000000000000000`, `0x96295BDad104eaD97cC08797b3dC68efF59CcF30`, and a message number (a plain integer). If the bridge address differs or the call reverts, stop: the route changed; check https://docs.robinhood.com/chain/contracts and the bridge UI before sending anything.

- [ ] **Step 2: Bridge 0.5 ETH**

Run:

```bash
cd contracts && set -a && source .env && set +a \
  && cast send 0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4 "depositEth()" --value 0.5ether --private-key "$PRIVATE_KEY" --rpc-url "$SEPOLIA_RPC_URL" --json | jq '{status, transactionHash, gasUsed}'
```

Expected: `"status": "0x1"` and a transaction hash. v1's Sepolia CRE loop sends from this same key every 30 s: if this fails with `nonce too low` or `replacement transaction underpriced`, run the same command again.

- [ ] **Step 3: Wait for the deposit on L2**

Poll every minute (deposits take about 10 minutes):

```bash
cast balance 0x53aB240f6cffC204FC22ac6722D9632d753a5A82 --ether --rpc-url https://rpc.testnet.chain.robinhood.com
```

Expected: `0.500000000000000000` within about 15 minutes. If it is still 0 after 30 minutes, open the deposit in the bridge UI (https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain-testnet&sourceChain=sepolia, "Transactions" tab, the deployer address) to see its status; a retryable that failed on L2 can be redeemed there.

- [ ] **Step 4: Optional faucet top-up (the maintainer)**

Ask the maintainer whether to add faucet ETH: he opens https://faucet.testnet.chain.robinhood.com in his browser and requests testnet ETH for `0x53aB240f6cffC204FC22ac6722D9632d753a5A82`. Skip if he declines; 0.5 ETH covers the budget above.

- [ ] **Step 5: Record and commit**

Append to the session log: `(ops) Funding (plan 03 Task 11): 0.5 Sepolia ETH bridged to Robinhood testnet through the Delayed Inbox 0xF293...B7a4 (depositEth, tx <hash>), credited after <n> min; deployer testnet balance 0.5 ETH; Sepolia balance left <x> ETH.` Then:

```bash
git add docs/sessions/
git commit -m "docs: plan 03 testnet funding through the Robinhood Chain bridge" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 12: Deploy on Robinhood Chain testnet and verify every contract

This task broadcasts to Robinhood Chain testnet (chain 46630) with the testnet deployer key.

- [ ] **Step 1: Deploy**

Run (one command, from the repository root):

```bash
cd contracts && eval "$(cd ../bots && bun run --silent live:keys --exports)" \
  && export INIT_ETH_USD=$(curl -s https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD | jq -r '.price | tonumber | floor') \
  && echo "INIT_ETH_USD=$INIT_ETH_USD" && script/v2/deploy-live.sh https://rpc.testnet.chain.robinhood.com
```

Expected: as in Task 10 Step 2 with `chain 46630`, ending with the summary of `shared/deployments/robinhood-testnet.json`. If a step fails midway (an RPC hiccup), rerun with `FROM=<that step number>` prepended to `script/v2/deploy-live.sh`.

- [ ] **Step 2: Check the file**

Run: `cd bots && bun -e 'import { parseLiveDeployments } from "@clim/shared"; const d = parseLiveDeployments(await Bun.file("../shared/deployments/robinhood-testnet.json").json()); console.log(d.chainId, d.hook, d.riskDesk, d.poker, d.pools.D.poolId)'`
Expected: `46630` and four non-zero values.

- [ ] **Step 3: Write the verification script**

Create `contracts/script/v2/verify-live.sh` and make it executable:

```bash
#!/usr/bin/env bash
# Verifies every contract of shared/deployments/robinhood-testnet.json on Sourcify and on the Robinhood Chain testnet
# Blockscout (https://explorer.testnet.chain.robinhood.com), with the constructor arguments recorded at deployment.
# Usage: contracts/script/v2/verify-live.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DEP=../shared/deployments/robinhood-testnet.json
BLOCKSCOUT=https://explorer.testnet.chain.robinhood.com/api/
FAILED=0
while read -r NAME ADDR ID ARGS; do
  echo "=== ${NAME} ${ADDR} (${ID##*:})"
  forge verify-contract "$ADDR" "$ID" --chain 46630 --constructor-args "$ARGS" --verifier sourcify --watch \
    || { echo "sourcify: ${NAME} FAILED"; FAILED=1; }
  forge verify-contract "$ADDR" "$ID" --chain 46630 --constructor-args "$ARGS" \
    --verifier blockscout --verifier-url "$BLOCKSCOUT" --watch \
    || { echo "blockscout: ${NAME} FAILED"; FAILED=1; }
done < <(jq -r '.verify | to_entries[] | "\(.key) \(.value.address) \(.value.contract) \(.value.args)"' "$DEP")
exit "$FAILED"
```

- [ ] **Step 4: Verify**

Run: `contracts/script/v2/verify-live.sh`
Expected: ten `===` blocks, each with Sourcify answering a match (`Contract successfully verified` or `already verified`; with `bytecode_hash = "none"` Sourcify reports `match`, not `exact_match`) and Blockscout `Contract successfully verified` (or `already verified`); exit code 0. If one fails, run its two `forge verify-contract` lines by hand with `-vvv` and fix the cause (wrong constructor args: compare with `jq .verify.<name> ../shared/deployments/robinhood-testnet.json`).

- [ ] **Step 5: Check the verification from outside**

Run:

```bash
for a in $(jq -r '.verify[].address' shared/deployments/robinhood-testnet.json); do
  s=$(curl -s "https://sourcify.dev/server/v2/contract/46630/$a" | jq -r '.match // .runtimeMatch // "none"')
  b=$(curl -s "https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/$a" | jq -r '.is_verified // false')
  echo "$a sourcify=$s blockscout=$b"
done
```

Expected: ten lines with `sourcify=match` (or `exact_match`) and `blockscout=true`.

- [ ] **Step 6: Record and commit**

Append to the session log the addresses (hook, desk, policy, poker, tokens, routers, AccessManager), the three pool ids, `INIT_ETH_USD`, and "all ten verified on Sourcify and Blockscout". Then:

```bash
git add shared/deployments/robinhood-testnet.json contracts/deployments/46630 contracts/broadcast contracts/script/v2/verify-live.sh docs/sessions/
git commit -m "feat: clim live reference stack deployed on Robinhood Chain testnet, verified on Sourcify and Blockscout" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

## Part C: the CRE desk v2

`cre/risk-desk` changes in place: its Sepolia v1 is frozen at tag `token2049-submission` and is what still runs in the hackathon checkout until Task 26. The v1 targets (`staging-settings`, `replay-settings`, `production-settings`), the replay mode and DVOL go; the v2 targets are `rh-testnet-settings`, `rh-shadow-settings` and `rh-production-settings`. Install once: `cd cre/risk-desk && bun install`.

Tasks 13 to 15 replace the modules under `workflow.ts` one by one, so until Task 16 replaces `workflow.ts` itself, `workflow.test.ts` and `bun run typecheck` fail in `cre/risk-desk`: each step of Tasks 13 to 15 runs only its own test files, and Task 16 Step 6 runs everything.

### Task 13: CRE venues v2 (1-minute OHLC, live tickers, Binance 1 s)

**Files:**
- Modify: `cre/risk-desk/venues.ts` (whole file)
- Test: `cre/risk-desk/venues.test.ts` (whole file)

The parsers now return each candle's `high` and `low` too. Step 3 adds the optional `high`/`low` fields and the `VenueTicker` type to `estimator.ts` first, so this task's tests run on their own; Task 14 then replaces `estimator.ts` whole.

- [ ] **Step 1: Replace the tests**

Replace `cre/risk-desk/venues.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test'
import binance from './fixtures/binance.json'
import coinbase from './fixtures/coinbase.json'
import hyperliquid from './fixtures/hyperliquid.json'
import kraken from './fixtures/kraken.json'
import {
	BINANCE_1S_REQUEST,
	parseBinance,
	parseBinanceTicker,
	parseCoinbase,
	parseCoinbaseTicker,
	parseHyperliquid,
	parseHyperliquidMids,
	parseKraken,
	parseKrakenTicker,
	parseVenue,
	tickerRequest,
	VENUE_QUOTE,
	VENUES,
	venueRequest,
} from './venues'

// Real candle responses captured by scripts/capture-fixtures.sh at this instant (fixtures/now.txt).
const NOW = 1_791_282_309
// Trimmed real ticker responses (same shapes as bots/test/market.test.ts).
const COINBASE_TICKER = { product_id: 'ETH-USD', price: '2713.33' }
const KRAKEN_TICKER = {
	error: [],
	result: {
		XETHZUSD: { a: ['2713.25000', '2', '2.000'], b: ['2713.24000', '4', '4.000'], c: ['2713.25000', '0.00412332'] },
		USDTZUSD: { a: ['0.99971000', '83080', '83080.000'], b: ['0.99970000', '745859', '745859.000'], c: ['0.99970000', '49.901'] },
	},
}
const BINANCE_TICKER = { symbol: 'ETHUSDT', price: '2713.86000000' }
const HL_MIDS = { BTC: '86027.5', ETH: '2712.75', SOL: '120.015' }

describe('requests', () => {
	test('1-minute candle URLs and the Hyperliquid POST body', () => {
		expect(venueRequest('coinbase', NOW).url).toBe(
			'https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD/candles?granularity=ONE_MINUTE&limit=20',
		)
		expect(venueRequest('kraken', NOW).url).toBe(`https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=${NOW - 1200}`)
		expect(venueRequest('binance', NOW).url).toBe('https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20')
		const hl = venueRequest('hyperliquid', NOW)
		expect(hl.method).toBe('POST')
		expect(JSON.parse(hl.body ?? '')).toEqual({
			type: 'candleSnapshot',
			req: { coin: 'ETH', interval: '1m', startTime: (NOW - 1200) * 1000, endTime: NOW * 1000 },
		})
	})
	test('tickers (Kraken also carries USDT/USD) and Binance 1 s klines', () => {
		expect(tickerRequest('coinbase').url).toBe('https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD')
		expect(tickerRequest('kraken').url).toBe('https://api.kraken.com/0/public/Ticker?pair=ETHUSD,USDTUSD')
		expect(tickerRequest('binance').url).toBe('https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT')
		expect(JSON.parse(tickerRequest('hyperliquid').body ?? '')).toEqual({ type: 'allMids' })
		expect(BINANCE_1S_REQUEST.url).toBe('https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=1000')
	})
})

describe('candle parsers on captured fixtures (close, high, low)', () => {
	test('coinbase: newest-first strings, sorted ascending', () => {
		const c = parseCoinbase(coinbase)
		expect(c).toHaveLength(19)
		expect(c[0]).toEqual({ t: 1_791_281_160, close: 2708.41, high: 2709.79, low: 2708.41 })
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_240, close: 2713.76, high: 2715.08, low: 2713.75 })
	})
	test('kraken: rows under XETHZUSD, last row still open', () => {
		const c = parseKraken(kraken)
		expect(c).toHaveLength(20)
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_300, close: 2714.65, high: 2714.83, low: 2713.87 })
	})
	test('binance: open time in ms, prices in USDT', () => {
		const c = parseBinance(binance)
		expect(c).toHaveLength(20)
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_300, close: 2715.18, high: 2715.33, low: 2714.58 })
	})
	test('hyperliquid: t in ms, prices as strings', () => {
		const c = parseHyperliquid(hyperliquid)
		expect(c).toHaveLength(21)
		expect(c[0]).toEqual({ t: 1_791_281_100, close: 2708.3, high: 2708.3, low: 2708 })
	})
	test('parseVenue dispatches, and every venue has a quote currency', () => {
		for (const v of VENUES) expect(VENUE_QUOTE[v]).toMatch(/^USDT?$/)
		expect(parseVenue('binance', binance)).toEqual(parseBinance(binance))
	})
	test('malformed responses throw', () => {
		expect(() => parseKraken({ error: ['EQuery:Unknown asset pair'], result: {} })).toThrow('kraken: EQuery:Unknown asset pair')
		expect(() => parseCoinbase({ message: 'rate limited' })).toThrow('coinbase.candles: not an array')
	})
})

describe('ticker parsers', () => {
	test('each venue', () => {
		expect(parseCoinbaseTicker(COINBASE_TICKER)).toBe(2713.33)
		expect(parseKrakenTicker(KRAKEN_TICKER)).toEqual({ ethUsd: 2713.25, usdtUsd: 0.9997 })
		expect(parseBinanceTicker(BINANCE_TICKER)).toBe(2713.86)
		expect(parseHyperliquidMids(HL_MIDS)).toBe(2712.75)
	})
	test('reject malformed or error payloads', () => {
		expect(() => parseCoinbaseTicker({ price: 'abc' })).toThrow('coinbase.price')
		expect(() => parseKrakenTicker({ error: ['EGeneral:Too many requests'], result: {} })).toThrow('kraken: EGeneral:Too many requests')
		expect(() => parseHyperliquidMids({ BTC: '1' })).toThrow('hyperliquid.ETH')
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd cre/risk-desk && bun test venues.test.ts`
Expected: FAIL with `Export named 'BINANCE_1S_REQUEST' not found in module` (or `tickerRequest`).

- [ ] **Step 3: Add the new estimator types first**

In `cre/risk-desk/estimator.ts`, replace the `Candle` interface with the following and add `VenueTicker` right after `VenueSeries` (Task 14 replaces the whole file and keeps both):

```ts
export interface Candle {
	t: number // candle open time, unix seconds
	close: number // close price in the venue's quote currency
	high?: number // high of the candle, same currency (venue-range estimator)
	low?: number // low of the candle, same currency
}
```

```ts
export interface VenueTicker {
	venue: string
	quote: Quote
	price: number // last trade or mid in the venue's quote currency
}
```

- [ ] **Step 4: Replace `venues.ts`**

Replace `cre/risk-desk/venues.ts` with:

```ts
// Venue requests, response parsers and the node-mode fetch. Parsers are pure and tested on fixtures captured from
// the real endpoints (fixtures/) and on trimmed real responses (venues.test.ts).
import { HTTPClient, type NodeRuntime, ok, text } from '@chainlink/cre-sdk'
import type { Candle, Quote, VenueSeries, VenueTicker } from './estimator'

export const VENUES = ['coinbase', 'kraken', 'binance', 'hyperliquid'] as const
export type VenueName = (typeof VENUES)[number]

export const VENUE_QUOTE: Record<VenueName, Quote> = {
	coinbase: 'USD',
	kraken: 'USD',
	binance: 'USDT',
	hyperliquid: 'USD', // USDC-margined perp, treated as USD
}

const LOOKBACK_SEC = 1200 // 20 minutes: the 16 closes of the 15-minute window plus the staleness margin

export interface HttpReq {
	url: string
	method: 'GET' | 'POST'
	body?: string // raw JSON text; base64-encoded at send time
}

export function venueRequest(venue: VenueName, nowSec: number): HttpReq {
	switch (venue) {
		case 'coinbase':
			return {
				url: 'https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD/candles?granularity=ONE_MINUTE&limit=20',
				method: 'GET',
			}
		case 'kraken':
			return { url: `https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=${nowSec - LOOKBACK_SEC}`, method: 'GET' }
		case 'binance':
			return { url: 'https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20', method: 'GET' }
		case 'hyperliquid':
			return {
				url: 'https://api.hyperliquid.xyz/info',
				method: 'POST',
				body: JSON.stringify({
					type: 'candleSnapshot',
					req: { coin: 'ETH', interval: '1m', startTime: (nowSec - LOOKBACK_SEC) * 1000, endTime: nowSec * 1000 },
				}),
			}
	}
}

/** Real-time price per venue, for the venue mid that devPips compares with the pool (the lab used 1 s prices). */
export function tickerRequest(venue: VenueName): HttpReq {
	switch (venue) {
		case 'coinbase':
			return { url: 'https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD', method: 'GET' }
		case 'kraken':
			return { url: 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD,USDTUSD', method: 'GET' }
		case 'binance':
			return { url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT', method: 'GET' }
		case 'hyperliquid':
			return { url: 'https://api.hyperliquid.xyz/info', method: 'POST', body: JSON.stringify({ type: 'allMids' }) }
	}
}

/** 1 s klines, only for the binance-1s estimator: 1,000 seconds cover the 900 s window and its first price. */
export const BINANCE_1S_REQUEST: HttpReq = {
	url: 'https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=1000',
	method: 'GET',
}

// ---------- parsing helpers ----------

function num(x: unknown, what: string): number {
	const n = typeof x === 'string' ? Number(x) : x
	if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${what}: not a number: ${String(x)}`)
	return n
}

function positive(x: unknown, what: string): number {
	const n = num(x, what)
	if (!(n > 0)) throw new Error(`${what}: not positive: ${String(x)}`)
	return n
}

function obj(x: unknown, what: string): Record<string, unknown> {
	if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new Error(`${what}: not an object`)
	return x as Record<string, unknown>
}

function arr(x: unknown, what: string): unknown[] {
	if (!Array.isArray(x)) throw new Error(`${what}: not an array`)
	return x
}

const ascending = (cs: Candle[]): Candle[] => cs.sort((a, b) => a.t - b.t)

// ---------- candle parsers (ascending by open time, seconds; close, high and low) ----------

// {"candles":[{"start":"1791282180","low":"..","high":"..","open":"..","close":"2713.98",...}, ...]} newest first
export function parseCoinbase(json: unknown): Candle[] {
	const rows = arr(obj(json, 'coinbase').candles, 'coinbase.candles')
	return ascending(
		rows.map((r) => {
			const o = obj(r, 'coinbase.candle')
			return {
				t: num(o.start, 'coinbase.start'),
				close: num(o.close, 'coinbase.close'),
				high: num(o.high, 'coinbase.high'),
				low: num(o.low, 'coinbase.low'),
			}
		}),
	)
}

// {"error":[],"result":{"XETHZUSD":[[time,open,high,low,close,vwap,volume,count],...],"last":N}}
export function parseKraken(json: unknown): Candle[] {
	const o = obj(json, 'kraken')
	const errors = arr(o.error ?? [], 'kraken.error')
	if (errors.length > 0) throw new Error(`kraken: ${errors.join(',')}`)
	const result = obj(o.result, 'kraken.result')
	const key = Object.keys(result).find((k) => k !== 'last')
	if (key === undefined) throw new Error('kraken: no pair in result')
	return ascending(
		arr(result[key], 'kraken.rows').map((r) => {
			const row = arr(r, 'kraken.row')
			return {
				t: num(row[0], 'kraken.time'),
				close: num(row[4], 'kraken.close'),
				high: num(row[2], 'kraken.high'),
				low: num(row[3], 'kraken.low'),
			}
		}),
	)
}

// [[openTimeMs,"open","high","low","close","volume",closeTimeMs,...], ...] (1m and 1s klines)
export function parseBinance(json: unknown): Candle[] {
	return ascending(
		arr(json, 'binance').map((r) => {
			const row = arr(r, 'binance.row')
			return {
				t: num(row[0], 'binance.openTime') / 1000,
				close: num(row[4], 'binance.close'),
				high: num(row[2], 'binance.high'),
				low: num(row[3], 'binance.low'),
			}
		}),
	)
}

// [{"t":openMs,"T":closeMs,"s":"ETH","i":"1m","o":"..","c":"..","h":"..","l":"..",...}, ...]
export function parseHyperliquid(json: unknown): Candle[] {
	return ascending(
		arr(json, 'hyperliquid').map((r) => {
			const o = obj(r, 'hyperliquid.candle')
			return {
				t: num(o.t, 'hyperliquid.t') / 1000,
				close: num(o.c, 'hyperliquid.c'),
				high: num(o.h, 'hyperliquid.h'),
				low: num(o.l, 'hyperliquid.l'),
			}
		}),
	)
}

export function parseVenue(venue: VenueName, json: unknown): Candle[] {
	switch (venue) {
		case 'coinbase':
			return parseCoinbase(json)
		case 'kraken':
			return parseKraken(json)
		case 'binance':
			return parseBinance(json)
		case 'hyperliquid':
			return parseHyperliquid(json)
	}
}

// ---------- ticker parsers ----------

// {"product_id":"ETH-USD","price":"2713.33",...}
export function parseCoinbaseTicker(json: unknown): number {
	return positive(obj(json, 'coinbase').price, 'coinbase.price')
}

// {"error":[],"result":{"XETHZUSD":{"c":["2713.25","0.004"],...},"USDTZUSD":{"c":["0.9997","49.9"],...}}}
export function parseKrakenTicker(json: unknown): { ethUsd: number; usdtUsd: number } {
	const o = obj(json, 'kraken')
	const errors = arr(o.error ?? [], 'kraken.error')
	if (errors.length > 0) throw new Error(`kraken: ${errors.join(',')}`)
	const result = obj(o.result, 'kraken.result')
	const last = (pair: string): number => positive(arr(obj(result[pair], `kraken.${pair}`).c, `kraken.${pair}.c`)[0], `kraken.${pair}`)
	return { ethUsd: last('XETHZUSD'), usdtUsd: last('USDTZUSD') }
}

// {"symbol":"ETHUSDT","price":"2713.86000000"}
export function parseBinanceTicker(json: unknown): number {
	return positive(obj(json, 'binance').price, 'binance.price')
}

// POST /info {"type":"allMids"} -> {"ETH":"2712.75",...} (perp mid, USDC treated as USD)
export function parseHyperliquidMids(json: unknown): number {
	return positive(obj(json, 'hyperliquid').ETH, 'hyperliquid.ETH')
}

// ---------- node-mode fetch ----------

export type Fetched = { json: unknown } | { error: string }

export interface DeskInput {
	nowSec: number
	usdtUsd: number | null // Kraken's USDT/USD; null: USDT-quoted prices cannot be converted and are dropped
	series: VenueSeries[] // 1-minute candles per venue (a failed venue keeps an empty list, so the quorum counts it)
	tickers: VenueTicker[] // real-time prices of the venues that answered
	binance1s: Candle[] | null // only for the binance-1s estimator
	notes: string[] // per-source fetch/parse problems, for logs
}

// Sends every request first, then waits for each response, so the calls run concurrently.
export function sendAll(nodeRuntime: NodeRuntime<unknown>, reqs: HttpReq[]): Fetched[] {
	const http = new HTTPClient()
	const pending = reqs.map((r) =>
		http.sendRequest(nodeRuntime, {
			url: r.url,
			method: r.method,
			headers: r.body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: r.body === undefined ? '' : Buffer.from(r.body).toString('base64'),
			timeout: '8s', // below the 10 s connection quota; a hung venue must not stall the tick
		}),
	)
	return pending.map((p): Fetched => {
		try {
			const resp = p.result()
			if (!ok(resp)) return { error: `HTTP ${resp.statusCode}` }
			return { json: JSON.parse(text(resp)) }
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) }
		}
	})
}

export function settle<T>(f: Fetched | undefined, parse: (json: unknown) => T): { value: T } | { error: string } {
	if (f === undefined) return { error: 'no response' }
	if ('error' in f) return { error: f.error }
	try {
		return { value: parse(f.json) }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}

function parseTicker(venue: Exclude<VenueName, 'kraken'>, json: unknown): number {
	switch (venue) {
		case 'coinbase':
			return parseCoinbaseTicker(json)
		case 'binance':
			return parseBinanceTicker(json)
		case 'hyperliquid':
			return parseHyperliquidMids(json)
	}
}

/**
 * One concurrent batch: each venue's 1-minute candles and ticker, Kraken's ticker for USDT/USD if Kraken is not a
 * venue, Binance 1 s klines when asked, then `extra` requests (the pool read in shadow mode), returned as is.
 * At most 4 + 4 + 1 + 1 = 10 HTTP calls, under the 15 per execution quota.
 */
export function fetchLive(
	nodeRuntime: NodeRuntime<unknown>,
	venues: VenueName[],
	nowSec: number,
	withBinance1s: boolean,
	extra: HttpReq[] = [],
): { input: DeskInput; extra: Fetched[] } {
	const needKrakenTicker = !venues.includes('kraken')
	const reqs: HttpReq[] = [
		...venues.map((v) => venueRequest(v, nowSec)),
		...venues.map((v) => tickerRequest(v)),
		...(needKrakenTicker ? [tickerRequest('kraken')] : []),
		...(withBinance1s ? [BINANCE_1S_REQUEST] : []),
		...extra,
	]
	const res = sendAll(nodeRuntime, reqs)
	let i = 0
	const notes: string[] = []
	const series: VenueSeries[] = venues.map((v) => {
		const r = settle(res[i++], (j) => parseVenue(v, j))
		if ('error' in r) notes.push(`${v}: ${r.error}`)
		return { venue: v, quote: VENUE_QUOTE[v], candles: 'error' in r ? [] : r.value }
	})
	const tickers: VenueTicker[] = []
	let usdtUsd: number | null = null
	const takeKraken = (f: Fetched | undefined, asVenue: boolean): void => {
		const r = settle(f, parseKrakenTicker)
		if ('error' in r) {
			notes.push(`kraken ticker: ${r.error}`)
			return
		}
		usdtUsd = r.value.usdtUsd
		if (asVenue) tickers.push({ venue: 'kraken', quote: 'USD', price: r.value.ethUsd })
	}
	for (const v of venues) {
		const f = res[i++]
		if (v === 'kraken') {
			takeKraken(f, true)
			continue
		}
		const r = settle(f, (j) => parseTicker(v, j))
		if ('error' in r) notes.push(`${v} ticker: ${r.error}`)
		else tickers.push({ venue: v, quote: VENUE_QUOTE[v], price: r.value })
	}
	if (needKrakenTicker) takeKraken(res[i++], false)
	let binance1s: Candle[] | null = null
	if (withBinance1s) {
		const r = settle(res[i++], parseBinance)
		if ('error' in r) notes.push(`binance 1s: ${r.error}`)
		else binance1s = r.value
	}
	return { input: { nowSec, usdtUsd, series, tickers, binance1s, notes }, extra: res.slice(i) }
}
```

- [ ] **Step 5: Run the venue tests**

Run: `cd cre/risk-desk && bun test venues.test.ts`
Expected: `10 pass, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add cre/risk-desk/venues.ts cre/risk-desk/venues.test.ts cre/risk-desk/estimator.ts
git commit -m "feat(cre): desk v2 venues, 1-minute high and low, live tickers, Binance 1 s klines" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 14: CRE estimator v2 (two windows, three estimators, venue mid)

**Files:**
- Modify: `cre/risk-desk/estimator.ts` (whole file)
- Test: `cre/risk-desk/estimator.test.ts` (whole file)

- [ ] **Step 1: Replace the tests**

Replace `cre/risk-desk/estimator.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test'
import {
	annualPctFromE9,
	type Candle,
	closedCandles,
	commonEnd,
	DESK,
	dispersionBp,
	estimate,
	type EstimatorInput,
	isFresh,
	median,
	parkinsonPerSqrtSec,
	perMinuteMedians,
	QuorumError,
	realizedVolPerSqrtSec,
	sigmaBinance1s,
	sigmaVenueRange,
	toUsd,
	type VenueSeries,
	type VenueTicker,
} from './estimator'

// Synthetic market: 20 one-minute candles, every log return exactly +0.001, high/low at +-0.001 in log.
const T0 = 1_799_998_800 // multiple of 60
const NOW = T0 + 20 * 60 + 10 // 10 s after the 20th candle closed
const p = (i: number): number => 2000 * Math.exp(0.001 * i)
const candles = (f: (i: number) => number, n = 20, h = 0.001): Candle[] =>
	Array.from({ length: n }, (_, i) => ({ t: T0 + 60 * i, close: f(i), high: f(i) * Math.exp(h), low: f(i) * Math.exp(-h) }))

const venueA: VenueSeries = { venue: 'a', quote: 'USD', candles: candles(p) }
const venueB: VenueSeries = { venue: 'b', quote: 'USD', candles: candles((i) => p(i) * 1.0002) }
const venueC: VenueSeries = { venue: 'c', quote: 'USDT', candles: candles((i) => 2 * p(i) * 0.9999) } // usdtUsd 0.5
const venueStale: VenueSeries = { venue: 'd', quote: 'USD', candles: candles(p, 17) } // last close 190 s ago
const TICKERS: VenueTicker[] = [
	{ venue: 'a', quote: 'USD', price: 2050 },
	{ venue: 'b', quote: 'USD', price: 2051 },
	{ venue: 'c', quote: 'USDT', price: 4100 }, // 2050 USD at usdtUsd 0.5
]

// Binance 1 s klines ending one second before NOW; the price steps by exp(0.001) every 5 s back from the last second.
const ones = (n = 1000, end = NOW - 1): Candle[] =>
	Array.from({ length: n }, (_, i) => {
		const t = end - (n - 1) + i
		return { t, close: 2000 * Math.exp(0.001 * Math.floor((t - end) / 5)) }
	})

const input = (over: Partial<EstimatorInput> = {}): EstimatorInput => ({
	nowSec: NOW,
	usdtUsd: 0.5,
	series: [venueA, venueB, venueC, venueStale],
	tickers: TICKERS,
	binance1s: null,
	estimator: 'median-close',
	...over,
})

describe('median', () => {
	test('odd, even, empty', () => {
		expect(median([3, 1, 2])).toBe(2)
		expect(median([4, 1, 3, 2])).toBe(2.5)
		expect(() => median([])).toThrow('median of an empty list')
	})
})

describe('closedCandles, toUsd, isFresh, commonEnd', () => {
	test('keeps candles whose minute has ended (t + 60 <= now), sorted ascending', () => {
		const cs = [
			{ t: 940, close: 2 },
			{ t: 880, close: 1 },
			{ t: 941, close: 3 },
		]
		expect(closedCandles(cs, 1000)).toEqual([
			{ t: 880, close: 1 },
			{ t: 940, close: 2 },
		])
	})
	test('USD passes through, USDT is multiplied (high and low too), USDT without rate is dropped', () => {
		expect(toUsd(venueA, null)).toBe(venueA)
		expect(toUsd({ venue: 'x', quote: 'USDT', candles: [{ t: 0, close: 10 }] }, 0.5)?.candles).toEqual([{ t: 0, close: 5 }])
		expect(toUsd({ venue: 'x', quote: 'USDT', candles: [{ t: 0, close: 10, high: 12, low: 8 }] }, 0.5)?.candles).toEqual([
			{ t: 0, close: 5, high: 6, low: 4 },
		])
		expect(toUsd(venueC, null)).toBeNull()
	})
	test(`isFresh: last close at most ${DESK.MAX_AGE_SEC} s old`, () => {
		expect(isFresh([{ t: 820, close: 1 }], 1000)).toBe(true)
		expect(isFresh([{ t: 819, close: 1 }], 1000)).toBe(false)
		expect(isFresh([], 1000)).toBe(false)
	})
	test('commonEnd: latest minute closed by at least `quorum` venues', () => {
		const late: VenueSeries = { venue: 'b', quote: 'USD', candles: candles(p, 19) }
		expect(commonEnd([venueA, late, venueC], 3)).toBe(T0 + 60 * 18)
		expect(commonEnd([venueA, late, venueC], 2)).toBe(T0 + 60 * 19)
		expect(commonEnd([venueA], 3)).toBeNull()
	})
})

describe('median-close', () => {
	test('one median per minute over the window, oldest first', () => {
		const out = perMinuteMedians([venueA, venueB], T0 + 60 * 19, 2)
		expect(out).toHaveLength(3)
		expect(out[2]).toBeCloseTo(p(19) * 1.0001, 9)
		expect(() => perMinuteMedians([venueA], T0 + 60 * 25, 15)).toThrow(QuorumError)
	})
	test('5 and 15 returns of exactly 0.001', () => {
		expect(realizedVolPerSqrtSec(Array.from({ length: 6 }, (_, i) => p(i)))).toBeCloseTo(Math.sqrt(5e-6 / 300), 15)
		expect(realizedVolPerSqrtSec(Array.from({ length: 16 }, (_, i) => p(i)))).toBeCloseTo(1.2909944487358055e-4, 15)
		expect(annualPctFromE9(85_475)).toBeCloseTo(48.0, 2)
	})
})

describe('venue-range (Parkinson on 1-minute high and low)', () => {
	test('ln(H/L) = 0.002 on every candle', () => {
		expect(parkinsonPerSqrtSec(candles(p, 5))).toBeCloseTo(Math.sqrt(0.002 ** 2 / (4 * Math.log(2)) / 60), 15)
		expect(() => parkinsonPerSqrtSec([{ t: 0, close: 1 }])).toThrow('no valid high/low')
	})
	test('median across venues; a venue missing a candle of the window is left out', () => {
		const wide = (h: number, venue: string): VenueSeries => ({ venue, quote: 'USD', candles: candles(p, 20, h) })
		const tEnd = T0 + 60 * 19
		expect(sigmaVenueRange([wide(0.001, 'a'), wide(0.002, 'b'), wide(0.003, 'c')], tEnd, 300)).toBeCloseTo(
			Math.sqrt(0.004 ** 2 / (4 * Math.log(2)) / 60),
			15,
		)
		const holed: VenueSeries = { venue: 'h', quote: 'USD', candles: candles(p).filter((c) => c.t !== T0 + 60 * 17) }
		expect(() => sigmaVenueRange([wide(0.001, 'a'), wide(0.002, 'b'), holed], tEnd, 300)).toThrow(QuorumError)
	})
})

describe('binance-1s (5 s returns, as the lab)', () => {
	test('returns of exactly 0.001 every 5 s', () => {
		expect(sigmaBinance1s(ones(), NOW, 300)).toBeCloseTo(Math.sqrt(0.001 ** 2 / 5), 15)
		expect(sigmaBinance1s(ones(), NOW, 900)).toBeCloseTo(Math.sqrt(0.001 ** 2 / 5), 15)
	})
	test('a missing second keeps the previous close', () => {
		// the sample at last - 10 s takes the close of last - 11 s (one step lower): one return of 0, one of 0.002
		const gap = ones().filter((c) => c.t !== NOW - 1 - 10)
		expect(sigmaBinance1s(gap, NOW, 300)).toBeCloseTo(Math.sqrt((58 * 0.001 ** 2 + 0.002 ** 2) / 300), 15)
	})
	test('stale or short data is an error, not a guess', () => {
		expect(() => sigmaBinance1s(ones(1000, NOW - 30), NOW, 300)).toThrow('binance-1s: last second closed')
		expect(() => sigmaBinance1s(ones(200), NOW, 300)).toThrow('binance-1s: not enough history')
	})
})

describe('estimate', () => {
	test('median-close: 3 fresh venues out of 4, both windows, dispersion, mid from tickers', () => {
		const est = estimate(input())
		expect(est.sources).toEqual(['a', 'b', 'c'])
		expect(est.nSources).toBe(3)
		expect(est.tEnd).toBe(T0 + 60 * 19)
		expect(est.sigma5E9).toBe(129_099)
		expect(est.sigma15E9).toBe(129_099)
		expect(est.dispBp).toBe(2)
		expect(est.venueMidE6).toBe(2_050_000_000)
		expect(est.midFrom).toBe('tickers')
	})
	test('venue-range and binance-1s', () => {
		const r = estimate(input({ estimator: 'venue-range' }))
		expect(r.sigma5E9).toBe(155_064)
		expect(r.sigma15E9).toBe(155_064)
		const b = estimate(input({ estimator: 'binance-1s', binance1s: ones() }))
		expect(b.sigma5E9).toBe(447_214)
		expect(b.sigma15E9).toBe(447_214)
		expect(() => estimate(input({ estimator: 'binance-1s' }))).toThrow('binance-1s: no data')
	})
	test('fewer than 3 tickers: the mid is the median 1-minute close', () => {
		const est = estimate(input({ tickers: TICKERS.slice(0, 2) }))
		expect(est.venueMidE6).toBe(2_038_363_297)
		expect(est.midFrom).toBe('closes')
	})
	test('USDT venue without a USDT/USD rate is dropped and quorum fails', () => {
		expect(() => estimate(input({ usdtUsd: null }))).toThrow('quorum 2/4 < 3')
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd cre/risk-desk && bun test estimator.test.ts`
Expected: FAIL with `Export named 'parkinsonPerSqrtSec' not found in module`.

- [ ] **Step 3: Replace `estimator.ts`**

Replace `cre/risk-desk/estimator.ts` with:

```ts
// Pure risk-desk estimator: no SDK imports, no I/O, no clock. Every input is passed in.
// Units: times in unix seconds, prices in quote currency per ETH, sigma per sqrt(second).

/** The volatility estimators the desk can compute; shared/params-fables.json's sigmaEstimator picks one (plan 03). */
export const SIGMA_ESTIMATORS = ['median-close', 'venue-range', 'binance-1s'] as const
export type SigmaEstimator = (typeof SIGMA_ESTIMATORS)[number]

export const DESK = {
	QUORUM: 3, // fewer fresh venues than this: no report
	MAX_AGE_SEC: 120, // a venue whose last closed 1m candle closed longer ago than this is dropped
	CLOSE_GRACE_SEC: 0, // a candle counts as closed once its minute has ended (the lab's convention)
	CANDLE_SEC: 60,
	LONG_SEC: 900, // sigma15
	SHORT_SEC: 300, // sigma5
	STEP_1S_SEC: 5, // binance-1s: 5 s returns, as the lab (damps the bid-ask bounce of 1 s closes)
	MAX_AGE_1S_SEC: 10, // binance-1s: the last closed second must be at most this old
} as const

export const SECONDS_PER_YEAR = 31_536_000
const PARKINSON = 1 / (4 * Math.log(2))

export type Quote = 'USD' | 'USDT'

export interface Candle {
	t: number // candle open time, unix seconds
	close: number // close price in the venue's quote currency
	high?: number // high of the candle, same currency (venue-range estimator)
	low?: number // low of the candle, same currency
}

export interface VenueSeries {
	venue: string
	quote: Quote
	candles: Candle[]
}

export interface VenueTicker {
	venue: string
	quote: Quote
	price: number // last trade or mid in the venue's quote currency
}

export interface EstimatorInput {
	nowSec: number
	usdtUsd: number | null // null: USDT-quoted venues cannot be normalized and are dropped
	series: VenueSeries[]
	tickers: VenueTicker[]
	binance1s: Candle[] | null
	estimator: SigmaEstimator
}

export interface Estimate {
	sigma15E9: number // 15-minute volatility, per sqrt(second) * 1e9
	sigma5E9: number // 5-minute volatility, per sqrt(second) * 1e9
	dispBp: number // farthest venue from the median close at tEnd, in bp, rounded up
	nSources: number // fresh, USD-normalized venues
	venueMidE6: number // venue mid in USD * 1e6: median of the tickers, or of the closes at tEnd
	midFrom: 'tickers' | 'closes'
	tEnd: number // open time of the last minute used
	sources: string[] // names of the fresh venues (logs only)
}

export class QuorumError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'QuorumError'
	}
}

export function median(xs: number[]): number {
	if (xs.length === 0) throw new Error('median of an empty list')
	const s = [...xs].sort((a, b) => a - b)
	const m = s.length >> 1
	return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function closedCandles(candles: Candle[], nowSec: number): Candle[] {
	return candles.filter((c) => c.t + DESK.CANDLE_SEC + DESK.CLOSE_GRACE_SEC <= nowSec).sort((a, b) => a.t - b.t)
}

export function toUsd(series: VenueSeries, usdtUsd: number | null): VenueSeries | null {
	if (series.quote === 'USD') return series
	if (usdtUsd === null || !(usdtUsd > 0)) return null
	return {
		venue: series.venue,
		quote: 'USD',
		candles: series.candles.map((c) => ({
			t: c.t,
			close: c.close * usdtUsd,
			...(c.high === undefined ? {} : { high: c.high * usdtUsd }),
			...(c.low === undefined ? {} : { low: c.low * usdtUsd }),
		})),
	}
}

export function isFresh(closed: Candle[], nowSec: number): boolean {
	if (closed.length === 0) return false
	const last = closed[closed.length - 1]
	return nowSec - (last.t + DESK.CANDLE_SEC) <= DESK.MAX_AGE_SEC
}

// Latest minute that at least `quorum` venues have closed.
export function commonEnd(series: VenueSeries[], quorum: number): number | null {
	const counts = new Map<number, number>()
	for (const s of series) for (const c of s.candles) counts.set(c.t, (counts.get(c.t) ?? 0) + 1)
	const times = [...counts.keys()].filter((t) => (counts.get(t) ?? 0) >= quorum).sort((a, b) => b - a)
	return times.length > 0 ? times[0] : null
}

export function perMinuteMedians(series: VenueSeries[], tEnd: number, windowMin: number): number[] {
	const maps = series.map((s) => new Map(s.candles.map((c) => [c.t, c.close] as const)))
	const out: number[] = []
	for (let i = windowMin; i >= 0; i--) {
		const t = tEnd - i * DESK.CANDLE_SEC
		const xs: number[] = []
		for (const m of maps) {
			const x = m.get(t)
			if (x !== undefined) xs.push(x)
		}
		if (xs.length === 0) throw new QuorumError(`no venue has a close for minute ${t}`)
		out.push(median(xs))
	}
	return out
}

export function realizedVolPerSqrtSec(prices: number[]): number {
	if (prices.length < 2) throw new Error('need at least two prices')
	let ss = 0
	for (let i = 1; i < prices.length; i++) {
		const r = Math.log(prices[i] / prices[i - 1])
		ss += r * r
	}
	return Math.sqrt(ss / ((prices.length - 1) * DESK.CANDLE_SEC))
}

/** median-close: realized volatility of the cross-venue median close over windowSec (windowSec / 60 returns). */
export function sigmaMedianClose(fresh: VenueSeries[], tEnd: number, windowSec: number): number {
	return realizedVolPerSqrtSec(perMinuteMedians(fresh, tEnd, windowSec / DESK.CANDLE_SEC))
}

/** Parkinson volatility per sqrt(second) of 1-minute candles: sqrt(mean(ln(high / low)^2) / (4 ln 2) / 60 s). */
export function parkinsonPerSqrtSec(candles: Candle[]): number {
	if (candles.length === 0) throw new Error('need at least one candle')
	let s = 0
	for (const c of candles) {
		if (c.high === undefined || c.low === undefined || !(c.low > 0) || c.high < c.low) {
			throw new Error(`candle ${c.t}: no valid high/low`)
		}
		const r = Math.log(c.high / c.low)
		s += r * r
	}
	return Math.sqrt(((s / candles.length) * PARKINSON) / DESK.CANDLE_SEC)
}

/** venue-range: median across venues of each venue's Parkinson volatility over its windowSec / 60 candles ending at
 *  tEnd. A venue missing one of those candles, or a high/low, is left out; fewer than QUORUM left: no report. */
export function sigmaVenueRange(fresh: VenueSeries[], tEnd: number, windowSec: number): number {
	const n = windowSec / DESK.CANDLE_SEC
	const values: number[] = []
	for (const s of fresh) {
		const byT = new Map(s.candles.map((c) => [c.t, c] as const))
		const window: Candle[] = []
		for (let i = n - 1; i >= 0; i--) {
			const c = byT.get(tEnd - i * DESK.CANDLE_SEC)
			if (c !== undefined) window.push(c)
		}
		if (window.length < n) continue
		try {
			values.push(parkinsonPerSqrtSec(window))
		} catch {
			// no high/low on this venue: left out
		}
	}
	if (values.length < DESK.QUORUM) {
		throw new QuorumError(`venue-range: ${values.length} venues with ${n} full candles < ${DESK.QUORUM}`)
	}
	return median(values)
}

/** binance-1s: realized volatility of 5 s returns over windowSec, from Binance 1 s closes ending at the last closed
 *  second (a second without a candle keeps the previous close). The lab's estimator (lab/clim_lab/venue.py rv_window). */
export function sigmaBinance1s(candles: Candle[], nowSec: number, windowSec: number): number {
	const closed = candles.filter((c) => c.t + 1 <= nowSec).sort((a, b) => a.t - b.t)
	if (closed.length === 0) throw new QuorumError('binance-1s: no closed second')
	const last = closed[closed.length - 1].t
	if (nowSec - (last + 1) > DESK.MAX_AGE_1S_SEC) {
		throw new QuorumError(`binance-1s: last second closed ${nowSec - last - 1} s ago`)
	}
	const step = DESK.STEP_1S_SEC
	const n = windowSec / step
	const first = last - n * step
	if (closed[0].t > first) throw new QuorumError('binance-1s: not enough history')
	const prices: number[] = []
	let j = 0
	let px = Number.NaN
	for (let k = 0; k <= n; k++) {
		const target = first + k * step
		while (j < closed.length && closed[j].t <= target) {
			px = closed[j].close
			j++
		}
		prices.push(px)
	}
	let ss = 0
	for (let k = 1; k < prices.length; k++) {
		const r = Math.log(prices[k] / prices[k - 1])
		ss += r * r
	}
	return Math.sqrt(ss / windowSec)
}

export function dispersionBp(closes: number[], mid: number): number {
	let worst = 0
	for (const p of closes) worst = Math.max(worst, Math.abs(p / mid - 1))
	return Math.max(0, Math.ceil(worst * 1e4 - 1e-9))
}

export function annualPctFromE9(sigmaE9: number): number {
	return (sigmaE9 / 1e9) * Math.sqrt(SECONDS_PER_YEAR) * 100
}

function sigmas(input: EstimatorInput, fresh: VenueSeries[], tEnd: number): [number, number] {
	switch (input.estimator) {
		case 'median-close':
			return [sigmaMedianClose(fresh, tEnd, DESK.LONG_SEC), sigmaMedianClose(fresh, tEnd, DESK.SHORT_SEC)]
		case 'venue-range':
			return [sigmaVenueRange(fresh, tEnd, DESK.LONG_SEC), sigmaVenueRange(fresh, tEnd, DESK.SHORT_SEC)]
		case 'binance-1s': {
			if (input.binance1s === null) throw new QuorumError('binance-1s: no data')
			return [
				sigmaBinance1s(input.binance1s, input.nowSec, DESK.LONG_SEC),
				sigmaBinance1s(input.binance1s, input.nowSec, DESK.SHORT_SEC),
			]
		}
	}
}

export function estimate(input: EstimatorInput): Estimate {
	const fresh: VenueSeries[] = []
	for (const raw of input.series) {
		const usd = toUsd(raw, input.usdtUsd)
		if (usd === null) continue
		const closed = closedCandles(usd.candles, input.nowSec)
		if (!isFresh(closed, input.nowSec)) continue
		fresh.push({ venue: usd.venue, quote: 'USD', candles: closed })
	}
	if (fresh.length < DESK.QUORUM) {
		throw new QuorumError(`quorum ${fresh.length}/${input.series.length} < ${DESK.QUORUM}`)
	}
	const tEnd = commonEnd(fresh, DESK.QUORUM)
	if (tEnd === null) throw new QuorumError(`no minute closed by ${DESK.QUORUM} venues`)

	const [s15, s5] = sigmas(input, fresh, tEnd)
	const endCloses: number[] = []
	for (const s of fresh) {
		const c = s.candles.find((x) => x.t === tEnd)
		if (c !== undefined) endCloses.push(c.close)
	}
	const closeMid = median(endCloses)
	const usdTickers: number[] = []
	for (const t of input.tickers) {
		if (t.quote === 'USD') usdTickers.push(t.price)
		else if (input.usdtUsd !== null && input.usdtUsd > 0) usdTickers.push(t.price * input.usdtUsd)
	}
	const fromTickers = usdTickers.length >= DESK.QUORUM
	const mid = fromTickers ? median(usdTickers) : closeMid
	return {
		sigma15E9: Math.round(s15 * 1e9),
		sigma5E9: Math.round(s5 * 1e9),
		dispBp: dispersionBp(endCloses, closeMid),
		nSources: fresh.length,
		venueMidE6: Math.round(mid * 1e6),
		midFrom: fromTickers ? 'tickers' : 'closes',
		tEnd,
		sources: fresh.map((s) => s.venue),
	}
}
```

- [ ] **Step 4: Run the estimator and venue tests**

Run: `cd cre/risk-desk && bun test estimator.test.ts venues.test.ts`
Expected: `0 fail` (estimator: 16 tests, venues: 10).

- [ ] **Step 5: Commit**

```bash
git add cre/risk-desk/estimator.ts cre/risk-desk/estimator.test.ts
git commit -m "feat(cre): desk v2 estimator, 5 and 15 minute sigma with three estimators, venue mid from tickers" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 15: CRE pool read and the v2 report

**Files:**
- Create: `cre/risk-desk/pool.ts`, `cre/risk-desk/pool.test.ts`
- Modify: `cre/risk-desk/report.ts`, `cre/risk-desk/report.test.ts`, `cre/risk-desk/abi-sync.test.ts` (whole files)

- [ ] **Step 1: Write the failing tests**

Create `cre/risk-desk/pool.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { encodeFunctionResult, type Hex } from 'viem'
import { devPipsOf, parseRpcSlot0, poolMidFromSqrtPriceX96, rpcSlot0Request, STATE_VIEW_ABI } from './pool'

const FABLES_POOL = '0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551' as Hex
const STATE_VIEW = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b' as Hex
// Fables' ETH/USDG slot0 read on Robinhood Chain mainnet on 2026-10-13 (native ETH is token0, 18 and 6 decimals).
const FABLES_SQRT = 3_967_422_558_559_756_050_525_311n

describe('pool mid', () => {
	test("Fables' ETH/USDG: ETH token0, 18/6 decimals", () => {
		expect(poolMidFromSqrtPriceX96(FABLES_SQRT, { token0IsEth: true, decimals0: 18, decimals1: 6 })).toBeCloseTo(2507.597, 3)
	})
	test('USD token0 (6 decimals) at 2,500 (contracts/test/v2/LiveScript.t.sol value)', () => {
		const sqrt = 1_584_563_250_285_286_751_870_879_006_720_000n
		expect(poolMidFromSqrtPriceX96(sqrt, { token0IsEth: false, decimals0: 6, decimals1: 18 })).toBeCloseTo(2500, 6)
	})
	test('devPips = (venue - pool) / pool x 1e6, rounded, clamped like the desk', () => {
		expect(devPipsOf(2501, 2500)).toBe(400)
		expect(devPipsOf(2500, 2501)).toBe(-400)
		expect(devPipsOf(10_000, 2500)).toBe(1_000_000)
		expect(() => devPipsOf(0, 2500)).toThrow(RangeError)
	})
})

describe('slot0 over JSON-RPC (shadow mode)', () => {
	test('eth_call body', () => {
		const r = rpcSlot0Request('https://rpc.mainnet.chain.robinhood.com', STATE_VIEW, FABLES_POOL)
		expect(r.method).toBe('POST')
		const body = JSON.parse(r.body ?? '')
		expect(body.method).toBe('eth_call')
		expect(body.params[0].to).toBe(STATE_VIEW)
		expect(body.params[0].data).toBe(`0xc815641c${FABLES_POOL.slice(2)}`)
		expect(body.params[1]).toBe('latest')
	})
	test('decodes the result, rejects errors', () => {
		const result = encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', result: [FABLES_SQRT, -198_050, 0, 0] })
		expect(parseRpcSlot0({ jsonrpc: '2.0', id: 1, result })).toBe(FABLES_SQRT)
		expect(() => parseRpcSlot0({ jsonrpc: '2.0', id: 1, error: { message: 'rate limited' } })).toThrow('rpc: rate limited')
		expect(() => parseRpcSlot0({ jsonrpc: '2.0', id: 1 })).toThrow('rpc: no result')
	})
})
```

Replace `cre/risk-desk/report.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test'
import { buildReport, decodeRiskReport, encodeRiskReport, K_E4_NEUTRAL, type RiskReport } from './report'

const REPORT: RiskReport = {
	tObs: 1_791_282_309,
	sigma15E9: 59_492,
	sigma5E9: 61_000,
	devPips: -1_234,
	dispBp: 2,
	nSources: 4,
	kE4: 10_000,
}

// Golden value from Foundry (independent encoder), i.e. what RiskDeskV2's abi.decode expects:
// cast abi-encode "f(uint40,uint32,uint32,int32,uint16,uint8,uint16)" 1791282309 59492 61000 -1234 2 4 10000
const GOLDEN =
	'0x' +
	'000000000000000000000000000000000000000000000000000000006ac4cc85' +
	'000000000000000000000000000000000000000000000000000000000000e864' +
	'000000000000000000000000000000000000000000000000000000000000ee48' +
	'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffb2e' +
	'0000000000000000000000000000000000000000000000000000000000000002' +
	'0000000000000000000000000000000000000000000000000000000000000004' +
	'0000000000000000000000000000000000000000000000000000000000002710'

describe('encodeRiskReport (v2)', () => {
	test('matches the Foundry encoding word for word', () => {
		expect(encodeRiskReport(REPORT)).toBe(GOLDEN)
	})
	test('round trip, negative gap included', () => {
		expect(decodeRiskReport(encodeRiskReport(REPORT))).toEqual(REPORT)
	})
	test('rejects out-of-range or fractional fields', () => {
		expect(() => encodeRiskReport({ ...REPORT, sigma5E9: -1 })).toThrow(RangeError)
		expect(() => encodeRiskReport({ ...REPORT, dispBp: 1.5 })).toThrow('dispBp=1.5 outside [0, 65535]')
		expect(() => encodeRiskReport({ ...REPORT, devPips: 2 ** 31 })).toThrow(RangeError)
	})
})

describe('buildReport', () => {
	test('rounds consensus medians and clamps to the field ranges', () => {
		const r = buildReport(
			{ sigma15E9: 59_492.4, sigma5E9: 61_000.5, dispBp: 70_000, nSources: 3.5, venueMidE6: 2_713_150_000, poolMidE6: 0 },
			1_791_282_309.9,
			-1_234,
		)
		expect(r).toEqual({ tObs: 1_791_282_309, sigma15E9: 59_492, sigma5E9: 61_001, devPips: -1_234, dispBp: 65_535, nSources: 4, kE4: K_E4_NEUTRAL })
	})
	test('kE4 from the config', () => {
		const r = buildReport({ sigma15E9: 1, sigma5E9: 1, dispBp: 0, nSources: 4, venueMidE6: 1, poolMidE6: 0 }, 1, 0, 12_500)
		expect(r.kE4).toBe(12_500)
	})
})
```

Replace `cre/risk-desk/abi-sync.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { type Abi, type AbiEvent, type AbiFunction, toEventSignature, toFunctionSignature } from 'viem'
import { RISK_DESK_ABI } from './report'

// shared/abis/RiskDeskV2.json is exported from contracts/out by contracts/script/export-abis.sh.
const PATH = process.env.RISK_DESK_ABI ?? '../../shared/abis/RiskDeskV2.json'
const exported = existsSync(PATH) ? (JSON.parse(readFileSync(PATH, 'utf8')) as Abi | { abi: Abi }) : null
const abi: Abi = exported === null ? [] : Array.isArray(exported) ? exported : exported.abi

const fn = (name: string) => abi.find((x): x is AbiFunction => x.type === 'function' && x.name === name)
const ev = (name: string) => abi.find((x): x is AbiEvent => x.type === 'event' && x.name === name)

describe.skipIf(exported === null)('RiskDeskV2 ABI matches the workflow', () => {
	test('state() has the outputs the workflow decodes', () => {
		expect(fn('state')?.outputs.map((o) => o.type)).toEqual(RISK_DESK_ABI[0].outputs.map((o) => o.type))
	})
	test('onReport(bytes,bytes) exists', () => {
		const f = fn('onReport')
		expect(f === undefined ? '' : toFunctionSignature(f)).toBe('onReport(bytes,bytes)')
	})
	test('RiskReportedV2 carries both windows, the gap and the flags', () => {
		const e = ev('RiskReportedV2')
		expect(e === undefined ? '' : toEventSignature(e)).toBe(
			'RiskReportedV2(uint32,uint40,uint32,uint32,uint32,uint32,int32,uint16,uint8,uint16,uint8)',
		)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd cre/risk-desk && bun test pool.test.ts report.test.ts abi-sync.test.ts`
Expected: FAIL with `Cannot find module './pool'` and, in `report.test.ts`, the GOLDEN mismatch (v1 `encodeRiskReport` has nine fields).

- [ ] **Step 3: Write `pool.ts`**

Create `cre/risk-desk/pool.ts`:

```ts
// The target pool's mid price for devPips, from Uniswap v4 StateView.getSlot0: read with the CRE EVM capability on the
// chain the desk writes to (pool D on Robinhood Chain testnet), or with a JSON-RPC eth_call over the HTTP capability
// (Fables' ETH/USDG pool on Robinhood Chain mainnet, shadow mode: a read, never a write).
import { decodeFunctionResult, encodeFunctionData, type Hex, parseAbi } from 'viem'
import type { HttpReq } from './venues'

export const STATE_VIEW_ABI = parseAbi([
	'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
])

export interface PoolTarget {
	token0IsEth: boolean
	decimals0: number
	decimals1: number
}

export const DEV_MAX_PIPS = 1_000_000 // RiskDeskV2.DEV_MAX_PIPS
const Q96 = 2 ** 96

/** ETH price in USD (human units) from a pool's sqrtPriceX96, for either token order and any decimals. */
export function poolMidFromSqrtPriceX96(sqrtPriceX96: bigint, t: PoolTarget): number {
	if (sqrtPriceX96 <= 0n) throw new RangeError('sqrtPriceX96 must be > 0')
	const r = Number(sqrtPriceX96) / Q96
	const p01 = r * r * 10 ** (t.decimals0 - t.decimals1) // human price of token0 in token1
	return t.token0IsEth ? p01 : 1 / p01
}

/** (venue - pool) / pool x 1e6, rounded and clamped to +-DEV_MAX_PIPS: positive means ETH is cheap in the pool. */
export function devPipsOf(venueMid: number, poolMid: number): number {
	if (!(venueMid > 0) || !(poolMid > 0)) throw new RangeError(`prices must be > 0, got ${venueMid} and ${poolMid}`)
	const d = Math.round(((venueMid - poolMid) / poolMid) * 1e6)
	return Math.max(-DEV_MAX_PIPS, Math.min(DEV_MAX_PIPS, d))
}

export function slot0CallData(poolId: Hex): Hex {
	return encodeFunctionData({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [poolId] })
}

export function decodeSlot0(data: Hex): bigint {
	const [sqrtPriceX96] = decodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', data })
	return sqrtPriceX96
}

export function rpcSlot0Request(rpcUrl: string, stateView: Hex, poolId: Hex): HttpReq {
	return {
		url: rpcUrl,
		method: 'POST',
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_call',
			params: [{ to: stateView, data: slot0CallData(poolId) }, 'latest'],
		}),
	}
}

export function parseRpcSlot0(json: unknown): bigint {
	if (typeof json !== 'object' || json === null) throw new Error('rpc: not an object')
	const o = json as { result?: unknown; error?: { message?: string } }
	if (o.error !== undefined) throw new Error(`rpc: ${o.error.message ?? 'error'}`)
	if (typeof o.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(o.result)) throw new Error('rpc: no result')
	return decodeSlot0(o.result as Hex)
}
```

- [ ] **Step 4: Replace `report.ts`**

Replace `cre/risk-desk/report.ts` with:

```ts
// Canonical CRE report v2 (the contract between this workflow and RiskDeskV2._processReport) and the RiskDeskV2 read
// ABI. Must match contracts/src/v2/RiskDeskV2.sol and shared/abis/RiskDeskV2.json (abi-sync.test.ts).
import { decodeAbiParameters, encodeAbiParameters, type Hex, parseAbi, parseAbiParameters } from 'viem'

export const REPORT_ABI = parseAbiParameters(
	'uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 dispBp, uint8 nSources, uint16 kE4',
)

export const RISK_DESK_ABI = parseAbi([
	'function state() view returns (uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 kE4, uint8 flags, uint32 seq)',
])

export const K_E4_NEUTRAL = 10_000 // k = 1: no model-risk multiplier
export const MIN_GAP_SEC = 20 // RiskDeskV2 rejects tObs < last tObs + 20 s

export interface RiskReport {
	tObs: number
	sigma15E9: number
	sigma5E9: number
	devPips: number
	dispBp: number
	nSources: number
	kE4: number
}

/** One node's observation; the DON takes the median of each field. poolMidE6 is 0 unless read in node mode. */
export interface Observation {
	sigma15E9: number
	sigma5E9: number
	dispBp: number
	nSources: number
	venueMidE6: number
	poolMidE6: number
}

const UINT16_MAX = 65_535
const UINT32_MAX = 4_294_967_295
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647

const clampInt = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(x)))

// Rounds and clamps the consensus observation into the report's integer ranges.
export function buildReport(obs: Observation, tObs: number, devPips: number, kE4 = K_E4_NEUTRAL): RiskReport {
	return {
		tObs: Math.floor(tObs),
		sigma15E9: clampInt(obs.sigma15E9, 0, UINT32_MAX),
		sigma5E9: clampInt(obs.sigma5E9, 0, UINT32_MAX),
		devPips: clampInt(devPips, INT32_MIN, INT32_MAX),
		dispBp: clampInt(obs.dispBp, 0, UINT16_MAX),
		nSources: clampInt(obs.nSources, 0, 255),
		kE4: clampInt(kE4, 0, UINT16_MAX),
	}
}

function assertInt(name: string, x: number, lo: number, hi: number): void {
	if (!Number.isInteger(x) || x < lo || x > hi) throw new RangeError(`${name}=${x} outside [${lo}, ${hi}]`)
}

export function encodeRiskReport(r: RiskReport): Hex {
	assertInt('tObs', r.tObs, 0, 2 ** 40 - 1)
	assertInt('sigma15E9', r.sigma15E9, 0, UINT32_MAX)
	assertInt('sigma5E9', r.sigma5E9, 0, UINT32_MAX)
	assertInt('devPips', r.devPips, INT32_MIN, INT32_MAX)
	assertInt('dispBp', r.dispBp, 0, UINT16_MAX)
	assertInt('nSources', r.nSources, 0, 255)
	assertInt('kE4', r.kE4, 0, UINT16_MAX)
	return encodeAbiParameters(REPORT_ABI, [r.tObs, r.sigma15E9, r.sigma5E9, r.devPips, r.dispBp, r.nSources, r.kE4])
}

export function decodeRiskReport(data: Hex): RiskReport {
	const [tObs, sigma15E9, sigma5E9, devPips, dispBp, nSources, kE4] = decodeAbiParameters(REPORT_ABI, data)
	return { tObs, sigma15E9, sigma5E9, devPips, dispBp, nSources, kE4 }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd cre/risk-desk && bun test pool.test.ts report.test.ts abi-sync.test.ts`
Expected: `0 fail` (pool 5, report 5, abi-sync 3; abi-sync runs because `shared/abis/RiskDeskV2.json` exists since plan 02).

- [ ] **Step 6: Commit**

```bash
git add cre/risk-desk/pool.ts cre/risk-desk/pool.test.ts cre/risk-desk/report.ts cre/risk-desk/report.test.ts cre/risk-desk/abi-sync.test.ts
git commit -m "feat(cre): RiskDeskV2 report layout and the pool mid read (StateView, EVM or JSON-RPC)" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 16: CRE workflow v2, targets and config sync

**Files:**
- Modify: `cre/risk-desk/workflow.ts`, `cre/risk-desk/workflow.test.ts` (whole files)
- Create: `cre/risk-desk/config.testnet.json`, `cre/risk-desk/config.shadow.json`
- Modify: `cre/risk-desk/config.production.json`, `cre/risk-desk/workflow.yaml`, `cre/project.yaml`, `cre/risk-desk/scripts/sync-config.ts` (whole files)
- Delete: `cre/risk-desk/config.staging.json`, `cre/risk-desk/config.replay.json`

- [ ] **Step 1: Replace the workflow tests**

Replace `cre/risk-desk/workflow.test.ts` with:

```ts
import { describe, expect } from 'bun:test'
import { EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from '@chainlink/cre-sdk/test'
import { bytesToHex, encodeFunctionResult, type Hex, hexToBytes } from 'viem'
import { type Candle, estimate } from './estimator'
import binance from './fixtures/binance.json'
import coinbase from './fixtures/coinbase.json'
import hyperliquid from './fixtures/hyperliquid.json'
import kraken from './fixtures/kraken.json'
import { devPipsOf, poolMidFromSqrtPriceX96, STATE_VIEW_ABI } from './pool'
import { buildReport, decodeRiskReport, RISK_DESK_ABI, type RiskReport } from './report'
import { BINANCE_1S_REQUEST, parseBinance, parseVenue, tickerRequest, VENUE_QUOTE, VENUES, venueRequest } from './venues'
import { type Config, initWorkflow, onHttp, onTick } from './workflow'

const NOW = 1_791_282_309 // fixtures/now.txt
const RH_TESTNET = 2_032_988_798_112_970_440n // robinhood-testnet chain selector (@chainlink/cre-sdk 1.23.0)
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex
const HL = 'https://api.hyperliquid.xyz/info'
const MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const FABLES_POOL = '0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551'
const STATE_SEL = '0xc19d93fb' // state()
const SLOT0_SEL = '0xc815641c' // getSlot0(bytes32)

const CONFIG: Config = {
	schedule: '*/30 * * * * *',
	deskAddress: '0x000000000000000000000000000000000000dEaD',
	chainSelectorName: 'robinhood-testnet',
	gasLimit: '1000000',
	venues: ['coinbase', 'kraken', 'binance', 'hyperliquid'],
	sigmaEstimator: 'median-close',
	kE4: 10_000,
	pool: {
		source: 'evm',
		rpcUrl: '',
		stateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
		poolId: `0x${'11'.repeat(32)}`,
		token0IsEth: true,
		decimals0: 18,
		decimals1: 6,
	},
	httpAuthorizedKeys: [],
}
const SHADOW: Config = { ...CONFIG, pool: { ...CONFIG.pool, source: 'http', rpcUrl: MAINNET_RPC, poolId: FABLES_POOL } }

// Trimmed real ticker responses (venues.test.ts) and the pool at 2,712.00 USD per ETH.
const TICKERS: Record<string, unknown> = {
	[tickerRequest('coinbase').url]: { price: '2713.33' },
	[tickerRequest('kraken').url]: {
		error: [],
		result: { XETHZUSD: { c: ['2713.25000', '0.004'] }, USDTZUSD: { c: ['0.99970000', '49.9'] } },
	},
	[tickerRequest('binance').url]: { symbol: 'ETHUSDT', price: '2713.86000000' },
	[`${HL} allMids`]: { ETH: '2712.75' },
}
const POOL_SQRT = BigInt(Math.floor(Math.sqrt(2712e-12) * 2 ** 96))
const FIXTURES: Record<string, unknown> = { coinbase, kraken, binance, hyperliquid }

// Binance 1 s klines ending one second before NOW (binance-1s estimator).
const ONES = Array.from({ length: 1000 }, (_, i) => {
	const t = NOW - 1000 + i
	const px = (2713 * Math.exp(0.0002 * Math.floor((t - (NOW - 1)) / 5))).toFixed(2)
	return [t * 1000, px, px, px, px, '1.0', t * 1000 + 999]
})

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
const jsonBody = (x: unknown): string => b64(new TextEncoder().encode(JSON.stringify(x)))
const bodyText = (b: unknown): string =>
	typeof b === 'string' ? Buffer.from(b, 'base64').toString() : new TextDecoder().decode((b as Uint8Array | undefined) ?? new Uint8Array())
const asHex = (b: unknown): string =>
	typeof b === 'string' ? `0x${Buffer.from(b, 'base64').toString('hex')}` : bytesToHex((b as Uint8Array | undefined) ?? new Uint8Array())

function mockHttp(opts: { failing?: string[]; rpc?: unknown } = {}): string[] {
	const seen: string[] = []
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		const key = req.url === HL ? `${HL} ${JSON.parse(bodyText(req.body)).type}` : req.url
		seen.push(`${req.method} ${key}`)
		const routes = new Map<string, unknown>([
			[venueRequest('coinbase', NOW).url, coinbase],
			[venueRequest('kraken', NOW).url, kraken],
			[venueRequest('binance', NOW).url, binance],
			[`${HL} candleSnapshot`, hyperliquid],
			...Object.entries(TICKERS),
			[BINANCE_1S_REQUEST.url, ONES],
			[MAINNET_RPC, opts.rpc ?? {}],
		])
		const hit = routes.get(key)
		if (hit === undefined || (opts.failing ?? []).includes(key)) {
			return { statusCode: 503, headers: {}, body: jsonBody({ error: 'unavailable' }) }
		}
		return { statusCode: 200, headers: {}, body: jsonBody(hit) }
	}
	return seen
}

type State = [tObs: number, sigma15E9: number, sigma5E9: number, devPips: number, kE4: number, flags: number, seq: number]

interface EvmOpts {
	states: State[] // returned by successive state() reads; the last one repeats; [] means unreadable
	receiver?: 'SUCCESS' | 'REVERTED'
	txHash?: Hex | null // null: dry run (no hash)
	sqrtPriceX96?: bigint | null // pool D's slot0; null: the read fails
}

function mockEvm({ states, receiver = 'SUCCESS', txHash = TX_HASH, sqrtPriceX96 = POOL_SQRT }: EvmOpts): {
	written: RiskReport[]
	slot0Reads: () => number
} {
	const written: RiskReport[] = []
	let reads = 0
	let slot0 = 0
	const evm = EvmMock.testInstance(RH_TESTNET)
	evm.callContract = (req) => {
		const sel = asHex(req.call?.data).slice(0, 10)
		if (sel === SLOT0_SEL) {
			slot0++
			if (sqrtPriceX96 === null) throw new Error('pool read down')
			const data = encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', result: [sqrtPriceX96, -198_000, 0, 0] })
			return { data: b64(hexToBytes(data)) }
		}
		expect(sel).toBe(STATE_SEL)
		const s = states[Math.min(reads++, states.length - 1)]
		if (s === undefined) throw new Error('rpc down')
		return { data: b64(hexToBytes(encodeFunctionResult({ abi: RISK_DESK_ABI, functionName: 'state', result: s }))) }
	}
	evm.writeReport = (req) => {
		const raw = req.report?.rawReport ?? new Uint8Array()
		written.push(decodeRiskReport(bytesToHex(raw.slice(REPORT_METADATA_HEADER_LENGTH))))
		return {
			txStatus: 'TX_STATUS_SUCCESS',
			receiverContractExecutionStatus: `RECEIVER_CONTRACT_EXECUTION_STATUS_${receiver}`,
			...(txHash === null ? {} : { txHash: b64(hexToBytes(txHash)) }),
		}
	}
	return { written, slot0Reads: () => slot0 }
}

/** The report the workflow must write: the pure estimator on the same inputs, devPips against the pool. */
function expected(cfg: Config, poolMid: number | null, binance1s: Candle[] | null = null): RiskReport {
	const est = estimate({
		nowSec: NOW,
		usdtUsd: 0.9997,
		series: VENUES.map((v) => ({ venue: v, quote: VENUE_QUOTE[v], candles: parseVenue(v, FIXTURES[v]) })),
		tickers: [
			{ venue: 'coinbase', quote: 'USD', price: 2713.33 },
			{ venue: 'kraken', quote: 'USD', price: 2713.25 },
			{ venue: 'binance', quote: 'USDT', price: 2713.86 },
			{ venue: 'hyperliquid', quote: 'USD', price: 2712.75 },
		],
		binance1s,
		estimator: cfg.sigmaEstimator,
	})
	const dev = poolMid === null ? 0 : devPipsOf(est.venueMidE6 / 1e6, poolMid)
	return buildReport({ ...est, poolMidE6: 0 }, NOW, dev, cfg.kE4)
}
const POOL_MID = poolMidFromSqrtPriceX96(POOL_SQRT, CONFIG.pool)

const BEFORE: State = [NOW - 30, 50_000, 50_000, 0, 10_000, 0, 7]
const AFTER = (r: RiskReport): State => [NOW, r.sigma15E9, r.sigma5E9, r.devPips, 10_000, 0, 8]

function runtimeAt(nowSec: number, config: Config = CONFIG) {
	const runtime = newTestRuntime(null, { timeProvider: () => nowSec * 1000 })
	;(runtime as unknown as { config: Config }).config = config
	return runtime
}

describe('onTick (testnet desk, pool D read with the EVM capability)', () => {
	test('8 HTTP calls, consensus, devPips against pool D, the v2 report written and confirmed', () => {
		const want = expected(CONFIG, POOL_MID)
		const seen = mockHttp()
		const { written, slot0Reads } = mockEvm({ states: [BEFORE, AFTER(want)] })
		const runtime = runtimeAt(NOW)

		expect(onTick(runtime as never)).toBe(`OK ${TX_HASH}`)
		expect(seen).toHaveLength(8)
		expect(seen).toContain(`POST ${HL} candleSnapshot`)
		expect(seen).toContain(`POST ${HL} allMids`)
		expect(slot0Reads()).toBe(1)
		expect(written).toEqual([want])
		expect(want.devPips).not.toBe(0)
		const logs = runtime.getLogs().join('\n')
		expect(logs).toContain(`dev=${want.devPips}pips`)
		expect(logs).toContain('desk before: seq=7')
		expect(logs).toContain(`Write report transaction succeeded: ${TX_HASH}`) // parsed by bots/src/lib/simParse.ts
		expect(logs).toContain('REPORT applied seq=8')
	})

	test('venue-range estimator: same calls, the range sigma', () => {
		const cfg: Config = { ...CONFIG, sigmaEstimator: 'venue-range' }
		const want = expected(cfg, POOL_MID)
		const seen = mockHttp()
		const { written } = mockEvm({ states: [BEFORE, AFTER(want)] })
		expect(onTick(runtimeAt(NOW, cfg) as never)).toBe(`OK ${TX_HASH}`)
		expect(seen).toHaveLength(8)
		expect(written).toEqual([want])
	})

	test('binance-1s estimator: one more call, for the 1 s klines', () => {
		const cfg: Config = { ...CONFIG, sigmaEstimator: 'binance-1s' }
		const want = expected(cfg, POOL_MID, parseBinance(ONES))
		const seen = mockHttp()
		const { written } = mockEvm({ states: [BEFORE, AFTER(want)] })
		expect(onTick(runtimeAt(NOW, cfg) as never)).toBe(`OK ${TX_HASH}`)
		expect(seen).toHaveLength(9)
		expect(seen).toContain(`GET ${BINANCE_1S_REQUEST.url}`)
		expect(written).toEqual([want])
	})

	test('pool unreadable: devPips 0 (no directional premium), and the log says so', () => {
		const want = expected(CONFIG, null)
		mockHttp()
		const { written } = mockEvm({ states: [BEFORE, AFTER(want)], sqrtPriceX96: null })
		const runtime = runtimeAt(NOW)
		expect(onTick(runtime as never)).toBe(`OK ${TX_HASH}`)
		expect(written).toEqual([want])
		expect(written[0]?.devPips).toBe(0)
		expect(runtime.getLogs().join('\n')).toContain('pool mid unreadable')
	})

	test('dry run, rejected and not-applied outcomes', () => {
		mockHttp()
		mockEvm({ states: [BEFORE], txHash: null })
		expect(onTick(runtimeAt(NOW) as never)).toBe('DRY RUN')
		mockEvm({ states: [BEFORE], receiver: 'REVERTED' })
		expect(onTick(runtimeAt(NOW) as never)).toBe(`REJECTED ${TX_HASH}`)
		mockEvm({ states: [BEFORE, BEFORE] })
		expect(onTick(runtimeAt(NOW) as never)).toBe(`NOT_APPLIED ${TX_HASH}`)
	})

	test('skips when the last report is younger than MIN_GAP (20 s)', () => {
		mockHttp()
		const { written } = mockEvm({ states: [[NOW - 10, 50_000, 50_000, 0, 10_000, 0, 7]] })
		expect(onTick(runtimeAt(NOW) as never)).toBe('SKIP: min gap')
		expect(written).toHaveLength(0)
	})

	test('no report when fewer than 3 venues answer', () => {
		mockHttp({ failing: [venueRequest('coinbase', NOW).url, venueRequest('kraken', NOW).url] })
		const { written } = mockEvm({ states: [BEFORE] })
		const runtime = runtimeAt(NOW)
		expect(onTick(runtime as never)).toBe('SKIP: quorum 2/4 < 3')
		expect(written).toHaveLength(0)
		const logs = runtime.getLogs().join('\n')
		expect(logs).toContain('source dropped: coinbase: HTTP 503')
		expect(logs).toContain('clim: no report (quorum 2/4 < 3)') // parsed by bots/src/lib/simParse.ts
	})
})

describe("onTick (shadow: Fables' mainnet pool over JSON-RPC)", () => {
	test('the RPC read is one more HTTP call in node mode; no EVM slot0 read', () => {
		const rpc = {
			jsonrpc: '2.0',
			id: 1,
			result: encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', result: [3_967_422_558_559_756_050_525_311n, -198_050, 0, 0] }),
		}
		const fablesMid = poolMidFromSqrtPriceX96(3_967_422_558_559_756_050_525_311n, SHADOW.pool)
		const want = expected(SHADOW, Math.round(fablesMid * 1e6) / 1e6)
		const seen = mockHttp({ rpc })
		const { written, slot0Reads } = mockEvm({ states: [BEFORE], txHash: null })
		const runtime = runtimeAt(NOW, SHADOW)
		expect(onTick(runtime as never)).toBe('DRY RUN')
		expect(seen).toContain(`POST ${MAINNET_RPC}`)
		expect(seen).toHaveLength(9)
		expect(slot0Reads()).toBe(0)
		expect(written).toEqual([want])
		expect(runtime.getLogs().join('\n')).toContain('pool=2507.60')
	})
})

describe('initWorkflow', () => {
	test('[0] cron every 30 s, [1] HTTP trigger running the same tick', () => {
		const handlers = initWorkflow(CONFIG)
		expect(handlers).toHaveLength(2)
		expect((handlers[0].trigger as unknown as { config: { schedule: string } }).config.schedule).toBe('*/30 * * * * *')
		expect(handlers[1].fn).toBe(onHttp)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd cre/risk-desk && bun test workflow.test.ts`
Expected: FAIL (the v1 `Config` has no `sigmaEstimator` or `pool`; `onTick` writes the v1 layout).

- [ ] **Step 3: Replace `workflow.ts`**

Replace `cre/risk-desk/workflow.ts` with:

```ts
// clim × Fables risk desk: every 30 s, measure ETH volatility over 5 and 15 minutes on four venues and the venue mid
// against the target pool's mid, reach DON consensus field by field (median), and write the signed report to
// RiskDeskV2.onReport on Robinhood Chain testnet.
import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	CronCapability,
	EVMClient,
	encodeCallMsg,
	getNetwork,
	HTTPCapability,
	type HTTPPayload,
	handler,
	LATEST_BLOCK_NUMBER,
	median,
	type NodeRuntime,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import { type Address, decodeFunctionResult, encodeFunctionData, type Hex, zeroAddress } from 'viem'
import { z } from 'zod'
import { annualPctFromE9, estimate, SIGMA_ESTIMATORS } from './estimator'
import { decodeSlot0, devPipsOf, parseRpcSlot0, poolMidFromSqrtPriceX96, rpcSlot0Request, slot0CallData } from './pool'
import { buildReport, encodeRiskReport, MIN_GAP_SEC, type Observation, RISK_DESK_ABI } from './report'
import { fetchLive, type HttpReq, VENUES } from './venues'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BYTES32 = /^0x[0-9a-fA-F]{64}$/

export const configSchema = z.object({
	schedule: z.string(),
	deskAddress: z.string().regex(ADDRESS),
	chainSelectorName: z.string(),
	gasLimit: z.string(),
	venues: z.array(z.enum(VENUES)).min(3),
	sigmaEstimator: z.enum(SIGMA_ESTIMATORS),
	kE4: z.number().int().min(10_000).max(20_000),
	pool: z.object({
		source: z.enum(['evm', 'http']), // evm: StateView on the desk's chain; http: eth_call to rpcUrl (shadow)
		rpcUrl: z.string(),
		stateView: z.string().regex(ADDRESS),
		poolId: z.string().regex(BYTES32),
		token0IsEth: z.boolean(),
		decimals0: z.number().int().min(0).max(36),
		decimals1: z.number().int().min(0).max(36),
	}),
	httpAuthorizedKeys: z.array(z.string()),
})

export type Config = z.infer<typeof configSchema>

export interface DeskState {
	tObs: number
	sigma15E9: number
	sigma5E9: number
	devPips: number
	kE4: number
	flags: number
	seq: number
}

const pct = (sigmaE9: number): string => annualPctFromE9(sigmaE9).toFixed(1)
const msg = (e: unknown): string => (e instanceof Error ? e.message.split('\n')[0] : String(e))

// Runs on every node: fetch the sources (and, in shadow mode, the pool over JSON-RPC), estimate, return one
// observation for consensus.
export const observe = (nodeRuntime: NodeRuntime<Config>, nowSec: number): Observation => {
	const cfg = nodeRuntime.config
	const extra: HttpReq[] =
		cfg.pool.source === 'http' ? [rpcSlot0Request(cfg.pool.rpcUrl, cfg.pool.stateView as Hex, cfg.pool.poolId as Hex)] : []
	const { input, extra: fetched } = fetchLive(nodeRuntime, cfg.venues, nowSec, cfg.sigmaEstimator === 'binance-1s', extra)
	for (const note of input.notes) nodeRuntime.log(`source dropped: ${note}`)
	const est = estimate({ ...input, estimator: cfg.sigmaEstimator })
	let poolMidE6 = 0
	if (cfg.pool.source === 'http') {
		const f = fetched[0]
		try {
			if (f === undefined) throw new Error('no response')
			if ('error' in f) throw new Error(f.error)
			poolMidE6 = Math.round(poolMidFromSqrtPriceX96(parseRpcSlot0(f.json), cfg.pool) * 1e6)
		} catch (e) {
			nodeRuntime.log(`pool read dropped: ${msg(e)}`)
		}
	}
	nodeRuntime.log(
		`node: estimator=${cfg.sigmaEstimator} sources=${est.sources.join(',')} n=${est.nSources} tEnd=${est.tEnd} sigma5=${pct(est.sigma5E9)}% sigma15=${pct(est.sigma15E9)}% disp=${est.dispBp}bp mid=${(est.venueMidE6 / 1e6).toFixed(2)} (${est.midFrom})${poolMidE6 > 0 ? ` pool=${(poolMidE6 / 1e6).toFixed(2)}` : ''}`,
	)
	return {
		sigma15E9: est.sigma15E9,
		sigma5E9: est.sigma5E9,
		dispBp: est.dispBp,
		nSources: est.nSources,
		venueMidE6: est.venueMidE6,
		poolMidE6,
	}
}

export const observationAggregation = ConsensusAggregationByFields<Observation>({
	sigma15E9: median,
	sigma5E9: median,
	dispBp: median,
	nSources: median,
	venueMidE6: median,
	poolMidE6: median,
})

function evmClientFor(cfg: Config): EVMClient {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chainSelectorName ${cfg.chainSelectorName}`)
	return new EVMClient(network.chainSelector.selector)
}

export function readDeskState(runtime: Runtime<Config>, evm: EVMClient): DeskState | null {
	try {
		const reply = evm
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: runtime.config.deskAddress as Address,
					data: encodeFunctionData({ abi: RISK_DESK_ABI, functionName: 'state' }),
				}),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result()
		const [tObs, sigma15E9, sigma5E9, devPips, kE4, flags, seq] = decodeFunctionResult({
			abi: RISK_DESK_ABI,
			functionName: 'state',
			data: bytesToHex(reply.data),
		})
		return { tObs, sigma15E9, sigma5E9, devPips, kE4, flags, seq }
	} catch (e) {
		runtime.log(`desk state unreadable: ${msg(e)}`)
		return null
	}
}

/** Pool mid from StateView on the desk's own chain (pool D on Robinhood testnet); null if unreadable. */
export function readPoolMidEvm(runtime: Runtime<Config>, evm: EVMClient): number | null {
	const cfg = runtime.config
	try {
		const reply = evm
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: cfg.pool.stateView as Address,
					data: slot0CallData(cfg.pool.poolId as Hex),
				}),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result()
		return poolMidFromSqrtPriceX96(decodeSlot0(bytesToHex(reply.data)), cfg.pool)
	} catch (e) {
		runtime.log(`pool read failed: ${msg(e)}`)
		return null
	}
}

export const onTick = (runtime: Runtime<Config>): string => {
	const cfg = runtime.config
	const tObs = Math.floor(runtime.now().getTime() / 1000)

	let obs: Observation
	try {
		obs = runtime.runInNodeMode(observe, observationAggregation)(tObs).result()
	} catch (e) {
		const m = e instanceof Error ? e.message : String(e)
		runtime.log(`clim: no report (${m})`)
		return `SKIP: ${m}`
	}
	if (obs.nSources < 3) {
		runtime.log(`clim: no report (consensus nSources=${obs.nSources} < 3)`)
		return 'SKIP: quorum'
	}

	const evm = evmClientFor(cfg)
	const poolMid = cfg.pool.source === 'evm' ? readPoolMidEvm(runtime, evm) : obs.poolMidE6 > 0 ? obs.poolMidE6 / 1e6 : null
	if (poolMid === null) runtime.log('pool mid unreadable: devPips = 0 (no directional premium)')
	const devPips = poolMid === null ? 0 : devPipsOf(obs.venueMidE6 / 1e6, poolMid)
	const report = buildReport(obs, tObs, devPips, cfg.kE4)
	runtime.log(
		`consensus: sigma5=${pct(report.sigma5E9)}%/yr sigma15=${pct(report.sigma15E9)}%/yr sigma5E9=${report.sigma5E9} sigma15E9=${report.sigma15E9} n=${report.nSources} disp=${report.dispBp}bp venue=${(obs.venueMidE6 / 1e6).toFixed(2)} pool=${poolMid === null ? 'n/a' : poolMid.toFixed(2)} dev=${report.devPips}pips tObs=${report.tObs}`,
	)

	const prev = readDeskState(runtime, evm)
	if (prev !== null) {
		runtime.log(`desk before: seq=${prev.seq} tObs=${prev.tObs} sigma5=${pct(prev.sigma5E9)}%/yr dev=${prev.devPips} flags=${prev.flags}`)
		if (prev.tObs > 0 && report.tObs < prev.tObs + MIN_GAP_SEC) {
			runtime.log(`clim: no report (${report.tObs - prev.tObs} s since the last report < ${MIN_GAP_SEC} s)`)
			return 'SKIP: min gap'
		}
	}

	const signed = runtime.report(prepareReportRequest(encodeRiskReport(report))).result()
	const reply = evm.writeReport(runtime, { receiver: cfg.deskAddress, report: signed, gasConfig: { gasLimit: cfg.gasLimit } }).result()
	const txHash = bytesToHex(reply.txHash ?? new Uint8Array(32))
	if (reply.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: status=${reply.txStatus} ${reply.errorMessage ?? ''} tx=${txHash}`)
	}
	// Exact line parsed by bots/src/lib/simParse.ts (the CRE docs and templates format).
	runtime.log(`Write report transaction succeeded: ${txHash}`)
	if (reply.receiverContractExecutionStatus === EVM_PB.ReceiverContractExecutionStatus.REVERTED) {
		runtime.log(`REJECTED by RiskDesk (onReport reverted) tx=${txHash}`)
		return `REJECTED ${txHash}`
	}
	if (/^0x0+$/.test(txHash)) {
		runtime.log(`DRY RUN: report encoded and simulated, not broadcast (sigma5E9=${report.sigma5E9} dev=${report.devPips})`)
		return 'DRY RUN'
	}
	// Forwarders never revert when the receiver reverts, and the simulator then still reports receiver SUCCESS:
	// re-read the desk to know if it applied.
	const after = readDeskState(runtime, evm)
	if (after === null) {
		runtime.log(`REPORT sent, desk state unreadable after tx=${txHash}`)
		return `SENT ${txHash}`
	}
	if (after.tObs === report.tObs) {
		runtime.log(
			`REPORT applied seq=${after.seq} sigma5Reported=${pct(report.sigma5E9)}% sigma5Applied=${pct(after.sigma5E9)}% dev=${after.devPips} flags=${after.flags} tx=${txHash}`,
		)
		return `OK ${txHash}`
	}
	runtime.log(
		`NOT APPLIED: RiskDesk state unchanged at the latest block after tx=${txHash} (rejected inside the forwarder, or the RPC read lagged: check ReportProcessed)`,
	)
	return `NOT_APPLIED ${txHash}`
}

export const onCron = (runtime: Runtime<Config>, _payload: CronPayload): string => onTick(runtime)
export const onHttp = (runtime: Runtime<Config>, _payload: HTTPPayload): string => onTick(runtime)

export function initWorkflow(config: Config) {
	const cron = new CronCapability()
	const http = new HTTPCapability()
	return [
		handler(cron.trigger({ schedule: config.schedule }), onCron),
		handler(
			http.trigger({
				authorizedKeys: config.httpAuthorizedKeys.map((publicKey) => ({ type: 'KEY_TYPE_ECDSA_EVM' as const, publicKey })),
			}),
			onHttp,
		),
	]
}
```

In the shadow test, `expected()` is given the pool mid rounded to 1e-6 (`Math.round(fablesMid * 1e6) / 1e6`) because the node returns `poolMidE6` as an integer and `onTick` divides it back; in EVM mode the mid is used unrounded.

- [ ] **Step 4: Write the configs and targets**

Create `cre/risk-desk/config.testnet.json` (Task 16 Step 6 fills the desk and pool from the deployments):

```json
{
  "schedule": "*/30 * * * * *",
  "deskAddress": "0x000000000000000000000000000000000000dEaD",
  "chainSelectorName": "robinhood-testnet",
  "gasLimit": "1000000",
  "venues": ["coinbase", "kraken", "binance", "hyperliquid"],
  "sigmaEstimator": "median-close",
  "kE4": 10000,
  "pool": {
    "source": "evm",
    "rpcUrl": "",
    "stateView": "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    "poolId": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "token0IsEth": true,
    "decimals0": 18,
    "decimals1": 6
  },
  "httpAuthorizedKeys": []
}
```

Create `cre/risk-desk/config.shadow.json` (dry run only: the desk is a placeholder, and the pool is Fables' ETH/USDG on mainnet, native ETH token0, read over HTTP):

```json
{
  "schedule": "*/30 * * * * *",
  "deskAddress": "0x000000000000000000000000000000000000dEaD",
  "chainSelectorName": "robinhood-testnet",
  "gasLimit": "1000000",
  "venues": ["coinbase", "kraken", "binance", "hyperliquid"],
  "sigmaEstimator": "median-close",
  "kE4": 10000,
  "pool": {
    "source": "http",
    "rpcUrl": "https://rpc.mainnet.chain.robinhood.com",
    "stateView": "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    "poolId": "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551",
    "token0IsEth": true,
    "decimals0": 18,
    "decimals1": 6
  },
  "httpAuthorizedKeys": []
}
```

Replace `cre/risk-desk/config.production.json` with the content of `config.testnet.json` (a DON target; its desk stays the placeholder until DON deploy access exists and a DON desk is deployed with the KeystoneForwarder).

Delete the v1 configs: `git rm cre/risk-desk/config.staging.json cre/risk-desk/config.replay.json`.

Replace `cre/risk-desk/workflow.yaml` with:

```yaml
# clim risk-desk workflow settings, one block per target of ../project.yaml (plan 03).
rh-testnet-settings:
  user-workflow:
    workflow-name: "clim-desk-rh-testnet"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.testnet.json"
    secrets-path: ""
rh-shadow-settings:
  user-workflow:
    workflow-name: "clim-desk-rh-shadow"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.shadow.json"
    secrets-path: ""
rh-production-settings:
  user-workflow:
    workflow-name: "clim-desk-rh"
    deployment-registry: "private"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.production.json"
    secrets-path: ""
```

Replace `cre/project.yaml` with:

```yaml
# clim × Fables CRE project settings (cre CLI >= 1.37). Every target must also exist in risk-desk/workflow.yaml.
# rh-testnet-settings: the live desk on Robinhood Chain testnet (simulation with --broadcast, MockKeystoneForwarder).
# rh-shadow-settings: dry run only; devPips against Fables' mainnet ETH/USDG pool, read over HTTP (never a write).
# rh-production-settings: a DON target (KeystoneForwarder); unused until DON deploy access is granted.
# The Sepolia v1 targets live at tag token2049-submission.
rh-testnet-settings:
  rpcs:
    - chain-name: robinhood-testnet
      url: https://rpc.testnet.chain.robinhood.com
rh-shadow-settings:
  rpcs:
    - chain-name: robinhood-testnet
      url: https://rpc.testnet.chain.robinhood.com
rh-production-settings:
  rpcs:
    - chain-name: robinhood-testnet
      url: https://rpc.testnet.chain.robinhood.com
```

- [ ] **Step 5: Replace the config sync**

Replace `cre/risk-desk/scripts/sync-config.ts` with:

```ts
// Copies the testnet desk, pool D and the token order from shared/deployments/robinhood-testnet.json (plan 03 Task 12)
// and the estimator from shared/params-fables.json into the workflow configs.
// Usage (from cre/risk-desk): bun scripts/sync-config.ts
import { readFileSync, writeFileSync } from 'node:fs'

const DEPLOYMENTS = process.env.DEPLOYMENTS ?? '../../shared/deployments/robinhood-testnet.json'
const PARAMS = process.env.PARAMS ?? '../../shared/params-fables.json'

type Json = Record<string, unknown>
const dep = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')) as Json
const params = JSON.parse(readFileSync(PARAMS, 'utf8')) as Json
const get = (o: Json, path: string): unknown =>
	path.split('.').reduce<unknown>((x, k) => (typeof x === 'object' && x !== null ? (x as Json)[k] : undefined), o)
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)

const desk = get(dep, 'riskDesk')
const poolId = get(dep, 'pools.D.poolId')
const token0IsEth = get(dep, 'pools.D.token0IsEth')
const estimator = get(params, 'sigmaEstimator')
if (!isAddr(desk) || typeof poolId !== 'string' || typeof token0IsEth !== 'boolean') {
	throw new Error(`${DEPLOYMENTS}: riskDesk, pools.D.poolId or pools.D.token0IsEth missing`)
}
if (typeof estimator !== 'string') throw new Error(`${PARAMS}: sigmaEstimator missing (plan 03 Task 2)`)

function update(file: string, f: (cfg: Json) => void): void {
	const cfg = JSON.parse(readFileSync(file, 'utf8')) as Json
	f(cfg)
	writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`)
}

update('config.testnet.json', (cfg) => {
	cfg.deskAddress = desk
	cfg.sigmaEstimator = estimator
	const pool = cfg.pool as Json
	pool.poolId = poolId
	pool.token0IsEth = token0IsEth
	pool.decimals0 = token0IsEth ? 18 : 6
	pool.decimals1 = token0IsEth ? 6 : 18
})
for (const file of ['config.shadow.json', 'config.production.json']) {
	update(file, (cfg) => {
		cfg.sigmaEstimator = estimator
	})
}
console.log(`config.testnet.json: deskAddress=${desk} pool D=${poolId} token0IsEth=${token0IsEth} sigmaEstimator=${estimator}`)
console.log(`config.shadow.json, config.production.json: sigmaEstimator=${estimator}`)
```

- [ ] **Step 6: Sync, test, typecheck, build**

Run:

```bash
cd cre/risk-desk && bun scripts/sync-config.ts && bun test && bun run typecheck && cd .. && cre workflow build ./risk-desk -o ./risk-desk/binary.wasm
```

Expected: the two `config...` lines from the sync with the deployed desk and pool D; `0 fail` across `abi-sync`, `estimator`, `pool`, `report`, `venues` and `workflow` tests; `tsc` exits 0; the build prints the CLI's success line and writes `risk-desk/binary.wasm` (gitignored).

- [ ] **Step 7: Commit**

```bash
git add cre/project.yaml cre/risk-desk/workflow.ts cre/risk-desk/workflow.test.ts cre/risk-desk/workflow.yaml cre/risk-desk/config.testnet.json cre/risk-desk/config.shadow.json cre/risk-desk/config.production.json cre/risk-desk/scripts/sync-config.ts
git commit -m "feat(cre): desk v2 workflow on robinhood-testnet, pool D read on-chain, shadow target on Fables' mainnet pool" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

(`git rm` in Step 4 already staged the two deleted configs.)

### Task 17: First reports on Robinhood Chain testnet, and the friction log

This task broadcasts to Robinhood Chain testnet with the CRE operator key (a testnet key).

- [ ] **Step 1: Fund the CRE operator**

Run (one command):

```bash
cd contracts && set -a && source .env && set +a && OP=$(cd ../bots && bun run --silent live:keys --exports | sed -n 's/^export SIM_OPERATOR=//p') \
  && cast send "$OP" --value 0.1ether --private-key "$PRIVATE_KEY" --rpc-url https://rpc.testnet.chain.robinhood.com --json | jq '{status, transactionHash}' \
  && cast balance "$OP" --ether --rpc-url https://rpc.testnet.chain.robinhood.com
```

Expected: `"status": "0x1"` and `0.100000000000000000`.

- [ ] **Step 2: Dry run on the testnet target**

Run: `cd cre && TZ=UTC cre workflow simulate risk-desk --wasm "$PWD/risk-desk/binary.wasm" --non-interactive --trigger-index 0 --target rh-testnet-settings 2>&1 | grep -E "USER LOG|rror|✗"`
Expected: a `node: estimator=<chosen> sources=coinbase,kraken,binance,hyperliquid n=4 ...` line, a `consensus: sigma5=...%/yr ... pool=<D's price> dev=<n>pips ...` line, `desk before: seq=0 ...`, `Write report transaction succeeded: 0x000…000` and `DRY RUN: ...`. If the CLI rejects `robinhood-testnet` (unknown chain, no forwarder), stop: write a friction-log row with the exact message (Step 6) and report to the maintainer; the desk cannot run in simulation on this chain until the CLI supports it.

- [ ] **Step 3: Dry run on the shadow target**

Run: `cd cre && TZ=UTC cre workflow simulate risk-desk --wasm "$PWD/risk-desk/binary.wasm" --non-interactive --trigger-index 0 --target rh-shadow-settings 2>&1 | grep -E "USER LOG|rror|✗"`
Expected: the `node:` line ends with ` pool=<about Fables' current ETH/USDG price>`; `consensus: ... pool=<same> dev=<n>pips`; `desk state unreadable` (the placeholder desk has no code) and `DRY RUN`. Nothing is sent to any chain.

- [ ] **Step 4: One report, broadcast**

Run: `cd cre && TZ=UTC cre workflow simulate risk-desk --wasm "$PWD/risk-desk/binary.wasm" --non-interactive --trigger-index 0 --target rh-testnet-settings --broadcast 2>&1 | grep -E "USER LOG|rror|✗"`
Expected: `Write report transaction succeeded: 0x<hash>` and `REPORT applied seq=1 sigma5Reported=...% sigma5Applied=...% dev=<n> flags=0 tx=0x<hash>`. Check it on-chain:

```bash
DESK=$(jq -r .riskDesk shared/deployments/robinhood-testnet.json)
cast call "$DESK" 'state()(uint40,uint32,uint32,int32,uint16,uint8,uint32)' --rpc-url https://rpc.testnet.chain.robinhood.com
cast receipt <hash> --rpc-url https://rpc.testnet.chain.robinhood.com --json | jq '{status, gasUsed, gasUsedForL1, effectiveGasPrice}'
```

Expected: `seq` = 1, the reported `tObs`; the receipt with `status` `0x1` and its gas (the first report gas figure for Task 25).

- [ ] **Step 5: Run the loop for two minutes**

Run: `cd cre && perl -e 'alarm shift; exec @ARGV' 130 scripts/sim-loop.sh rh-testnet-settings --broadcast` (macOS has no `timeout`; the alarm ends the loop after 130 s, with exit code 142, which is expected).
Expected: four `=== <time>` blocks, each with `REPORT applied seq=<2..5>`; then `cast call "$DESK" 'state()(uint40,uint32,uint32,int32,uint16,uint8,uint32)' --rpc-url https://rpc.testnet.chain.robinhood.com` shows `seq` 5 (or 4 if a run lost its final line, friction row 22; the receipt decides).

- [ ] **Step 6: Update the friction log**

In `docs/feedback/cre-friction-log.md`:
- In row 7 (Network coverage), replace the status cell with: `` `hit` (plan 03, <date>): `cre workflow simulate --broadcast` runs on `robinhood-testnet` with CLI v1.37.0 and SDK 1.23.0 (chain selector 2032988798112970440, MockKeystoneForwarder `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885`); first report tx `<hash from Step 4>`. Mainnet (`robinhood-mainnet`) is in the SDK's selector list but has no forwarder for writes yet ``.
- Change the **Environment** line's target to `targets ethereum-testnet-sepolia (v1) and robinhood-testnet (plan 03)`.
- Append one row per new friction met in Steps 2 to 5, numbered from 28, each with what was tried, the exact CLI output, the suggestion and the status `confirmed`. Candidates to watch for: the simulator's handling of Arbitrum receipts (`gasUsedForL1`), the public RPC answering 429 inside a run (the misleading limit hint of row 27), the HTTP capability's body for a JSON-RPC POST. One is already known from writing this plan: `cre workflow simulate --wasm <path>` fails with `✗ validation error` and `--wasm must be a maximum of 97 characters in length` when the absolute path is longer than 97 characters (seen with a deep temporary folder; this repository's path is 70 characters, so `sim-loop.sh` is not affected); add it as a row (status `confirmed`, suggestion: lift the limit or say so in `--help`). If no other friction occurred, say so in the session log.

- [ ] **Step 7: Rewrite `cre/README.md`**

Replace `cre/README.md` with:

````markdown
# clim risk desk v2 (Chainlink CRE workflow)

The CRE half of clim × Fables. Every 30 seconds the desk measures ETH volatility over 5 and 15 minutes on four venues
and the gap between the venue price and a target Uniswap v4 pool, takes the median of each field across nodes with the
CRE consensus API, and writes a report to `RiskDeskV2.onReport` on Robinhood Chain testnet. `ClimFeePolicy` turns it
into a fee and `ClimPoker` posts it to pool D's hook (see `docs/runbook.md`, section 8). The Sepolia v1 of this
workflow is frozen at tag `token2049-submission`.

## What one execution does

1. **Trigger.** Cron `*/30 * * * * *` (handler 0) or an HTTP trigger (handler 1); both run `onTick`. Each
   `cre workflow simulate` run fires the cron handler once; `scripts/sim-loop.sh` repeats it every 30 s.
2. **Observe, on every node** (8 to 10 HTTP calls, sent at once): 1-minute candles (close, high, low) and a live
   ticker from Coinbase, Kraken (its ticker also gives USDT/USD), Binance (USDT, converted) and Hyperliquid; Binance
   1 s klines when the estimator is `binance-1s`; in shadow mode, an `eth_call` of `StateView.getSlot0` on Robinhood
   Chain mainnet for Fables' ETH/USDG pool.
3. **Estimate** (`estimator.ts`, pure): a venue counts if its last closed candle is at most 120 s old; at least 3 must
   count, otherwise no report. `sigma15E9` and `sigma5E9` come from the estimator named by `sigmaEstimator` (synced
   from `shared/params-fables.json`, chosen by the lab in plan 03 Task 2): `median-close` (realized volatility of
   the cross-venue median close), `venue-range` (median of each venue's Parkinson volatility on its 1-minute high and
   low) or `binance-1s` (5 s returns of Binance 1 s closes, the lab's estimator). `dispBp` is the farthest venue from
   the median close (DEGRADED above 25 bp). The venue mid is the median of the tickers (the median close if fewer
   than 3 answer).
4. **Consensus.** `ConsensusAggregationByFields` with `median` on every field.
5. **Pool and gap.** `pool.source = "evm"` reads pool D's `getSlot0` on Robinhood testnet with the EVM capability;
   `"http"` uses the node-mode read of step 2. `devPips = (venue mid - pool mid) / pool mid x 1e6`, 0 if the pool
   cannot be read (no directional premium).
6. **Write and confirm.** `tObs` is DON time; the workflow skips if the desk's last report is under 20 s old, writes
   `abi.encode(uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 dispBp, uint8 nSources,
   uint16 kE4)`, then re-reads `RiskDeskV2.state()` and returns `OK`, `NOT_APPLIED`, `SENT`, `REJECTED`, `DRY RUN`
   or `SKIP: <reason>`.

## Targets

| Target | Config | Desk | Pool for devPips |
|---|---|---|---|
| `rh-testnet-settings` | `config.testnet.json` | the testnet `RiskDeskV2` (simulation, `MockKeystoneForwarder` `0x0b93…3885`) | pool D on Robinhood testnet (EVM read) |
| `rh-shadow-settings` | `config.shadow.json` | placeholder `0x…dEaD`: dry run only | Fables' ETH/USDG on Robinhood mainnet (JSON-RPC read, never a write) |
| `rh-production-settings` | `config.production.json` | placeholder until a DON desk exists (`KeystoneForwarder` `0x8E6E…AF19`) | pool D |

## Trust model

In simulation one node runs and the CRE operator key (`cre/.env`, the desk's `simOperator`) sends every report
through the mock forwarder, which checks no signature: `RiskDeskV2` accepts only reports whose `tx.origin` is that
key. On a DON, the owner pins the workflow, calls `disableSim(KeystoneForwarder)`, and hands ownership to a timelock
or renounces it. DON deploy access is still pending, so the desk runs in the simulator.

## Run it

```bash
cd cre/risk-desk && bun install && bun scripts/sync-config.ts && bun test && bun run typecheck && cd ..
cre workflow build ./risk-desk -o ./risk-desk/binary.wasm
cre workflow simulate risk-desk --wasm "$PWD/risk-desk/binary.wasm" --non-interactive --trigger-index 0 --target rh-testnet-settings   # dry run
cre workflow simulate risk-desk --wasm "$PWD/risk-desk/binary.wasm" --non-interactive --trigger-index 0 --target rh-shadow-settings    # shadow, dry run
scripts/sim-loop.sh rh-testnet-settings --broadcast   # the live loop (bots: bun run live:desk records it)
```

## Files

| Path | Role |
|---|---|
| `project.yaml`, `risk-desk/workflow.yaml` | Targets and their RPC (`robinhood-testnet`) |
| `risk-desk/workflow.ts` | Triggers, node-mode observation, consensus, pool read, report, write, confirmation |
| `risk-desk/venues.ts` | Venue requests and parsers (candles, tickers, Binance 1 s), concurrent fetch |
| `risk-desk/estimator.ts` | Pure estimator: staleness, quorum, the three sigma estimators, dispersion, venue mid |
| `risk-desk/pool.ts` | Pool mid from `StateView.getSlot0`, devPips, the JSON-RPC request |
| `risk-desk/report.ts` | Report ABI v2, encoder and decoder, `RiskDeskV2.state()` ABI |
| `risk-desk/scripts/sync-config.ts` | Desk, pool D and estimator from `shared/` into the configs |
| `scripts/sim-loop.sh` | The 30 s simulation loop |
````

- [ ] **Step 8: Record and commit**

Append to the session log: the dry-run lines (estimator, sigma5, venue mid, pool D price, devPips), the shadow dry run's Fables pool price and devPips, the first report tx and its gas, and the two-minute loop result. Then:

```bash
git add docs/feedback/cre-friction-log.md cre/README.md docs/sessions/
git commit -m "feat(cre): first desk v2 reports on Robinhood Chain testnet, friction log and README" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

## Part D: the live bots

All live bots live under `bots/src/live/` and reuse v1's pure modules (`bots/src/lib/arb.ts`, `market.ts`, `rng.ts`, `swap.ts`, `jsonl.ts`, `simParse.ts`, `env.ts`) unchanged. Their logs go to `bots/out/*-rh.jsonl` and `bots/out/desk-runs.jsonl` (gitignored). Their `package.json` scripts are named `live:*`, so no command line contains `--pair live`. Task 23 puts the long-running ones under launchd and adds their outage handling.

### Task 18: Live bot library (env, deployments, chain reads, log tail, chunked logs)

**Files:**
- Create: `bots/src/live/lib/env.ts`, `bots/src/live/lib/deployments.ts`, `bots/src/live/lib/chain.ts`, `bots/src/live/lib/tail.ts`
- Test: `bots/test/live/env.test.ts`, `bots/test/live/tail.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `bots/test/live/env.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_RH_TESTNET_RPC_URL, liveKey, liveRpcUrl } from "../../src/live/lib/env";

const KEY = `0x${"2".repeat(64)}` as const;

describe("live env", () => {
  test("public testnet RPC unless RH_TESTNET_RPC_URL is set", () => {
    expect(liveRpcUrl({})).toBe(DEFAULT_RH_TESTNET_RPC_URL);
    expect(liveRpcUrl({ RH_TESTNET_RPC_URL: "http://127.0.0.1:8545" })).toBe("http://127.0.0.1:8545");
  });
  test("one key per role, checked", () => {
    expect(liveKey("runner", { RUNNER_PRIVATE_KEY: KEY })).toBe(KEY);
    expect(liveKey("arb", { ARB_RH_PRIVATE_KEY: KEY })).toBe(KEY);
    expect(() => liveKey("keeper", {})).toThrow(/KEEPER_PRIVATE_KEY/);
  });
});
```

Create `bots/test/live/tail.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkedRanges, lastLine, lastTs } from "../../src/live/lib/tail";

describe("log tail", () => {
  test("last non-empty line, read from the end", () => {
    const dir = mkdtempSync(join(tmpdir(), "clim-tail-"));
    const f = join(dir, "x.jsonl");
    writeFileSync(f, `${"x".repeat(100_000)}\n{"ts":"2026-10-14T00:00:00Z"}\n{"ts":"2026-10-14T00:00:30Z","a":1}\n\n`);
    expect(lastLine(f, 1_000)).toBe('{"ts":"2026-10-14T00:00:30Z","a":1}');
    expect(lastTs(f)).toBe("2026-10-14T00:00:30Z");
    expect(lastLine(join(dir, "missing.jsonl"))).toBeNull();
  });
});

describe("block ranges for getLogs", () => {
  test("inclusive chunks covering [from, to]", () => {
    expect(chunkedRanges(100n, 104n, 2n)).toEqual([
      [100n, 101n],
      [102n, 103n],
      [104n, 104n],
    ]);
    expect(chunkedRanges(5n, 4n, 2n)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd bots && bun test test/live/env.test.ts test/live/tail.test.ts`
Expected: FAIL with `Cannot find module '../../src/live/lib/env'`.

- [ ] **Step 3: Implement**

Create `bots/src/live/lib/env.ts`:

```ts
// Environment of the live bots (Robinhood Chain testnet, plan 03). Bun loads bots/.env when commands run from bots/.
import type { Hex } from "viem";
import { envStr, privateKeyFromEnv } from "../../lib/env";

type Env = Record<string, string | undefined>;

export const DEFAULT_RH_TESTNET_RPC_URL = "https://rpc.testnet.chain.robinhood.com";

/** One key per role so concurrent processes never share a nonce (`bun run live:keys` creates them). */
export const LIVE_KEYS = {
  deployer: "DEPLOYER_PRIVATE_KEY",
  runner: "RUNNER_PRIVATE_KEY",
  keeper: "KEEPER_PRIVATE_KEY",
  arb: "ARB_RH_PRIVATE_KEY",
  noise: "NOISE_RH_PRIVATE_KEY",
} as const;
export type LiveRole = keyof typeof LIVE_KEYS;

export function liveRpcUrl(env: Env = process.env): string {
  return envStr("RH_TESTNET_RPC_URL", DEFAULT_RH_TESTNET_RPC_URL, env);
}

export function liveKey(role: LiveRole, env: Env = process.env): Hex {
  return privateKeyFromEnv(LIVE_KEYS[role], env);
}
```

Create `bots/src/live/lib/deployments.ts`:

```ts
// Loads shared/deployments/robinhood-testnet.json (plan 03 Task 12) through the shared parser.
import { parseLiveDeployments, type LiveDeployments } from "@clim/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
export const LIVE_DEPLOYMENTS_PATH = join(REPO_ROOT, "shared", "deployments", "robinhood-testnet.json");

export function loadLiveDeployments(path: string = LIVE_DEPLOYMENTS_PATH): LiveDeployments {
  return parseLiveDeployments(JSON.parse(readFileSync(path, "utf8")));
}
```

Create `bots/src/live/lib/tail.ts`:

```ts
// Small helpers for the status and verification scripts: the last line of a large log, and block ranges for getLogs
// (RPCs cap the range of one eth_getLogs call; Robinhood Chain makes about 10 blocks per second).
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";

/** The last non-empty line of a file, reading at most maxBytes from its end. */
export function lastLine(path: string, maxBytes = 65_536): string | null {
  if (!existsSync(path)) return null;
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n").filter((l) => l.trim() !== "");
    return lines[lines.length - 1] ?? null;
  } finally {
    closeSync(fd);
  }
}

/** `ts` of the last JSON line of a log, or null. */
export function lastTs(path: string): string | null {
  const line = lastLine(path);
  if (line === null) return null;
  try {
    const o = JSON.parse(line) as { ts?: unknown };
    return typeof o.ts === "string" ? o.ts : null;
  } catch {
    return null;
  }
}

/** Inclusive [from, to] ranges of at most `chunk` blocks covering [fromBlock, toBlock]. */
export function chunkedRanges(fromBlock: bigint, toBlock: bigint, chunk = 2_000n): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let a = fromBlock; a <= toBlock; a += chunk) {
    const b = a + chunk - 1n;
    out.push([a, b < toBlock ? b : toBlock]);
  }
  return out;
}
```

Create `bots/src/live/lib/chain.ts`:

```ts
// viem clients on Robinhood Chain testnet and the reads shared by the live bots and scripts.
import {
  climFeePolicyAbi,
  ethUsdFromSqrtPriceX96,
  liveOrientation,
  pokeFeeHookAbi,
  riskDeskV2Abi,
  stateViewAbi,
  testTokenAbi,
  type LiveDeployments,
  type LivePoolName,
} from "@clim/shared";
import { createPublicClient, createWalletClient, http, nonceManager, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodTestnet } from "viem/chains";
import { liveRpcUrl } from "./env";

export function liveClient(url: string = liveRpcUrl()) {
  return createPublicClient({ chain: robinhoodTestnet, transport: http(url) });
}
export type LiveClient = ReturnType<typeof liveClient>;

/** nonceManager lets one process send several transactions without waiting for receipts. */
export function liveWallet(privateKey: Hex, url: string = liveRpcUrl()) {
  return createWalletClient({ account: privateKeyToAccount(privateKey, { nonceManager }), chain: robinhoodTestnet, transport: http(url) });
}
export type LiveWallet = ReturnType<typeof liveWallet>;

export type DeskV2State = { tObs: number; sigma15E9: number; sigma5E9: number; devPips: number; kE4: number; flags: number; seq: number };
export type LivePoolState = { sqrtPriceX96: bigint; ethUsd: number; fee0For1: number; fee1For0: number };
export type LiveState = {
  pools: Record<LivePoolName, LivePoolState>;
  desk: DeskV2State;
  policy: { fee0For1: number; fee1For0: number; mode: number };
};

/** One multicall: slot0 and both directions' current fee of D, K and F, the desk's state and the policy's quote. */
export async function readLiveState(client: LiveClient, d: LiveDeployments, blockNumber?: bigint): Promise<LiveState> {
  const sv = d.uniswap.stateView;
  const [sD, aD, bD, sK, aK, bK, sF, aF, bF, st, q] = await client.multicall({
    allowFailure: false,
    blockNumber,
    contracts: [
      { address: sv, abi: stateViewAbi, functionName: "getSlot0", args: [d.pools.D.poolId] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.D.poolId, true] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.D.poolId, false] },
      { address: sv, abi: stateViewAbi, functionName: "getSlot0", args: [d.pools.K.poolId] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.K.poolId, true] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.K.poolId, false] },
      { address: sv, abi: stateViewAbi, functionName: "getSlot0", args: [d.pools.F.poolId] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.F.poolId, true] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.F.poolId, false] },
      { address: d.riskDesk, abi: riskDeskV2Abi, functionName: "state" },
      { address: d.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional" },
    ],
  });
  const pool = (name: LivePoolName, slot0: readonly [bigint, number, number, number], f01: number, f10: number): LivePoolState => ({
    sqrtPriceX96: slot0[0],
    ethUsd: ethUsdFromSqrtPriceX96(slot0[0], liveOrientation(d, d.pools[name])),
    fee0For1: f01,
    fee1For0: f10,
  });
  return {
    pools: { D: pool("D", sD, aD, bD), K: pool("K", sK, aK, bK), F: pool("F", sF, aF, bF) },
    desk: { tObs: st[0], sigma15E9: st[1], sigma5E9: st[2], devPips: st[3], kE4: st[4], flags: st[5], seq: st[6] },
    policy: { fee0For1: q[0], fee1For0: q[1], mode: q[2] },
  };
}

/** Testnet ETH for gas, tETH and tUSDG, and their allowances to the router the key swaps through. */
export type LiveBalances = { native: bigint; tETH: bigint; tUSDG: bigint; tETHAllowance: bigint; tUSDGAllowance: bigint };

export async function readLiveBalances(client: LiveClient, d: LiveDeployments, owner: Address, spender: Address): Promise<LiveBalances> {
  const [tETH, tUSDG, tETHAllowance, tUSDGAllowance] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: d.tokens.tETH.address, abi: testTokenAbi, functionName: "balanceOf", args: [owner] },
      { address: d.tokens.tUSDG.address, abi: testTokenAbi, functionName: "balanceOf", args: [owner] },
      { address: d.tokens.tETH.address, abi: testTokenAbi, functionName: "allowance", args: [owner, spender] },
      { address: d.tokens.tUSDG.address, abi: testTokenAbi, functionName: "allowance", args: [owner, spender] },
    ],
  });
  const native = await client.getBalance({ address: owner });
  return { native, tETH, tUSDG, tETHAllowance, tUSDGAllowance };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd bots && bun test test/live && bun run typecheck`
Expected: `0 fail` (env 2, tail 2, envfile 4) and `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add bots/src/live/lib/env.ts bots/src/live/lib/deployments.ts bots/src/live/lib/chain.ts bots/src/live/lib/tail.ts bots/test/live/env.test.ts bots/test/live/tail.test.ts
git commit -m "feat(bots): live library for Robinhood testnet, clients, multicall reads, log tail" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 19: The desk loop recorder and the runner

**Files:**
- Create: `bots/src/live/lib/runner.ts`, `bots/src/live/desk-loop.ts`, `bots/src/live/runner.ts`
- Modify: `bots/package.json`
- Test: `bots/test/live/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `bots/test/live/runner.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { FeeMode } from "@clim/shared";
import { pokeDecision } from "../../src/live/lib/runner";

describe("when the runner pokes", () => {
  test("once per new desk report", () => {
    expect(pokeDecision(0, 0, FeeMode.Normal)).toBe("wait"); // no report yet
    expect(pokeDecision(5, 4, FeeMode.Normal)).toBe("poke");
    expect(pokeDecision(5, 5, FeeMode.Normal)).toBe("wait");
    expect(pokeDecision(9, 5, FeeMode.Degraded)).toBe("poke"); // degraded still pokes (at least the safe fee)
  });
  test("never on a blind desk (ClimPoker would revert DeskBlind)", () => {
    expect(pokeDecision(6, 5, FeeMode.Blind)).toBe("blind");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd bots && bun test test/live/runner.test.ts`
Expected: FAIL with `Cannot find module '../../src/live/lib/runner'`.

- [ ] **Step 3: Implement**

Create `bots/src/live/lib/runner.ts`:

```ts
import { FeeMode } from "@clim/shared";

export type PokeDecision = "wait" | "poke" | "blind";

/** Poke once per new desk report; never on a blind desk (ClimPoker reverts DeskBlind and the pool keeps its last
 *  override until it expires, then its flat fee). A degraded desk still pokes: the policy quotes at least the safe fee. */
export function pokeDecision(seq: number, lastPokedSeq: number, mode: number): PokeDecision {
  if (seq === 0 || seq <= lastPokedSeq) return "wait";
  return mode === FeeMode.Blind ? "blind" : "poke";
}
```

Create `bots/src/live/runner.ts`:

```ts
// clim's runner on Robinhood Chain testnet (CLIM_RUNNER on our AccessManager): after each new desk report, call
// ClimPoker.poke() so pool D's fee follows clim's policy. The fee comes from the policy, never from this key.
// Usage: bun src/live/runner.ts     Log: bots/out/runner-rh.jsonl     Env: RUNNER_POLL_MS (default 2000)
import { climFeePolicyAbi, climPokerAbi, riskDeskV2Abi } from "@clim/shared";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { liveClient, liveWallet } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { pokeDecision } from "./lib/runner";

const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("runner"));
const logFile = join(OUT_DIR, "runner-rh.jsonl");
let lastSeq = 0;

async function tick(): Promise<void> {
  const [st, q] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: d.riskDesk, abi: riskDeskV2Abi, functionName: "state" },
      { address: d.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional" },
    ],
  });
  const seq = st[6];
  const decision = pokeDecision(seq, lastSeq, q[2]);
  if (decision === "wait") return;
  const base = { ts: new Date().toISOString(), seq, tObs: st[0], quote0For1: q[0], quote1For0: q[1], mode: q[2] };
  if (decision === "blind") {
    appendJsonl(logFile, { ...base, action: "skip", reason: "desk blind" });
    console.log(`[runner] seq ${seq}: desk blind, no poke`);
    lastSeq = seq;
    return;
  }
  try {
    const { request } = await client.simulateContract({ account: wallet.account, address: d.poker, abi: climPokerAbi, functionName: "poke" });
    const hash = await wallet.writeContract(request);
    const r = await client.waitForTransactionReceipt({ hash });
    const ev = parseEventLogs({ abi: climPokerAbi, eventName: "Poked", logs: r.logs })[0]?.args;
    appendJsonl(logFile, {
      ...base,
      action: "poke",
      txHash: hash,
      status: r.status,
      block: r.blockNumber,
      gasUsed: r.gasUsed,
      effectiveGasPrice: r.effectiveGasPrice,
      fee0For1: ev?.fee0For1 ?? null,
      fee1For0: ev?.fee1For0 ?? null,
      eventApplied: ev?.eventApplied ?? null,
      expiry: ev?.expiry ?? null,
    });
    console.log(`[runner] seq ${seq} poked ${ev?.fee0For1}/${ev?.fee1For0} pips, tx ${hash}, gas ${r.gasUsed}`);
    lastSeq = seq;
  } catch (e) {
    appendJsonl(logFile, { ...base, action: "error", error: shortError(e) });
    console.error(`[runner] seq ${seq} poke failed: ${shortError(e)}`);
  }
}

let busy = false;
console.log(`[runner] ${wallet.account.address} pokes ${d.poker} (pool D ${d.pools.D.poolId}) after each report of ${d.riskDesk}`);
setInterval(() => {
  if (busy) return;
  busy = true;
  tick()
    .catch((e: unknown) => console.error(`[runner] ${shortError(e)}`))
    .finally(() => {
      busy = false;
    });
}, envNum("RUNNER_POLL_MS", 2_000));
```

Create `bots/src/live/desk-loop.ts`:

```ts
// The live desk loop with an on-chain record of every run (Robinhood Chain testnet, plan 03).
// Runs cre/scripts/sim-loop.sh <target> --broadcast (build the WASM once, then `cre workflow simulate` every 30 s) and
// echoes its output. For each run it writes the transcript to bots/out/desk-sim/<run start>.log and appends one line to
// bots/out/desk-runs.jsonl: status, tx hash, receipt and gas, the forwarder's ReportProcessed.result and the decoded
// RiskReportedV2. The receipt decides `applied` (simParse.receiptStatus).
// Usage: bun src/live/desk-loop.ts [--target rh-testnet-settings] [--once]
import { mockForwarderAbi, riskDeskV2Abi } from "@clim/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { argValue, envStr, hasFlag } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { loopCommand, receiptStatus, RunTracker, type RunResult } from "../lib/simParse";
import { liveClient } from "./lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "./lib/deployments";

const target = argValue("--target") ?? "rh-testnet-settings";
const once = hasFlag("--once");
const creDir = envStr("CRE_PROJECT_DIR", join(REPO_ROOT, "cre"));
const d = loadLiveDeployments();
const client = liveClient();
const runsFile = join(OUT_DIR, "desk-runs.jsonl");
const transcriptDir = join(OUT_DIR, "desk-sim");
mkdirSync(transcriptDir, { recursive: true });

async function record(run: RunResult): Promise<void> {
  const { lines, ...result } = run;
  const transcript = `${(run.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-")}.log`;
  writeFileSync(join(transcriptDir, transcript), `${lines.join("\n")}\n`);
  const base = { ts: new Date().toISOString(), target, ...result, transcript: `desk-sim/${transcript}` };
  if (!run.txHash) {
    appendJsonl(runsFile, base);
    console.log(`[desk] run ${run.startedAt}: ${run.status}${run.detail ? ` (${run.detail})` : ""}`);
    return;
  }
  try {
    const r = await client.waitForTransactionReceipt({ hash: run.txHash, timeout: 120_000 });
    const reported = parseEventLogs({ abi: riskDeskV2Abi, eventName: "RiskReportedV2", logs: r.logs }).filter(
      (l) => l.address.toLowerCase() === d.riskDesk.toLowerCase(),
    );
    const processed = parseEventLogs({ abi: mockForwarderAbi, eventName: "ReportProcessed", logs: r.logs });
    const ev = reported[0]?.args;
    const forwarderResult = processed[0]?.args.result ?? null;
    const status = receiptStatus(run.status, forwarderResult, reported.length > 0);
    appendJsonl(runsFile, {
      ...base,
      status,
      statusFromReceipt: status !== run.status,
      txStatus: r.status,
      blockNumber: r.blockNumber,
      gasUsed: r.gasUsed,
      effectiveGasPrice: r.effectiveGasPrice,
      from: r.from,
      forwarderResult,
      seq: ev?.seq ?? null,
      tObs: ev?.tObs ?? null,
      sigma5Applied: ev?.sigma5Applied ?? null,
      sigma15Applied: ev?.sigma15Applied ?? null,
      sigma5Reported: ev?.sigma5Reported ?? null,
      devPips: ev?.devPips ?? null,
      dispBp: ev?.dispBp ?? null,
      nSources: ev?.nSources ?? null,
      flags: ev?.flags ?? null,
    });
    console.log(`[desk] run ${run.startedAt}: ${status} tx ${run.txHash} seq ${ev?.seq} sigma5 ${ev?.sigma5Applied} dev ${ev?.devPips} gas ${r.gasUsed}`);
  } catch (e) {
    appendJsonl(runsFile, { ...base, receiptError: shortError(e) });
    console.error(`[desk] run ${run.startedAt}: tx ${run.txHash} receipt error: ${shortError(e)}`);
  }
}

const cmd = loopCommand(target);
console.log(`[desk] ${cmd.join(" ")} (cwd ${creDir}), recording to ${runsFile}`);
const proc = Bun.spawn(cmd, { cwd: creDir, stdout: "pipe", stderr: "inherit", env: process.env });
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    proc.kill();
    process.exit(130);
  });
}

const tracker = new RunTracker();
let pending: Promise<void> = Promise.resolve();
const handle = (run: RunResult | null): void => {
  if (!run) return;
  pending = pending.then(() => record(run));
  if (once) {
    pending.then(() => {
      proc.kill();
      process.exit(0);
    });
  }
};

const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
let buf = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += value;
  let nl = buf.indexOf("\n");
  while (nl >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    console.log(line);
    handle(tracker.push(line));
    nl = buf.indexOf("\n");
  }
}
handle(tracker.flush());
await pending;
const code = await proc.exited;
console.error(`[desk] loop exited with code ${code}`);
process.exit(code === 0 ? 0 : 1);
```

In `bots/package.json`, add to `"scripts"` after `"live:keys"`:

```json
    "live:desk": "bun src/live/desk-loop.ts",
    "live:runner": "bun src/live/runner.ts",
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `cd bots && bun test test/live/runner.test.ts && bun run typecheck`
Expected: `2 pass` and `tsc` exits 0.

- [ ] **Step 5: Try one recorded run and one poke**

Run: `cd bots && bun run live:desk --once`
Expected: the loop's output, then `[desk] run <time>: applied tx 0x... seq <n> sigma5 <x> dev <y> gas <g>`, and one line in `bots/out/desk-runs.jsonl` with `"status":"applied"`. The runner needs testnet ETH first (Task 22's `live:fund` tops it up later):

```bash
cd contracts && set -a && source .env && set +a && R=$(cd ../bots && bun run --silent live:keys --exports | sed -n 's/^export RUNNER_ADDRESS=//p') \
  && cast send "$R" --value 0.02ether --private-key "$PRIVATE_KEY" --rpc-url https://rpc.testnet.chain.robinhood.com --json | jq '{status}'
```

Then run `cd bots && perl -e 'alarm shift; exec @ARGV' 20 bun run live:runner` (stops it after 20 s). Expected: `[runner] seq <n> poked <f01>/<f10> pips, tx 0x..., gas <g>` once, and pool D's fee is that pair: `cast call $(jq -r .hook ../shared/deployments/robinhood-testnet.json) 'currentFee(bytes32,bool)(uint24)' $(jq -r .pools.D.poolId ../shared/deployments/robinhood-testnet.json) true --rpc-url https://rpc.testnet.chain.robinhood.com` prints `<f01>`.

- [ ] **Step 6: Commit**

```bash
git add bots/src/live/lib/runner.ts bots/src/live/runner.ts bots/src/live/desk-loop.ts bots/test/live/runner.test.ts bots/package.json
git commit -m "feat(bots): live desk loop recorder and the ClimPoker runner" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 20: The keeper-style bot for pool K

**Files:**
- Create: `bots/src/live/lib/keeper.ts`, `bots/src/live/keeper.ts`
- Modify: `bots/package.json`
- Test: `bots/test/live/keeper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `bots/test/live/keeper.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { annualSigmaToSigmaE9 } from "@clim/shared";
import { mulberry32 } from "../../src/lib/rng";
import { keeperFeePips, nextPostAt, parseKeeperMap, rv5From1s } from "../../src/live/lib/keeper";

const MAP = parseKeeperMap({
  edgesPctYr: [0, 40, 60, 100],
  feePips: [700, 900, 2_000, 6_000],
  clampPips: [700, 6_000],
  postEverySec: 179,
  ttlSec: 7_200,
});
const perSqrtSec = (annualPct: number): number => annualSigmaToSigmaE9(annualPct / 100) / 1e9;

describe("keeper map", () => {
  test("bin fee by annualized 5-minute volatility", () => {
    expect(keeperFeePips(MAP, perSqrtSec(25))).toBe(700);
    expect(keeperFeePips(MAP, perSqrtSec(45))).toBe(900);
    expect(keeperFeePips(MAP, perSqrtSec(99))).toBe(2_000);
    expect(keeperFeePips(MAP, perSqrtSec(400))).toBe(6_000);
  });
  test("rejects a malformed map", () => {
    expect(() => parseKeeperMap({ edgesPctYr: [0, 40], feePips: [700], clampPips: [700, 6000], postEverySec: 1, ttlSec: 1 })).toThrow(/same/);
    expect(() => parseKeeperMap({ edgesPctYr: [0, 0], feePips: [700, 700], clampPips: [700, 6000], postEverySec: 1, ttlSec: 1 })).toThrow(/increase/);
  });
  test("the lab's map file parses", async () => {
    const raw = await Bun.file(new URL("../../../shared/keeper-map-fables.json", import.meta.url)).json();
    const m = parseKeeperMap(raw);
    expect(m.ttlSec).toBe(7_200);
    expect(m.feePips.length).toBe(m.edgesPctYr.length);
  });
});

describe("5-minute volatility from Binance 1 s klines", () => {
  const NOW = 1_800_000_000;
  const rows = (n: number, end: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = end - (n - 1) + i;
      const px = (2000 * Math.exp(0.001 * Math.floor((t - end) / 5))).toString();
      return [t * 1000, px, px, px, px, "1", t * 1000 + 999];
    });
  test("returns of exactly 0.001 every 5 s", () => {
    expect(rv5From1s(rows(400, NOW - 1), NOW)).toBeCloseTo(Math.sqrt(0.001 ** 2 / 5), 12);
  });
  test("stale or short data throws", () => {
    expect(() => rv5From1s(rows(400, NOW - 40), NOW)).toThrow(/last second/);
    expect(() => rv5From1s(rows(100, NOW - 1), NOW)).toThrow(/history/);
  });
});

describe("posting cadence", () => {
  test("every postEverySec +- 10 s, seeded", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const t = nextPostAt(1_000, 179, r);
      expect(t).toBeGreaterThanOrEqual(1_169);
      expect(t).toBeLessThanOrEqual(1_189);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd bots && bun test test/live/keeper.test.ts`
Expected: FAIL with `Cannot find module '../../src/live/lib/keeper'`.

- [ ] **Step 3: Implement**

Create `bots/src/live/lib/keeper.ts`:

```ts
// Keeper-style twin (pool K), pure helpers. The fee map is shared/keeper-map-fables.json (lab/scripts/
// export_keeper_map.py): the median fee Fables' keeper posted by 5-minute volatility bin. An imitation of the observed
// pattern, not Fables' code.
import { SECONDS_PER_YEAR } from "@clim/shared";
import type { Rand } from "../../lib/rng";

export type KeeperMap = {
  edgesPctYr: number[]; // bin i is [edge i, edge i+1); the last bin is open-ended
  feePips: number[];
  clampPips: [number, number];
  postEverySec: number;
  ttlSec: number;
};

function numbers(v: unknown, what: string): number[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    throw new Error(`keeper map: ${what} must be an array of numbers`);
  }
  return v as number[];
}

export function parseKeeperMap(raw: unknown): KeeperMap {
  if (typeof raw !== "object" || raw === null) throw new Error("keeper map: not an object");
  const o = raw as Record<string, unknown>;
  const edges = numbers(o.edgesPctYr, "edgesPctYr");
  const fees = numbers(o.feePips, "feePips");
  const clamp = numbers(o.clampPips, "clampPips");
  if (edges.length === 0 || edges.length !== fees.length) throw new Error("keeper map: edgesPctYr and feePips must have the same, non-zero length");
  for (let i = 1; i < edges.length; i++) {
    if ((edges[i] ?? 0) <= (edges[i - 1] ?? 0)) throw new Error("keeper map: edgesPctYr must increase");
  }
  const [lo, hi] = clamp;
  if (clamp.length !== 2 || lo === undefined || hi === undefined || lo > hi) throw new Error("keeper map: clampPips must be [low, high]");
  const every = o.postEverySec;
  const ttl = o.ttlSec;
  if (typeof every !== "number" || every <= 0 || typeof ttl !== "number" || ttl <= 0) {
    throw new Error("keeper map: postEverySec and ttlSec must be positive numbers");
  }
  return { edgesPctYr: edges, feePips: fees, clampPips: [lo, hi], postEverySec: every, ttlSec: ttl };
}

/** The keeper-style fee (pips) for a volatility per sqrt second: the fee of its bin, clamped. */
export function keeperFeePips(map: KeeperMap, sigmaPerSqrtSec: number): number {
  const pct = sigmaPerSqrtSec * Math.sqrt(SECONDS_PER_YEAR) * 100;
  let fee = map.feePips[0] ?? map.clampPips[0];
  map.edgesPctYr.forEach((edge, i) => {
    if (pct >= edge) fee = map.feePips[i] ?? fee;
  });
  return Math.max(map.clampPips[0], Math.min(map.clampPips[1], Math.round(fee)));
}

/** Realized volatility per sqrt second over windowSec from Binance 1 s klines ([openMs, o, h, l, close, ...] rows):
 *  5 s returns ending at the last closed second, a missing second keeping the previous close (the lab's rv_window). */
export function rv5From1s(rows: unknown, nowSec: number, windowSec = 300, stepSec = 5, maxAgeSec = 10): number {
  if (!Array.isArray(rows)) throw new Error("binance 1s: not an array");
  const closes: Array<{ t: number; close: number }> = [];
  for (const r of rows) {
    if (!Array.isArray(r)) throw new Error("binance 1s: bad row");
    const t = Number(r[0]) / 1000;
    const close = Number(r[4]);
    if (Number.isFinite(t) && close > 0 && t + 1 <= nowSec) closes.push({ t, close });
  }
  closes.sort((a, b) => a.t - b.t);
  const first0 = closes[0];
  const last = closes[closes.length - 1];
  if (first0 === undefined || last === undefined) throw new Error("binance 1s: no closed second");
  if (nowSec - (last.t + 1) > maxAgeSec) throw new Error(`binance 1s: last second closed ${nowSec - last.t - 1} s ago`);
  const first = last.t - windowSec;
  if (first0.t > first) throw new Error("binance 1s: not enough history");
  let j = 0;
  let px = Number.NaN;
  let prev = Number.NaN;
  let ss = 0;
  for (let k = 0; k <= windowSec / stepSec; k++) {
    const target = first + k * stepSec;
    for (let c = closes[j]; c !== undefined && c.t <= target; c = closes[++j]) px = c.close;
    if (k > 0) {
      const r = Math.log(px / prev);
      ss += r * r;
    }
    prev = px;
  }
  return Math.sqrt(ss / windowSec);
}

/** Next post: postEverySec later, +- jitterSec of seeded jitter (Fables' keeper posted every 179 s at the median). */
export function nextPostAt(fromSec: number, everySec: number, rand: Rand, jitterSec = 10): number {
  return fromSec + everySec + Math.round((rand() * 2 - 1) * jitterSec);
}
```

Create `bots/src/live/keeper.ts`:

```ts
// Keeper-style twin for pool K on Robinhood Chain testnet. It imitates the pattern observed on Fables' ETH/USDG pool,
// not Fables' code: about every 180 s, the fee shared/keeper-map-fables.json gives at the current 5-minute realized
// volatility (Binance 1 s, 5 s returns), posted with pokeFee(poolK, fee, 7200) on PokeFeeHook (FEE_POKER).
// Usage: bun src/live/keeper.ts     Log: bots/out/keeper-rh.jsonl     Env: KEEPER_SEED (jitter, default 7)
import { pokeFeeHookAbi } from "@clim/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { mulberry32 } from "../lib/rng";
import { liveClient, liveWallet } from "./lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { keeperFeePips, nextPostAt, parseKeeperMap, rv5From1s } from "./lib/keeper";

const BINANCE_1S = "https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=400";
const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("keeper"));
const map = parseKeeperMap(JSON.parse(readFileSync(join(REPO_ROOT, "shared", "keeper-map-fables.json"), "utf8")));
const rand = mulberry32(envNum("KEEPER_SEED", 7));
const logFile = join(OUT_DIR, "keeper-rh.jsonl");
let nextAt = 0;

async function tick(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (now < nextAt) return;
  const base = { ts: new Date().toISOString(), poolId: d.pools.K.poolId };
  try {
    const res = await fetch(BINANCE_1S, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`binance 1s: HTTP ${res.status}`);
    const sigma = rv5From1s(await res.json(), now);
    const fee = keeperFeePips(map, sigma);
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: d.hook,
      abi: pokeFeeHookAbi,
      functionName: "pokeFee",
      args: [d.pools.K.poolId, fee, map.ttlSec],
    });
    const hash = await wallet.writeContract(request);
    const r = await client.waitForTransactionReceipt({ hash });
    const sigmaPctYr = sigma * Math.sqrt(31_536_000) * 100;
    appendJsonl(logFile, { ...base, sigmaPctYr, fee, ttl: map.ttlSec, txHash: hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice });
    console.log(`[keeper] sigma5 ${sigmaPctYr.toFixed(1)}%/yr -> K fee ${fee} pips (TTL ${map.ttlSec} s), tx ${hash}`);
    nextAt = nextPostAt(now, map.postEverySec, rand);
  } catch (e) {
    appendJsonl(logFile, { ...base, error: shortError(e) });
    console.error(`[keeper] ${shortError(e)}; retry in 30 s`);
    nextAt = now + 30;
  }
}

let busy = false;
console.log(`[keeper] ${wallet.account.address} pokes K ${d.pools.K.poolId} on ${d.hook} about every ${map.postEverySec} s (imitation of the observed pattern, not Fables' code)`);
const loop = (): void => {
  if (busy) return;
  busy = true;
  tick()
    .catch((e: unknown) => console.error(`[keeper] ${shortError(e)}`))
    .finally(() => {
      busy = false;
    });
};
loop();
setInterval(loop, 5_000);
```

In `bots/package.json`, add after `"live:runner"`:

```json
    "live:keeper": "bun src/live/keeper.ts",
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `cd bots && bun test test/live/keeper.test.ts && bun run typecheck`
Expected: `6 pass` and `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add bots/src/live/lib/keeper.ts bots/src/live/keeper.ts bots/test/live/keeper.test.ts bots/package.json
git commit -m "feat(bots): keeper-style bot for pool K, an imitation of the pattern observed on Fables' pool" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 21: Arbitrage and retail bots on D, K and F

**Files:**
- Create: `bots/src/live/lib/arb.ts`, `bots/src/live/lib/flow.ts`, `bots/src/live/arb.ts`, `bots/src/live/noise.ts`
- Modify: `bots/package.json`
- Test: `bots/test/live/arb.test.ts`, `bots/test/live/flow.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `bots/test/live/arb.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { sqrtPriceX96FromEthUsd, type PairOrientation } from "@clim/shared";
import { decideArb } from "../../src/lib/arb";
import { decideArbDirectional } from "../../src/live/lib/arb";

const ETH0: PairOrientation = { token0IsEth: true, decimals0: 18, decimals1: 6 };
const USD0: PairOrientation = { token0IsEth: false, decimals0: 6, decimals1: 18 };
const M = 2_000;
const at = (pool: number, o: PairOrientation, fee0For1: number, fee1For0: number) =>
  decideArbDirectional({ sqrtPriceX96: sqrtPriceX96FromEthUsd(pool, o), marketEthUsd: M, fee0For1, fee1For0, orientation: o });

describe("arbitrage on a per-direction hook", () => {
  test("symmetric fees: the same decision as v1's decideArb", () => {
    const s = sqrtPriceX96FromEthUsd(2_002, ETH0);
    const { feePips, ...dec } = decideArbDirectional({ sqrtPriceX96: s, marketEthUsd: M, fee0For1: 500, fee1For0: 500, orientation: ETH0 });
    expect(dec).toEqual(decideArb({ sqrtPriceX96: s, marketEthUsd: M, feePips: 500, orientation: ETH0 }));
    expect(feePips).toBe(500);
  });
  test("pool ETH too dear (+10 bp), ETH token0: selling ETH is zeroForOne, so fee0For1 sets the band", () => {
    expect(at(2_002, ETH0, 500, 1_500).action).toBe("swap");
    const none = at(2_002, ETH0, 1_500, 500);
    expect(none.action).toBe("none");
    expect(none.feePips).toBe(1_500);
  });
  test("pool ETH too cheap (-10 bp), ETH token0: buying ETH is oneForZero, so fee1For0 sets the band", () => {
    expect(at(1_998, ETH0, 1_500, 500).action).toBe("swap");
    expect(at(1_998, ETH0, 500, 1_500).action).toBe("none");
  });
  test("USD token0 flips which fee applies", () => {
    expect(at(2_002, USD0, 1_500, 500).action).toBe("swap"); // selling ETH is oneForZero here
    expect(at(2_002, USD0, 500, 1_500).action).toBe("none");
  });
});
```

Create `bots/test/live/flow.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../../src/lib/rng";
import { planTickOrders, type FlowConfig } from "../../src/live/lib/flow";

const CFG: FlowConfig = { ordersPerTick: 0.2, medianUsd: 2_000, sigmaLn: 1 };

describe("retail flow per tick", () => {
  test("deterministic for a seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) expect(planTickOrders(a, CFG)).toEqual(planTickOrders(b, CFG));
  });
  test("Poisson count, balanced sides, log-normal size", () => {
    const r = mulberry32(3);
    const orders = Array.from({ length: 20_000 }, () => planTickOrders(r, CFG)).flat();
    expect(Math.abs(orders.length / 20_000 - 0.2)).toBeLessThan(0.02);
    expect(Math.abs(orders.filter((o) => o.side === "buyEth").length / orders.length - 0.5)).toBeLessThan(0.04);
    const sizes = orders.map((o) => o.usd).sort((x, y) => x - y);
    expect(Math.abs((sizes[Math.floor(sizes.length / 2)] ?? 0) / 2_000 - 1)).toBeLessThan(0.1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd bots && bun test test/live/arb.test.ts test/live/flow.test.ts`
Expected: FAIL with `Cannot find module '../../src/live/lib/arb'`.

- [ ] **Step 3: Implement the pure parts**

Create `bots/src/live/lib/arb.ts`:

```ts
// Arbitrage on a per-direction hook (pool D charges fee0For1 and fee1For0 separately): the side the gap implies
// decides which fee sets the no-arbitrage band; v1's decideArb does the rest.
import { ethUsdFromSqrtPriceX96, type PairOrientation } from "@clim/shared";
import { decideArb, type ArbDecision } from "../../lib/arb";
import { zeroForOneFor } from "../../lib/swap";

export type DirectionalArbInput = {
  sqrtPriceX96: bigint;
  marketEthUsd: number;
  fee0For1: number;
  fee1For0: number;
  orientation: PairOrientation;
};

export function decideArbDirectional(i: DirectionalArbInput): ArbDecision & { feePips: number } {
  const poolEthUsd = ethUsdFromSqrtPriceX96(i.sqrtPriceX96, i.orientation);
  const zeroForOne = zeroForOneFor(poolEthUsd > i.marketEthUsd ? "sellEth" : "buyEth", i.orientation.token0IsEth);
  const feePips = zeroForOne ? i.fee0For1 : i.fee1For0;
  return { ...decideArb({ sqrtPriceX96: i.sqrtPriceX96, marketEthUsd: i.marketEthUsd, feePips, orientation: i.orientation }), feePips };
}
```

Create `bots/src/live/lib/flow.ts`:

```ts
// Retail flow of the live noise bot: per tick, a Poisson number of orders with a random side and a log-normal USD size.
// Every order goes to D, K and F (mirror routing), so the three pools see the same retail flow.
import { logNormal, poisson, type Rand } from "../../lib/rng";
import type { Side } from "../../lib/swap";

export type FlowConfig = { ordersPerTick: number; medianUsd: number; sigmaLn: number };
export type FlowOrder = { side: Side; usd: number };

export function planTickOrders(rand: Rand, cfg: FlowConfig): FlowOrder[] {
  const n = poisson(rand, cfg.ordersPerTick);
  const out: FlowOrder[] = [];
  for (let i = 0; i < n; i++) {
    const side: Side = rand() < 0.5 ? "buyEth" : "sellEth";
    out.push({ side, usd: logNormal(rand, cfg.medianUsd, cfg.sigmaLn) });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd bots && bun test test/live/arb.test.ts test/live/flow.test.ts`
Expected: `6 pass`.

- [ ] **Step 5: Write the two bots**

Create `bots/src/live/arb.ts`:

```ts
// Arbitrage bot on Robinhood Chain testnet: every poll (2 s; blocks come about every 0.1 s), read pools D, K and F and
// the venue price (median of four venues' tickers, bots/src/lib/market.ts), and push each pool back to the edge of its
// no-arbitrage band, with the fee of the direction it trades. It swaps through routers.arb, so the dashboard tells
// arbitrage by Swap.sender. Usage: bun src/live/arb.ts     Log: bots/out/arb-rh.jsonl
import { LIVE_POOLS, liveOrientation, poolSwapTestAbi, type LivePoolName } from "@clim/shared";
import { join } from "node:path";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { aggregate, fetchVenueQuotes } from "../lib/market";
import { swapArgs } from "../lib/swap";
import { decideArbDirectional } from "./lib/arb";
import { liveClient, liveWallet, readLiveBalances, readLiveState } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";

const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("arb"));
const me = wallet.account.address;
const router = d.routers.arb;
const logFile = join(OUT_DIR, "arb-rh.jsonl");
// A pool with an arbitrage still pending is skipped: trading it again on stale state would revert or overshoot.
const inflight = new Set<LivePoolName>();

async function onBlock(blockNumber: bigint): Promise<void> {
  const [m, s, bal] = await Promise.all([
    fetchVenueQuotes().then(aggregate),
    readLiveState(client, d, blockNumber),
    readLiveBalances(client, d, me, router),
  ]);
  if (!m) {
    appendJsonl(logFile, { ts: new Date().toISOString(), block: blockNumber, action: "skip", reason: "fewer than 3 venues" });
    return;
  }
  for (const name of LIVE_POOLS) {
    const pool = d.pools[name];
    const ps = s.pools[name];
    const dec = decideArbDirectional({
      sqrtPriceX96: ps.sqrtPriceX96,
      marketEthUsd: m.price,
      fee0For1: ps.fee0For1,
      fee1For0: ps.fee1For0,
      orientation: liveOrientation(d, pool),
    });
    const base = {
      ts: new Date().toISOString(),
      block: blockNumber,
      pool: name,
      market: m.price,
      nVenues: m.n,
      poolEthUsd: dec.poolEthUsd,
      feePips: dec.feePips,
      logGapBp: dec.logGap * 1e4,
      bandBp: dec.bandLog * 1e4,
    };
    if (dec.action === "none") {
      appendJsonl(logFile, { ...base, action: "none" });
      continue;
    }
    if (inflight.has(name)) {
      appendJsonl(logFile, { ...base, action: "skip", reason: "previous arbitrage pending" });
      continue;
    }
    const amountIn = dec.side === "buyEth" ? bal.tUSDG : bal.tETH;
    if (amountIn === 0n) {
      appendJsonl(logFile, { ...base, action: "skip", reason: `no ${dec.side === "buyEth" ? "tUSDG" : "tETH"} balance` });
      continue;
    }
    try {
      // Spend up to the whole balance: the swap stops at the price limit, so only the needed amount moves.
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: router,
        abi: poolSwapTestAbi,
        functionName: "swap",
        args: swapArgs(pool.key, dec.zeroForOne, amountIn, dec.sqrtPriceLimitX96),
      });
      const hash = await wallet.writeContract(request);
      inflight.add(name);
      appendJsonl(logFile, { ...base, action: dec.side, zeroForOne: dec.zeroForOne, targetEthUsd: dec.targetEthUsd, txHash: hash });
      console.log(`[arb] ${name} pool ${dec.poolEthUsd.toFixed(2)} vs ${m.price.toFixed(2)} (fee ${dec.feePips}) -> ${dec.side} tx ${hash}`);
      client
        .waitForTransactionReceipt({ hash })
        .then(
          (r) => appendJsonl(logFile, { ts: new Date().toISOString(), event: "receipt", pool: name, txHash: hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed }),
          (e: unknown) => appendJsonl(logFile, { ts: new Date().toISOString(), event: "receipt-error", pool: name, txHash: hash, error: shortError(e) }),
        )
        .finally(() => inflight.delete(name));
    } catch (e) {
      const error = shortError(e);
      const action = /PriceLimitAlreadyExceeded|0x7c9c6e8f/.test(error) ? "stale" : "error";
      appendJsonl(logFile, { ...base, action, error });
      if (action === "error") console.error(`[arb] ${name} -> error: ${error}`);
    }
  }
}

let busy = false;
console.log(`[arb] ${me} trading D, K, F through ${router}`);
client.watchBlockNumber({
  emitMissed: false,
  pollingInterval: 2_000,
  onBlockNumber: (blockNumber) => {
    if (busy) return;
    busy = true;
    onBlock(blockNumber)
      .catch((e: unknown) => console.error(`[arb] block ${blockNumber} failed: ${shortError(e)}`))
      .finally(() => {
        busy = false;
      });
  },
  onError: (e) => console.error(`[arb] watch error: ${shortError(e)}`),
});
```

Create `bots/src/live/noise.ts`:

```ts
// Retail (noise) bot on Robinhood Chain testnet: every NOISE_TICK_MS (10 s), a Poisson number of orders
// (NOISE_ORDERS_PER_TICK, default 0.2) with a random side and a log-normal USD size, each sent to D, K and F through the
// retail PoolSwapTest. Usage: bun src/live/noise.ts     Log: bots/out/noise-rh.jsonl
import { LIVE_POOLS, poolSwapTestAbi } from "@clim/shared";
import { join } from "node:path";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { mulberry32 } from "../lib/rng";
import { inputAmountForUsd, noPriceLimit, swapArgs, zeroForOneFor } from "../lib/swap";
import { liveClient, liveWallet, readLiveState } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { planTickOrders, type FlowConfig } from "./lib/flow";

const cfg: FlowConfig = {
  ordersPerTick: envNum("NOISE_ORDERS_PER_TICK", 0.2),
  medianUsd: envNum("NOISE_MEDIAN_USD", 2_000),
  sigmaLn: envNum("NOISE_SIGMA_LN", 1),
};
const seed = envNum("NOISE_SEED", 42);
const rand = mulberry32(seed);
const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("noise"));
const logFile = join(OUT_DIR, "noise-rh.jsonl");

async function tick(): Promise<void> {
  const orders = planTickOrders(rand, cfg);
  if (orders.length === 0) return;
  const s = await readLiveState(client, d);
  for (const order of orders) {
    for (const name of LIVE_POOLS) {
      const pool = d.pools[name];
      const ps = s.pools[name];
      const zeroForOne = zeroForOneFor(order.side, pool.token0IsEth);
      const amountIn = inputAmountForUsd(order.side, order.usd, ps.ethUsd, d.tokens.tETH.decimals, d.tokens.tUSDG.decimals);
      const base = { ts: new Date().toISOString(), pool: name, side: order.side, usd: order.usd, feePips: zeroForOne ? ps.fee0For1 : ps.fee1For0 };
      try {
        const { request } = await client.simulateContract({
          account: wallet.account,
          address: d.uniswap.poolSwapTest,
          abi: poolSwapTestAbi,
          functionName: "swap",
          args: swapArgs(pool.key, zeroForOne, amountIn, noPriceLimit(zeroForOne)),
        });
        const hash = await wallet.writeContract(request);
        appendJsonl(logFile, { ...base, amountIn, txHash: hash });
        console.log(`[noise] ${order.side} $${order.usd.toFixed(0)} on ${name} (fee ${base.feePips} pips) tx ${hash}`);
      } catch (e) {
        appendJsonl(logFile, { ...base, error: shortError(e) });
        console.error(`[noise] ${name} error: ${shortError(e)}`);
      }
    }
  }
}

let busy = false;
console.log(`[noise] ${wallet.account.address} ${cfg.ordersPerTick} orders per tick, median $${cfg.medianUsd}, seed ${seed}, mirrored to D, K, F`);
setInterval(() => {
  if (busy) return;
  busy = true;
  tick()
    .catch((e: unknown) => console.error(`[noise] ${shortError(e)}`))
    .finally(() => {
      busy = false;
    });
}, envNum("NOISE_TICK_MS", 10_000));
```

In `bots/package.json`, add after `"live:keeper"`:

```json
    "live:arb": "bun src/live/arb.ts",
    "live:noise": "bun src/live/noise.ts",
```

- [ ] **Step 6: Typecheck and run the whole bots suite**

Run: `cd bots && bun test && bun run typecheck`
Expected: `0 fail` (v1's tests plus the live ones) and `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add bots/src/live/lib/arb.ts bots/src/live/lib/flow.ts bots/src/live/arb.ts bots/src/live/noise.ts bots/test/live/arb.test.ts bots/test/live/flow.test.ts bots/package.json
git commit -m "feat(bots): arbitrage and retail bots on the three live pools, per-direction fees respected" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 22: Funding, status, gas evidence and the final checks script

**Files:**
- Create: `bots/src/live/lib/gas.ts`, `bots/src/live/scripts/fund.ts`, `bots/src/live/scripts/status.ts`, `bots/src/live/scripts/gas.ts`, `bots/src/live/scripts/verify-live.ts`
- Modify: `bots/package.json`
- Test: `bots/test/live/gas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `bots/test/live/gas.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { hashesFromJsonl, percentile, summarizeGas } from "../../src/live/lib/gas";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

describe("gas summary", () => {
  test("percentiles (nearest rank)", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 90)).toBe(5);
    expect(() => percentile([], 50)).toThrow();
  });
  test("median gas, L1 share, price and cost per transaction", () => {
    const s = summarizeGas([
      { gasUsed: 100_000n, gasUsedForL1: 2_000n, effectiveGasPrice: 10_000_000n },
      { gasUsed: 120_000n, gasUsedForL1: 2_500n, effectiveGasPrice: 10_000_000n },
      { gasUsed: 110_000n, gasUsedForL1: 2_200n, effectiveGasPrice: 12_000_000n },
    ]);
    expect(s).toEqual({ n: 3, gasUsedMedian: 110_000, gasUsedP90: 120_000, gasUsedForL1Median: 2_200, effectiveGasPriceMedianWei: 10_000_000, costMedianEth: 0.0000012 });
  });
  test("transaction hashes from a JSON-lines log, last N matching", () => {
    const text = [
      JSON.stringify({ action: "poke", txHash: H(1) }),
      JSON.stringify({ action: "error" }),
      "not json",
      JSON.stringify({ action: "poke", txHash: H(2) }),
      JSON.stringify({ action: "poke", txHash: H(3) }),
    ].join("\n");
    expect(hashesFromJsonl(text, (o) => o.action === "poke", 2)).toEqual([H(2), H(3)]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd bots && bun test test/live/gas.test.ts`
Expected: FAIL with `Cannot find module '../../src/live/lib/gas'`.

- [ ] **Step 3: Implement the summary helpers**

Create `bots/src/live/lib/gas.ts`:

```ts
// Gas statistics for the CTO checklist (spec §5.8: cost per report and per poke on Robinhood Chain), pure helpers.
import type { Hex } from "viem";

export type GasRow = { gasUsed: bigint; gasUsedForL1: bigint; effectiveGasPrice: bigint };
export type GasSummary = {
  n: number;
  gasUsedMedian: number;
  gasUsedP90: number;
  gasUsedForL1Median: number;
  effectiveGasPriceMedianWei: number;
  costMedianEth: number;
};

/** Nearest-rank percentile. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) throw new RangeError("percentile of an empty list");
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[rank - 1] as number;
}

export function summarizeGas(rows: readonly GasRow[]): GasSummary {
  const gas = rows.map((r) => Number(r.gasUsed));
  const price = rows.map((r) => Number(r.effectiveGasPrice));
  const cost = rows.map((r) => Number(r.gasUsed * r.effectiveGasPrice) / 1e18);
  return {
    n: rows.length,
    gasUsedMedian: percentile(gas, 50),
    gasUsedP90: percentile(gas, 90),
    gasUsedForL1Median: percentile(rows.map((r) => Number(r.gasUsedForL1)), 50),
    effectiveGasPriceMedianWei: percentile(price, 50),
    costMedianEth: percentile(cost, 50),
  };
}

/** The last `last` transaction hashes of a JSON-lines log whose record matches `pick` (malformed lines skipped). */
export function hashesFromJsonl(text: string, pick: (o: Record<string, unknown>) => boolean, last: number): Hex[] {
  const out: Hex[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof o.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(o.txHash) && pick(o)) out.push(o.txHash as Hex);
  }
  return out.slice(-last);
}
```

Run: `cd bots && bun test test/live/gas.test.ts`
Expected: `3 pass`.

- [ ] **Step 4: Write the funding script**

Create `bots/src/live/scripts/fund.ts`:

```ts
// Funding and approvals of the live stack's keys (idempotent: tops up only what is missing), from DEPLOYER_PRIVATE_KEY
// (TestToken owner): testnet ETH for gas to the CRE operator, runner, keeper, arbitrage and retail keys; tETH and tUSDG
// minted to the arbitrage and retail keys, which approve the router they swap through.
// Usage: bun src/live/scripts/fund.ts     Env: FUND_SCALE (multiplies every ETH target, default 1)
import { testTokenAbi } from "@clim/shared";
import { formatEther, formatUnits, maxUint256, parseEther, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { envNum } from "../../lib/env";
import { liveClient, liveWallet } from "../lib/chain";
import { loadLiveDeployments } from "../lib/deployments";
import { liveKey, type LiveRole } from "../lib/env";

const d = loadLiveDeployments();
const client = liveClient();
const deployer = liveWallet(liveKey("deployer"));
const scale = envNum("FUND_SCALE", 1);

type Target = { name: string; address: Address; eth: number; key?: Hex; router?: Address; mint?: { tETH: string; tUSDG: string } };
const keyed = (role: LiveRole) => {
  const key = liveKey(role);
  return { key, address: privateKeyToAccount(key).address };
};
const TARGETS: Target[] = [
  { name: "CRE operator", address: d.cre.simOperator, eth: 0.1 },
  { name: "runner", ...keyed("runner"), eth: 0.1 },
  { name: "keeper", ...keyed("keeper"), eth: 0.02 },
  { name: "arbitrage", ...keyed("arb"), eth: 0.08, router: d.routers.arb, mint: { tETH: "1000", tUSDG: "5000000" } },
  { name: "retail", ...keyed("noise"), eth: 0.05, router: d.uniswap.poolSwapTest, mint: { tETH: "100", tUSDG: "500000" } },
];

async function send(hash: Promise<Hex>): Promise<Hex> {
  const h = await hash;
  await client.waitForTransactionReceipt({ hash: h });
  return h;
}

for (const t of TARGETS) {
  const want = parseEther((t.eth * scale).toFixed(6));
  const have = await client.getBalance({ address: t.address });
  if (have < want / 2n) {
    const h = await send(deployer.sendTransaction({ to: t.address, value: want - have }));
    console.log(`[fund] ${t.name} ${t.address}: +${formatEther(want - have)} ETH (${h})`);
  }
  if (t.mint && t.key && t.router) {
    for (const [sym, amount] of Object.entries(t.mint) as Array<["tETH" | "tUSDG", string]>) {
      const token = d.tokens[sym];
      const target = parseUnits(amount, token.decimals);
      const bal = await client.readContract({ address: token.address, abi: testTokenAbi, functionName: "balanceOf", args: [t.address] });
      if (bal < target / 2n) {
        const h = await send(deployer.writeContract({ address: token.address, abi: testTokenAbi, functionName: "mint", args: [t.address, target - bal] }));
        console.log(`[fund] ${t.name}: minted ${formatUnits(target - bal, token.decimals)} ${sym} (${h})`);
      }
      const allowance = await client.readContract({ address: token.address, abi: testTokenAbi, functionName: "allowance", args: [t.address, t.router] });
      if (allowance < maxUint256 / 2n) {
        const bot = liveWallet(t.key);
        const h = await send(bot.writeContract({ address: token.address, abi: testTokenAbi, functionName: "approve", args: [t.router, maxUint256] }));
        console.log(`[fund] ${t.name}: approved ${t.router} for ${sym} (${h})`);
      }
    }
  }
  console.log(`[fund] ${t.name} ${t.address} ready: ${formatEther(await client.getBalance({ address: t.address }))} ETH`);
}
console.log(`[fund] deployer ${deployer.account.address} left with ${formatEther(await client.getBalance({ address: deployer.account.address }))} ETH`);
```

- [ ] **Step 5: Write the status script**

Create `bots/src/live/scripts/status.ts`:

```ts
// Health of the live stack on Robinhood Chain testnet: desk seq and age, the policy's quote and mode, each pool's fee
// both ways and price against the venues, the last pokes on D (ClimPoker) and K (keeper), every key's balances, and the
// age of each bot's last log line. Exits 1 on a problem; --watch prints a snapshot every 15 s instead.
// Usage: bun src/live/scripts/status.ts [--watch]
import { climPokerAbi, FeeMode, LIVE_POOLS, pipsToBp, pokeFeeHookAbi, sigmaE9ToAnnual, stateViewAbi } from "@clim/shared";
import { join } from "node:path";
import { formatEther, formatUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hasFlag } from "../../lib/env";
import { OUT_DIR, shortError } from "../../lib/jsonl";
import { aggregate, fetchVenueQuotes } from "../../lib/market";
import { liveClient, readLiveBalances, readLiveState } from "../lib/chain";
import { loadLiveDeployments } from "../lib/deployments";
import { liveKey, type LiveRole } from "../lib/env";
import { lastTs } from "../lib/tail";

const d = loadLiveDeployments();
const client = liveClient();
const LOOKBACK_BLOCKS = 9_000n; // about 15 minutes at 0.1 s blocks
const MODE: Record<number, string> = { [FeeMode.Normal]: "normal", [FeeMode.Degraded]: "degraded", [FeeMode.Blind]: "blind" };
const LOGS: Array<[string, string, number]> = [
  ["desk", "desk-runs.jsonl", 90],
  ["runner", "runner-rh.jsonl", 120],
  ["keeper", "keeper-rh.jsonl", 400],
  ["arb", "arb-rh.jsonl", 60],
  ["noise", "noise-rh.jsonl", 600],
];

async function snapshot(): Promise<string[]> {
  const problems: string[] = [];
  const head = await client.getBlockNumber();
  const [s, block, quotes] = await Promise.all([readLiveState(client, d, head), client.getBlock({ blockNumber: head }), fetchVenueQuotes().catch(() => [])]);
  const now = Number(block.timestamp);
  const m = aggregate(quotes);
  const age = s.desk.seq === 0 ? Number.POSITIVE_INFINITY : now - s.desk.tObs;
  console.log(
    `${new Date().toISOString()} block ${head} | desk seq ${s.desk.seq} age ${age}s sigma5 ${(sigmaE9ToAnnual(s.desk.sigma5E9) * 100).toFixed(1)}%/yr sigma15 ${(sigmaE9ToAnnual(s.desk.sigma15E9) * 100).toFixed(1)}%/yr dev ${s.desk.devPips} pips flags ${s.desk.flags} | policy ${s.policy.fee0For1}/${s.policy.fee1For0} (${MODE[s.policy.mode] ?? s.policy.mode}) | market ${m ? `${m.price.toFixed(2)} (${m.n} venues)` : "n/a"}`,
  );
  if (age > 90) problems.push(`desk report age ${age} s > 90 s`);
  if (s.policy.mode === FeeMode.Blind) problems.push("policy mode blind");

  const from = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  const [poked, kPokes] = await Promise.all([
    client.getLogs({ address: d.poker, event: climPokerAbi[1], fromBlock: from, toBlock: head }),
    client.getLogs({ address: d.hook, event: pokeFeeHookAbi[3], args: { poolId: d.pools.K.poolId }, fromBlock: from, toBlock: head }),
  ]);
  const lastPoke = poked[poked.length - 1]?.args;
  const lastK = kPokes[kPokes.length - 1];
  for (const name of LIVE_POOLS) {
    const ps = s.pools[name];
    const liq = await client.readContract({ address: d.uniswap.stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [d.pools[name].poolId] });
    console.log(
      `  ${name}: fee ${ps.fee0For1}/${ps.fee1For0} pips (${pipsToBp(ps.fee0For1).toFixed(2)}/${pipsToBp(ps.fee1For0).toFixed(2)} bp) price ${ps.ethUsd.toFixed(2)}${m ? ` gap ${((ps.ethUsd / m.price - 1) * 1e4).toFixed(1)} bp` : ""} L ${Number(liq).toExponential(3)}`,
    );
    if (liq * 2n < d.liquidity) problems.push(`${name} liquidity ${liq} below half the seed ${d.liquidity}`);
  }
  const flat = d.hookConfig.flatPips;
  if (s.pools.F.fee0For1 !== flat || s.pools.F.fee1For0 !== flat) problems.push(`F fee ${s.pools.F.fee0For1}/${s.pools.F.fee1For0} != flat ${flat}`);
  if (lastPoke && lastPoke.expiry !== undefined && lastPoke.expiry > now) {
    if (s.pools.D.fee0For1 !== lastPoke.fee0For1 || s.pools.D.fee1For0 !== lastPoke.fee1For0) {
      problems.push(`D fee ${s.pools.D.fee0For1}/${s.pools.D.fee1For0} != last poke ${lastPoke.fee0For1}/${lastPoke.fee1For0}`);
    }
  }
  console.log(`  last D poke: ${lastPoke ? `seq ${lastPoke.seq} ${lastPoke.fee0For1}/${lastPoke.fee1For0} pips, ${poked.length} in ${LOOKBACK_BLOCKS} blocks` : "none in the lookback"}`);
  console.log(`  last K poke: ${lastK ? `${lastK.args.fee} pips at block ${lastK.blockNumber}, ${kPokes.length} in ${LOOKBACK_BLOCKS} blocks` : "none in the lookback"}`);
  if (poked.length === 0) problems.push("no ClimPoker poke in the lookback");
  if (kPokes.length === 0) problems.push("no keeper poke on K in the lookback");

  const keys: Array<[string, Address, Address | null]> = [["CRE operator", d.cre.simOperator, null]];
  for (const [name, role, router] of [
    ["runner", "runner", null],
    ["keeper", "keeper", null],
    ["arbitrage", "arb", d.routers.arb],
    ["retail", "noise", d.uniswap.poolSwapTest],
  ] as Array<[string, LiveRole, Address | null]>) {
    try {
      keys.push([name, privateKeyToAccount(liveKey(role)).address, router]);
    } catch {
      problems.push(`${name}: key not set in bots/.env`);
    }
  }
  for (const [name, addr, router] of keys) {
    const b = await readLiveBalances(client, d, addr, router ?? addr);
    const tokens = router ? `, ${formatUnits(b.tETH, 18)} tETH, ${formatUnits(b.tUSDG, 6)} tUSDG` : "";
    console.log(`  ${name} ${addr}: ${formatEther(b.native)} ETH${tokens}`);
    if (b.native < 10n ** 16n) problems.push(`${name} has under 0.01 ETH (bun run live:fund)`);
  }
  for (const [name, file, maxAge] of LOGS) {
    const ts = lastTs(join(OUT_DIR, file));
    const a = ts === null ? null : Math.round((Date.now() - Date.parse(ts)) / 1000);
    console.log(`  bot ${name}: last log ${a === null ? "never" : `${a} s ago`}`);
    if (a === null || a > maxAge) problems.push(`bot ${name} silent (${a === null ? "no log" : `${a} s`} > ${maxAge} s)`);
  }
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  return problems;
}

if (hasFlag("--watch")) {
  const loop = (): void => {
    snapshot().catch((e: unknown) => console.error(shortError(e)));
  };
  loop();
  setInterval(loop, 15_000);
} else {
  const problems = await snapshot();
  process.exit(problems.length === 0 ? 0 : 1);
}
```

- [ ] **Step 6: Write the gas evidence script**

Create `bots/src/live/scripts/gas.ts`:

```ts
// Gas per transaction type on Robinhood Chain testnet, from the receipts of the live logs: desk report (through the
// MockKeystoneForwarder), ClimPoker.poke(), keeper poke, arbitrage swap, retail swap. Reads each raw receipt
// (gasUsed, gasUsedForL1, effectiveGasPrice) and writes docs/evidence/gas-robinhood-testnet.json for the CTO
// checklist (spec §5.8). Usage: bun src/live/scripts/gas.ts [--last 200]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { argValue } from "../../lib/env";
import { OUT_DIR } from "../../lib/jsonl";
import { liveClient } from "../lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "../lib/deployments";
import { hashesFromJsonl, summarizeGas, type GasRow } from "../lib/gas";

const last = Number(argValue("--last") ?? "200");
const d = loadLiveDeployments();
const client = liveClient();
const CATEGORIES: Array<[string, string, (o: Record<string, unknown>) => boolean]> = [
  ["deskReport", "desk-runs.jsonl", (o) => o.status === "applied"],
  ["poke", "runner-rh.jsonl", (o) => o.action === "poke" && o.status === "success"],
  ["keeperPoke", "keeper-rh.jsonl", (o) => o.status === "success"],
  ["arbSwap", "arb-rh.jsonl", (o) => o.action === "buyEth" || o.action === "sellEth"],
  ["retailSwap", "noise-rh.jsonl", (o) => o.error === undefined],
];

async function receipt(hash: Hex): Promise<GasRow | null> {
  const r = (await client.request({ method: "eth_getTransactionReceipt", params: [hash] })) as Record<string, unknown> | null;
  if (!r || r.status !== "0x1") return null;
  const big = (x: unknown): bigint => (typeof x === "string" ? BigInt(x) : 0n);
  return { gasUsed: big(r.gasUsed), gasUsedForL1: big(r.gasUsedForL1), effectiveGasPrice: big(r.effectiveGasPrice) };
}

const out: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  chainId: d.chainId,
  note: "Robinhood Chain testnet receipts of the live stack (plan 03); gasUsed includes the L1 component (gasUsedForL1)",
};
for (const [name, file, pick] of CATEGORIES) {
  const path = join(OUT_DIR, file);
  if (!existsSync(path)) {
    out[name] = null;
    continue;
  }
  const hashes = hashesFromJsonl(readFileSync(path, "utf8"), pick, last);
  const rows = (await Promise.all(hashes.map(receipt))).filter((r): r is GasRow => r !== null);
  out[name] = rows.length > 0 ? summarizeGas(rows) : null;
  console.log(`${name}: ${rows.length} receipts`, out[name]);
}
const dir = join(REPO_ROOT, "docs", "evidence");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "gas-robinhood-testnet.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote docs/evidence/gas-robinhood-testnet.json`);
```

- [ ] **Step 7: Write the final checks script**

Create `bots/src/live/scripts/verify-live.ts`:

```ts
// Final on-chain checks of the live stack (plan 03 Task 26) over the last WINDOW_BLOCKS blocks (default 18,000, about
// 30 minutes): the desk reports regularly and seq rises by one; pool D's fee is the policy's quote, poke by poke, and
// what the hook recorded; the keeper pokes K about every 180 s with a 7,200 s TTL from its own key; F is never poked and
// charges its flat 700 pips; arbitrage and retail swaps land on D, K and F. Writes docs/evidence/live-check-<date>.json;
// exits 1 if a check fails. Usage: bun src/live/scripts/verify-live.ts
import { climFeePolicyAbi, climPokerAbi, LIVE_POOLS, pokeFeeHookAbi, poolManagerSwapEventAbi, riskDeskV2Abi } from "@clim/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envNum } from "../../lib/env";
import { liveClient, readLiveState } from "../lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "../lib/deployments";
import { median } from "../../lib/market";
import { chunkedRanges } from "../lib/tail";

const d = loadLiveDeployments();
const client = liveClient();
const head = await client.getBlockNumber();
const window = BigInt(envNum("WINDOW_BLOCKS", 18_000));
const from = head > window ? head - window : 0n;
const ranges = chunkedRanges(from, head);

async function collect<T>(get: (a: bigint, b: bigint) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const [a, b] of ranges) out.push(...(await get(a, b)));
  return out;
}

const checks: Record<string, { pass: boolean; detail: Record<string, unknown> }> = {};

// 1. desk: regular reports, seq + 1 each time
const reports = await collect((a, b) => client.getLogs({ address: d.riskDesk, event: riskDeskV2Abi[1], fromBlock: a, toBlock: b }));
const seqs = reports.map((r) => r.args.seq ?? 0);
const tObs = reports.map((r) => Number(r.args.tObs ?? 0));
const gaps = tObs.slice(1).map((t, i) => t - (tObs[i] ?? t));
const seqStep = seqs.slice(1).every((s, i) => s === (seqs[i] ?? 0) + 1);
checks.deskReports = {
  pass: reports.length >= 40 && seqStep && (gaps.length === 0 || Math.max(...gaps) <= 90),
  detail: { reports: reports.length, firstSeq: seqs[0] ?? null, lastSeq: seqs[seqs.length - 1] ?? null, seqStepsByOne: seqStep, maxGapSec: gaps.length ? Math.max(...gaps) : null, medianGapSec: gaps.length ? median(gaps) : null },
};

// 2. D follows the policy: every Poked matches the hook's directional FeePoked in the same tx; the last ten match the
//    policy's quote at their block
const pokes = await collect((a, b) => client.getLogs({ address: d.poker, event: climPokerAbi[1], fromBlock: a, toBlock: b }));
const hookD = await collect((a, b) => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[4], args: { poolId: d.pools.D.poolId }, fromBlock: a, toBlock: b }));
const byTx = new Map(hookD.map((l) => [l.transactionHash, l.args]));
const hookMatches = pokes.filter((p) => {
  const h = byTx.get(p.transactionHash);
  return h !== undefined && h.fee0For1 === p.args.fee0For1 && h.fee1For0 === p.args.fee1For0;
}).length;
let quoteMatches = 0;
const lastTen = pokes.slice(-10);
for (const p of lastTen) {
  const [q01, q10] = await client.readContract({ address: d.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional", blockNumber: p.blockNumber });
  if (p.args.eventApplied || (q01 === p.args.fee0For1 && q10 === p.args.fee1For0)) quoteMatches++;
}
checks.poolDFollowsPolicy = {
  pass: pokes.length >= 40 && hookMatches === pokes.length && quoteMatches >= Math.min(9, lastTen.length) && lastTen.length > 0,
  detail: { pokes: pokes.length, hookFeePokedMatches: hookMatches, lastTenMatchingQuote: quoteMatches, lastPoke: lastTen[lastTen.length - 1]?.args ?? null },
};

// 3. K: keeper pokes from the keeper's key, about every 180 s, TTL 7,200 s
const kPokes = await collect((a, b) => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[3], args: { poolId: d.pools.K.poolId }, fromBlock: a, toBlock: b }));
const kTimes: number[] = [];
let kFromKeeper = 0;
let kTtlOk = 0;
for (const l of kPokes) {
  const [tx, blk] = await Promise.all([client.getTransaction({ hash: l.transactionHash }), client.getBlock({ blockNumber: l.blockNumber })]);
  const t = Number(blk.timestamp);
  kTimes.push(t);
  if (tx.from.toLowerCase() === d.roles.keeper.toLowerCase()) kFromKeeper++;
  if (Number(l.args.expiry ?? 0) - t === 7_200) kTtlOk++;
}
const kGaps = kTimes.slice(1).map((t, i) => t - (kTimes[i] ?? t));
checks.poolKKeeperPattern = {
  pass: kPokes.length >= 5 && kFromKeeper === kPokes.length && kTtlOk === kPokes.length && (kGaps.length === 0 || (median(kGaps) >= 150 && median(kGaps) <= 210)),
  detail: { pokes: kPokes.length, fromKeeper: kFromKeeper, ttl7200: kTtlOk, medianGapSec: kGaps.length ? median(kGaps) : null, fees: kPokes.map((l) => l.args.fee) },
};

// 4. F: never poked in the window, flat fee both ways now
const fSym = await collect((a, b) => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[3], args: { poolId: d.pools.F.poolId }, fromBlock: a, toBlock: b }));
const fDir = await collect((a, b) => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[4], args: { poolId: d.pools.F.poolId }, fromBlock: a, toBlock: b }));
const state = await readLiveState(client, d, head);
checks.poolFFlat = {
  pass: fSym.length + fDir.length === 0 && state.pools.F.fee0For1 === d.hookConfig.flatPips && state.pools.F.fee1For0 === d.hookConfig.flatPips,
  detail: { pokes: fSym.length + fDir.length, fee0For1: state.pools.F.fee0For1, fee1For0: state.pools.F.fee1For0 },
};

// 5. swaps land: arbitrage (routers.arb) and retail (poolSwapTest) on each pool, with the fee each paid
const ids = LIVE_POOLS.map((n) => d.pools[n].poolId);
const swaps = await collect((a, b) =>
  client.getLogs({ address: d.uniswap.poolManager, event: poolManagerSwapEventAbi[0], args: { id: ids }, fromBlock: a, toBlock: b }),
);
const perPool: Record<string, { arb: number; retail: number; meanFeePips: number | null }> = {};
for (const n of LIVE_POOLS) {
  const mine = swaps.filter((s) => s.args.id === d.pools[n].poolId);
  const fees = mine.map((s) => s.args.fee ?? 0);
  perPool[n] = {
    arb: mine.filter((s) => s.args.sender?.toLowerCase() === d.routers.arb.toLowerCase()).length,
    retail: mine.filter((s) => s.args.sender?.toLowerCase() === d.uniswap.poolSwapTest.toLowerCase()).length,
    meanFeePips: fees.length ? fees.reduce((x, y) => x + y, 0) / fees.length : null,
  };
}
checks.swapsLand = {
  pass: LIVE_POOLS.every((n) => (perPool[n]?.retail ?? 0) > 0) && LIVE_POOLS.some((n) => (perPool[n]?.arb ?? 0) > 0),
  detail: perPool,
};

const date = new Date().toISOString().slice(0, 10);
const report = { generatedAt: new Date().toISOString(), chainId: d.chainId, fromBlock: from, toBlock: head, checks };
const dir = join(REPO_ROOT, "docs", "evidence");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `live-check-${date}.json`), `${JSON.stringify(report, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
for (const [name, c] of Object.entries(checks)) console.log(`${c.pass ? "PASS" : "FAIL"} ${name} ${JSON.stringify(c.detail, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`);
console.log(`wrote docs/evidence/live-check-${date}.json`);
process.exit(Object.values(checks).every((c) => c.pass) ? 0 : 1);
```

In `bots/package.json`, add after `"live:noise"`:

```json
    "live:fund": "bun src/live/scripts/fund.ts",
    "live:status": "bun src/live/scripts/status.ts",
    "live:gas": "bun src/live/scripts/gas.ts",
    "live:verify": "bun src/live/scripts/verify-live.ts",
```

- [ ] **Step 8: Typecheck, test, fund**

Run: `cd bots && bun test && bun run typecheck && bun run live:fund`
Expected: `0 fail`, `tsc` exits 0, then one `[fund] ... ready` line per key (the CRE operator already holds 0.1 ETH from Task 17 and the runner 0.02, so they get the difference) and the deployer's remaining balance (about 0.15 ETH). If `tsc` reports a type error on a `getLogs` event argument (`climPokerAbi[1]`, `pokeFeeHookAbi[3]` and `[4]` are the `Poked` and the two `FeePoked` events, `riskDeskV2Abi[1]` is `RiskReportedV2`), check the index against `shared/src/abisV2.ts`.

- [ ] **Step 9: Commit**

```bash
git add bots/src/live/lib/gas.ts bots/src/live/scripts/fund.ts bots/src/live/scripts/status.ts bots/src/live/scripts/gas.ts bots/src/live/scripts/verify-live.ts bots/test/live/gas.test.ts bots/package.json
git commit -m "feat(bots): live funding, status, gas evidence and final on-chain checks" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 23: Supervision and outage handling

The live stack runs on the maintainer's Mac, not on a server (his decision). The Mac sleeps whenever his Pauline app lets it (Pauline owns `pmset disablesleep`); it can also lose the network or reboot, and a process can crash. This task makes every such outage clean and visible. It adds nothing that keeps the Mac awake: no `caffeinate`, no `pmset`, no keep-awake step anywhere in this plan.

- **Supervision.** One launchd LaunchAgent per long-running process (`fi.clim-fables.desk`, `.runner`, `.keeper`, `.arb`, `.noise`, `.outages`), written by a tested plist generator: absolute `bun` and `cre` paths resolved at install time, absolute `WorkingDirectory` (`bots/`), `RunAtLoad` and `KeepAlive` (back after a reboot, a crash or an exit), `ThrottleInterval` 30 s, logs under `bots/out/logs/`, and only `HOME` and `PATH` in the plist: keys and RPC URLs stay in `bots/.env` and `cre/.env`, which the processes read as when started by hand. The agents are installed by the go-live task (Task 25), not before.
- **Resume.** Each process ticks on a timer of at most 10 s, so a wall-clock gap of more than 60 s between two firings means the Mac slept or the process was stopped. The process then re-syncs its nonce from the chain, re-reads the desk, and drops any action prepared before the gap (a keeper fee, an arbitrage or retail order sized on old prices) instead of sending it late. Failed ticks (an RPC error, the network down) back off from 2 s, doubling up to 60 s, and never crash the process. A blind desk is a normal skip for the runner, logged once per blind spell.
- **Outage record.** `bots/out/outages.json` lists the windows in which the desk sent no report for more than 90 s, derived from consecutive `RiskReportedV2` events (on-chain truth): `{from, to, durationSec, seqBefore, seqAfter}`, plus the local reason when the Mac recorded one (`bots/out/outages-local.jsonl`: a wake, a restart, a streak of RPC errors). Plan 04's app derives the same windows from the chain with `outageWindows()` of `@clim/shared` and shows them honestly, as measured: the live pools run on a laptop, and their gaps are published, not hidden.

What the pools do when the whole Mac stops (asleep, offline, rebooting), asserted by `contracts/test/v2/Outage.t.sol` on the deployed contracts' code (the bots' side by `bots/test/live/supervise.test.ts`). If only the desk fails while the Mac runs, the keeper bot keeps posting on K.

| Time after the last report's tObs | Desk and policy | Pool D (ClimPoker) | Pool K (keeper-style bot) | Pool F |
|---|---|---|---|---|
| 0 to 180 s | fresh (`tauKillSec` 180) | the last poke's fees | the last keeper poke | flat 700 pips |
| from 181 s | blind: `ClimPoker.poke()` reverts `DeskBlind`, the runner logs a skip | the last poke's fees until `tObs + 600` (the TTL is anchored to the observation) | the last keeper poke: the keeper bot is down too, and its poke lives up to 7,200 s | flat |
| from 600 s | blind | flat 700 pips, Fables' flat 7 bp | the last keeper poke until 7,200 s after it, then flat | flat |
| first report after the gap | a gap above `RESET_GAP` (180 s) is taken as is (absolute bounds only, no ramp from the stale sigma) | poked again after that report | posted again at once, from fresh 1 s data | flat |

**Files:**
- Create: `shared/src/outages.ts`, `bots/src/live/lib/supervise.ts`, `bots/src/live/lib/outages.ts`, `bots/src/live/lib/launchd.ts`, `bots/src/live/lib/supervisor.ts`, `bots/src/live/scripts/outages.ts`, `bots/src/live/scripts/launchd.ts`
- Modify: `shared/src/index.ts`, `shared/package.json`, `bots/src/live/runner.ts`, `bots/src/live/keeper.ts`, `bots/src/live/arb.ts`, `bots/src/live/noise.ts`, `bots/src/live/desk-loop.ts`, `bots/src/live/scripts/status.ts`, `bots/package.json`, `cre/scripts/sim-loop.sh`
- Test: `shared/test/outages.test.ts`, `bots/test/live/supervise.test.ts`, `bots/test/live/outages.test.ts`, `bots/test/live/launchd.test.ts`, `contracts/test/v2/Outage.t.sol`

- [ ] **Step 1: Write the failing test of the outage windows**

Create `shared/test/outages.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { OUTAGE_GAP_SEC, outageWindows } from "../src/index";

const T = 1_800_000_000;
const every30 = (n: number, seq0 = 1, t0 = T) => Array.from({ length: n }, (_, i) => ({ seq: seq0 + i, tObs: t0 + 30 * i }));

describe("outage windows from consecutive reports", () => {
  test("reports every 30 s: no window", () => {
    expect(OUTAGE_GAP_SEC).toBe(90);
    expect(outageWindows(every30(10))).toEqual([]);
    expect(outageWindows([])).toEqual([]);
  });
  test("a gap of exactly 90 s is not an outage, 91 s is", () => {
    expect(outageWindows([{ seq: 1, tObs: T }, { seq: 2, tObs: T + 90 }])).toEqual([]);
    expect(outageWindows([{ seq: 1, tObs: T }, { seq: 2, tObs: T + 91 }])).toEqual([
      { from: T, to: T + 91, durationSec: 91, seqBefore: 1, seqAfter: 2, ongoing: false },
    ]);
  });
  test("a 12-minute silence between seq 10 and 11", () => {
    const before = every30(10);
    const after = every30(5, 11, T + 270 + 720);
    expect(outageWindows([...before, ...after])).toEqual([
      { from: T + 270, to: T + 990, durationSec: 720, seqBefore: 10, seqAfter: 11, ongoing: false },
    ]);
  });
  test("an ongoing silence only when nowSec is given and the last report is more than 90 s old", () => {
    const r = every30(3);
    expect(outageWindows(r, { nowSec: T + 60 + 90 })).toEqual([]);
    expect(outageWindows(r, { nowSec: T + 60 + 400 })).toEqual([
      { from: T + 60, to: null, durationSec: 400, seqBefore: 3, seqAfter: null, ongoing: true },
    ]);
  });
  test("reports out of order throw", () => {
    expect(() => outageWindows([{ seq: 2, tObs: T }, { seq: 1, tObs: T + 30 }])).toThrow(/out of order/);
    expect(() => outageWindows([{ seq: 1, tObs: T }, { seq: 2, tObs: T }])).toThrow(/out of order/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd shared && bun test test/outages.test.ts`
Expected: FAIL with `SyntaxError: Export named 'OUTAGE_GAP_SEC' not found in module`.

- [ ] **Step 3: Implement the outage windows**

Create `shared/src/outages.ts`:

```ts
// Outage windows of the live desk, from on-chain truth only: consecutive RiskReportedV2 events (seq, tObs). The desk
// reports every 30 s, so a gap of more than OUTAGE_GAP_SEC between two reports' tObs is a window in which the desk was
// silent. Used by the bots' outage recorder (bots/out/outages.json) and by plan 04's app, which shows these windows as
// they are measured.

/** A gap of more than three report intervals (3 x 30 s) between two reports is an outage. */
export const OUTAGE_GAP_SEC = 90;

export type ReportPoint = { seq: number; tObs: number };

/** `from` is the tObs of the last report before the silence, `to` the tObs of the first one after it (null while the
 *  desk is still silent); the desk sent nothing strictly between them. */
export type OutageWindow = {
  from: number;
  to: number | null;
  durationSec: number;
  seqBefore: number;
  seqAfter: number | null;
  ongoing: boolean;
};

/** Windows between consecutive reports more than gapSec apart, plus an ongoing one when the last report is more than
 *  gapSec older than nowSec. Reports must come in seq order with increasing tObs. */
export function outageWindows(
  reports: readonly ReportPoint[],
  opts: { gapSec?: number; nowSec?: number } = {},
): OutageWindow[] {
  const gapSec = opts.gapSec ?? OUTAGE_GAP_SEC;
  const out: OutageWindow[] = [];
  for (let i = 1; i < reports.length; i++) {
    const a = reports[i - 1] as ReportPoint;
    const b = reports[i] as ReportPoint;
    if (b.seq <= a.seq || b.tObs <= a.tObs) throw new Error(`reports out of order at seq ${a.seq} -> ${b.seq}`);
    const gap = b.tObs - a.tObs;
    if (gap > gapSec) out.push({ from: a.tObs, to: b.tObs, durationSec: gap, seqBefore: a.seq, seqAfter: b.seq, ongoing: false });
  }
  const last = reports[reports.length - 1];
  if (last !== undefined && opts.nowSec !== undefined && opts.nowSec - last.tObs > gapSec) {
    out.push({ from: last.tObs, to: null, durationSec: opts.nowSec - last.tObs, seqBefore: last.seq, seqAfter: null, ongoing: true });
  }
  return out;
}
```

In `shared/src/index.ts`, add after `export * from "./live";`:

```ts
export * from "./outages";
```

In `shared/package.json`, add to `"exports"` after the `"./abis-v2"` line:

```json
    "./outages": "./src/outages.ts",
```

- [ ] **Step 4: Run the shared tests and the typecheck**

Run: `cd shared && bun test && bun run typecheck`
Expected: `0 fail` with 5 more tests than after Task 8 (77 in all), and `tsc` exits 0.

- [ ] **Step 5: Write the failing tests of the bots' outage handling**

Create `bots/test/live/supervise.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { backoffMs, isDeskBlindError, isStale, LoopGuard, WAKE_GAP_SEC } from "../../src/live/lib/supervise";

const T = 1_800_000_000_000;

describe("wall-clock jumps", () => {
  test("regular firings are not a jump; more than 60 s between two firings is", () => {
    expect(WAKE_GAP_SEC).toBe(60);
    const g = new LoopGuard();
    expect(g.beat(T)).toBeNull(); // first firing
    expect(g.beat(T + 2_000)).toBeNull();
    expect(g.beat(T + 62_000)).toBeNull(); // exactly 60 s
    expect(g.beat(T + 62_000 + 600_000)).toEqual({ fromMs: T + 62_000, toMs: T + 662_000, gapSec: 600 });
    expect(g.beat(T + 664_000)).toBeNull();
  });
  test("a resume lifts the backoff", () => {
    const g = new LoopGuard();
    g.beat(T);
    g.failure(T);
    g.failure(T);
    g.failure(T); // 8 s backoff
    expect(g.canRun(T + 1_000)).toBe(false);
    expect(g.beat(T + 300_000)).not.toBeNull();
    expect(g.canRun(T + 300_000)).toBe(true);
  });
});

describe("capped backoff", () => {
  test("2, 4, 8 ... s, capped at 60 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffMs(n))).toEqual([0, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });
  test("failures delay the next run; a success clears them", () => {
    const g = new LoopGuard();
    expect(g.failure(T)).toBe(2_000);
    expect(g.canRun(T + 1_999)).toBe(false);
    expect(g.canRun(T + 2_000)).toBe(true);
    expect(g.failure(T + 2_000)).toBe(4_000);
    expect(g.consecutiveFailures).toBe(2);
    expect(g.success(T + 6_000)).toBeNull(); // two failures: not an outage worth recording
    expect(g.consecutiveFailures).toBe(0);
    expect(g.canRun(T + 6_000)).toBe(true);
  });
  test("a streak of 3 or more failures is returned as an RPC outage when it ends", () => {
    const g = new LoopGuard();
    g.failure(T);
    g.failure(T + 2_000);
    g.failure(T + 6_000);
    expect(g.success(T + 14_000)).toEqual({ fromMs: T, toMs: T + 14_000, gapSec: 14 });
  });
});

describe("stale actions and the blind desk", () => {
  test("an action older than its limit is stale", () => {
    expect(isStale(T, T + 10_000, 10_000)).toBe(false);
    expect(isStale(T, T + 10_001, 10_000)).toBe(true);
  });
  test("DeskBlind, decoded or raw, is recognized", () => {
    expect(isDeskBlindError("reverted: DeskBlind")).toBe(true);
    expect(isDeskBlindError('execution reverted: custom error 0x5caf72fd')).toBe(true);
    expect(isDeskBlindError("reverted: AccessManagedUnauthorized")).toBe(false);
  });
});
```

Create `bots/test/live/outages.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { advanceOutages, attachLocalReasons, emptyOutageState, parseLocalOutages, summarizeReason, type LocalOutage } from "../../src/live/lib/outages";

const T = 1_800_000_000;
const reports = (seq0: number, t0: number, n: number) => Array.from({ length: n }, (_, i) => ({ seq: seq0 + i, tObs: t0 + 30 * i }));
const rec = (process: string, kind: LocalOutage["kind"], fromSec: number, toSec: number): LocalOutage => ({ ts: "2027-01-15T08:00:00.000Z", process, kind, fromSec, toSec, detail: "" });

describe("incremental outage scan", () => {
  test("windows found across two passes, the ongoing one recomputed", () => {
    const s0 = emptyOutageState(1_000);
    expect(s0).toEqual({ scannedToBlock: 999, reportCount: 0, lastReport: null, windows: [] });
    // pass 1: seq 1-10 every 30 s, then silence: ongoing at T + 270 + 400
    const p1 = advanceOutages(s0, reports(1, T, 10), 5_000, T + 670);
    expect(p1.state.reportCount).toBe(10);
    expect(p1.state.windows).toEqual([]);
    expect(p1.windows).toEqual([{ from: T + 270, to: null, durationSec: 400, seqBefore: 10, seqAfter: null, ongoing: true }]);
    // pass 2: the desk is back at T + 990 (seq 11): the window closes at 720 s
    const p2 = advanceOutages(p1.state, reports(11, T + 990, 3), 9_000, T + 1_060);
    expect(p2.state.scannedToBlock).toBe(9_000);
    expect(p2.state.lastReport).toEqual({ seq: 13, tObs: T + 1_050 });
    expect(p2.windows).toEqual([{ from: T + 270, to: T + 990, durationSec: 720, seqBefore: 10, seqAfter: 11, ongoing: false }]);
    expect(p2.state.windows).toEqual(p2.windows);
  });
  test("a hole in seq throws, so the range is rescanned", () => {
    const p1 = advanceOutages(emptyOutageState(0), reports(1, T, 3), 100, T + 90);
    expect(() => advanceOutages(p1.state, reports(5, T + 120, 2), 200, T + 160)).toThrow(/missing reports between seq 3 and 5/);
  });
});

describe("local reasons", () => {
  test("parse skips malformed lines", () => {
    const text = [JSON.stringify(rec("runner", "wake", T, T + 600)), "not json", JSON.stringify({ ts: "x", process: "arb", kind: "nap", fromSec: 1, toSec: 2 }), ""].join("\n");
    expect(parseLocalOutages(text)).toEqual([rec("runner", "wake", T, T + 600)]);
  });
  test("the most telling kind wins", () => {
    expect(summarizeReason([rec("runner", "restart", 0, 1), rec("desk", "wake", 0, 1), rec("arb", "wake", 0, 1)])).toBe(
      "wall-clock gap seen by arb, desk: the Mac was asleep or the processes were suspended",
    );
    expect(summarizeReason([rec("noise", "restart", 0, 1), rec("desk", "restart", 0, 1)])).toBe("processes stopped and restarted: desk, noise");
    expect(summarizeReason([rec("runner", "rpc-errors", 0, 1)])).toBe("RPC or network errors in runner");
    expect(summarizeReason([])).toMatch(/^unknown/);
  });
  test("records overlapping a window (60 s slack) are attached to it", () => {
    const w = { from: T + 270, to: T + 990, durationSec: 720, seqBefore: 10, seqAfter: 11, ongoing: false };
    const local = [rec("desk", "wake", T + 280, T + 980), rec("runner", "wake", T - 5_000, T - 4_000), rec("arb", "restart", T + 1_040, T + 1_045)];
    const [x] = attachLocalReasons([w], local, T + 2_000);
    expect(x?.local.map((r) => r.process)).toEqual(["desk", "arb"]);
    expect(x?.reason).toMatch(/^wall-clock gap seen by desk/);
  });
});
```

Create `bots/test/live/launchd.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobLabel, jobPathVar, LIVE_JOB_NAMES, liveJobSpec, parseLaunchctlPrint, plistFor, type JobPaths } from "../../src/live/lib/launchd";

const P: JobPaths = { bun: "/opt/homebrew/bin/bun", cre: "/Users/me/.cre/bin/cre", botsDir: "/Users/me/clim-fables/bots", home: "/Users/me" };

describe("launchd job specs", () => {
  test("six jobs, labelled fi.clim-fables.<name>", () => {
    expect(LIVE_JOB_NAMES).toEqual(["desk", "runner", "keeper", "arb", "noise", "outages"]);
    expect(jobLabel("runner")).toBe("fi.clim-fables.runner");
  });
  test("absolute bun and cre, absolute scripts, logs under bots/out/logs", () => {
    const desk = liveJobSpec("desk", P);
    expect(desk.programArguments).toEqual([
      "/opt/homebrew/bin/bun",
      "/Users/me/clim-fables/bots/src/live/desk-loop.ts",
      "--target",
      "rh-testnet-settings",
      "--cre-bin",
      "/Users/me/.cre/bin/cre",
    ]);
    expect(desk.workingDirectory).toBe("/Users/me/clim-fables/bots");
    expect(desk.stdoutPath).toBe("/Users/me/clim-fables/bots/out/logs/desk.log");
    expect(desk.stderrPath).toBe("/Users/me/clim-fables/bots/out/logs/desk.err.log");
    expect(liveJobSpec("outages", P).programArguments.slice(1)).toEqual(["/Users/me/clim-fables/bots/src/live/scripts/outages.ts", "--watch"]);
  });
  test("PATH: bun's and cre's folders first, no duplicates", () => {
    expect(jobPathVar(P)).toBe("/opt/homebrew/bin:/Users/me/.cre/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });
});

describe("plist", () => {
  const plist = plistFor(liveJobSpec("runner", P));
  test("keep-alive job with a 30 s throttle", () => {
    expect(plist).toContain("<key>Label</key>\n\t<string>fi.clim-fables.runner</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n\t<true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n\t<true/>");
    expect(plist).toContain("<key>ThrottleInterval</key>\n\t<integer>30</integer>");
    expect(plist).toContain("<string>/Users/me/clim-fables/bots/src/live/runner.ts</string>");
  });
  test("no secret: only HOME and PATH, and a key-like variable is refused", () => {
    expect(plist).not.toMatch(/KEY|RPC|SECRET|TOKEN/);
    const spec = liveJobSpec("runner", P);
    expect(() => plistFor({ ...spec, env: { ...spec.env, RUNNER_PRIVATE_KEY: "0x00" } })).toThrow(/must not be in a plist/);
  });
  test("relative paths are refused; XML is escaped", () => {
    const spec = liveJobSpec("arb", P);
    expect(() => plistFor({ ...spec, workingDirectory: "bots" })).toThrow(/absolute/);
    expect(() => plistFor({ ...spec, programArguments: ["bun", "src/live/arb.ts"] })).toThrow(/absolute/);
    expect(plistFor({ ...spec, workingDirectory: "/tmp/a&b" })).toContain("<string>/tmp/a&amp;b</string>");
  });
  test.skipIf(process.platform !== "darwin")("plutil accepts it", () => {
    const f = join(mkdtempSync(join(tmpdir(), "clim-plist-")), "job.plist");
    writeFileSync(f, plist);
    const r = spawnSync("plutil", ["-lint", f], { encoding: "utf8" });
    expect(r.stdout).toContain("OK");
  });
});

describe("launchctl print", () => {
  test("state, pid and last exit code of the top-level job", () => {
    const running = "gui/501/fi.clim-fables.runner = {\n\tactive count = 1\n\tstate = running\n\n\tprogram = /opt/homebrew/bin/bun\n\tpid = 4242\n\tlast exit code = (never exited)\n\tjob state = running\n}\n";
    expect(parseLaunchctlPrint(running)).toEqual({ state: "running", pid: 4242, lastExitCode: "(never exited)" });
    const waiting = "gui/501/fi.clim-fables.desk = {\n\tstate = not running\n\tlast exit code = 1\n\tjob state = exited\n}\n";
    expect(parseLaunchctlPrint(waiting)).toEqual({ state: "not running", pid: null, lastExitCode: "1" });
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `cd bots && bun test test/live/supervise.test.ts test/live/outages.test.ts test/live/launchd.test.ts`
Expected: FAIL with `Cannot find module '../../src/live/lib/supervise'` (and the same for `outages` and `launchd`).

- [ ] **Step 7: Implement the pure parts**

Create `bots/src/live/lib/supervise.ts`:

```ts
// Outage handling of the live processes, pure parts. The stack runs on the maintainer's Mac: it may sleep, lose the
// network, reboot, or a process may crash (launchd restarts it). Each process ticks on a timer; a wall-clock gap of more
// than WAKE_GAP_SEC between two timer firings means the Mac slept or the process was stopped, and the process then
// re-syncs its nonce and re-reads the chain before acting. Failed ticks back off (capped) instead of crashing.

/** Timer firings are at most 10 s apart in every process, so a gap of more than 60 s is a sleep or a stop. */
export const WAKE_GAP_SEC = 60;

export type ClockGap = { fromMs: number; toMs: number; gapSec: number };
export type LoopGuardOptions = { wakeGapSec: number; baseMs: number; capMs: number; recordAfterFailures: number };

const DEFAULTS: LoopGuardOptions = { wakeGapSec: WAKE_GAP_SEC, baseMs: 2_000, capMs: 60_000, recordAfterFailures: 3 };

/** Delay before the next try after `failures` consecutive failures: base, 2 x base, 4 x base, ... capped. */
export function backoffMs(failures: number, baseMs = DEFAULTS.baseMs, capMs = DEFAULTS.capMs): number {
  if (failures <= 0) return 0;
  return Math.min(capMs, baseMs * 2 ** (failures - 1));
}

/** True when an action prepared at startedMs is too old to send at nowMs (the Mac may have slept in between). */
export function isStale(startedMs: number, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - startedMs > maxAgeMs;
}

/** ClimPoker's DeskBlind() revert (selector 0x5caf72fd), decoded or raw: a normal skip, not an error. */
export function isDeskBlindError(text: string): boolean {
  return /DeskBlind|0x5caf72fd/.test(text);
}

/** Per-process state machine: wall-clock jumps, consecutive failures and the backoff they impose. */
export class LoopGuard {
  private readonly o: LoopGuardOptions;
  private lastBeatMs: number | null = null;
  private failures = 0;
  private firstFailureMs: number | null = null;
  private notBeforeMs = 0;

  constructor(options: Partial<LoopGuardOptions> = {}) {
    this.o = { ...DEFAULTS, ...options };
  }

  /** Call on every timer firing. Returns the gap when this firing follows a wall-clock jump, else null. A resume
   *  lifts any backoff, so the process acts on fresh state at once. */
  beat(nowMs: number): ClockGap | null {
    const prev = this.lastBeatMs;
    this.lastBeatMs = nowMs;
    if (prev === null || nowMs - prev <= this.o.wakeGapSec * 1_000) return null;
    this.notBeforeMs = 0;
    return { fromMs: prev, toMs: nowMs, gapSec: Math.round((nowMs - prev) / 1_000) };
  }

  /** False while a backoff is running. */
  canRun(nowMs: number): boolean {
    return nowMs >= this.notBeforeMs;
  }

  /** Records a failed tick; returns the backoff delay before the next try. */
  failure(nowMs: number): number {
    this.failures += 1;
    this.firstFailureMs ??= nowMs;
    const delay = backoffMs(this.failures, this.o.baseMs, this.o.capMs);
    this.notBeforeMs = nowMs + delay;
    return delay;
  }

  /** Records a good tick; returns the span of the failure streak it ends when the streak had at least
   *  recordAfterFailures failures (an RPC or network outage worth recording), else null. */
  success(nowMs: number): ClockGap | null {
    const failures = this.failures;
    const first = this.firstFailureMs;
    this.failures = 0;
    this.firstFailureMs = null;
    this.notBeforeMs = 0;
    if (first === null || failures < this.o.recordAfterFailures) return null;
    return { fromMs: first, toMs: nowMs, gapSec: Math.round((nowMs - first) / 1_000) };
  }

  get consecutiveFailures(): number {
    return this.failures;
  }
}
```

Create `bots/src/live/lib/outages.ts`:

```ts
// Outage record of the live stack, pure parts. The windows come from the chain (shared/src/outages.ts: consecutive
// RiskReportedV2 events); the local reasons come from bots/out/outages-local.jsonl, where each process writes what it saw
// (a wall-clock jump on wake, a restart, a streak of RPC errors). A window keeps every local record that overlaps it.
import { OUTAGE_GAP_SEC, outageWindows, type OutageWindow, type ReportPoint } from "@clim/shared";

export type LocalOutageKind = "wake" | "restart" | "rpc-errors";
/** One line of bots/out/outages-local.jsonl: [fromSec, toSec] is when `process` was not acting. */
export type LocalOutage = { ts: string; process: string; kind: LocalOutageKind; fromSec: number; toSec: number; detail: string };
export type ExplainedWindow = OutageWindow & { reason: string; local: LocalOutage[] };

/** Scan state kept in bots/out/outages.json between passes: closed windows only, the last report, the scanned range. */
export type OutageState = { scannedToBlock: number; reportCount: number; lastReport: ReportPoint | null; windows: OutageWindow[] };

const KINDS: readonly LocalOutageKind[] = ["wake", "restart", "rpc-errors"];

export function emptyOutageState(deployBlock: number): OutageState {
  return { scannedToBlock: deployBlock - 1, reportCount: 0, lastReport: null, windows: [] };
}

/** Adds the reports of a new block range. Reports must continue the previous ones seq by seq (a hole means a lost
 *  getLogs page: the pass throws and the next one rescans the same range). Returns the new state and every window,
 *  the ongoing one (if any) last. */
export function advanceOutages(
  prev: OutageState,
  newReports: readonly ReportPoint[],
  scannedToBlock: number,
  nowSec: number,
  gapSec = OUTAGE_GAP_SEC,
): { state: OutageState; windows: OutageWindow[] } {
  const series = prev.lastReport ? [prev.lastReport, ...newReports] : [...newReports];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1] as ReportPoint;
    const b = series[i] as ReportPoint;
    if (b.seq !== a.seq + 1) throw new Error(`missing reports between seq ${a.seq} and ${b.seq}`);
  }
  const found = outageWindows(series, { gapSec, nowSec });
  const closed = [...prev.windows, ...found.filter((w) => !w.ongoing)];
  const state: OutageState = {
    scannedToBlock,
    reportCount: prev.reportCount + newReports.length,
    lastReport: series[series.length - 1] ?? null,
    windows: closed,
  };
  return { state, windows: [...closed, ...found.filter((w) => w.ongoing)] };
}

/** Parses outages-local.jsonl; malformed lines are skipped. */
export function parseLocalOutages(text: string): LocalOutage[] {
  const out: LocalOutage[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const o = JSON.parse(line) as Partial<LocalOutage>;
      if (
        typeof o.ts === "string" &&
        typeof o.process === "string" &&
        KINDS.includes(o.kind as LocalOutageKind) &&
        typeof o.fromSec === "number" &&
        typeof o.toSec === "number"
      ) {
        out.push({ ts: o.ts, process: o.process, kind: o.kind as LocalOutageKind, fromSec: o.fromSec, toSec: o.toSec, detail: typeof o.detail === "string" ? o.detail : "" });
      }
    } catch {
      // not JSON: skip
    }
  }
  return out;
}

/** One sentence for a window from the local records that overlap it; the most telling kind wins. */
export function summarizeReason(local: readonly LocalOutage[]): string {
  const who = (k: LocalOutageKind) => [...new Set(local.filter((r) => r.kind === k).map((r) => r.process))].sort().join(", ");
  if (local.some((r) => r.kind === "wake")) return `wall-clock gap seen by ${who("wake")}: the Mac was asleep or the processes were suspended`;
  if (local.some((r) => r.kind === "restart")) return `processes stopped and restarted: ${who("restart")}`;
  if (local.some((r) => r.kind === "rpc-errors")) return `RPC or network errors in ${who("rpc-errors")}`;
  return "unknown: no local record (the CRE runs failed, or the Mac's records are missing)";
}

/** Attaches to each window the local records overlapping [from - slackSec, to + slackSec] (to = now when ongoing). */
export function attachLocalReasons(windows: readonly OutageWindow[], local: readonly LocalOutage[], nowSec: number, slackSec = 60): ExplainedWindow[] {
  return windows.map((w) => {
    const end = (w.to ?? nowSec) + slackSec;
    const mine = local.filter((r) => r.toSec >= w.from - slackSec && r.fromSec <= end);
    return { ...w, reason: summarizeReason(mine), local: mine };
  });
}
```

Create `bots/src/live/lib/launchd.ts`:

```ts
// launchd LaunchAgents of the live stack (one per long-running process), on the maintainer's Mac. The plist generator
// and the `launchctl print` parser are pure; jobState() and guiDomain() are the thin system calls. Plists hold no secret:
// each process reads bots/.env (Bun, from its WorkingDirectory bots/) or cre/.env (the CRE CLI) as when started by hand.
// RunAtLoad and KeepAlive bring every job back after a reboot (the plists stay in ~/Library/LaunchAgents) and after a
// crash (no sooner than ThrottleInterval after its last start). Nothing here keeps the Mac awake: sleep is the
// maintainer's (his Pauline app), and outages are recorded (scripts/outages.ts), not prevented.
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";

export const LABEL_PREFIX = "fi.clim-fables.";
export const THROTTLE_SEC = 30;
export const LIVE_JOB_NAMES = ["desk", "runner", "keeper", "arb", "noise", "outages"] as const;
export type LiveJobName = (typeof LIVE_JOB_NAMES)[number];

/** Absolute paths resolved at install time. */
export type JobPaths = { bun: string; cre: string; botsDir: string; home: string };
export type JobSpec = {
  label: string;
  programArguments: string[];
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  env: Record<string, string>;
};

/** The only variables a plist may carry; anything else (a key, an RPC URL) stays in the .env files. */
export const PLIST_ENV_ALLOWED = ["HOME", "PATH"] as const;
const SYSTEM_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function jobLabel(name: LiveJobName): string {
  return `${LABEL_PREFIX}${name}`;
}

export function isLiveJobName(s: string): s is LiveJobName {
  return (LIVE_JOB_NAMES as readonly string[]).includes(s);
}

/** PATH for the jobs: bun's and cre's folders first (cre workflow build runs bun), then the system folders. */
export function jobPathVar(p: JobPaths): string {
  return [...new Set([dirname(p.bun), dirname(p.cre), ...SYSTEM_PATH])].join(":");
}

export function jobArgs(name: LiveJobName, p: JobPaths): string[] {
  const src = (f: string) => join(p.botsDir, "src", "live", f);
  switch (name) {
    case "desk":
      return [p.bun, src("desk-loop.ts"), "--target", "rh-testnet-settings", "--cre-bin", p.cre];
    case "runner":
      return [p.bun, src("runner.ts")];
    case "keeper":
      return [p.bun, src("keeper.ts")];
    case "arb":
      return [p.bun, src("arb.ts")];
    case "noise":
      return [p.bun, src("noise.ts")];
    case "outages":
      return [p.bun, src("scripts/outages.ts"), "--watch"];
  }
}

export function logPaths(name: LiveJobName, botsDir: string): { stdout: string; stderr: string } {
  const dir = join(botsDir, "out", "logs");
  return { stdout: join(dir, `${name}.log`), stderr: join(dir, `${name}.err.log`) };
}

export function liveJobSpec(name: LiveJobName, p: JobPaths): JobSpec {
  const logs = logPaths(name, p.botsDir);
  return {
    label: jobLabel(name),
    programArguments: jobArgs(name, p),
    workingDirectory: p.botsDir,
    stdoutPath: logs.stdout,
    stderrPath: logs.stderr,
    env: { HOME: p.home, PATH: jobPathVar(p) },
  };
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The plist of one job. Throws on a relative path or an environment variable outside PLIST_ENV_ALLOWED. */
export function plistFor(spec: JobSpec): string {
  if (!spec.label.startsWith(LABEL_PREFIX)) throw new Error(`label must start with ${LABEL_PREFIX}: ${spec.label}`);
  const [program] = spec.programArguments;
  for (const [what, path] of [
    ["program", program ?? ""],
    ["WorkingDirectory", spec.workingDirectory],
    ["StandardOutPath", spec.stdoutPath],
    ["StandardErrorPath", spec.stderrPath],
  ] as const) {
    if (!isAbsolute(path)) throw new Error(`${what} must be an absolute path, got "${path}"`);
  }
  for (const k of Object.keys(spec.env)) {
    if (!(PLIST_ENV_ALLOWED as readonly string[]).includes(k)) throw new Error(`${k} must not be in a plist (secrets and settings stay in the .env files)`);
  }
  const str = (s: string) => `<string>${xml(s)}</string>`;
  const env = Object.keys(spec.env)
    .sort()
    .map((k) => `\t\t<key>${xml(k)}</key>\n\t\t${str(spec.env[k] ?? "")}`)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `\t<key>Label</key>\n\t${str(spec.label)}`,
    `\t<key>ProgramArguments</key>\n\t<array>\n${spec.programArguments.map((a) => `\t\t${str(a)}`).join("\n")}\n\t</array>`,
    `\t<key>WorkingDirectory</key>\n\t${str(spec.workingDirectory)}`,
    `\t<key>EnvironmentVariables</key>\n\t<dict>\n${env}\n\t</dict>`,
    "\t<key>RunAtLoad</key>\n\t<true/>",
    "\t<key>KeepAlive</key>\n\t<true/>",
    `\t<key>ThrottleInterval</key>\n\t<integer>${THROTTLE_SEC}</integer>`,
    `\t<key>StandardOutPath</key>\n\t${str(spec.stdoutPath)}`,
    `\t<key>StandardErrorPath</key>\n\t${str(spec.stderrPath)}`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export type JobState = { state: string | null; pid: number | null; lastExitCode: string | null };

/** The top-level state, pid and last exit code from `launchctl print gui/<uid>/<label>`. */
export function parseLaunchctlPrint(text: string): JobState {
  // top-level fields are indented by one tab; nested blocks by two ("job state" is another field)
  const field = (name: string) => new RegExp(`^\\t${name} = (.+)$`, "m").exec(text)?.[1]?.trim() ?? null;
  const pid = field("pid");
  return { state: field("state"), pid: pid !== null && /^\d+$/.test(pid) ? Number(pid) : null, lastExitCode: field("last exit code") };
}

export function guiDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("launchd jobs need macOS (no uid)");
  return `gui/${uid}`;
}

/** The job's state, or null when it is not loaded. */
export function jobState(name: LiveJobName): JobState | null {
  const r = spawnSync("launchctl", ["print", `${guiDomain()}/${jobLabel(name)}`], { encoding: "utf8" });
  return r.status === 0 ? parseLaunchctlPrint(r.stdout) : null;
}
```

- [ ] **Step 8: Run the tests**

Run: `cd bots && bun test test/live/supervise.test.ts test/live/outages.test.ts test/live/launchd.test.ts`
Expected: `20 pass` (supervise 7, outages 5, launchd 8; the `plutil -lint` test runs on macOS only and prints `OK`).

- [ ] **Step 9: Write the supervised loop**

Create `bots/src/live/lib/supervisor.ts`:

```ts
// Outage handling of the live processes, the side-effect parts: the supervised tick loop, the local outage records
// (bots/out/outages-local.jsonl) and the nonce re-sync. The decisions are in supervise.ts (pure, tested).
import { join } from "node:path";
import { appendJsonl, OUT_DIR, shortError } from "../../lib/jsonl";
import type { LiveWallet } from "./chain";
import type { LocalOutageKind } from "./outages";
import { LoopGuard, type ClockGap } from "./supervise";
import { lastTs } from "./tail";

export const LOCAL_OUTAGES_FILE = join(OUT_DIR, "outages-local.jsonl");

export function recordLocalOutage(process: string, kind: LocalOutageKind, fromMs: number, toMs: number, detail: string): void {
  appendJsonl(LOCAL_OUTAGES_FILE, {
    ts: new Date().toISOString(),
    process,
    kind,
    fromSec: Math.floor(fromMs / 1_000),
    toSec: Math.floor(toMs / 1_000),
    detail,
  });
}

/** At start: if the process logged before, it was down from its last log line until now (a crash, a reboot, a stop). */
export function recordStart(process: string, logFile: string): void {
  const last = lastTs(logFile);
  const now = Date.now();
  if (last === null) return;
  const lastMs = Date.parse(last);
  if (Number.isFinite(lastMs) && lastMs < now) {
    recordLocalOutage(process, "restart", lastMs, now, `started; last log line at ${last}`);
  }
}

/** Drops the cached nonce, so the next transaction reads it from the chain (pending block). */
export function resyncNonce(wallet: LiveWallet): void {
  wallet.account.nonceManager?.reset({ address: wallet.account.address, chainId: wallet.chain.id });
}

export type SupervisedLoop = {
  /** Process name in the local records: desk, runner, keeper, arb, noise, outages. */
  name: string;
  /** The process's JSON-lines log (its last line dates a restart). */
  logFile: string;
  /** Timer period; at most 10 s so that a gap of more than 60 s can only be a sleep or a stop. */
  everyMs: number;
  /** One iteration; throwing counts as a failure (capped backoff), never a crash. */
  tick: () => Promise<void>;
  /** After a wall-clock jump, before the next tick (the nonce is already re-synced). */
  onResume?: (gap: ClockGap) => Promise<void> | void;
  /** The wallet whose nonce is re-synced after a jump and after every failed tick. */
  wallet?: LiveWallet;
  /** Run a tick at once instead of after the first period. */
  immediate?: boolean;
};

/** Runs `tick` every `everyMs`, one at a time, with wake detection, nonce re-sync and capped backoff. */
export function runSupervised(l: SupervisedLoop): void {
  const guard = new LoopGuard();
  let busy = false;
  let resume: ClockGap | null = null;
  recordStart(l.name, l.logFile);
  const fire = (): void => {
    const now = Date.now();
    const gap = guard.beat(now);
    if (gap) {
      resume = gap;
      recordLocalOutage(l.name, "wake", gap.fromMs, gap.toMs, `wall-clock gap of ${gap.gapSec} s between two timer firings`);
      console.log(`[${l.name}] resumed after a ${gap.gapSec} s wall-clock gap (Mac asleep or process stopped): re-syncing`);
    }
    if (busy || !guard.canRun(now)) return;
    busy = true;
    const pending = resume;
    resume = null;
    (async () => {
      if (pending) {
        if (l.wallet) resyncNonce(l.wallet);
        await l.onResume?.(pending);
      }
      await l.tick();
    })()
      .then(
        () => {
          const streak = guard.success(Date.now());
          if (streak) {
            recordLocalOutage(l.name, "rpc-errors", streak.fromMs, streak.toMs, `failing ticks for ${streak.gapSec} s, recovered`);
            console.log(`[${l.name}] recovered after ${streak.gapSec} s of failing ticks`);
          }
        },
        (e: unknown) => {
          if (pending) resume = resume ?? pending; // the resume did not complete: redo it on the next tick
          if (l.wallet) resyncNonce(l.wallet);
          const delay = guard.failure(Date.now());
          console.error(`[${l.name}] ${shortError(e)}; failure ${guard.consecutiveFailures}, next try in ${delay / 1_000} s`);
        },
      )
      .finally(() => {
        busy = false;
      });
  };
  if (l.immediate) fire();
  setInterval(fire, l.everyMs);
}

/** Wake detection alone, for the desk loop (its CRE runs are separate processes that read their nonce every run). */
export function watchClock(name: string, onGap: (gap: ClockGap) => void, everyMs = 5_000): void {
  const guard = new LoopGuard();
  guard.beat(Date.now());
  setInterval(() => {
    const gap = guard.beat(Date.now());
    if (!gap) return;
    recordLocalOutage(name, "wake", gap.fromMs, gap.toMs, `wall-clock gap of ${gap.gapSec} s between two timer firings`);
    console.log(`[${name}] resumed after a ${gap.gapSec} s wall-clock gap (Mac asleep or process stopped)`);
    onGap(gap);
  }, everyMs);
}
```

- [ ] **Step 10: Resume handling in the runner, the keeper, the arbitrage and the retail bots**

Each bot keeps its Task 19 to 21 behaviour; the `setInterval` loop becomes `runSupervised`, errors are thrown to it (logged first), receipts wait at most 60 s, and actions prepared before a gap are dropped. The arbitrage bot polls the block number through the same loop instead of `watchBlockNumber` (same 2 s period, same "new block only" rule).

Replace `bots/src/live/runner.ts` with:

```ts
// clim's runner on Robinhood Chain testnet (CLIM_RUNNER on our AccessManager): after each new desk report, call
// ClimPoker.poke() so pool D's fee follows clim's policy. The fee comes from the policy, never from this key.
// Outages (plan 03 Task 23): a blind desk is a normal skip, logged once per blind spell (ClimPoker would revert
// DeskBlind, and a DeskBlind revert met anyway is logged the same way); after a wall-clock jump the nonce is re-synced and
// the desk re-read; failed ticks back off (2 s doubling to 60 s). A poke never carries a stale fee: ClimPoker reads the
// policy when the transaction runs.
// Usage: bun src/live/runner.ts     Log: bots/out/runner-rh.jsonl     Env: RUNNER_POLL_MS (default 2000)
import { climFeePolicyAbi, climPokerAbi, FeeMode, riskDeskV2Abi } from "@clim/shared";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { liveClient, liveWallet } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { pokeDecision } from "./lib/runner";
import { isDeskBlindError } from "./lib/supervise";
import { runSupervised } from "./lib/supervisor";

const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("runner"));
const logFile = join(OUT_DIR, "runner-rh.jsonl");
let lastSeq = 0;
let blindLogged = false;

async function readDesk() {
  return client.multicall({
    allowFailure: false,
    contracts: [
      { address: d.riskDesk, abi: riskDeskV2Abi, functionName: "state" },
      { address: d.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional" },
    ],
  });
}

async function tick(): Promise<void> {
  const [st, q] = await readDesk();
  const seq = st[6];
  const base = { ts: new Date().toISOString(), seq, tObs: st[0], quote0For1: q[0], quote1For0: q[1], mode: q[2] };
  if (q[2] === FeeMode.Blind) {
    // No report for more than tauKillSec: no poke. Pool D keeps its last override until it expires, then its flat fee.
    if (!blindLogged) {
      appendJsonl(logFile, { ...base, action: "skip", reason: "desk blind", deskAgeSec: Math.floor(Date.now() / 1000) - st[0] });
      console.log(`[runner] seq ${seq}: desk blind, no poke until the next report`);
      blindLogged = true;
    }
    lastSeq = Math.max(lastSeq, seq);
    return;
  }
  blindLogged = false;
  if (pokeDecision(seq, lastSeq, q[2]) !== "poke") return;
  try {
    const { request } = await client.simulateContract({ account: wallet.account, address: d.poker, abi: climPokerAbi, functionName: "poke" });
    const hash = await wallet.writeContract(request);
    const r = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const ev = parseEventLogs({ abi: climPokerAbi, eventName: "Poked", logs: r.logs })[0]?.args;
    appendJsonl(logFile, {
      ...base,
      action: "poke",
      txHash: hash,
      status: r.status,
      block: r.blockNumber,
      gasUsed: r.gasUsed,
      effectiveGasPrice: r.effectiveGasPrice,
      fee0For1: ev?.fee0For1 ?? null,
      fee1For0: ev?.fee1For0 ?? null,
      eventApplied: ev?.eventApplied ?? null,
      expiry: ev?.expiry ?? null,
    });
    console.log(`[runner] seq ${seq} poked ${ev?.fee0For1}/${ev?.fee1For0} pips, tx ${hash}, gas ${r.gasUsed}`);
    lastSeq = seq;
  } catch (e) {
    const error = shortError(e);
    if (isDeskBlindError(error)) {
      // the desk went blind between the read and the poke: the same skip as above
      appendJsonl(logFile, { ...base, action: "skip", reason: "desk blind (DeskBlind revert)" });
      console.log(`[runner] seq ${seq}: DeskBlind, no poke`);
      blindLogged = true;
      lastSeq = seq;
      return;
    }
    appendJsonl(logFile, { ...base, action: "error", error });
    throw e; // the supervisor re-syncs the nonce and backs off
  }
}

console.log(`[runner] ${wallet.account.address} pokes ${d.poker} (pool D ${d.pools.D.poolId}) after each report of ${d.riskDesk}`);
runSupervised({
  name: "runner",
  logFile,
  everyMs: envNum("RUNNER_POLL_MS", 2_000),
  wallet,
  immediate: true,
  tick,
  onResume: async (gap) => {
    const [st, q] = await readDesk();
    const age = Math.floor(Date.now() / 1000) - st[0];
    appendJsonl(logFile, { ts: new Date().toISOString(), action: "resume", gapSec: gap.gapSec, seq: st[6], deskAgeSec: age, mode: q[2] });
    console.log(`[runner] after ${gap.gapSec} s: desk seq ${st[6]}, last report ${age} s old, policy mode ${q[2]}`);
  },
});
```

Replace `bots/src/live/keeper.ts` with:

```ts
// Keeper-style twin for pool K on Robinhood Chain testnet. It imitates the pattern observed on Fables' ETH/USDG pool,
// not Fables' code: about every 180 s, the fee shared/keeper-map-fables.json gives at the current 5-minute realized
// volatility (Binance 1 s, 5 s returns), posted with pokeFee(poolK, fee, 7200) on PokeFeeHook (FEE_POKER).
// Outages (plan 03 Task 23): while this process is stopped or the Mac sleeps, K keeps its last poke until its 7,200 s TTL
// ends, then its flat fee. After a wall-clock jump the nonce is re-synced and the keeper posts at once from fresh data;
// a fee computed more than 15 s before it is sent is dropped, never sent late; failed ticks back off (2 s doubling to 60 s).
// Usage: bun src/live/keeper.ts     Log: bots/out/keeper-rh.jsonl     Env: KEEPER_SEED (jitter, default 7)
import { pokeFeeHookAbi } from "@clim/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { mulberry32 } from "../lib/rng";
import { liveClient, liveWallet } from "./lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { keeperFeePips, nextPostAt, parseKeeperMap, rv5From1s } from "./lib/keeper";
import { isStale } from "./lib/supervise";
import { runSupervised } from "./lib/supervisor";

const BINANCE_1S = "https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=400";
const MAX_FEE_AGE_MS = 15_000;
const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("keeper"));
const map = parseKeeperMap(JSON.parse(readFileSync(join(REPO_ROOT, "shared", "keeper-map-fables.json"), "utf8")));
const rand = mulberry32(envNum("KEEPER_SEED", 7));
const logFile = join(OUT_DIR, "keeper-rh.jsonl");
let nextAt = 0;

async function tick(): Promise<void> {
  const startedMs = Date.now();
  const now = Math.floor(startedMs / 1000);
  if (now < nextAt) return;
  const base = { ts: new Date().toISOString(), poolId: d.pools.K.poolId };
  try {
    const res = await fetch(BINANCE_1S, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`binance 1s: HTTP ${res.status}`);
    const sigma = rv5From1s(await res.json(), now);
    const fee = keeperFeePips(map, sigma);
    const sigmaPctYr = sigma * Math.sqrt(31_536_000) * 100;
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: d.hook,
      abi: pokeFeeHookAbi,
      functionName: "pokeFee",
      args: [d.pools.K.poolId, fee, map.ttlSec],
    });
    if (isStale(startedMs, Date.now(), MAX_FEE_AGE_MS)) {
      appendJsonl(logFile, { ...base, action: "skip", reason: "stale fee (computed more than 15 s ago)", sigmaPctYr, fee });
      console.log(`[keeper] fee ${fee} computed ${Math.round((Date.now() - startedMs) / 1000)} s ago: dropped, recomputing`);
      return; // nextAt unchanged: the next tick recomputes from fresh data
    }
    const hash = await wallet.writeContract(request);
    const r = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    appendJsonl(logFile, { ...base, sigmaPctYr, fee, ttl: map.ttlSec, txHash: hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice });
    console.log(`[keeper] sigma5 ${sigmaPctYr.toFixed(1)}%/yr -> K fee ${fee} pips (TTL ${map.ttlSec} s), tx ${hash}`);
    nextAt = nextPostAt(now, map.postEverySec, rand);
  } catch (e) {
    appendJsonl(logFile, { ...base, error: shortError(e) });
    throw e; // the supervisor re-syncs the nonce and backs off
  }
}

console.log(`[keeper] ${wallet.account.address} pokes K ${d.pools.K.poolId} on ${d.hook} about every ${map.postEverySec} s (imitation of the observed pattern, not Fables' code)`);
runSupervised({
  name: "keeper",
  logFile,
  everyMs: 5_000,
  wallet,
  immediate: true,
  tick,
  onResume: (gap) => {
    nextAt = 0; // post now, from fresh volatility
    appendJsonl(logFile, { ts: new Date().toISOString(), action: "resume", gapSec: gap.gapSec });
  },
});
```

Replace `bots/src/live/arb.ts` with:

```ts
// Arbitrage bot on Robinhood Chain testnet: every poll (2 s; blocks come about every 0.1 s), read pools D, K and F and
// the venue price (median of four venues' tickers, bots/src/lib/market.ts), and push each pool back to the edge of its
// no-arbitrage band, with the fee of the direction it trades. It swaps through routers.arb, so the dashboard tells
// arbitrage by Swap.sender. Outages (plan 03 Task 23): a swap prepared from prices more than 10 s old is dropped, never
// sent late; after a wall-clock jump the nonce is re-synced and the next poll starts from the chain head; failed polls
// back off (2 s doubling to 60 s). Usage: bun src/live/arb.ts     Log: bots/out/arb-rh.jsonl
import { LIVE_POOLS, liveOrientation, poolSwapTestAbi, type LivePoolName } from "@clim/shared";
import { join } from "node:path";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { aggregate, fetchVenueQuotes } from "../lib/market";
import { swapArgs } from "../lib/swap";
import { decideArbDirectional } from "./lib/arb";
import { liveClient, liveWallet, readLiveBalances, readLiveState } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { isStale } from "./lib/supervise";
import { runSupervised } from "./lib/supervisor";

const MAX_QUOTE_AGE_MS = 10_000;
const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("arb"));
const me = wallet.account.address;
const router = d.routers.arb;
const logFile = join(OUT_DIR, "arb-rh.jsonl");
// A pool with an arbitrage still pending is skipped: trading it again on stale state would revert or overshoot.
const inflight = new Set<LivePoolName>();
let lastBlock: bigint | null = null;

async function onBlock(blockNumber: bigint): Promise<void> {
  const startedMs = Date.now();
  const [m, s, bal] = await Promise.all([
    fetchVenueQuotes().then(aggregate),
    readLiveState(client, d, blockNumber),
    readLiveBalances(client, d, me, router),
  ]);
  if (!m) {
    appendJsonl(logFile, { ts: new Date().toISOString(), block: blockNumber, action: "skip", reason: "fewer than 3 venues" });
    return;
  }
  for (const name of LIVE_POOLS) {
    const pool = d.pools[name];
    const ps = s.pools[name];
    const dec = decideArbDirectional({
      sqrtPriceX96: ps.sqrtPriceX96,
      marketEthUsd: m.price,
      fee0For1: ps.fee0For1,
      fee1For0: ps.fee1For0,
      orientation: liveOrientation(d, pool),
    });
    const base = {
      ts: new Date().toISOString(),
      block: blockNumber,
      pool: name,
      market: m.price,
      nVenues: m.n,
      poolEthUsd: dec.poolEthUsd,
      feePips: dec.feePips,
      logGapBp: dec.logGap * 1e4,
      bandBp: dec.bandLog * 1e4,
    };
    if (dec.action === "none") {
      appendJsonl(logFile, { ...base, action: "none" });
      continue;
    }
    if (inflight.has(name)) {
      appendJsonl(logFile, { ...base, action: "skip", reason: "previous arbitrage pending" });
      continue;
    }
    const amountIn = dec.side === "buyEth" ? bal.tUSDG : bal.tETH;
    if (amountIn === 0n) {
      appendJsonl(logFile, { ...base, action: "skip", reason: `no ${dec.side === "buyEth" ? "tUSDG" : "tETH"} balance` });
      continue;
    }
    try {
      // Spend up to the whole balance: the swap stops at the price limit, so only the needed amount moves.
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: router,
        abi: poolSwapTestAbi,
        functionName: "swap",
        args: swapArgs(pool.key, dec.zeroForOne, amountIn, dec.sqrtPriceLimitX96),
      });
      if (isStale(startedMs, Date.now(), MAX_QUOTE_AGE_MS)) {
        appendJsonl(logFile, { ...base, action: "skip", reason: "stale quotes (read more than 10 s ago)" });
        return; // the rest of this poll is stale too; the next poll starts over
      }
      const hash = await wallet.writeContract(request);
      inflight.add(name);
      appendJsonl(logFile, { ...base, action: dec.side, zeroForOne: dec.zeroForOne, targetEthUsd: dec.targetEthUsd, txHash: hash });
      console.log(`[arb] ${name} pool ${dec.poolEthUsd.toFixed(2)} vs ${m.price.toFixed(2)} (fee ${dec.feePips}) -> ${dec.side} tx ${hash}`);
      client
        .waitForTransactionReceipt({ hash, timeout: 60_000 })
        .then(
          (r) => appendJsonl(logFile, { ts: new Date().toISOString(), event: "receipt", pool: name, txHash: hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed }),
          (e: unknown) => appendJsonl(logFile, { ts: new Date().toISOString(), event: "receipt-error", pool: name, txHash: hash, error: shortError(e) }),
        )
        .finally(() => inflight.delete(name));
    } catch (e) {
      const error = shortError(e);
      const action = /PriceLimitAlreadyExceeded|0x7c9c6e8f/.test(error) ? "stale" : "error";
      appendJsonl(logFile, { ...base, action, error });
      if (action === "error") throw e; // the supervisor re-syncs the nonce and backs off
    }
  }
}

console.log(`[arb] ${me} trading D, K, F through ${router}`);
runSupervised({
  name: "arb",
  logFile,
  everyMs: 2_000,
  wallet,
  immediate: true,
  tick: async () => {
    const head = await client.getBlockNumber();
    if (lastBlock !== null && head <= lastBlock) return;
    lastBlock = head;
    await onBlock(head);
  },
  onResume: (gap) => {
    appendJsonl(logFile, { ts: new Date().toISOString(), action: "resume", gapSec: gap.gapSec });
  },
});
```

Replace `bots/src/live/noise.ts` with:

```ts
// Retail (noise) bot on Robinhood Chain testnet: every NOISE_TICK_MS (10 s), a Poisson number of orders
// (NOISE_ORDERS_PER_TICK, default 0.2) with a random side and a log-normal USD size, each sent to D, K and F through the
// retail PoolSwapTest. Outages (plan 03 Task 23): orders sized from a pool state more than 15 s old are dropped, never
// sent late; after a wall-clock jump the nonce is re-synced; failed ticks back off (2 s doubling to 60 s).
// Usage: bun src/live/noise.ts     Log: bots/out/noise-rh.jsonl
import { LIVE_POOLS, poolSwapTestAbi } from "@clim/shared";
import { join } from "node:path";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { mulberry32 } from "../lib/rng";
import { inputAmountForUsd, noPriceLimit, swapArgs, zeroForOneFor } from "../lib/swap";
import { liveClient, liveWallet, readLiveState } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { planTickOrders, type FlowConfig } from "./lib/flow";
import { isStale } from "./lib/supervise";
import { runSupervised } from "./lib/supervisor";

const MAX_STATE_AGE_MS = 15_000;
const cfg: FlowConfig = {
  ordersPerTick: envNum("NOISE_ORDERS_PER_TICK", 0.2),
  medianUsd: envNum("NOISE_MEDIAN_USD", 2_000),
  sigmaLn: envNum("NOISE_SIGMA_LN", 1),
};
const seed = envNum("NOISE_SEED", 42);
const rand = mulberry32(seed);
const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("noise"));
const logFile = join(OUT_DIR, "noise-rh.jsonl");

async function tick(): Promise<void> {
  const orders = planTickOrders(rand, cfg);
  if (orders.length === 0) return;
  const startedMs = Date.now();
  const s = await readLiveState(client, d);
  let failed: unknown = null;
  for (const order of orders) {
    for (const name of LIVE_POOLS) {
      const pool = d.pools[name];
      const ps = s.pools[name];
      const zeroForOne = zeroForOneFor(order.side, pool.token0IsEth);
      const amountIn = inputAmountForUsd(order.side, order.usd, ps.ethUsd, d.tokens.tETH.decimals, d.tokens.tUSDG.decimals);
      const base = { ts: new Date().toISOString(), pool: name, side: order.side, usd: order.usd, feePips: zeroForOne ? ps.fee0For1 : ps.fee1For0 };
      if (isStale(startedMs, Date.now(), MAX_STATE_AGE_MS)) {
        appendJsonl(logFile, { ...base, action: "skip", reason: "stale pool state (read more than 15 s ago)" });
        return;
      }
      try {
        const { request } = await client.simulateContract({
          account: wallet.account,
          address: d.uniswap.poolSwapTest,
          abi: poolSwapTestAbi,
          functionName: "swap",
          args: swapArgs(pool.key, zeroForOne, amountIn, noPriceLimit(zeroForOne)),
        });
        const hash = await wallet.writeContract(request);
        appendJsonl(logFile, { ...base, amountIn, txHash: hash });
        console.log(`[noise] ${order.side} $${order.usd.toFixed(0)} on ${name} (fee ${base.feePips} pips) tx ${hash}`);
      } catch (e) {
        appendJsonl(logFile, { ...base, error: shortError(e) });
        console.error(`[noise] ${name} error: ${shortError(e)}`);
        failed = e;
      }
    }
  }
  if (failed !== null) throw failed; // the supervisor re-syncs the nonce and backs off
}

console.log(`[noise] ${wallet.account.address} ${cfg.ordersPerTick} orders per tick, median $${cfg.medianUsd}, seed ${seed}, mirrored to D, K, F`);
runSupervised({
  name: "noise",
  logFile,
  everyMs: envNum("NOISE_TICK_MS", 10_000),
  wallet,
  tick,
  onResume: (gap) => {
    appendJsonl(logFile, { ts: new Date().toISOString(), action: "resume", gapSec: gap.gapSec });
  },
});
```

- [ ] **Step 11: The desk loop under launchd**

Under launchd the desk job gets the CRE CLI's absolute path as `--cre-bin`, which the recorder passes to the loop script as `CRE_BIN`.

Replace `cre/scripts/sim-loop.sh` with:

```bash
#!/usr/bin/env bash
# Runs the clim risk desk in local CRE simulation every INTERVAL seconds (default 30).
# Builds the WASM once, then reuses it with --wasm, so runs do not recompile.
# Usage (from cre/): [ENV_FILE=.env.replay] [CRE_BIN=/absolute/path/to/cre] scripts/sim-loop.sh <target> [--broadcast]
# ENV_FILE: the .env file holding CRE_ETH_PRIVATE_KEY, passed to the CLI as -e (unset: the CLI's own cre/.env).
# CRE_BIN: the CRE CLI to run (unset: `cre` from PATH); the launchd desk job passes the absolute path (plan 03 Task 23).
# The replay desk has its own operator key in cre/.env.replay (plan 01 Task 18).
# Output: full log in cre/logs/, USER LOG lines echoed to the terminal. Stop with Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/.."
# The CLI prints local time labeled "Z" (friction row 19): run it in UTC so transcripts match block times.
export TZ=UTC
TARGET="${1:?usage: scripts/sim-loop.sh <target> [--broadcast]}"
BROADCAST="${2:-}"
INTERVAL="${INTERVAL:-30}"
ENV_FILE="${ENV_FILE:-}"
CRE="${CRE_BIN:-cre}"
# Absolute path: simulate resolves a relative --wasm from the workflow folder (risk-desk/), build -o from here.
WASM="$PWD/risk-desk/binary.wasm"
mkdir -p logs
LOG="logs/sim-$(date -u +%Y%m%dT%H%M%SZ)-${TARGET}${BROADCAST:+-broadcast}.log"
"$CRE" workflow build ./risk-desk -o "$WASM"
echo "target=${TARGET} broadcast=${BROADCAST:-no} env=${ENV_FILE:-.env} interval=${INTERVAL}s cre=${CRE} log=${LOG}"
while true; do
  START=$(date +%s)
  echo "=== $(date -u +%FT%TZ)" | tee -a "$LOG"
  "$CRE" workflow simulate risk-desk --wasm "$WASM" --non-interactive --trigger-index 0 \
    --target "$TARGET" ${BROADCAST} ${ENV_FILE:+-e "$ENV_FILE"} 2>&1 | tee -a "$LOG" | grep -E "USER LOG|rror|✗" || true
  ELAPSED=$(( $(date +%s) - START ))
  if (( ELAPSED < INTERVAL )); then sleep $(( INTERVAL - ELAPSED )); fi
done
```

Replace `bots/src/live/desk-loop.ts` with:

```ts
// The live desk loop with an on-chain record of every run (Robinhood Chain testnet, plan 03).
// Runs cre/scripts/sim-loop.sh <target> --broadcast (build the WASM once, then `cre workflow simulate` every 30 s) and
// echoes its output. For each run it writes the transcript to bots/out/desk-sim/<run start>.log and appends one line to
// bots/out/desk-runs.jsonl: status, tx hash, receipt and gas, the forwarder's ReportProcessed.result and the decoded
// RiskReportedV2. The receipt decides `applied` (simParse.receiptStatus).
// Outages (plan 03 Task 23): each `cre workflow simulate` is a fresh process that reads its nonce and the venues itself,
// so nothing is replayed after a sleep; a run cut by the sleep can only deliver a real observation stamped with its own
// tObs, which the policy trusts for tauKillSec after tObs and to which ClimPoker anchors its TTL, so a late delivery
// cannot extend a fee. This recorder writes a local outage record on a wall-clock jump and on restart, and logs the desk
// state re-read from the chain. If the loop exits (the CRE CLI or the network failing at start), this process exits 1
// and launchd starts it again 30 s later (ThrottleInterval).
// Usage: bun src/live/desk-loop.ts [--target rh-testnet-settings] [--cre-bin /absolute/path/to/cre] [--once]
import { mockForwarderAbi, riskDeskV2Abi } from "@clim/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { argValue, envStr, hasFlag } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { loopCommand, receiptStatus, RunTracker, type RunResult } from "../lib/simParse";
import { liveClient } from "./lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "./lib/deployments";
import { recordStart, watchClock } from "./lib/supervisor";

const target = argValue("--target") ?? "rh-testnet-settings";
const creBin = argValue("--cre-bin");
const once = hasFlag("--once");
const creDir = envStr("CRE_PROJECT_DIR", join(REPO_ROOT, "cre"));
const d = loadLiveDeployments();
const client = liveClient();
const runsFile = join(OUT_DIR, "desk-runs.jsonl");
const transcriptDir = join(OUT_DIR, "desk-sim");
mkdirSync(transcriptDir, { recursive: true });

async function record(run: RunResult): Promise<void> {
  const { lines, ...result } = run;
  const transcript = `${(run.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-")}.log`;
  writeFileSync(join(transcriptDir, transcript), `${lines.join("\n")}\n`);
  const base = { ts: new Date().toISOString(), target, ...result, transcript: `desk-sim/${transcript}` };
  if (!run.txHash) {
    appendJsonl(runsFile, base);
    console.log(`[desk] run ${run.startedAt}: ${run.status}${run.detail ? ` (${run.detail})` : ""}`);
    return;
  }
  try {
    const r = await client.waitForTransactionReceipt({ hash: run.txHash, timeout: 120_000 });
    const reported = parseEventLogs({ abi: riskDeskV2Abi, eventName: "RiskReportedV2", logs: r.logs }).filter(
      (l) => l.address.toLowerCase() === d.riskDesk.toLowerCase(),
    );
    const processed = parseEventLogs({ abi: mockForwarderAbi, eventName: "ReportProcessed", logs: r.logs });
    const ev = reported[0]?.args;
    const forwarderResult = processed[0]?.args.result ?? null;
    const status = receiptStatus(run.status, forwarderResult, reported.length > 0);
    appendJsonl(runsFile, {
      ...base,
      status,
      statusFromReceipt: status !== run.status,
      txStatus: r.status,
      blockNumber: r.blockNumber,
      gasUsed: r.gasUsed,
      effectiveGasPrice: r.effectiveGasPrice,
      from: r.from,
      forwarderResult,
      seq: ev?.seq ?? null,
      tObs: ev?.tObs ?? null,
      sigma5Applied: ev?.sigma5Applied ?? null,
      sigma15Applied: ev?.sigma15Applied ?? null,
      sigma5Reported: ev?.sigma5Reported ?? null,
      devPips: ev?.devPips ?? null,
      dispBp: ev?.dispBp ?? null,
      nSources: ev?.nSources ?? null,
      flags: ev?.flags ?? null,
    });
    console.log(`[desk] run ${run.startedAt}: ${status} tx ${run.txHash} seq ${ev?.seq} sigma5 ${ev?.sigma5Applied} dev ${ev?.devPips} gas ${r.gasUsed}`);
  } catch (e) {
    appendJsonl(runsFile, { ...base, receiptError: shortError(e) });
    console.error(`[desk] run ${run.startedAt}: tx ${run.txHash} receipt error: ${shortError(e)}`);
  }
}

/** The desk as the chain sees it, printed on start and after a wall-clock jump (desk-runs.jsonl keeps one line per run). */
async function logDeskState(why: string): Promise<void> {
  try {
    const st = await client.readContract({ address: d.riskDesk, abi: riskDeskV2Abi, functionName: "state" });
    const age = st[6] === 0 ? null : Math.floor(Date.now() / 1000) - st[0];
    console.log(`[desk] ${why}: desk seq ${st[6]}, last report ${age === null ? "never" : `${age} s ago`}`);
  } catch (e) {
    console.error(`[desk] ${why}: desk state unreadable: ${shortError(e)}`);
  }
}

recordStart("desk", runsFile);
await logDeskState("start");
watchClock("desk", () => {
  void logDeskState("resume");
});

const cmd = loopCommand(target);
console.log(`[desk] ${cmd.join(" ")} (cwd ${creDir}, cre ${creBin ?? "from PATH"}), recording to ${runsFile}`);
const proc = Bun.spawn(cmd, { cwd: creDir, stdout: "pipe", stderr: "inherit", env: creBin ? { ...process.env, CRE_BIN: creBin } : process.env });
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    proc.kill();
    process.exit(130);
  });
}

const tracker = new RunTracker();
let pending: Promise<void> = Promise.resolve();
const handle = (run: RunResult | null): void => {
  if (!run) return;
  pending = pending.then(() => record(run));
  if (once) {
    pending.then(() => {
      proc.kill();
      process.exit(0);
    });
  }
};

const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
let buf = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += value;
  let nl = buf.indexOf("\n");
  while (nl >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    console.log(line);
    handle(tracker.push(line));
    nl = buf.indexOf("\n");
  }
}
handle(tracker.flush());
await pending;
const code = await proc.exited;
console.error(`[desk] loop exited with code ${code}`);
process.exit(code === 0 ? 0 : 1);
```

- [ ] **Step 12: The outage recorder, the launchd script and the status**

Create `bots/src/live/scripts/outages.ts`:

```ts
// Outage record of the live desk from on-chain truth: scans RiskReportedV2 from the deployment block (then
// incrementally) and writes bots/out/outages.json, one window per gap of more than 90 s between consecutive reports'
// tObs ({from, to, durationSec, seqBefore, seqAfter}), each with the local reason when the Mac's processes recorded one
// (bots/out/outages-local.jsonl). Plan 04's app derives the same windows from the chain with outageWindows() of
// @clim/shared and shows them as measured. Usage: bun src/live/scripts/outages.ts [--watch]
// Env: OUTAGES_EVERY_SEC (pass period with --watch, default 300), OUTAGES_CHUNK_BLOCKS (getLogs range, default 2000)
import { OUTAGE_GAP_SEC, riskDeskV2Abi, type OutageWindow, type ReportPoint } from "@clim/shared";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envNum, hasFlag } from "../../lib/env";
import { appendJsonl, OUT_DIR } from "../../lib/jsonl";
import { liveClient } from "../lib/chain";
import { loadLiveDeployments } from "../lib/deployments";
import { advanceOutages, attachLocalReasons, emptyOutageState, parseLocalOutages, type OutageState } from "../lib/outages";
import { LOCAL_OUTAGES_FILE, runSupervised } from "../lib/supervisor";
import { chunkedRanges } from "../lib/tail";

const CONFIRMATIONS = 20n; // about 2 s of blocks: never read a block that could still change
const OUT_FILE = join(OUT_DIR, "outages.json");
const LOG_FILE = join(OUT_DIR, "outages-rh.jsonl");
const d = loadLiveDeployments();
const client = liveClient();
const chunk = BigInt(envNum("OUTAGES_CHUNK_BLOCKS", 2_000));

type OutagesFile = OutageState & { chainId: number; riskDesk: string };

/** The previous pass's state, or a fresh one when there is none or it belongs to another desk. */
function loadState(): OutageState {
  if (!existsSync(OUT_FILE)) return emptyOutageState(d.deployBlock);
  try {
    const f = JSON.parse(readFileSync(OUT_FILE, "utf8")) as Partial<OutagesFile> & { windows?: OutageWindow[] };
    if (f.chainId !== d.chainId || f.riskDesk?.toLowerCase() !== d.riskDesk.toLowerCase() || typeof f.scannedToBlock !== "number") {
      return emptyOutageState(d.deployBlock);
    }
    return {
      scannedToBlock: f.scannedToBlock,
      reportCount: f.reportCount ?? 0,
      lastReport: f.lastReport ?? null,
      windows: (f.windows ?? []).filter((w) => !w.ongoing).map(({ from, to, durationSec, seqBefore, seqAfter, ongoing }) => ({ from, to, durationSec, seqBefore, seqAfter, ongoing })),
    };
  } catch {
    return emptyOutageState(d.deployBlock);
  }
}

async function pass(): Promise<void> {
  const head = await client.getBlockNumber();
  const safe = head > CONFIRMATIONS ? head - CONFIRMATIONS : head;
  const nowSec = Number((await client.getBlock({ blockNumber: safe })).timestamp);
  const prev = loadState();
  const reports: ReportPoint[] = [];
  for (const [a, b] of chunkedRanges(BigInt(prev.scannedToBlock + 1), safe, chunk)) {
    const logs = await client.getLogs({ address: d.riskDesk, event: riskDeskV2Abi[1], fromBlock: a, toBlock: b });
    for (const l of logs) reports.push({ seq: Number(l.args.seq ?? 0), tObs: Number(l.args.tObs ?? 0) });
  }
  const { state, windows } = advanceOutages(prev, reports, Number(safe), nowSec);
  const local = existsSync(LOCAL_OUTAGES_FILE) ? parseLocalOutages(readFileSync(LOCAL_OUTAGES_FILE, "utf8")) : [];
  const explained = attachLocalReasons(windows, local, nowSec);
  const file = {
    generatedAt: new Date().toISOString(),
    note: `Windows in which clim's desk sent no report for more than ${OUTAGE_GAP_SEC} s, from consecutive RiskReportedV2 events (from = tObs of the last report before, to = tObs of the first after, null while silent). reason and local come from the Mac's own records, when it kept one.`,
    chainId: d.chainId,
    riskDesk: d.riskDesk,
    gapSec: OUTAGE_GAP_SEC,
    deployBlock: d.deployBlock,
    scannedToBlock: state.scannedToBlock,
    chainTimeSec: nowSec,
    reportCount: state.reportCount,
    lastReport: state.lastReport,
    windows: explained,
  };
  // write then rename, so a reader (live:status, a second pass) never sees half a file
  writeFileSync(`${OUT_FILE}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(`${OUT_FILE}.tmp`, OUT_FILE);
  const ongoing = explained.find((w) => w.ongoing);
  appendJsonl(LOG_FILE, { ts: file.generatedAt, scannedToBlock: state.scannedToBlock, newReports: reports.length, windows: explained.length, ongoing: ongoing !== undefined });
  console.log(
    `[outages] block ${safe}: ${reports.length} new reports (${state.reportCount} in all), ${explained.length} windows${ongoing ? `, desk silent for ${ongoing.durationSec} s now` : ""} -> bots/out/outages.json`,
  );
}

if (hasFlag("--watch")) {
  const everyMs = envNum("OUTAGES_EVERY_SEC", 300) * 1_000;
  let nextAt = 0;
  runSupervised({
    name: "outages",
    logFile: LOG_FILE,
    everyMs: 10_000, // the clock is watched every 10 s; a pass runs every OUTAGES_EVERY_SEC
    immediate: true,
    tick: async () => {
      if (Date.now() < nextAt) return;
      await pass();
      nextAt = Date.now() + everyMs;
    },
    onResume: () => {
      nextAt = 0; // a pass right after a wake records the window that just ended
    },
  });
} else {
  await pass();
}
```

Create `bots/src/live/scripts/launchd.ts`:

```ts
// Installs, removes and tails the live stack's launchd LaunchAgents (fi.clim-fables.<name>) on the maintainer's Mac.
// install: resolves bun and cre on PATH, writes ~/Library/LaunchAgents/fi.clim-fables.<name>.plist (no secret in it) and
//          bootstraps it into gui/<uid> (a job already loaded is booted out first, so install also reloads).
// uninstall: boots the jobs out and removes their plists (they then stay stopped after a reboot).
// logs: tails bots/out/logs/<name>.log and .err.log. print: prints the plists without writing or loading anything.
// Health: bun run live:status.
// Usage: bun src/live/scripts/launchd.ts <install|uninstall|logs|print> [name ...]   (names: desk runner keeper arb noise outages)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/deployments";
import { guiDomain, isLiveJobName, jobLabel, jobState, LIVE_JOB_NAMES, liveJobSpec, logPaths, plistFor, type JobPaths, type LiveJobName } from "../lib/launchd";

const BOTS_DIR = join(REPO_ROOT, "bots");
const AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const [command, ...rest] = process.argv.slice(2);
const names: LiveJobName[] = rest.length === 0 ? [...LIVE_JOB_NAMES] : rest.map((n) => {
  if (!isLiveJobName(n)) throw new Error(`unknown job ${n} (one of ${LIVE_JOB_NAMES.join(", ")})`);
  return n;
});
const plistPath = (name: LiveJobName) => join(AGENTS_DIR, `${jobLabel(name)}.plist`);

function launchctl(args: string[], allowFail = false): void {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  if (r.status !== 0 && !allowFail) throw new Error(`launchctl ${args.join(" ")} failed (${r.status}): ${(r.stderr || r.stdout).trim()}`);
}

/** bootout returns before launchd has removed the job; bootstrap fails while it is still there. */
function bootout(name: LiveJobName): void {
  launchctl(["bootout", `${guiDomain()}/${jobLabel(name)}`], true);
  for (let i = 0; i < 40 && jobState(name) !== null; i++) Bun.sleepSync(250);
  if (jobState(name) !== null) throw new Error(`${jobLabel(name)} is still loaded 10 s after bootout`);
}

/** bun and cre as found on PATH now (stable Homebrew links, not versioned Cellar paths). */
function resolvePaths(): JobPaths {
  const bun = Bun.which("bun") ?? process.execPath;
  const cre = Bun.which("cre");
  if (!cre) throw new Error("the cre CLI is not on PATH: install it (plan 03 Task 16) and rerun");
  return { bun, cre, botsDir: BOTS_DIR, home: homedir() };
}

function install(): void {
  if (process.platform !== "darwin") throw new Error("launchd jobs need macOS");
  const paths = resolvePaths();
  const { bun, cre } = paths;
  mkdirSync(AGENTS_DIR, { recursive: true });
  mkdirSync(join(BOTS_DIR, "out", "logs"), { recursive: true });
  console.log(`bun ${bun}\ncre ${cre}\nrepo ${REPO_ROOT}`);
  for (const name of names) {
    const spec = liveJobSpec(name, paths);
    writeFileSync(plistPath(name), plistFor(spec));
    bootout(name);
    launchctl(["enable", `${guiDomain()}/${spec.label}`]);
    launchctl(["bootstrap", guiDomain(), plistPath(name)]);
    const st = jobState(name);
    console.log(`${spec.label}: ${st?.state ?? "not loaded"}${st?.pid ? ` (pid ${st.pid})` : ""}, logs ${spec.stdoutPath}`);
  }
}

function uninstall(): void {
  for (const name of names) {
    bootout(name);
    if (existsSync(plistPath(name))) rmSync(plistPath(name));
    console.log(`${jobLabel(name)}: removed`);
  }
}

function logs(): void {
  const files = names.flatMap((n) => {
    const p = logPaths(n, BOTS_DIR);
    return [p.stdout, p.stderr];
  });
  const r = spawnSync("tail", ["-n", "20", "-F", ...files], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

function print(): void {
  const paths = resolvePaths();
  for (const name of names) process.stdout.write(plistFor(liveJobSpec(name, paths)));
}

if (command === "install") install();
else if (command === "uninstall") uninstall();
else if (command === "logs") logs();
else if (command === "print") print();
else throw new Error("usage: bun src/live/scripts/launchd.ts <install|uninstall|logs|print> [name ...]");
```

The status script keeps Task 22's checks and prints, before its `PROBLEM:` lines, each launchd job's state and the last outage window.

Replace `bots/src/live/scripts/status.ts` with:

```ts
// Health of the live stack on Robinhood Chain testnet: desk seq and age, the policy's quote and mode, each pool's fee
// both ways and price against the venues, the last pokes on D (ClimPoker) and K (keeper), every key's balances, the
// age of each bot's last log line, the launchd jobs (plan 03 Task 23) and the outage record. Exits 1 on a problem;
// --watch prints a snapshot every 15 s instead.
// Usage: bun src/live/scripts/status.ts [--watch]
import { climPokerAbi, FeeMode, LIVE_POOLS, pipsToBp, pokeFeeHookAbi, sigmaE9ToAnnual, stateViewAbi } from "@clim/shared";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, formatUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hasFlag } from "../../lib/env";
import { OUT_DIR, shortError } from "../../lib/jsonl";
import { aggregate, fetchVenueQuotes } from "../../lib/market";
import { liveClient, readLiveBalances, readLiveState } from "../lib/chain";
import { loadLiveDeployments } from "../lib/deployments";
import { liveKey, type LiveRole } from "../lib/env";
import { jobLabel, jobState, LIVE_JOB_NAMES } from "../lib/launchd";
import { lastTs } from "../lib/tail";

const d = loadLiveDeployments();
const client = liveClient();
const LOOKBACK_BLOCKS = 9_000n; // about 15 minutes at 0.1 s blocks
const MODE: Record<number, string> = { [FeeMode.Normal]: "normal", [FeeMode.Degraded]: "degraded", [FeeMode.Blind]: "blind" };
const LOGS: Array<[string, string, number]> = [
  ["desk", "desk-runs.jsonl", 90],
  ["runner", "runner-rh.jsonl", 120],
  ["keeper", "keeper-rh.jsonl", 400],
  ["arb", "arb-rh.jsonl", 60],
  ["noise", "noise-rh.jsonl", 600],
];

async function snapshot(): Promise<string[]> {
  const problems: string[] = [];
  const head = await client.getBlockNumber();
  const [s, block, quotes] = await Promise.all([readLiveState(client, d, head), client.getBlock({ blockNumber: head }), fetchVenueQuotes().catch(() => [])]);
  const now = Number(block.timestamp);
  const m = aggregate(quotes);
  const age = s.desk.seq === 0 ? Number.POSITIVE_INFINITY : now - s.desk.tObs;
  console.log(
    `${new Date().toISOString()} block ${head} | desk seq ${s.desk.seq} age ${age}s sigma5 ${(sigmaE9ToAnnual(s.desk.sigma5E9) * 100).toFixed(1)}%/yr sigma15 ${(sigmaE9ToAnnual(s.desk.sigma15E9) * 100).toFixed(1)}%/yr dev ${s.desk.devPips} pips flags ${s.desk.flags} | policy ${s.policy.fee0For1}/${s.policy.fee1For0} (${MODE[s.policy.mode] ?? s.policy.mode}) | market ${m ? `${m.price.toFixed(2)} (${m.n} venues)` : "n/a"}`,
  );
  if (age > 90) problems.push(`desk report age ${age} s > 90 s`);
  if (s.policy.mode === FeeMode.Blind) problems.push("policy mode blind");

  const from = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  const [poked, kPokes] = await Promise.all([
    client.getLogs({ address: d.poker, event: climPokerAbi[1], fromBlock: from, toBlock: head }),
    client.getLogs({ address: d.hook, event: pokeFeeHookAbi[3], args: { poolId: d.pools.K.poolId }, fromBlock: from, toBlock: head }),
  ]);
  const lastPoke = poked[poked.length - 1]?.args;
  const lastK = kPokes[kPokes.length - 1];
  for (const name of LIVE_POOLS) {
    const ps = s.pools[name];
    const liq = await client.readContract({ address: d.uniswap.stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [d.pools[name].poolId] });
    console.log(
      `  ${name}: fee ${ps.fee0For1}/${ps.fee1For0} pips (${pipsToBp(ps.fee0For1).toFixed(2)}/${pipsToBp(ps.fee1For0).toFixed(2)} bp) price ${ps.ethUsd.toFixed(2)}${m ? ` gap ${((ps.ethUsd / m.price - 1) * 1e4).toFixed(1)} bp` : ""} L ${Number(liq).toExponential(3)}`,
    );
    if (liq * 2n < d.liquidity) problems.push(`${name} liquidity ${liq} below half the seed ${d.liquidity}`);
  }
  const flat = d.hookConfig.flatPips;
  if (s.pools.F.fee0For1 !== flat || s.pools.F.fee1For0 !== flat) problems.push(`F fee ${s.pools.F.fee0For1}/${s.pools.F.fee1For0} != flat ${flat}`);
  if (lastPoke && lastPoke.expiry !== undefined && lastPoke.expiry > now) {
    if (s.pools.D.fee0For1 !== lastPoke.fee0For1 || s.pools.D.fee1For0 !== lastPoke.fee1For0) {
      problems.push(`D fee ${s.pools.D.fee0For1}/${s.pools.D.fee1For0} != last poke ${lastPoke.fee0For1}/${lastPoke.fee1For0}`);
    }
  }
  console.log(`  last D poke: ${lastPoke ? `seq ${lastPoke.seq} ${lastPoke.fee0For1}/${lastPoke.fee1For0} pips, ${poked.length} in ${LOOKBACK_BLOCKS} blocks` : "none in the lookback"}`);
  console.log(`  last K poke: ${lastK ? `${lastK.args.fee} pips at block ${lastK.blockNumber}, ${kPokes.length} in ${LOOKBACK_BLOCKS} blocks` : "none in the lookback"}`);
  if (poked.length === 0) problems.push("no ClimPoker poke in the lookback");
  if (kPokes.length === 0) problems.push("no keeper poke on K in the lookback");

  const keys: Array<[string, Address, Address | null]> = [["CRE operator", d.cre.simOperator, null]];
  for (const [name, role, router] of [
    ["runner", "runner", null],
    ["keeper", "keeper", null],
    ["arbitrage", "arb", d.routers.arb],
    ["retail", "noise", d.uniswap.poolSwapTest],
  ] as Array<[string, LiveRole, Address | null]>) {
    try {
      keys.push([name, privateKeyToAccount(liveKey(role)).address, router]);
    } catch {
      problems.push(`${name}: key not set in bots/.env`);
    }
  }
  for (const [name, addr, router] of keys) {
    const b = await readLiveBalances(client, d, addr, router ?? addr);
    const tokens = router ? `, ${formatUnits(b.tETH, 18)} tETH, ${formatUnits(b.tUSDG, 6)} tUSDG` : "";
    console.log(`  ${name} ${addr}: ${formatEther(b.native)} ETH${tokens}`);
    if (b.native < 10n ** 16n) problems.push(`${name} has under 0.01 ETH (bun run live:fund)`);
  }
  for (const [name, file, maxAge] of LOGS) {
    const ts = lastTs(join(OUT_DIR, file));
    const a = ts === null ? null : Math.round((Date.now() - Date.parse(ts)) / 1000);
    console.log(`  bot ${name}: last log ${a === null ? "never" : `${a} s ago`}`);
    if (a === null || a > maxAge) problems.push(`bot ${name} silent (${a === null ? "no log" : `${a} s`} > ${maxAge} s)`);
  }
  const jobs = LIVE_JOB_NAMES.map((name) => ({ name, st: jobState(name) }));
  if (jobs.every((j) => j.st === null)) {
    console.log("  launchd: no fi.clim-fables.* job loaded (bun run live:install starts them)");
  } else {
    for (const { name, st } of jobs) {
      console.log(`  job ${jobLabel(name)}: ${st === null ? "not loaded" : `${st.state ?? "?"}${st.pid ? ` pid ${st.pid}` : ""}, last exit ${st.lastExitCode ?? "?"}`}`);
      if (st === null) problems.push(`job ${name} not loaded (bun run live:install ${name})`);
      else if (st.state !== "running") problems.push(`job ${name} ${st.state ?? "in an unknown state"} (last exit ${st.lastExitCode ?? "?"}; bun run live:logs ${name})`);
    }
  }
  const outagesFile = join(OUT_DIR, "outages.json");
  if (existsSync(outagesFile)) {
    try {
      const o = JSON.parse(readFileSync(outagesFile, "utf8")) as { generatedAt: string; windows: Array<{ from: number; durationSec: number; ongoing: boolean; reason: string }> };
      const last = o.windows[o.windows.length - 1];
      const at = (t: number) => new Date(t * 1000).toISOString().slice(0, 19);
      console.log(
        `  outages: ${o.windows.length} recorded (as of ${o.generatedAt})${last ? `, last from ${at(last.from)} UTC, ${last.durationSec} s${last.ongoing ? " and ongoing" : ""}: ${last.reason}` : ""}`,
      );
    } catch {
      console.log("  outages: bots/out/outages.json unreadable");
    }
  } else {
    console.log("  outages: no record yet (bun run live:outages)");
  }
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  return problems;
}

if (hasFlag("--watch")) {
  const loop = (): void => {
    snapshot().catch((e: unknown) => console.error(shortError(e)));
  };
  loop();
  setInterval(loop, 15_000);
} else {
  const problems = await snapshot();
  process.exit(problems.length === 0 ? 0 : 1);
}
```

In `bots/package.json`, add after `"live:verify"` (`live:status` stays Task 22's script, which now also prints each job's launchd state next to the desk's last report age on chain):

```json
    "live:outages": "bun src/live/scripts/outages.ts",
    "live:install": "bun src/live/scripts/launchd.ts install",
    "live:uninstall": "bun src/live/scripts/launchd.ts uninstall",
    "live:logs": "bun src/live/scripts/launchd.ts logs",
```

- [ ] **Step 13: Run the whole suites, the typecheck and the plists**

Run: `cd bots && bun test && bun run typecheck && cd ../shared && bun test && cd ../cre && bash -n scripts/sim-loop.sh && echo "sim-loop ok"`
Expected: bots `0 fail` with 20 more tests than after Task 22 (111 in all), `tsc` exits 0, shared `0 fail` (77), then `sim-loop ok`.

Then print the six plists without installing anything, and lint them:

Run: `cd bots && for j in desk runner keeper arb noise outages; do bun src/live/scripts/launchd.ts print $j | plutil -lint - ; done && bun src/live/scripts/launchd.ts print desk | grep -A7 ProgramArguments`
Expected: six `<stdin>: OK` lines, then the desk job's arguments: the absolute paths of `bun` and of `bots/src/live/desk-loop.ts`, `--target`, `rh-testnet-settings`, `--cre-bin` and the absolute path of `cre`. Then `cd bots && bun src/live/scripts/launchd.ts print | grep -c -E "KEY|RPC"` prints `0` (no key or RPC URL in any plist).

Run once against the testnet, read-only: `cd bots && bun run live:outages`
Expected: `[outages] block <n>: <k> new reports (<k> in all), <w> windows, desk silent for <s> s now -> bots/out/outages.json`. The first pass scans from the deployment block in ranges of 2,000 blocks (about 3 minutes of chain each), so it can take a few minutes; `<w>` counts the gaps between Task 17's first reports and Task 19's recorded run, plus the ongoing silence (the desk loop has not run continuously yet; these windows are real and stay in the record). A second run is incremental and prints `0 new reports`.

- [ ] **Step 14: The pools during an outage, on the contracts**

Create `contracts/test/v2/Outage.t.sol`:

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

import {RiskDeskV2} from "../../src/v2/RiskDeskV2.sol";
import {ClimFeePolicy} from "../../src/v2/ClimFeePolicy.sol";
import {ClimPoker} from "../../src/v2/ClimPoker.sol";
import {PokeFeeHook} from "../../src/v2/PokeFeeHook.sol";

/// @notice What the live reference pools do while the maintainer's Mac is asleep or offline (plan 03 Task 23): the
///         stack of the testnet (desk, policy, directional poker on D, keeper pokes on K, F flat, hook config 100 / 700 /
///         6,000) with no report, no poke and no keeper post from the last ones until the desk is back.
contract OutageTest is Deployers {
    uint64 internal constant FEE_POKER = 1;
    uint64 internal constant CLIM_RUNNER = 7;
    uint40 internal constant T0 = 1_760_000_000;
    uint32 internal constant SIGMA_48 = 85_475; // 48 %/yr per sqrt-second, x 1e9
    uint32 internal constant SIGMA_300 = 534_217; // 300 %/yr
    uint24 internal constant FLAT = 700;
    uint24 internal constant KEEPER_FEE = 1_480;
    uint40 internal constant KEEPER_TTL = 7_200;
    uint40 internal constant POKE_TTL = 600;
    address internal constant HOOK_ADDRESS =
        address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) ^ (0x7777 << 144));

    AccessManager internal am;
    PokeFeeHook internal hook;
    RiskDeskV2 internal desk;
    ClimFeePolicy internal policy;
    ClimPoker internal poker;
    PoolKey internal keyD;
    PoolKey internal keyK;
    PoolKey internal keyF;
    address internal forwarder = makeAddr("mockForwarder");
    address internal operator = makeAddr("creOperator");
    address internal runner = makeAddr("runner");
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(T0);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        am = new AccessManager(address(this));
        deployCodeTo("PokeFeeHook.sol:PokeFeeHook", abi.encode(manager, address(am)), HOOK_ADDRESS);
        hook = PokeFeeHook(HOOK_ADDRESS);
        keyD = _pool(10);
        keyK = _pool(11);
        keyF = _pool(12);

        desk = new RiskDeskV2(forwarder, operator);
        policy = new ClimFeePolicy(
            desk,
            ClimFeePolicy.Params({
                etaE4: 175_198,
                sqrtHalfDtE6: 850_890,
                floorPips: 700,
                capPips: 6_000,
                safePips: 3_000,
                tauKillSec: 180,
                shortWindow: true,
                dirSlopeE4: 2_753,
                dirMaxPremiumPips: 567,
                ethIsToken0: true
            })
        );
        poker = new ClimPoker(policy, address(hook), _id(keyD), true, POKE_TTL, address(am));

        bytes4[] memory hookSel = new bytes4[](3);
        hookSel[0] = bytes4(keccak256("pokeFee(bytes32,uint24,uint40)"));
        hookSel[1] = bytes4(keccak256("pokeFee(bytes32,uint24,uint24,uint40)"));
        hookSel[2] = PokeFeeHook.clearPoke.selector;
        am.setTargetFunctionRole(address(hook), hookSel, FEE_POKER);
        bytes4[] memory pokeSel = new bytes4[](1);
        pokeSel[0] = ClimPoker.poke.selector;
        am.setTargetFunctionRole(address(poker), pokeSel, CLIM_RUNNER);
        am.grantRole(FEE_POKER, address(poker), 0);
        am.grantRole(FEE_POKER, keeper, 0);
        am.grantRole(CLIM_RUNNER, runner, 0);
    }

    function _pool(int24 spacing) internal returns (PoolKey memory k) {
        (k,) = initPool(
            currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, spacing, SQRT_PRICE_1_1
        );
        hook.setPoolConfig(k, 100, FLAT, 6_000);
        modifyLiquidityRouter.modifyLiquidity(
            k,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(spacing),
                tickUpper: TickMath.maxUsableTick(spacing),
                liquidityDelta: 1e21,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _id(PoolKey memory k) internal pure returns (bytes32) {
        return PoolId.unwrap(k.toId());
    }

    function _report(uint40 tObs, uint32 sigmaE9) internal {
        vm.prank(forwarder, operator);
        desk.onReport("", abi.encode(tObs, sigmaE9, sigmaE9, int32(0), uint16(3), uint8(4), uint16(10_000)));
    }

    /// @dev The fee a small swap pays, read from PoolManager's Swap event.
    function _swapFee(PoolKey memory k, bool zeroForOne) internal returns (uint24 fee) {
        vm.recordLogs();
        swap(k, zeroForOne, -1e15, ZERO_BYTES);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == IPoolManager.Swap.selector) {
                (,,,,, fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return fee;
            }
        }
        revert("no Swap event");
    }

    function _fees(PoolKey memory k) internal view returns (uint24 f01, uint24 f10) {
        return (hook.currentFee(_id(k), true), hook.currentFee(_id(k), false));
    }

    /// @dev Last report at T0, D poked from it, K poked by the keeper, then the Mac sleeps.
    function _lastActionsBeforeTheOutage() internal returns (uint24 d01, uint24 d10) {
        _report(T0, SIGMA_48);
        vm.prank(runner);
        (d01, d10) = poker.poke();
        vm.prank(keeper);
        hook.pokeFee(_id(keyK), KEEPER_FEE, KEEPER_TTL);
    }

    function test_BeforeTheOutageEachPoolChargesItsDriversFee() public {
        (uint24 d01, uint24 d10) = _lastActionsBeforeTheOutage();
        (uint24 a, uint24 b) = _fees(keyD);
        assertEq(a, d01);
        assertEq(b, d10);
        assertGt(d01, FLAT); // 48 %/yr is above the floor: D is not at its flat fee
        (a, b) = _fees(keyK);
        assertEq(a, KEEPER_FEE);
        assertEq(b, KEEPER_FEE);
        (a, b) = _fees(keyF);
        assertEq(a, FLAT);
        assertEq(b, FLAT);
    }

    function test_DeskGoesBlindAfterTauKillAndThePokerStops() public {
        _lastActionsBeforeTheOutage();
        vm.warp(T0 + 180);
        (,, uint8 mode) = policy.quoteDirectional();
        assertEq(mode, policy.MODE_NORMAL()); // still fresh at exactly tauKillSec
        vm.warp(T0 + 181);
        (,, mode) = policy.quoteDirectional();
        assertEq(mode, policy.MODE_BLIND());
        vm.prank(runner);
        vm.expectRevert(ClimPoker.DeskBlind.selector);
        poker.poke(); // the runner logs this as a skip, never as an error
    }

    function test_PoolDKeepsItsLastOverrideUntilItsTtlThenFallsBackToFlat() public {
        (uint24 d01, uint24 d10) = _lastActionsBeforeTheOutage();
        vm.warp(T0 + POKE_TTL - 1);
        (uint24 a, uint24 b) = _fees(keyD);
        assertEq(a, d01);
        assertEq(b, d10);
        vm.warp(T0 + POKE_TTL); // the override ends at tObs + 600
        (a, b) = _fees(keyD);
        assertEq(a, FLAT);
        assertEq(b, FLAT);
        assertEq(_swapFee(keyD, true), FLAT); // Fables' flat 7 bp, what a trader pays
        assertEq(_swapFee(keyD, false), FLAT);
    }

    function test_PoolKKeepsTheKeepersLastPokeForItsTtl() public {
        _lastActionsBeforeTheOutage();
        vm.warp(T0 + KEEPER_TTL - 1);
        (uint24 a,) = _fees(keyK);
        assertEq(a, KEEPER_FEE);
        assertEq(_swapFee(keyK, true), KEEPER_FEE);
        vm.warp(T0 + KEEPER_TTL);
        (a,) = _fees(keyK);
        assertEq(a, FLAT);
    }

    function test_PoolFStaysFlatThroughout() public {
        _lastActionsBeforeTheOutage();
        uint40[4] memory at = [T0 + 1, T0 + 181, T0 + POKE_TTL, T0 + KEEPER_TTL];
        for (uint256 i; i < at.length; i++) {
            vm.warp(at[i]);
            assertEq(_swapFee(keyF, i % 2 == 0), FLAT);
        }
    }

    function test_FirstReportAfterTheOutageIsTakenAsIsAndPokesAgain() public {
        _lastActionsBeforeTheOutage();
        uint40 back = T0 + 900; // 15 minutes later, more than RESET_GAP (180 s)
        vm.warp(back);
        _report(back, SIGMA_300);
        (, uint32 s15, uint32 s5,,,, uint32 seq) = desk.state();
        assertEq(seq, 2);
        assertEq(s5, SIGMA_300); // not ramped from 48 %/yr (x2 per report would give 96 %/yr)
        assertEq(s15, SIGMA_300);
        (uint24 q01, uint24 q10, uint8 mode) = policy.quoteDirectional();
        assertEq(mode, policy.MODE_NORMAL());
        vm.prank(runner);
        poker.poke();
        (uint24 a, uint24 b) = _fees(keyD);
        assertEq(a, q01);
        assertEq(b, q10);
    }
}
```

Run: `cd contracts && forge test --match-path test/v2/Outage.t.sol -vv`
Expected: `6 passed`. The contracts exist since plan 02, so these tests pass at once: they pin the outage behaviour the runbook and plan 04 describe, and a change of TTL, `tauKillSec` or `RESET_GAP` that breaks the table above fails them.

Run: `cd contracts && RH_MAINNET_RPC_URL= SEPOLIA_RPC_URL= forge test && forge fmt --check`
Expected: 0 failed, 6 more passed than at Task 7 (162 passed, 3 skipped), and `forge fmt --check` prints nothing.

- [ ] **Step 15: Commit**

```bash
git add shared/src/outages.ts shared/src/index.ts shared/package.json shared/test/outages.test.ts \
  bots/src/live/lib/supervise.ts bots/src/live/lib/outages.ts bots/src/live/lib/launchd.ts bots/src/live/lib/supervisor.ts \
  bots/src/live/runner.ts bots/src/live/keeper.ts bots/src/live/arb.ts bots/src/live/noise.ts bots/src/live/desk-loop.ts \
  bots/src/live/scripts/outages.ts bots/src/live/scripts/launchd.ts bots/src/live/scripts/status.ts bots/package.json \
  bots/test/live/supervise.test.ts bots/test/live/outages.test.ts bots/test/live/launchd.test.ts \
  cre/scripts/sim-loop.sh contracts/test/v2/Outage.t.sol
git commit -m "feat(bots): launchd supervision, resume after sleep and an on-chain outage record" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

## Part E: operations

### Task 24: Runbook

**Files:**
- Modify: `docs/runbook.md` (title line, intro paragraph, and a new section 8 at the end)

- [ ] **Step 1: Mark sections 0 to 7 as the Sepolia v1 stack**

Replace the runbook's first paragraph (the line under `# clim run-book`) with:

```markdown
Sections 0 to 7: clim v1 on Ethereum Sepolia (the TOKEN2049 Origins stack; its processes ran from the hackathon checkout and were stopped by plan 03 Task 26). Section 8: clim × Fables' live stack on Robinhood Chain testnet. Commands run from the repository root unless a `cd` is shown. Expected output follows each command; addresses, prices and hashes will differ.
```

- [ ] **Step 2: Append section 8**

Append to `docs/runbook.md`:

````markdown
## 8. clim × Fables live stack (Robinhood Chain testnet)

The CRE desk v2 (simulation with `--broadcast`, one report every 30 s) writes `RiskDeskV2`; the runner pokes pool D through `ClimPoker` after each report; a keeper-style bot pokes pool K about every 180 s (an imitation of the pattern observed on Fables' pool, not Fables' code); pool F stays flat at 7 bp; an arbitrage bot and a retail bot trade the three pools. Addresses: `shared/deployments/robinhood-testnet.json`. Explorer: https://explorer.testnet.chain.robinhood.com.

### 8.1 Keys and setup (once)

```bash
bun install && (cd cre/risk-desk && bun install)
cd bots && bun run live:keys   # creates the missing keys in bots/.env and cre/.env, prints addresses only
```

| Role | Variable | Holds |
|---|---|---|
| Deployer (TestToken owner, AccessManager admin) | `contracts/.env` `PRIVATE_KEY`, copied to `bots/.env` `DEPLOYER_PRIVATE_KEY` | role 0 (ADMIN) |
| CRE operator (`RiskDeskV2.simOperator`) | `cre/.env` `CRE_ETH_PRIVATE_KEY` (no `0x`) | nothing on the AccessManager |
| Runner | `bots/.env` `RUNNER_PRIVATE_KEY` | CLIM_RUNNER (7): `ClimPoker.poke()` |
| Keeper (pool K) | `bots/.env` `KEEPER_PRIVATE_KEY` | FEE_POKER (1): `PokeFeeHook.pokeFee` (any pool; the bot pokes K only) |
| Arbitrage, retail | `bots/.env` `ARB_RH_PRIVATE_KEY`, `NOISE_RH_PRIVATE_KEY` | tokens only |

### 8.2 Gas budget and funding

At the measured testnet base fee of 0.01 gwei the stack costs about 0.03 ETH a day (plan 03 Task 11; measured figures in `docs/evidence/gas-robinhood-testnet.json`). Testnet ETH comes from Sepolia through the Robinhood Chain bridge: `cast send 0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4 "depositEth()" --value 0.5ether --private-key "$PRIVATE_KEY" --rpc-url "$SEPOLIA_RPC_URL"` (the Delayed Inbox on Sepolia; credited to the same address on L2 in about 10 minutes), or the faucet https://faucet.testnet.chain.robinhood.com in a browser. Then `cd bots && bun run live:fund` tops up every key (idempotent).

### 8.3 Start (launchd)

The six long-running processes run on the maintainer's Mac as launchd LaunchAgents of the logged-in user, one job per process: launchd starts them at login (so after a reboot), restarts a job that exits 30 s after its last start, and the processes resume by themselves when the Mac wakes (8.6).

| Job | What it runs (from `bots/`, absolute paths in the plist) | Log in `bots/out/logs/` | Expected output |
|---|---|---|---|
| `fi.clim-fables.desk` | `bun src/live/desk-loop.ts --target rh-testnet-settings --cre-bin <cre>` (CRE loop + recorder) | `desk.log` | the loop's `=== <time>` and `[USER LOG]` lines, then `[desk] run <time>: applied tx 0x... seq <n> sigma5 <x> dev <y> gas <g>` every 30 s |
| `fi.clim-fables.runner` | `bun src/live/runner.ts` | `runner.log` | `[runner] seq <n> poked <f01>/<f10> pips, tx 0x..., gas <g>` after each report |
| `fi.clim-fables.keeper` | `bun src/live/keeper.ts` | `keeper.log` | `[keeper] sigma5 <x>%/yr -> K fee <f> pips (TTL 7200 s), tx 0x...` about every 180 s |
| `fi.clim-fables.arb` | `bun src/live/arb.ts` | `arb.log` | `[arb] <pool> pool <p> vs <m> (fee <f>) -> buyEth tx 0x...` when a pool leaves its band |
| `fi.clim-fables.noise` | `bun src/live/noise.ts` | `noise.log` | `[noise] buyEth $<usd> on D (fee <f> pips) tx 0x...`, the same order on K and F |
| `fi.clim-fables.outages` | `bun src/live/scripts/outages.ts --watch` | `outages.log` | `[outages] block <n>: <k> new reports (<total> in all), <w> windows -> bots/out/outages.json` every 5 minutes |

```bash
cd bots && bun run live:install            # writes ~/Library/LaunchAgents/fi.clim-fables.*.plist and starts the six jobs
cd bots && bun run live:logs desk          # follow one job's log (Ctrl+C stops the tail, not the job); no name: all six
cd bots && bun run live:status --watch     # a snapshot every 15 s, with each job's launchd state; PROBLEM lines name anything wrong
```

`live:install` resolves `bun` and `cre` on PATH and writes their absolute paths into the plists; rerun it after moving the repository or reinstalling either tool (it reloads the jobs). `bun run live:install <name>` (re)installs one job. The plists carry only `HOME` and `PATH`: the keys stay in `bots/.env` and `cre/.env`, read by the processes as when started by hand. The desk job runs the CRE CLI as this user, so `cre whoami` must show a logged-in account.

Nothing in this stack keeps the Mac awake: sleep is the maintainer's (his Pauline app owns `pmset disablesleep`). While the Mac sleeps the stack pauses and the pools fall back as 8.6 describes; the outage is recorded, and every job resumes on wake.

### 8.4 Check and stop

```bash
cd bots && bun run live:status          # exit 0: healthy; exit 1 lists each PROBLEM (a job not running included)
cd bots && bun run live:gas             # docs/evidence/gas-robinhood-testnet.json
cd bots && bun run live:verify          # docs/evidence/live-check-<date>.json, PASS/FAIL per check
cd bots && bun run live:outages         # one pass of the outage record now (the outages job runs one every 5 minutes)
launchctl kickstart -k gui/$(id -u)/fi.clim-fables.runner   # restart one job now
cd bots && bun run live:uninstall       # stop every job and remove the plists (nothing comes back at login)
```

`pkill` does not stop a job: launchd starts it again 30 s later (`KeepAlive`). Stop with `bun run live:uninstall` (every job) or `bun run live:uninstall <name>` (one). The jobs' command lines contain `src/live/` (and the desk's child `sim-loop.sh rh-testnet-settings`); none of them matches the Sepolia v1 processes (`--pair live`, `staging-settings`), and the v1 shutdown patterns of section 3 match none of them.

### 8.5 Troubleshooting

- `desk report age > 90 s`: the CRE loop is down or failing; `bun run live:logs desk` and `bots/out/desk-sim/*.log` show why. Credential checks against the CRE API fail now and then (friction log row 24); the loop recovers by itself. After `tauKillSec` (180 s) without a report the policy is blind: the runner stops poking and pool D returns to its flat 7 bp when its last 600 s override ends (8.6).
- `D fee != last poke`: another FEE_POKER key poked D, or a poke reverted; `bots/out/runner-rh.jsonl` has the error.
- `job <name> not running` or `bot <name> silent`: `bun run live:logs <name>` shows the last error; launchd restarts an exited job 30 s after its last start; `launchctl kickstart -k gui/$(id -u)/fi.clim-fables.<name>` restarts it now. `job <name> not loaded`: `bun run live:install <name>`.
- A job exits again at once (`last exit 1` in `live:status`): a key missing from `bots/.env`, the CRE CLI logged out (`cre login`), or a moved repository or tool (`bun run live:install`).
- The public RPC answers 429: set `RH_TESTNET_RPC_URL` in `bots/.env` to a keyed endpoint (never commit it), then restart the jobs so they read it: `for j in desk runner keeper arb noise outages; do launchctl kickstart -k gui/$(id -u)/fi.clim-fables.$j; done`.
- Contracts re-deployed: rerun `cd cre/risk-desk && bun scripts/sync-config.ts`, then `cd bots && bun run live:install` (reloads every job; the desk job rebuilds the WASM). `bots/out/outages.json` starts over from the new desk's deployment block by itself.

### 8.6 Outages

The stack runs on a laptop: the Mac sleeps when the maintainer lets it, can be offline or reboot, and a process can crash. An outage is handled and recorded, never prevented with a keep-awake.

**What happens.** When the whole Mac stops (asleep, offline, rebooting), from the last report's `tObs` (asserted by `contracts/test/v2/Outage.t.sol`); if only the desk fails while the Mac runs, the keeper bot keeps posting on K:

| Time | Desk and policy | Pool D (ClimPoker) | Pool K (keeper-style bot) | Pool F |
|---|---|---|---|---|
| 0 to 180 s | fresh (`tauKillSec` 180) | the last poke's fees | the last keeper poke | flat 700 pips |
| from 181 s | blind: `poke()` reverts `DeskBlind`; the runner logs a skip, not an error | the last poke's fees until `tObs + 600` | the last keeper poke (the keeper bot is down too; its poke lives up to 7,200 s) | flat |
| from 600 s | blind | flat 700 pips (Fables' flat 7 bp) | the last keeper poke until 7,200 s after it, then flat | flat |
| first report after the gap | a gap above `RESET_GAP` (180 s) is taken as is, no ramp from the stale sigma | poked again after that report | posted again at once, from fresh data | flat |

Each process ticks every 10 s or less. After a wall-clock gap of more than 60 s (the Mac slept, or the process was stopped) it writes a `wake` line to `bots/out/outages-local.jsonl`, re-syncs its nonce from the chain, re-reads the desk, and drops anything it prepared before the gap (a keeper fee, an arbitrage or retail order) instead of sending it late. At start it writes a `restart` line dated from its last log line; after three or more failed ticks in a row it writes an `rpc-errors` line when it recovers. Failed ticks back off from 2 s, doubling up to 60 s; a process never crashes on an RPC error. Each CRE run is a fresh process reading its own nonce, and a report delivered late carries its own `tObs`, to which the policy's freshness and D's TTL are anchored.

**How to check.**

```bash
cd bots && bun run live:status                                   # desk age, policy mode, each job, the last outage
cd bots && bun run live:outages && jq '.windows[-3:]' out/outages.json   # the last three windows
tail -n 20 bots/out/outages-local.jsonl                          # what the Mac's processes saw
```

A window has `from` (the `tObs` of the last report before the silence), `to` (that of the first report after it; `null` while it lasts), `durationSec`, `seqBefore` and `seqAfter` (consecutive: no report is missing), `reason` and `local` (the overlapping local records: `wall-clock gap seen by ...: the Mac was asleep or the processes were suspended`, `processes stopped and restarted: ...`, `RPC or network errors in ...`, or `unknown`). Pool D's fee at a moment of a window, on chain: `cast call <hook> 'currentFee(bytes32,bool)(uint24)' <pool D id> true --block $(cast find-block <unix time> --rpc-url https://rpc.testnet.chain.robinhood.com) --rpc-url https://rpc.testnet.chain.robinhood.com`. Plan 04's app shows the same windows, derived from the chain with `outageWindows()` of `@clim/shared`; the local reasons stay on the Mac (`bots/out/` is not committed).

**How to restart.**

- After a sleep: nothing to do. The jobs resume on wake; the desk reports within about 30 s, the runner pokes D after that report, the keeper posts on K at once.
- After a reboot: nothing to do once the maintainer logs in (LaunchAgents start with his session; with nobody logged in, nothing runs and the outage lasts until login).
- After a crash: launchd restarts the job 30 s after its last start. A job that keeps exiting shows its `last exit` code in `live:status`: read `bun run live:logs <name>`, fix the cause, then `launchctl kickstart -k gui/$(id -u)/fi.clim-fables.<name>`.
- Offline: the processes back off and retry; the desk's failed CRE runs are recorded in `bots/out/desk-runs.jsonl`; everything resumes with the network.
- Never add `caffeinate` or change `pmset`: the Mac's sleep is the maintainer's (Pauline).
````

- [ ] **Step 3: Commit**

```bash
git add docs/runbook.md
git commit -m "docs(runbook): clim x Fables live stack on Robinhood Chain testnet" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 25: Go live and measure the gas

This task runs the stack on Robinhood Chain testnet with testnet keys, as launchd jobs on the maintainer's Mac (Task 23). The Mac's sleep stays his (his Pauline app): do not run `caffeinate` or `pmset`, and do not ask him to keep the Mac awake. If it sleeps during this task, the outage is recorded (runbook 8.6) and the 30-minute check below waits for 30 minutes without one.

- [ ] **Step 1: Preflight**

Run: `cd bots && bun run live:fund && cre whoami && bun src/live/scripts/launchd.ts print desk | plutil -lint - && (pgrep -fl "src/live/|sim-loop.sh rh-testnet-settings" || echo "no live process running")`
Expected: one `[fund] ... ready` line per key, the CRE account `cre whoami` shows (no secret), `<stdin>: OK`, then `no live process running` (the hand-started runs of Tasks 17 and 19 have ended). If `cre whoami` says you are logged out, ask the maintainer to run `cre login` (a browser login).

- [ ] **Step 2: Install the launchd agents**

Run: `cd bots && bun run live:install`
Expected: the resolved `bun`, `cre` and repository paths, then six lines `fi.clim-fables.<name>: running (pid <n>), logs <repo>/bots/out/logs/<name>.log` (desk, runner, keeper, arb, noise, outages).

Run: `cd bots && perl -e 'alarm shift; exec @ARGV' 150 bun run live:logs desk` (the alarm ends the tail after 150 s, exit code 142; the job keeps running)
Expected: `[desk] start: desk seq <n>, last report <age> s ago`, the WASM build, then `[desk] run <time>: applied tx 0x... seq <n+1> ...` and an `applied` line every 30 s.

Run: `cd bots && perl -e 'alarm shift; exec @ARGV' 90 bun run live:logs runner keeper arb noise`
Expected: one `[runner] seq ... poked` per report (a first `desk blind, no poke until the next report` line is normal when the jobs started before the desk's first report: the last report was Task 19's); one `[keeper]` line; `[arb]` lines (the first arbitrage moves each pool to the venue price if it drifted since deployment); `[noise]` lines in threes (D, K, F).

- [ ] **Step 3: Check after 30 minutes**

Run: `cd bots && bun run live:status`
Expected: exit code 0 and no `PROBLEM:` line: desk age under 90 s, policy `normal`, D's fee equal to the last poke, K's fee from the keeper's last poke, F at 700/700, every key above 0.01 ETH, every bot logging, six `job fi.clim-fables.<name>: running pid <n>` lines, and the outages line (windows from before the go-live, if any). Fix any problem with runbook 8.5 before going on.

- [ ] **Step 4: Measure the gas**

Run: `cd bots && bun run live:gas`
Expected: five lines (`deskReport`, `poke`, `keeperPoke`, `arbSwap`, `retailSwap`) with up to 200 receipts each, then `wrote docs/evidence/gas-robinhood-testnet.json`. Each summary has `gasUsedMedian`, `gasUsedP90`, `gasUsedForL1Median`, `effectiveGasPriceMedianWei` and `costMedianEth`.

- [ ] **Step 5: Record and commit**

Append to the session log, from `docs/evidence/gas-robinhood-testnet.json`: `(ops) Live stack on Robinhood testnet since <UTC time>, six launchd jobs (fi.clim-fables.*) on the maintainer's Mac. Gas per transaction (median, p90, L1 part, cost at the median price): desk report <g>/<p90>/<l1>, <eth> ETH; poke <...>; keeper poke <...>; arbitrage swap <...>; retail swap <...>. At 2,880 reports and pokes a day, the desk and its poker cost <x> ETH/day on testnet.` Update the budget table of runbook 8.2 if the measured total differs from 0.03 ETH/day by more than half. Then:

```bash
git add docs/evidence/gas-robinhood-testnet.json docs/sessions/ docs/runbook.md
git commit -m "feat: clim x Fables live on Robinhood Chain testnet, gas per report and per poke measured" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
```

### Task 26: Final verification, then stop the Sepolia v1 stack

- [ ] **Step 1: Run the on-chain checks**

After the stack has run for at least 35 minutes with no outage in the last 30 (`bun run live:status` shows the last window), run: `cd bots && bun run live:verify`
Expected:

```text
PASS deskReports {"reports":<about 60>,"firstSeq":...,"lastSeq":...,"seqStepsByOne":true,"maxGapSec":<= 90,...}
PASS poolDFollowsPolicy {"pokes":<about 60>,"hookFeePokedMatches":<same>,"lastTenMatchingQuote":10,...}
PASS poolKKeeperPattern {"pokes":<about 10>,"fromKeeper":<same>,"ttl7200":<same>,"medianGapSec":<about 180>,...}
PASS poolFFlat {"pokes":0,"fee0For1":700,"fee1For0":700}
PASS swapsLand {"D":{"arb":<n>,"retail":<n>,"meanFeePips":<x>},"K":{...},"F":{...}}
wrote docs/evidence/live-check-<date>.json
```

and exit code 0. A FAIL names its check and the numbers behind it: fix the cause (runbook 8.5), wait 35 minutes, run it again. Do not loosen a threshold to make a check pass; if a threshold is wrong for a reason that is not a fault (for example no arbitrage at all because the venues did not move), write the reason in the session log and ask the maintainer. Run this step before Step 3: the simulated outage puts a gap of more than 90 s in the window `deskReports` reads.

- [ ] **Step 2: Record**

Append to the session log: the five check lines (numbers included), the explorer links of the desk, the poker, the hook and the three pools (`https://explorer.testnet.chain.robinhood.com/address/<address>`), and: `Gate of plan 03: CRE desk reporting on Robinhood testnet, pools D, K, F live with bots, contracts verified on Sourcify and Blockscout (Task 12).`

- [ ] **Step 3: Simulate an outage and check its record**

Stop every job for 12 minutes, then reinstall them, and check that the outage is on the record and that pool D charged Fables' flat fee during it. Twelve minutes, not five: D's last override lives until its report's `tObs + 600`, so a stop shorter than about 11 minutes ends before D falls back to flat (the desk is blind from 181 s).

Run: `cd bots && date -u +%FT%TZ && bun run live:uninstall && (pgrep -fl "src/live/|sim-loop.sh rh-testnet-settings" || echo "stack stopped")`
Expected: the UTC time, six `fi.clim-fables.<name>: removed` lines, then `stack stopped`.

Wait 12 minutes (a background `sleep 720` or a Monitor; nothing runs meanwhile). Then:

Run: `cd bots && date -u +%FT%TZ && bun run live:install && perl -e 'alarm shift; exec @ARGV' 120 bun run live:logs desk runner`
Expected: six `running` lines, `[desk] start: desk seq <n>, last report <about 730> s ago`, an `applied` line with seq `<n+1>` within about a minute, then `[runner] seq <n+1> poked ...`.

Run: `cd bots && bun run live:outages && jq '.windows[-1] | del(.local)' out/outages.json`
Expected (times and numbers from the run):

```json
{
  "from": <tObs of seq n>,
  "to": <tObs of seq n+1>,
  "durationSec": <about 760>,
  "seqBefore": <n>,
  "seqAfter": <n+1>,
  "ongoing": false,
  "reason": "processes stopped and restarted: arb, desk, keeper, noise, outages, runner"
}
```

If the reason starts with `wall-clock gap seen by` instead, the Mac slept during the stop as well; that is a true record, note it in the session log.

Then read D, K and F and the policy at a block 660 s after `from` (D's last override ended at `from + 600`):

```bash
cd bots && RPC=https://rpc.testnet.chain.robinhood.com && DEP=../shared/deployments/robinhood-testnet.json \
  && T=$(( $(jq '.windows[-1].from' out/outages.json) + 660 )) && B=$(cast find-block $T --rpc-url $RPC) && echo "block $B (t $T)" \
  && for p in D K F; do echo "$p $(cast call $(jq -r .hook $DEP) 'currentFee(bytes32,bool)(uint24)' $(jq -r .pools.$p.poolId $DEP) true --block $B --rpc-url $RPC) $(cast call $(jq -r .hook $DEP) 'currentFee(bytes32,bool)(uint24)' $(jq -r .pools.$p.poolId $DEP) false --block $B --rpc-url $RPC)"; done \
  && cast call $(jq -r .policy $DEP) 'quoteDirectional()(uint24,uint24,uint8)' --block $B --rpc-url $RPC
```

Expected: `D 700 700` (Fables' flat 7 bp), `K <f> <f>` with `<f>` the keeper's last fee before the stop (its 7,200 s poke still lived), `F 700 700`, then the policy's quote whose last value is `2` (blind). Check that `T` is before `to` (`durationSec` above 660); if not, the stop was too short: repeat this step with a longer wait.

Run: `cd bots && bun run live:status`
Expected: exit code 0 a few minutes after the reinstall, and `outages: <w> recorded ..., last from <from> UTC, <about 760> s: processes stopped and restarted: ...`.

- [ ] **Step 4: Stop the Sepolia v1 stack**

The v1 processes run from `/Users/fianso/Development/hackathons/clim/bots`. Run the master plan's patterns, plus the two that match the children `bun run` leaves behind:

```bash
pkill -f "cre-loop --pair live"; pkill -f "arb --pair live"; pkill -f "noise --pair live"; pkill -f "status --pair live"
pkill -f "src/sim-loop.ts --pair live"; pkill -f "sim-loop.sh staging-settings"
sleep 2; pgrep -fl "pair live|staging-settings" || echo "no Sepolia v1 process left"
pgrep -fl "live:(desk|runner|keeper|arb|noise)|src/live/|rh-testnet-settings"
```

Expected: `no Sepolia v1 process left`, then the testnet processes still listed (desk loop, runner, keeper, arbitrage, retail, outages, all under launchd). If a v1 process survives, `kill` its PID from the `pgrep` line. If a testnet process is missing, `bun run live:status` names its job; restart it (runbook 8.5).

The master plan's note on restoring the Mac's sleep with `pmset` once the Sepolia bots stop is superseded by the maintainer's decision of 2026-10-14: his Pauline app owns that switch and the live stack handles sleep as an outage. Leave `pmset` alone and do not ask about it.

- [ ] **Step 5: Record, tick the master plan, commit and push**

Append to the session log: `(ops) Sepolia v1 stack stopped at <UTC time> (cre-loop, arb, noise, status of the hackathon checkout). The live stack runs as six launchd jobs on the maintainer's Mac; its sleep stays his (Pauline), pmset untouched. Simulated outage: jobs stopped <UTC> to <UTC>; outages.json window <from> to <to> UTC, <durationSec> s, seq <n> to <n+1>, reason "<reason>"; at block <B> (from + 660 s) D 700/700, K <f>/<f>, F 700/700, policy mode 2 (blind).` In `docs/superpowers/plans/2026-10-13-clim-fables-00-master.md`, tick the two checkboxes of Task 4. Then:

```bash
git add docs/evidence/live-check-*.json docs/sessions/ docs/superpowers/plans/2026-10-13-clim-fables-00-master.md
git commit -m "docs: plan 03 gate, live checks on Robinhood testnet, outage drill, Sepolia v1 stopped" -m "Claude-Session: https://claude.ai/code/session_01Q1bBQaY1nVKYS7LpCGsXFB"
git push
```

---

## Self-review notes (for the executor)

- Every number published from this plan comes from a script output (`lab/out/fables-estimator.json`, `shared/keeper-map-fables.json`, `docs/evidence/gas-robinhood-testnet.json`, `docs/evidence/live-check-*.json`) or a chain read recorded in the session log.
- The K pool's bot is an imitation of an observed pattern; every place that shows it (the deployments file's `driver`, the bot's header and log line, the runbook) says so. Never describe it as Fables' keeper.
- Nothing in this plan writes to Robinhood Chain mainnet: the only mainnet access is the shadow target's `eth_call` (read) and plan 01's lab reads. `LiveScript._guard()` and `deploy-live.sh` refuse chain 4663.
- No secret is printed: keys are created by `live:keys` (addresses only), `contracts/.env` is sourced, never echoed, and every RPC used in a command is public. The launchd plists carry only `HOME` and `PATH` (`plistFor` refuses anything else).
- Nothing in this plan keeps the Mac awake: no `caffeinate`, no `pmset`, no request to the maintainer to keep it awake. His Pauline app owns sleep; the stack treats a sleep as an outage, recovers from it, and records it (Task 23, runbook 8.6).
- Outage windows come from the chain (consecutive `RiskReportedV2`, gap above 90 s) and are published as measured; plan 04's app shows them, it does not hide the gaps of a laptop-hosted showcase.
