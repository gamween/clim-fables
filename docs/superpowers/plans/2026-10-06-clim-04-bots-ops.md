# clim 04: Shared Package, Bots and Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Where commands run:** every command in this plan runs from the repository root, `~/Development/hackathons/clim`, unless it starts with its own `cd` (`cd shared && ...`, `cd bots && ...`). Launch Claude Code with that folder as its working directory, or prefix each command with `cd ~/Development/hackathons/clim && `: agent shells reset to the launch folder between calls.

**Goal:** Build `shared/`, the single TypeScript source of truth (units, the fee formula mirror, price math, the CRE report encoding, ABIs, deployments and parameters), and `bots/` (arbitrageur, retail flow, CRE run recorder around plan 02's simulation loop, replay server, funding, status and forged-report scripts), plus the run-book that starts everything on Ethereum Sepolia.

**Architecture:** A root Bun workspace holds `shared` and `bots`. `shared/src` is runtime-agnostic TypeScript (no Bun or Node API), so the CRE workflow can import it and plan 05's standalone app can port it against the same test vectors; the JSON files in `shared/` (deployments, params, ABIs) are read through validated, typed loaders. Every piece of logic in `bots/` is a pure, unit-tested function in `bots/src/lib/` or `bots/src/replay/`; the entry points (`arb.ts`, `noise.ts`, `sim-loop.ts`, `replay-server.ts`, `scripts/*.ts`) only wire those functions to viem clients, child processes and HTTP.

**Tech Stack:** Bun 1.3.9 (the version plan 02 pins; this plan's tests and typecheck also pass under 1.4.2: runtime, `bun test`, workspaces, `Bun.serve`, `Bun.spawn`), TypeScript 5.9.3 (`tsc --noEmit`), viem ^2.57.3, Foundry `cast` (ops), Chainlink CRE CLI (through plan 02's `cre/scripts/sim-loop.sh`).

---

## Decisions this plan makes

- **Runtime: Bun, not node/tsx.** The CRE TypeScript SDK already requires Bun (`@chainlink/cre-sdk` 1.23.0 declares `engines.bun >= 1.2.21`; the CRE templates use `bun install` and `bun test`), so Bun is installed anyway. Bun runs TypeScript without a build step and ships the test runner (`bun:test`), the HTTP server (`Bun.serve`, replay server), process spawning (`Bun.spawn`, CRE loop) and `.env` loading. One runtime for `cre/` and `bots/`, no extra tooling.
- **Workspace:** root `package.json` with Bun workspaces and `bunfig.toml` `linker = "hoisted"` (classic `node_modules`). The `workspaces` array grows as packages appear: `shared` (Task 1), then `bots` (Task 7). Bun refuses to install when a listed workspace folder does not exist (`error: Workspace not found "bots"`), so a folder is listed only once it exists. `cre/` and `app/` are **not** workspace members (the CRE CLI expects its own `node_modules` in the workflow folder; plan 05 deploys `app/` on its own).
- **`shared/src` stays runtime-agnostic.** Only `shared/test` and `shared/scripts` may use Bun or Node APIs.
- **Aligned with the sibling plans (01, 02, 05, 06 were written in parallel; this plan follows what they produce or request):**
  - `shared/deployments/sepolia.json` has exactly the layout plan 01's `05_WriteDeployments` writes and plan 05's app parses: token objects `tokens.tETH/tUSD`, `riskDesks.live/replay/don`, `hooks.live/replay`, `pools.*`, one token pair for both pairs (plan 01 keeps the PoolKeys distinct with different static fees, and updates spec 3.7). Plan 01's extra keys (`deployer`, `liquidity`) are ignored. Plan 02's `sync-config.ts` reads other key names and says to change its `KEYS` constant only: it must read `tokens.tETH.address`, `tokens.tUSD.address`, `riskDesks.live`, `riskDesks.replay`, `riskDesks.don`;
  - `routers.arb` (plan 05's request): the arbitrage bot swaps through its own PoolSwapTest, so the dashboard can tell arbitrage from retail swaps by `Swap.sender`. Plan 01's `00_Tokens` deploys it and `05_WriteDeployments` records it; if it is ever null the bot falls back to the shared PoolSwapTest and says so;
  - the CRE loop is plan 02's `cre/scripts/sim-loop.sh` (it builds the WASM once and simulates every 30 s with `--wasm`); `bun run cre-loop` (file `bots/src/sim-loop.ts`) runs it, records every run on-chain and writes per-run transcripts to `bots/out/cre-sim/` (plan 06's evidence input) instead of writing a second loop;
  - the replay server serves plan 02's replay contract, `GET /venue/<venue>/api/v3/klines` (Binance 1m klines with timestamps shifted to the wall clock, one path per venue), plus the Binance ticker for the replay arbitrageur, historical klines and a diagnostic `GET /snapshot`;
  - package scripts (canonical for every plan): `cre-loop`, `arb`, `noise`, `forge-report`, `fund`, `status`, `replay-server`;
  - retail flow is mirrored to both pools by default (spec 3.8); `split` and `cheapest` are variants;
  - the app stays a standalone npm project (plan 05 declined the workspace), so the root workspace holds only `shared` and `bots`; the fee mirror vectors below are what plan 05's port is checked against;
  - the fee mirror follows the spec's hook algorithm (`seq == 0`, `age = max(now - tObs, 0)`), which is equivalent to plan 01's `tObs == 0 || block.timestamp > tObs + tauKillSec`.
- **One key per bot and pair** (`ARB_LIVE`, `NOISE_LIVE`, `ARB_REPLAY`, `NOISE_REPLAY`) so concurrent processes never share a nonce. Plan 01 uses one key as deployer, TestToken owner and the live desk's `simOperator` (= `CRE_ETH_PRIVATE_KEY` of `cre/.env`), so `fund` runs while the live CRE loop is stopped. The replay desk has its own operator key (`cre/.env.replay`, plan 01 Task 18): `ENV_FILE=.env.replay bun run cre-loop --pair replay` passes it to plan 02's loop script (`sim-loop.ts` spawns the script with `process.env`).
- **Arbitrage band is exact:** a v4 fee is taken from the input, so the no-arbitrage band is `[m(1-f), m/(1-f)]` (log half-width `gamma = -ln(1-f)`, as in spec 3.8) and the bot pushes the pool to the nearest edge.
- **`.gitignore`:** the existing `out/` rule also ignores `lab/out/` (`git check-ignore -v lab/out/x.json` prints `.gitignore:10:out/`), which the app reads and must be committed. It becomes `app/out/`, plus a `bots/out/*` block that keeps the two evidence files tracked (`!bots/out/cre-runs.jsonl`, `!bots/out/security-demos.jsonl`): the same block plan 06 Task 1 expects; plan 06 links them from `docs/evidence/README.md`.
- **Logging:** session-log bullets go under a `## Build notes` heading at the end of today's log (`docs/sessions/2026-10-06.md` on day 1, `docs/sessions/2026-10-07.md` on day 2; create the heading once if missing), prefixed `(ops)`, as plan 02 does with `(CRE)`. New friction-log rows take the next free number.

## Contracts with other plans (they must use exactly these)

1. **`shared/deployments/sepolia.json`** (written by plan 01's `05_WriteDeployments`; validated by `parseDeployments`, Task 6):
   - `chainId` 11155111; `deployBlock` number or null; `uniswap.{poolManager,stateView,poolSwapTest,poolModifyLiquidityTest}`; `cre.{mockForwarder,keystoneForwarder}`;
   - `tokens.tETH` / `tokens.tUSD`: `{ address, symbol, decimals }` or null (one pair for the live and the replay pools);
   - `riskDesks.{live,replay,don}`, `hooks.{live,replay}`: address or null (`don` may be absent);
   - `pools.{liveV,liveS,replayV,replayS}`: `{ key: { currency0, currency1, fee, tickSpacing, hooks }, poolId, token0IsEth }` or null, where `poolId = keccak256(abi.encode(key))`, the currencies are tETH and tUSD sorted (`currency0 < currency1`), `token0IsEth == (currency0 == tETH)`, V pools have `fee = 8388608` (0x800000) and `hooks = hooks.<pair>`, S pools have a static fee and `hooks = 0x0000000000000000000000000000000000000000`;
   - `routers.arb`: address or null (may be absent): a second PoolSwapTest (`new PoolSwapTest(IPoolManager(poolManager))`, v4-core `src/test/PoolSwapTest.sol`) that only the arbitrage bot uses. **Plan 01's `00_Tokens` deploys it and `05_WriteDeployments` writes this key** (plan 05's request); `arbRouter(d)` falls back to `uniswap.poolSwapTest` while it is null;
   - other keys (plan 01's `deployer`, `liquidity`) are ignored.
2. **`shared/params.json`** (written by the lab decision, plan 03, spec 2.6): `pStar, etaE4, sqrtHalfDtE6, feeMinPips, feeMaxPips, feeSafePips, tauKillSec, decidedBy` are read here; the lab also writes `staticFeePips`, `replayStaticFeePips` (plan 01's S pools) and `decidedAt`, which `parseParams` ignores. `parseParams` enforces `|etaE4 - round((1/pStar - 0.824) * 1e4)| <= 1` and `0 < feeMinPips <= feeSafePips <= feeMaxPips <= 1,000,000` (the hook constructor's bounds). This plan commits a bootstrap file whose `decidedBy` starts with `PROVISIONAL`; plan 01's hook deploy script must refuse to deploy while it does (helper `isProvisional`, which also flags a `FIXTURE` prefix, as the master plan requires). Both hooks (live and replay) are deployed from the same `params.json`, since `status.ts` checks either pair against it.
3. **Fee formula mirror** (`feePips`, `quoteFeeMirror` in `shared/src/units.ts`) = spec 3.6. Shared test vectors (sqrtHalfDtE6 2,449,490, kE4 10,000), to be reused by plan 01's Foundry tests: 48 %/yr = sigmaE9 85,475 with etaE4 91,761 gives **1,922 pips** (unrounded 1,921.2: the "1,921" quoted in the design brief is not the ceiling); 25 %/yr = 44,518 gives 1,001; 100 %/yr = 178,072 gives 1,822 (P\* 20 %, etaE4 41,760) and 1,095 (P\* 30 %, etaE4 25,093); 225 %/yr = 400,663 gives 4,099 and 2,463; 46 %/yr = 81,913 at P\* 30 % gives 504; SIGMA_MAX 1,780,730 at P\* 20 % gives raw 18,216, capped to 15,000; k = 2.0 at 100 %/yr, P\* 30 % gives 2,190; an exact product (10,000 x 10,000 x 1,000,000 x 10,000) gives 10 and one more unit of sigma gives 11. Annual sigma to sigmaE9 rounds to nearest (100 %/yr is 178,072, not 178,073). `status.ts` compares the deployed hook's `quoteFee()` with the mirror on every block.
4. **TestToken** (plan 01): ERC-20, 18 decimals, `mint(address to, uint256 amount)` callable only by the deployer (`onlyOwner`), plus a public `faucet()` (10 tETH or 25,000 tUSD per address per hour) that plan 05's `/swap` and `/lp` pages use; `fund.ts` mints from the deployer key.
5. **ABIs:** plan 01 Task 14's `contracts/script/export-abis.sh` is the only exporter: it writes bare ABI arrays to `shared/abis/` for RiskDesk, IRiskDesk, ClimHook, TestToken, IPoolManager, IStateView, PoolSwapTest and PoolModifyLiquidityTest, including the three this package checks (RiskDesk, ClimHook, TestToken); `shared/test/abis.test.ts` then fails if the hand-written fragments drift from the compiled contracts. (Task 5's `shared/scripts/export-abis.ts`, a three-contract subset, and its `export-abis` script were removed on 2026-10-07, commit `5ed36a8`.)
6. **CRE loop and log lines (plan 02), transcripts (plan 06):** `cre/scripts/sim-loop.sh <staging-settings|replay-settings> --broadcast`, run from `cre/`, prints `=== <UTC time>` before each run and the workflow's `[USER LOG]` lines plus any line containing `rror` and the CLI's failure lines marked `✗` (for example `✗ Credential validation failed`). `bots/src/lib/simParse.ts` reads the workflow's final lines: `REPORT applied ... tx=0x..`, `REPORT sent, desk state unreadable after tx=0x..`, `NOT APPLIED: ... tx=0x..`, `REJECTED by RiskDesk (onReport reverted) tx=0x..`, `clim: no report (<reason>)`, `DRY RUN: ...`. The CRE template's `Write report transaction succeeded: 0x..` comes before the final line, so it is kept in the transcript but does not end the run; when the simulator loses the final line, the run keeps that line's tx. For a run with a tx the receipt decides `applied`: the forwarder's `ReportProcessed.result` true and a `RiskReported` from the desk in that tx (`statusFromReceipt: true` when this overrides the workflow's line, which stays in `detail`). If plan 02 changes these words, change `RULES` in `simParse.ts` and its test in the same commit. `bun run cre-loop` writes each run's transcript (from its `===` line to its last line, which carries `tx=0x...`) to `bots/out/cre-sim/<pair>-<run start>.log`: the "one file per `cre workflow simulate` run" that plan 06's evidence collector reads (they hold the loop's filtered stdout; the complete CLI output is in plan 02's `cre/logs/`).
7. **Replay (plans 02 and 03):** plan 03 writes `lab/out/replay-window.json` = `{ symbol: "ETHUSDT", source, startTs, stepSec: 1, warmupSec, closes }`: `startTs` on a minute boundary, `warmupSec` a multiple of 60 and >= 1260 (use 1800: 2026-02-04 11:30 to 16:00 UTC, 16,200 closes, about 128 KB, no gap in `lab/data/b1s_feb.csv`), one close per second, forward-filled, length a multiple of 60. The server maps the main start (12:00 UTC) to the wall-clock minute it starts on and then runs at 1x. **Plan 02's replay mode reads `GET /venue/<venue>/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20`** (one call per configured venue): Binance 1m klines whose open and close times are shifted to the wall clock (`+offsetSec`, a multiple of 60), so the workflow's freshness rule works with DON time. Every venue path returns the same series, so the quorum is met by construction, dispersion is 0 and `dvolE2 = 0`; the replay desk's REPLAY flag discloses it. The plan 00 integration check ran this route through plan 02's parser and estimator: all 479 replay reports from 12:00:30 reproduce the lab's `points[].rv15E9` exactly. `GET /api/v3/ticker/price?symbol=ETHUSDT` gives the replay arbitrageur its market price; `GET /api/v3/klines` (historical times) and `GET /snapshot` (`{ nowSec, usdtUsd: 1, dvol: null, venues: [binance-replay-1..4] }` in historical time) are diagnostics.
8. **Importing `shared/` from `cre/`:** `shared/src/units.ts` has no dependency and can be imported by relative path (`../../shared/src/units`); `shared/src/report.ts` imports viem, which Bun resolves from the root `node_modules` only after a root `bun install`. The desk's rounding rule is `sigmaE9 = Math.round(rv15PerSqrtSecond * 1e9)`.
9. **App (plan 05):** standalone npm project, outside the workspace. It copies `shared/deployments/sepolia.json`, `shared/params.json` and `shared/abis/*.json` with its sync script and ports the fee helpers, checked against the vectors of contract 3. It identifies arbitrage swaps by `Swap.sender == routers.arb` and recovers the arbitrageur's market price from the post-swap price, which relies on this plan's band edges `[m(1 - f), m/(1 - f)]`.
10. **Pool depth and start price (plan 01):** seed V and S with the same full-range liquidity, about 100,000 tETH + 271,000,000 tUSD at 2,713 (L of about 5.2e24 for 18/18 tokens; plan 01's fork run measured 5.2086e24); same for the replay pools at the window's start price (about 2,255). At that depth a $2,000 retail order moves the price about 0.15 bp (measured 0.147 bp on a fork), well under the per-block volatility (about 3 bp at 50 %/yr), so retail flow does not drive the arbitrage frequency. The first plan had 10,000 tETH (L about 5.2e23), where a $2,000 order moved the price about 1.5 bp (measured 1.25 bp for $1,696) and 3 of the arbitrage bot's first 4 decisions on S hit `PriceLimitAlreadyExceeded`. Pools may start a little off the market: the arbitrageur aligns them on its first block. A visitor's `/lp` deposit (plan 05, a few tETH from the faucet) changes one pool's L by about 0.01 %, so V and S stay twins.

## Verified facts (how)

- Sepolia bytecode present (`cast code <addr> --rpc-url https://ethereum-sepolia-rpc.publicnode.com | wc -c`) at PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`, StateView `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C`, PoolSwapTest `0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe`, PoolModifyLiquidityTest `0x0C478023803a644c94c4CE1C1e7b9A087e411B0A`, MockKeystoneForwarder `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`, KeystoneForwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`. `StateView.poolManager()`, `PoolSwapTest.manager()` and `PoolModifyLiquidityTest.manager()` all return the PoolManager above. Selectors `0x2229d0b4` (PoolSwapTest.swap) and `0xc815641c` (StateView.getSlot0) are in the deployed bytecode.
- `PoolSwapTest.swap(PoolKey, SwapParams{zeroForOne, amountSpecified, sqrtPriceLimitX96}, TestSettings{takeClaims, settleUsingBurn}, bytes)` and its settlement (`transferFrom(msg.sender, manager, amount)`, so approve PoolSwapTest) read in `Uniswap/v4-core` `src/test/PoolSwapTest.sol` and `test/utils/CurrencySettler.sol`; a negative `amountSpecified` is exact input; `Pool.swap` reverts `PriceLimitAlreadyExceeded` unless the limit is strictly beyond the current price in the swap direction.
- MockKeystoneForwarder source (Sourcify, verified): `report()` is permissionless, slices `rawReport[45:109]` as metadata and `rawReport[109:]` as the report, calls `onReport` through `route()`, emits `ReportProcessed(receiver, executionId, reportId, result)` and does not revert when the receiver reverts.
- Spec Appendix B question 1 answered on-chain: `cre workflow simulate --broadcast` sends `report()` from the `CRE_ETH_PRIVATE_KEY` account straight to the mock forwarder, so `tx.origin` is the operator and the RiskDesk SIM guard works. While planning this was read on another project's tx, `0xe57a006e7585984137cb5064d6be6fc7b9353194760178b85a78274c8785fa2c` (from the EOA `0x7277EDa336023Fe93142153a5bba4C770C1E6689`, not ours; block 11,855,382, before clim's deploy block 11,856,974; selector `0x11289565`, gas used 185,913). Confirmed on our own desk (checked with `cast tx` and `cast receipt` on 2026-10-07): clim's first report, tx `0x6046552302b7711c4987ee7706d957538dc11ee77ca557b18c92261154e21cb6` (block 11,857,019, selector `0x11289565`, gas used 272,704), goes from our operator `0x53aB240f6cffC204FC22ac6722D9632d753a5A82`, the `CRE_ETH_PRIVATE_KEY` account and the live desk's `simOperator`, to the mock, which logs the desk's `RiskReported` (seq 1) and `ReportProcessed` with result true. Its metadata carries placeholders (workflowCid `0x11...11`, workflowName 10 bytes, owner `0xaa...aa`, header timestamp 100), which is why the spec keeps the workflow-identity checks off in simulation.
- All the code below was typechecked (`tsc --noEmit`) and unit-tested (`bun test`: shared 55 pass and 3 skip, bots 57 pass) under Bun 1.4.2 and viem 2.57.3. After the plan 00 integration changes (simParse outcome rules, wall-clock venue klines) the suite is shared 55 pass and 3 skip, bots 60 pass, re-run under both Bun 1.3.9 and 1.4.2. After the 2026-10-07 receipt classification fix (Tasks 16 and 17): bots 66 pass, simParse 15, under Bun 1.3.9. On 2026-10-07, with the committed `shared/abis/*.json` (so the drift checks run) and without the removed export script: shared 58 pass, 0 skip; bots 66 pass (Bun 1.3.9). End to end on an anvil fork of Sepolia (real PoolManager, StateView, PoolSwapTest and MockKeystoneForwarder; stub tokens, a stub desk with the `tx.origin` guard and a stub override-fee hook installed at an address carrying the afterInitialize and beforeSwap flags; both token orders tried): `fund` minted and approved (arbitrage key on a second PoolSwapTest installed as `routers.arb`, retail key on the shared one; replay keys skipped), `status` read both pools and the 4-venue median, exited 0 when the hook matched the mirror and 1 with a `PROBLEM` line when it did not; `arb` moved each pool exactly to the band edge `m(1 - f)` on its first block (fees of 5 bp and 30 bp tried), printed `none` inside the band, and its swaps carried `Swap.sender = routers.arb`; `noise` mirrored each order to V and S; a stub-desk report sent by the operator through the mock was applied while `forge-report` was rejected (`forwarder result=false`, desk unchanged); `cre-loop` (driving a stand-in for plan 02's script) recorded `applied` (with the decoded `RiskReported`, `forwarderResult true`), `no-report` and `error` runs with one transcript file each, and `--once` stopped after the first. The replay server served the real February window: `/snapshot` gave four venues of 25 closed candles with `nowSec` inside the window.
- Public venue endpoints answered from Singapore: Coinbase Advanced product `price`, Kraken `Ticker?pair=ETHUSD,USDTUSD` (`result.XETHZUSD.c[0]`, `result.USDTZUSD.c[0]`), Binance `data-api.binance.vision` ticker (USDT), Hyperliquid `allMids` (`ETH`).

## File structure

| Path | Responsibility |
|---|---|
| `package.json` | Root Bun workspace; `bun run test` and `bun run typecheck` across packages |
| `bunfig.toml` | Hoisted linker (classic `node_modules`) |
| `.gitignore` (modify) | Track `lab/out/`; ignore `app/out/` and `bots/out/` |
| `shared/package.json`, `shared/tsconfig.json` | `@clim/shared` package (TypeScript source, no build) |
| `shared/src/units.ts` | Unit conversions (sigma, pips, bp, eta, P_trade) and the `feePips` and `quoteFeeMirror` mirrors of ClimFeeMath and ClimHook |
| `shared/src/price.ts` | `sqrtPriceX96` <-> ETH price in USD for either token order and any decimals; v4 price bounds |
| `shared/src/report.ts` | CRE report ABI (9 fields), encode and decode, MockKeystoneForwarder raw report builder |
| `shared/src/abis.ts` | Typed `as const` ABI fragments: StateView, PoolSwapTest (with v4 errors), RiskDesk, ClimHook, TestToken, MockKeystoneForwarder (the unused PoolManager events fragment was removed on 2026-10-07, commit `4719557`) |
| `shared/src/config.ts` | Types and validated loaders for deployments and params; `poolIdFromKey`, `resolvePair`, `orientationOf`, `arbRouter` |
| `shared/src/index.ts` | Barrel export |
| `shared/deployments/sepolia.json` | Addresses (verified infrastructure now; plan 01 fills the rest) |
| `shared/params.json` | Hook parameters (provisional until the lab decision) |
| `shared/abis/*.json` | Compiled ABIs exported from `contracts/out` (written by plan 01's `contracts/script/export-abis.sh`, the only exporter) |
| `shared/test/*.test.ts` | Tests of the above |
| `bots/package.json`, `bots/tsconfig.json`, `bots/.env.example` | `@clim/bots` package and its environment template |
| `bots/src/lib/env.ts` | CLI flags, env numbers and strings, private keys per role and pair |
| `bots/src/lib/jsonl.ts` | JSON-lines logs in `bots/out/`, compact error text |
| `bots/src/lib/rng.ts` | Seeded PRNG, normal, Poisson, log-normal |
| `bots/src/lib/swap.ts` | Token-order mapping, PoolSwapTest arguments, retail input amounts |
| `bots/src/lib/arb.ts` | Myopic arbitrage decision and price limit |
| `bots/src/lib/market.ts` | Venue parsers, median with a quorum of 3, replay price |
| `bots/src/lib/noise.ts` | Retail order planning and routing (mirror, split, cheapest) |
| `bots/src/lib/simParse.ts` | Plan 02 loop output -> one result per run; the loop command |
| `bots/src/lib/chain.ts` | viem clients, per-block multicall of pools, hook and desk, balances |
| `bots/src/replay/klines.ts` | Replay window validation, clock, wall-clock venue klines (plan 02's replay mode), historical klines, ticker, `/snapshot` and status |
| `bots/src/arb.ts`, `bots/src/noise.ts`, `bots/src/sim-loop.ts` (`bun run cre-loop`), `bots/src/replay-server.ts` | Long-running entry points |
| `bots/src/scripts/fund.ts`, `status.ts`, `forge-report.ts` | Funding and approvals, health check and watch, forged-report demo |
| `bots/test/*.test.ts` | Tests of `lib/` and `replay/` |
| `docs/runbook.md` | Exact commands and expected logs |

---

### Task 1: Root Bun workspace and .gitignore

**Delegable:** yes
**Depends on:** nothing

**Files:**
- Create: `package.json`, `bunfig.toml`
- Modify: `.gitignore`

- [x] **Step 1: Install Bun if missing**

Run: `bun --version 2>/dev/null || { curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.9" && ln -sf "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun && ln -sf "$HOME/.bun/bin/bun" /opt/homebrew/bin/bunx; }; bun --version`
Expected: `1.3.9` (plan 02 Task 1 installs it the same way; `1.4.2` also passes this plan's tests). The installer only edits `~/.zshrc`, which Claude Code's Bash tool does not re-read, so the binary is linked into `/opt/homebrew/bin` (on PATH, writable without sudo); never rely on `export PATH=...`, which does not survive to the next command.

- [x] **Step 2: Create the root `package.json`**

Only `shared` for now: Bun refuses to install when a listed workspace folder does not exist (`error: Workspace not found "bots"`). Task 7 adds `bots`; `app` stays outside the workspace (plan 05 is a standalone npm project).

```json
{
  "name": "clim",
  "private": true,
  "license": "MIT",
  "workspaces": ["shared"],
  "scripts": {
    "test": "bun run --filter '*' test",
    "typecheck": "bun run --filter '*' typecheck"
  }
}
```

- [x] **Step 3: Create `bunfig.toml`**

```toml
[install]
linker = "hoisted"
```

- [x] **Step 4: Fix `.gitignore`**

In the `# Node / Next / Bun` block replace the line `out/` with `app/out/`, and insert this block right before the `# OS` line (plan 06 Task 1 expects exactly these lines and adds its own `docs/submission/out/`; if it ran first, only check that they exist):

```
node_modules/
.next/
app/out/
dist/
*.tsbuildinfo
```

```
# Bots: run logs stay local, except the CRE run log and the security demo records (submission evidence)
bots/out/*
!bots/out/cre-runs.jsonl
!bots/out/security-demos.jsonl

```

- [x] **Step 5: Verify the ignore rules**

Run:
```bash
mkdir -p lab/out bots/out/tmp && touch lab/out/.probe bots/out/cre-runs.jsonl bots/out/arb-live.jsonl bots/out/tmp/x.log
git status --porcelain --untracked-files=all lab/out bots/out
rm -rf lab/out/.probe bots/out/cre-runs.jsonl bots/out/arb-live.jsonl bots/out/tmp
```
Expected exactly (`cre-runs.jsonl` is tracked on purpose, `arb-live.jsonl` and `tmp/` are ignored):
```
?? bots/out/cre-runs.jsonl
?? lab/out/.probe
```

- [x] **Step 6: Log the decision**

Append under `## Build notes` at the end of today's session log (`docs/sessions/2026-10-06.md` on day 1, `docs/sessions/2026-10-07.md` on day 2; add the heading if it is missing):

```markdown
- (ops) Tooling: Bun workspaces at the root (`shared`, `bots`; `app` stays a standalone npm project, plan 05) with the hoisted linker. The bots run on Bun because the CRE TypeScript SDK already requires Bun >= 1.2.21. `.gitignore`: `out/` narrowed to `app/out/` (it also ignored `lab/out/`, which the app reads); `bots/out/*` ignored except `cre-runs.jsonl` and `security-demos.jsonl` (submission evidence).
```

- [x] **Step 7: Commit**

```bash
git add package.json bunfig.toml .gitignore docs/sessions/
git commit -m "build: add root Bun workspace and track lab/out"
```

---

### Task 2: `shared` package and unit conversions (fee formula mirror)

**Delegable:** yes
**Depends on:** Task 1

**Files:**
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/units.ts`
- Test: `shared/test/units.test.ts`

- [x] **Step 1: Create the package files**

`shared/package.json`:
```json
{
  "name": "@clim/shared",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./units": "./src/units.ts",
    "./price": "./src/price.ts",
    "./report": "./src/report.ts",
    "./abis": "./src/abis.ts",
    "./config": "./src/config.ts",
    "./deployments/sepolia.json": "./deployments/sepolia.json",
    "./params.json": "./params.json"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit -p ."
  },
  "peerDependencies": {
    "viem": "^2.57.3"
  },
  "devDependencies": {
    "@types/bun": "^1.4.2",
    "typescript": "5.9.3",
    "viem": "^2.57.3"
  }
}
```

`shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src", "test", "scripts"]
}
```

Run: `bun install`
Expected: ends with `N packages installed` (no error).

- [x] **Step 2: Write the failing test**

`shared/test/units.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
  annualSigmaToSigmaE9,
  bpToPips,
  etaE4FromPStar,
  FeeMode,
  feePips,
  pipsToBp,
  pTradeFromEtaE4,
  quoteFeeMirror,
  sigmaE9ToAnnual,
  sqrtHalfDtE6FromBlockTime,
  type HookParams,
} from "../src/units";

describe("sigma conversions", () => {
  test("annual sigma -> sigmaE9 (per sqrt second * 1e9, rounded)", () => {
    expect(annualSigmaToSigmaE9(0.1)).toBe(17_807);
    expect(annualSigmaToSigmaE9(0.25)).toBe(44_518);
    expect(annualSigmaToSigmaE9(0.48)).toBe(85_475);
    expect(annualSigmaToSigmaE9(1.0)).toBe(178_072);
    expect(annualSigmaToSigmaE9(2.25)).toBe(400_663);
  });
  test("sigmaE9 -> annual sigma", () => {
    expect(sigmaE9ToAnnual(85_475)).toBeCloseTo(0.48, 5);
    expect(sigmaE9ToAnnual(17_807)).toBeCloseTo(0.1, 5);
  });
  test("rejects negative or non-finite sigma", () => {
    expect(() => annualSigmaToSigmaE9(-0.1)).toThrow(RangeError);
    expect(() => annualSigmaToSigmaE9(Number.NaN)).toThrow(RangeError);
  });
});

describe("fee units", () => {
  test("pips <-> bp (1 bp = 100 pips)", () => {
    expect(pipsToBp(1_922)).toBe(19.22);
    expect(bpToPips(5)).toBe(500);
    expect(bpToPips(19.22)).toBe(1_922);
  });
  test("eta from P* uses the fixed-block constant 0.824", () => {
    expect(etaE4FromPStar(0.2)).toBe(41_760);
    expect(etaE4FromPStar(0.3)).toBe(25_093);
    expect(pTradeFromEtaE4(41_760)).toBeCloseTo(0.2, 9);
    expect(() => etaE4FromPStar(0)).toThrow(RangeError);
    expect(() => etaE4FromPStar(1)).toThrow(RangeError);
  });
  test("sqrt(blockTime/2) * 1e6 for Sepolia 12 s blocks", () => {
    expect(sqrtHalfDtE6FromBlockTime(12)).toBe(2_449_490);
  });
});

describe("feePips mirrors ClimFeeMath.feePips (ceil, then clamp)", () => {
  const SQ = 2_449_490;
  const K1 = 10_000;
  const cases: Array<[string, number, number, number, number, number, number, number]> = [
    // label, sigmaE9, etaE4, sqrtHalfDtE6, kE4, min, max, expected
    ["48%/yr, P*=10% (old calibration), unclamped", 85_475, 91_761, SQ, K1, 0, 1_000_000, 1_922],
    ["25%/yr, P*=10% (old calibration), unclamped", 44_518, 91_761, SQ, K1, 0, 1_000_000, 1_001],
    ["100%/yr, P*=20%", 178_072, 41_760, SQ, K1, 500, 15_000, 1_822],
    ["225%/yr, P*=20%", 400_663, 41_760, SQ, K1, 500, 15_000, 4_099],
    ["100%/yr, P*=30%", 178_072, 25_093, SQ, K1, 500, 15_000, 1_095],
    ["225%/yr, P*=30%", 400_663, 25_093, SQ, K1, 500, 15_000, 2_463],
    ["46%/yr, P*=30% (just above the 5 bp floor)", 81_913, 25_093, SQ, K1, 500, 15_000, 504],
    ["27%/yr, P*=20% (raw 492 -> floor 500)", 48_080, 41_760, SQ, K1, 500, 15_000, 500],
    ["sigma 0 -> floor", 0, 41_760, SQ, K1, 500, 15_000, 500],
    ["SIGMA_MAX (1000%/yr), P*=20% (raw 18216 -> cap)", 1_780_730, 41_760, SQ, K1, 500, 15_000, 15_000],
    ["k = 2.0 doubles the raw fee", 178_072, 25_093, SQ, 20_000, 500, 15_000, 2_190],
    ["exact division: no rounding up", 10_000, 10_000, 1_000_000, 10_000, 0, 1_000_000, 10],
    ["any remainder rounds up", 10_001, 10_000, 1_000_000, 10_000, 0, 1_000_000, 11],
  ];
  for (const [label, s, e, sq, k, min, max, expected] of cases) {
    test(label, () => {
      expect(feePips(s, e, sq, k, min, max)).toBe(expected);
    });
  }
  test("rejects non-integers, negatives and min > max", () => {
    expect(() => feePips(1.5, 41_760, SQ, K1, 500, 15_000)).toThrow(RangeError);
    expect(() => feePips(-1, 41_760, SQ, K1, 500, 15_000)).toThrow(RangeError);
    expect(() => feePips(1, 41_760, SQ, K1, 15_000, 500)).toThrow(RangeError);
  });
});

describe("quoteFeeMirror mirrors ClimHook.quoteFee", () => {
  const p: HookParams = {
    etaE4: 41_760,
    sqrtHalfDtE6: 2_449_490,
    feeMinPips: 500,
    feeMaxPips: 15_000,
    feeSafePips: 3_000,
    tauKillSec: 180,
  };
  const t = 1_791_280_000;
  test("never reported -> blind at feeSafe", () => {
    expect(quoteFeeMirror({ tObs: 0, sigmaE9: 0, kE4: 0, flags: 0, seq: 0 }, p, t)).toEqual({ fee: 3_000, mode: FeeMode.Blind });
  });
  test("fresh report -> normal fee", () => {
    expect(quoteFeeMirror({ tObs: t - 30, sigmaE9: 178_072, kE4: 10_000, flags: 0, seq: 7 }, p, t)).toEqual({ fee: 1_822, mode: FeeMode.Normal });
  });
  test("tObs slightly in the future (allowed skew) -> normal, no underflow", () => {
    expect(quoteFeeMirror({ tObs: t + 20, sigmaE9: 178_072, kE4: 10_000, flags: 0, seq: 7 }, p, t).mode).toBe(FeeMode.Normal);
  });
  test("degraded flag -> max(fee, feeSafe)", () => {
    expect(quoteFeeMirror({ tObs: t, sigmaE9: 178_072, kE4: 10_000, flags: 1, seq: 7 }, p, t)).toEqual({ fee: 3_000, mode: FeeMode.Degraded });
    expect(quoteFeeMirror({ tObs: t, sigmaE9: 400_663, kE4: 10_000, flags: 1, seq: 7 }, p, t)).toEqual({ fee: 4_099, mode: FeeMode.Degraded });
  });
  test("replay flag alone does not change the fee", () => {
    expect(quoteFeeMirror({ tObs: t, sigmaE9: 178_072, kE4: 10_000, flags: 2, seq: 7 }, p, t)).toEqual({ fee: 1_822, mode: FeeMode.Normal });
  });
  test("stale desk: strictly more than tauKill seconds -> blind", () => {
    expect(quoteFeeMirror({ tObs: t - 180, sigmaE9: 178_072, kE4: 10_000, flags: 0, seq: 7 }, p, t).mode).toBe(FeeMode.Normal);
    expect(quoteFeeMirror({ tObs: t - 181, sigmaE9: 178_072, kE4: 10_000, flags: 0, seq: 7 }, p, t)).toEqual({ fee: 3_000, mode: FeeMode.Blind });
    expect(quoteFeeMirror({ tObs: t - 181, sigmaE9: 400_663, kE4: 10_000, flags: 1, seq: 7 }, p, t)).toEqual({ fee: 4_099, mode: FeeMode.Blind });
  });
});
```

- [x] **Step 3: Run it, expected FAIL**

Run: `cd shared && bun test test/units.test.ts`
Expected: `error: Cannot find module '../src/units' from '.../shared/test/units.test.ts'` and ` 0 pass`, ` 1 fail`.

- [x] **Step 4: Minimal implementation**

`shared/src/units.ts`:
```ts
// Unit conventions shared by contracts (ClimFeeMath / ClimHook), the CRE risk desk, the bots and the app.
// Runtime-agnostic: no Bun or Node APIs here (the CRE workflow may import this file; plan 05 ports it to the app).

export const SECONDS_PER_YEAR = 31_536_000;
export const PIPS_PER_BP = 100;
/** Uniswap v4 LP fee unit: 1_000_000 pips = 100 %. */
export const PIPS_DENOMINATOR = 1_000_000;
/** |zeta(1/2)| / sqrt(pi), rounded as in the design: P_trade = 1 / (eta + 0.824) for fixed-interval blocks. */
export const NT_FIXED_BLOCK_CONST = 0.824;
/** sigmaE9 (1e9) * etaE4 (1e4) * sqrtHalfDtE6 (1e6) * kE4 (1e4) = 1e23 scale; pips are 1e-6, so divide by 1e17. */
export const FEE_SCALE = 10n ** 17n;

export const FLAG_DEGRADED = 1;
export const FLAG_REPLAY = 2;

export const FeeMode = { Normal: 0, Degraded: 1, Blind: 2 } as const;
export type FeeModeValue = (typeof FeeMode)[keyof typeof FeeMode];

/** On-chain RiskDesk.state() as read by viem (all fields fit in a JS number). */
export type DeskState = { tObs: number; sigmaE9: number; kE4: number; flags: number; seq: number };

/** Immutable ClimHook constructor parameters (the subset of shared/params.json the hook uses). */
export type HookParams = {
  etaE4: number;
  sqrtHalfDtE6: number;
  feeMinPips: number;
  feeMaxPips: number;
  feeSafePips: number;
  tauKillSec: number;
};

function assertUint(name: string, v: number, max: number): void {
  if (!Number.isInteger(v) || v < 0 || v > max) {
    throw new RangeError(`${name} must be an integer in [0, ${max}], got ${v}`);
  }
}

/** Annual volatility (0.48 = 48 %/yr) -> sigmaE9 = per-sqrt-second volatility * 1e9, rounded to nearest. */
export function annualSigmaToSigmaE9(sigmaAnnual: number): number {
  if (!Number.isFinite(sigmaAnnual) || sigmaAnnual < 0) {
    throw new RangeError(`sigmaAnnual must be finite and >= 0, got ${sigmaAnnual}`);
  }
  return Math.round((sigmaAnnual / Math.sqrt(SECONDS_PER_YEAR)) * 1e9);
}

/** sigmaE9 -> annual volatility (fraction, 0.48 = 48 %/yr). */
export function sigmaE9ToAnnual(sigmaE9: number): number {
  return (sigmaE9 / 1e9) * Math.sqrt(SECONDS_PER_YEAR);
}

export function pipsToBp(pips: number): number {
  return pips / PIPS_PER_BP;
}

export function bpToPips(bp: number): number {
  return Math.round(bp * PIPS_PER_BP);
}

/** Fee in pips -> fraction of the input amount (500 pips -> 0.0005). */
export function pipsToFraction(pips: number): number {
  return pips / PIPS_DENOMINATOR;
}

/** eta = 1/P* - 0.824 (Nezlobin-Tassy 2025 fixed-block correction of MMR 2023). */
export function etaFromPStar(pStar: number): number {
  if (!(pStar > 0 && pStar < 1)) throw new RangeError(`pStar must be in (0, 1), got ${pStar}`);
  return 1 / pStar - NT_FIXED_BLOCK_CONST;
}

export function etaE4FromPStar(pStar: number): number {
  return Math.round(etaFromPStar(pStar) * 1e4);
}

/** Predicted share of arbitraged blocks for a given etaE4 (above the floor, below the cap). */
export function pTradeFromEtaE4(etaE4: number): number {
  return 1 / (etaE4 / 1e4 + NT_FIXED_BLOCK_CONST);
}

export function sqrtHalfDtE6FromBlockTime(blockTimeSec: number): number {
  return Math.round(Math.sqrt(blockTimeSec / 2) * 1e6);
}

/**
 * Mirror of ClimFeeMath.feePips:
 * clamp(ceil(sigmaE9 * etaE4 * sqrtHalfDtE6 * kE4 / 1e17), feeMinPips, feeMaxPips).
 * Same integer semantics as Solidity (bigint, round up once, then clamp).
 */
export function feePips(
  sigmaE9: number,
  etaE4: number,
  sqrtHalfDtE6: number,
  kE4: number,
  feeMinPips: number,
  feeMaxPips: number,
): number {
  assertUint("sigmaE9", sigmaE9, 0xffffffff);
  assertUint("etaE4", etaE4, 0xffffffff);
  assertUint("sqrtHalfDtE6", sqrtHalfDtE6, 0xffffffff);
  assertUint("kE4", kE4, 0xffff);
  assertUint("feeMinPips", feeMinPips, PIPS_DENOMINATOR);
  assertUint("feeMaxPips", feeMaxPips, PIPS_DENOMINATOR);
  if (feeMinPips > feeMaxPips) throw new RangeError(`feeMinPips ${feeMinPips} > feeMaxPips ${feeMaxPips}`);
  const num = BigInt(sigmaE9) * BigInt(etaE4) * BigInt(sqrtHalfDtE6) * BigInt(kE4);
  const raw = (num + FEE_SCALE - 1n) / FEE_SCALE;
  if (raw < BigInt(feeMinPips)) return feeMinPips;
  if (raw > BigInt(feeMaxPips)) return feeMaxPips;
  return Number(raw);
}

/**
 * Mirror of ClimHook.quoteFee() at time nowSec (block.timestamp), spec section 3.6:
 * age = max(nowSec - tObs, 0); blind (mode 2) if seq == 0 or age > tauKillSec; else degraded (mode 1) if flag bit 0;
 * blind and degraded both quote max(fee, feeSafePips). Blind wins over degraded.
 */
export function quoteFeeMirror(state: DeskState, p: HookParams, nowSec: number): { fee: number; mode: FeeModeValue } {
  const base = feePips(state.sigmaE9, p.etaE4, p.sqrtHalfDtE6, state.kE4, p.feeMinPips, p.feeMaxPips);
  const age = nowSec > state.tObs ? nowSec - state.tObs : 0;
  if (state.seq === 0 || age > p.tauKillSec) {
    return { fee: Math.max(base, p.feeSafePips), mode: FeeMode.Blind };
  }
  if ((state.flags & FLAG_DEGRADED) !== 0) {
    return { fee: Math.max(base, p.feeSafePips), mode: FeeMode.Degraded };
  }
  return { fee: base, mode: FeeMode.Normal };
}
```

- [x] **Step 5: Run, expected PASS**

Run: `cd shared && bun test test/units.test.ts && bun run typecheck`
Expected: ` 26 pass`, ` 0 fail`, then `$ tsc --noEmit -p .` with no error.

- [x] **Step 6: Commit**

```bash
git add shared/package.json shared/tsconfig.json shared/src/units.ts shared/test/units.test.ts bun.lock
git commit -m "feat(shared): unit conversions and ClimFeeMath mirror"
```

---

### Task 3: Price math (sqrtPriceX96 <-> ETH/USD, both token orders)

**Delegable:** yes
**Depends on:** Task 2

**Files:**
- Create: `shared/src/price.ts`
- Test: `shared/test/price.test.ts`

- [x] **Step 1: Write the failing test**

The exact integers were computed with 60-digit decimals (`python3`, `decimal`): `floor(sqrt(price) * 2^96)`.

`shared/test/price.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
  clampSqrtPriceLimit,
  ethUsdFromSqrtPriceX96,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  Q96,
  sqrtPriceX96FromEthUsd,
  type PairOrientation,
} from "../src/price";

const ETH0: PairOrientation = { token0IsEth: true, decimals0: 18, decimals1: 18 };
const USD0: PairOrientation = { token0IsEth: false, decimals0: 18, decimals1: 18 };
// Real-world shape (USDC 6 decimals = token0, WETH 18 decimals = token1), to exercise the decimals path.
const USDC6_WETH18: PairOrientation = { token0IsEth: false, decimals0: 6, decimals1: 18 };

function relErr(a: bigint, b: bigint): number {
  const d = a > b ? a - b : b - a;
  return Number(d) / Number(b);
}

describe("sqrtPriceX96 <-> ETH price in USD", () => {
  test("2^96 is a raw price of 1", () => {
    expect(ethUsdFromSqrtPriceX96(Q96, ETH0)).toBe(1);
    expect(ethUsdFromSqrtPriceX96(Q96, USD0)).toBe(1);
  });
  test("token0 = ETH, 18/18, ETH = 4000", () => {
    const exact = 5010828967500958623728276031392n; // floor(sqrt(4000) * 2^96), computed with 60-digit decimals
    expect(relErr(sqrtPriceX96FromEthUsd(4000, ETH0), exact)).toBeLessThan(1e-12);
    expect(ethUsdFromSqrtPriceX96(exact, ETH0)).toBeCloseTo(4000, 8);
  });
  test("token0 = USD, 18/18, ETH = 2713.8", () => {
    const exact = 1520864997137815267081534579n; // floor(sqrt(1/2713.8) * 2^96)
    expect(relErr(sqrtPriceX96FromEthUsd(2713.8, USD0), exact)).toBeLessThan(1e-12);
    expect(ethUsdFromSqrtPriceX96(exact, USD0)).toBeCloseTo(2713.8, 8);
  });
  test("token0 = USDC (6 dec), token1 = WETH (18 dec), ETH = 2000", () => {
    const exact = 1771595571142957102961017161607260n; // floor(sqrt(1e12 / 2000) * 2^96)
    expect(relErr(sqrtPriceX96FromEthUsd(2000, USDC6_WETH18), exact)).toBeLessThan(1e-12);
    expect(ethUsdFromSqrtPriceX96(exact, USDC6_WETH18)).toBeCloseTo(2000, 8);
  });
  test("round trip in both orientations", () => {
    for (const o of [ETH0, USD0, USDC6_WETH18]) {
      for (const px of [1.5, 2713.8, 99_999.25]) {
        expect(ethUsdFromSqrtPriceX96(sqrtPriceX96FromEthUsd(px, o), o) / px).toBeCloseTo(1, 12);
      }
    }
  });
  test("a higher ETH price moves sqrtPrice up when token0 is ETH, down when token0 is USD", () => {
    expect(sqrtPriceX96FromEthUsd(3000, ETH0) > sqrtPriceX96FromEthUsd(2000, ETH0)).toBe(true);
    expect(sqrtPriceX96FromEthUsd(3000, USD0) < sqrtPriceX96FromEthUsd(2000, USD0)).toBe(true);
  });
  test("rejects non-positive prices", () => {
    expect(() => sqrtPriceX96FromEthUsd(0, ETH0)).toThrow(RangeError);
    expect(() => ethUsdFromSqrtPriceX96(0n, ETH0)).toThrow(RangeError);
  });
});

describe("clampSqrtPriceLimit keeps limits strictly inside the v4 bounds", () => {
  test("clamps both ends", () => {
    expect(clampSqrtPriceLimit(1n)).toBe(MIN_SQRT_PRICE + 1n);
    expect(clampSqrtPriceLimit(MAX_SQRT_PRICE)).toBe(MAX_SQRT_PRICE - 1n);
    expect(clampSqrtPriceLimit(Q96)).toBe(Q96);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd shared && bun test test/price.test.ts`
Expected: `error: Cannot find module '../src/price'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`shared/src/price.ts`:
```ts
// Uniswap v4 price math: sqrtPriceX96 <-> ETH price in USD, for either token order and any decimals.
// Raw pool price = (sqrtPriceX96 / 2^96)^2 = token1 base units per token0 base unit.
// Runtime-agnostic (imported by the bots; plan 05 ports it to the app).

export const Q96 = 2n ** 96n;
/** TickMath.MIN_SQRT_PRICE / MAX_SQRT_PRICE (v4-core src/libraries/TickMath.sol). */
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

const TWO_POW_96 = 2 ** 96;

/** How a pool's token0/token1 map to ETH/USD. token0IsEth is fixed by address sort order at deployment. */
export type PairOrientation = { token0IsEth: boolean; decimals0: number; decimals1: number };

/** ETH price in USD (human units) from a pool sqrtPriceX96. */
export function ethUsdFromSqrtPriceX96(sqrtPriceX96: bigint, o: PairOrientation): number {
  if (sqrtPriceX96 <= 0n) throw new RangeError("sqrtPriceX96 must be > 0");
  const r = Number(sqrtPriceX96) / TWO_POW_96;
  // human price of token0 in token1 units
  const p01 = r * r * 10 ** (o.decimals0 - o.decimals1);
  return o.token0IsEth ? p01 : 1 / p01;
}

/** sqrtPriceX96 (floored) for a target ETH price in USD (human units). */
export function sqrtPriceX96FromEthUsd(ethUsd: number, o: PairOrientation): bigint {
  if (!Number.isFinite(ethUsd) || ethUsd <= 0) throw new RangeError(`ethUsd must be > 0, got ${ethUsd}`);
  const p01 = o.token0IsEth ? ethUsd : 1 / ethUsd;
  const raw = p01 * 10 ** (o.decimals1 - o.decimals0);
  return BigInt(Math.floor(Math.sqrt(raw) * TWO_POW_96));
}

/** v4 rejects limits outside (MIN_SQRT_PRICE, MAX_SQRT_PRICE); keep any computed limit strictly inside. */
export function clampSqrtPriceLimit(x: bigint): bigint {
  if (x <= MIN_SQRT_PRICE) return MIN_SQRT_PRICE + 1n;
  if (x >= MAX_SQRT_PRICE) return MAX_SQRT_PRICE - 1n;
  return x;
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd shared && bun test test/price.test.ts && bun run typecheck`
Expected: ` 8 pass`, ` 0 fail`; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add shared/src/price.ts shared/test/price.test.ts
git commit -m "feat(shared): sqrtPriceX96 and ETH/USD price math"
```

---

### Task 4: CRE report encoding and mock forwarder raw report

**Delegable:** yes
**Depends on:** Task 2

**Files:**
- Create: `shared/src/report.ts`
- Test: `shared/test/report.test.ts`

- [x] **Step 1: Write the failing test**

The reference hex is Solidity's encoding: `cast abi-encode "f(uint40,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)" -- 1791280000 85475 85000 4800 -79072 3 4 10000 0`.

`shared/test/report.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { buildMockRawReport, decodeRiskReport, encodeRiskReport, MOCK_FORWARDER_METADATA_LENGTH, type RiskReport } from "../src/report";

const SAMPLE: RiskReport = {
  tObs: 1_791_280_000,
  sigmaE9: 85_475,
  rv15E9: 85_000,
  dvolE2: 4_800,
  refTick: -79_072,
  dispBp: 3,
  nSources: 4,
  kE4: 10_000,
  zone: 0,
};

// cast abi-encode "f(uint40,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)" -- 1791280000 85475 85000 4800 -79072 3 4 10000 0
const SAMPLE_HEX = (
  "0x000000000000000000000000000000000000000000000000000000006ac4c380" +
  "0000000000000000000000000000000000000000000000000000000000014de3" +
  "0000000000000000000000000000000000000000000000000000000000014c08" +
  "00000000000000000000000000000000000000000000000000000000000012c0" +
  "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffecb20" +
  "0000000000000000000000000000000000000000000000000000000000000003" +
  "0000000000000000000000000000000000000000000000000000000000000004" +
  "0000000000000000000000000000000000000000000000000000000000002710" +
  "0000000000000000000000000000000000000000000000000000000000000000"
) as Hex;

describe("CRE report ABI (abi.encode of 9 static fields)", () => {
  test("encodes exactly like Solidity abi.encode / cast abi-encode", () => {
    expect(encodeRiskReport(SAMPLE)).toBe(SAMPLE_HEX);
  });
  test("decodes back to the same fields (negative refTick included)", () => {
    expect(decodeRiskReport(SAMPLE_HEX)).toEqual(SAMPLE);
  });
});

describe("MockKeystoneForwarder raw report", () => {
  test("is 109 bytes of metadata followed by the abi-encoded report", () => {
    const raw = buildMockRawReport(SAMPLE, { executionId: `0x${"ab".repeat(32)}`, timestamp: 1_791_280_000 });
    const bytes = (raw.length - 2) / 2;
    expect(MOCK_FORWARDER_METADATA_LENGTH).toBe(109);
    expect(bytes).toBe(109 + 9 * 32);
    expect(raw.slice(0, 4)).toBe("0x01"); // version byte
    expect(raw.slice(4, 4 + 64)).toBe("ab".repeat(32)); // workflow_execution_id
    expect(`0x${raw.slice(2 + 109 * 2)}`).toBe(SAMPLE_HEX); // payload after metadata
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd shared && bun test test/report.test.ts`
Expected: `error: Cannot find module '../src/report'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`shared/src/report.ts`:
```ts
// The CRE report contract between cre/risk-desk (encoder) and contracts/src/RiskDesk.sol (decoder).
import { concatHex, decodeAbiParameters, encodeAbiParameters, numberToHex, padHex, type Hex } from "viem";

export const RISK_REPORT_PARAMS = [
  { name: "tObs", type: "uint40" },
  { name: "sigmaE9", type: "uint32" },
  { name: "rv15E9", type: "uint32" },
  { name: "dvolE2", type: "uint16" },
  { name: "refTick", type: "int24" },
  { name: "dispBp", type: "uint16" },
  { name: "nSources", type: "uint8" },
  { name: "kE4", type: "uint16" },
  { name: "zone", type: "uint8" },
] as const;

export type RiskReport = {
  tObs: number;
  sigmaE9: number;
  rv15E9: number;
  dvolE2: number;
  refTick: number;
  dispBp: number;
  nSources: number;
  kE4: number;
  zone: number;
};

export function encodeRiskReport(r: RiskReport): Hex {
  return encodeAbiParameters(RISK_REPORT_PARAMS, [
    r.tObs,
    r.sigmaE9,
    r.rv15E9,
    r.dvolE2,
    r.refTick,
    r.dispBp,
    r.nSources,
    r.kE4,
    r.zone,
  ]);
}

export function decodeRiskReport(data: Hex): RiskReport {
  const [tObs, sigmaE9, rv15E9, dvolE2, refTick, dispBp, nSources, kE4, zone] = decodeAbiParameters(RISK_REPORT_PARAMS, data);
  return { tObs, sigmaE9, rv15E9, dvolE2, refTick, dispBp, nSources, kE4, zone };
}

/** MockKeystoneForwarder.METADATA_LENGTH: version(1) execId(32) timestamp(4) donId(4) donConfigVersion(4) workflowCid(32) workflowName(10) workflowOwner(20) reportId(2). */
export const MOCK_FORWARDER_METADATA_LENGTH = 109;

/**
 * rawReport accepted by MockKeystoneForwarder.report(receiver, rawReport, reportContext, signatures)
 * on Sepolia (0x15fC6ae953E024d975e77382eEeC56A9101f9F88). The mock skips every signature check, so
 * anyone can call it: this is how the forged-report security demo reaches RiskDesk.onReport.
 */
export function buildMockRawReport(r: RiskReport, opts: { executionId: Hex; timestamp: number }): Hex {
  return concatHex([
    "0x01",
    padHex(opts.executionId, { size: 32 }),
    numberToHex(opts.timestamp, { size: 4 }),
    numberToHex(0, { size: 4 }), // donId
    numberToHex(0, { size: 4 }), // donConfigVersion
    padHex("0x", { size: 32 }), // workflowCid
    padHex("0x", { size: 10 }), // workflowName
    padHex("0x", { size: 20 }), // workflowOwner
    "0x0001", // reportId
    encodeRiskReport(r),
  ]);
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd shared && bun test test/report.test.ts && bun run typecheck`
Expected: ` 3 pass`, ` 0 fail`; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add shared/src/report.ts shared/test/report.test.ts
git commit -m "feat(shared): CRE risk report encoding and mock forwarder raw report"
```

---

### Task 5: Typed ABIs and their drift test

**Delegable:** yes
**Depends on:** Task 2

**Files:**
- Create: `shared/src/abis.ts`
- Test: `shared/test/abis.test.ts`

Built with a `shared/scripts/export-abis.ts` (commit `8dfd1cf`) that copied three of the ABIs; it was removed on 2026-10-07 (commit `5ed36a8`) because plan 01 Task 14's `contracts/script/export-abis.sh` writes the same files and five more, and is the only exporter now.

- [x] **Step 1: Write the failing test**

The selector checks pin the fragments to the bytecode deployed on Sepolia; the drift checks run as soon as `shared/abis/*.json` exist (they are skipped before plan 01 compiles the contracts).

`shared/test/abis.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toFunctionSelector, type AbiParameter } from "viem";
import { climHookAbi, mockForwarderAbi, poolSwapTestAbi, riskDeskAbi, stateViewAbi, testTokenMintAbi } from "../src/abis";

describe("external ABI fragments match the selectors deployed on Sepolia", () => {
  test("PoolSwapTest.swap = 0x2229d0b4 (present in 0x9B6b...6eEe bytecode)", () => {
    const swap = poolSwapTestAbi.find((x) => x.type === "function" && x.name === "swap");
    expect(swap && toFunctionSelector(swap)).toBe("0x2229d0b4");
  });
  test("StateView.getSlot0 = 0xc815641c (present in 0xE1Dd...7E4C bytecode)", () => {
    expect(toFunctionSelector(stateViewAbi[0])).toBe("0xc815641c");
  });
  test("MockKeystoneForwarder.report(address,bytes,bytes,bytes[])", () => {
    expect(toFunctionSelector(mockForwarderAbi[0])).toBe(toFunctionSelector("function report(address,bytes,bytes,bytes[])"));
  });
});

// Canonical signature of an ABI item, including outputs and indexed flags.
type Item = { type: string; name?: string; inputs?: readonly AbiParameter[]; outputs?: readonly AbiParameter[] };
function typeOf(p: AbiParameter): string {
  if (p.type.startsWith("tuple") && "components" in p && p.components) {
    return `(${p.components.map(typeOf).join(",")})${p.type.slice(5)}`;
  }
  return p.type;
}
function canonical(item: Item): string {
  const ins = (item.inputs ?? []).map((p) => `${typeOf(p)}${"indexed" in p && p.indexed ? " indexed" : ""}`);
  const outs = (item.outputs ?? []).map(typeOf);
  return `${item.type} ${item.name}(${ins.join(",")}) -> (${outs.join(",")})`;
}

const ABI_DIR = join(import.meta.dir, "..", "abis");
const OURS: Array<[string, readonly Item[]]> = [
  ["RiskDesk", riskDeskAbi],
  ["ClimHook", climHookAbi],
  ["TestToken", testTokenMintAbi],
];

describe("hand-written clim fragments match the compiled contracts (shared/abis/*.json)", () => {
  for (const [name, fragments] of OURS) {
    const file = join(ABI_DIR, `${name}.json`);
    test.skipIf(!existsSync(file))(`${name}: every fragment exists with the same signature`, () => {
      const compiled = JSON.parse(readFileSync(file, "utf8")) as Item[];
      const compiledSigs = new Set(compiled.map(canonical));
      for (const f of fragments) {
        expect(compiledSigs.has(canonical(f))).toBe(true);
      }
    });
  }
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd shared && bun test test/abis.test.ts`
Expected: `error: Cannot find module '../src/abis'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`shared/src/abis.ts`:
```ts
// Typed ABI fragments (`as const`, so viem infers argument and return types).
// External contracts: copied from Uniswap v4-core / v4-periphery and Chainlink MockKeystoneForwarder sources.
// clim contracts: the canonical interfaces; test/abis.test.ts checks them against shared/abis/*.json
// (exported from contracts/out by contracts/script/export-abis.sh) as soon as those files exist.
import { erc20Abi } from "viem";

export const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

/** v4-periphery src/lens/StateView.sol */
export const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

/** v4-core src/test/PoolSwapTest.sol: swap(PoolKey, SwapParams, TestSettings, bytes) returns (BalanceDelta = int256). Selector 0x2229d0b4. */
export const poolSwapTestAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      { name: "key", type: "tuple", components: POOL_KEY_COMPONENTS },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "testSettings",
        type: "tuple",
        components: [
          { name: "takeClaims", type: "bool" },
          { name: "settleUsingBurn", type: "bool" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
  // Errors that bubble up from PoolManager / Pool.swap, so viem can name them in revert messages.
  {
    type: "error",
    name: "PriceLimitAlreadyExceeded",
    inputs: [
      { name: "sqrtPriceCurrentX96", type: "uint160" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
  },
  { type: "error", name: "PriceLimitOutOfBounds", inputs: [{ name: "sqrtPriceLimitX96", type: "uint160" }] },
  { type: "error", name: "SwapAmountCannotBeZero", inputs: [] },
  { type: "error", name: "PoolNotInitialized", inputs: [] },
  { type: "error", name: "CurrencyNotSettled", inputs: [] },
  { type: "error", name: "LPFeeTooLarge", inputs: [{ name: "fee", type: "uint24" }] },
  { type: "error", name: "InvalidHookResponse", inputs: [] },
  { type: "error", name: "HookCallFailed", inputs: [] },
  { type: "error", name: "SafeCastOverflow", inputs: [] },
  {
    type: "error",
    name: "WrappedError",
    inputs: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "reason", type: "bytes" },
      { name: "details", type: "bytes" },
    ],
  },
] as const;

/** contracts/src/RiskDesk.sol (canonical interface). */
export const riskDeskAbi = [
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tObs", type: "uint40" },
      { name: "sigmaE9", type: "uint32" },
      { name: "kE4", type: "uint16" },
      { name: "flags", type: "uint8" },
      { name: "seq", type: "uint32" },
    ],
  },
  {
    type: "event",
    name: "RiskReported",
    inputs: [
      { name: "seq", type: "uint32", indexed: true },
      { name: "tObs", type: "uint40", indexed: false },
      { name: "sigmaApplied", type: "uint32", indexed: false },
      { name: "sigmaReported", type: "uint32", indexed: false },
      { name: "rv15E9", type: "uint32", indexed: false },
      { name: "dvolE2", type: "uint16", indexed: false },
      { name: "refTick", type: "int24", indexed: false },
      { name: "dispBp", type: "uint16", indexed: false },
      { name: "nSources", type: "uint8", indexed: false },
      { name: "kE4", type: "uint16", indexed: false },
      { name: "zone", type: "uint8", indexed: false },
    ],
  },
] as const;

/** contracts/src/ClimHook.sol (canonical interface): mode 0 normal, 1 degraded, 2 blind. */
export const climHookAbi = [
  {
    type: "function",
    name: "quoteFee",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fee", type: "uint24" },
      { name: "mode", type: "uint8" },
    ],
  },
] as const;

/** contracts/src/test-tokens/TestToken.sol: ERC-20 plus an owner-only mint (plan 01; its public faucet() is used by plan 05, not by the bots). */
export const testTokenMintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const testTokenAbi = [...erc20Abi, ...testTokenMintAbi] as const;

/** Chainlink MockKeystoneForwarder on Sepolia (verified source, Sourcify). */
export const mockForwarderAbi = [
  {
    type: "function",
    name: "report",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "rawReport", type: "bytes" },
      { name: "reportContext", type: "bytes" },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "ReportProcessed",
    inputs: [
      { name: "receiver", type: "address", indexed: true },
      { name: "workflowExecutionId", type: "bytes32", indexed: true },
      { name: "reportId", type: "bytes2", indexed: true },
      { name: "result", type: "bool", indexed: false },
    ],
  },
] as const;
```

- [x] **Step 4: Run, expected PASS**

Run: `cd shared && bun test test/abis.test.ts && bun run typecheck`
Expected: ` 3 pass`, ` 3 skip`, ` 0 fail` (the three skips are the drift checks, waiting for `shared/abis/*.json`); typecheck clean.

When plan 01 has compiled the contracts: `contracts/script/export-abis.sh` (plan 01 Task 14; it runs `forge build` itself) prints the eight `../shared/abis/<Name>.json` paths it wrote, and the same test then shows ` 6 pass`, ` 0 skip` (checked on 2026-10-07 with the committed ABIs). A failing drift check means the contract and the canonical interface disagree: fix the side that deviates from the canonical interface in the master plan, never silence the test.

- [x] **Step 5: Commit**

```bash
git add shared/src/abis.ts shared/test/abis.test.ts
git commit -m "feat(shared): typed ABI fragments"
```
(Committed as `8dfd1cf` "feat(shared): typed ABI fragments and ABI export script", with the export script removed since. The `poolManagerAbi` fragment it also held was removed on 2026-10-07, commit `4719557`: nothing imported it, and the app keeps its own copy.)

---

### Task 6: Deployments and params schemas with validated loaders

**Delegable:** yes
**Depends on:** Tasks 3, 5

**Files:**
- Create: `shared/deployments/sepolia.json`, `shared/params.json`, `shared/src/config.ts`, `shared/src/index.ts`
- Test: `shared/test/config.test.ts`

- [x] **Step 1: Create the data files**

`shared/deployments/sepolia.json` (Uniswap infrastructure and CRE forwarders verified on-chain; everything plan 01 deploys starts as `null`; if plan 01's `05_WriteDeployments` already wrote this file, keep it):
```json
{
  "chainId": 11155111,
  "deployBlock": null,
  "uniswap": {
    "poolManager": "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    "stateView": "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
    "poolSwapTest": "0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe",
    "poolModifyLiquidityTest": "0x0C478023803a644c94c4CE1C1e7b9A087e411B0A"
  },
  "cre": {
    "mockForwarder": "0x15fC6ae953E024d975e77382eEeC56A9101f9F88",
    "keystoneForwarder": "0xF8344CFd5c43616a4366C34E3EEE75af79a74482"
  },
  "tokens": { "tETH": null, "tUSD": null },
  "riskDesks": { "live": null, "replay": null, "don": null },
  "hooks": { "live": null, "replay": null },
  "pools": { "liveV": null, "liveS": null, "replayV": null, "replayS": null },
  "routers": { "arb": null }
}
```

`shared/params.json` (skip this file if the lab, plan 03, has already written it):
```json
{
  "pStar": 0.3,
  "etaE4": 25093,
  "sqrtHalfDtE6": 2449490,
  "feeMinPips": 500,
  "feeMaxPips": 15000,
  "feeSafePips": 3000,
  "tauKillSec": 180,
  "decidedBy": "PROVISIONAL (plan 04 bootstrap): replace with the lab decision (plan 03) before deploying the hook"
}
```

- [x] **Step 2: Write the failing test**

The pool id vector comes from `cast keccak $(cast abi-encode "f(address,address,uint24,int24,address)" 0x1111111111111111111111111111111111111111 0x2222222222222222222222222222222222222222 8388608 60 0x3333333333333333333333333333333333333333)`.

`shared/test/config.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { zeroAddress, type Address } from "viem";
import {
  arbRouter,
  isProvisional,
  loadDeployments,
  loadParams,
  orientationOf,
  parseDeployments,
  parseParams,
  poolIdFromKey,
  resolvePair,
  type PoolKey,
} from "../src/config";

const T_ETH: Address = "0x1111111111111111111111111111111111111111";
const T_USD: Address = "0x2222222222222222222222222222222222222222";
const HOOK: Address = "0x3333333333333333333333333333333333333333";
const DESK: Address = "0x4444444444444444444444444444444444444444";
const OTHER: Address = "0x5555555555555555555555555555555555555555";
const V_KEY: PoolKey = { currency0: T_ETH, currency1: T_USD, fee: 0x800000, tickSpacing: 60, hooks: HOOK };
const S_KEY: PoolKey = { currency0: T_ETH, currency1: T_USD, fee: 500, tickSpacing: 60, hooks: zeroAddress };

function fixture() {
  const base = loadDeployments();
  return {
    ...base,
    deployBlock: 9_000_000,
    deployer: OTHER, // extra key written by plan 01: ignored
    liquidity: { live: "520864665724216698412099", replay: null }, // extra key written by plan 01: ignored
    tokens: {
      tETH: { address: T_ETH, symbol: "tETH", decimals: 18 },
      tUSD: { address: T_USD, symbol: "tUSD", decimals: 18 },
    },
    riskDesks: { live: DESK, replay: null, don: null },
    hooks: { live: HOOK, replay: null },
    pools: {
      liveV: { key: V_KEY, poolId: poolIdFromKey(V_KEY), token0IsEth: true },
      liveS: { key: S_KEY, poolId: poolIdFromKey(S_KEY), token0IsEth: true },
      replayV: null,
      replayS: null,
    },
    routers: { arb: null },
  };
}

describe("poolIdFromKey = keccak256(abi.encode(PoolKey))", () => {
  test("matches cast keccak $(cast abi-encode ...)", () => {
    expect(poolIdFromKey(V_KEY)).toBe("0x4ac6664e02ef052115118798d9cd3d912b42c991fd3dd4c8b44533eb39d953b1");
  });
});

describe("shared/deployments/sepolia.json", () => {
  test("the committed file parses (Uniswap infra and CRE forwarders verified on-chain)", () => {
    const d = loadDeployments();
    expect(d.chainId).toBe(11155111);
    expect(d.uniswap.poolManager).toBe("0xE03A1074c86CFeDd5C142C4F04F1a1536e203543");
  });
  test("a fully deployed pair parses and resolves (plan 01 extra keys ignored)", () => {
    const d = parseDeployments(fixture());
    const pair = resolvePair(d, "live");
    expect(pair.hook).toBe(HOOK);
    expect(pair.desk).toBe(DESK);
    expect(pair.tETH).toEqual({ address: T_ETH, symbol: "tETH", decimals: 18 });
    expect(orientationOf(pair.V, d)).toEqual({ token0IsEth: true, decimals0: 18, decimals1: 18 });
  });
  test("resolvePair names the missing entry when the pair is not deployed", () => {
    expect(() => resolvePair(parseDeployments(fixture()), "replay")).toThrow(/replayV/);
  });
  test("the arbitrage router is routers.arb when deployed, else the shared PoolSwapTest", () => {
    const d = parseDeployments(fixture());
    expect(arbRouter(d)).toBe(d.uniswap.poolSwapTest);
    expect(arbRouter(parseDeployments({ ...fixture(), routers: { arb: OTHER } }))).toBe(OTHER);
    const { routers: _omit, ...withoutRouters } = fixture();
    expect(parseDeployments(withoutRouters).routers.arb).toBeNull();
  });
  test("accepts the DON desk", () => {
    expect(parseDeployments({ ...fixture(), riskDesks: { live: DESK, replay: null, don: OTHER } }).riskDesks.don).toBe(OTHER);
  });
  test("rejects a poolId that does not match its key", () => {
    const f = fixture();
    f.pools.liveS = { ...f.pools.liveS, poolId: f.pools.liveV.poolId };
    expect(() => parseDeployments(f)).toThrow(/poolId/);
  });
  test("rejects a wrong token0IsEth", () => {
    const f = fixture();
    f.pools.liveV = { ...f.pools.liveV, token0IsEth: false };
    expect(() => parseDeployments(f)).toThrow(/token0IsEth/);
  });
  test("rejects a pool that does not trade tETH/tUSD", () => {
    const f = fixture();
    const k = { ...S_KEY, currency1: OTHER };
    f.pools.liveS = { key: k, poolId: poolIdFromKey(k), token0IsEth: true };
    expect(() => parseDeployments(f)).toThrow(/tokens\.tETH and tokens\.tUSD/);
  });
  test("rejects a V pool without the dynamic fee flag or with another hook", () => {
    const f = fixture();
    const k = { ...V_KEY, fee: 3_000 };
    f.pools.liveV = { key: k, poolId: poolIdFromKey(k), token0IsEth: true };
    expect(() => parseDeployments(f)).toThrow(/dynamic/);
    const g = fixture();
    const k2 = { ...V_KEY, hooks: zeroAddress };
    g.pools.liveV = { key: k2, poolId: poolIdFromKey(k2), token0IsEth: true };
    expect(() => parseDeployments(g)).toThrow(/hooks/);
  });
  test("rejects unsorted currencies", () => {
    const f = fixture();
    const k = { ...S_KEY, currency0: T_USD, currency1: T_ETH };
    f.pools.liveS = { key: k, poolId: poolIdFromKey(k), token0IsEth: false };
    expect(() => parseDeployments(f)).toThrow(/sorted/);
  });
});

describe("shared/params.json", () => {
  test("the committed file parses", () => {
    const p = loadParams();
    expect(p.feeMinPips).toBeLessThanOrEqual(p.feeSafePips);
    expect(p.feeSafePips).toBeLessThanOrEqual(p.feeMaxPips);
  });
  test("etaE4 must match P* (tolerance 1); extra fields such as staticFeePips are ignored", () => {
    expect(() => parseParams({ ...loadParams(), pStar: 0.2, etaE4: 25_093 })).toThrow(/etaE4/);
    expect(parseParams({ ...loadParams(), pStar: 0.2, etaE4: 41_761, staticFeePips: 600 }).etaE4).toBe(41_761);
  });
  test("fee bounds follow the hook constructor: 0 < min <= safe <= max", () => {
    expect(() => parseParams({ ...loadParams(), feeMinPips: 0 })).toThrow(/feeMinPips/);
    expect(() => parseParams({ ...loadParams(), feeSafePips: 20_000 })).toThrow(/feeMaxPips/);
  });
  test("isProvisional flags the bootstrap file", () => {
    expect(isProvisional({ ...loadParams(), decidedBy: "PROVISIONAL x" })).toBe(true);
    expect(isProvisional({ ...loadParams(), decidedBy: "FIXTURE x" })).toBe(true);
    expect(isProvisional({ ...loadParams(), decidedBy: "lab/out/pstar-decision.json" })).toBe(false);
  });
});
```

- [x] **Step 3: Run it, expected FAIL**

Run: `cd shared && bun test test/config.test.ts`
Expected: `error: Cannot find module '../src/config'`, ` 1 fail`.

- [x] **Step 4: Minimal implementation**

`shared/src/config.ts`:
```ts
// Typed, validated loaders for shared/deployments/sepolia.json and shared/params.json.
// Validation catches deploy-script mistakes early (wrong poolId, unsorted currencies, wrong token order flag).
// The deployments layout is the one plan 01's 05_WriteDeployments writes and plan 05's app parses; keys this
// loader does not know (plan 01's `deployer`, `liquidity`) are ignored.
import { encodeAbiParameters, getAddress, isAddress, keccak256, zeroAddress, type Address, type Hex } from "viem";
import deploymentsJson from "../deployments/sepolia.json";
import paramsJson from "../params.json";
import { POOL_KEY_COMPONENTS } from "./abis";
import type { PairOrientation } from "./price";
import { etaE4FromPStar, PIPS_DENOMINATOR, type HookParams } from "./units";

export const SEPOLIA_CHAIN_ID = 11155111;
/** LPFeeLibrary.DYNAMIC_FEE_FLAG: PoolKey.fee of a dynamic-fee pool. */
export const DYNAMIC_FEE_FLAG = 0x800000;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type TokenEntry = { address: Address; symbol: string; decimals: number };
export type PoolEntry = { key: PoolKey; poolId: Hex; token0IsEth: boolean };
export type PairName = "live" | "replay";
export type PoolName = "liveV" | "liveS" | "replayV" | "replayS";

export type Deployments = {
  chainId: number;
  deployBlock: number | null;
  uniswap: { poolManager: Address; stateView: Address; poolSwapTest: Address; poolModifyLiquidityTest: Address };
  cre: { mockForwarder: Address; keystoneForwarder: Address };
  /** One token pair serves the live and the replay pools (their PoolKeys differ by hook and static fee). */
  tokens: { tETH: TokenEntry | null; tUSD: TokenEntry | null };
  /** `don`: the desk wired to the production KeystoneForwarder (plan 02 Task 13), not used by any pool here. */
  riskDesks: { live: Address | null; replay: Address | null; don: Address | null };
  hooks: Record<PairName, Address | null>;
  pools: Record<PoolName, PoolEntry | null>;
  /** `arb`: a second PoolSwapTest used only by the arbitrage bot, so the app can tell arbitrage swaps by Swap.sender (plan 05). */
  routers: { arb: Address | null };
};

export type ClimParams = HookParams & { pStar: number; decidedBy: string };

/** Everything a bot needs for one pair, all non-null. */
export type ResolvedPair = {
  pair: PairName;
  V: PoolEntry;
  S: PoolEntry;
  hook: Address;
  desk: Address;
  tETH: TokenEntry;
  tUSD: TokenEntry;
};

export function poolIdFromKey(key: PoolKey): Hex {
  return keccak256(encodeAbiParameters([{ type: "tuple", components: POOL_KEY_COMPONENTS }], [key]));
}

export function requireValue<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) {
    throw new Error(`${what} is null: deploy it first (plan 01) and record it in shared/deployments/sepolia.json`);
  }
  return v;
}

type Json = Record<string, unknown>;

function obj(v: unknown, path: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${path}: expected an object`);
  return v as Json;
}
function optObj(v: unknown, path: string): Json {
  return v === undefined || v === null ? {} : obj(v, path);
}
function addr(v: unknown, path: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new Error(`${path}: expected an address, got ${String(v)}`);
  return getAddress(v);
}
function addrOrNull(v: unknown, path: string): Address | null {
  return v === null || v === undefined ? null : addr(v, path);
}
function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${path}: expected an integer in [${min}, ${max}], got ${String(v)}`);
  }
  return v;
}
function token(v: unknown, path: string): TokenEntry | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  if (typeof o.symbol !== "string") throw new Error(`${path}.symbol: expected a string`);
  return { address: addr(o.address, `${path}.address`), symbol: o.symbol, decimals: int(o.decimals, `${path}.decimals`, 0, 36) };
}
function poolKey(v: unknown, path: string): PoolKey {
  const o = obj(v, path);
  return {
    currency0: addr(o.currency0, `${path}.currency0`),
    currency1: addr(o.currency1, `${path}.currency1`),
    fee: int(o.fee, `${path}.fee`, 0, DYNAMIC_FEE_FLAG),
    tickSpacing: int(o.tickSpacing, `${path}.tickSpacing`, 1, 32767),
    hooks: addr(o.hooks, `${path}.hooks`),
  };
}

function pool(v: unknown, name: PoolName, tETH: TokenEntry | null, tUSD: TokenEntry | null, hooks: Record<PairName, Address | null>): PoolEntry | null {
  if (v === null || v === undefined) return null;
  const path = `pools.${name}`;
  const o = obj(v, path);
  const key = poolKey(o.key, `${path}.key`);
  if (typeof o.poolId !== "string" || o.poolId.toLowerCase() !== poolIdFromKey(key)) {
    throw new Error(`${path}.poolId does not match keccak256(abi.encode(key)) = ${poolIdFromKey(key)}`);
  }
  if (typeof o.token0IsEth !== "boolean") throw new Error(`${path}.token0IsEth: expected a boolean`);
  if (BigInt(key.currency0) >= BigInt(key.currency1)) throw new Error(`${path}.key: currencies must be sorted (currency0 < currency1)`);
  if (tETH && tUSD) {
    const pairSet = [tETH.address, tUSD.address].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    if (key.currency0 !== pairSet[0] || key.currency1 !== pairSet[1]) throw new Error(`${path}.key: currencies must be tokens.tETH and tokens.tUSD`);
    if (o.token0IsEth !== (key.currency0 === tETH.address)) {
      throw new Error(`${path}.token0IsEth is ${o.token0IsEth} but currency0 ${key.currency0 === tETH.address ? "is" : "is not"} tETH`);
    }
  }
  const pair: PairName = name.startsWith("live") ? "live" : "replay";
  if (name.endsWith("V")) {
    if (key.fee !== DYNAMIC_FEE_FLAG) throw new Error(`${path}.key.fee must be the dynamic fee flag 0x800000`);
    if (key.hooks !== hooks[pair]) throw new Error(`${path}.key.hooks must equal hooks.${pair}`);
  } else {
    if (key.fee >= DYNAMIC_FEE_FLAG) throw new Error(`${path}.key.fee must be a static fee (< 0x800000)`);
    if (key.hooks !== zeroAddress) throw new Error(`${path}.key.hooks must be the zero address`);
  }
  return { key, poolId: poolIdFromKey(key), token0IsEth: o.token0IsEth };
}

export function parseDeployments(raw: unknown): Deployments {
  const o = obj(raw, "deployments");
  const chainId = int(o.chainId, "chainId", 1, Number.MAX_SAFE_INTEGER);
  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`chainId must be ${SEPOLIA_CHAIN_ID}, got ${chainId}`);
  const u = obj(o.uniswap, "uniswap");
  const c = obj(o.cre, "cre");
  const t = obj(o.tokens, "tokens");
  const rd = obj(o.riskDesks, "riskDesks");
  const h = obj(o.hooks, "hooks");
  const p = obj(o.pools, "pools");
  const r = optObj(o.routers, "routers");
  const tETH = token(t.tETH, "tokens.tETH");
  const tUSD = token(t.tUSD, "tokens.tUSD");
  const hooks = { live: addrOrNull(h.live, "hooks.live"), replay: addrOrNull(h.replay, "hooks.replay") };
  return {
    chainId,
    deployBlock: o.deployBlock === null || o.deployBlock === undefined ? null : int(o.deployBlock, "deployBlock", 0, Number.MAX_SAFE_INTEGER),
    uniswap: {
      poolManager: addr(u.poolManager, "uniswap.poolManager"),
      stateView: addr(u.stateView, "uniswap.stateView"),
      poolSwapTest: addr(u.poolSwapTest, "uniswap.poolSwapTest"),
      poolModifyLiquidityTest: addr(u.poolModifyLiquidityTest, "uniswap.poolModifyLiquidityTest"),
    },
    cre: { mockForwarder: addr(c.mockForwarder, "cre.mockForwarder"), keystoneForwarder: addr(c.keystoneForwarder, "cre.keystoneForwarder") },
    tokens: { tETH, tUSD },
    riskDesks: {
      live: addrOrNull(rd.live, "riskDesks.live"),
      replay: addrOrNull(rd.replay, "riskDesks.replay"),
      don: addrOrNull(rd.don, "riskDesks.don"),
    },
    hooks,
    pools: {
      liveV: pool(p.liveV, "liveV", tETH, tUSD, hooks),
      liveS: pool(p.liveS, "liveS", tETH, tUSD, hooks),
      replayV: pool(p.replayV, "replayV", tETH, tUSD, hooks),
      replayS: pool(p.replayS, "replayS", tETH, tUSD, hooks),
    },
    routers: { arb: addrOrNull(r.arb, "routers.arb") },
  };
}

export function parseParams(raw: unknown): ClimParams {
  const o = obj(raw, "params");
  if (typeof o.pStar !== "number" || !(o.pStar > 0 && o.pStar < 1)) throw new Error(`params.pStar must be in (0, 1)`);
  const etaE4 = int(o.etaE4, "params.etaE4", 1, 0xffffffff);
  if (Math.abs(etaE4 - etaE4FromPStar(o.pStar)) > 1) {
    throw new Error(`params.etaE4 ${etaE4} does not match pStar ${o.pStar} (expected ${etaE4FromPStar(o.pStar)})`);
  }
  // Same bounds as the ClimHook constructor (spec 3.6): 0 < feeMin <= feeSafe <= feeMax <= 1e6.
  const feeMinPips = int(o.feeMinPips, "params.feeMinPips", 1, PIPS_DENOMINATOR);
  const feeSafePips = int(o.feeSafePips, "params.feeSafePips", feeMinPips, PIPS_DENOMINATOR);
  const feeMaxPips = int(o.feeMaxPips, "params.feeMaxPips", feeSafePips, PIPS_DENOMINATOR);
  if (typeof o.decidedBy !== "string" || o.decidedBy.length === 0) throw new Error(`params.decidedBy must be a non-empty string`);
  return {
    pStar: o.pStar,
    etaE4,
    sqrtHalfDtE6: int(o.sqrtHalfDtE6, "params.sqrtHalfDtE6", 1, 0xffffffff),
    feeMinPips,
    feeMaxPips,
    feeSafePips,
    tauKillSec: int(o.tauKillSec, "params.tauKillSec", 1, 0xffffffff),
    decidedBy: o.decidedBy,
  };
}

/** True while shared/params.json is not a lab decision (the PROVISIONAL bootstrap or a FIXTURE). Never deploy a hook from it. */
export function isProvisional(p: ClimParams): boolean {
  return p.decidedBy.startsWith("PROVISIONAL") || p.decidedBy.startsWith("FIXTURE");
}

export function loadDeployments(): Deployments {
  return parseDeployments(deploymentsJson);
}

export function loadParams(): ClimParams {
  return parseParams(paramsJson);
}

export function resolvePair(d: Deployments, pair: PairName): ResolvedPair {
  return {
    pair,
    V: requireValue(d.pools[`${pair}V`], `pools.${pair}V`),
    S: requireValue(d.pools[`${pair}S`], `pools.${pair}S`),
    hook: requireValue(d.hooks[pair], `hooks.${pair}`),
    desk: requireValue(d.riskDesks[pair], `riskDesks.${pair}`),
    tETH: requireValue(d.tokens.tETH, "tokens.tETH"),
    tUSD: requireValue(d.tokens.tUSD, "tokens.tUSD"),
  };
}

/** The router the arbitrage bot swaps through: routers.arb when deployed, else the shared PoolSwapTest. */
export function arbRouter(d: Deployments): Address {
  return d.routers.arb ?? d.uniswap.poolSwapTest;
}

export function orientationOf(pool: PoolEntry, d: Deployments): PairOrientation {
  const eth = requireValue(d.tokens.tETH, "tokens.tETH");
  const usd = requireValue(d.tokens.tUSD, "tokens.tUSD");
  return pool.token0IsEth
    ? { token0IsEth: true, decimals0: eth.decimals, decimals1: usd.decimals }
    : { token0IsEth: false, decimals0: usd.decimals, decimals1: eth.decimals };
}
```

`shared/src/index.ts`:
```ts
export * from "./abis";
export * from "./config";
export * from "./price";
export * from "./report";
export * from "./units";
```

- [x] **Step 5: Run, expected PASS**

Run: `cd shared && bun test && bun run typecheck`
Expected: ` 55 pass`, ` 3 skip`, ` 0 fail` across 5 files (` 15 pass` in `config.test.ts`); typecheck clean.

- [x] **Step 6: Log the interface**

Append under `## Build notes` in today's session log:

```markdown
- (ops) Shared files: `shared/deployments/sepolia.json` (plan 01's layout: `tokens.tETH/tUSD` objects, `riskDesks.live/replay/don`, `hooks.live/replay`, `pools.*`, plus `routers.arb` for plan 05) and `shared/params.json` are validated on load (pool id = keccak256(abi.encode(key)), tETH/tUSD sorted, token order flag, dynamic flag on V, no hook on S, eta matches P\*). `params.json` starts as `PROVISIONAL`; no hook is deployed from provisional parameters. Plan 02's `sync-config.ts` must read `tokens.tETH.address`, `tokens.tUSD.address` and `riskDesks.*`.
```

- [x] **Step 7: Commit**

```bash
git add shared/deployments/sepolia.json shared/params.json shared/src/config.ts shared/src/index.ts shared/test/config.test.ts docs/sessions/
git commit -m "feat(shared): deployments and params schemas with validated loaders"
```

---

### Task 7: `bots` package, env and log helpers

**Delegable:** yes
**Depends on:** Task 6

**Files:**
- Modify: `package.json` (workspaces)
- Create: `bots/package.json`, `bots/tsconfig.json`, `bots/src/lib/env.ts`, `bots/src/lib/jsonl.ts`
- Test: `bots/test/env.test.ts`

- [x] **Step 1: Register the workspace and create the package**

In the root `package.json`, change `"workspaces": ["shared"]` to `"workspaces": ["shared", "bots"]` (keep `"app"` if plan 05 already added it).

`bots/package.json`:
```json
{
  "name": "@clim/bots",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit -p .",
    "arb": "bun src/arb.ts",
    "noise": "bun src/noise.ts",
    "cre-loop": "bun src/sim-loop.ts",
    "replay-server": "bun src/replay-server.ts",
    "fund": "bun src/scripts/fund.ts",
    "status": "bun src/scripts/status.ts",
    "forge-report": "bun src/scripts/forge-report.ts"
  },
  "dependencies": {
    "@clim/shared": "workspace:*",
    "viem": "^2.57.3"
  },
  "devDependencies": {
    "@types/bun": "^1.4.2",
    "typescript": "5.9.3"
  }
}
```

`bots/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src", "test"]
}
```

Run: `bun install`
Expected: no error; `ls -la node_modules/@clim` shows `bots -> ../../bots` and `shared -> ../../shared`.

- [x] **Step 2: Write the failing test**

`bots/test/env.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { argValue, botKey, envNum, pairArg } from "../src/lib/env";
import { toJsonLine } from "../src/lib/jsonl";

const KEY = `0x${"1".repeat(64)}` as const;

describe("env and CLI helpers", () => {
  test("argValue reads --flag value pairs", () => {
    expect(argValue("--pair", ["bun", "arb.ts", "--pair", "replay"])).toBe("replay");
    expect(argValue("--pair", ["bun", "arb.ts"])).toBeUndefined();
  });
  test("pairArg defaults to live and rejects unknown pairs", () => {
    expect(pairArg(["bun", "arb.ts"])).toBe("live");
    expect(pairArg(["bun", "arb.ts", "--pair", "replay"])).toBe("replay");
    expect(() => pairArg(["bun", "arb.ts", "--pair", "mainnet"])).toThrow(/--pair/);
  });
  test("botKey reads <ROLE>_<PAIR>_PRIVATE_KEY and checks the format", () => {
    expect(botKey("ARB", "live", { ARB_LIVE_PRIVATE_KEY: KEY })).toBe(KEY);
    expect(() => botKey("NOISE", "replay", {})).toThrow(/NOISE_REPLAY_PRIVATE_KEY/);
    expect(() => botKey("ARB", "live", { ARB_LIVE_PRIVATE_KEY: "1234" })).toThrow(/0x/);
  });
  test("envNum parses numbers with a fallback", () => {
    expect(envNum("X", 0.5, {})).toBe(0.5);
    expect(envNum("X", 0.5, { X: "2" })).toBe(2);
    expect(() => envNum("X", 0.5, { X: "abc" })).toThrow(/X/);
  });
});

describe("jsonl", () => {
  test("serialises bigints as strings, one line per record", () => {
    expect(toJsonLine({ block: 123n, ok: true })).toBe('{"block":"123","ok":true}\n');
  });
});
```

- [x] **Step 3: Run it, expected FAIL**

Run: `cd bots && bun test test/env.test.ts`
Expected: `error: Cannot find module '../src/lib/env'`, ` 1 fail`.

- [x] **Step 4: Minimal implementation**

`bots/src/lib/env.ts`:
```ts
// Environment and CLI parsing. Bun loads bots/.env automatically when commands run from bots/.
import type { PairName } from "@clim/shared";
import type { Hex } from "viem";

type Env = Record<string, string | undefined>;

export const DEFAULT_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

export function argValue(flag: string, argv: readonly string[] = process.argv): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function hasFlag(flag: string, argv: readonly string[] = process.argv): boolean {
  return argv.includes(flag);
}

export function pairArg(argv: readonly string[] = process.argv): PairName {
  const v = argValue("--pair", argv) ?? "live";
  if (v !== "live" && v !== "replay") throw new Error(`--pair must be live or replay, got ${v}`);
  return v;
}

export function envNum(name: string, fallback: number, env: Env = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${raw}`);
  return n;
}

export function envStr(name: string, fallback: string, env: Env = process.env): string {
  const raw = env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

export function rpcUrl(env: Env = process.env): string {
  return envStr("SEPOLIA_RPC_URL", DEFAULT_RPC_URL, env);
}

export function privateKeyFromEnv(name: string, env: Env = process.env): Hex {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set (see bots/.env.example)`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be 0x followed by 64 hex characters`);
  return v as Hex;
}

/** One key per (role, pair) so that concurrent bots never share a nonce. */
export function botKey(role: "ARB" | "NOISE", pair: PairName, env: Env = process.env): Hex {
  return privateKeyFromEnv(`${role}_${pair.toUpperCase()}_PRIVATE_KEY`, env);
}
```

`bots/src/lib/jsonl.ts`:
```ts
// Append-only JSON-lines logs under bots/out/ (bigints serialised as decimal strings).
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { BaseError, ContractFunctionRevertedError } from "viem";

export const OUT_DIR = join(import.meta.dir, "..", "..", "out");

export function toJsonLine(record: Record<string, unknown>): string {
  return `${JSON.stringify(record, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}\n`;
}

export function appendJsonl(file: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, toJsonLine(record));
}

/** Compact error text for logs: the decoded revert name when there is one, else the first line of the message. */
export function shortError(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return `reverted: ${revert.data?.errorName ?? revert.reason ?? revert.signature ?? revert.raw ?? "unknown"}`;
    }
    return e.shortMessage;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0] ?? msg;
}
```

- [x] **Step 5: Run, expected PASS**

Run: `cd bots && bun test test/env.test.ts && bun run typecheck`
Expected: ` 5 pass`, ` 0 fail`; typecheck clean.

- [x] **Step 6: Commit**

```bash
git add package.json bun.lock bots/package.json bots/tsconfig.json bots/src/lib/env.ts bots/src/lib/jsonl.ts bots/test/env.test.ts
git commit -m "feat(bots): package scaffold, env and jsonl helpers"
```

---

### Task 8: Seeded randomness

**Delegable:** yes
**Depends on:** Task 7

**Files:**
- Create: `bots/src/lib/rng.ts`
- Test: `bots/test/rng.test.ts`

- [x] **Step 1: Write the failing test**

`bots/test/rng.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { logNormal, mulberry32, poisson, standardNormal } from "../src/lib/rng";

function draws(n: number, f: () => number): number[] {
  return Array.from({ length: n }, f);
}
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

describe("seeded PRNG", () => {
  test("same seed -> same sequence, different seed -> different sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = draws(5, a);
    expect(draws(5, b)).toEqual(sa);
    expect(draws(5, c)).not.toEqual(sa);
  });
  test("uniform in [0, 1) with mean 1/2", () => {
    const xs = draws(20_000, mulberry32(1));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(mean(xs)).toBeCloseTo(0.5, 2);
  });
});

describe("distributions", () => {
  test("standard normal: mean 0, sd 1", () => {
    const r = mulberry32(7);
    const xs = draws(20_000, () => standardNormal(r));
    const m = mean(xs);
    const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
    expect(Math.abs(m)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });
  test("poisson: mean and variance equal lambda; lambda 0 gives 0", () => {
    const r = mulberry32(11);
    const xs = draws(20_000, () => poisson(r, 0.5));
    const m = mean(xs);
    const v = mean(xs.map((x) => (x - m) ** 2));
    expect(Math.abs(m - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(v - 0.5)).toBeLessThan(0.03);
    expect(poisson(r, 0)).toBe(0);
    expect(() => poisson(r, -1)).toThrow(RangeError);
  });
  test("log-normal: sample median close to the median parameter", () => {
    const r = mulberry32(5);
    const xs = draws(20_001, () => logNormal(r, 2_000, 1)).sort((a, b) => a - b);
    expect(Math.abs((xs[10_000] ?? 0) / 2_000 - 1)).toBeLessThan(0.05);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd bots && bun test test/rng.test.ts`
Expected: `error: Cannot find module '../src/lib/rng'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`bots/src/lib/rng.ts`:
```ts
// Seeded randomness for the retail (noise) bot, so a run can be replayed from its seed.
export type Rand = () => number;

/** mulberry32: small, fast 32-bit PRNG; uniform in [0, 1). */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform. */
export function standardNormal(rand: Rand): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Knuth's algorithm; exact and fast for the small rates used here (lambda < 30). */
export function poisson(rand: Rand, lambda: number): number {
  if (!(lambda >= 0 && lambda < 30)) throw new RangeError(`lambda must be in [0, 30), got ${lambda}`);
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

/** Log-normal with the given median and log-standard-deviation. */
export function logNormal(rand: Rand, median: number, sigmaLn: number): number {
  return median * Math.exp(sigmaLn * standardNormal(rand));
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd bots && bun test test/rng.test.ts`
Expected: ` 5 pass`, ` 0 fail`.

- [x] **Step 5: Commit**

```bash
git add bots/src/lib/rng.ts bots/test/rng.test.ts
git commit -m "feat(bots): seeded PRNG and distributions"
```

---

### Task 9: Swap arguments and token order

**Delegable:** yes
**Depends on:** Task 7

**Files:**
- Create: `bots/src/lib/swap.ts`
- Test: `bots/test/swap.test.ts`

- [x] **Step 1: Write the failing test**

`bots/test/swap.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE, type PoolKey } from "@clim/shared";
import { zeroAddress } from "viem";
import { inputAmountForUsd, noPriceLimit, swapArgs, zeroForOneFor } from "../src/lib/swap";

const KEY: PoolKey = {
  currency0: "0x1111111111111111111111111111111111111111",
  currency1: "0x2222222222222222222222222222222222222222",
  fee: 0x800000,
  tickSpacing: 60,
  hooks: zeroAddress,
};

describe("token order", () => {
  test("selling ETH is zeroForOne only when token0 is ETH", () => {
    expect(zeroForOneFor("sellEth", true)).toBe(true);
    expect(zeroForOneFor("buyEth", true)).toBe(false);
    expect(zeroForOneFor("sellEth", false)).toBe(false);
    expect(zeroForOneFor("buyEth", false)).toBe(true);
  });
});

describe("PoolSwapTest.swap arguments", () => {
  test("exact input is a negative amountSpecified; real tokens in and out", () => {
    const [key, params, settings, hookData] = swapArgs(KEY, true, 5n * 10n ** 18n, 123n);
    expect(key).toEqual(KEY);
    expect(params).toEqual({ zeroForOne: true, amountSpecified: -(5n * 10n ** 18n), sqrtPriceLimitX96: 123n });
    expect(settings).toEqual({ takeClaims: false, settleUsingBurn: false });
    expect(hookData).toBe("0x");
  });
  test("rejects a zero amount (v4 reverts SwapAmountCannotBeZero)", () => {
    expect(() => swapArgs(KEY, true, 0n, 123n)).toThrow(RangeError);
  });
  test("no price limit = one step inside the v4 bounds, on the side the price moves to", () => {
    expect(noPriceLimit(true)).toBe(MIN_SQRT_PRICE + 1n);
    expect(noPriceLimit(false)).toBe(MAX_SQRT_PRICE - 1n);
  });
});

describe("USD notional -> input amount in base units", () => {
  test("buying ETH pays USD, selling ETH pays ETH", () => {
    expect(inputAmountForUsd("buyEth", 2_000, 2_500, 18, 18)).toBe(2_000n * 10n ** 18n);
    expect(inputAmountForUsd("sellEth", 2_000, 2_500, 18, 18)).toBe(8n * 10n ** 17n);
  });
  test("respects the input token decimals", () => {
    expect(inputAmountForUsd("buyEth", 1_234.5678919, 2_500, 18, 6)).toBe(1_234_567_892n);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd bots && bun test test/swap.test.ts`
Expected: `error: Cannot find module '../src/lib/swap'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`bots/src/lib/swap.ts`:
```ts
// Swap plumbing for PoolSwapTest (v4-core src/test/PoolSwapTest.sol).
// The caller must have approved PoolSwapTest for the input token: it pulls with transferFrom(msg.sender, ...).
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE, type PoolKey } from "@clim/shared";
import { parseUnits } from "viem";

export type Side = "buyEth" | "sellEth";

/** Selling ETH means paying token0 only when token0 is ETH. */
export function zeroForOneFor(side: Side, token0IsEth: boolean): boolean {
  return side === "sellEth" ? token0IsEth : !token0IsEth;
}

/** args for poolSwapTestAbi `swap`: exact input (negative amountSpecified), ERC-20 settlement, no hook data. */
export function swapArgs(key: PoolKey, zeroForOne: boolean, amountIn: bigint, sqrtPriceLimitX96: bigint) {
  if (amountIn <= 0n) throw new RangeError("amountIn must be > 0");
  return [
    key,
    { zeroForOne, amountSpecified: -amountIn, sqrtPriceLimitX96 },
    { takeClaims: false, settleUsingBurn: false },
    "0x",
  ] as const;
}

/** Retail swaps take any price: the limit sits one step inside TickMath bounds in the direction of the swap. */
export function noPriceLimit(zeroForOne: boolean): bigint {
  return zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
}

/** Input amount (base units) for a retail order of `usd` dollars: USD when buying ETH, ETH when selling it. */
export function inputAmountForUsd(side: Side, usd: number, ethUsd: number, ethDecimals: number, usdDecimals: number): bigint {
  const human = side === "buyEth" ? usd : usd / ethUsd;
  const decimals = side === "buyEth" ? usdDecimals : ethDecimals;
  return parseUnits(human.toFixed(Math.min(decimals, 12)), decimals);
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd bots && bun test test/swap.test.ts && bun run typecheck`
Expected: ` 6 pass`, ` 0 fail`; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add bots/src/lib/swap.ts bots/test/swap.test.ts
git commit -m "feat(bots): PoolSwapTest swap arguments and retail amounts"
```

---

### Task 10: Myopic arbitrage decision

**Delegable:** yes
**Depends on:** Tasks 3, 9

**Files:**
- Create: `bots/src/lib/arb.ts`
- Test: `bots/test/arb.test.ts`

- [x] **Step 1: Write the failing test**

`bots/test/arb.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { ethUsdFromSqrtPriceX96, sqrtPriceX96FromEthUsd, type PairOrientation } from "@clim/shared";
import { decideArb } from "../src/lib/arb";

const ETH0: PairOrientation = { token0IsEth: true, decimals0: 18, decimals1: 18 };
const USD0: PairOrientation = { token0IsEth: false, decimals0: 18, decimals1: 18 };
const M = 2_000;
const FEE = 500; // 5 bp: no-arbitrage band is [m * (1 - f), m / (1 - f)]

function at(pool: number, o: PairOrientation, feePips = FEE, market = M) {
  return decideArb({ sqrtPriceX96: sqrtPriceX96FromEthUsd(pool, o), marketEthUsd: market, feePips, orientation: o });
}

describe("myopic arbitrageur", () => {
  test("pool at the market price: no trade", () => {
    expect(at(M, ETH0).action).toBe("none");
  });
  test("pool ETH too expensive (token0 = ETH): sell ETH, zeroForOne, push down to m / (1 - f)", () => {
    const d = at(2_002, ETH0);
    if (d.action !== "swap") throw new Error("expected a swap");
    expect(d.side).toBe("sellEth");
    expect(d.zeroForOne).toBe(true);
    expect(d.sqrtPriceLimitX96 < sqrtPriceX96FromEthUsd(2_002, ETH0)).toBe(true);
    expect(ethUsdFromSqrtPriceX96(d.sqrtPriceLimitX96, ETH0)).toBeCloseTo(M / (1 - 0.0005), 6);
  });
  test("pool ETH too cheap (token0 = ETH): buy ETH, oneForZero, push up to m * (1 - f)", () => {
    const d = at(1_998, ETH0);
    if (d.action !== "swap") throw new Error("expected a swap");
    expect(d.side).toBe("buyEth");
    expect(d.zeroForOne).toBe(false);
    expect(d.sqrtPriceLimitX96 > sqrtPriceX96FromEthUsd(1_998, ETH0)).toBe(true);
    expect(ethUsdFromSqrtPriceX96(d.sqrtPriceLimitX96, ETH0)).toBeCloseTo(M * (1 - 0.0005), 6);
  });
  test("token0 = USD flips the swap direction and the limit side", () => {
    const sell = at(2_002, USD0);
    if (sell.action !== "swap") throw new Error("expected a swap");
    expect(sell.side).toBe("sellEth");
    expect(sell.zeroForOne).toBe(false);
    expect(sell.sqrtPriceLimitX96 > sqrtPriceX96FromEthUsd(2_002, USD0)).toBe(true);
    const buy = at(1_998, USD0);
    if (buy.action !== "swap") throw new Error("expected a swap");
    expect(buy.side).toBe("buyEth");
    expect(buy.zeroForOne).toBe(true);
    expect(buy.sqrtPriceLimitX96 < sqrtPriceX96FromEthUsd(1_998, USD0)).toBe(true);
  });
  test("band edges: inside -> none, outside -> swap", () => {
    expect(at((M / (1 - 0.0005)) * (1 - 1e-7), ETH0).action).toBe("none");
    expect(at(M * 1.0006, ETH0).action).toBe("swap");
    expect(at(M * (1 - 0.0005) * (1 + 1e-7), ETH0).action).toBe("none");
    expect(at(M * 0.9994, ETH0).action).toBe("swap");
  });
  test("a wider fee widens the band: 1 % gap is inside a 150 bp fee", () => {
    expect(at(2_020, ETH0, 15_000).action).toBe("none");
    expect(at(2_020, ETH0, 500).action).toBe("swap");
  });
  test("after the arbitrage the pool sits on the band edge: no second trade", () => {
    for (const o of [ETH0, USD0]) {
      for (const pool of [1_990, 2_010]) {
        const d = at(pool, o);
        if (d.action !== "swap") throw new Error("expected a swap");
        const again = decideArb({ sqrtPriceX96: d.sqrtPriceLimitX96, marketEthUsd: M, feePips: FEE, orientation: o });
        expect(again.action).toBe("none");
      }
    }
  });
  test("reports the log gap and the band in the decision", () => {
    const d = at(2_002, ETH0);
    expect(d.logGap).toBeCloseTo(Math.log(2_002 / 2_000), 9);
    expect(d.bandLog).toBeCloseTo(-Math.log(1 - 0.0005), 12);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd bots && bun test test/arb.test.ts`
Expected: `error: Cannot find module '../src/lib/arb'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`bots/src/lib/arb.ts`:
```ts
// Rational myopic arbitrageur (Milionis-Moallemi-Roughgarden 2023 model): trade only when the pool price
// leaves the no-arbitrage band, and push it exactly back to the band edge.
// A v4 fee f is taken from the input amount, so the band is [m * (1 - f), m / (1 - f)]:
//   pool ETH too cheap  (P < m (1 - f)): buy ETH,  target P' = m (1 - f)
//   pool ETH too dear   (P > m / (1 - f)): sell ETH, target P' = m / (1 - f)
// In log terms the band half-width is -ln(1 - f) ~ f (the design writes sqrt(m (1 -/+ f)); same to first order).
import { clampSqrtPriceLimit, ethUsdFromSqrtPriceX96, pipsToFraction, sqrtPriceX96FromEthUsd, type PairOrientation } from "@clim/shared";
import { zeroForOneFor, type Side } from "./swap";

/** Log-price tolerance (1e-9 = 0.00001 bp) so a pool left exactly on the band edge is not traded again on float noise. */
export const EDGE_EPS = 1e-9;

export type ArbInput = {
  sqrtPriceX96: bigint;
  marketEthUsd: number;
  feePips: number;
  orientation: PairOrientation;
};

type Common = { poolEthUsd: number; logGap: number; bandLog: number };
export type ArbDecision =
  | ({ action: "none" } & Common)
  | ({ action: "swap"; side: Side; zeroForOne: boolean; sqrtPriceLimitX96: bigint; targetEthUsd: number } & Common);

export function decideArb(i: ArbInput): ArbDecision {
  const f = pipsToFraction(i.feePips);
  if (!(f >= 0 && f < 1)) throw new RangeError(`feePips must be in [0, 1e6), got ${i.feePips}`);
  const poolEthUsd = ethUsdFromSqrtPriceX96(i.sqrtPriceX96, i.orientation);
  const logGap = Math.log(poolEthUsd / i.marketEthUsd);
  const bandLog = -Math.log(1 - f);
  const common: Common = { poolEthUsd, logGap, bandLog };
  if (Math.abs(logGap) <= bandLog + EDGE_EPS) return { action: "none", ...common };

  const side: Side = logGap > 0 ? "sellEth" : "buyEth";
  const targetEthUsd = side === "sellEth" ? i.marketEthUsd / (1 - f) : i.marketEthUsd * (1 - f);
  const zeroForOne = zeroForOneFor(side, i.orientation.token0IsEth);
  const sqrtPriceLimitX96 = clampSqrtPriceLimit(sqrtPriceX96FromEthUsd(targetEthUsd, i.orientation));
  // v4 reverts PriceLimitAlreadyExceeded unless the limit is strictly on the far side of the current price.
  const onRightSide = zeroForOne ? sqrtPriceLimitX96 < i.sqrtPriceX96 : sqrtPriceLimitX96 > i.sqrtPriceX96;
  if (!onRightSide) return { action: "none", ...common };
  return { action: "swap", side, zeroForOne, sqrtPriceLimitX96, targetEthUsd, ...common };
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd bots && bun test test/arb.test.ts && bun run typecheck`
Expected: ` 8 pass`, ` 0 fail`; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add bots/src/lib/arb.ts bots/test/arb.test.ts
git commit -m "feat(bots): myopic arbitrage decision and price limit"
```

---

### Task 11: Market price from four venues

**Delegable:** yes
**Depends on:** Task 7

**Files:**
- Create: `bots/src/lib/market.ts`
- Test: `bots/test/market.test.ts`

- [x] **Step 1: Write the failing test**

The fixtures are trimmed real responses of the four public endpoints.

`bots/test/market.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
  aggregate,
  fetchReplayPrice,
  fetchVenueQuotes,
  median,
  parseBinanceTicker,
  parseCoinbaseProduct,
  parseHyperliquidMids,
  parseKrakenTicker,
  VENUE_URLS,
  type FetchLike,
} from "../src/lib/market";

// Trimmed real responses (captured from the public endpoints).
const COINBASE = { product_id: "ETH-USD", price: "2713.33", base_name: "Ethereum", quote_name: "US Dollar" };
const KRAKEN = {
  error: [],
  result: {
    XETHZUSD: { a: ["2713.25000", "2", "2.000"], b: ["2713.24000", "4", "4.000"], c: ["2713.25000", "0.00412332"] },
    USDTZUSD: { a: ["0.99971000", "83080", "83080.000"], b: ["0.99970000", "745859", "745859.000"], c: ["0.99970000", "49.90100000"] },
  },
};
const BINANCE = { symbol: "ETHUSDT", price: "2713.86000000" };
const HYPERLIQUID = { BTC: "86027.5", ETH: "2712.75", SOL: "120.015" };

function fakeFetch(failing: string[] = []): FetchLike {
  return async (url) => {
    const name = Object.entries(VENUE_URLS).find(([, u]) => u === url)?.[0];
    if (!name || failing.includes(name)) throw new Error(`down: ${url}`);
    const body = { coinbase: COINBASE, kraken: KRAKEN, binance: BINANCE, hyperliquid: HYPERLIQUID }[name];
    return new Response(JSON.stringify(body));
  };
}

describe("venue parsers", () => {
  test("parse each public endpoint", () => {
    expect(parseCoinbaseProduct(COINBASE)).toBe(2713.33);
    expect(parseKrakenTicker(KRAKEN)).toEqual({ ethUsd: 2713.25, usdtUsd: 0.9997 });
    expect(parseBinanceTicker(BINANCE)).toBe(2713.86);
    expect(parseHyperliquidMids(HYPERLIQUID)).toBe(2712.75);
  });
  test("reject malformed or error payloads", () => {
    expect(() => parseCoinbaseProduct({ price: "abc" })).toThrow();
    expect(() => parseKrakenTicker({ error: ["EGeneral:Too many requests"], result: {} })).toThrow(/Kraken/);
    expect(() => parseHyperliquidMids({ BTC: "1" })).toThrow();
  });
});

describe("median and quorum", () => {
  test("median of odd and even samples", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  test("aggregate needs at least 3 venues", () => {
    expect(aggregate([{ venue: "coinbase", price: 1 }, { venue: "kraken", price: 2 }])).toBeNull();
    expect(aggregate([{ venue: "coinbase", price: 1 }, { venue: "kraken", price: 2 }, { venue: "binance", price: 9 }])).toEqual({ price: 2, n: 3 });
  });
});

describe("fetchVenueQuotes", () => {
  test("all four venues, Binance converted from USDT with Kraken USDT/USD", async () => {
    const q = await fetchVenueQuotes(fakeFetch());
    expect(q.map((x) => x.venue).sort()).toEqual(["binance", "coinbase", "hyperliquid", "kraken"]);
    expect(q.find((x) => x.venue === "binance")?.price).toBeCloseTo(2713.86 * 0.9997, 9);
    expect(aggregate(q)?.price).toBeCloseTo((2713.86 * 0.9997 + 2713.25) / 2, 9);
  });
  test("a failing venue is dropped; without Kraken, Binance cannot be normalised and is dropped too", async () => {
    expect((await fetchVenueQuotes(fakeFetch(["coinbase"]))).length).toBe(3);
    const q = await fetchVenueQuotes(fakeFetch(["kraken"]));
    expect(q.map((x) => x.venue).sort()).toEqual(["coinbase", "hyperliquid"]);
    expect(aggregate(q)).toBeNull();
  });
});

describe("replay price", () => {
  test("reads the Binance-format ticker of the replay server", async () => {
    const f: FetchLike = async (url) => {
      expect(url).toBe("http://127.0.0.1:8787/api/v3/ticker/price?symbol=ETHUSDT");
      return new Response(JSON.stringify({ symbol: "ETHUSDT", price: "2210.50000000" }));
    };
    expect(await fetchReplayPrice("http://127.0.0.1:8787", f)).toBe(2210.5);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd bots && bun test test/market.test.ts`
Expected: `error: Cannot find module '../src/lib/market'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`bots/src/lib/market.ts`:
```ts
// Market price m for the arbitrageur: median of the same four venues as the CRE desk, but from real-time
// tickers (an arbitrageur sees the live price, not 1-minute closes). Binance is USDT-quoted and is
// converted with Kraken's USDT/USD. Fewer than 3 venues -> no price (the bot skips the block).
export type VenueName = "coinbase" | "kraken" | "binance" | "hyperliquid";
export type VenueQuote = { venue: VenueName; price: number };
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const MIN_VENUES = 3;

export const VENUE_URLS = {
  coinbase: "https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD",
  kraken: "https://api.kraken.com/0/public/Ticker?pair=ETHUSD,USDTUSD",
  binance: "https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT",
  hyperliquid: "https://api.hyperliquid.xyz/info",
} as const;

function positive(v: unknown, what: string): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${what}: expected a positive number, got ${String(v)}`);
  return n;
}

function field(o: unknown, key: string): unknown {
  return typeof o === "object" && o !== null ? (o as Record<string, unknown>)[key] : undefined;
}

/** Coinbase Advanced public product: { price: "2713.33", ... } (last trade). */
export function parseCoinbaseProduct(j: unknown): number {
  return positive(field(j, "price"), "coinbase price");
}

/** Kraken Ticker for ETHUSD,USDTUSD: result.<pair>.c[0] is the last trade price. */
export function parseKrakenTicker(j: unknown): { ethUsd: number; usdtUsd: number } {
  const err = field(j, "error");
  if (Array.isArray(err) && err.length > 0) throw new Error(`Kraken error: ${err.join(", ")}`);
  const r = field(j, "result");
  const last = (pair: string): unknown => {
    const c = field(field(r, pair), "c");
    return Array.isArray(c) ? c[0] : undefined;
  };
  return { ethUsd: positive(last("XETHZUSD"), "kraken XETHZUSD"), usdtUsd: positive(last("USDTZUSD"), "kraken USDTZUSD") };
}

/** Binance (and the replay server) ticker: { symbol: "ETHUSDT", price: "2713.86000000" }. */
export function parseBinanceTicker(j: unknown): number {
  return positive(field(j, "price"), "binance price");
}

/** Hyperliquid POST /info { type: "allMids" }: { ETH: "2712.75", ... } (perp mid, USDC ~ USD). */
export function parseHyperliquidMids(j: unknown): number {
  return positive(field(j, "ETH"), "hyperliquid ETH mid");
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError("median of an empty list");
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function aggregate(quotes: readonly VenueQuote[]): { price: number; n: number } | null {
  if (quotes.length < MIN_VENUES) return null;
  return { price: median(quotes.map((q) => q.price)), n: quotes.length };
}

async function getJson(fetchFn: FetchLike, url: string, timeoutMs: number, init?: RequestInit): Promise<unknown> {
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchVenueQuotes(fetchFn: FetchLike = fetch, timeoutMs = 4_000): Promise<VenueQuote[]> {
  const [cb, kr, bn, hl] = await Promise.allSettled([
    getJson(fetchFn, VENUE_URLS.coinbase, timeoutMs).then(parseCoinbaseProduct),
    getJson(fetchFn, VENUE_URLS.kraken, timeoutMs).then(parseKrakenTicker),
    getJson(fetchFn, VENUE_URLS.binance, timeoutMs).then(parseBinanceTicker),
    getJson(fetchFn, VENUE_URLS.hyperliquid, timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    }).then(parseHyperliquidMids),
  ]);
  const out: VenueQuote[] = [];
  if (cb.status === "fulfilled") out.push({ venue: "coinbase", price: cb.value });
  if (kr.status === "fulfilled") out.push({ venue: "kraken", price: kr.value.ethUsd });
  if (bn.status === "fulfilled" && kr.status === "fulfilled") out.push({ venue: "binance", price: bn.value * kr.value.usdtUsd });
  if (hl.status === "fulfilled") out.push({ venue: "hyperliquid", price: hl.value });
  return out;
}

/** Current replay price from replay-server.ts (Binance ticker format, historical USDT price used as USD). */
export async function fetchReplayPrice(replayUrl: string, fetchFn: FetchLike = fetch, timeoutMs = 4_000): Promise<number> {
  return parseBinanceTicker(await getJson(fetchFn, `${replayUrl}/api/v3/ticker/price?symbol=ETHUSDT`, timeoutMs));
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd bots && bun test test/market.test.ts && bun run typecheck`
Expected: ` 7 pass`, ` 0 fail`; typecheck clean.

Live check (network): `cd bots && bun -e 'import { fetchVenueQuotes, aggregate } from "./src/lib/market"; const q = await fetchVenueQuotes(); console.log(q, aggregate(q))'`
Expected: four quotes within a few dollars of each other and `{ price: <median>, n: 4 }`. If a venue is missing, note which one in the session log (geo-blocking or rate limit); the bots need 3.

- [x] **Step 5: Commit**

```bash
git add bots/src/lib/market.ts bots/test/market.test.ts
git commit -m "feat(bots): multi-venue market price with quorum"
```

---

### Task 12: Retail order planning and routing

**Delegable:** yes
**Depends on:** Tasks 8, 9

**Files:**
- Create: `bots/src/lib/noise.ts`
- Test: `bots/test/noise.test.ts`

- [x] **Step 1: Write the failing test**

`bots/test/noise.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { cheaperPool, effectivePrice, planBlockOrders, type NoiseConfig, type PoolQuote } from "../src/lib/noise";
import { mulberry32 } from "../src/lib/rng";

const V: PoolQuote = { ethUsd: 2_000, feePips: 500 };
const S: PoolQuote = { ethUsd: 2_000, feePips: 1_200 };

describe("all-in price for a small retail order", () => {
  test("a buyer pays price / (1 - f), a seller receives price * (1 - f)", () => {
    expect(effectivePrice("buyEth", V)).toBeCloseTo(2_000 / 0.9995, 9);
    expect(effectivePrice("sellEth", V)).toBeCloseTo(2_000 * 0.9995, 9);
  });
  test("cheaper pool: lower fee wins at equal prices, better price can beat a lower fee", () => {
    expect(cheaperPool("buyEth", { V, S })).toBe("V");
    expect(cheaperPool("sellEth", { V, S })).toBe("V");
    const sCheap: PoolQuote = { ethUsd: 1_996, feePips: 1_200 }; // 1996 / 0.9988 = 1998.4 < 2000 / 0.9995 = 2001.0
    expect(cheaperPool("buyEth", { V, S: sCheap })).toBe("S");
    expect(cheaperPool("sellEth", { V, S: sCheap })).toBe("V");
  });
  test("ties go to V", () => {
    expect(cheaperPool("buyEth", { V, S: V })).toBe("V");
  });
});

describe("planBlockOrders", () => {
  const split: NoiseConfig = { ratePerBlock: 0.5, medianUsd: 2_000, sigmaLn: 1, routing: "split" };
  test("deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      expect(planBlockOrders(a, split, { V, S })).toEqual(planBlockOrders(b, split, { V, S }));
    }
  });
  test("Poisson count, balanced sides, 50/50 routing, log-normal size", () => {
    const r = mulberry32(3);
    const orders = Array.from({ length: 10_000 }, () => planBlockOrders(r, split, { V, S })).flat();
    expect(Math.abs(orders.length / 10_000 - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(orders.filter((o) => o.side === "buyEth").length / orders.length - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(orders.filter((o) => o.pool === "V").length / orders.length - 0.5)).toBeLessThan(0.03);
    const sizes = orders.map((o) => o.usd).sort((a, b) => a - b);
    expect(Math.abs((sizes[Math.floor(sizes.length / 2)] ?? 0) / 2_000 - 1)).toBeLessThan(0.08);
  });
  test("mirror routing sends the same order to V and to S", () => {
    const r = mulberry32(21);
    const mirror: NoiseConfig = { ...split, routing: "mirror", ratePerBlock: 2 };
    const orders = Array.from({ length: 500 }, () => planBlockOrders(r, mirror, { V, S })).flat();
    expect(orders.length % 2).toBe(0);
    for (let i = 0; i < orders.length; i += 2) {
      const [a, b] = [orders[i], orders[i + 1]];
      expect(a?.pool).toBe("V");
      expect(b?.pool).toBe("S");
      expect(b?.side).toBe(a?.side);
      expect(b?.usd).toBe(a?.usd);
    }
  });
  test("cheapest routing sends every order to the cheaper pool", () => {
    const r = mulberry32(9);
    const cheapest: NoiseConfig = { ...split, routing: "cheapest", ratePerBlock: 2 };
    const orders = Array.from({ length: 500 }, () => planBlockOrders(r, cheapest, { V, S })).flat();
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.pool === "V")).toBe(true);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd bots && bun test test/noise.test.ts`
Expected: `error: Cannot find module '../src/lib/noise'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`bots/src/lib/noise.ts`:
```ts
// Retail (noise) flow: Poisson arrivals per block, random side, log-normal USD size.
// Routing (spec section 3.8): "mirror" (default) sends every order to both V and S, so the twin pools see the
// same retail flow; "split" sends each order to V or S at random; "cheapest" sends it to the better all-in price
// (the volume-leak variant). Small orders: price impact is ignored when choosing the pool.
import { pipsToFraction } from "@clim/shared";
import { logNormal, poisson, type Rand } from "./rng";
import type { Side } from "./swap";

export type PoolLabel = "V" | "S";
export type PoolQuote = { ethUsd: number; feePips: number };
export type Routing = "mirror" | "split" | "cheapest";
export const ROUTINGS: readonly Routing[] = ["mirror", "split", "cheapest"];
export type NoiseConfig = { ratePerBlock: number; medianUsd: number; sigmaLn: number; routing: Routing };
export type RetailOrder = { side: Side; usd: number; pool: PoolLabel };

/** USD per ETH actually paid (buy) or received (sell) on a small order, fee included. */
export function effectivePrice(side: Side, q: PoolQuote): number {
  const f = pipsToFraction(q.feePips);
  return side === "buyEth" ? q.ethUsd / (1 - f) : q.ethUsd * (1 - f);
}

export function cheaperPool(side: Side, quotes: Record<PoolLabel, PoolQuote>): PoolLabel {
  const v = effectivePrice(side, quotes.V);
  const s = effectivePrice(side, quotes.S);
  if (side === "buyEth") return s < v ? "S" : "V";
  return s > v ? "S" : "V";
}

export function planBlockOrders(rand: Rand, cfg: NoiseConfig, quotes: Record<PoolLabel, PoolQuote>): RetailOrder[] {
  const n = poisson(rand, cfg.ratePerBlock);
  const orders: RetailOrder[] = [];
  for (let i = 0; i < n; i++) {
    const side: Side = rand() < 0.5 ? "buyEth" : "sellEth";
    const usd = logNormal(rand, cfg.medianUsd, cfg.sigmaLn);
    if (cfg.routing === "mirror") {
      orders.push({ side, usd, pool: "V" }, { side, usd, pool: "S" });
      continue;
    }
    const pool: PoolLabel = cfg.routing === "split" ? (rand() < 0.5 ? "V" : "S") : cheaperPool(side, quotes);
    orders.push({ side, usd, pool });
  }
  return orders;
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd bots && bun test test/noise.test.ts && bun run typecheck`
Expected: ` 7 pass`, ` 0 fail`; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add bots/src/lib/noise.ts bots/test/noise.test.ts
git commit -m "feat(bots): retail order planning and routing"
```

---

### Task 13: viem clients and per-block reads

**Delegable:** yes
**Depends on:** Tasks 6, 7

**Files:**
- Create: `bots/src/lib/chain.ts`

This module only wires viem (one `multicall` per block through Multicall3, which viem's `sepolia` chain already knows); its correctness is checked by the typechecker here and against the chain in Task 23.

- [x] **Step 1: Implementation**

`bots/src/lib/chain.ts`:
```ts
// viem clients and the per-block reads shared by arb.ts, noise.ts and status.ts.
import {
  climHookAbi,
  ethUsdFromSqrtPriceX96,
  orientationOf,
  riskDeskAbi,
  stateViewAbi,
  testTokenAbi,
  type DeskState,
  type Deployments,
  type PairOrientation,
  type ResolvedPair,
} from "@clim/shared";
import { createPublicClient, createWalletClient, http, nonceManager, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { rpcUrl } from "./env";

export function publicClientFor(url: string = rpcUrl()) {
  return createPublicClient({ chain: sepolia, transport: http(url) });
}
export type Client = ReturnType<typeof publicClientFor>;

/** nonceManager lets one process send several transactions per block without waiting for receipts. */
export function walletFor(privateKey: Hex, url: string = rpcUrl()) {
  return createWalletClient({ account: privateKeyToAccount(privateKey, { nonceManager }), chain: sepolia, transport: http(url) });
}
export type Wallet = ReturnType<typeof walletFor>;

export type PoolState = { sqrtPriceX96: bigint; tick: number; protocolFee: number; lpFee: number; ethUsd: number };
export type PairState = {
  blockNumber: bigint | undefined;
  V: PoolState;
  S: PoolState;
  hookFee: number;
  hookMode: number;
  desk: DeskState;
};

/** One multicall (Multicall3 on Sepolia): slot0 of V and S, hook quoteFee(), RiskDesk state(). */
export async function readPairState(client: Client, d: Deployments, p: ResolvedPair, blockNumber?: bigint): Promise<PairState> {
  const [v, s, q, st] = await client.multicall({
    allowFailure: false,
    blockNumber,
    contracts: [
      { address: d.uniswap.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [p.V.poolId] },
      { address: d.uniswap.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [p.S.poolId] },
      { address: p.hook, abi: climHookAbi, functionName: "quoteFee" },
      { address: p.desk, abi: riskDeskAbi, functionName: "state" },
    ],
  });
  const pool = (x: typeof v, o: PairOrientation): PoolState => ({
    sqrtPriceX96: x[0],
    tick: x[1],
    protocolFee: x[2],
    lpFee: x[3],
    ethUsd: ethUsdFromSqrtPriceX96(x[0], o),
  });
  return {
    blockNumber,
    V: pool(v, orientationOf(p.V, d)),
    S: pool(s, orientationOf(p.S, d)),
    hookFee: q[0],
    hookMode: q[1],
    desk: { tObs: st[0], sigmaE9: st[1], kE4: st[2], flags: st[3], seq: st[4] },
  };
}

/** Native ETH for gas, the pair's two test tokens, and their allowances to the router the bot swaps through. */
export type Balances = { native: bigint; ethToken: bigint; usdToken: bigint; ethAllowance: bigint; usdAllowance: bigint };

export async function readBalances(client: Client, p: ResolvedPair, owner: Address, router: Address, blockNumber?: bigint): Promise<Balances> {
  const [ethToken, usdToken, ethAllowance, usdAllowance] = await client.multicall({
    allowFailure: false,
    blockNumber,
    contracts: [
      { address: p.tETH.address, abi: testTokenAbi, functionName: "balanceOf", args: [owner] },
      { address: p.tUSD.address, abi: testTokenAbi, functionName: "balanceOf", args: [owner] },
      { address: p.tETH.address, abi: testTokenAbi, functionName: "allowance", args: [owner, router] },
      { address: p.tUSD.address, abi: testTokenAbi, functionName: "allowance", args: [owner, router] },
    ],
  });
  const native = await client.getBalance({ address: owner, blockNumber });
  return { native, ethToken, usdToken, ethAllowance, usdAllowance };
}
```

- [x] **Step 2: Typecheck**

Run: `cd bots && bun run typecheck`
Expected: `$ tsc --noEmit -p .` with no error (viem infers the multicall result tuple from the `as const` ABIs; a wrong output index fails here).

- [x] **Step 3: Commit**

```bash
git add bots/src/lib/chain.ts
git commit -m "feat(bots): viem clients and per-block pair reads"
```

---

### Task 14: Arbitrage bot

**Delegable:** yes
**Depends on:** Tasks 10, 11, 13

**Files:**
- Create: `bots/src/arb.ts`

Behaviour: on each new block (polled every 2 s; missed blocks are not replayed; a block that arrives while the previous one is still being handled is skipped), read V and S (`slot0`), the hook fee, the desk, the bot balances and the market price (live: median of the four venues; replay: the replay server's ticker); decide for each pool; outside the band, simulate then send an exact-input swap through `arbRouter(d)` (`routers.arb`, or the shared PoolSwapTest with a warning until plan 01 deploys it) spending up to the whole balance with the band-edge price limit (the swap stops at the limit). A pool with a pending arbitrage is skipped. `PriceLimitAlreadyExceeded` (0x7c9c6e8f) in simulation is logged as `stale`: another swap moved the pool after the read, and nothing was sent.

- [x] **Step 1: Implementation**

`bots/src/arb.ts`:
```ts
// Arbitrage bot: every new block, read both pools and the market price, and arbitrage each pool back to
// the edge of its no-arbitrage band (V: fee from ClimHook.quoteFee(), S: static fee from slot0.lpFee).
// It swaps through routers.arb (its own PoolSwapTest, so the app can tell arbitrage swaps by Swap.sender).
// Usage: bun src/arb.ts --pair live|replay        Log: bots/out/arb-<pair>.jsonl
import { arbRouter, loadDeployments, orientationOf, poolSwapTestAbi, resolvePair } from "@clim/shared";
import { join } from "node:path";
import { decideArb } from "./lib/arb";
import { publicClientFor, readBalances, readPairState, walletFor } from "./lib/chain";
import { botKey, envStr, pairArg } from "./lib/env";
import { appendJsonl, OUT_DIR, shortError } from "./lib/jsonl";
import { aggregate, fetchReplayPrice, fetchVenueQuotes } from "./lib/market";
import { swapArgs } from "./lib/swap";

const pair = pairArg();
const d = loadDeployments();
const p = resolvePair(d, pair);
const client = publicClientFor();
const wallet = walletFor(botKey("ARB", pair));
const me = wallet.account.address;
const router = arbRouter(d);
const logFile = join(OUT_DIR, `arb-${pair}.jsonl`);
const replayUrl = envStr("REPLAY_URL", "http://127.0.0.1:8787");

async function marketPrice(): Promise<{ price: number; n: number } | null> {
  if (pair === "replay") return { price: await fetchReplayPrice(replayUrl), n: 1 };
  return aggregate(await fetchVenueQuotes());
}

// A pool with an arbitrage tx still pending is skipped: trading it again on the same stale state would
// revert (PriceLimitAlreadyExceeded) or overshoot.
const inflight = new Set<"V" | "S">();

async function onBlock(blockNumber: bigint): Promise<void> {
  const [m, s, bal] = await Promise.all([marketPrice(), readPairState(client, d, p, blockNumber), readBalances(client, p, me, router, blockNumber)]);
  if (!m) {
    appendJsonl(logFile, { ts: new Date().toISOString(), block: blockNumber, action: "skip", reason: "fewer than 3 venues" });
    console.log(`[arb ${pair}] block ${blockNumber}: skip (fewer than 3 venues)`);
    return;
  }
  for (const label of ["V", "S"] as const) {
    const pool = p[label];
    const feePips = label === "V" ? s.hookFee : s.S.lpFee;
    const dec = decideArb({ sqrtPriceX96: s[label].sqrtPriceX96, marketEthUsd: m.price, feePips, orientation: orientationOf(pool, d) });
    const base = {
      ts: new Date().toISOString(),
      block: blockNumber,
      pool: label,
      market: m.price,
      nVenues: m.n,
      poolEthUsd: dec.poolEthUsd,
      feePips,
      hookMode: s.hookMode,
      logGapBp: dec.logGap * 1e4,
      bandBp: dec.bandLog * 1e4,
    };
    const gap = `${label} pool ${dec.poolEthUsd.toFixed(2)} vs ${m.price.toFixed(2)} gap ${(dec.logGap * 1e4).toFixed(1)}bp band ${(dec.bandLog * 1e4).toFixed(1)}bp`;
    if (dec.action === "none") {
      appendJsonl(logFile, { ...base, action: "none" });
      console.log(`[arb ${pair}] block ${blockNumber} ${gap} -> none`);
      continue;
    }
    if (inflight.has(label)) {
      appendJsonl(logFile, { ...base, action: "skip", reason: "previous arbitrage pending" });
      continue;
    }
    const amountIn = dec.side === "buyEth" ? bal.usdToken : bal.ethToken;
    if (amountIn === 0n) {
      appendJsonl(logFile, { ...base, action: "skip", reason: `no ${dec.side === "buyEth" ? p.tUSD.symbol : p.tETH.symbol} balance` });
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
      inflight.add(label);
      appendJsonl(logFile, { ...base, action: dec.side, zeroForOne: dec.zeroForOne, targetEthUsd: dec.targetEthUsd, sqrtPriceLimitX96: dec.sqrtPriceLimitX96, txHash: hash });
      console.log(`[arb ${pair}] block ${blockNumber} ${gap} -> ${dec.side} tx ${hash}`);
      client
        .waitForTransactionReceipt({ hash })
        .then(
          (r) => appendJsonl(logFile, { ts: new Date().toISOString(), event: "receipt", pool: label, txHash: hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed }),
          (e: unknown) => appendJsonl(logFile, { ts: new Date().toISOString(), event: "receipt-error", pool: label, txHash: hash, error: shortError(e) }),
        )
        .finally(() => inflight.delete(label));
    } catch (e) {
      // PriceLimitAlreadyExceeded (0x7c9c6e8f) in simulation: another swap moved the pool since this block was read.
      const error = shortError(e);
      const action = /PriceLimitAlreadyExceeded|0x7c9c6e8f/.test(error) ? "stale" : "error";
      appendJsonl(logFile, { ...base, action, error });
      console.error(`[arb ${pair}] block ${blockNumber} ${gap} -> ${action}: ${error}`);
    }
  }
}

let busy = false;
console.log(`[arb ${pair}] ${me} watching Sepolia blocks; V=${p.V.poolId} S=${p.S.poolId} router ${router}`);
if (d.routers.arb === null) {
  console.warn(`[arb ${pair}] routers.arb is not deployed: arbitrage goes through the shared PoolSwapTest and the app cannot tell it from retail flow`);
}
client.watchBlockNumber({
  emitMissed: false,
  pollingInterval: 2_000,
  onBlockNumber: (blockNumber) => {
    if (busy) return; // still handling the previous block: skip rather than queue stale work
    busy = true;
    onBlock(blockNumber)
      .catch((e: unknown) => console.error(`[arb ${pair}] block ${blockNumber} failed: ${shortError(e)}`))
      .finally(() => {
        busy = false;
      });
  },
  onError: (e) => console.error(`[arb ${pair}] watch error: ${shortError(e)}`),
});
```

- [x] **Step 2: Typecheck and wiring check**

Run: `cd bots && bun run typecheck && bun run arb --pair live`
Expected: typecheck clean; then, before plan 01 has deployed, the bot stops at once with `error: pools.liveV is null: deploy it first (plan 01) and record it in shared/deployments/sepolia.json`. On-chain behaviour is checked in Task 23.

- [x] **Step 3: Commit**

```bash
git add bots/src/arb.ts
git commit -m "feat(bots): arbitrage bot"
```

---

### Task 15: Retail (noise) bot

**Delegable:** yes
**Depends on:** Tasks 12, 13

**Files:**
- Create: `bots/src/noise.ts`

- [x] **Step 1: Implementation**

`bots/src/noise.ts`:
```ts
// Retail (noise) bot: every new block, draw a Poisson number of small swaps (random side, log-normal USD size)
// and send each one to both pools (--routing mirror, default), to one at random (split) or to the cheaper one (cheapest).
// Usage: bun src/noise.ts --pair live|replay [--routing mirror|split|cheapest]      Log: bots/out/noise-<pair>.jsonl
import { loadDeployments, poolSwapTestAbi, resolvePair } from "@clim/shared";
import { join } from "node:path";
import { publicClientFor, readPairState, walletFor } from "./lib/chain";
import { argValue, botKey, envNum, pairArg } from "./lib/env";
import { appendJsonl, OUT_DIR, shortError } from "./lib/jsonl";
import { planBlockOrders, ROUTINGS, type NoiseConfig, type Routing } from "./lib/noise";
import { mulberry32 } from "./lib/rng";
import { inputAmountForUsd, noPriceLimit, swapArgs, zeroForOneFor } from "./lib/swap";

const pair = pairArg();
const routing = (argValue("--routing") ?? "mirror") as Routing;
if (!ROUTINGS.includes(routing)) throw new Error(`--routing must be one of ${ROUTINGS.join(", ")}, got ${routing}`);
const cfg: NoiseConfig = {
  ratePerBlock: envNum("NOISE_RATE_PER_BLOCK", 0.5),
  medianUsd: envNum("NOISE_MEDIAN_USD", 2_000),
  sigmaLn: envNum("NOISE_SIGMA_LN", 1),
  routing,
};
const seed = envNum("NOISE_SEED", 42);
const rand = mulberry32(seed);
const d = loadDeployments();
const p = resolvePair(d, pair);
const client = publicClientFor();
const wallet = walletFor(botKey("NOISE", pair));
const logFile = join(OUT_DIR, `noise-${pair}.jsonl`);

async function onBlock(blockNumber: bigint): Promise<void> {
  const s = await readPairState(client, d, p, blockNumber);
  const quotes = { V: { ethUsd: s.V.ethUsd, feePips: s.hookFee }, S: { ethUsd: s.S.ethUsd, feePips: s.S.lpFee } };
  for (const order of planBlockOrders(rand, cfg, quotes)) {
    const pool = p[order.pool];
    const zeroForOne = zeroForOneFor(order.side, pool.token0IsEth);
    const amountIn = inputAmountForUsd(order.side, order.usd, quotes[order.pool].ethUsd, p.tETH.decimals, p.tUSD.decimals);
    const base = { ts: new Date().toISOString(), block: blockNumber, pool: order.pool, side: order.side, usd: order.usd, feePips: quotes[order.pool].feePips, routing };
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
      console.log(`[noise ${pair}] block ${blockNumber} ${order.side} $${order.usd.toFixed(0)} on ${order.pool} (fee ${quotes[order.pool].feePips} pips) tx ${hash}`);
    } catch (e) {
      appendJsonl(logFile, { ...base, error: shortError(e) });
      console.error(`[noise ${pair}] block ${blockNumber} ${order.pool} error: ${shortError(e)}`);
    }
  }
}

let busy = false;
console.log(`[noise ${pair}] ${wallet.account.address} rate ${cfg.ratePerBlock}/block median $${cfg.medianUsd} routing ${routing} seed ${seed}`);
client.watchBlockNumber({
  emitMissed: false,
  pollingInterval: 2_000,
  onBlockNumber: (blockNumber) => {
    if (busy) return;
    busy = true;
    onBlock(blockNumber)
      .catch((e: unknown) => console.error(`[noise ${pair}] block ${blockNumber} failed: ${shortError(e)}`))
      .finally(() => {
        busy = false;
      });
  },
  onError: (e) => console.error(`[noise ${pair}] watch error: ${shortError(e)}`),
});
```

- [x] **Step 2: Typecheck and wiring check**

Run: `cd bots && bun run typecheck && bun run noise --pair live`
Expected: typecheck clean; before plan 01 has deployed: `error: pools.liveV is null: deploy it first (plan 01) and record it in shared/deployments/sepolia.json`. `bun run noise --pair live --routing best` must fail with `error: --routing must be one of mirror, split, cheapest, got best`.

- [x] **Step 3: Commit**

```bash
git add bots/src/noise.ts
git commit -m "feat(bots): retail noise bot"
```

---

### Task 16: Reading plan 02's simulation loop output

**Delegable:** yes
**Depends on:** Task 7

**Files:**
- Create: `bots/src/lib/simParse.ts`
- Test: `bots/test/simParse.test.ts`

- [x] **Step 1: Write the failing test**

`bots/test/simParse.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { loopCommand, outcomeOf, receiptStatus, RunTracker, type RunResult } from "../src/lib/simParse";

const TX = "0x1013abc0b6f345fad15b19a56cabbbaab2a2aa94f81eb3a709058adf18a4f23f";

// Lines as printed by plan 02's cre/scripts/sim-loop.sh: "=== <UTC time>" before each run, then the workflow's
// [USER LOG] lines, any line containing "rror" and the CLI's failure lines marked "✗" (the script greps "USER LOG|rror|✗").
const APPLIED = `2026-10-07T03:00:09Z [USER LOG] REPORT applied seq=12 sigmaReported=33.4% sigmaApplied=33.4% flags=0 tx=${TX}`;

describe("outcomeOf: one workflow log line -> run outcome", () => {
  test("report outcomes carry the tx hash", () => {
    expect(outcomeOf(APPLIED)).toEqual({ status: "applied", txHash: TX, detail: APPLIED.trim() });
    expect(outcomeOf(`[USER LOG] REPORT sent, desk state unreadable after tx=${TX}`)?.status).toBe("sent");
    expect(outcomeOf(`[USER LOG] NOT APPLIED: RiskDesk state unchanged at the latest block after tx=${TX} (rejected inside the forwarder)`)?.status).toBe("not-applied");
    expect(outcomeOf(`[USER LOG] REJECTED by RiskDesk (onReport reverted) tx=${TX}`)).toMatchObject({ status: "rejected", txHash: TX });
  });
  test("the CRE template line printed before the final line is not an outcome", () => {
    expect(outcomeOf(`[USER LOG] Write report transaction succeeded: ${TX}`)).toBeNull();
  });
  test("skips and dry runs have no tx", () => {
    expect(outcomeOf("[USER LOG] clim: no report (quorum 2/4 < 3)")).toMatchObject({ status: "no-report", txHash: null });
    expect(outcomeOf("[USER LOG] DRY RUN: report encoded and simulated, not broadcast (sigmaE9=59492)")).toMatchObject({ status: "dry-run", txHash: null });
  });
  test("other lines are not outcomes", () => {
    expect(outcomeOf("[USER LOG] consensus: sigma=33.4%/yr sigmaE9=59492 n=4 disp=2bp")).toBeNull();
    expect(outcomeOf("[USER LOG] desk before: seq=11 tObs=1791342000 sigma=33.1%/yr flags=0")).toBeNull();
  });
});

describe("RunTracker: stream of loop lines -> one result per run", () => {
  function feed(lines: string[]): RunResult[] {
    const t = new RunTracker();
    const out: RunResult[] = [];
    for (const l of lines) {
      const r = t.push(l);
      if (r) out.push(r);
    }
    const last = t.flush();
    if (last) out.push(last);
    return out;
  }
  test("ignores the build output before the first run", () => {
    expect(feed(["Workflow compiled", "target=staging-settings broadcast=--broadcast interval=30s log=logs/x.log"])).toEqual([]);
  });
  test("one outcome per run, stamped with the run start", () => {
    const r = feed(["=== 2026-10-07T03:00:00Z", "[USER LOG] consensus: ...", APPLIED, "=== 2026-10-07T03:00:30Z", "[USER LOG] clim: no report (10 s since the last report < 20 s)"]);
    expect(r.map((x) => [x.startedAt, x.status, x.txHash])).toEqual([
      ["2026-10-07T03:00:00Z", "applied", TX],
      ["2026-10-07T03:00:30Z", "no-report", null],
    ]);
    expect(r[0]?.lines).toEqual(["=== 2026-10-07T03:00:00Z", "[USER LOG] consensus: ...", APPLIED]);
  });
  test("plan 02's order: the run ends on REPORT applied, after the CRE template line", () => {
    const r = feed(["=== 2026-10-07T03:00:00Z", `[USER LOG] Write report transaction succeeded: ${TX}`, APPLIED]);
    expect(r.map((x) => [x.status, x.txHash, x.lines.length])).toEqual([["applied", TX, 3]]);
  });
  test("a run with only errors is an error, a silent run is no-outcome", () => {
    const r = feed(["=== 2026-10-07T03:00:00Z", "Error: writeReport failed: status=1", "=== 2026-10-07T03:00:30Z", "=== 2026-10-07T03:01:00Z", APPLIED]);
    expect(r.map((x) => x.status)).toEqual(["error", "no-outcome", "applied"]);
    expect(r[0]?.detail).toBe("Error: writeReport failed: status=1");
  });
  test("a run that lost its final line keeps the tx of the CRE template line, for the receipt check", () => {
    const sent = `2026-10-06T17:18:03Z [USER LOG] Write report transaction succeeded: ${TX}`;
    const r = feed(["=== 2026-10-06T17:17:44Z", "[USER LOG] desk before: seq=66 tObs=1791307040 sigma=23.9%/yr flags=0", sent, "=== 2026-10-06T17:18:14Z", APPLIED]);
    expect(r.map((x) => [x.status, x.txHash, x.detail])).toEqual([
      ["no-outcome", TX, sent],
      ["applied", TX, APPLIED],
    ]);
  });
  test("a CRE CLI credential failure is an error that says so", () => {
    const r = feed([
      "=== 2026-10-06T17:03:12Z",
      "✗ Credential validation failed",
      "✗ authentication required: credential validation failed: authentication failed: unable to retrieve organization info. Your account may not be fully set up yet — please try again in a few minutes",
    ]);
    expect(r.map((x) => [x.status, x.txHash, x.detail])).toEqual([["error", null, "CRE CLI credential validation failed"]]);
  });
  test("any other CRE CLI failure line (marked ✗) is an error", () => {
    const failed = '✗ workflow execution failed: [2]Unknown: Post "https://ethereum-sepolia-rpc.publicnode.com": read tcp: can\'t assign requested address';
    const r = feed(["=== 2026-10-06T18:23:08Z", "[USER LOG] desk before: seq=159 tObs=1791310961 sigma=73.0%/yr flags=2", failed]);
    expect(r.map((x) => [x.status, x.detail])).toEqual([["error", failed]]);
  });
  test("a run that printed nothing says so", () => {
    expect(feed(["=== 2026-10-06T17:03:12Z"]).map((x) => [x.status, x.txHash, x.detail])).toEqual([["no-outcome", null, "no output"]]);
  });
});

describe("receiptStatus: the receipt is the ground truth for a run with a tx", () => {
  test("forwarder result true and a desk RiskReported mean applied, whatever the workflow printed", () => {
    expect(receiptStatus("not-applied", true, true)).toBe("applied");
    expect(receiptStatus("no-outcome", true, true)).toBe("applied");
    expect(receiptStatus("sent", true, true)).toBe("applied");
    expect(receiptStatus("applied", true, true)).toBe("applied");
  });
  test("never applied without both receipt facts", () => {
    expect(receiptStatus("not-applied", false, false)).toBe("not-applied");
    expect(receiptStatus("not-applied", true, false)).toBe("not-applied");
    expect(receiptStatus("no-outcome", null, true)).toBe("no-outcome");
    expect(receiptStatus("rejected", false, false)).toBe("rejected");
  });
});

describe("loop command", () => {
  test("delegates the loop to plan 02's script, always broadcasting", () => {
    expect(loopCommand("staging-settings")).toEqual(["bash", "scripts/sim-loop.sh", "staging-settings", "--broadcast"]);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd bots && bun test test/simParse.test.ts`
Expected: `error: Cannot find module '../src/lib/simParse'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`bots/src/lib/simParse.ts`:
```ts
// Pure helpers for sim-loop.ts, which runs plan 02's cre/scripts/sim-loop.sh and records every run.
// That script prints "=== <UTC time>" before each `cre workflow simulate` run and echoes the workflow's
// [USER LOG] lines plus any line containing "rror" or the CLI's failure mark "✗". The workflow (plan 02, workflow.ts)
// ends each run with one of:
//   REPORT applied ... tx=0x..    REPORT sent, desk state unreadable after tx=0x..    NOT APPLIED: ... tx=0x..
//   REJECTED by RiskDesk (onReport reverted) tx=0x..    clim: no report (<reason>)    DRY RUN: ...
// "Write report transaction succeeded: 0x.." (the CRE template wording) comes BEFORE the final line, so it is not
// an outcome: the run stays open and its transcript keeps both lines. The simulator sometimes loses the final line
// when it shuts down, so a run without one keeps that line's tx for the receipt check (sim-loop.ts, receiptStatus).
import type { Hex } from "viem";

export type RunStatus = "applied" | "sent" | "not-applied" | "rejected" | "no-report" | "dry-run" | "error" | "no-outcome";
/** One run of the loop; `lines` is its transcript (from its "===" line), kept for the evidence files of plan 06. */
export type RunResult = { startedAt: string | null; status: RunStatus; txHash: Hex | null; detail: string | null; lines: string[] };

const HASH = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const SENT = /Write report transaction succeeded/;
const CLI_FAILED = /^\s*✗/;
const CREDENTIALS = /credential validation failed/i;
const RULES: Array<[RegExp, RunStatus]> = [
  [/REPORT applied/, "applied"],
  [/REPORT sent/, "sent"],
  [/NOT APPLIED/, "not-applied"],
  [/REJECTED by RiskDesk/, "rejected"],
  [/clim: no report/, "no-report"],
  [/DRY RUN/, "dry-run"],
];

export function outcomeOf(line: string): { status: RunStatus; txHash: Hex | null; detail: string } | null {
  for (const [re, status] of RULES) {
    if (re.test(line)) {
      const m = HASH.exec(line);
      return { status, txHash: m ? (m[0].toLowerCase() as Hex) : null, detail: line.trim() };
    }
  }
  return null;
}

/**
 * The receipt is the ground truth for a run with a tx: the forwarder's ReportProcessed.result true AND a RiskReported
 * from the desk in that tx mean the report was applied, whatever the workflow printed (its read-back of
 * RiskDesk.state() at `latest` can hit a lagging RPC node and print NOT APPLIED; its final line can be lost).
 * Any other receipt keeps the workflow's status: never `applied` without both facts.
 */
export function receiptStatus(parsed: RunStatus, forwarderResult: boolean | null, deskReported: boolean): RunStatus {
  return forwarderResult === true && deskReported ? "applied" : parsed;
}

/** Turns the loop's output stream into one RunResult per run. */
export class RunTracker {
  private startedAt: string | null = null;
  private open = false;
  private firstError: string | null = null;
  private sent: { txHash: Hex; line: string } | null = null;
  private lines: string[] = [];

  /** Feed one line; returns a finished run when this line completes one. */
  push(line: string): RunResult | null {
    const start = /^=== (\S+)/.exec(line);
    if (start) {
      const previous = this.flush();
      this.startedAt = start[1] ?? null;
      this.open = true;
      this.firstError = null;
      this.sent = null;
      this.lines = [line];
      return previous;
    }
    if (!this.open) return null;
    this.lines.push(line);
    const o = outcomeOf(line);
    if (o) {
      this.open = false;
      return { startedAt: this.startedAt, ...o, lines: this.lines };
    }
    const m = SENT.test(line) ? HASH.exec(line) : null;
    if (this.sent === null && m) this.sent = { txHash: m[0].toLowerCase() as Hex, line: line.trim() };
    if (this.firstError === null && (/error/i.test(line) || CLI_FAILED.test(line))) this.firstError = line.trim();
    return null;
  }

  /**
   * Closes the current run (no outcome line seen): an error if an error or CLI failure line was seen, else no-outcome.
   * It keeps the tx of the CRE template line, if any, for the receipt check.
   */
  flush(): RunResult | null {
    if (!this.open) return null;
    this.open = false;
    const detail = this.lines.some((l) => CREDENTIALS.test(l))
      ? "CRE CLI credential validation failed"
      : (this.firstError ?? this.sent?.line ?? (this.lines.length === 1 ? "no output" : null));
    return { startedAt: this.startedAt, status: this.firstError ? "error" : "no-outcome", txHash: this.sent?.txHash ?? null, detail, lines: this.lines };
  }
}

/** Plan 02's loop (build the WASM once, then `simulate --wasm` every 30 s), run from cre/. */
export function loopCommand(target: string): string[] {
  return ["bash", "scripts/sim-loop.sh", target, "--broadcast"];
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd bots && bun test test/simParse.test.ts`
Expected: ` 15 pass`, ` 0 fail`.

- [x] **Step 5: Commit**

```bash
git add bots/src/lib/simParse.ts bots/test/simParse.test.ts
git commit -m "feat(bots): per-run outcomes from the CRE simulation loop output"
```

---

### Task 17: CRE simulation loop with an on-chain record of every run

**Delegable:** yes
**Depends on:** Tasks 13, 16; plan 02 Task 9 (`cre/scripts/sim-loop.sh`)

**Files:**
- Create: `bots/src/sim-loop.ts`
- Modify: `docs/feedback/cre-friction-log.md`, today's session log

Behaviour (`bun run cre-loop`): start plan 02's `bash scripts/sim-loop.sh <target> --broadcast` in `cre/` (target `staging-settings` for `--pair live`, `replay-settings` for `--pair replay`, or `--target`), echo its output, cut it into runs with `RunTracker`, write each run's transcript to `bots/out/cre-sim/<pair>-<run start>.log`, and append one JSON line per run to `bots/out/cre-runs.jsonl`: `status` (`applied`, `sent`, `not-applied`, `rejected`, `no-report`, `dry-run`, `error`, `no-outcome`), `detail`, and for runs with a transaction the receipt (`txStatus`, `blockNumber`, `gasUsed`, `from`), the MockKeystoneForwarder `ReportProcessed.result` (`forwarderResult`) and the decoded `RiskReported` fields. The receipt is the ground truth: `forwarderResult` true and a `RiskReported` from the desk make the run `applied` whatever the workflow printed (its read-back of `RiskDesk.state()` at `latest` can hit a lagging RPC node, and the simulator can lose its final line), with `statusFromReceipt: true` when that overrides the workflow's line; never `applied` without both facts. A CRE CLI credential failure is recorded as `error` with `detail` `CRE CLI credential validation failed`, a run that printed nothing as `no-outcome` with `detail` `no output`. `--once` stops after the first run. Ctrl-C stops the loop too.

- [x] **Step 1: Implementation**

`bots/src/sim-loop.ts`:
```ts
// CRE simulation loop with an on-chain record of every run.
// Runs plan 02's loop (`cre/scripts/sim-loop.sh <target> --broadcast`: build the WASM once, then
// `cre workflow simulate --wasm ... --non-interactive --trigger-index 0 --broadcast` every 30 s) and echoes its output.
// For each run it writes the transcript to bots/out/cre-sim/<pair>-<run start>.log (plan 06 evidence input) and appends one
// line to bots/out/cre-runs.jsonl: status, tx hash, receipt, the forwarder's ReportProcessed.result and the decoded
// RiskReported event. The receipt decides `applied` (receiptStatus); statusFromReceipt says when it overrode the
// workflow's final line, which stays in `detail`.
// Usage: bun src/sim-loop.ts --pair live|replay [--target <cre target>] [--once]
import { loadDeployments, mockForwarderAbi, requireValue, riskDeskAbi } from "@clim/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { publicClientFor } from "./lib/chain";
import { argValue, envStr, hasFlag, pairArg } from "./lib/env";
import { appendJsonl, OUT_DIR, shortError } from "./lib/jsonl";
import { loopCommand, receiptStatus, RunTracker, type RunResult } from "./lib/simParse";

const pair = pairArg();
const DEFAULT_TARGET = { live: "staging-settings", replay: "replay-settings" } as const;
const target = argValue("--target") ?? DEFAULT_TARGET[pair];
const once = hasFlag("--once");
const creDir = envStr("CRE_PROJECT_DIR", join(import.meta.dir, "..", "..", "cre"));
const d = loadDeployments();
const desk = requireValue(d.riskDesks[pair], `riskDesks.${pair}`);
const client = publicClientFor();
const runsFile = join(OUT_DIR, "cre-runs.jsonl");
const transcriptDir = join(OUT_DIR, "cre-sim");
mkdirSync(transcriptDir, { recursive: true });

async function record(run: RunResult): Promise<void> {
  const { lines, ...result } = run;
  const transcript = `${pair}-${(run.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-")}.log`;
  writeFileSync(join(transcriptDir, transcript), `${lines.join("\n")}\n`);
  const base = { ts: new Date().toISOString(), pair, target, ...result, transcript: `cre-sim/${transcript}` };
  if (!run.txHash) {
    appendJsonl(runsFile, base);
    console.log(`[sim-loop ${pair}] run ${run.startedAt}: ${run.status}${run.detail ? ` (${run.detail})` : ""}`);
    return;
  }
  try {
    const r = await client.waitForTransactionReceipt({ hash: run.txHash, timeout: 180_000 });
    const reported = parseEventLogs({ abi: riskDeskAbi, eventName: "RiskReported", logs: r.logs }).filter((l) => l.address.toLowerCase() === desk.toLowerCase());
    const processed = parseEventLogs({ abi: mockForwarderAbi, eventName: "ReportProcessed", logs: r.logs });
    const ev = reported[0]?.args;
    const forwarderResult = processed[0]?.args.result ?? null;
    const status = receiptStatus(run.status, forwarderResult, reported.length > 0);
    const rec = {
      ...base,
      status,
      statusFromReceipt: status !== run.status,
      txStatus: r.status,
      blockNumber: r.blockNumber,
      gasUsed: r.gasUsed,
      from: r.from,
      forwarderResult,
      seq: ev?.seq ?? null,
      tObs: ev?.tObs ?? null,
      sigmaApplied: ev?.sigmaApplied ?? null,
      sigmaReported: ev?.sigmaReported ?? null,
      nSources: ev?.nSources ?? null,
      dispBp: ev?.dispBp ?? null,
      kE4: ev?.kE4 ?? null,
    };
    appendJsonl(runsFile, rec);
    const why = rec.statusFromReceipt ? ` (from the receipt; workflow: ${run.status})` : "";
    console.log(`[sim-loop ${pair}] run ${run.startedAt}: ${status}${why} tx ${run.txHash} block ${r.blockNumber} seq ${rec.seq} sigmaApplied ${rec.sigmaApplied} forwarderResult ${forwarderResult}`);
  } catch (e) {
    appendJsonl(runsFile, { ...base, receiptError: shortError(e) });
    console.error(`[sim-loop ${pair}] run ${run.startedAt}: tx ${run.txHash} receipt error: ${shortError(e)}`);
  }
}

const cmd = loopCommand(target);
console.log(`[sim-loop ${pair}] ${cmd.join(" ")} (cwd ${creDir}), recording to ${runsFile}`);
const proc = Bun.spawn(cmd, { cwd: creDir, stdout: "pipe", stderr: "inherit", env: process.env });
process.on("SIGINT", () => {
  proc.kill();
  process.exit(130);
});

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
console.error(`[sim-loop ${pair}] loop exited with code ${code}`);
process.exit(code === 0 ? 0 : 1);
```

- [x] **Step 2: Typecheck and wiring check**

Run: `cd bots && bun run typecheck && bun run cre-loop --pair live --once`
Expected: typecheck clean; before plan 01 has deployed: `error: riskDesks.live is null: deploy it first (plan 01) and record it in shared/deployments/sepolia.json`. The real run is in Task 23.

- [x] **Step 3: Record what the research verified**

In `docs/feedback/cre-friction-log.md`, in the row that starts with `| 1 |`, set the last cell to the following text if it still reads `design phase, to confirm`; if plan 01 Task 6 already wrote a status there, append `; ` and this text to it instead:
`confirmed on Sepolia: simulate --broadcast sends report() from the CRE_ETH_PRIVATE_KEY account straight to the mock (our first report, tx 0x6046552302b7711c4987ee7706d957538dc11ee77ca557b18c92261154e21cb6, from our operator key 0x53aB240f6cffC204FC22ac6722D9632d753a5A82 to the mock), so a tx.origin guard works; bots/src/scripts/forge-report.ts demonstrates the guard on our desk`

Append under `## Build notes` in today's session log:

```markdown
- (ops) Spec Appendix B, question 1: yes. `cre workflow simulate --broadcast` sends `report()` from the `CRE_ETH_PRIVATE_KEY` account directly to MockKeystoneForwarder (clim's first report, Sepolia tx 0x6046552302b7711c4987ee7706d957538dc11ee77ca557b18c92261154e21cb6, from our operator key 0x53aB240f6cffC204FC22ac6722D9632d753a5A82), so `tx.origin` is the operator. The same tx shows the simulation metadata placeholders (workflowCid 0x11...11, owner 0xaa...aa, header timestamp 100): keep RiskDesk's workflow-identity checks off in simulation.
- (ops) `bun run cre-loop` (`bots/src/sim-loop.ts`) runs plan 02's `cre/scripts/sim-loop.sh`, records each run (receipt, `ReportProcessed.result`, decoded `RiskReported`) in `bots/out/cre-runs.jsonl` and writes one transcript per run to `bots/out/cre-sim/` for plan 06's evidence collector.
```

Correction (2026-10-07): when this step ran, both texts cited tx `0xe57a006e7585984137cb5064d6be6fc7b9353194760178b85a78274c8785fa2c`, which is another project's transaction (sender `0x7277EDa336023Fe93142153a5bba4C770C1E6689`, mined at block 11,855,382, before clim's deploy block 11,856,974; checked with `cast tx`). Friction log row 1 and spec Appendix B now cite clim's first report as above; the 2026-10-06 session log keeps the old line, corrected in the 2026-10-07 log.

- [x] **Step 4: Commit**

```bash
git add bots/src/sim-loop.ts docs/feedback/cre-friction-log.md docs/sessions/
git commit -m "feat(bots): CRE loop runner that records every run on-chain"
```

---

### Task 18: Replay window, clock and endpoints

**Delegable:** yes
**Depends on:** Task 7

**Files:**
- Create: `bots/src/replay/klines.ts`
- Test: `bots/test/replay.test.ts`

- [x] **Step 1: Write the failing test**

`bots/test/replay.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { buildSnapshot, handleReplayRequest, makeClock, parseReplayWindow, type ReplayWindow, type Snapshot } from "../src/replay/klines";

// 30 minutes of synthetic 1 s closes: 2000.0, 2000.5, 2001.0, ... (monotonic, so open/low = first, high/close = last).
const START = 1_770_204_600; // 2026-02-04 11:30:00 UTC
const WARMUP = 1_260;
const W: ReplayWindow = parseReplayWindow({
  symbol: "ETHUSDT",
  source: "synthetic test window",
  startTs: START,
  stepSec: 1,
  warmupSec: WARMUP,
  closes: Array.from({ length: 1_800 }, (_, i) => 2_000 + i * 0.5),
});
const ANCHOR = 1_791_281_760; // wall-clock minute at which the replay main part (START + WARMUP) starts
const clock = makeClock(W, ANCHOR);

function get(path: string, wallSec: number) {
  return handleReplayRequest(W, clock, new URL(`http://127.0.0.1:8787${path}`), wallSec * 1000);
}
type K = [number, string, string, string, string, string, number, string, number, string, string, string];

describe("replay window validation", () => {
  const ok = { symbol: "ETHUSDT", source: "x", startTs: START, stepSec: 1, warmupSec: WARMUP, closes: Array(1_800).fill(1) };
  test("accepts a well-formed window", () => {
    expect(parseReplayWindow(ok).closes.length).toBe(1_800);
  });
  test("rejects windows off the minute grid, partial minutes, short warm-up or bad prices", () => {
    expect(() => parseReplayWindow({ ...ok, startTs: START + 1 })).toThrow(/minute/);
    expect(() => parseReplayWindow({ ...ok, closes: Array(1_801).fill(1) })).toThrow(/whole minutes/);
    expect(() => parseReplayWindow({ ...ok, warmupSec: 1_200 })).toThrow(/warmupSec/);
    expect(() => parseReplayWindow({ ...ok, closes: [...Array(1_799).fill(1), 0] })).toThrow(/positive/);
  });
});

describe("clock", () => {
  test("the anchor minute maps to the main start, then the replay runs at 1x", () => {
    expect((get("/status", ANCHOR).body as { histNow: number }).histNow).toBe(START + WARMUP);
    expect((get("/status", ANCHOR + 42).body as { histNow: number }).histNow).toBe(START + WARMUP + 42);
  });
});

describe("GET /snapshot (diagnostic)", () => {
  test("four identical venues of closed 1-minute candles in virtual time", () => {
    const s = get("/snapshot", ANCHOR + 75).body as Snapshot;
    expect(s.nowSec).toBe(START + WARMUP + 75);
    expect(s.usdtUsd).toBe(1);
    expect(s.dvol).toBeNull();
    expect(s.venues.map((v) => v.venue)).toEqual(["binance-replay-1", "binance-replay-2", "binance-replay-3", "binance-replay-4"]);
    const c = s.venues[0]?.candles ?? [];
    expect(c.length).toBe(22); // minutes 0..21 are closed at START + 1335
    expect(c[0]).toEqual([START, 2_029.5]);
    expect(c[21]).toEqual([START + 1_260, 2_659.5]);
    expect(s.venues.every((v) => v.quote === "USDT" && v.candles === c)).toBe(true);
  });
  test("covers [nowSec - 1200, nowSec - 65] from the first report", () => {
    const s = get("/snapshot", ANCHOR).body as Snapshot;
    const c = s.venues[0]?.candles ?? [];
    expect((c[0] as [number, number])[0]).toBeLessThanOrEqual(s.nowSec - 1_200);
    expect((c[c.length - 1] as [number, number])[0] + 60).toBeGreaterThanOrEqual(s.nowSec - 65);
  });
  test("keeps the last 25 minutes and freezes after the end of the window", () => {
    const s = buildSnapshot(W, START + 2_260);
    const c = s.venues[0]?.candles ?? [];
    expect(s.nowSec).toBe(START + 2_260);
    expect(c.length).toBe(25);
    expect(c[24]).toEqual([START + 1_740, 2_899.5]);
  });
});

describe("GET /api/v3/klines (Binance format, virtual time)", () => {
  test("at the anchor: 21 closed warm-up candles plus the open current candle", () => {
    const r = get("/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=500", ANCHOR);
    expect(r.status).toBe(200);
    const k = r.body as K[];
    expect(k.length).toBe(22);
    const first = k[0] as K;
    expect(first[0]).toBe(START * 1000);
    expect(first.slice(1, 5)).toEqual(["2000.00000000", "2029.50000000", "2000.00000000", "2029.50000000"]);
    expect(first[6]).toBe(START * 1000 + 59_999);
    const last = k[21] as K;
    expect(last[0]).toBe((START + WARMUP) * 1000);
    expect(last[4]).toBe("2630.00000000");
  });
  test("limit returns the most recent candles; startTime returns from that minute forward", () => {
    expect((get("/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=2", ANCHOR).body as K[]).map((x) => x[0])).toEqual([
      (START + WARMUP - 60) * 1000,
      (START + WARMUP) * 1000,
    ]);
    const t3 = (START + 180) * 1000;
    expect((get(`/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=2&startTime=${t3}`, ANCHOR).body as K[]).map((x) => x[0])).toEqual([t3, t3 + 60_000]);
  });
  test("errors use Binance codes", () => {
    expect(get("/api/v3/klines?symbol=ETHUSDT&interval=5m", ANCHOR)).toEqual({ status: 400, body: { code: -1120, msg: "Invalid interval." } });
    expect(get("/api/v3/klines?symbol=BTCUSDT&interval=1m", ANCHOR)).toEqual({ status: 400, body: { code: -1121, msg: "Invalid symbol." } });
    expect(get("/nope", ANCHOR).status).toBe(404);
  });
});

describe("GET /venue/<name>/api/v3/klines (plan 02 replay mode, wall-clock time)", () => {
  test("the same candles as /api/v3/klines, open and close times shifted to the wall clock", () => {
    const hist = get("/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20", ANCHOR + 75).body as K[];
    const wall = get("/venue/kraken/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20", ANCHOR + 75).body as K[];
    expect(wall.length).toBe(20);
    expect(wall.map((k) => k.slice(1, 6))).toEqual(hist.map((k) => k.slice(1, 6)));
    expect(wall[19]?.[0]).toBe((ANCHOR + 60) * 1000); // the wall-clock minute in progress
    expect(wall[19]?.[6]).toBe((ANCHOR + 60) * 1000 + 59_999);
    expect(get("/venue/binance/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20", ANCHOR + 75).body).toEqual(wall);
  });
});

describe("GET /api/v3/ticker/price and /status", () => {
  test("ticker is the 1 s close at the replay time", () => {
    expect(get("/api/v3/ticker/price?symbol=ETHUSDT", ANCHOR + 30).body).toEqual({ symbol: "ETHUSDT", price: "2645.00000000" });
  });
  test("after the end the price freezes and status says done", () => {
    expect(get("/api/v3/ticker/price?symbol=ETHUSDT", ANCHOR + 1_000).body).toEqual({ symbol: "ETHUSDT", price: "2899.50000000" });
    const s = get("/status", ANCHOR + 1_000).body as { done: boolean; progress: number };
    expect(s.done).toBe(true);
    expect(s.progress).toBe(1);
  });
  test("before the window starts the server answers 503", () => {
    expect(get("/api/v3/ticker/price?symbol=ETHUSDT", ANCHOR - WARMUP - 1).status).toBe(503);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `cd bots && bun test test/replay.test.ts`
Expected: `error: Cannot find module '../src/replay/klines'`, ` 1 fail`.

- [x] **Step 3: Minimal implementation**

`bots/src/replay/klines.ts`:
```ts
// Replay of a historical 1 s price window at 1x real time.
// Clock: the replay "main start" (startTs + warmupSec) is mapped to a wall-clock minute (the anchor); from then on
// the virtual time advances with the wall clock: histNow = floor(nowWall) - offsetSec, offsetSec = anchor - mainStart.
// Everything is served in virtual (historical) time, except the per-venue klines that the CRE workflow reads: those
// are shifted to the wall clock, because the workflow judges candle freshness against DON time.
// Endpoints (handleReplayRequest):
//   GET /venue/<name>/api/v3/klines  plan 02 replay mode: Binance 1m klines, open/close times shifted to the wall clock
//   GET /snapshot                    diagnostic: {nowSec, usdtUsd, dvol, venues: [{venue, quote, candles: [[openTimeSec, close]]}]}
//   GET /api/v3/klines               Binance 1m klines (symbol, interval=1m, limit, startTime, endTime in historical ms)
//   GET /api/v3/ticker/price         Binance ticker, the 1 s close at the replay time (the replay arbitrageur's market price)
//   GET /status                      progress of the replay

export type ReplayWindow = {
  symbol: string;
  source: string;
  startTs: number; // unix seconds of closes[0], multiple of 60
  stepSec: 1;
  warmupSec: number; // multiple of 60, >= MIN_WARMUP_SEC
  closes: number[]; // one close per second, length multiple of 60
};

export type ReplayClock = { offsetSec: number; mainStartHist: number };

/** Binance kline: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBase, takerQuote, ignore]. */
export type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

export type SnapshotVenue = { venue: string; quote: "USD" | "USDT"; candles: Array<[number, number]> };
export type Snapshot = { nowSec: number; usdtUsd: number | null; dvol: number | null; venues: SnapshotVenue[] };

export type HandlerResult = { status: number; body: unknown };

/** The CRE estimator needs 16 closed 1-minute candles (RV15) plus its freshness margin: 21 minutes of warm-up. */
export const MIN_WARMUP_SEC = 1260;
/** Closed candles per venue in /snapshot. */
export const SNAPSHOT_MINUTES = 25;
/** The window is one Binance series; it is served as several identical venues so the desk quorum (>= 3) is met.
 *  The names say so, the replay desk carries the REPLAY flag, and dispersion is 0 by construction. */
export const DEFAULT_SNAPSHOT_VENUES = ["binance-replay-1", "binance-replay-2", "binance-replay-3", "binance-replay-4"];
const MAX_LIMIT = 1_000;
const DEFAULT_LIMIT = 500;

export function parseReplayWindow(raw: unknown): ReplayWindow {
  if (typeof raw !== "object" || raw === null) throw new Error("replay window: expected an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.symbol !== "string" || typeof o.source !== "string") throw new Error("replay window: symbol and source must be strings");
  if (typeof o.startTs !== "number" || !Number.isInteger(o.startTs) || o.startTs % 60 !== 0) {
    throw new Error("replay window: startTs must be a unix second on a minute boundary");
  }
  if (o.stepSec !== 1) throw new Error("replay window: stepSec must be 1");
  if (typeof o.warmupSec !== "number" || o.warmupSec < MIN_WARMUP_SEC || o.warmupSec % 60 !== 0) {
    throw new Error(`replay window: warmupSec must be a multiple of 60 and >= ${MIN_WARMUP_SEC}`);
  }
  if (!Array.isArray(o.closes) || o.closes.length % 60 !== 0 || o.closes.length <= o.warmupSec) {
    throw new Error("replay window: closes must cover whole minutes and extend past warmupSec");
  }
  if (!o.closes.every((c) => typeof c === "number" && Number.isFinite(c) && c > 0)) {
    throw new Error("replay window: every close must be a positive number");
  }
  return { symbol: o.symbol, source: o.source, startTs: o.startTs, stepSec: 1, warmupSec: o.warmupSec, closes: o.closes as number[] };
}

export function makeClock(w: ReplayWindow, anchorWallSec: number): ReplayClock {
  if (!Number.isInteger(anchorWallSec) || anchorWallSec % 60 !== 0) throw new Error("anchor must be a wall-clock minute (unix seconds, multiple of 60)");
  const mainStartHist = w.startTs + w.warmupSec;
  return { offsetSec: anchorWallSec - mainStartHist, mainStartHist };
}

function endHist(w: ReplayWindow): number {
  return w.startTs + w.closes.length - 1;
}

function closeAt(w: ReplayWindow, hist: number): number {
  return w.closes[hist - w.startTs] as number;
}

function fmt(x: number): string {
  return x.toFixed(8);
}

function kline(w: ReplayWindow, minuteIdx: number, histNow: number): Kline {
  const open = w.startTs + minuteIdx * 60;
  const last = Math.min(open + 59, histNow);
  let hi = -Infinity;
  let lo = Infinity;
  for (let t = open; t <= last; t++) {
    const c = closeAt(w, t);
    if (c > hi) hi = c;
    if (c < lo) lo = c;
  }
  return [open * 1000, fmt(closeAt(w, open)), fmt(hi), fmt(lo), fmt(closeAt(w, last)), "0", open * 1000 + 59_999, "0", 0, "0", "0", "0"];
}

function klines(w: ReplayWindow, histNow: number, q: URLSearchParams): HandlerResult {
  if (q.get("symbol") !== w.symbol) return { status: 400, body: { code: -1121, msg: "Invalid symbol." } };
  if (q.get("interval") !== "1m") return { status: 400, body: { code: -1120, msg: "Invalid interval." } };
  const limit = Math.min(Math.max(Number(q.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const toIdx = (ms: number) => (ms / 1000 - w.startTs) / 60;
  const lastIdx = Math.floor((Math.min(histNow, endHist(w)) - w.startTs) / 60);
  const endTime = q.get("endTime");
  const endIdx = endTime === null ? lastIdx : Math.min(lastIdx, Math.floor(toIdx(Number(endTime))));
  const startTime = q.get("startTime");
  let from: number;
  let to: number;
  if (startTime !== null) {
    from = Math.max(0, Math.ceil(toIdx(Number(startTime))));
    to = Math.min(endIdx, from + limit - 1);
  } else {
    to = endIdx;
    from = Math.max(0, to - limit + 1);
  }
  const out: Kline[] = [];
  for (let i = from; i <= to; i++) out.push(kline(w, i, histNow));
  return { status: 200, body: out };
}

/** Diagnostic snapshot: the last SNAPSHOT_MINUTES closed 1-minute candles [openTimeSec, close] per venue. */
export function buildSnapshot(w: ReplayWindow, histNow: number, venues: readonly string[] = DEFAULT_SNAPSHOT_VENUES): Snapshot {
  const closedUntil = Math.min(histNow, endHist(w) + 1); // a minute is closed once its 60th second is past
  const lastClosed = Math.floor((closedUntil - w.startTs) / 60) - 1;
  const candles: Array<[number, number]> = [];
  for (let i = Math.max(0, lastClosed - SNAPSHOT_MINUTES + 1); i <= lastClosed; i++) {
    const open = w.startTs + i * 60;
    candles.push([open, closeAt(w, open + 59)]);
  }
  return {
    nowSec: histNow,
    usdtUsd: 1, // the window is Binance ETHUSDT; the replay uses USDT as USD
    dvol: null, // no minute DVOL for the window (the desk reports dvolE2 = 0)
    venues: venues.map((venue) => ({ venue, quote: "USDT", candles })),
  };
}

/** Plan 02 replay mode (GET /venue/<name>/api/v3/klines): the same klines with open and close times shifted to the
 *  wall clock (+offsetSec), so the workflow's freshness rule (last closed candle at most 120 s old) holds. */
function wallClockKlines(w: ReplayWindow, histNow: number, q: URLSearchParams, offsetSec: number): HandlerResult {
  const shiftMs = offsetSec * 1000;
  const hq = new URLSearchParams(q);
  for (const k of ["startTime", "endTime"]) {
    const v = q.get(k);
    if (v !== null) hq.set(k, String(Number(v) - shiftMs));
  }
  const r = klines(w, histNow, hq);
  if (r.status !== 200) return r;
  return {
    status: 200,
    body: (r.body as Kline[]).map((k): Kline => [k[0] + shiftMs, k[1], k[2], k[3], k[4], k[5], k[6] + shiftMs, k[7], k[8], k[9], k[10], k[11]]),
  };
}

const VENUE_KLINES = /^\/venue\/[A-Za-z0-9_-]+\/api\/v3\/klines$/;

export function handleReplayRequest(
  w: ReplayWindow,
  clock: ReplayClock,
  url: URL,
  nowWallMs: number,
  venues: readonly string[] = DEFAULT_SNAPSHOT_VENUES,
): HandlerResult {
  const histNow = Math.floor(nowWallMs / 1000) - clock.offsetSec;
  const end = endHist(w);
  if (url.pathname === "/status") {
    const progress = Math.min(1, Math.max(0, (histNow - clock.mainStartHist) / (end - clock.mainStartHist)));
    return {
      status: 200,
      body: {
        symbol: w.symbol,
        source: w.source,
        histNow,
        histNowIso: new Date(Math.min(histNow, end) * 1000).toISOString(),
        offsetSec: clock.offsetSec,
        mainStartHist: clock.mainStartHist,
        endHist: end,
        progress,
        done: histNow > end,
      },
    };
  }
  if (histNow < w.startTs) return { status: 503, body: { msg: "replay not started" } };
  if (url.pathname === "/snapshot") return { status: 200, body: buildSnapshot(w, histNow, venues) };
  if (url.pathname === "/api/v3/ticker/price") {
    if (url.searchParams.get("symbol") !== w.symbol) return { status: 400, body: { code: -1121, msg: "Invalid symbol." } };
    return { status: 200, body: { symbol: w.symbol, price: fmt(closeAt(w, Math.min(histNow, end))) } };
  }
  if (url.pathname === "/api/v3/klines") return klines(w, histNow, url.searchParams);
  if (VENUE_KLINES.test(url.pathname)) return wallClockKlines(w, histNow, url.searchParams, clock.offsetSec);
  return { status: 404, body: { msg: `unknown path ${url.pathname}` } };
}
```

- [x] **Step 4: Run, expected PASS**

Run: `cd bots && bun test test/replay.test.ts && bun run typecheck`
Expected: ` 13 pass`, ` 0 fail`; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add bots/src/replay/klines.ts bots/test/replay.test.ts
git commit -m "feat(bots): replay window, wall-clock venue klines, snapshot, ticker and status"
```

---

### Task 19: Replay server

**Delegable:** yes
**Depends on:** Task 18

**Files:**
- Create: `bots/src/replay-server.ts`

The server listened on `0.0.0.0` until commit `5ed36a8` (2026-10-07), so during the 2026-10-06 replay; it binds `127.0.0.1` since, the address plan 02's `cre/risk-desk/config.replay.json` already used (`replayUrl` `http://127.0.0.1:8787`). Step 2's smoke test, re-run on 2026-10-07, gives the same output.

- [x] **Step 1: Implementation**

`bots/src/replay-server.ts`:
```ts
// Replay server: serves lab/out/replay-window.json at 1x real time.
//   GET /venue/<name>/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20   plan 02 replay mode (wall-clock times)
//   GET /api/v3/ticker/price?symbol=ETHUSDT   the replay price, read by the replay arbitrageur
//   GET /api/v3/klines?symbol=ETHUSDT&interval=1m&limit=N[&startTime=ms][&endTime=ms]   Binance 1m klines (historical times)
//   GET /snapshot, GET /status       diagnostics
// Env: REPLAY_FILE (default ../lab/out/replay-window.json), REPLAY_PORT (8787),
//      REPLAY_ANCHOR_SEC (wall-clock minute at which the main window starts; default: the current minute).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { envNum, envStr } from "./lib/env";
import { handleReplayRequest, makeClock, parseReplayWindow } from "./replay/klines";

const file = envStr("REPLAY_FILE", join(import.meta.dir, "..", "..", "lab", "out", "replay-window.json"));
const port = envNum("REPLAY_PORT", 8787);
const anchor = envNum("REPLAY_ANCHOR_SEC", Math.floor(Date.now() / 60_000) * 60);
const w = parseReplayWindow(JSON.parse(readFileSync(file, "utf8")));
const clock = makeClock(w, anchor);

Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const r = handleReplayRequest(w, clock, new URL(req.url), Date.now());
    return Response.json(r.body, { status: r.status, headers: { "access-control-allow-origin": "*" } });
  },
});

const mainIso = new Date(clock.mainStartHist * 1000).toISOString();
console.log(`[replay] ${w.source}: ${w.closes.length} s from ${new Date(w.startTs * 1000).toISOString()}, main start ${mainIso}`);
console.log(`[replay] anchor ${new Date(anchor * 1000).toISOString()} (REPLAY_ANCHOR_SEC=${anchor}), offset ${clock.offsetSec} s`);
console.log(`[replay] listening on http://127.0.0.1:${port} (GET /venue/<name>/api/v3/klines, /api/v3/ticker/price, /api/v3/klines, /snapshot, /status)`);
```

- [x] **Step 2: Smoke test with a synthetic window**

Run (one shell; the server runs in the background and is stopped at the end):
```bash
cd bots && bun -e 'await Bun.write("/tmp/clim-replay-test.json", JSON.stringify({ symbol: "ETHUSDT", source: "synthetic", startTs: 1770204600, stepSec: 1, warmupSec: 1260, closes: Array.from({ length: 1800 }, (_, i) => 2000 + i * 0.5) }))'
(REPLAY_FILE=/tmp/clim-replay-test.json REPLAY_PORT=18787 bun run replay-server &) ; sleep 2
curl -s localhost:18787/status; echo
curl -s localhost:18787/snapshot | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['nowSec'], [(v['venue'], len(v['candles'])) for v in d['venues']], d['venues'][0]['candles'][-1])"
curl -s "localhost:18787/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=1"; echo
curl -s "localhost:18787/venue/kraken/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=1"; echo
pkill -f "src/replay-server.ts"
```
Expected, with s = the seconds elapsed in the current wall-clock minute (validated run: s = 53):
```
[replay] synthetic: 1800 s from 2026-02-04T11:30:00.000Z, main start 2026-02-04T11:51:00.000Z
[replay] anchor <this minute, ISO> (REPLAY_ANCHOR_SEC=<unix>), offset <offset> s
[replay] listening on http://127.0.0.1:18787 (GET /venue/<name>/api/v3/klines, /api/v3/ticker/price, /api/v3/klines, /snapshot, /status)
{"symbol":"ETHUSDT","source":"synthetic","histNow":1770205913,...,"mainStartHist":1770205860,"endHist":1770206399,...,"done":false}
1770205913 [('binance-replay-1', 21), ('binance-replay-2', 21), ('binance-replay-3', 21), ('binance-replay-4', 21)] [1770205800, 2629.5]
[[1770205860000,"2630.00000000","2656.50000000","2630.00000000","2656.50000000","0",1770205919999,"0",0,"0","0","0"]]
[[<anchor>000,"2630.00000000","2656.50000000","2630.00000000","2656.50000000","0",<anchor>059999,"0",0,"0","0","0"]]
```
(`histNow` and `nowSec` are 1770205860 + s; the kline's high and close are 2630 + 0.5 s. The last line is the same candle on the wall clock: `<anchor>` is the `REPLAY_ANCHOR_SEC` printed on the second line, which is what plan 02's replay mode reads.)

- [x] **Step 3: Commit**

```bash
git add bots/src/replay-server.ts
git commit -m "feat(bots): replay server"
```

---

### Task 20: Funding and status scripts

**Delegable:** yes
**Depends on:** Tasks 11, 13

**Files:**
- Create: `bots/src/scripts/fund.ts`, `bots/src/scripts/status.ts`

- [x] **Step 1: Implementation**

`bots/src/scripts/fund.ts`:
```ts
// Funding and approvals for every bot key present in bots/.env (idempotent: only tops up what is missing).
// - ETH for gas, sent from DEPLOYER_PRIVATE_KEY;
// - tETH and tUSD minted by the deployer (TestToken owner) through TestToken.mint;
// - each bot approves the router it swaps through (PoolSwapTest pulls the input with transferFrom):
//   arbitrage keys -> routers.arb (or the shared PoolSwapTest until it exists), retail keys -> the shared PoolSwapTest.
// Run it while the CRE loop is stopped if DEPLOYER_PRIVATE_KEY is also the CRE operator key (one nonce sequence).
// Usage: bun src/scripts/fund.ts
import { arbRouter, loadDeployments, requireValue, testTokenAbi, type TokenEntry } from "@clim/shared";
import { formatEther, formatUnits, maxUint256, parseEther, parseUnits, type Address, type Hex } from "viem";
import { publicClientFor, walletFor } from "../lib/chain";
import { envStr, privateKeyFromEnv } from "../lib/env";

const d = loadDeployments();
const tETH = requireValue(d.tokens.tETH, "tokens.tETH");
const tUSD = requireValue(d.tokens.tUSD, "tokens.tUSD");
const client = publicClientFor();
const deployer = walletFor(privateKeyFromEnv("DEPLOYER_PRIVATE_KEY"));
const FUND_ETH = parseEther(envStr("FUND_ETH", "0.2"));
const MIN_ETH = parseEther(envStr("FUND_MIN_ETH", "0.05"));
const MINT: Array<[TokenEntry, bigint]> = [
  [tETH, parseUnits(envStr("MINT_TETH", "1000000"), tETH.decimals)],
  [tUSD, parseUnits(envStr("MINT_TUSD", "10000000000"), tUSD.decimals)],
];
const BOT_KEYS = ["ARB_LIVE", "NOISE_LIVE", "ARB_REPLAY", "NOISE_REPLAY"] as const;

async function fundOne(name: string, key: Hex, router: Address): Promise<void> {
  const bot = walletFor(key);
  const addr = bot.account.address;
  const eth = await client.getBalance({ address: addr });
  if (eth < MIN_ETH) {
    const hash = await deployer.sendTransaction({ to: addr, value: FUND_ETH });
    await client.waitForTransactionReceipt({ hash });
    console.log(`[fund] ${name} ${addr}: sent ${formatEther(FUND_ETH)} ETH (${hash})`);
  }
  for (const [token, amount] of MINT) {
    const bal = await client.readContract({ address: token.address, abi: testTokenAbi, functionName: "balanceOf", args: [addr] });
    if (bal < amount / 2n) {
      const hash = await deployer.writeContract({ address: token.address, abi: testTokenAbi, functionName: "mint", args: [addr, amount] });
      await client.waitForTransactionReceipt({ hash });
      console.log(`[fund] ${name}: minted ${formatUnits(amount, token.decimals)} ${token.symbol} (${hash})`);
    }
    const allowance = await client.readContract({ address: token.address, abi: testTokenAbi, functionName: "allowance", args: [addr, router] });
    if (allowance < maxUint256 / 2n) {
      const hash = await bot.writeContract({ address: token.address, abi: testTokenAbi, functionName: "approve", args: [router, maxUint256] });
      await client.waitForTransactionReceipt({ hash });
      console.log(`[fund] ${name}: approved ${router} for ${token.symbol} (${hash})`);
    }
  }
  console.log(`[fund] ${name} ${addr} ready: ${formatEther(await client.getBalance({ address: addr }))} ETH`);
}

for (const name of BOT_KEYS) {
  const env = `${name}_PRIVATE_KEY`;
  if (!process.env[env]) {
    console.log(`[fund] ${env} not set: skipped`);
    continue;
  }
  const router = name.startsWith("ARB") ? arbRouter(d) : d.uniswap.poolSwapTest;
  await fundOne(name, privateKeyFromEnv(env), router);
}
console.log(`[fund] deployer ${deployer.account.address} left with ${formatEther(await client.getBalance({ address: deployer.account.address }))} ETH`);
```

`bots/src/scripts/status.ts`:
```ts
// Health check of one pair: desk state, hook fee (checked against the shared/ mirror), pool prices, market
// price and bot balances. Exits 1 on a hard problem. --watch prints one line per block (blind-mode demo).
// Usage: bun src/scripts/status.ts --pair live|replay [--watch]
import {
  arbRouter,
  FeeMode,
  loadDeployments,
  loadParams,
  pipsToBp,
  quoteFeeMirror,
  resolvePair,
  sigmaE9ToAnnual,
  type FeeModeValue,
} from "@clim/shared";
import { formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClientFor, readBalances, readPairState } from "../lib/chain";
import { botKey, envStr, hasFlag, pairArg } from "../lib/env";
import { shortError } from "../lib/jsonl";
import { aggregate, fetchReplayPrice, fetchVenueQuotes } from "../lib/market";

const pair = pairArg();
const d = loadDeployments();
const p = resolvePair(d, pair);
const params = loadParams();
const client = publicClientFor();
const MODE_NAME: Record<number, string> = { [FeeMode.Normal]: "normal", [FeeMode.Degraded]: "degraded", [FeeMode.Blind]: "blind" };

async function market(): Promise<string> {
  try {
    if (pair === "replay") return `replay ${(await fetchReplayPrice(envStr("REPLAY_URL", "http://127.0.0.1:8787"))).toFixed(2)}`;
    const q = await fetchVenueQuotes();
    const m = aggregate(q);
    return m ? `${m.price.toFixed(2)} (${m.n} venues)` : `n/a (${q.length} venues)`;
  } catch (e) {
    return `n/a (${shortError(e)})`;
  }
}

async function snapshot(blockNumber: bigint): Promise<{ line: string; problems: string[] }> {
  const [s, block, m] = await Promise.all([readPairState(client, d, p, blockNumber), client.getBlock({ blockNumber }), market()]);
  const now = Number(block.timestamp);
  const mirror = quoteFeeMirror(s.desk, params, now);
  const problems: string[] = [];
  if (mirror.fee !== s.hookFee || mirror.mode !== (s.hookMode as FeeModeValue)) {
    problems.push(`hook quoteFee ${s.hookFee}/${s.hookMode} != shared mirror ${mirror.fee}/${mirror.mode} (params.json differs from the deployed hook?)`);
  }
  if (s.V.protocolFee !== 0 || s.S.protocolFee !== 0) problems.push(`protocol fee is not 0 (V ${s.V.protocolFee}, S ${s.S.protocolFee})`);
  const age = s.desk.seq === 0 ? "never" : `${now - s.desk.tObs}s`;
  const line =
    `block ${blockNumber} | desk seq ${s.desk.seq} age ${age} sigma ${(sigmaE9ToAnnual(s.desk.sigmaE9) * 100).toFixed(1)}%/yr k ${s.desk.kE4 / 1e4} flags ${s.desk.flags}` +
    ` | V fee ${s.hookFee} pips (${pipsToBp(s.hookFee).toFixed(2)} bp, ${MODE_NAME[s.hookMode] ?? s.hookMode})` +
    ` | S fee ${s.S.lpFee} pips | V ${s.V.ethUsd.toFixed(2)} S ${s.S.ethUsd.toFixed(2)} | market ${m}`;
  return { line, problems };
}

async function balances(): Promise<void> {
  for (const role of ["ARB", "NOISE"] as const) {
    let addr: `0x${string}`;
    try {
      addr = privateKeyToAccount(botKey(role, pair)).address;
    } catch {
      console.log(`${role}_${pair.toUpperCase()}: key not set`);
      continue;
    }
    const router = role === "ARB" ? arbRouter(d) : d.uniswap.poolSwapTest;
    const b = await readBalances(client, p, addr, router);
    const approved = b.ethAllowance > 0n && b.usdAllowance > 0n ? "approved" : "NOT APPROVED (run fund)";
    console.log(
      `${role}_${pair.toUpperCase()} ${addr}: ${formatEther(b.native)} ETH, ${formatUnits(b.ethToken, p.tETH.decimals)} ${p.tETH.symbol}, ${formatUnits(b.usdToken, p.tUSD.decimals)} ${p.tUSD.symbol}, ${approved}`,
    );
  }
}

const head = await client.getBlockNumber();
const first = await snapshot(head);
console.log(`pair ${pair}: hook ${p.hook} desk ${p.desk}`);
console.log(`params: P*=${params.pStar} etaE4=${params.etaE4} floor ${params.feeMinPips} cap ${params.feeMaxPips} safe ${params.feeSafePips} tauKill ${params.tauKillSec}s (${params.decidedBy})`);
console.log(first.line);
await balances();
for (const pr of first.problems) console.error(`PROBLEM: ${pr}`);

if (hasFlag("--watch")) {
  client.watchBlockNumber({
    emitMissed: false,
    pollingInterval: 2_000,
    onBlockNumber: (bn) => {
      snapshot(bn).then(
        (s) => console.log(`${new Date().toISOString()} ${s.line}${s.problems.length ? ` | PROBLEM: ${s.problems.join("; ")}` : ""}`),
        (e: unknown) => console.error(shortError(e)),
      );
    },
  });
} else {
  process.exit(first.problems.length === 0 ? 0 : 1);
}
```

- [x] **Step 2: Typecheck and wiring check**

Run: `cd bots && bun run typecheck && bun run status --pair live`
Expected: typecheck clean; before plan 01 has deployed: `error: pools.liveV is null: deploy it first (plan 01) and record it in shared/deployments/sepolia.json`.

- [x] **Step 3: Commit**

```bash
git add bots/src/scripts/fund.ts bots/src/scripts/status.ts
git commit -m "feat(bots): funding, approvals and status scripts"
```

---

### Task 21: Forged-report security demo

**Delegable:** yes
**Depends on:** Tasks 4, 13

**Files:**
- Create: `bots/src/scripts/forge-report.ts`

- [x] **Step 1: Implementation**

`bots/src/scripts/forge-report.ts`:
```ts
// Safety demo 1 (forged report): a third party pushes sigma = 0 to RiskDesk through the permissionless
// MockKeystoneForwarder. The SIM guard (tx.origin must be the CRE operator) must reject it:
// the forwarder emits ReportProcessed(result=false) and the transaction carries no RiskReported.
// The verdict reads only this transaction's receipt: the live CRE loop keeps reporting every 30 s, so a
// legitimate report can land between the two state() reads, which are printed and logged for context only.
// Sends from NOISE_<PAIR>_PRIVATE_KEY, which must NOT be the CRE operator key.
// Usage: bun src/scripts/forge-report.ts --pair live
import { buildMockRawReport, loadDeployments, mockForwarderAbi, requireValue, riskDeskAbi } from "@clim/shared";
import { join } from "node:path";
import { keccak256, parseEventLogs, toHex } from "viem";
import { publicClientFor, walletFor } from "../lib/chain";
import { botKey, pairArg } from "../lib/env";
import { appendJsonl, OUT_DIR } from "../lib/jsonl";

const pair = pairArg();
const d = loadDeployments();
const desk = requireValue(d.riskDesks[pair], `riskDesks.${pair}`);
const client = publicClientFor();
const attacker = walletFor(botKey("NOISE", pair));

const before = await client.readContract({ address: desk, abi: riskDeskAbi, functionName: "state" });
const now = Math.floor(Date.now() / 1000);
const raw = buildMockRawReport(
  { tObs: now, sigmaE9: 0, rv15E9: 0, dvolE2: 0, refTick: 0, dispBp: 0, nSources: 4, kE4: 10_000, zone: 0 },
  { executionId: keccak256(toHex(`clim-forged-${now}`)), timestamp: now },
);
const hash = await attacker.writeContract({
  address: d.cre.mockForwarder,
  abi: mockForwarderAbi,
  functionName: "report",
  args: [desk, raw, "0x", []],
  gas: 500_000n,
});
const r = await client.waitForTransactionReceipt({ hash });
const result = parseEventLogs({ abi: mockForwarderAbi, eventName: "ReportProcessed", logs: r.logs })[0]?.args.result ?? null;
const reported = parseEventLogs({ abi: riskDeskAbi, eventName: "RiskReported", logs: r.logs }).filter((l) => l.address.toLowerCase() === desk.toLowerCase());
const after = await client.readContract({ address: desk, abi: riskDeskAbi, functionName: "state" });
const held = r.status === "success" && result === false && reported.length === 0;
const accepted = result === true || reported.length > 0;
appendJsonl(join(OUT_DIR, "security-demos.jsonl"), {
  ts: new Date().toISOString(),
  demo: "forge-report",
  pair,
  attacker: attacker.account.address,
  txHash: hash,
  txStatus: r.status,
  forwarderResult: result,
  riskReportedInTx: reported.length,
  seqBefore: before[4],
  seqAfter: after[4],
  sigmaBefore: before[1],
  sigmaAfter: after[1],
  held,
});
console.log(`forged report tx ${hash} from ${attacker.account.address}: status ${r.status}, forwarder result=${result}, RiskReported in tx: ${reported.length}`);
const moved = after[4] !== before[4] && reported.length === 0 ? " (another report landed in between, not this tx)" : "";
console.log(`desk seq ${before[4]} -> ${after[4]}, sigmaE9 ${before[1]} -> ${after[1]}${moved}`);
console.log(
  held
    ? "SIM guard held: forged report rejected"
    : accepted
      ? "FORGED REPORT ACCEPTED: investigate the RiskDesk SIM guard"
      : `NO VERDICT: tx status ${r.status}, forwarder result=${result}: the forwarder did not process the forged report`,
);
process.exit(held ? 0 : 1);
```

- [x] **Step 2: Typecheck and wiring check**

Run: `cd bots && bun run typecheck && bun run forge-report --pair live`
Expected: typecheck clean; before plan 01 has deployed: `error: riskDesks.live is null: deploy it first (plan 01) and record it in shared/deployments/sepolia.json`.

- [x] **Step 3: Commit**

```bash
git add bots/src/scripts/forge-report.ts
git commit -m "feat(bots): forged report security demo"
```

---

### Task 22: Run-book and environment template

**Delegable:** yes
**Depends on:** Tasks 14 to 21

**Files:**
- Create: `bots/.env.example`, `docs/runbook.md`

- [x] **Step 1: Environment template**

`bots/.env.example`:
```bash
# bots/.env (gitignored). Bun loads it automatically when commands run from bots/.
# Testnet keys only. Generate each key with `cast wallet new`.

# Sepolia RPC. A keyed endpoint (Alchemy, Infura) is more reliable than the public one under bot load.
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# Funds the bots with Sepolia ETH and mints test tokens: the plan 01 deployer key (TestToken owner).
# In plan 01 it is also the live desk's simOperator, i.e. the CRE_ETH_PRIVATE_KEY of cre/.env (with 0x here).
# The replay desk has its own operator key in cre/.env.replay (plan 01 Task 18), used with ENV_FILE=.env.replay.
DEPLOYER_PRIVATE_KEY=

# One key per bot and pair, so concurrent bots never share a nonce.
# Never reuse the CRE operator key (cre/.env CRE_ETH_PRIVATE_KEY): the forged-report demo sends from NOISE_<PAIR>.
ARB_LIVE_PRIVATE_KEY=
NOISE_LIVE_PRIVATE_KEY=
ARB_REPLAY_PRIVATE_KEY=
NOISE_REPLAY_PRIVATE_KEY=

# fund.ts: ETH top-up when a bot falls under FUND_MIN_ETH; tETH / tUSD mints in human units.
FUND_ETH=0.2
FUND_MIN_ETH=0.05
MINT_TETH=1000000
MINT_TUSD=10000000000

# noise.ts: Poisson swaps per block, log-normal USD size (median, log-sd), PRNG seed.
NOISE_RATE_PER_BLOCK=0.5
NOISE_MEDIAN_USD=2000
NOISE_SIGMA_LN=1
NOISE_SEED=42

# replay-server.ts and the replay bots.
REPLAY_URL=http://127.0.0.1:8787
REPLAY_PORT=8787

# sim-loop.ts runs plan 02's loop script (cre/scripts/sim-loop.sh) from the repo's cre/ folder.
# Uncomment only to point it at another CRE project folder (absolute path).
# CRE_PROJECT_DIR=
```

- [x] **Step 2: Run-book**

`docs/runbook.md`:
````markdown
# clim run-book

How to run clim on Ethereum Sepolia: the Chainlink CRE risk desk loop, the arbitrage and retail bots, the February 2026 replay and the two security demos. Commands run from the repository root unless a `cd` is shown. Expected output follows each command; addresses, prices and hashes will differ.

## 0. One-time setup

### Tools
| Tool | Install | Check |
|---|---|---|
| Bun 1.3.9 (the CRE TypeScript SDK requires Bun; the bots use it too) | `curl -fsSL https://bun.sh/install \| bash -s "bun-v1.3.9"`, then `ln -sf "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun` | `bun --version` |
| Foundry (contracts, `cast`) | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` | `cast --version` |
| CRE CLI | `curl -sSL https://app.chain.link/cre/install.sh \| bash`, then `ln -sf "$HOME/.cre/bin/cre" /opt/homebrew/bin/cre` | `cre version` |
| CRE login (simulation needs it) | `cre login` (opens a browser) | `cre whoami` |
| tmux (optional, section 3) | `brew install tmux` | `tmux -V` |

```bash
bun install          # root: installs the shared/ and bots/ workspaces (hoisted, see bunfig.toml)
bun run test         # expected: every package "0 fail"
bun run typecheck    # expected: "@clim/shared typecheck: Exited with code 0", "@clim/bots typecheck: Exited with code 0"
```

### Keys
Generate each key with `cast wallet new`. Testnet keys only; never commit them.

| Role | Variable | File | Funded by |
|---|---|---|---|
| Deployer and live CRE operator (plan 01 uses one key: it deploys, owns TestToken, and is the live desk's `simOperator`) | `DEPLOYER_PRIVATE_KEY` (0x + 64 hex) in `bots/.env`; the same key as `CRE_ETH_PRIVATE_KEY` (64 hex, **no 0x**) in `cre/.env` | `bots/.env`, `cre/.env` | a Sepolia faucet |
| Replay CRE operator (the replay desk's `simOperator`) | `CRE_ETH_PRIVATE_KEY` (64 hex, **no 0x**) in `cre/.env.replay`, created by plan 01 Task 18 | `cre/.env.replay` | 0.2 ETH from the deployer (plan 01 Task 18 Step 1) |
| Live arbitrageur and retail flow | `ARB_LIVE_PRIVATE_KEY`, `NOISE_LIVE_PRIVATE_KEY` | `bots/.env` | `bun run fund` |
| Replay arbitrageur and retail flow (same tETH/tUSD tokens, other pools) | `ARB_REPLAY_PRIVATE_KEY`, `NOISE_REPLAY_PRIVATE_KEY` | `bots/.env` | `bun run fund` |

Because the deployer is also the live CRE operator, run `bun run fund` before starting the live CRE loop or while it is stopped: two processes sending from one key collide on nonces. The replay loop sends from its own key and can keep running.

```bash
cp bots/.env.example bots/.env   # then fill the keys and SEPOLIA_RPC_URL
```

### Gas budget (Sepolia, gas price measured at about 1 gwei)
| Flow | Rate | Gas per tx | ETH per day |
|---|---|---|---|
| CRE reports (`report` through MockKeystoneForwarder) | 1 per 30 s = 2,880/day | 90k-190k | about 0.5 |
| Arbitrage (two pools) | about 0.2-0.3 trades per pool per 12 s block = about 3,600/day | 120k-150k | about 0.55 |
| Retail flow, mirrored to both pools | 0.5 orders per block x 2 pools = 7,200 swaps/day | 120k-150k | about 1.1 |
| **Live pair total** | | | **about 2.2 ETH/day** |

The replay (4 hours) costs about a sixth of that. If ETH is short, lower `NOISE_RATE_PER_BLOCK`; never stop the arbitrageur, it is what the measurement is about.

## 1. Check the deployment
Plan 01 fills `shared/deployments/sepolia.json`, plan 03 writes `shared/params.json`. The shared tests validate both files (pool ids, token pairs and order, fee flags, parameters):

```bash
bun run --cwd shared test
cd bots && bun run status --pair live
```
Expected (exit code 0, no `PROBLEM` line):
```
pair live: hook 0x...1080 desk 0x...
params: P*=0.3 etaE4=25093 floor 500 cap 15000 safe 3000 tauKill 180s (lab/scripts/decide_pstar.py: year/aggregator LP P&L: ...)
block 11860000 | desk seq 12 age 25s sigma 32.0%/yr k 1 flags 0 | V fee 500 pips (5.00 bp, normal) | S fee 511 pips | V 2713.10 S 2713.50 | market 2713.80 (4 venues)
ARB_LIVE 0x...: 0.2 ETH, 1000000 tETH, 10000000000 tUSD, approved
NOISE_LIVE 0x...: 0.2 ETH, 1000000 tETH, 10000000000 tUSD, approved
```
- `error: pools.liveV is null: deploy it first (plan 01) ...`: the live pair is not deployed yet.
- `ARB_LIVE ... NOT APPROVED (run fund)`: run section 2. The arbitrage keys approve `routers.arb` (the arbitrage-only PoolSwapTest that lets the app tell arbitrage from retail swaps), the retail keys the shared PoolSwapTest.
- `PROBLEM: hook quoteFee ... != shared mirror ...`: `shared/params.json` differs from the parameters the hook was deployed with. The hook is immutable: correct `params.json` to the deployed values, never the reverse.
- `PROBLEM: protocol fee is not 0`: both pools pay it, so the V/S comparison stays fair, but write it in the session log.

## 2. Fund the bots
```bash
cd bots && bun run fund
```
Expected on the first run (later runs print only the `ready` lines):
```
[fund] ARB_LIVE 0x...: sent 0.2 ETH (0x...)
[fund] ARB_LIVE: minted 1000000 tETH (0x...)
[fund] ARB_LIVE: approved 0x<routers.arb> for tETH (0x...)
[fund] ARB_LIVE: minted 10000000000 tUSD (0x...)
[fund] ARB_LIVE: approved 0x<routers.arb> for tUSD (0x...)
[fund] ARB_LIVE 0x... ready: 0.2 ETH
[fund] NOISE_LIVE: approved 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe for tETH (0x...)
[fund] ARB_REPLAY_PRIVATE_KEY not set: skipped
[fund] deployer 0x... left with 2.1 ETH
```

## 3. Start the live stack
Four terminals (or the tmux line below), all in `bots/`:

| Terminal | Command | Expected output |
|---|---|---|
| T1 CRE desk | `bun run cre-loop --pair live` | plan 02's loop output (`=== <time>`, `[USER LOG] ...`) and after each run: `[sim-loop live] run 2026-10-07T03:00:00Z: applied tx 0x... block 11860000 seq 12 sigmaApplied 57012 forwarderResult true` |
| T2 arbitrage | `bun run arb --pair live` | per block and pool: `[arb live] block 11860001 V pool 2713.10 vs 2713.80 gap -2.6bp band 5.0bp -> none`, and outside the band `... -> buyEth tx 0x...` |
| T3 retail | `bun run noise --pair live` | `[noise live] block 11860001 buyEth $1840 on V (fee 500 pips) tx 0x...` followed by the same order on S |
| T4 monitor | `bun run status --pair live --watch` | one line per block, as in section 1 |

```bash
cd bots && tmux new-session -d -s clim 'bun run cre-loop --pair live' \; split-window 'bun run arb --pair live' \; split-window 'bun run noise --pair live' \; split-window 'bun run status --pair live --watch' \; select-layout tiled \; attach
```

Notes:
- `cre-loop` (`bots/src/sim-loop.ts`) runs plan 02's `cre/scripts/sim-loop.sh staging-settings --broadcast` (it builds the WASM once, then simulates every 30 s; full CLI logs in `cre/logs/`), writes each run's transcript to `bots/out/cre-sim/` and records each run in `bots/out/cre-runs.jsonl`. Ctrl-C stops both.
- `arb` starts with `router 0x<routers.arb>`; if it warns `routers.arb is not deployed`, the arbitrage goes through the shared PoolSwapTest and the app cannot separate it from retail flow: ask plan 01 to deploy the arbitrage router.
- The first arbitrage block moves each pool to the market price (pools start a little off): expect one large `buyEth` or `sellEth` per pool, then mostly `none`.
- `-> stale: reverted: 0x7c9c6e8f` (PriceLimitAlreadyExceeded) means another swap moved the pool after the block was read; nothing was sent and the bot retries on the next block. Occasional is normal.
- Retail routing: `mirror` (default, the same order on V and S), `split` (one pool at random) or `cheapest` (volume-leak variant): `bun run noise --pair live --routing cheapest`. Run one retail process per pair.
- Logs (all under `bots/out/`): `cre-runs.jsonl` and `security-demos.jsonl` are tracked by git (submission evidence, commit them at the end); `cre-sim/*.log`, `arb-live.jsonl` and `noise-live.jsonl` stay local.

## 4. Replay of 2026-02-04 12:00-16:00 UTC
Prerequisites: `lab/out/replay-window.json` (plan 03), the replay pools, REPLAY-flagged desk and replay hook in `shared/deployments/sepolia.json` (plan 01), the `replay-settings` target of `cre/risk-desk` with `replayUrl` = this server's base URL (plan 02 Task 12), replay keys funded (`bun run fund`).

1. Start the replay server (T5):
   ```bash
   cd bots && bun run replay-server
   ```
   Expected:
   ```
   [replay] Binance spot ETHUSDT 1s klines (close), 2026-02-04 11:30-16:00 UTC, forward-filled: 16200 s from 2026-02-04T11:30:00.000Z, main start 2026-02-04T12:00:00.000Z
   [replay] anchor 2026-10-07T03:00:00.000Z (REPLAY_ANCHOR_SEC=1791342000), offset 21135600 s
   [replay] listening on http://127.0.0.1:8787 (GET /venue/<name>/api/v3/klines, /api/v3/ticker/price, /api/v3/klines, /snapshot, /status)
   ```
   Check what plan 02's replay mode reads (one call per venue, wall-clock times):
   ```bash
   curl -s "http://127.0.0.1:8787/venue/kraken/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20" | python3 -c "import json,sys,time; k=json.load(sys.stdin); print(len(k), int(time.time()) - k[-1][0] // 1000)"
   ```
   Expected: `20` and a number between 0 and 59 (the last kline is the wall-clock minute in progress). Restarting the server restarts the replay at 12:00 UTC; to resume instead, restart it with the anchor it printed: `REPLAY_ANCHOR_SEC=1791342000 bun run replay-server`.
2. Start the replay desk loop and the replay bots (T6-T8). If the live `cre-loop` is starting at the same moment, wait until it has printed its first run: both loops build the WASM into the same `cre/risk-desk/.cre_build_tmp.wasm`, and two builds at once make one fail (`failed to compile workflow: open .../.cre_build_tmp.wasm: no such file or directory`, seen on 2026-10-06; friction log).
   ```bash
   cd bots && ENV_FILE=.env.replay bun run cre-loop --pair replay
   cd bots && bun run arb --pair replay
   cd bots && bun run noise --pair replay
   ```
   Expected in T6: `applied` runs; `bun run status --pair replay` then shows the replay desk with `flags 2` (REPLAY). Start the replay loop as `cd bots && ENV_FILE=.env.replay bun run cre-loop --pair replay` (the line above without `ENV_FILE` sends from the live operator, and the replay desk rejects every report as `not-applied`): the replay desk's operator key is `cre/.env.replay` (plan 01 Task 18), so the live and replay loops never share a nonce.
3. If the CRE simulator cannot reach 127.0.0.1 (plan 02 Task 12 records the answer in the session log), expose the server and point the replay config at it:
   ```bash
   brew install cloudflared
   cloudflared tunnel --url http://127.0.0.1:8787   # prints https://<random>.trycloudflare.com
   ```
   Set `"replayUrl"` in `cre/risk-desk/config.replay.json` to that base URL, with no path (the workflow appends `/venue/<venue>/api/v3/klines...`). Without Homebrew: `bunx localtunnel --port 8787`.
4. The replay lasts 4 hours. At the end `/status` shows `"done":true`, the candles stop, the workflow skips (`no-report`) and the replay desk goes blind.

## 5. Security demos (record both for the video)
### Forged report
A third-party key pushes sigma = 0 through the permissionless MockKeystoneForwarder:
```bash
cd bots && bun run forge-report --pair live
```
Expected (exit code 0):
```
forged report tx 0x... from 0x<NOISE_LIVE address>: status success, forwarder result=false, RiskReported in tx: 0
desk seq 12 -> 12, sigmaE9 57012 -> 57012
SIM guard held: forged report rejected
```
The verdict reads only the forged transaction's receipt (`ReportProcessed` result `false`, no `RiskReported`). T1 keeps running, so one of its reports can land between the two desk reads: the second line then reads `desk seq 12 -> 13, sigmaE9 57012 -> 57390 (another report landed in between, not this tx)` and the verdict does not change. The record is appended to `bots/out/security-demos.jsonl`. On `https://sepolia.etherscan.io/tx/<hash>` show the `ReportProcessed` event with `result = false` and the absence of `RiskReported`.

### Circuit breaker (blind mode)
1. Keep T4 (`status --pair live --watch`) visible.
2. Stop T1 (Ctrl-C on `cre-loop`).
3. More than `tauKillSec` (180 s) after the last report, the watch line switches to `V fee 3000 pips (30.00 bp, blind)` (or higher if sigma was already high).
4. Restart T1: after its first `applied` run the line returns to `normal`.

## 6. Evidence
```bash
grep -c '"status":"applied"' bots/out/cre-runs.jsonl                 # accepted on-chain CRE reports
grep '"status":"applied"' bots/out/cre-runs.jsonl | tail -3           # latest tx hashes
ls -t bots/out/cre-sim/*.log | head -3                                # latest run transcripts
```
`bots/out/cre-runs.jsonl` and `bots/out/security-demos.jsonl` are tracked by git; the rest of `bots/out/` stays local. The other committed evidence for judges (the on-chain `RiskReported` list and a few curated run transcripts from `bots/out/cre-sim/`) is produced by plan 06's collector in `docs/evidence/`.

## 7. Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `ARB_LIVE_PRIVATE_KEY is not set (see bots/.env.example)` | command not run from `bots/`, or key missing | `cd bots`, fill `bots/.env` |
| `[arb live] block N: skip (fewer than 3 venues)` | venue APIs down or rate-limited | wait; check `curl -s "https://api.kraken.com/0/public/Ticker?pair=ETHUSD"` |
| `reverted: ...` (not `stale`) on every arbitrage | missing approval or balance | `bun run fund`, then `bun run status --pair live` shows `approved` |
| cre-loop `error (...)` | `cre login` expired, wrong target, compile or RPC error | read `cre/logs/`; `cre whoami`; run `scripts/sim-loop.sh staging-settings` by hand from `cre/` |
| cre-loop `not-applied` or `forwarderResult false` | RiskDesk rejected the report (MIN_GAP 20 s, skew, nSources < 3, wrong operator key) | compare the operator address of `cre/.env` (live) or `cre/.env.replay` (replay, started with `ENV_FILE=.env.replay`) with the desk's `simOperator` |
| cre-loop `no-report` | the workflow skipped (`clim: no report (...)`: quorum, min gap) | the reason is in the `detail` field of the run |
| `nonce too low` / `replacement transaction underpriced` from fund or cre-loop | two processes sent from one operator key at once (fund and the live loop, or a replay loop started without `ENV_FILE=.env.replay`) | stop the live loop, rerun fund, restart it; start the replay loop with `ENV_FILE=.env.replay` |
| watch shows `blind` while cre-loop runs | reports failing | look at the last statuses in `bots/out/cre-runs.jsonl` |
| HTTP 429 from the RPC | public endpoint rate limit | set a keyed `SEPOLIA_RPC_URL` |
````

- [x] **Step 3: Full check**

Run: `bun run test && bun run typecheck`
Expected: `@clim/shared test:  55 pass`, `@clim/shared test:  3 skip` (or ` 58 pass` and ` 0 skip` once `shared/abis/*.json` exist), `@clim/bots test:  66 pass`, both ` 0 fail`; both typechecks `Exited with code 0`.

- [x] **Step 4: Commit**

```bash
git add bots/.env.example docs/runbook.md
git commit -m "docs(ops): run-book and bots environment template"
```

---

### Task 23: Live smoke test on Sepolia (after master Gate B)

**Delegable:** no (needs the keys, Sepolia ETH and `cre login`)
**Depends on:** plan 01 (live pair deployed, `shared/deployments/sepolia.json` filled, `shared/params.json` decided, ABIs exported), plan 02 Tasks 9 and 11 (`cre/scripts/sim-loop.sh`, the staging config pointing at the live desk), Task 22

**Files:**
- Modify: today's session log (the run logs stay in `bots/out/`, ignored by git; plan 06 collects the evidence)

- [x] **Step 1: Validate the deployment files**

Run: `bun run --cwd shared test`
Expected: ` 0 fail` and ` 0 skip` (ABIs exported, so the drift checks run). A failure names the wrong field of `sepolia.json` or `params.json`: fix the file (or plan 01's deploy script), not the validator.

- [x] **Step 2: Fund and check**

Run (CRE loop stopped, since the deployer is also the operator): `cd bots && bun run fund && bun run status --pair live`
Expected: the outputs of run-book sections 2 and 1; exit code 0; no `PROBLEM` line. If `arb` later warns that `routers.arb` is not deployed, ask plan 01 for it (contract 1) before relying on the app's arbitrage attribution.

- [x] **Step 3: One recorded CRE run**

Run: `cd bots && bun run cre-loop --pair live --once`
Expected: plan 02's loop output, then `[sim-loop live] run <time>: applied tx 0x... block N seq S sigmaApplied X forwarderResult true` and one file in `bots/out/cre-sim/`, where X is the `sigmaE9` of the workflow's `consensus:` line (or the enveloped value if the desk clamped it). `not-applied`, `rejected` or `forwarderResult false`: run-book section 7.

- [x] **Step 4: Ten minutes of the full stack**

Start the four terminals of run-book section 3, wait ten minutes, stop them (Ctrl-C), then run:
```bash
cd bots
grep -c '"status":"applied"' out/cre-runs.jsonl
grep -o '"status":"[a-z-]*"' out/cre-runs.jsonl | sort | uniq -c
grep -c '"action":"none"' out/arb-live.jsonl
grep -cE '"action":"(buyEth|sellEth)"' out/arb-live.jsonl
grep -c '"status":"success"' out/arb-live.jsonl
grep -c '"action":"stale"' out/arb-live.jsonl
grep -c txHash out/noise-live.jsonl
```
Expected: about 20 `applied` runs and few others; arbitrage decisions on both pools, swaps whose receipts are `success`, few `stale`; retail swaps in pairs (V then S); the status watch never showing `PROBLEM`.

Done on 2026-10-06 without stopping the stack, which kept running as the live demo: the session log gives the first 5 min of `cre-loop` (8 `applied` runs plus 1 recorded `not-applied` that landed on chain, 12 arbitrage swaps all `success`, 0 `stale`, 8 retail swaps mirrored V then S, no `PROBLEM`).

- [x] **Step 5: Security demos**

Run: `cd bots && bun run forge-report --pair live`
Expected: `SIM guard held: forged report rejected` (exit 0). Then follow run-book section 5 "Circuit breaker" and note the times: loop stopped, `blind` seen, `normal` again.

- [x] **Step 6: Log the results**

Append under `## Build notes` in today's session log, with the numbers from Steps 4 and 5:

```markdown
- (ops) Live smoke test (plan 04 Task 23): <n> applied CRE reports in 10 min, first tx <0x...>; arbitrage swaps <n>, stale <n>; retail swaps <n>; forged report rejected (tx <0x...>); blind <t> s after the last report, normal again <t> s after restarting the loop.
```

- [x] **Step 7: Commit the results**

```bash
git add docs/sessions/
git commit -m "docs(ops): live Sepolia smoke test results"
```
(The result line went into `docs/sessions/2026-10-06.md` with commit `d64dae4`, "feat(cre): broadcast risk reports to the live RiskDesk on Sepolia; config sync and latency tools", not with a commit of its own.)

---

### Task 24: Replay smoke test

**Delegable:** no (needs the keys and `cre login`)
**Depends on:** plan 03 (`lab/out/replay-window.json`), plan 01 Task 18 (replay desk with the REPLAY flag, replay hook and pools in `sepolia.json`), plan 02 Tasks 10 and 12 (replay config, localhost reachability answered), Task 23

**Files:**
- Modify: today's session log

- [x] **Step 1: Validate the window and start the server**

Run: `cd bots && bun run replay-server`
Expected: the three `[replay]` lines of run-book section 4 with `16200 s from 2026-02-04T11:30:00.000Z, main start 2026-02-04T12:00:00.000Z`. A validation error (`replay window: ...`) means plan 03's export does not follow contract 7: fix the export.

- [x] **Step 2: Check the klines as plan 02 reads them**

Run: `curl -s "http://127.0.0.1:8787/venue/kraken/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20" | python3 -c "import json,sys,time; k=json.load(sys.stdin); print(len(k), int(time.time()) - k[-1][0] // 1000)"` and `curl -s http://127.0.0.1:8787/status`
Expected: `20` and a number between 0 and 59, then a status with `"done":false` and `histNow` between 1770206400 and 1770220800.

- [x] **Step 3: One recorded replay run, then the replay stack**

Run: `cd bots && ENV_FILE=.env.replay bun run cre-loop --pair replay --once`
Expected: `[sim-loop replay] run <time>: applied tx 0x... ... forwarderResult true` (`ENV_FILE=.env.replay` makes plan 02's loop sign with the replay desk's own operator key, plan 01 Task 18; without it every replay run is `not-applied`). If the run's log shows `source dropped: replay <venue>: ...` for all four venues, the simulator cannot reach 127.0.0.1: apply the tunnel fallback of run-book section 4 (plan 02 Task 12 records which case holds).

Then start `ENV_FILE=.env.replay bun run cre-loop --pair replay` (its own key: it can run at any moment next to the live loop), `bun run arb --pair replay` and `bun run noise --pair replay`. After five minutes: `curl -s localhost:8787/status` shows `progress` growing, and `bun run status --pair replay` shows the replay desk reporting with `flags 2` and the V fee following the replay volatility.

- [x] **Step 4: Log and commit**

Append under `## Build notes` in today's session log:

```markdown
- (ops) Replay smoke test (plan 04 Task 24): replay desk fed through `/venue/<venue>/api/v3/klines`, first tx <0x...>; V fee <a> -> <b> pips over the first <m> minutes while S stays at <s> pips.
```

```bash
git add docs/sessions/
git commit -m "docs(ops): replay smoke test results"
```

---

## Self-review

Performed after writing the plan, and again after aligning it with plan 02 and the spec.

**1. Spec coverage**

| Requirement | Task |
|---|---|
| `shared/` package (package.json, tsconfig) | 1, 2 |
| `units.ts`: annual sigma <-> sigmaE9, pips <-> bp, fee formula mirror with the shared vectors, hook mode mirror (spec 3.6) | 2 (vectors listed in contract 3 for plan 01) |
| `index.ts` loaders for deployments, params and ABIs, typed with viem types | 5, 6 |
| Exact ABI fragments for `PoolSwapTest.swap` and `StateView.getSlot0`, checked against the deployed selectors; drift check against compiled ABIs | 5 |
| `arb.ts`: per block slot0 of V and S through StateView, market price (same venues as CRE, or the replay server), `quoteFee` for V and the static fee for S, trade only outside the band, exact-input swap through PoolSwapTest with the band-edge limit, token order and decimals | 3, 9, 10, 11, 13, 14 |
| `noise.ts`: Poisson flow, random side, log-normal size, mirrored to both pools (spec 3.8), 50/50 and cheaper-pool variants, seeded | 8, 12, 15 |
| `sim-loop.ts` (`bun run cre-loop`): `cre workflow simulate --broadcast` every 30 s, non-interactive (through plan 02's loop), receipts, `bots/out/cre-runs.jsonl`, per-run transcripts | 16, 17, 23 |
| `replay-server.ts`: plan 02's wall-clock `GET /venue/<venue>/api/v3/klines`, historical klines, ticker, diagnostic `/snapshot`, 1x real time; localhost reachability and tunnel fallback | 18, 19, 24, run-book section 4 |
| Funding and approvals script | 20 |
| Run-book with exact commands and expected logs | 22 |
| TDD of the pure logic: price math with decimals and token order, arbitrage decision, price limit, Poisson generator with a seed, loop output parsing, replay endpoints | 3, 8, 10, 12, 16, 18 |
| Security demos (forged report, circuit breaker) | 21, run-book section 5, 23 |
| Decisions, answers and measurements logged with exact lines | 1, 6, 17, 23, 24 |

**2. Placeholder scan:** every code step contains the complete file; there is no "TBD", "TODO" or "similar to". Angle-bracket fields appear only where a value is measured at run time (session-log lines of Tasks 23 and 24, run-book prose such as `<hash>`).

**3. Type and name consistency:** `PairName`, `PoolEntry`, `ResolvedPair` (`V`, `S`, `hook`, `desk`, `tETH`, `tUSD`), `TokenEntry`, `PairOrientation`, `DeskState`, `HookParams`, `ClimParams`, `Balances` (`native`, `ethToken`, `usdToken`, `ethAllowance`, `usdAllowance`), `RunResult` and `Snapshot` are defined once and used with the same names everywhere. Deployment keys (`tokens.tETH/tUSD`, `riskDesks.live/replay/don`, `hooks.live/replay`, `pools.*`, `routers.arb`) match plan 01's writer and plan 05's parser; plan 02's `sync-config.ts` adapts its `KEYS` (contract 1). Script names (`cre-loop`, `arb`, `noise`, `forge-report`, `fund`, `status`, `replay-server`) are canonical; plans 02 and 06 use them (plan 00 integration pass). ABI names match between `abis.ts`, `chain.ts`, the bots and the scripts. Environment names are identical in `env.ts`, the scripts, `bots/.env.example` and the run-book (`<ROLE>_<PAIR>_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`, `SEPOLIA_RPC_URL`, `NOISE_*`, `REPLAY_*`, `FUND_*`, `MINT_TETH`, `MINT_TUSD`, `CRE_PROJECT_DIR`). The report field order is identical in `report.ts`, `riskDeskAbi.RiskReported`, plan 02 and the spec. Test counts in the steps are the counts measured on the validated code.
