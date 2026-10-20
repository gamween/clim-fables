# clim Frontend (Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status (read first; fixer pass, 2026-10-06).** Tasks 1 to 24 of this plan, plus the Frontend scope upgrade decided by the maintainer (wallet connect, core `/swap` and `/lp` pages, session log 2026-10-06), were executed after kickoff in the private repository DVB-ANS/clim-front (local clone `~/Development/hackathons/clim-front`, its root is this plan's `app/`, first commit 2026-10-06 20:24 SGT). Its own `docs/sessions/2026-10-06.md` records the deviations from the code below: design tokens instead of raw Tailwind colours, wagmi 2.19.5 + RainbowKit 2.2.11 + TanStack Query 5 (the "viem only" choice is reversed), `CLIM_ROOT` for `npm run sync`, `/swap` and `/lp` with a simulated mode until the live pair exists. The dashboard is live at https://clim-zeta.vercel.app (Vercel project `clim`, mock data until Gate B).
> In the clim repository: **do not re-run Tasks 1 to 24.** Master plan Task 14 imports clim-front into `app/` with `git subtree` (history kept, so the commit dates stay visible), then runs Task 28 (post-import fixes from the plan review), Task 25 (wire to Sepolia), Task 27 (check `/swap` and `/lp` on Sepolia) and Task 26 (freeze). Tasks 1 to 24 stay below as the reference of what the app does. After the import, the app changes only in `clim/app/`. **Status 2026-10-07:** imported at clim-front `d05ee94` (subtree `758ab5a`); Tasks 1 to 24 are ticked from clim-front's history (each task names its commit and what differs today), Tasks 25 to 28 were done in clim, and the live URL reads Sepolia.

**Goal:** A basic but functional public dashboard (live URL on Vercel) that shows how clim computes its fee from the Chainlink CRE risk desk, compares the clim pool V with its static twin S from on-chain logs, checks the model's arbitrage-frequency prediction, and presents the lab's Feb 4 2026 replay and backtests; restyled later.

**Architecture:** Next.js App Router app in `app/`, fully static pages with client-side data loading. All chain data comes from logs (`RiskDesk.RiskReported`, `PoolManager.Swap`, forwarder `ReportProcessed`) fetched with viem through public Sepolia RPCs in 5,000-block chunks, then turned into series by pure, unit-tested functions (`app/src/lib/*`). Before the contracts exist, a deterministic mock chain produces ABI-encoded logs that go through the same decoders, so switching to Sepolia changes only the data source. `npm run sync` copies `shared/` (addresses, hook parameters), `lab/out/*.json` and `docs/faq.md` into `app/` (fixtures fill the gaps), so Vercel builds `app/` on its own.

**Tech Stack:** Next.js 16.3.8 (Turbopack), React 19.2, TypeScript 5, Tailwind CSS 4, Recharts 3.10.1, viem 2.57.3, wagmi 2.19.5 + @rainbow-me/rainbowkit 2.2.11 + @tanstack/react-query 5 (wallet, added by the Frontend scope upgrade in clim-front), react-markdown 10.1 + remark-gfm 4, Vitest 5.0.3, tsx 4.23 (scripts), Vercel CLI.

---

## Conventions (read once)

- **Working directory.** Every command runs from the repository root (`~/Development/hackathons/clim`). Commands that run inside the app are written `(cd app && …)`.
- **Hackathon rule.** All code in this plan is written after the hackathon kickoff (rule in `CLAUDE.md`). It was drafted and validated in a throwaway scratch project the same day; it is typed into the repo by executing this plan.
- **Living document.** If reality differs (a version, an address, a schema chosen by another plan), change the code, update this plan in the same commit, and add one line to today's session log (`docs/sessions/<YYYY-MM-DD>.md`, same headings as `docs/sessions/2026-10-06.md`).
- **Docs and UI text are in English.** No secrets anywhere in `app/`: the only env vars are `NEXT_PUBLIC_*` testnet settings.
- **Never edit generated files by hand:** `app/src/generated/*` and `app/public/data/lab/*` are written by `npm run sync`, `app/src/fixtures/lab/*` by `npm run fixtures`, `app/public/data/chain/*` by `npm run snapshot`. All of them are committed (Vercel builds from the committed tree).
- **Why these libraries.**
  - *Recharts 3*: declarative React components with what the key picture needs out of the box (step lines `type="stepAfter"`, synced tooltips across stacked charts with `syncId`, range areas for the model band, `ReferenceArea` for blind-mode shading, scatter dots on the same axes). After downsampling, series stay under 1,500 points, which SVG handles. Rejected: uPlot (faster canvas but imperative, needs a hand-written React wrapper), TradingView lightweight-charts (time axis only, cannot draw fee against σ), visx (too low-level for the time we have).
  - *wagmi 2 + RainbowKit* (reversed from the first "viem only" choice by the Frontend scope upgrade): `/swap` and `/lp` are core pages for judges with any wallet. RainbowKit 2.2.11 supports wagmi 2 only (not wagmi 3), so the app pins wagmi 2.19.5 on the same viem 2.57.3; injected wallets work without a WalletConnect project id, and `NEXT_PUBLIC_WC_PROJECT_ID` adds WalletConnect-based wallets (clim-front session log, "Wallet stack").
- **Charts follow one color per entity on every chart** (V blue `#2a78d6`, S orange `#eb6834`, σ aqua `#1baf7a`, secondary series gray), never two y-axes (the σ chart and the fee chart are stacked with a shared time axis), status colors only with an icon and a label.

## Dependencies on other plans (gates)

| Needs | From | Used by |
|---|---|---|
| nothing | | Tasks 1 to 24: everything runs on fixtures and the mock chain |
| `shared/deployments/sepolia.json` with the live desk, hook, pools, `deployBlock` and `routers.arb`; `shared/abis/RiskDesk.json`, `shared/abis/ClimHook.json` | plan 01 (contracts; file created by plan 04) | Task 25 |
| `shared/params.json` (the P\* decision) | plan 03 (lab), written before the hook is deployed | Task 25 |
| `lab/out/summary.json`, `lab/out/replay-2026-02-04.json` (the replay file is read by plan 06 too), `lab/out/ptrade-band.json` (shapes fixed here and written by plan 03's Tasks 17, 19, 20) | plan 03 (lab) | Task 25 |
| RiskReported events flowing every 30 s; arbitrage and retail bots swapping on V and S | plans 02 and 04 | Tasks 25 and 26 |
| `docs/faq.md` (already in the repo) | plan 00 / 06 | Task 13 (sync) |
| The live URL and screenshots of the weather chart | consumed by plan 06 (README, deck) | Tasks 24 and 26 |

## Interfaces this plan consumes (reconcile here first)

These are the exact shapes the app parses. If another plan writes a different shape, change only the named parser and its test fixture, then log the change.

1. **`shared/deployments/sepolia.json`** in the shape fixed by plan 04 (its "Contracts with other plans" §1 and Task 6), parsed by `parseDeployments` in `app/src/lib/deployments.ts` (Task 6), which maps it to the app's own `Deployments` / `PairDeployment` types (so only this parser changes if the file changes):
   - `chainId` 11155111; `deployBlock` (number, required once a pair is deployed: log scans start there); `uniswap.{poolManager,stateView,poolSwapTest,poolModifyLiquidityTest}`; `cre.{mockForwarder,keystoneForwarder}`;
   - `tokens.tETH` / `tokens.tUSD`: `{ address, symbol, decimals }` or null;
   - `riskDesks.{live,replay}`, `hooks.{live,replay}`: address or null;
   - `pools.{liveV,liveS,replayV,replayS}`: `{ key: { currency0, currency1, fee, tickSpacing, hooks }, poolId, token0IsEth }` or null. The parser recomputes `poolId = keccak256(abi.encode(key))` and throws on a mismatch;
   - plan 01 adds `deployer`, `riskDesks.don` and `liquidity`, which the app ignores;
   - **one addition requested by this plan:** `"routers": { "arb": "<address>" }` (see 2).

   A pair (`live` or `replay`) is used once its desk, hook and both pools are non-null; until then the dashboard runs on mock data.
2. **Arbitrage identification (implemented in plans 01 and 04 by the plan 00 integration pass).** A swap counts as arbitrage when `Swap.sender == routers.arb`. `Swap.sender` is the contract that called `PoolManager.swap`, i.e. the router; plan 04 currently sends both the arbitrage and the retail swaps through the canonical PoolSwapTest, which makes them indistinguishable from logs. Implemented: plan 01's `00_Tokens` deploys a second `PoolSwapTest` (`new PoolSwapTest(IPoolManager(poolManager))`, v4-core `src/test/PoolSwapTest.sol`) and `05_WriteDeployments` records it as `routers.arb`; plan 04's arbitrage bot (`fund.ts` approvals and `arb.ts` swaps) uses `routers.arb` instead of `uniswap.poolSwapTest`, and nothing else uses it. This keeps the design's promise that the attribution is recomputable from logs alone. Until `routers.arb` exists, the Validation and P&L panels say so instead of showing numbers.
3. **Arbitrage valuation.** `pnlExplain` (Task 10) recovers the arbitrageur's reference price from the post-swap price, because plan 04's bot pushes the pool exactly to the edge of the no-arbitrage band `[m(1 - f), m / (1 - f)]` with an exact-input swap whose price limit binds: `m = P_after / (1 - f)` after a buy of ETH, `m = P_after · (1 - f)` after a sale.
4. **`shared/params.json`** (spec §2.6): `pStar, etaE4, sqrtHalfDtE6, feeMinPips, feeMaxPips, feeSafePips, tauKillSec, decidedBy`, parsed by `parseParams` (Task 6). The lab also writes `staticFeePips`, `replayStaticFeePips` and `decidedAt`; the parser ignores them.
5. **`shared/abis/RiskDesk.json`, `shared/abis/ClimHook.json`**: a bare ABI array or a Foundry artifact with an `abi` key. Task 4's drift test checks the hand-written fragments against them when they exist.
6. **Lab outputs** (typed and parsed in `app/src/lib/lab.ts`, Task 7), written by plan 03 exactly in these shapes (its "Output contracts"). `summary.json` is the app's condensed view of the same numbers plan 06 reads from `backtest-summary.json`; `replay-2026-02-04.json` is one file that carries both plan 06's `points[]` and the columnar arrays below, so the README, the deck and the dashboard show the same numbers:
   - `lab/out/summary.json`: `generatedAt`, `setting {pStar, feeMinPips}`, `comparisons {equalAvgFee[], equalTraderCost[]}` of `{period, arbChangePct}`, `pTrade[]` of `{period, predicted, observed, blocks}`, `replay {window, sigmaMinPct, sigmaMaxPct, feeVMinBp, feeVMaxBp, feeSBp, arbChangePct, arbChangeRangePct[2], pTradePredicted, pTradeObserved}`, `lpGain {fullRangeEthPctPerYear[2], volatileAssetPctPerYearMax, shareFromTop5WeeksPct}`, `modelSeverityRatio[2]`, `inPoolVolGainSharePct[2]`;
   - `lab/out/replay-2026-02-04.json`: `{ window {startUtc, endUtc}, t[], sigmaAnnualPct[], feeVBp[], feeSBp, arbCumVUsd[], arbCumSUsd[] }`, arrays of equal length, plus an **optional** `price[]` (ETH/USD) that the app draws when present (requested from plan 03);
   - `lab/out/ptrade-band.json`, **defined by this plan** for plan 03: `{ generatedAt, windowBlocks: 300, method, grid: [{ p, lo95, hi95, lo99, hi99 }] }`, `grid` ascending in `p`: for a predicted per-block frequency `p`, the 2.5/97.5% and 0.5/99.5% quantiles of the observed frequency over `windowBlocks` blocks, simulated with the clustered arbitrage of spec §7.3.

   Fractions for P_trade and `pStar`, percent for every `*Pct` field, bp for fees. If plan 03 writes other shapes, the reconciliation edits `lab.ts`, its test and `scripts/make-fixtures.ts`.
7. **Events** (verified on Sepolia): `Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)`, topic `0x40e9cecb…7112f`, where amount0/amount1 are the **swapper's** deltas (negative = paid into the pool) despite the natspec; `ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)`, topic `0x3617b009…16b5`; `RiskReported` as in spec §3.5. `zone`: 0 not evaluated, 1 green, 2 yellow, 3 red.
8. **TestToken** (plan 01 Task 7): `faucet()` with no argument, public, 10 tETH or 25,000 tUSD per address once per hour (`FaucetCooldown(uint256 nextAt)` otherwise); `mint` stays owner-only. `/lp` calls `faucet()` on both tokens; Task 28 adds `faucetAmount()`, `lastFaucetAt(address)` and the error to `testTokenAbi`.
9. **Workspace (plan 04 contract §9, declined on purpose).** Plan 04 proposes adding `app` to the root Bun workspace and importing `@clim/shared`. This plan keeps `app/` a standalone npm project that Vercel deploys on its own: `npm run sync` copies the JSON sources of truth (`shared/deployments/sepolia.json`, `shared/params.json`, `lab/out/*.json`, `docs/faq.md`) into `app/`, and the few TypeScript helpers the app needs (`feePips`/`quoteFee`, unit conversions, ABI fragments) are small ports checked against the same test vectors (spec §2.4, plan 04 §3) and, for ABIs, against `shared/abis/*.json` (Task 4). Reason: a Vercel deployment of a Bun monorepo with a transpiled workspace package could not be validated here, while this layout was built and tested end to end. Do not add `"app"` to the root `workspaces`. A root `package.json` + `bun.lock` above `app/` was tested: `next build` in `app/` is unaffected.

## File structure

All paths are under `app/`. The Frontend scope upgrade added, in clim-front: `src/lib/{wallet,swap,liquidity,tx}.ts` (wagmi config, swap planning, full-range position math and fees owed, transaction steps) with their tests, `src/hooks/{useTxFlow,useChainSteps,useLpState,useStored}.ts`, `src/components/{WalletProviders,WalletButton,SwapForm,LiquidityBoard,LiquidityForm,PositionPanel,FaucetCard,TxSteps,TxModeSwitch}.tsx` and the pages `src/app/swap/page.tsx` and `src/app/lp/page.tsx`. Task 28 adds `src/lib/labText.ts` (rounded lab numbers, dollars per $1M, the replay-window note) and its test. clim-front also split the routes into two groups: `src/app/(site)/page.tsx` is the landing at `/`, and `src/app/(app)/{app,replay,lab,how,swap,lp,credits}/page.tsx` share the app header of `src/app/(app)/layout.tsx`, so the dashboard is at `/app`.

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `AGENTS.md`, `CLAUDE.md` | Scaffold from create-next-app 16.3.8 (AGENTS.md/CLAUDE.md are Next's agent rules, regenerated by `next dev` if missing, so they are committed) |
| `vitest.config.mts` | Vitest: node environment, `@/` alias |
| `.env.example` | `NEXT_PUBLIC_SEPOLIA_RPC_URL` (optional RPC override), `NEXT_PUBLIC_CLIM_SOURCE` (`mock` forces mock data), `NEXT_PUBLIC_WC_PROJECT_ID` (optional, adds WalletConnect wallets) |
| `src/lib/units.ts` | σ annual ↔ sigmaE9, pips ↔ bp, ticks ↔ ETH/USD, display formatters |
| `src/lib/feeMath.ts` | TS port of `ClimFeeMath.feePips` and `ClimHook.quoteFee` (modes normal, degraded, blind) |
| `src/lib/abis.ts` | Human-readable ABI fragments and event topics (RiskDesk, ClimHook, PoolManager, StateView, PoolSwapTest, forwarders, TestToken) |
| `src/lib/encode.ts` | `RawLog` type; ABI-encodes RiskReported, Swap and ReportProcessed logs (mock data and tests) |
| `src/lib/decode.ts` | Raw logs → `DeskReport`, `SwapRow`, `Delivery`; `lastAtOrBefore` binary search |
| `src/lib/deployments.ts` | Types and parsers for `shared/deployments/sepolia.json` and `shared/params.json`; `computePoolId` |
| `src/lib/lab.ts` | Lab output types and parsers (`summary.json`, `replay-2026-02-04.json`, `ptrade-band.json`), `replayRows`, `bandAt` |
| `src/lib/series.ts` | Weather series (σ and the fee step function), swap fee dots, blind episodes, time-average fee, downsampling |
| `src/lib/ptrade.ts` | Predicted P_trade, block clock, per-block predictor, rolling observed vs predicted, totals, σ_arb |
| `src/lib/pnl.ts` | LP P&L explain per pool (FEE_retail, FEE_arb, ARB, LVR), σ_BE, recent-swap rows |
| `src/lib/chain.ts` | viem client with RPC fallback, chunked `eth_getLogs`, log merge, snapshot schema, pair state reads |
| `src/lib/mock.ts` | Deterministic mock chain (6 h with a storm, a degraded window, a blind gap, a forged report) |
| `src/lib/config.ts` | Parsed deployments and params from `src/generated/`, data-source choice |
| `src/lib/labData.ts` | Parsed lab outputs from `public/data/lab/` (server components only) |
| `src/lib/theme.ts` | Entity colors, mode styles, UTC time labels |
| `src/hooks/useClimData.ts` | Client hook: snapshot + incremental log polling (Sepolia) or mock regeneration |
| `src/components/ui.tsx` | Panel, Stat, ModeBadge, FixtureNote, TxLink, Toggle |
| `src/components/DeskPanel.tsx`, `QuotePanel.tsx`, `FeeCurveChart.tsx`, `WeatherChart.tsx`, `ValidationPanel.tsx`, `VolQuadPanel.tsx`, `PnlPanel.tsx`, `SafetyPanel.tsx`, `RecentSwapsPanel.tsx`, `Dashboard.tsx` | Dashboard panels |
| `src/components/ReplayCharts.tsx`, `ReplayPanel.tsx`, `BacktestTable.tsx` | `/lab` and `/replay` pages |
| `src/components/SwapForm.tsx` | `/swap` page (core since the Frontend scope upgrade) |
| `src/app/layout.tsx`, `globals.css`, `(site)/page.tsx`, `(app)/layout.tsx`, `(app)/{app,replay,lab,how,swap,lp,credits}/page.tsx` | Routes (as built, route groups): `/` landing, `/app` live dashboard, `/replay` the Feb 4 storm (lab replay, plus the on-chain replay pair), `/lab` backtests, `/how` explanation and FAQ, `/swap` and `/lp`, `/credits` third-party notices |
| `src/fixtures/deployments.sepolia.json`, `params.json`, `faq.md`, `lab/*.json` | Fixtures used until the real files exist |
| `src/generated/sepolia.json`, `params.json`, `faq.ts` | Written by `npm run sync` |
| `public/data/lab/*.json` | Written by `npm run sync`; served at `/data/lab/*.json` |
| `public/data/chain/<pair>.json` | Written by `npm run snapshot` (frozen log history) |
| `scripts/sync-data.mjs` (+ `.test.ts`), `scripts/make-fixtures.ts`, `scripts/snapshot.ts` | Data plumbing |

---
### Task 1: Scaffold the Next.js app

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `7f416ef`. Differences: the root `src/app/layout.tsx` now loads the fonts, `WalletProviders` and `MotionProvider`, and the nav lives in `src/app/(app)/layout.tsx` (`AppHeader.tsx`); the Task 1 home stub became the landing `src/app/(site)/page.tsx`; colours are design tokens in `globals.css`; `.env.example` also has `NEXT_PUBLIC_WC_PROJECT_ID`; `app/README.md` is a later README (`c924078`, how to run and go live), not the scaffold's. The Step 7 line is in `docs/sessions/2026-10-06.md` ("Frontend build log"), marked as superseded for "viem only".

**Delegable:** yes
**Depends on:** nothing

**Files:**
- Create: `app/` (create-next-app), `app/vitest.config.mts`, `app/.env.example`, `app/src/lib/smoke.test.ts`
- Modify: `app/package.json` (deps, scripts), `app/tsconfig.json` (target), `app/.gitignore`, `app/src/app/layout.tsx`, `app/src/app/globals.css`, `app/src/app/page.tsx`
- Delete: `app/public/*.svg`, `app/README.md`

- [x] **Step 1: Create the app**

```bash
npx -y create-next-app@16.3.8 app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --no-react-compiler --yes
```
Expected: ends with `Success! Created app at ~/Development/hackathons/clim/app`. It pins `next` 16.3.8 and `react` 19.2.8 and writes `app/AGENTS.md` + `app/CLAUDE.md` (Next.js agent rules: keep them). If the install step fails with `ETIMEDOUT`, run `(cd app && npm install --fetch-retries=5 --fetch-timeout=180000)`.

- [x] **Step 2: Add the dependencies**

```bash
(cd app && npm install --fetch-retries=5 viem@2.57.3 recharts@3.10.1 react-markdown@10.1.0 remark-gfm@4.0.1)
(cd app && npm install -D --fetch-retries=5 @types/node@^22 vitest@5.0.3 tsx@4.23.15)
```
Expected: both end with `found 0 vulnerabilities` or an audit summary, no `ERESOLVE`. (`@types/node` must move from ^20 to ^22: Vitest 5 declares the peer `@types/node ^22 || >=24`, and npm refuses the install otherwise.)

- [x] **Step 3: Scripts, TypeScript target, cleanup**

```bash
(cd app && npm pkg set name=clim-app scripts.typecheck="tsc --noEmit" scripts.test="vitest run" scripts.sync="node scripts/sync-data.mjs" scripts.fixtures="tsx scripts/make-fixtures.ts" scripts.snapshot="tsx scripts/snapshot.ts")
sed -i '' 's/"target": "ES2017"/"target": "ES2020"/' app/tsconfig.json
rm app/public/*.svg app/README.md
printf '\n!.env.example\n' >> app/.gitignore
printf 'NEXT_PUBLIC_SEPOLIA_RPC_URL=\nNEXT_PUBLIC_CLIM_SOURCE=\n' > app/.env.example
```
ES2020 is required for bigint literals (`10n`) under `tsc`. The `.gitignore` line re-includes `.env.example`, which the scaffold's `.env*` rule would hide.

- [x] **Step 4: Vitest config and a smoke test**

Create `app/vitest.config.mts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
```

Create `app/src/lib/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs vitest with bigint support", () => {
    expect(2n ** 64n).toBe(18446744073709551616n);
  });
});
```

- [x] **Step 5: Replace the scaffold's layout, styles and home page**

The scaffold's `layout.tsx` uses the `LayoutProps` global that only exists after `next build`/`next dev` typegen, so `npm run typecheck` fails on a fresh clone; the version below does not need it.

Create (overwrite) `app/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "clim: storm insurance for Uniswap v4 LPs",
  description: "A Chainlink CRE risk desk publishes ETH volatility on-chain; a Uniswap v4 hook turns it into the LP fee on every swap.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/replay", label: "Replay" },
  { href: "/lab", label: "Lab" },
  { href: "/how", label: "How it works" },
];

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-black/10 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold">clim</Link>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm text-neutral-700 hover:text-black">{n.label}</Link>
            ))}
            <span className="ml-auto text-xs text-neutral-500">Ethereum Sepolia · Chainlink CRE · Uniswap v4</span>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
```

Create (overwrite) `app/src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  --background: #f9f9f7;
  --foreground: #0b0b0b;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

Create (overwrite) `app/src/app/page.tsx` (replaced by the dashboard in Task 20):

```tsx
export default function Home() {
  return <h1 className="text-2xl font-bold">clim</h1>;
}
```

- [x] **Step 6: Run every check**

```bash
(cd app && npm test && npm run typecheck && npm run lint && npm run build)
```
Expected: `Tests  1 passed (1)`; `tsc` and `eslint` print nothing; the build ends with the route table `○ /` and `○ /_not-found` marked `(Static)`.

- [x] **Step 7: Log the decision**

Append under `## Decisions` in today's session log:

```markdown
- **Frontend stack (plan 05):** Next.js 16.3.8 (App Router, Turbopack), React 19.2, Tailwind 4, Recharts 3.10 for charts, viem 2.57 only (no wagmi: the optional test-swap page needs one injected wallet), Vitest 5 for the pure transforms. `npm run sync` copies shared/, lab/out and docs/faq.md into app/, so Vercel builds app/ alone.
```

- [x] **Step 8: Commit**

```bash
git add app docs/sessions
git commit -m "chore(app): scaffold Next.js 16 dashboard with vitest"
```

---

### Task 2: Unit conversions and formatters

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `74c7686`. `units.test.ts` has 9 tests today (7 at this commit; `5cd934f` added the amount formatters).

**Delegable:** yes
**Depends on:** Task 1

**Files:**
- Create: `app/src/lib/units.ts`
- Test: `app/src/lib/units.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/units.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  annualPctToSigmaE9,
  dvolE2ToPct,
  ethUsdToTick,
  formatAge,
  formatBp,
  formatPct,
  formatUsd,
  pipsToBp,
  shortHash,
  sigmaE9ToAnnualPct,
  tickToEthUsd,
} from "./units";

describe("sigma conversions", () => {
  it("48%/yr is sigmaE9 85,475 (design check value)", () => {
    expect(annualPctToSigmaE9(48)).toBe(85_475);
    expect(sigmaE9ToAnnualPct(85_475)).toBeCloseTo(48, 3);
  });
  it("10%/yr is sigmaE9 17,807 (RiskDesk SIGMA_MIN_E9)", () => {
    expect(annualPctToSigmaE9(10)).toBe(17_807);
  });
});

describe("fee units", () => {
  it("1 bp = 100 pips", () => {
    expect(pipsToBp(1_922)).toBeCloseTo(19.22, 10);
    expect(pipsToBp(500)).toBe(5);
  });
  it("formats bp with one decimal by default", () => {
    expect(formatBp(19.22)).toBe("19.2 bp");
    expect(formatBp(5, 0)).toBe("5 bp");
  });
});

describe("other units", () => {
  it("DVOL is stored x100", () => {
    expect(dvolE2ToPct(4_825)).toBe(48.25);
  });
  it("ticks round-trip with the ETH/USD price in both pool orientations", () => {
    const t = ethUsdToTick(2_500, true);
    expect(t).toBe(78_244);
    expect(tickToEthUsd(t, true)).toBeCloseTo(2_500, -1);
    expect(ethUsdToTick(2_500, false)).toBe(-78_244);
    expect(tickToEthUsd(-78_244, false)).toBeCloseTo(2_500, -1);
  });
  it("formats percent, usd, age and hashes", () => {
    expect(formatPct(48.04)).toBe("48.0%");
    expect(formatUsd(1234.4)).toBe("$1,234");
    expect(formatUsd(-56.7)).toBe("-$57");
    expect(formatAge(42)).toBe("42 s");
    expect(formatAge(185)).toBe("3 min 05 s");
    expect(formatAge(7_800)).toBe("2 h 10 min");
    expect(shortHash("0x7cd1bd67280cc7c7e96c3fff4e956c708043d6091972c78c9536d7711587fe63")).toBe("0x7cd1…fe63");
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/units.test.ts)`
Expected: `FAIL  src/lib/units.test.ts`, `Error: Cannot find module './units' imported from …/app/src/lib/units.test.ts`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/units.ts`:

```ts
// Unit conventions shared with contracts/ and cre/ (see shared/src/units.ts).
// sigmaE9 = per-sqrt-second volatility x 1e9; 1 bp = 100 pips; MAX_LP_FEE = 1,000,000 pips.

export const SECONDS_PER_YEAR = 31_536_000;
export const SQRT_SECONDS_PER_YEAR = Math.sqrt(SECONDS_PER_YEAR);
export const PIPS_PER_BP = 100;
const LN_TICK_BASE = Math.log(1.0001);

export function sigmaE9ToAnnualPct(sigmaE9: number): number {
  return (sigmaE9 / 1e9) * SQRT_SECONDS_PER_YEAR * 100;
}

export function annualPctToSigmaE9(pct: number): number {
  return Math.round((pct / 100 / SQRT_SECONDS_PER_YEAR) * 1e9);
}

export function pipsToBp(pips: number): number {
  return pips / PIPS_PER_BP;
}

export function dvolE2ToPct(dvolE2: number): number {
  return dvolE2 / 100;
}

/** Pool price of token0 in token1 is 1.0001^tick (tETH and tUSD both have 18 decimals). */
export function tickToEthUsd(tick: number, token0IsEth: boolean): number {
  return Math.exp((token0IsEth ? tick : -tick) * LN_TICK_BASE);
}

export function ethUsdToTick(price: number, token0IsEth: boolean): number {
  const t = Math.round(Math.log(price) / LN_TICK_BASE);
  return token0IsEth ? t : -t;
}

export function formatBp(bp: number, digits = 1): string {
  return `${bp.toFixed(digits)} bp`;
}

export function formatPct(pct: number, digits = 1): string {
  return `${pct.toFixed(digits)}%`;
}

export function formatUsd(x: number): string {
  const s = Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${x < 0 ? "-" : ""}$${s}`;
}

export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3_600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3_600)} h ${Math.floor((s % 3_600) / 60)} min`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/units.test.ts)`
Expected: `Tests  7 passed (7)`.

- [x] **Step 5: Commit**

```bash
git add app/src/lib/units.ts app/src/lib/units.test.ts
git commit -m "feat(app): unit conversions and formatters"
```

---

### Task 3: TS port of the fee rule

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `a573c8d`.

**Delegable:** yes
**Depends on:** Task 2

The test vectors are the spec's (§2.4, §2.5, §3.6): 48%/yr at P\* = 10% is ceil(1921.20) = **1,922** pips; the blind rule is `age > tauKillSec` (strict) with `age = now - tObs`.

**Files:**
- Create: `app/src/lib/feeMath.ts`
- Test: `app/src/lib/feeMath.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/feeMath.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FeeMode, feePips, quoteFee, type DeskState, type FeeParams } from "./feeMath";

const SQRT_HALF_DT_E6 = 2_449_490; // sqrt(12 s / 2) * 1e6 (Sepolia)

describe("feePips (TS port of ClimFeeMath.feePips)", () => {
  it("matches the design check value at P* = 10% without clamping: 48%/yr -> ceil(1921.2) = 1922 pips", () => {
    expect(feePips(85_475, 91_761, SQRT_HALF_DT_E6, 10_000, 0, 1_000_000)).toBe(1_922);
  });
  it("P* = 30% (etaE4 25,093): floor 5 bp under ~46%, 11 bp at 100%, 25 bp at 225%", () => {
    expect(feePips(81_913, 25_093, SQRT_HALF_DT_E6, 10_000, 500, 15_000)).toBe(504);
    expect(feePips(44_518, 25_093, SQRT_HALF_DT_E6, 10_000, 500, 15_000)).toBe(500);
    expect(feePips(178_072, 25_093, SQRT_HALF_DT_E6, 10_000, 500, 15_000)).toBe(1_095);
    expect(feePips(400_663, 25_093, SQRT_HALF_DT_E6, 10_000, 500, 15_000)).toBe(2_463);
  });
  it("P* = 20% (etaE4 41,760): 18 bp at 100%, 41 bp at 225%, capped at 150 bp", () => {
    expect(feePips(178_072, 41_760, SQRT_HALF_DT_E6, 10_000, 500, 15_000)).toBe(1_822);
    expect(feePips(400_663, 41_760, SQRT_HALF_DT_E6, 10_000, 500, 15_000)).toBe(4_099);
    expect(feePips(1_780_724, 41_760, SQRT_HALF_DT_E6, 10_000, 500, 15_000)).toBe(15_000);
  });
  it("k = 2 doubles the raw fee before clamping", () => {
    expect(feePips(178_072, 25_093, SQRT_HALF_DT_E6, 20_000, 500, 15_000)).toBe(2_190);
  });
  it("sigma 0 gives the floor", () => {
    expect(feePips(0, 25_093, SQRT_HALF_DT_E6, 10_000, 500, 15_000)).toBe(500);
  });
});

describe("quoteFee (TS port of ClimHook.quoteFee)", () => {
  const p: FeeParams = {
    etaE4: 41_760,
    sqrtHalfDtE6: SQRT_HALF_DT_E6,
    feeMinPips: 500,
    feeMaxPips: 15_000,
    feeSafePips: 3_000,
    tauKillSec: 180,
  };
  const fresh: DeskState = { tObs: 1_000, sigmaE9: 178_072, kE4: 10_000, flags: 0, seq: 7 };

  it("normal mode returns the formula fee", () => {
    expect(quoteFee(fresh, 1_100, p)).toEqual({ feePips: 1_822, mode: FeeMode.Normal });
  });
  it("age exactly tauKillSec is still normal", () => {
    expect(quoteFee(fresh, 1_180, p).mode).toBe(FeeMode.Normal);
  });
  it("age above tauKillSec is blind: max(fee, feeSafe)", () => {
    expect(quoteFee(fresh, 1_181, p)).toEqual({ feePips: 3_000, mode: FeeMode.Blind });
    const storm = { ...fresh, sigmaE9: 400_663 };
    expect(quoteFee(storm, 1_181, p)).toEqual({ feePips: 4_099, mode: FeeMode.Blind });
  });
  it("a desk that never reported is blind at feeSafe", () => {
    const never: DeskState = { tObs: 0, sigmaE9: 0, kE4: 0, flags: 0, seq: 0 };
    expect(quoteFee(never, 1_000, p)).toEqual({ feePips: 3_000, mode: FeeMode.Blind });
  });
  it("degraded flag (bit 0) raises the fee to at least feeSafe", () => {
    expect(quoteFee({ ...fresh, flags: 1 }, 1_100, p)).toEqual({ feePips: 3_000, mode: FeeMode.Degraded });
  });
  it("replay flag (bit 1) alone does not change the fee", () => {
    expect(quoteFee({ ...fresh, flags: 2 }, 1_100, p)).toEqual({ feePips: 1_822, mode: FeeMode.Normal });
  });
  it("a report up to 30 s in the future (MAX_SKEW) is not blind", () => {
    expect(quoteFee({ ...fresh, tObs: 1_030 }, 1_000, p).mode).toBe(FeeMode.Normal);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/feeMath.test.ts)`
Expected: `Error: Cannot find module './feeMath' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/feeMath.ts`:

```ts
// TypeScript port of contracts/src/libraries/ClimFeeMath.sol and ClimHook.quoteFee().
// Used to draw the theoretical curve, to rebuild the fee step series from RiskReported logs,
// and to run the app on mock data. The hook on-chain stays the source of truth.

export const FLAG_DEGRADED = 1; // bit 0, set by RiskDesk when dispBp > 25
export const FLAG_REPLAY = 2; // bit 1, set at construction on replay desks

export const FeeMode = { Normal: 0, Degraded: 1, Blind: 2 } as const;
export type FeeMode = (typeof FeeMode)[keyof typeof FeeMode];

export type FeeParams = {
  etaE4: number;
  sqrtHalfDtE6: number;
  feeMinPips: number;
  feeMaxPips: number;
  feeSafePips: number;
  tauKillSec: number;
};

export type DeskState = { tObs: number; sigmaE9: number; kE4: number; flags: number; seq: number };

export type Quote = { feePips: number; mode: FeeMode };

const SCALE = 10n ** 17n;

/** fee_pips = clamp(ceil(sigmaE9 * etaE4 * sqrtHalfDtE6 * kE4 / 1e17), feeMinPips, feeMaxPips) */
export function feePips(
  sigmaE9: number,
  etaE4: number,
  sqrtHalfDtE6: number,
  kE4: number,
  feeMinPips: number,
  feeMaxPips: number,
): number {
  const num = BigInt(sigmaE9) * BigInt(etaE4) * BigInt(sqrtHalfDtE6) * BigInt(kE4);
  const raw = Number((num + SCALE - 1n) / SCALE);
  return Math.min(feeMaxPips, Math.max(feeMinPips, raw));
}

export function quoteFee(s: DeskState, nowSec: number, p: FeeParams): Quote {
  const base = feePips(s.sigmaE9, p.etaE4, p.sqrtHalfDtE6, s.kE4, p.feeMinPips, p.feeMaxPips);
  const blind = s.seq === 0 || nowSec - s.tObs > p.tauKillSec;
  if (blind) return { feePips: Math.max(base, p.feeSafePips), mode: FeeMode.Blind };
  if ((s.flags & FLAG_DEGRADED) !== 0) return { feePips: Math.max(base, p.feeSafePips), mode: FeeMode.Degraded };
  return { feePips: base, mode: FeeMode.Normal };
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/feeMath.test.ts)`
Expected: `Tests  12 passed (12)`.

- [x] **Step 5: Commit**

```bash
git add app/src/lib/feeMath.ts app/src/lib/feeMath.test.ts
git commit -m "feat(app): TS port of ClimFeeMath.feePips and ClimHook.quoteFee"
```

---

### Task 4: ABI fragments and event topics

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `e0c244e`. Today `abis.test.ts` has 10 tests and none skipped: `shared/abis/` exists, so the drift guards run, and the liquidity, position and faucet fragments came with `7920998` and Task 28.

**Delegable:** yes
**Depends on:** Task 1

The expected values were read on Sepolia on 2026-10-06: the Swap topic from PoolManager logs, the `swap` selector `0x2229d0b4` in the bytecode of PoolSwapTest `0x9b6b…6eee`, and the ReportProcessed topic from MockKeystoneForwarder `0x15fC…9F88` logs. The drift tests are skipped until plan 01 exports `shared/abis/`.

**Files:**
- Create: `app/src/lib/abis.ts`
- Test: `app/src/lib/abis.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/abis.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Abi, toEventSelector, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { climHookAbi, poolSwapTestAbi, REPORT_PROCESSED_TOPIC, RISK_REPORTED_TOPIC, riskDeskAbi, SWAP_TOPIC } from "./abis";

describe("ABI fragments", () => {
  it("Swap topic matches PoolManager logs seen on Sepolia", () => {
    expect(SWAP_TOPIC).toBe("0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f");
  });
  it("PoolSwapTest.swap selector matches the deployed PoolSwapTest bytecode", () => {
    const swap = poolSwapTestAbi.find((x) => x.type === "function" && x.name === "swap");
    expect(swap && toFunctionSelector(swap)).toBe("0x2229d0b4");
  });
  it("ReportProcessed topic matches MockKeystoneForwarder logs seen on Sepolia", () => {
    expect(REPORT_PROCESSED_TOPIC).toBe("0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5");
  });
  it("RiskReported topic is derived from the canonical signature", () => {
    expect(RISK_REPORTED_TOPIC).toBe(
      toEventSelector(
        "RiskReported(uint32,uint40,uint32,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)",
      ),
    );
  });
});

// Drift guard: once plan 01 exports shared/abis/*.json, the hand-written fragments must match.
function sharedAbi(name: string): Abi | null {
  const path = fileURLToPath(new URL(`../../../shared/abis/${name}.json`, import.meta.url));
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return (Array.isArray(raw) ? raw : raw.abi) as Abi;
}
function selectors(abi: Abi): string[] {
  return abi.flatMap((x) =>
    x.type === "event" ? [toEventSelector(x)] : x.type === "function" ? [toFunctionSelector(x)] : [],
  );
}

describe("drift against shared/abis", () => {
  const desk = sharedAbi("RiskDesk");
  const hook = sharedAbi("ClimHook");
  it.skipIf(!desk)("RiskDesk.json contains RiskReported and state()", () => {
    const s = selectors(desk!);
    for (const want of selectors(riskDeskAbi)) expect(s).toContain(want);
  });
  it.skipIf(!hook)("ClimHook.json contains quoteFee()", () => {
    const s = selectors(hook!);
    for (const want of selectors(climHookAbi)) expect(s).toContain(want);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/abis.test.ts)`
Expected: `Error: Cannot find module './abis' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/abis.ts`:

```ts
import { parseAbi, toEventSelector } from "viem";

// Canonical interfaces (docs/superpowers/plans/2026-10-06-clim-00-master.md). abis.test.ts checks
// them against shared/abis/*.json when those files exist.

export const riskDeskAbi = parseAbi([
  "event RiskReported(uint32 indexed seq, uint40 tObs, uint32 sigmaApplied, uint32 sigmaReported, uint32 rv15E9, uint16 dvolE2, int24 refTick, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 zone)",
  "function state() view returns (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags, uint32 seq)",
]);

// Chainlink Keystone forwarders (MockKeystoneForwarder and KeystoneForwarder) emit this after every
// delivery attempt; result = false is the on-chain evidence of a rejected (e.g. forged) report.
export const forwarderAbi = parseAbi([
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);

export const climHookAbi = parseAbi(["function quoteFee() view returns (uint24 fee, uint8 mode)"]);

// Note: despite the v4-core natspec, Swap.amount0/amount1 are the SWAPPER's deltas
// (negative = paid into the pool, positive = received), see Pool.swap / PoolManager._swap.
export const poolManagerAbi = parseAbi([
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
]);

export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

export const poolSwapTestAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)",
]);

export const testTokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
]);

export const RISK_REPORTED_TOPIC = toEventSelector(riskDeskAbi[0]);
export const SWAP_TOPIC = toEventSelector(poolManagerAbi[0]);
export const REPORT_PROCESSED_TOPIC = toEventSelector(forwarderAbi[0]);
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/abis.test.ts)`
Expected: `Tests  4 passed | 2 skipped (6)` (the two drift tests run, and must pass, once `shared/abis/RiskDesk.json` and `shared/abis/ClimHook.json` exist).

- [x] **Step 5: Commit**

```bash
git add app/src/lib/abis.ts app/src/lib/abis.test.ts
git commit -m "feat(app): ABI fragments and event topics with drift guard"
```

---

### Task 5: Log encoding and decoding

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `8f9090e`.

**Delegable:** yes
**Depends on:** Task 4

**Files:**
- Create: `app/src/lib/encode.ts`, `app/src/lib/decode.ts`
- Test: `app/src/lib/decode.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/decode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeDeliveries, decodeReports, decodeSwaps, lastAtOrBefore } from "./decode";
import { encodeReportProcessedLog, encodeRiskReportedLog, encodeSwapLog } from "./encode";

const DESK = "0x00000000000000000000000000000000000de5c0";
const PM = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const POOL = "0x203a9d9283af6b2a48fd7e84ad78308008fecfe468f294bba26776f9d7ce62a3";
const ROUTER = "0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe";
const TX = "0x7cd1bd67280cc7c7e96c3fff4e956c708043d6091972c78c9536d7711587fe63";

const report = {
  seq: 12,
  tObs: 1_790_000_000,
  sigmaApplied: 85_475,
  sigmaReported: 90_000,
  rv15E9: 90_000,
  dvolE2: 4_825,
  refTick: 78_244,
  dispBp: 3,
  nSources: 4,
  kE4: 10_000,
  zone: 0,
};

describe("decodeReports", () => {
  it("decodes every RiskReported field plus log metadata, sorted by block then log index", () => {
    const a = encodeRiskReportedLog(report, {
      address: DESK, blockNumber: 101, blockTimestamp: 1_790_000_048, transactionHash: TX, logIndex: 4,
    });
    const b = encodeRiskReportedLog({ ...report, seq: 11 }, {
      address: DESK, blockNumber: 100, blockTimestamp: 1_790_000_036, transactionHash: TX, logIndex: 9,
    });
    const out = decodeReports([a, b]);
    expect(out.map((r) => r.seq)).toEqual([11, 12]);
    expect(out[1]).toEqual({
      ...report,
      blockNumber: 101,
      blockTimestamp: 1_790_000_048,
      latencySec: 48,
      txHash: TX,
      logIndex: 4,
    });
  });
  it("ignores logs with another topic", () => {
    const swap = encodeSwapLog(
      { poolId: POOL, sender: ROUTER, amount0: -1n, amount1: 1n, sqrtPriceX96: 1n, liquidity: 1n, tick: 0, fee: 500 },
      { address: PM, blockNumber: 1, blockTimestamp: 1, transactionHash: TX, logIndex: 0 },
    );
    expect(decodeReports([swap])).toEqual([]);
  });
});

describe("decodeSwaps", () => {
  it("decodes signed amounts, the fee and the pool id", () => {
    const log = encodeSwapLog(
      {
        poolId: POOL,
        sender: ROUTER,
        amount0: -2_000_000_000_000_000_000n,
        amount1: 4_990_000_000_000_000_000_000n,
        sqrtPriceX96: 3_961_408_125_713_216_879_677_197_516_800n,
        liquidity: 20_000_000_000_000_000_000_000n,
        tick: 78_244,
        fee: 1_822,
      },
      { address: PM, blockNumber: 200, blockTimestamp: 1_790_001_000, transactionHash: TX, logIndex: 1 },
    );
    const [s] = decodeSwaps([log]);
    expect(s.poolId).toBe(POOL);
    expect(s.sender).toBe(ROUTER);
    expect(s.amount0).toBe(-2_000_000_000_000_000_000n);
    expect(s.amount1).toBe(4_990_000_000_000_000_000_000n);
    expect(s.fee).toBe(1_822);
    expect(s.tick).toBe(78_244);
    expect(s.liquidity).toBe(20_000_000_000_000_000_000_000n);
    expect(s.blockNumber).toBe(200);
    expect(s.blockTimestamp).toBe(1_790_001_000);
  });
});

describe("lastAtOrBefore", () => {
  it("finds the last row at or before a block", () => {
    const rows = [{ blockNumber: 10 }, { blockNumber: 20 }, { blockNumber: 20 }, { blockNumber: 30 }];
    expect(lastAtOrBefore(rows, 5)).toBe(-1);
    expect(lastAtOrBefore(rows, 10)).toBe(0);
    expect(lastAtOrBefore(rows, 25)).toBe(2);
    expect(lastAtOrBefore(rows, 99)).toBe(3);
  });
});

describe("decodeDeliveries", () => {
  it("decodes forwarder ReportProcessed logs, accepted or rejected", () => {
    const FWD = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";
    const mk = (result: boolean, logIndex: number) =>
      encodeReportProcessedLog(
        { receiver: "0x4000000000000000000000000000000000000004", workflowExecutionId: TX, reportId: "0x0001", result },
        { address: FWD, blockNumber: 300, blockTimestamp: 1_790_002_000, transactionHash: TX, logIndex },
      );
    const out = decodeDeliveries([mk(false, 2), mk(true, 1)]);
    expect(out.map((d) => d.accepted)).toEqual([true, false]);
    expect(out[1]).toMatchObject({ receiver: "0x4000000000000000000000000000000000000004", blockNumber: 300, txHash: TX });
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/decode.test.ts)`
Expected: `Error: Cannot find module './decode' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/encode.ts`:

```ts
import { type Address, encodeAbiParameters, encodeEventTopics, type Hex, numberToHex } from "viem";
import { forwarderAbi, poolManagerAbi, riskDeskAbi } from "./abis";

/** An eth_getLogs entry as returned by the RPC (hex strings), JSON-serialisable for snapshots. */
export type RawLog = {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockTimestamp?: Hex;
  transactionHash: Hex;
  logIndex: Hex;
};

export type RiskReportedArgs = {
  seq: number;
  tObs: number;
  sigmaApplied: number;
  sigmaReported: number;
  rv15E9: number;
  dvolE2: number;
  refTick: number;
  dispBp: number;
  nSources: number;
  kE4: number;
  zone: number;
};

export type SwapArgs = {
  poolId: Hex;
  sender: Address;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  fee: number;
};

export type LogMeta = {
  address: Hex;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: Hex;
  logIndex: number;
};

function meta(m: LogMeta) {
  return {
    address: m.address,
    blockNumber: numberToHex(m.blockNumber),
    blockTimestamp: numberToHex(m.blockTimestamp),
    transactionHash: m.transactionHash,
    logIndex: numberToHex(m.logIndex),
  };
}

export function encodeRiskReportedLog(a: RiskReportedArgs, m: LogMeta): RawLog {
  const topics = encodeEventTopics({ abi: riskDeskAbi, eventName: "RiskReported", args: { seq: a.seq } }) as Hex[];
  const data = encodeAbiParameters(
    [
      { type: "uint40" }, { type: "uint32" }, { type: "uint32" }, { type: "uint32" }, { type: "uint16" },
      { type: "int24" }, { type: "uint16" }, { type: "uint8" }, { type: "uint16" }, { type: "uint8" },
    ],
    [a.tObs, a.sigmaApplied, a.sigmaReported, a.rv15E9, a.dvolE2, a.refTick, a.dispBp, a.nSources, a.kE4, a.zone],
  );
  return { ...meta(m), topics, data };
}

export function encodeSwapLog(a: SwapArgs, m: LogMeta): RawLog {
  const topics = encodeEventTopics({
    abi: poolManagerAbi,
    eventName: "Swap",
    args: { id: a.poolId, sender: a.sender },
  }) as Hex[];
  const data = encodeAbiParameters(
    [
      { type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" },
      { type: "uint24" },
    ],
    [a.amount0, a.amount1, a.sqrtPriceX96, a.liquidity, a.tick, a.fee],
  );
  return { ...meta(m), topics, data };
}

export type ReportProcessedArgs = { receiver: Address; workflowExecutionId: Hex; reportId: Hex; result: boolean };

export function encodeReportProcessedLog(a: ReportProcessedArgs, m: LogMeta): RawLog {
  const topics = encodeEventTopics({
    abi: forwarderAbi,
    eventName: "ReportProcessed",
    args: { receiver: a.receiver, workflowExecutionId: a.workflowExecutionId, reportId: a.reportId },
  }) as Hex[];
  return { ...meta(m), topics, data: encodeAbiParameters([{ type: "bool" }], [a.result]) };
}
```

Create `app/src/lib/decode.ts`:

```ts
import { type Address, decodeEventLog, getAddress, type Hex, hexToNumber } from "viem";
import { forwarderAbi, poolManagerAbi, REPORT_PROCESSED_TOPIC, RISK_REPORTED_TOPIC, riskDeskAbi, SWAP_TOPIC } from "./abis";
import type { RawLog, RiskReportedArgs } from "./encode";

type LogPosition = { blockNumber: number; blockTimestamp: number; txHash: Hex; logIndex: number };

/** One RiskReported event. latencySec = block time of inclusion minus the DON observation time. */
export type DeskReport = RiskReportedArgs & LogPosition & { latencySec: number };

export type SwapRow = LogPosition & {
  poolId: Hex;
  sender: Address;
  amount0: bigint; // swapper's delta: negative = paid into the pool
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  fee: number; // pips actually charged
};

function position(log: RawLog): LogPosition {
  return {
    blockNumber: hexToNumber(log.blockNumber),
    blockTimestamp: log.blockTimestamp ? hexToNumber(log.blockTimestamp) : Number.NaN,
    txHash: log.transactionHash,
    logIndex: hexToNumber(log.logIndex),
  };
}

function byChainOrder(a: LogPosition, b: LogPosition): number {
  return a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
}

export function decodeReports(logs: RawLog[]): DeskReport[] {
  return logs
    .filter((l) => l.topics[0]?.toLowerCase() === RISK_REPORTED_TOPIC)
    .map((l) => {
      const { args } = decodeEventLog({ abi: riskDeskAbi, eventName: "RiskReported", data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      const pos = position(l);
      return {
        seq: args.seq,
        tObs: args.tObs,
        sigmaApplied: args.sigmaApplied,
        sigmaReported: args.sigmaReported,
        rv15E9: args.rv15E9,
        dvolE2: args.dvolE2,
        refTick: args.refTick,
        dispBp: args.dispBp,
        nSources: args.nSources,
        kE4: args.kE4,
        zone: args.zone,
        ...pos,
        latencySec: pos.blockTimestamp - args.tObs,
      };
    })
    .sort(byChainOrder);
}

export function decodeSwaps(logs: RawLog[]): SwapRow[] {
  return logs
    .filter((l) => l.topics[0]?.toLowerCase() === SWAP_TOPIC)
    .map((l) => {
      const { args } = decodeEventLog({ abi: poolManagerAbi, eventName: "Swap", data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      return {
        poolId: args.id,
        sender: getAddress(args.sender),
        amount0: args.amount0,
        amount1: args.amount1,
        sqrtPriceX96: args.sqrtPriceX96,
        liquidity: args.liquidity,
        tick: args.tick,
        fee: args.fee,
        ...position(l),
      };
    })
    .sort(byChainOrder);
}

/** One delivery attempt by a Chainlink forwarder to our desk; accepted = false means RiskDesk rejected it. */
export type Delivery = LogPosition & { receiver: Address; accepted: boolean };

export function decodeDeliveries(logs: RawLog[]): Delivery[] {
  return logs
    .filter((l) => l.topics[0]?.toLowerCase() === REPORT_PROCESSED_TOPIC)
    .map((l) => {
      const { args } = decodeEventLog({ abi: forwarderAbi, eventName: "ReportProcessed", data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      return { receiver: getAddress(args.receiver), accepted: args.result, ...position(l) };
    })
    .sort(byChainOrder);
}

/** Index of the last row with blockNumber <= block in a chain-ordered array, or -1. */
export function lastAtOrBefore(rows: { blockNumber: number }[], block: number): number {
  let i = -1;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].blockNumber <= block) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return i;
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/decode.test.ts)`
Expected: `Tests  5 passed (5)`.

- [x] **Step 5: Commit**

```bash
git add app/src/lib/encode.ts app/src/lib/decode.ts app/src/lib/decode.test.ts
git commit -m "feat(app): encode and decode RiskReported, Swap and ReportProcessed logs"
```

---

### Task 6: Deployments and parameters parsers

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `125ec6e`.

**Delegable:** yes
**Depends on:** Task 3

The parser reads the schema plan 04 fixed for `shared/deployments/sepolia.json` (interface 1) and maps it to the app's own types. `computePoolId` is checked against a real Sepolia pool (its `Initialize` log at block `0xb45c6c`).

**Files:**
- Create: `app/src/lib/deployments.ts`
- Test: `app/src/lib/deployments.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/deployments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computePoolId, parseDeployments, parseParams } from "./deployments";

// Real Sepolia pool (Initialize log, block 0xb45c6c) used as a hashing test vector.
const REAL_KEY = {
  currency0: "0x64ee4113a00cf64caeff85cb28136dcb208a2692",
  currency1: "0x9692cd72a8ff9bfe83ed714407666974fc2a2609",
  fee: 3000,
  tickSpacing: 1,
  hooks: "0x9e63a7a3232af90d4c59886637f2575e09b61040",
} as const;
const REAL_ID = "0x203a9d9283af6b2a48fd7e84ad78308008fecfe468f294bba26776f9d7ce62a3";

const T0 = "0x1000000000000000000000000000000000000001";
const T1 = "0x2000000000000000000000000000000000000002";
const HOOK = "0x0000000000000000000000000000000000001080";
const DESK = "0x4000000000000000000000000000000000000004";
const ZERO = "0x0000000000000000000000000000000000000000";
const keyV = { currency0: T0, currency1: T1, fee: 8_388_608, tickSpacing: 60, hooks: HOOK };
const keyS = { currency0: T0, currency1: T1, fee: 1_200, tickSpacing: 60, hooks: ZERO };

// Bootstrap file of plan 04 (Task 6): infrastructure verified, everything plan 01 deploys still null.
const bootstrap = {
  chainId: 11155111,
  deployBlock: null as number | null,
  uniswap: {
    poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    stateView: "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
    poolSwapTest: "0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe",
    poolModifyLiquidityTest: "0x0C478023803a644c94c4CE1C1e7b9A087e411B0A",
  },
  cre: { mockForwarder: "0x15fC6ae953E024d975e77382eEeC56A9101f9F88", keystoneForwarder: "0xF8344CFd5c43616a4366C34E3EEE75af79a74482" },
  tokens: { tETH: null as unknown, tUSD: null as unknown },
  riskDesks: { live: null as string | null, replay: null as string | null },
  hooks: { live: null as string | null, replay: null as string | null },
  pools: { liveV: null as unknown, liveS: null as unknown, replayV: null as unknown, replayS: null as unknown },
};

function deployedLive() {
  return {
    ...bootstrap,
    deployBlock: 9_000_000,
    tokens: { tETH: { address: T0, symbol: "tETH", decimals: 18 }, tUSD: { address: T1, symbol: "tUSD", decimals: 18 } },
    riskDesks: { live: DESK, replay: null },
    hooks: { live: HOOK, replay: null },
    pools: {
      liveV: { key: keyV, poolId: computePoolId(keyV), token0IsEth: true },
      liveS: { key: keyS, poolId: computePoolId(keyS), token0IsEth: true },
      replayV: null,
      replayS: null,
    },
    routers: { arb: "0x3000000000000000000000000000000000000003" },
  };
}

describe("computePoolId", () => {
  it("is keccak256(abi.encode(PoolKey)), checked against a real Sepolia pool", () => {
    expect(computePoolId(REAL_KEY)).toBe(REAL_ID);
  });
});

describe("parseDeployments (plan 04 schema)", () => {
  it("parses the bootstrap file: infrastructure only, no pair, so the app uses mock data", () => {
    const d = parseDeployments(bootstrap);
    expect(d.pairs.live).toBeUndefined();
    expect(d.uniswap.poolManager).toBe("0xE03A1074c86CFeDd5C142C4F04F1a1536e203543");
    expect(d.chainlink.mockKeystoneForwarder).toBe("0x15fC6ae953E024d975e77382eEeC56A9101f9F88");
    expect(d.routers.arb).toBeUndefined();
  });
  it("parses a deployed live pair", () => {
    const d = parseDeployments(deployedLive());
    expect(d.fixture).toBe(false);
    expect(d.pairs.live).toMatchObject({ riskDesk: DESK, hook: HOOK, startBlock: 9_000_000, token0IsEth: true });
    expect(d.pairs.live?.V.key.fee).toBe(8_388_608);
    expect(d.pairs.live?.S.key.hooks).toBe(ZERO);
    expect(d.pairs.replay).toBeUndefined();
    expect(d.tokens).toEqual({ tETH: T0, tUSD: T1 });
    expect(d.routers.arb).toBe("0x3000000000000000000000000000000000000003");
  });
  it("rejects a poolId that does not hash from its key", () => {
    const bad = deployedLive();
    (bad.pools.liveS as { poolId: string }).poolId = REAL_ID;
    expect(() => parseDeployments(bad)).toThrow(/poolId mismatch for liveS/);
  });
  it("requires deployBlock once a pair is deployed", () => {
    expect(() => parseDeployments({ ...deployedLive(), deployBlock: null })).toThrow(/deployBlock/);
  });
  it("rejects a wrong chain id", () => {
    expect(() => parseDeployments({ ...bootstrap, chainId: 1 })).toThrow(/chainId/);
  });
});

describe("parseParams", () => {
  it("parses the hook parameters", () => {
    const p = parseParams({
      pStar: 0.2, etaE4: 41_760, sqrtHalfDtE6: 2_449_490, feeMinPips: 500, feeMaxPips: 15_000,
      feeSafePips: 3_000, tauKillSec: 180, decidedBy: "lab/out/pstar-decision.json",
    });
    expect(p.etaE4).toBe(41_760);
    expect(p.fixture).toBe(false);
  });
  it("throws on a missing field", () => {
    expect(() => parseParams({ pStar: 0.2 })).toThrow(/params.json: etaE4/);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/deployments.test.ts)`
Expected: `Error: Cannot find module './deployments' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/deployments.ts`:

```ts
import { type Address, encodeAbiParameters, getAddress, type Hex, isHex, keccak256 } from "viem";
import type { FeeParams } from "./feeMath";

export const SEPOLIA_CHAIN_ID = 11_155_111;
export type Pair = "live" | "replay";
export const PAIRS: Pair[] = ["live", "replay"];

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type PoolInfo = { poolId: Hex; key: PoolKey };
export type PairDeployment = {
  riskDesk: Address;
  hook: Address;
  startBlock: number;
  token0IsEth: boolean;
  V: PoolInfo;
  S: PoolInfo;
};
export type Deployments = {
  fixture: boolean;
  chainId: number;
  uniswap: { poolManager: Address; stateView: Address; poolSwapTest: Address; poolModifyLiquidityTest?: Address };
  chainlink: { mockKeystoneForwarder?: Address; keystoneForwarder?: Address };
  tokens: { tETH?: Address; tUSD?: Address };
  routers: { arb?: Address };
  pairs: Partial<Record<Pair, PairDeployment>>;
};
export type Params = FeeParams & { pStar: number; decidedBy: string; fixture: boolean };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null;
const optAddr = (x: unknown): Address | undefined => (typeof x === "string" && x.length === 42 ? getAddress(x) : undefined);

function addr(x: unknown, where: string): Address {
  const a = optAddr(x);
  if (!a) throw new Error(`deployments: ${where} is not an address`);
  return a;
}

export function computePoolId(key: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [getAddress(key.currency0), getAddress(key.currency1), key.fee, key.tickSpacing, getAddress(key.hooks)],
    ),
  );
}

function parsePool(x: unknown, where: string): PoolInfo & { token0IsEth: boolean } {
  if (!isObj(x) || !isObj(x.key)) throw new Error(`deployments: ${where} missing`);
  const k = x.key;
  const key: PoolKey = {
    currency0: addr(k.currency0, `${where}.key.currency0`),
    currency1: addr(k.currency1, `${where}.key.currency1`),
    fee: Number(k.fee),
    tickSpacing: Number(k.tickSpacing),
    hooks: addr(k.hooks, `${where}.key.hooks`),
  };
  const poolId = String(x.poolId).toLowerCase() as Hex;
  if (!isHex(poolId) || poolId.length !== 66) throw new Error(`deployments: ${where}.poolId is not bytes32`);
  if (computePoolId(key) !== poolId) throw new Error(`deployments: poolId mismatch for ${where}`);
  return { poolId, key, token0IsEth: x.token0IsEth === true };
}

/** A pair is used once its desk, hook and both pools are recorded; until then the app runs on mock data. */
function parsePair(raw: Obj, name: Pair): PairDeployment | undefined {
  const desk = isObj(raw.riskDesks) ? optAddr(raw.riskDesks[name]) : undefined;
  const hook = isObj(raw.hooks) ? optAddr(raw.hooks[name]) : undefined;
  const pools = isObj(raw.pools) ? raw.pools : {};
  if (!desk || !hook || !isObj(pools[`${name}V`]) || !isObj(pools[`${name}S`])) return undefined;
  if (typeof raw.deployBlock !== "number") throw new Error(`deployments: deployBlock must be set once ${name} is deployed`);
  const V = parsePool(pools[`${name}V`], `${name}V`);
  const S = parsePool(pools[`${name}S`], `${name}S`);
  return {
    riskDesk: desk,
    hook,
    startBlock: raw.deployBlock,
    token0IsEth: V.token0IsEth,
    V: { poolId: V.poolId, key: V.key },
    S: { poolId: S.poolId, key: S.key },
  };
}

/** Parses shared/deployments/sepolia.json in the shape fixed by plan 04 (Task 6), plus `routers.arb`. */
export function parseDeployments(raw: unknown): Deployments {
  if (!isObj(raw)) throw new Error("deployments: not an object");
  if (raw.chainId !== SEPOLIA_CHAIN_ID) throw new Error(`deployments: chainId ${String(raw.chainId)} is not Sepolia`);
  const u = isObj(raw.uniswap) ? raw.uniswap : {};
  const c = isObj(raw.cre) ? raw.cre : {};
  const t = isObj(raw.tokens) ? raw.tokens : {};
  const r = isObj(raw.routers) ? raw.routers : {};
  const tokenAddr = (x: unknown) => (isObj(x) ? optAddr(x.address) : undefined);
  const pairs: Partial<Record<Pair, PairDeployment>> = {};
  for (const name of PAIRS) {
    const parsed = parsePair(raw, name);
    if (parsed) pairs[name] = parsed;
  }
  return {
    fixture: raw.fixture === true,
    chainId: SEPOLIA_CHAIN_ID,
    uniswap: {
      poolManager: addr(u.poolManager, "uniswap.poolManager"),
      stateView: addr(u.stateView, "uniswap.stateView"),
      poolSwapTest: addr(u.poolSwapTest, "uniswap.poolSwapTest"),
      poolModifyLiquidityTest: optAddr(u.poolModifyLiquidityTest),
    },
    chainlink: { mockKeystoneForwarder: optAddr(c.mockForwarder), keystoneForwarder: optAddr(c.keystoneForwarder) },
    tokens: { tETH: tokenAddr(t.tETH), tUSD: tokenAddr(t.tUSD) },
    routers: { arb: optAddr(r.arb) },
    pairs,
  };
}

const PARAM_FIELDS = ["pStar", "etaE4", "sqrtHalfDtE6", "feeMinPips", "feeMaxPips", "feeSafePips", "tauKillSec"] as const;

export function parseParams(raw: unknown): Params {
  if (!isObj(raw)) throw new Error("params.json: not an object");
  for (const f of PARAM_FIELDS) {
    if (typeof raw[f] !== "number" || !Number.isFinite(raw[f])) throw new Error(`params.json: ${f} must be a number`);
  }
  return {
    pStar: raw.pStar as number,
    etaE4: raw.etaE4 as number,
    sqrtHalfDtE6: raw.sqrtHalfDtE6 as number,
    feeMinPips: raw.feeMinPips as number,
    feeMaxPips: raw.feeMaxPips as number,
    feeSafePips: raw.feeSafePips as number,
    tauKillSec: raw.tauKillSec as number,
    decidedBy: String(raw.decidedBy ?? ""),
    fixture: raw.fixture === true,
  };
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/deployments.test.ts)`
Expected: `Tests  8 passed (8)`.

- [x] **Step 5: Commit**

```bash
git add app/src/lib/deployments.ts app/src/lib/deployments.test.ts
git commit -m "feat(app): parse shared deployments and hook parameters"
```

---

### Task 7: Lab output schemas

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `0e861c8`. The Step 5 line is in `docs/sessions/2026-10-06.md` ("Frontend build log").

**Delegable:** yes
**Depends on:** Task 1

This task fixes how the app reads the lab outputs (interface 6). `summary.json`, the columnar part of `replay-2026-02-04.json` and `ptrade-band.json` are the shapes plan 03 writes (its "Output contracts" and `lab/tests/test_outputs.py`); the fixtures below are synthetic. Units: `t` unix seconds, σ annualised in %, fees in bp, cumulative ARB in USD, P_trade and `pStar` as fractions, every `*Pct` in % (negative = V loses less to arbitrage).

**Files:**
- Create: `app/src/lib/lab.ts`
- Test: `app/src/lib/lab.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/lab.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bandAt, parsePTradeBand, parseReplay, parseSummary, replayRows } from "./lab";

const band = {
  generatedAt: "2026-10-07T00:00:00Z",
  windowBlocks: 300,
  method: "test",
  grid: [
    { p: 0.1, lo95: 0.06, hi95: 0.15, lo99: 0.05, hi99: 0.17 },
    { p: 0.2, lo95: 0.14, hi95: 0.27, lo99: 0.12, hi99: 0.3 },
  ],
};

describe("parsePTradeBand / bandAt", () => {
  it("interpolates linearly between grid points and clamps outside", () => {
    const b = parsePTradeBand(band);
    expect(b.fixture).toBe(false);
    expect(bandAt(b, 0.15).lo95).toBeCloseTo(0.1, 10);
    expect(bandAt(b, 0.15).hi99).toBeCloseTo(0.235, 10);
    expect(bandAt(b, 0.01)).toEqual({ lo95: 0.06, hi95: 0.15, lo99: 0.05, hi99: 0.17 });
    expect(bandAt(b, 0.9).hi95).toBe(0.27);
  });
  it("rejects an unsorted grid", () => {
    expect(() => parsePTradeBand({ ...band, grid: [...band.grid].reverse() })).toThrow(/ascending/);
  });
});

// Synthetic replay in the columnar shape plan 03 writes next to the points[] that plan 06 reads.
const replay = {
  window: { startUtc: "2026-02-04T12:00:00Z", endUtc: "2026-02-04T16:00:00Z" },
  t: [1770206400, 1770210000, 1770213600, 1770217200, 1770220800],
  sigmaAnnualPct: [74, 110, 225, 160, 120],
  feeVBp: [12, 30, 128, 80, 45],
  feeSBp: 55.7,
  arbCumVUsd: [0, 120, 900, 1300, 1500],
  arbCumSUsd: [0, 200, 1300, 1800, 2000],
};

describe("parseReplay / replayRows", () => {
  it("accepts plan 03's columnar shape and zips it into rows", () => {
    const rows = replayRows(parseReplay(replay));
    expect(rows).toHaveLength(5);
    expect(rows[2]).toEqual({ t: 1770213600, sigmaAnnualPct: 225, feeVBp: 128, feeSBp: 55.7, arbCumVUsd: 900, arbCumSUsd: 1300 });
  });
  it("keeps the optional price series", () => {
    expect(replayRows(parseReplay({ ...replay, price: [1, 2, 3, 4, 5] }))[4].price).toBe(5);
  });
  it("rejects arrays of different lengths", () => {
    expect(() => parseReplay({ ...replay, feeVBp: [12] })).toThrow(/arrays differ in length/);
  });
});

// Synthetic summary in the shape plan 03 writes to lab/out/summary.json (numbers from the old P* = 10% runs).
const summary = {
  generatedAt: "fixture",
  setting: { pStar: 0.1, feeMinPips: 500 },
  comparisons: {
    equalAvgFee: [{ period: "Feb 2026", arbChangePct: -20.0 }, { period: "Oct 2026", arbChangePct: -24.5 }],
    equalTraderCost: [{ period: "Feb 2026", arbChangePct: -14.0 }, { period: "Oct 2026", arbChangePct: 7.0 }],
  },
  pTrade: [
    { period: "Feb 2026", predicted: 0.1, observed: 0.08, blocks: 1200 },
    { period: "Oct 2026", predicted: 0.094, observed: 0.097, blocks: 1200 },
  ],
  replay: {
    window: "2026-02-04 12:00-16:00 UTC", sigmaMinPct: 74, sigmaMaxPct: 225, feeVMinBp: 12, feeVMaxBp: 128, feeSBp: 55.7,
    arbChangePct: -25.0, arbChangeRangePct: [-25.0, -8.0], pTradePredicted: 0.092, pTradeObserved: 0.069,
  },
  lpGain: { fullRangeEthPctPerYear: [0.1, 0.5], volatileAssetPctPerYearMax: 1.0, shareFromTop5WeeksPct: 50 },
  modelSeverityRatio: [1.1, 4.0],
  inPoolVolGainSharePct: [85, 97],
};

describe("parseSummary", () => {
  it("accepts plan 03's summary shape", () => {
    const s = parseSummary(summary);
    expect(s.comparisons.equalTraderCost[1].arbChangePct).toBe(7);
    expect(s.fixture).toBe(false);
  });
  it("names the first missing field", () => {
    expect(() => parseSummary({ ...summary, comparisons: undefined })).toThrow(/missing comparisons.equalAvgFee/);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/lab.test.ts)`
Expected: `Error: Cannot find module './lab' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/lab.ts`:

```ts
// Lab outputs (lab/out/*.json, written by plan 03) read by the app: summary.json (the condensed view of
// backtest-summary.json, which plan 06 reads), the columnar part of replay-2026-02-04.json and ptrade-band.json,
// so the README, the deck and the dashboard show the same numbers.
// Units: fractions for P_trade and pStar (0.097), percent for every *Pct field (-24.5), bp for fees.
// app/src/fixtures/lab/*.json are synthetic, shape-identical files carrying `fixture: true`.

export type PeriodChange = { period: string; arbChangePct: number };

export type LabSummary = {
  fixture: boolean;
  generatedAt: string;
  setting: { pStar: number; feeMinPips: number };
  comparisons: { equalAvgFee: PeriodChange[]; equalTraderCost: PeriodChange[] };
  pTrade: { period: string; predicted: number; observed: number; blocks: number }[];
  replay: {
    window: string;
    sigmaMinPct: number;
    sigmaMaxPct: number;
    feeVMinBp: number;
    feeVMaxBp: number;
    feeSBp: number;
    arbChangePct: number;
    arbChangeRangePct: [number, number];
    pTradePredicted: number;
    pTradeObserved: number;
  };
  lpGain: { fullRangeEthPctPerYear: [number, number]; volatileAssetPctPerYearMax: number; shareFromTop5WeeksPct: number };
  modelSeverityRatio: [number, number];
  inPoolVolGainSharePct: [number, number];
};

export type LabReplay = {
  fixture: boolean;
  window: { startUtc: string; endUtc: string };
  t: number[]; // unix seconds
  sigmaAnnualPct: number[];
  feeVBp: number[];
  feeSBp: number;
  arbCumVUsd: number[];
  arbCumSUsd: number[];
  price?: number[]; // optional ETH/USD, drawn when present
};

export type ReplayRow = { t: number; sigmaAnnualPct: number; feeVBp: number; feeSBp: number; arbCumVUsd: number; arbCumSUsd: number; price?: number };

export type BandRow = { p: number; lo95: number; hi95: number; lo99: number; hi99: number };
export type LabPTradeBand = {
  fixture: boolean;
  generatedAt: string;
  windowBlocks: number;
  method: string;
  grid: BandRow[]; // ascending p; quantiles of the observed rolling frequency under the clustered model
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null;

function need(o: Obj, path: string): unknown {
  let cur: unknown = o;
  for (const k of path.split(".")) {
    if (!isObj(cur) || cur[k] === undefined || cur[k] === null) throw new Error(`lab file: missing ${path}`);
    cur = cur[k];
  }
  return cur;
}

export function parseSummary(raw: unknown): LabSummary {
  if (!isObj(raw)) throw new Error("summary.json: not an object");
  for (const p of [
    "generatedAt", "setting.pStar", "comparisons.equalAvgFee", "comparisons.equalTraderCost", "pTrade",
    "replay.arbChangeRangePct", "replay.feeSBp", "lpGain.fullRangeEthPctPerYear", "modelSeverityRatio", "inPoolVolGainSharePct",
  ]) need(raw, p);
  return { ...(raw as unknown as LabSummary), fixture: raw.fixture === true };
}

const SERIES = ["t", "sigmaAnnualPct", "feeVBp", "arbCumVUsd", "arbCumSUsd"] as const;

export function parseReplay(raw: unknown): LabReplay {
  if (!isObj(raw)) throw new Error("replay: not an object");
  need(raw, "window.startUtc");
  need(raw, "feeSBp");
  const lengths = SERIES.map((k) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]).length : -1));
  if (lengths[0] < 2) throw new Error("replay: need at least 2 points");
  if (lengths.some((n) => n !== lengths[0])) throw new Error(`replay: arrays differ in length (${SERIES.map((k, i) => `${k}=${lengths[i]}`).join(", ")})`);
  if (raw.price !== undefined && (!Array.isArray(raw.price) || raw.price.length !== lengths[0])) throw new Error("replay: price must match t");
  return { ...(raw as unknown as LabReplay), fixture: raw.fixture === true };
}

/** Columnar replay -> one row per point, for the charts. */
export function replayRows(r: LabReplay): ReplayRow[] {
  return r.t.map((t, i) => ({
    t,
    sigmaAnnualPct: r.sigmaAnnualPct[i],
    feeVBp: r.feeVBp[i],
    feeSBp: r.feeSBp,
    arbCumVUsd: r.arbCumVUsd[i],
    arbCumSUsd: r.arbCumSUsd[i],
    ...(r.price ? { price: r.price[i] } : {}),
  }));
}

export function parsePTradeBand(raw: unknown): LabPTradeBand {
  if (!isObj(raw)) throw new Error("ptrade-band.json: not an object");
  const grid = need(raw, "grid") as BandRow[];
  need(raw, "windowBlocks");
  if (!Array.isArray(grid) || grid.length === 0) throw new Error("ptrade-band.json: grid must be a non-empty array");
  for (let i = 1; i < grid.length; i++) {
    if (grid[i].p <= grid[i - 1].p) throw new Error("ptrade-band.json: grid must be ascending in p");
  }
  return { ...(raw as unknown as LabPTradeBand), fixture: raw.fixture === true };
}

/** Band quantiles at predicted frequency p (linear interpolation on the lab grid, clamped at the ends). */
export function bandAt(band: LabPTradeBand, p: number): Omit<BandRow, "p"> {
  const g = band.grid;
  const strip = ({ lo95, hi95, lo99, hi99 }: BandRow) => ({ lo95, hi95, lo99, hi99 });
  if (p <= g[0].p) return strip(g[0]);
  if (p >= g[g.length - 1].p) return strip(g[g.length - 1]);
  const i = g.findIndex((r) => r.p >= p);
  const a = g[i - 1];
  const b = g[i];
  const w = (p - a.p) / (b.p - a.p);
  const lerp = (x: number, y: number) => x + (y - x) * w;
  return { lo95: lerp(a.lo95, b.lo95), hi95: lerp(a.hi95, b.hi95), lo99: lerp(a.lo99, b.lo99), hi99: lerp(a.hi99, b.hi99) };
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/lab.test.ts)`
Expected: `Tests  7 passed (7)`.

- [x] **Step 5: Log the schemas and commit**

Append under `## Decisions` in today's session log:

```markdown
- **Lab outputs read by the app (plan 05):** `lab/out/summary.json` and the columnar part of `lab/out/replay-2026-02-04.json` (plus an optional `price[]` in the replay), written by plan 03, and `lab/out/ptrade-band.json` (`{generatedAt, windowBlocks, method, grid[{p, lo95, hi95, lo99, hi99}]}`), typed in `app/src/lib/lab.ts`. Plan 03 writes exactly these.
```

```bash
git add app/src/lib/lab.ts app/src/lib/lab.test.ts docs/sessions
git commit -m "feat(app): lab output types and band interpolation"
```

---

### Task 8: Weather series (σ and the fee it sets)

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `692b5c5`.

**Delegable:** yes
**Depends on:** Tasks 3, 5

The fee is a step function of time rebuilt from logs only: it changes when a report is **included** (block time, not tObs), and goes blind at `tObs + tauKillSec + 1` if no newer report has landed. Historical DEGRADED flags are re-derived from `dispBp > 25` (RiskDesk clears or sets the flag on every report, spec §3.5). `dvolE2 = 0` means DVOL was unavailable (plan 02), so it is drawn as a gap, not as 0%.

**Files:**
- Create: `app/src/lib/series.ts`
- Test: `app/src/lib/series.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/series.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DeskReport, SwapRow } from "./decode";
import { FeeMode, type FeeParams } from "./feeMath";
import { blindEpisodes, downsample, swapFeeDots, timeAverageFeeBp, weatherSeries } from "./series";

const p: FeeParams = { etaE4: 41_760, sqrtHalfDtE6: 2_449_490, feeMinPips: 500, feeMaxPips: 15_000, feeSafePips: 3_000, tauKillSec: 180 };

function report(seq: number, tObs: number, landedAt: number, over: Partial<DeskReport> = {}): DeskReport {
  return {
    seq, tObs, sigmaApplied: 178_072, sigmaReported: 178_072, rv15E9: 178_072, dvolE2: 9_500, refTick: 78_244,
    dispBp: 3, nSources: 4, kE4: 10_000, zone: 0, blockNumber: seq, blockTimestamp: landedAt,
    latencySec: landedAt - tObs, txHash: "0x01", logIndex: 0, ...over,
  };
}

describe("weatherSeries", () => {
  it("steps the fee at each report's inclusion time and closes the series at now", () => {
    const s = weatherSeries([report(1, 970, 1_000), report(2, 1_000, 1_030, { sigmaApplied: 400_663 })], p, 1_060);
    expect(s.map((x) => x.t)).toEqual([1_000, 1_030, 1_060]);
    expect(s.map((x) => x.feeVBp)).toEqual([18.22, 40.99, 40.99]);
    expect(s[0].sigmaPct).toBeCloseTo(100, 2);
    expect(s[0].dvolPct).toBe(95);
    expect(s.every((x) => x.mode === FeeMode.Normal)).toBe(true);
  });
  it("inserts a blind step when the next report lands more than tauKillSec after tObs", () => {
    const s = weatherSeries([report(1, 970, 1_000), report(2, 1_270, 1_300)], p, 1_310);
    expect(s.map((x) => [x.t, x.mode])).toEqual([
      [1_000, FeeMode.Normal],
      [1_151, FeeMode.Blind],
      [1_300, FeeMode.Normal],
      [1_310, FeeMode.Normal],
    ]);
    expect(s[1].feeVBp).toBe(30);
  });
  it("goes blind after the last report when the desk is silent", () => {
    const s = weatherSeries([report(1, 970, 1_000)], p, 2_000);
    expect(s.map((x) => [x.t, x.mode])).toEqual([
      [1_000, FeeMode.Normal],
      [1_151, FeeMode.Blind],
      [2_000, FeeMode.Blind],
    ]);
  });
  it("marks degraded reports (dispersion above 25 bp)", () => {
    const [first] = weatherSeries([report(1, 970, 1_000, { dispBp: 30 })], p, 1_010);
    expect(first.mode).toBe(FeeMode.Degraded);
    expect(first.feeVBp).toBe(30);
  });
  it("leaves DVOL empty when the desk reported dvolE2 = 0 (unavailable)", () => {
    const [first] = weatherSeries([report(1, 970, 1_000, { dvolE2: 0 })], p, 1_010);
    expect(first.dvolPct).toBeNull();
  });
  it("returns nothing without reports", () => {
    expect(weatherSeries([], p, 1_000)).toEqual([]);
  });
});

describe("swapFeeDots", () => {
  it("keeps the swaps of one pool with their charged fee in bp", () => {
    const base = { sender: "0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe", amount0: 0n, amount1: 0n, sqrtPriceX96: 0n, liquidity: 0n, tick: 0, blockNumber: 1, txHash: "0x01", logIndex: 0 } as const;
    const swaps: SwapRow[] = [
      { ...base, poolId: "0xaa", fee: 1_822, blockTimestamp: 1_000 },
      { ...base, poolId: "0xbb", fee: 700, blockTimestamp: 1_012 },
    ];
    expect(swapFeeDots(swaps, "0xaa")).toEqual([{ t: 1_000, feeBp: 18.22 }]);
  });
});

describe("downsample", () => {
  it("keeps short series untouched", () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
  it("strides long series and always keeps the last point", () => {
    expect(downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([0, 3, 6, 9]);
    expect(downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([0, 3, 6, 9, 10]);
  });
});

describe("blindEpisodes", () => {
  it("finds silences longer than tauKillSec, closed by the next report or still ongoing", () => {
    const reports = [report(1, 970, 1_000), report(2, 1_270, 1_300), report(3, 1_300, 1_330)];
    expect(blindEpisodes(reports, 180, 1_400)).toEqual([{ from: 1_151, to: 1_300, ongoing: false, lastTx: "0x01", resumeTx: "0x01" }]);
    expect(blindEpisodes(reports, 180, 1_600)).toEqual([
      { from: 1_151, to: 1_300, ongoing: false, lastTx: "0x01", resumeTx: "0x01" },
      { from: 1_481, to: 1_600, ongoing: true, lastTx: "0x01", resumeTx: undefined },
    ]);
  });
});

describe("timeAverageFeeBp", () => {
  it("weights each fee by how long it was in force", () => {
    const pts = [
      { t: 0, sigmaPct: 0, sigmaReportedPct: 0, dvolPct: 0, feeVBp: 5, mode: FeeMode.Normal },
      { t: 30, sigmaPct: 0, sigmaReportedPct: 0, dvolPct: 0, feeVBp: 20, mode: FeeMode.Normal },
    ];
    expect(timeAverageFeeBp(pts, 40)).toBeCloseTo((5 * 30 + 20 * 10) / 40, 10);
    expect(timeAverageFeeBp([], 40)).toBe(0);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/series.test.ts)`
Expected: `Error: Cannot find module './series' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/series.ts`:

```ts
import type { Hex } from "viem";
import type { DeskReport, SwapRow } from "./decode";
import { type DeskState, FeeMode, type FeeParams, FLAG_DEGRADED, quoteFee } from "./feeMath";
import { dvolE2ToPct, pipsToBp, sigmaE9ToAnnualPct } from "./units";

export const DISP_MAX_BP = 25; // mirror of RiskDesk DISP_MAX: above it the report is flagged DEGRADED

export type WeatherPoint = {
  t: number; // unix seconds: when this desk state became readable by the hook (report inclusion) or went blind
  sigmaPct: number; // sigma applied by RiskDesk (after the envelope), annualised %
  sigmaReportedPct: number; // sigma proposed by the CRE workflow, annualised %
  dvolPct: number | null; // null when the desk reported dvolE2 = 0 (DVOL unavailable, or replay mode)
  feeVBp: number; // fee the hook quotes at t
  mode: FeeMode;
};

export function deskStateOf(r: DeskReport): DeskState {
  return { tObs: r.tObs, sigmaE9: r.sigmaApplied, kE4: r.kE4, flags: r.dispBp > DISP_MAX_BP ? FLAG_DEGRADED : 0, seq: r.seq };
}

/** The hook's fee as a step function of time, rebuilt from RiskReported logs only. */
export function weatherSeries(reports: DeskReport[], p: FeeParams, nowSec: number): WeatherPoint[] {
  const out: WeatherPoint[] = [];
  reports.forEach((r, i) => {
    const s = deskStateOf(r);
    const push = (t: number) => {
      const q = quoteFee(s, t, p);
      out.push({
        t,
        sigmaPct: sigmaE9ToAnnualPct(r.sigmaApplied),
        sigmaReportedPct: sigmaE9ToAnnualPct(r.sigmaReported),
        dvolPct: r.dvolE2 === 0 ? null : dvolE2ToPct(r.dvolE2),
        feeVBp: pipsToBp(q.feePips),
        mode: q.mode,
      });
    };
    const isLast = i === reports.length - 1;
    const end = isLast ? nowSec : reports[i + 1].blockTimestamp;
    push(r.blockTimestamp);
    const blindAt = r.tObs + p.tauKillSec + 1;
    if (blindAt > r.blockTimestamp && blindAt < end) push(blindAt);
    if (isLast && nowSec > r.blockTimestamp && nowSec !== blindAt) push(nowSec);
  });
  return out;
}

export type FeeDot = { t: number; feeBp: number };

export function swapFeeDots(swaps: SwapRow[], poolId: Hex): FeeDot[] {
  return swaps.filter((s) => s.poolId === poolId).map((s) => ({ t: s.blockTimestamp, feeBp: pipsToBp(s.fee) }));
}

/** Keeps every k-th point (k = ceil(n / max)) and always the last one. */
export function downsample<T>(xs: T[], maxPoints: number): T[] {
  if (xs.length <= maxPoints) return xs;
  const k = Math.ceil(xs.length / maxPoints);
  const out = xs.filter((_, i) => i % k === 0);
  if ((xs.length - 1) % k !== 0) out.push(xs[xs.length - 1]);
  return out;
}

export type BlindEpisode = { from: number; to: number; ongoing: boolean; lastTx: Hex; resumeTx?: Hex };

/** Periods when the hook quoted blind because the desk was silent for more than tauKillSec. */
export function blindEpisodes(reports: DeskReport[], tauKillSec: number, nowSec: number): BlindEpisode[] {
  const out: BlindEpisode[] = [];
  reports.forEach((r, i) => {
    const next = reports[i + 1];
    const from = r.tObs + tauKillSec + 1;
    const end = next ? next.blockTimestamp : nowSec;
    if (from < end) out.push({ from, to: end, ongoing: !next, lastTx: r.txHash, resumeTx: next?.txHash });
  });
  return out;
}

/** Time-weighted mean of the step series' fee between its first point and `to`. */
export function timeAverageFeeBp(points: WeatherPoint[], to: number): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const end = i + 1 < points.length ? points[i + 1].t : to;
    area += points[i].feeVBp * Math.max(0, end - points[i].t);
  }
  const span = to - (points[0]?.t ?? to);
  return span > 0 ? area / span : (points[0]?.feeVBp ?? 0);
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/series.test.ts)`
Expected: `Tests  11 passed (11)`.

- [x] **Step 5: Commit**

```bash
git add app/src/lib/series.ts app/src/lib/series.test.ts
git commit -m "feat(app): weather series, blind episodes and time-average fee from logs"
```

---

### Task 9: P_trade, predicted against observed

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `577c005`. The Step 5 line is in `docs/sessions/2026-10-06.md` ("Frontend build log").

**Delegable:** yes
**Depends on:** Tasks 7, 8

Predicted per block (spec §7.1): `1 / (f / (σ̂·√(Δt/2)) + 0.824)` with the fee actually in force (dynamic pool) or the static fee (S). Observed: share of blocks with at least one swap whose `sender` is the arbitrage router. Rolling window: the lab band's `windowBlocks` (300).

**Files:**
- Create: `app/src/lib/ptrade.ts`
- Test: `app/src/lib/ptrade.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/ptrade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DeskReport, SwapRow } from "./decode";
import type { FeeParams } from "./feeMath";
import { parsePTradeBand } from "./lab";
import { arbBlocksOf, makeBlockClock, makePredictor, predictedPTrade, pTradeTotals, rollingPTrade, sigmaArbAnnualPct } from "./ptrade";

const p: FeeParams = { etaE4: 41_760, sqrtHalfDtE6: 2_449_490, feeMinPips: 500, feeMaxPips: 15_000, feeSafePips: 3_000, tauKillSec: 180 };
const ARB = "0x3000000000000000000000000000000000000003";
const RETAIL = "0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe";

describe("predictedPTrade (Nezlobin-Tassy fixed-block form)", () => {
  it("returns P* when the fee is the unclamped formula fee", () => {
    // sigma 100%/yr at P* = 20%: fee 1,822 pips, eta_eff = 4.176 -> 1 / (4.176 + 0.824) = 0.2
    expect(predictedPTrade(1_822, 178_072, 2_449_490)).toBeCloseTo(0.2, 3);
  });
  it("is lower than P* when the floor binds", () => {
    // sigma 25%/yr: formula fee 4.55 bp, floor 5 bp -> eta_eff = 4.586 -> 0.1848
    expect(predictedPTrade(500, 44_518, 2_449_490)).toBeCloseTo(0.1848, 3);
  });
  it("is 0 without volatility", () => {
    expect(predictedPTrade(500, 0, 2_449_490)).toBe(0);
  });
});

describe("makeBlockClock", () => {
  it("interpolates between anchors and extrapolates at 12 s per block", () => {
    const clock = makeBlockClock([{ block: 100, t: 1_000 }, { block: 110, t: 1_130 }]);
    expect(clock(105)).toBe(1_065);
    expect(clock(90)).toBe(880);
    expect(clock(112)).toBe(1_154);
  });
});

function report(seq: number, block: number, t: number, sigmaApplied: number): DeskReport {
  return {
    seq, tObs: t - 20, sigmaApplied, sigmaReported: sigmaApplied, rv15E9: sigmaApplied, dvolE2: 0, refTick: 0,
    dispBp: 3, nSources: 4, kE4: 10_000, zone: 0, blockNumber: block, blockTimestamp: t, latencySec: 20,
    txHash: "0x01", logIndex: 0,
  };
}

describe("makePredictor", () => {
  const reports = [report(1, 100, 1_000, 178_072), report(2, 103, 1_036, 44_518)];
  const clock = makeBlockClock([{ block: 100, t: 1_000 }, { block: 103, t: 1_036 }]);
  it("uses the desk state readable at the block for the dynamic pool", () => {
    const pred = makePredictor(reports, p, clock);
    expect(pred(101)).toBeCloseTo(0.2, 3);
    expect(pred(103)).toBeCloseTo(0.1848, 3);
    expect(Number.isNaN(pred(99))).toBe(true);
  });
  it("uses a constant fee for the static pool", () => {
    const pred = makePredictor(reports, p, clock, 1_822);
    expect(pred(101)).toBeCloseTo(0.2, 3);
    expect(pred(103)).toBeLessThan(0.1);
  });
});

describe("arbBlocksOf / rollingPTrade", () => {
  const swap = (block: number, sender: string, poolId = "0xaa"): SwapRow => ({
    poolId: poolId as `0x${string}`, sender: sender as `0x${string}`, amount0: 0n, amount1: 0n, sqrtPriceX96: 0n,
    liquidity: 0n, tick: 0, fee: 500, blockNumber: block, blockTimestamp: block * 12, txHash: "0x01", logIndex: 0,
  });
  it("counts blocks (not swaps) with at least one arbitrage on the pool", () => {
    const s = [swap(1, ARB), swap(1, ARB), swap(2, RETAIL), swap(3, ARB, "0xbb"), swap(4, ARB)];
    expect([...arbBlocksOf(s, "0xaa", ARB)].sort()).toEqual([1, 4]);
  });
  it("computes observed and predicted frequencies over a rolling block window with the lab band", () => {
    const band = parsePTradeBand({
      generatedAt: "x", windowBlocks: 4, method: "test",
      grid: [{ p: 0, lo95: 0, hi95: 0.5, lo99: 0, hi99: 0.75 }, { p: 1, lo95: 0.5, hi95: 1, lo99: 0.25, hi99: 1 }],
    });
    const out = rollingPTrade({
      fromBlock: 1, toBlock: 8, window: 4, step: 2, arbBlocks: new Set([1, 2, 5]),
      predictedAt: () => 0.25, clock: (b) => b * 12, band,
    });
    expect(out.map((x) => [x.block, x.observed])).toEqual([[4, 0.5], [6, 0.25], [8, 0.25]]);
    expect(out[0].predicted).toBeCloseTo(0.25, 10);
    expect(out[0].t).toBe(48);
    expect(out[0].lo95).toBeCloseTo(0.125, 10);
    expect(out[0].hi95).toBeCloseTo(0.625, 10);
  });
  it("skips blocks with no prediction (before the first report)", () => {
    const out = rollingPTrade({
      fromBlock: 1, toBlock: 6, window: 2, step: 1, arbBlocks: new Set([6]),
      predictedAt: (b) => (b < 3 ? Number.NaN : 0.1), clock: (b) => b,
    });
    expect(out[0].block).toBe(4);
    expect(out.at(-1)).toMatchObject({ block: 6, observed: 0.5 });
    expect(out.at(-1)?.lo95).toBeUndefined();
  });
});

describe("pTradeTotals", () => {
  it("averages over every block that has a prediction", () => {
    const t = pTradeTotals({ fromBlock: 1, toBlock: 6, arbBlocks: new Set([3, 4, 9]), predictedAt: (b) => (b < 3 ? Number.NaN : 0.2) });
    expect(t).toEqual({ blocks: 4, arbBlocks: 2, observed: 0.5, predicted: 0.2 });
  });
  it("returns zeros when nothing can be predicted", () => {
    expect(pTradeTotals({ fromBlock: 1, toBlock: 2, arbBlocks: new Set(), predictedAt: () => Number.NaN })).toEqual({ blocks: 0, arbBlocks: 0, observed: 0, predicted: 0 });
  });
});

describe("sigmaArbAnnualPct", () => {
  it("inverts the P_trade formula: P* = 20% at 18.22 bp means sigma = 100%/yr", () => {
    expect(sigmaArbAnnualPct(1_822, 0.2, 2_449_490)).toBeCloseTo(100, 0);
  });
  it("is undefined when nothing was arbitraged", () => {
    expect(Number.isNaN(sigmaArbAnnualPct(500, 0, 2_449_490))).toBe(true);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/ptrade.test.ts)`
Expected: `Error: Cannot find module './ptrade' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/ptrade.ts`:

```ts
import type { Address, Hex } from "viem";
import { type DeskReport, lastAtOrBefore, type SwapRow } from "./decode";
import { type FeeParams, quoteFee } from "./feeMath";
import { bandAt, type LabPTradeBand } from "./lab";
import { deskStateOf } from "./series";

/** |zeta(1/2)| / sqrt(pi), fixed-interval blocks (Nezlobin-Tassy 2025): P_trade = 1 / (eta + 0.824). */
export const NT_CONSTANT = 0.824;
export const SEPOLIA_BLOCK_SEC = 12;

export function predictedPTrade(feePips: number, sigmaE9: number, sqrtHalfDtE6: number): number {
  if (sigmaE9 <= 0) return 0;
  const noise = (sigmaE9 / 1e9) * (sqrtHalfDtE6 / 1e6); // sigma per sqrt-second * sqrt(dt / 2)
  return 1 / (feePips / 1e6 / noise + NT_CONSTANT);
}

/** σ_arb: the annualised volatility that reproduces the observed arbitrage frequency at the mean fee. */
export function sigmaArbAnnualPct(meanFeePips: number, pObserved: number, sqrtHalfDtE6: number): number {
  const denom = 1 / pObserved - NT_CONSTANT;
  if (!(pObserved > 0) || denom <= 0) return Number.NaN;
  const sigmaPerSqrtSec = meanFeePips / 1e6 / (denom * (sqrtHalfDtE6 / 1e6));
  return sigmaPerSqrtSec * Math.sqrt(31_536_000) * 100;
}

export type BlockClock = (block: number) => number;

/** Block -> unix time, interpolated between known (block, timestamp) pairs from logs. */
export function makeBlockClock(anchors: { block: number; t: number }[], blockSec = SEPOLIA_BLOCK_SEC): BlockClock {
  const a = [...anchors].sort((x, y) => x.block - y.block);
  return (block) => {
    if (a.length === 0) return Number.NaN;
    if (block <= a[0].block) return a[0].t - (a[0].block - block) * blockSec;
    const last = a[a.length - 1];
    if (block >= last.block) return last.t + (block - last.block) * blockSec;
    let lo = 0;
    let hi = a.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid].block <= block) lo = mid;
      else hi = mid;
    }
    const w = (block - a[lo].block) / (a[hi].block - a[lo].block);
    return Math.round(a[lo].t + w * (a[hi].t - a[lo].t));
  };
}

/**
 * Predicted per-block arbitrage probability. Dynamic pool: fee from the desk state readable at the
 * block. Static pool: pass its fee. NaN before the first report.
 */
export function makePredictor(reports: DeskReport[], p: FeeParams, clock: BlockClock, staticFeePips?: number) {
  return (block: number): number => {
    const i = lastAtOrBefore(reports, block);
    if (i < 0) return Number.NaN;
    const r = reports[i];
    const fee = staticFeePips ?? quoteFee(deskStateOf(r), clock(block), p).feePips;
    return predictedPTrade(fee, r.sigmaApplied, p.sqrtHalfDtE6);
  };
}

export function arbBlocksOf(swaps: SwapRow[], poolId: Hex, arbRouter: Address): Set<number> {
  const router = arbRouter.toLowerCase();
  return new Set(swaps.filter((s) => s.poolId === poolId && s.sender.toLowerCase() === router).map((s) => s.blockNumber));
}

export type PTradePoint = {
  block: number;
  t: number;
  observed: number;
  predicted: number;
  lo95?: number;
  hi95?: number;
  lo99?: number;
  hi99?: number;
};

export function rollingPTrade(o: {
  fromBlock: number;
  toBlock: number;
  window: number;
  step: number;
  arbBlocks: Set<number>;
  predictedAt: (block: number) => number;
  clock: BlockClock;
  band?: LabPTradeBand;
}): PTradePoint[] {
  const out: PTradePoint[] = [];
  const first = (() => {
    for (let b = o.fromBlock; b <= o.toBlock; b++) if (!Number.isNaN(o.predictedAt(b))) return b;
    return o.toBlock + 1;
  })();
  const n = o.toBlock - first + 1;
  if (n < o.window) return out;
  const arbCum = new Float64Array(n + 1);
  const predCum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const b = first + i;
    arbCum[i + 1] = arbCum[i] + (o.arbBlocks.has(b) ? 1 : 0);
    predCum[i + 1] = predCum[i] + o.predictedAt(b);
  }
  for (let i = o.window; i <= n; i += o.step) {
    const end = first + i - 1;
    const observed = (arbCum[i] - arbCum[i - o.window]) / o.window;
    const predicted = (predCum[i] - predCum[i - o.window]) / o.window;
    out.push({ block: end, t: o.clock(end), observed, predicted, ...(o.band ? bandAt(o.band, predicted) : {}) });
  }
  const lastEnd = first + n - 1;
  if (out.length > 0 && out[out.length - 1].block !== lastEnd) {
    const observed = (arbCum[n] - arbCum[n - o.window]) / o.window;
    const predicted = (predCum[n] - predCum[n - o.window]) / o.window;
    out.push({ block: lastEnd, t: o.clock(lastEnd), observed, predicted, ...(o.band ? bandAt(o.band, predicted) : {}) });
  }
  return out;
}

export function pTradeTotals(o: {
  fromBlock: number;
  toBlock: number;
  arbBlocks: Set<number>;
  predictedAt: (block: number) => number;
}): { blocks: number; arbBlocks: number; observed: number; predicted: number } {
  let blocks = 0;
  let arb = 0;
  let pred = 0;
  for (let b = o.fromBlock; b <= o.toBlock; b++) {
    const p = o.predictedAt(b);
    if (Number.isNaN(p)) continue;
    blocks++;
    pred += p;
    if (o.arbBlocks.has(b)) arb++;
  }
  return blocks === 0 ? { blocks: 0, arbBlocks: 0, observed: 0, predicted: 0 } : { blocks, arbBlocks: arb, observed: arb / blocks, predicted: pred / blocks };
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/ptrade.test.ts)`
Expected: `Tests  13 passed (13)`.

- [x] **Step 5: Log the interface requirement and commit**

Append under `## Decisions` in today's session log:

```markdown
- **Arbitrage identification (plan 05):** the dashboard counts a swap as arbitrage when `Swap.sender == routers.arb` in shared/deployments/sepolia.json. The arbitrage bot therefore swaps through its own PoolSwapTest instance, used by nothing else (plans 01 and 04).
```

```bash
git add app/src/lib/ptrade.ts app/src/lib/ptrade.test.ts docs/sessions
git commit -m "feat(app): rolling P_trade observed vs predicted with the lab band"
```

---

### Task 10: LP P&L explain and swap rows

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `981e307`.

**Delegable:** yes
**Depends on:** Task 5

Valuing arbitrage swaps at the desk's refTick would be biased: the refTick is 30 to 90 s old, and an arbitrageur buys right after the price went up, so a stale price systematically understates its profit. The arbitrageur's own price is recovered exactly from the post-swap price, using plan 04's band edges `[m(1 - f), m / (1 - f)]` (interface 3). The same module turns swaps into the rows of the recent-swaps table (side, size, fee paid, arbitrage or retail).

**Files:**
- Create: `app/src/lib/pnl.ts`
- Test: `app/src/lib/pnl.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/pnl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DeskReport, SwapRow } from "./decode";
import { pnlExplain, recentSwapRows, sigmaBreakEvenAnnualPct } from "./pnl";
import { ethUsdToTick, tickToEthUsd } from "./units";

const ARB = "0x3000000000000000000000000000000000000003";
const RETAIL = "0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe";
const E18 = 10n ** 18n;

function report(block: number, price: number): DeskReport {
  return {
    seq: block, tObs: block * 12, sigmaApplied: 1, sigmaReported: 1, rv15E9: 1, dvolE2: 0,
    refTick: ethUsdToTick(price, true), dispBp: 3, nSources: 4, kE4: 10_000, zone: 0, blockNumber: block,
    blockTimestamp: block * 12, latencySec: 0, txHash: "0x01", logIndex: 0,
  };
}
const sqrtX96 = (price: number) => BigInt(Math.floor(Math.sqrt(price) * 2 ** 96));
function swap(block: number, sender: string, amount0: bigint, amount1: bigint, fee: number, sqrtPriceX96 = sqrtX96(2_500), liquidity = 2n * 10n ** 22n): SwapRow {
  return {
    poolId: "0xaa", sender: sender as `0x${string}`, amount0, amount1, sqrtPriceX96, liquidity, tick: 0, fee,
    blockNumber: block, blockTimestamp: block * 12, txHash: "0x01", logIndex: 0,
  };
}

describe("pnlExplain", () => {
  const m = tickToEthUsd(ethUsdToTick(2_500, true), true); // reference price as stored on-chain (tick precision)
  const reports = [report(10, 2_500), report(20, 2_550)];

  it("values arbitrage at the bot's own reference price and retail fees at the desk price", () => {
    // The arb bot saw m = 2,600 (the desk still says 2,500), sold 1 ETH at 30 bp and pushed the
    // pool to the band edge m / (1 - f) = 2,607.8. It received 2,610 USD: profit at its own price = +10 USD.
    // Retail buys ETH paying 1,000 USD at 30 bp: fee 3 USD.
    const swaps = [
      swap(11, ARB, -1n * E18, 2_610n * E18, 3_000, sqrtX96(2_600 / 0.997)),
      swap(12, RETAIL, 399n * 10n ** 15n, -1_000n * E18, 3_000),
    ];
    const r = pnlExplain({ swaps, reports, poolId: "0xaa", token0IsEth: true, arbRouter: ARB });
    expect(r.swaps).toBe(2);
    expect(r.arbSwaps).toBe(1);
    expect(r.feeArbUsd).toBeCloseTo(0.003 * 2_600, 4);
    expect(r.feeRetailUsd).toBeCloseTo(3, 6);
    expect(r.arbUsd).toBeCloseTo(10, 4);
    expect(r.netUsd).toBeCloseTo(r.feeRetailUsd - r.arbUsd, 9);
    expect(r.volumeUsd).toBeCloseTo(2_600 + 0.399 * m, 3);
  });

  it("recovers the reference price when the arbitrageur bought ETH", () => {
    // Bot saw 2,400, bought 1 ETH paying 2,390 USD gross, pool pushed to 2,400 * (1 - f).
    const swaps = [swap(11, ARB, 1n * E18, -2_390n * E18, 3_000, sqrtX96(2_400 * 0.997))];
    const r = pnlExplain({ swaps, reports, poolId: "0xaa", token0IsEth: true, arbRouter: ARB });
    expect(r.arbUsd).toBeCloseTo(10, 4);
    expect(r.feeArbUsd).toBeCloseTo(2_390 * 0.003, 6);
  });

  it("computes LVR from the desk price path and the pool liquidity (L * sqrt(m) / 4 * dlnm^2)", () => {
    const swaps = [swap(11, RETAIL, 1n, -1n, 500), swap(25, RETAIL, 1n, -1n, 500)];
    const r = pnlExplain({ swaps, reports, poolId: "0xaa", token0IsEth: true, arbRouter: ARB });
    const m2 = tickToEthUsd(ethUsdToTick(2_550, true), true);
    const expected = (2e22 * Math.sqrt(m)) / 4 * Math.log(m2 / m) ** 2 / 1e18;
    expect(r.lvrUsd).toBeCloseTo(expected, 6);
  });

  it("handles a pool where token0 is tUSD", () => {
    const flipped = [report(10, 2_500)].map((x) => ({ ...x, refTick: ethUsdToTick(2_500, false) }));
    // token1 = tETH: pool price is ETH per USD = 1 / 2,500 after a zero-fee ETH sale.
    const swaps = [swap(11, ARB, 2_510n * E18, -1n * E18, 0, sqrtX96(1 / 2_500))];
    const r = pnlExplain({ swaps, reports: flipped, poolId: "0xaa", token0IsEth: false, arbRouter: ARB });
    expect(r.arbUsd).toBeCloseTo(10, 4);
  });

  it("ignores swaps of other pools and swaps before the first report", () => {
    const swaps = [swap(5, ARB, -1n * E18, 2_600n * E18, 500), { ...swap(11, ARB, -1n * E18, 2_600n * E18, 500), poolId: "0xbb" as const }];
    const r = pnlExplain({ swaps, reports, poolId: "0xaa", token0IsEth: true, arbRouter: ARB });
    expect(r.swaps).toBe(0);
    expect(r.unpricedSwaps).toBe(1);
  });
});

describe("sigmaBreakEvenAnnualPct", () => {
  it("solves sigma^2 * L * sqrt(m) / 4 = F", () => {
    // L = 2e22, m = 2,500 -> L*sqrt(m)/1e18 = 1e6 USD. At sigma = 50%/yr, LVR rate = s^2 * 1e6 / 4 per second.
    const s = 0.5 / Math.sqrt(31_536_000);
    const fee = (s * s * 1e6) / 4;
    expect(sigmaBreakEvenAnnualPct(fee, 2e22, 2_500)).toBeCloseTo(50, 6);
  });
});

describe("recentSwapRows", () => {
  it("lists the latest swaps of V and S, newest first, with side, size, fee and kind", () => {
    const key = { currency0: "0x01", currency1: "0x02", fee: 0, tickSpacing: 60, hooks: "0x03" } as never;
    const pair = { riskDesk: "0x04", hook: "0x03", startBlock: 0, token0IsEth: true, V: { poolId: "0xaa", key }, S: { poolId: "0xbb", key } } as never;
    const swaps = [
      swap(10, RETAIL, -2n * E18, 5_000n * E18, 500),
      { ...swap(11, ARB, 1n * E18, -2_500n * E18, 1_822), poolId: "0xbb" as const },
      { ...swap(12, RETAIL, 1n * E18, -2_500n * E18, 500), poolId: "0xcc" as const },
    ];
    const rows = recentSwapRows({ swaps, pair, arbRouter: ARB, limit: 5 });
    expect(rows.map((r) => [r.pool, r.side, r.ethAmount, r.feeBp, r.kind])).toEqual([
      ["S", "buy ETH", 1, 18.22, "arbitrage"],
      ["V", "sell ETH", 2, 5, "retail"],
    ]);
    expect(recentSwapRows({ swaps, pair, arbRouter: ARB, limit: 1 })).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/pnl.test.ts)`
Expected: `Error: Cannot find module './pnl' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/pnl.ts`:

```ts
import type { Address, Hex } from "viem";
import { type DeskReport, lastAtOrBefore, type SwapRow } from "./decode";
import type { PairDeployment } from "./deployments";
import { tickToEthUsd } from "./units";

/**
 * LP P&L explain from logs only (Milionis-Moallemi-Roughgarden): a delta-hedged LP earns
 * FEE_retail - ARB, and LVR ~= ARB + FEE_arb. Amounts are 18-decimal raw units; results in USD.
 * - Arbitrage swaps are valued at the arbitrageur's own reference price, recovered from the
 *   post-swap pool price: the arb bot (plan 04) pushes the pool exactly to the edge of the
 *   no-arbitrage band [m(1 - f), m / (1 - f)], so m = P_after / (1 - f) when it bought ETH and
 *   m = P_after * (1 - f) when it sold ETH.
 *   (Valuing them at the desk's refTick, 30 to 90 s old, would bias ARB downwards.)
 * - Retail fees and LVR use the desk's refTick in force. LVR assumes a constant full-range L.
 */
export type PnlRow = {
  swaps: number;
  arbSwaps: number;
  unpricedSwaps: number; // swaps before the first desk report
  volumeUsd: number;
  feeArbUsd: number;
  feeRetailUsd: number;
  arbUsd: number; // arbitrageurs' profit net of the fees they paid
  lvrUsd: number;
  netUsd: number; // feeRetailUsd - arbUsd
};

const E18 = 1e18;

/** ETH/USD price after a swap, from sqrtPriceX96 (token1 per token0, 18/18 decimals). */
export function postSwapEthUsd(sqrtPriceX96: bigint, token0IsEth: boolean): number {
  const p = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
  return token0IsEth ? p : 1 / p;
}

export function pnlExplain(o: {
  swaps: SwapRow[];
  reports: DeskReport[];
  poolId: Hex;
  token0IsEth: boolean;
  arbRouter?: Address;
}): PnlRow {
  const row: PnlRow = { swaps: 0, arbSwaps: 0, unpricedSwaps: 0, volumeUsd: 0, feeArbUsd: 0, feeRetailUsd: 0, arbUsd: 0, lvrUsd: 0, netUsd: 0 };
  const arb = o.arbRouter?.toLowerCase();
  const priceAt = (block: number): number | undefined => {
    const i = lastAtOrBefore(o.reports, block);
    return i < 0 ? undefined : tickToEthUsd(o.reports[i].refTick, o.token0IsEth);
  };

  const mine = o.swaps.filter((s) => s.poolId === o.poolId);
  for (const s of mine) {
    const ref = priceAt(s.blockNumber);
    if (ref === undefined) {
      row.unpricedSwaps++;
      continue;
    }
    const eth = Number(o.token0IsEth ? s.amount0 : s.amount1) / E18;
    const usd = Number(o.token0IsEth ? s.amount1 : s.amount0) / E18;
    const isArb = arb !== undefined && s.sender.toLowerCase() === arb;
    const f = s.fee / 1e6;
    const after = postSwapEthUsd(s.sqrtPriceX96, o.token0IsEth);
    const m = isArb ? (eth > 0 ? after / (1 - f) : after * (1 - f)) : ref;
    const paidUsd = eth < 0 ? -eth * m : -usd; // input side, gross of fee
    const feeUsd = paidUsd * f;
    row.swaps++;
    row.volumeUsd += Math.abs(eth) * m;
    if (isArb) {
      row.arbSwaps++;
      row.feeArbUsd += feeUsd;
      row.arbUsd += eth * m + usd;
    } else {
      row.feeRetailUsd += feeUsd;
    }
  }

  if (mine.length > 0) {
    const L = Number(mine[mine.length - 1].liquidity);
    const fromBlock = mine[0].blockNumber;
    for (let i = 1; i < o.reports.length; i++) {
      if (o.reports[i].blockNumber < fromBlock) continue;
      const m0 = tickToEthUsd(o.reports[i - 1].refTick, o.token0IsEth);
      const m1 = tickToEthUsd(o.reports[i].refTick, o.token0IsEth);
      row.lvrUsd += ((L * Math.sqrt(m0)) / 4) * Math.log(m1 / m0) ** 2 / E18;
    }
  }
  row.netUsd = row.feeRetailUsd - row.arbUsd;
  return row;
}

/** σ_BE = 2·sqrt(F / (L·sqrt(m))): above this annualised volatility, fee income F (USD/s) is below LVR. */
export function sigmaBreakEvenAnnualPct(feeUsdPerSec: number, liquidity: number, ethUsd: number): number {
  const depthUsd = (liquidity * Math.sqrt(ethUsd)) / E18;
  if (depthUsd <= 0 || feeUsdPerSec < 0) return Number.NaN;
  return 2 * Math.sqrt(feeUsdPerSec / depthUsd) * Math.sqrt(31_536_000) * 100;
}

export type SwapView = {
  key: string;
  t: number;
  pool: "V" | "S";
  side: "buy ETH" | "sell ETH"; // from the swapper's side
  ethAmount: number;
  feeBp: number;
  kind: "arbitrage" | "retail";
  txHash: Hex;
};

/** The latest swaps on V and S, newest first, with the fee each one actually paid. */
export function recentSwapRows(o: { swaps: SwapRow[]; pair: PairDeployment; arbRouter?: Address; limit: number }): SwapView[] {
  const arb = o.arbRouter?.toLowerCase();
  const out: SwapView[] = [];
  for (let i = o.swaps.length - 1; i >= 0 && out.length < o.limit; i--) {
    const s = o.swaps[i];
    const pool = s.poolId === o.pair.V.poolId ? "V" : s.poolId === o.pair.S.poolId ? "S" : null;
    if (!pool) continue;
    const eth = Number(o.pair.token0IsEth ? s.amount0 : s.amount1) / E18;
    out.push({
      key: `${s.txHash}:${s.logIndex}`,
      t: s.blockTimestamp,
      pool,
      side: eth > 0 ? "buy ETH" : "sell ETH",
      ethAmount: Math.abs(eth),
      feeBp: s.fee / 100,
      kind: arb !== undefined && s.sender.toLowerCase() === arb ? "arbitrage" : "retail",
      txHash: s.txHash,
    });
  }
  return out;
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/pnl.test.ts)`
Expected: `Tests  7 passed (7)`.

- [x] **Step 5: Commit**

```bash
git add app/src/lib/pnl.ts app/src/lib/pnl.test.ts
git commit -m "feat(app): LP P&L explain, break-even vol and recent-swap rows"
```

---

### Task 11: Chain data layer (RPCs, chunked logs, snapshot schema)

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `177cc55`. The Step 5 line is in `docs/sessions/2026-10-06.md` ("Frontend build log", Surprises).

**Delegable:** yes
**Depends on:** Tasks 5, 6

Measured on 2026-10-06 (and the snapshot script of Task 23 was run against real Sepolia logs: 35 swaps of an existing pool and 3 rejected `ReportProcessed` deliveries to an existing receiver in 3,000 blocks): `https://ethereum-sepolia-rpc.publicnode.com` answers `eth_getLogs` only for about the last 10,000 blocks (`4444 pruned history unavailable`) and caps ranges at 50,000 blocks; `https://sepolia.gateway.tenderly.co` serves full history (20,000 blocks of PoolManager logs in 4 chunks of 5,000 took about 9 s). Both return `blockTimestamp` in logs and allow CORS (`Access-Control-Allow-Origin: *`). viem's `fallback` transport moves to the next RPC on these errors.

**Files:**
- Create: `app/src/lib/chain.ts`
- Test: `app/src/lib/chain.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/chain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fillTimestamps, getLogsChunked, type LogFilter, mergeLogs, parseSnapshot, rpcUrls } from "./chain";
import type { RawLog } from "./encode";

const log = (block: number, logIndex: number, ts?: number): RawLog => ({
  address: "0x01",
  topics: ["0x02"],
  data: "0x",
  blockNumber: `0x${block.toString(16)}`,
  ...(ts === undefined ? {} : { blockTimestamp: `0x${ts.toString(16)}` as const }),
  transactionHash: `0x${block.toString(16).padStart(64, "0")}`,
  logIndex: `0x${logIndex.toString(16)}`,
});

describe("getLogsChunked", () => {
  const filter: LogFilter = { address: "0x0000000000000000000000000000000000000001", topics: ["0x02"] };

  it("walks the range sequentially and concatenates results", async () => {
    const seen: [number, number][] = [];
    const out = await getLogsChunked(async (f) => {
      const a = Number(f.fromBlock);
      const b = Number(f.toBlock);
      seen.push([a, b]);
      return [log(a, 0)];
    }, filter, 100, 250, { chunk: 100 });
    expect(seen).toEqual([[100, 199], [200, 250]]);
    expect(out).toHaveLength(2);
  });

  it("halves the chunk when the RPC rejects the range, then continues", async () => {
    const seen: [number, number][] = [];
    await getLogsChunked(async (f) => {
      const a = Number(f.fromBlock);
      const b = Number(f.toBlock);
      if (b - a + 1 > 50) throw new Error("exceed maximum block range: 50");
      seen.push([a, b]);
      return [];
    }, filter, 0, 119, { chunk: 100, minChunk: 10 });
    expect(seen).toEqual([[0, 49], [50, 99], [100, 119]]);
  });

  it("rethrows other errors", async () => {
    await expect(
      getLogsChunked(async () => {
        throw new Error("network down");
      }, filter, 0, 10),
    ).rejects.toThrow("network down");
  });
});

describe("mergeLogs", () => {
  it("dedupes on (tx hash, log index) and sorts in chain order", () => {
    const merged = mergeLogs([log(5, 1), log(3, 0)], [log(5, 1), log(4, 2), log(5, 0)]);
    expect(merged.map((l) => [Number(l.blockNumber), Number(l.logIndex)])).toEqual([[3, 0], [4, 2], [5, 0], [5, 1]]);
  });
});

describe("fillTimestamps", () => {
  it("keeps RPC timestamps and estimates missing ones at 12 s per block from an anchor", () => {
    const out = fillTimestamps([log(100, 0, 5_000), log(90, 0)], { block: 110, t: 5_130 });
    expect(Number(out[0].blockTimestamp)).toBe(5_000);
    expect(Number(out[1].blockTimestamp)).toBe(5_130 - 20 * 12);
  });
});

describe("parseSnapshot", () => {
  it("accepts a snapshot for the requested pair and rejects others", () => {
    const snap = { schema: "clim.chainSnapshot/1", pair: "live", chainId: 11155111, fromBlock: 1, toBlock: 2, generatedAt: "x", deskLogs: [], swapLogs: [] };
    expect(parseSnapshot(snap, "live")?.toBlock).toBe(2);
    expect(parseSnapshot(snap, "live")?.forwarderLogs).toEqual([]);
    expect(parseSnapshot(snap, "replay")).toBeNull();
    expect(parseSnapshot({ nope: 1 }, "live")).toBeNull();
  });
});

describe("rpcUrls", () => {
  it("puts an override first and keeps the public fallbacks", () => {
    expect(rpcUrls("https://my.rpc")).toEqual([
      "https://my.rpc",
      "https://sepolia.gateway.tenderly.co",
      "https://ethereum-sepolia-rpc.publicnode.com",
    ]);
    expect(rpcUrls(undefined)[0]).toBe("https://sepolia.gateway.tenderly.co");
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/chain.test.ts)`
Expected: `Error: Cannot find module './chain' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/chain.ts`:

```ts
import { type Address, createPublicClient, fallback, type Hex, http, numberToHex, pad, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { climHookAbi, REPORT_PROCESSED_TOPIC, RISK_REPORTED_TOPIC, riskDeskAbi, stateViewAbi, SWAP_TOPIC } from "./abis";
import type { Deployments, Pair, PairDeployment } from "./deployments";
import type { RawLog } from "./encode";
import type { DeskState, FeeMode, Quote } from "./feeMath";

// Tenderly's public gateway serves full log history; publicnode only keeps about the last
// 10,000 blocks of logs ("pruned history unavailable") and caps eth_getLogs at 50,000 blocks.
export const PUBLIC_RPCS = ["https://sepolia.gateway.tenderly.co", "https://ethereum-sepolia-rpc.publicnode.com"];
export const LOG_CHUNK = 5_000;

export function rpcUrls(override: string | undefined = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL): string[] {
  return override ? [override, ...PUBLIC_RPCS] : PUBLIC_RPCS;
}

export function makeClient(urls: string[] = rpcUrls()): PublicClient {
  return createPublicClient({
    chain: sepolia,
    transport: fallback(urls.map((u) => http(u, { timeout: 30_000, retryCount: 1 }))),
  });
}

export type LogFilter = { address: Address | Address[]; topics: (Hex | Hex[] | null)[] };
export type LogRequester = (f: LogFilter & { fromBlock: Hex; toBlock: Hex }) => Promise<RawLog[]>;

const RANGE_ERROR = /range|limit|too many|exceed|10000|response size/i;

/** Sequential chunked eth_getLogs; halves the chunk when a public RPC rejects the range. */
export async function getLogsChunked(
  request: LogRequester,
  filter: LogFilter,
  from: number,
  to: number,
  opts: { chunk?: number; minChunk?: number } = {},
): Promise<RawLog[]> {
  let chunk = opts.chunk ?? LOG_CHUNK;
  const minChunk = opts.minChunk ?? 100;
  const out: RawLog[] = [];
  let a = from;
  while (a <= to) {
    const b = Math.min(a + chunk - 1, to);
    try {
      out.push(...(await request({ ...filter, fromBlock: numberToHex(a), toBlock: numberToHex(b) })));
      a = b + 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!RANGE_ERROR.test(msg) || chunk <= minChunk) throw e;
      chunk = Math.max(minChunk, Math.floor(chunk / 2));
    }
  }
  return out;
}

export function mergeLogs(a: RawLog[], b: RawLog[]): RawLog[] {
  const byKey = new Map<string, RawLog>();
  for (const l of [...a, ...b]) byKey.set(`${l.transactionHash}:${Number(l.logIndex)}`, l);
  return [...byKey.values()].sort(
    (x, y) => Number(x.blockNumber) - Number(y.blockNumber) || Number(x.logIndex) - Number(y.logIndex),
  );
}

export function fillTimestamps(logs: RawLog[], anchor: { block: number; t: number }, blockSec = 12): RawLog[] {
  return logs.map((l) =>
    l.blockTimestamp ? l : { ...l, blockTimestamp: numberToHex(anchor.t - (anchor.block - Number(l.blockNumber)) * blockSec) },
  );
}

export type ChainSnapshot = {
  schema: "clim.chainSnapshot/1";
  pair: Pair;
  chainId: number;
  fromBlock: number;
  toBlock: number;
  generatedAt: string;
  deskLogs: RawLog[];
  swapLogs: RawLog[];
  forwarderLogs: RawLog[];
};

export function parseSnapshot(raw: unknown, pair: Pair): ChainSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as ChainSnapshot;
  if (s.schema !== "clim.chainSnapshot/1" || s.pair !== pair || !Array.isArray(s.deskLogs) || !Array.isArray(s.swapLogs)) return null;
  return { ...s, forwarderLogs: Array.isArray(s.forwarderLogs) ? s.forwarderLogs : [] };
}

export function requesterFor(client: PublicClient): LogRequester {
  return (f) => client.request({ method: "eth_getLogs", params: [f] }) as Promise<RawLog[]>;
}

export type PairLogs = { deskLogs: RawLog[]; swapLogs: RawLog[]; forwarderLogs: RawLog[] };

export async function fetchPairLogs(
  client: PublicClient,
  d: PairDeployment,
  dep: Pick<Deployments, "uniswap" | "chainlink">,
  from: number,
  to: number,
): Promise<PairLogs> {
  const request = requesterFor(client);
  const deskLogs = await getLogsChunked(request, { address: d.riskDesk, topics: [RISK_REPORTED_TOPIC] }, from, to);
  const swapLogs = await getLogsChunked(
    request,
    { address: dep.uniswap.poolManager, topics: [SWAP_TOPIC, [d.V.poolId, d.S.poolId]] },
    from,
    to,
  );
  const forwarders = [dep.chainlink.mockKeystoneForwarder, dep.chainlink.keystoneForwarder].filter((a): a is Address => !!a);
  const forwarderLogs = forwarders.length
    ? await getLogsChunked(request, { address: forwarders, topics: [REPORT_PROCESSED_TOPIC, pad(d.riskDesk.toLowerCase() as Hex, { size: 32 })] }, from, to)
    : [];
  return { deskLogs, swapLogs, forwarderLogs };
}

export type PairState = {
  desk: DeskState;
  quote: Quote;
  latestBlock: { number: number; timestamp: number };
  protocolFees: { V: number; S: number }; // must be 0: Swap.fee is then the LP fee alone
};

export async function readPairState(client: PublicClient, d: PairDeployment, stateView: Address): Promise<PairState> {
  const block = await client.getBlock({ blockTag: "latest" });
  const at = { blockNumber: block.number };
  const [state, quote, slotV, slotS] = await Promise.all([
    client.readContract({ address: d.riskDesk, abi: riskDeskAbi, functionName: "state", ...at }),
    client.readContract({ address: d.hook, abi: climHookAbi, functionName: "quoteFee", ...at }),
    client.readContract({ address: stateView, abi: stateViewAbi, functionName: "getSlot0", args: [d.V.poolId], ...at }),
    client.readContract({ address: stateView, abi: stateViewAbi, functionName: "getSlot0", args: [d.S.poolId], ...at }),
  ]);
  const [tObs, sigmaE9, kE4, flags, seq] = state;
  const [fee, mode] = quote;
  return {
    desk: { tObs, sigmaE9, kE4, flags, seq },
    quote: { feePips: fee, mode: mode as FeeMode },
    latestBlock: { number: Number(block.number), timestamp: Number(block.timestamp) },
    protocolFees: { V: slotV[2], S: slotS[2] },
  };
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/chain.test.ts)`
Expected: `Tests  7 passed (7)`.

- [x] **Step 5: Log the RPC finding and commit**

Append under a `## Surprises` heading at the end of today's session log (create the heading if it does not exist):

```markdown
- **Sepolia RPC log history (plan 05):** publicnode serves `eth_getLogs` only for about the last 10,000 blocks ("pruned history unavailable") and caps ranges at 50,000 blocks; Tenderly's public gateway (https://sepolia.gateway.tenderly.co) serves full history. The dashboard uses Tenderly first, publicnode as fallback, 5,000-block chunks, and a frozen log snapshot before submission. Bots and scripts that scan old logs should not rely on publicnode.
```

```bash
git add app/src/lib/chain.ts app/src/lib/chain.test.ts docs/sessions
git commit -m "feat(app): chunked eth_getLogs with RPC fallback and snapshot schema"
```

---

### Task 12: Deterministic mock chain

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `10e68c1`. The Step 5 line is in `docs/sessions/2026-10-06.md` ("Frontend build log", Surprises); as logged it cites plan 04's depth (L about 5.2e23), and the correction below it gives about 1.5 bp per $2,000 order, not 0.15 bp.

**Delegable:** yes
**Depends on:** Tasks 5, 6, 8, 9, 10

Six hours of 12 s blocks: a calm 35% regime, a storm peaking at 180% (55% of the run), a degraded window (venues disagree, 30 to 32%), a cut CRE loop (no reports, 85 to 87%, so the hook goes blind), one forged report rejected by the forwarder (70%), mirrored retail flow, and an arbitrageur that pushes each pool to the edge of its band `[m(1 - f), m / (1 - f)]` like plan 04's bot. L = 2e23 (about $20M TVL) and retail orders of about $500 keep retail price impact below the 5 bp floor; with $3k orders on $2M the observed P_trade was 0.64 against 0.20 predicted, because every retail trade then creates an arbitrage.

**Files:**
- Create: `app/src/lib/mock.ts`
- Test: `app/src/lib/mock.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/src/lib/mock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeDeliveries, decodeReports, decodeSwaps } from "./decode";
import { computePoolId } from "./deployments";
import { FeeMode, type FeeParams } from "./feeMath";
import { makeMockWorld, MOCK_STATIC_FEE_PIPS } from "./mock";
import { pnlExplain } from "./pnl";
import { arbBlocksOf } from "./ptrade";
import { weatherSeries } from "./series";

const params: FeeParams = { etaE4: 41_760, sqrtHalfDtE6: 2_449_490, feeMinPips: 500, feeMaxPips: 15_000, feeSafePips: 3_000, tauKillSec: 180 };
const NOW = 1_791_300_000;

describe("makeMockWorld", () => {
  const w = makeMockWorld({ nowSec: NOW, params });
  const reports = decodeReports(w.deskLogs);
  const swaps = decodeSwaps(w.swapLogs);

  it("is deterministic for a given seed and time", () => {
    const again = makeMockWorld({ nowSec: NOW, params });
    expect(again.deskLogs).toEqual(w.deskLogs);
    expect(again.swapLogs).toEqual(w.swapLogs);
  });
  it("emits a report every 30 s except during the cut-loop gap", () => {
    expect(reports.length).toBeGreaterThan(650);
    expect(reports.length).toBeLessThan(720);
    expect(reports.every((r, i) => i === 0 || r.seq === reports[i - 1].seq + 1)).toBe(true);
  });
  it("shows the three hook modes and a storm above the static pool's fee", () => {
    const s = weatherSeries(reports, params, NOW);
    const modes = new Set(s.map((x) => x.mode));
    expect(modes).toEqual(new Set([FeeMode.Normal, FeeMode.Degraded, FeeMode.Blind]));
    expect(Math.max(...s.map((x) => x.feeVBp))).toBeGreaterThan(MOCK_STATIC_FEE_PIPS / 100);
    expect(Math.min(...s.map((x) => x.feeVBp))).toBe(5);
  });
  it("uses pool ids that hash from the mock keys", () => {
    expect(w.pair.V.poolId).toBe(computePoolId(w.pair.V.key));
    expect(w.pair.S.poolId).toBe(computePoolId(w.pair.S.key));
  });
  it("produces arbitrage and retail swaps on both pools with a sensible P&L explain", () => {
    for (const pool of [w.pair.V, w.pair.S]) {
      expect(arbBlocksOf(swaps, pool.poolId, w.arbRouter).size).toBeGreaterThan(50);
      const r = pnlExplain({ swaps, reports, poolId: pool.poolId, token0IsEth: true, arbRouter: w.arbRouter });
      expect(r.arbSwaps).toBeLessThan(r.swaps);
      expect(r.arbUsd).toBeGreaterThan(0);
      expect(r.feeRetailUsd).toBeGreaterThan(0);
      expect(r.lvrUsd).toBeGreaterThan(0);
    }
  });
  it("records one rejected forged report next to the accepted deliveries", () => {
    const d = decodeDeliveries(w.forwarderLogs);
    expect(d.filter((x) => !x.accepted)).toHaveLength(1);
    expect(d.filter((x) => x.accepted)).toHaveLength(reports.length);
  });
  it("exposes the latest desk state and quote", () => {
    expect(w.desk.seq).toBe(reports.at(-1)?.seq);
    expect(w.latestBlock.timestamp).toBe(NOW);
    expect(w.quote.feePips).toBeGreaterThanOrEqual(500);
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/mock.test.ts)`
Expected: `Error: Cannot find module './mock' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/src/lib/mock.ts`:

```ts
// Deterministic mock chain (RiskReported + Swap logs) so the dashboard runs before the contracts
// are deployed. The logs are ABI-encoded exactly like the real ones and go through the same decoders.
import { type Address, type Hex, numberToHex } from "viem";
import { computePoolId, type PairDeployment } from "./deployments";
import { encodeReportProcessedLog, encodeRiskReportedLog, encodeSwapLog, type RawLog } from "./encode";
import { type DeskState, type FeeParams, FLAG_DEGRADED, type Quote, quoteFee } from "./feeMath";
import { DISP_MAX_BP } from "./series";
import { annualPctToSigmaE9, ethUsdToTick, SQRT_SECONDS_PER_YEAR } from "./units";

export const MOCK_STATIC_FEE_PIPS = 1_050;
export const MOCK_ADDR = {
  tETH: "0x1000000000000000000000000000000000000001",
  tUSD: "0x2000000000000000000000000000000000000002",
  arbRouter: "0x3000000000000000000000000000000000000003",
  riskDesk: "0x4000000000000000000000000000000000000004",
  hook: "0x5000000000000000000000000000000000001080",
  retailRouter: "0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe",
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  forwarder: "0x15fC6ae953E024d975e77382eEeC56A9101f9F88",
} as const satisfies Record<string, Address>;

const SIGMA_MIN_E9 = 17_807;
const SIGMA_MAX_E9 = 1_780_724;
const BLOCK_SEC = 12;
const REPORT_EVERY_SEC = 30;
const REPORT_LATENCY_SEC = 36;
const LIQUIDITY = 2e23; // full-range L in raw units: about $20M of TVL at $2,500
const Q96 = 2 ** 96;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type MockWorld = {
  pair: PairDeployment;
  arbRouter: Address;
  deskLogs: RawLog[];
  swapLogs: RawLog[];
  forwarderLogs: RawLog[];
  desk: DeskState;
  quote: Quote;
  latestBlock: { number: number; timestamp: number };
  protocolFees: { V: number; S: number };
};

type Pool = { poolId: Hex; s: number; dynamic: boolean };

export function makeMockWorld(o: { nowSec: number; params: FeeParams; seed?: number; hours?: number }): MockWorld {
  const rand = mulberry32(o.seed ?? 7);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const nBlocks = Math.floor(((o.hours ?? 6) * 3_600) / BLOCK_SEC);
  const firstBlock = 9_000_000;
  const t0 = o.nowSec - nBlocks * BLOCK_SEC;

  const keyV = { currency0: MOCK_ADDR.tETH, currency1: MOCK_ADDR.tUSD, fee: 0x800000, tickSpacing: 60, hooks: MOCK_ADDR.hook };
  const keyS = { ...keyV, fee: MOCK_STATIC_FEE_PIPS, hooks: "0x0000000000000000000000000000000000000000" as Address };
  const pair: PairDeployment = {
    riskDesk: MOCK_ADDR.riskDesk,
    hook: MOCK_ADDR.hook,
    startBlock: firstBlock,
    token0IsEth: true,
    V: { poolId: computePoolId(keyV), key: keyV },
    S: { poolId: computePoolId(keyS), key: keyS },
  };

  // Vol regime (annualised %): calm 35%, a storm peaking at 180% around 55% of the run.
  const volPct = (t: number) => 35 + 145 * Math.exp(-((((t - t0) / (o.nowSec - t0) - 0.55) / 0.07) ** 2));
  const phase = (t: number) => (t - t0) / (o.nowSec - t0);
  const gap = (t: number) => phase(t) > 0.85 && phase(t) < 0.87; // CRE loop cut: no reports
  const degraded = (t: number) => phase(t) > 0.3 && phase(t) < 0.32; // venues disagree
  const forgedAt = t0 + Math.round(0.7 * (o.nowSec - t0)); // a third party pushes sigma = 0 through the mock forwarder

  // Market path, one log-price step per block.
  const lnm: number[] = [Math.log(2_500)];
  for (let b = 1; b <= nBlocks; b++) {
    const t = t0 + b * BLOCK_SEC;
    lnm.push(lnm[b - 1] + (volPct(t) / 100 / SQRT_SECONDS_PER_YEAR) * Math.sqrt(BLOCK_SEC) * gauss());
  }

  const deskLogs: RawLog[] = [];
  const swapLogs: RawLog[] = [];
  const forwarderLogs: RawLog[] = [];
  let forged = false;
  let desk: DeskState = { tObs: 0, sigmaE9: 0, kE4: 0, flags: 0, seq: 0 };
  let nextReport = t0 + REPORT_EVERY_SEC;
  const pools: Pool[] = [
    { poolId: pair.V.poolId, s: 50, dynamic: true },
    { poolId: pair.S.poolId, s: 50, dynamic: false },
  ];

  for (let b = 1; b <= nBlocks; b++) {
    const t = t0 + b * BLOCK_SEC;
    const block = firstBlock + b;
    let logIndex = 0;
    const meta = (address: Hex) => ({
      address,
      blockNumber: block,
      blockTimestamp: t,
      transactionHash: numberToHex(block * 1_000 + logIndex, { size: 32 }),
      logIndex: logIndex++,
    });

    const delivery = (result: boolean) =>
      encodeReportProcessedLog(
        { receiver: MOCK_ADDR.riskDesk, workflowExecutionId: numberToHex(block, { size: 32 }), reportId: "0x0001", result },
        meta(MOCK_ADDR.forwarder),
      );
    if (!forged && t >= forgedAt) {
      forged = true;
      forwarderLogs.push(delivery(false));
    }

    while (nextReport + REPORT_LATENCY_SEC <= t) {
      const tObs = nextReport;
      nextReport += REPORT_EVERY_SEC;
      if (gap(tObs)) continue;
      const reported = annualPctToSigmaE9(volPct(tObs) * (1 + 0.12 * gauss()));
      const prev = desk.sigmaE9;
      const lo = prev === 0 ? SIGMA_MIN_E9 : Math.max(SIGMA_MIN_E9, Math.floor(0.8 * prev));
      const hi = prev === 0 ? SIGMA_MAX_E9 : Math.min(SIGMA_MAX_E9, 2 * prev);
      const applied = Math.min(hi, Math.max(lo, reported));
      const dispBp = degraded(tObs) ? 31 : 2 + Math.floor(rand() * 4);
      const seq = desk.seq + 1;
      const bObs = Math.min(nBlocks, Math.max(0, Math.floor((tObs - t0) / BLOCK_SEC)));
      deskLogs.push(
        encodeRiskReportedLog(
          {
            seq, tObs, sigmaApplied: applied, sigmaReported: reported, rv15E9: reported,
            dvolE2: Math.round((volPct(tObs) * 1.05 + 3) * 100), refTick: ethUsdToTick(Math.exp(lnm[bObs]), true),
            dispBp, nSources: degraded(tObs) ? 3 : 4, kE4: 10_000, zone: 0,
          },
          meta(MOCK_ADDR.riskDesk),
        ),
      );
      forwarderLogs.push(delivery(true));
      desk = { tObs, sigmaE9: applied, kE4: 10_000, flags: dispBp > DISP_MAX_BP ? FLAG_DEGRADED : 0, seq };
    }

    const m = Math.exp(lnm[b]);
    const retail = rand() < 0.45 ? { buy: rand() < 0.5, usd: 500 * Math.exp(0.8 * gauss()) } : null;
    for (const pool of pools) {
      const feePips = pool.dynamic ? quoteFee(desk, t, o.params).feePips : MOCK_STATIC_FEE_PIPS;
      const f = feePips / 1e6;
      const emit = (sender: Address, s1: number) => {
        const s0 = pool.s;
        const dx = LIQUIDITY * (1 / s1 - 1 / s0); // token0 (ETH) into the pool, net of fee
        const dy = LIQUIDITY * (s1 - s0); // token1 (USD) into the pool, net of fee
        const amount0 = dx > 0 ? -dx / (1 - f) : -dx;
        const amount1 = dy > 0 ? -dy / (1 - f) : -dy;
        pool.s = s1;
        swapLogs.push(
          encodeSwapLog(
            {
              poolId: pool.poolId, sender, amount0: BigInt(Math.round(amount0)), amount1: BigInt(Math.round(amount1)),
              sqrtPriceX96: BigInt(Math.floor(s1 * Q96)), liquidity: BigInt(LIQUIDITY), tick: ethUsdToTick(s1 * s1, true), fee: feePips,
            },
            meta(MOCK_ADDR.poolManager),
          ),
        );
      };
      // Top of block: like the arb bot of plan 04, push the pool to the edge of the no-arbitrage band
      // [m(1 - f), m / (1 - f)].
      const p = pool.s * pool.s;
      if (p < m * (1 - f)) emit(MOCK_ADDR.arbRouter, Math.sqrt(m * (1 - f)));
      else if (p > m / (1 - f)) emit(MOCK_ADDR.arbRouter, Math.sqrt(m / (1 - f)));
      // Then retail flow, the same order on both pools.
      if (retail) {
        const s0 = pool.s;
        const s1 = retail.buy
          ? s0 + (retail.usd * 1e18 * (1 - f)) / LIQUIDITY
          : 1 / (1 / s0 + ((retail.usd / m) * 1e18 * (1 - f)) / LIQUIDITY);
        emit(MOCK_ADDR.retailRouter, s1);
      }
    }
  }

  return {
    pair,
    arbRouter: MOCK_ADDR.arbRouter,
    deskLogs,
    swapLogs,
    forwarderLogs,
    desk,
    quote: quoteFee(desk, o.nowSec, o.params),
    latestBlock: { number: firstBlock + nBlocks, timestamp: o.nowSec },
    protocolFees: { V: 0, S: 0 },
  };
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/mock.test.ts)`
Expected: `Tests  7 passed (7)`.

- [x] **Step 5: Log the retail-flow finding and commit**

Append under `## Surprises` in today's session log:

```markdown
- **Retail noise inflates observed P_trade (plan 05 mock):** retail orders whose price impact approaches the fee floor create extra arbitrage blocks ($3k orders on $2M of full-range TVL: observed 0.64 vs predicted 0.20; $500 orders on $20M: 0.21 vs 0.195). Plan 01's pool depth (100,000 tETH per pool, L about 5.2e24: a $2,000 order moves the price about 0.15 bp) keeps this effect small; keep it that way, or the live validation chart will look wrong for a reason unrelated to the model.
```

```bash
git add app/src/lib/mock.ts app/src/lib/mock.test.ts docs/sessions
git commit -m "feat(app): deterministic mock chain with storm, degraded, blind and forged report"
```

---

### Task 13: Sync script and static fixtures

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `34cf9ec`. `sync-data.mjs` also reads `CLIM_ROOT` (a clim checkout next to clim-front); in clim the default, the parent directory, applies.

**Delegable:** yes
**Depends on:** Task 1

**Files:**
- Create: `app/scripts/sync-data.mjs`, `app/src/fixtures/deployments.sepolia.json`, `app/src/fixtures/params.json`, `app/src/fixtures/faq.md`
- Test: `app/scripts/sync-data.test.ts`

- [x] **Step 1: Write the failing test**

Create `app/scripts/sync-data.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAB_FILES, syncData } from "./sync-data.mjs";

function fakeRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "clim-sync-"));
  const appRoot = join(repoRoot, "app");
  mkdirSync(join(appRoot, "src/fixtures/lab"), { recursive: true });
  writeFileSync(join(appRoot, "src/fixtures/deployments.sepolia.json"), '{"fixture":true}');
  writeFileSync(join(appRoot, "src/fixtures/params.json"), '{"fixture":true}');
  writeFileSync(join(appRoot, "src/fixtures/faq.md"), "fixture faq");
  for (const f of LAB_FILES) writeFileSync(join(appRoot, "src/fixtures/lab", f), '{"fixture":true}');
  return { repoRoot, appRoot };
}

describe("syncData", () => {
  it("falls back to fixtures when the repo files do not exist", () => {
    const { repoRoot, appRoot } = fakeRepo();
    const report = syncData({ repoRoot, appRoot });
    expect(report.every((r: { source: string }) => r.source === "fixture")).toBe(true);
    expect(readFileSync(join(appRoot, "src/generated/params.json"), "utf8")).toBe('{"fixture":true}');
    expect(readFileSync(join(appRoot, "src/generated/faq.ts"), "utf8")).toContain('export const FAQ_MD = "fixture faq";');
  });
  it("prefers the repo's shared/, lab/out and docs/faq.md", () => {
    const { repoRoot, appRoot } = fakeRepo();
    mkdirSync(join(repoRoot, "shared/deployments"), { recursive: true });
    mkdirSync(join(repoRoot, "lab/out"), { recursive: true });
    mkdirSync(join(repoRoot, "docs"), { recursive: true });
    writeFileSync(join(repoRoot, "shared/params.json"), '{"pStar":0.3}');
    writeFileSync(join(repoRoot, "lab/out/ptrade-band.json"), '{"real":true}');
    writeFileSync(join(repoRoot, "docs/faq.md"), "real faq");
    const report = syncData({ repoRoot, appRoot });
    expect(readFileSync(join(appRoot, "src/generated/params.json"), "utf8")).toBe('{"pStar":0.3}');
    expect(readFileSync(join(appRoot, "public/data/lab/ptrade-band.json"), "utf8")).toBe('{"real":true}');
    expect(readFileSync(join(appRoot, "src/generated/faq.ts"), "utf8")).toContain("real faq");
    expect(report.find((r: { file: string }) => r.file === "src/generated/sepolia.json")?.source).toBe("fixture");
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run scripts/sync-data.test.ts)`
Expected: `Error: Cannot find module './sync-data.mjs' imported from …`, `Test Files  1 failed (1)`.

- [x] **Step 3: Minimal implementation**

Create `app/scripts/sync-data.mjs`:

```js
// Copies the repo's single sources of truth into the app so the app builds on its own (Vercel
// deploys only app/). Real files win; fixtures fill the gaps. Run: npm run sync
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LAB_FILES = ["summary.json", "replay-2026-02-04.json", "ptrade-band.json"];

export function syncData({ repoRoot, appRoot }) {
  const report = [];
  const pick = (real, fixture) => (existsSync(real) ? { from: real, fixture: false } : { from: fixture, fixture: true });
  const copy = (real, fixture, dest) => {
    const src = pick(real, fixture);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src.from, dest);
    report.push({ file: dest.slice(appRoot.length + 1), source: src.fixture ? "fixture" : "repo" });
  };
  const fx = join(appRoot, "src/fixtures");
  copy(join(repoRoot, "shared/deployments/sepolia.json"), join(fx, "deployments.sepolia.json"), join(appRoot, "src/generated/sepolia.json"));
  copy(join(repoRoot, "shared/params.json"), join(fx, "params.json"), join(appRoot, "src/generated/params.json"));
  for (const f of LAB_FILES) copy(join(repoRoot, "lab/out", f), join(fx, "lab", f), join(appRoot, "public/data/lab", f));

  const faq = pick(join(repoRoot, "docs/faq.md"), join(fx, "faq.md"));
  const faqOut = join(appRoot, "src/generated/faq.ts");
  writeFileSync(faqOut, `// Generated by scripts/sync-data.mjs from ${faq.fixture ? "src/fixtures/faq.md" : "docs/faq.md"}. Do not edit.\nexport const FAQ_MD = ${JSON.stringify(readFileSync(faq.from, "utf8"))};\n`);
  report.push({ file: "src/generated/faq.ts", source: faq.fixture ? "fixture" : "repo" });
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  console.table(syncData({ repoRoot: dirname(appRoot), appRoot }));
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run scripts/sync-data.test.ts)`
Expected: `Tests  2 passed (2)`.

- [x] **Step 5: Static fixtures**

These are used only while `shared/deployments/sepolia.json`, `shared/params.json` and `docs/faq.md` do not exist. The deployments fixture is plan 04's bootstrap file (verified infrastructure, nothing deployed) plus `fixture: true` and an empty `routers.arb`, so the dashboard runs on mock data. The params fixture is P\* = 20% (flagged `fixture: true`) until the lab decides.

Create `app/src/fixtures/deployments.sepolia.json`:

```json
{
  "fixture": true,
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
  "riskDesks": { "live": null, "replay": null },
  "hooks": { "live": null, "replay": null },
  "pools": { "liveV": null, "liveS": null, "replayV": null, "replayS": null },
  "routers": { "arb": null }
}
```

Create `app/src/fixtures/params.json`:

```json
{
  "fixture": true,
  "pStar": 0.2,
  "etaE4": 41760,
  "sqrtHalfDtE6": 2449490,
  "feeMinPips": 500,
  "feeMaxPips": 15000,
  "feeSafePips": 3000,
  "tauKillSec": 180,
  "decidedBy": "fixture in app/src/fixtures/params.json until the lab writes shared/params.json"
}
```

Create `app/src/fixtures/faq.md`:

````markdown
## How is the fee computed?

No transaction ever "changes" the fee. On every swap, the Uniswap v4 PoolManager calls the hook's `beforeSwap`. The hook reads the latest volatility from `RiskDesk.state()`, computes `fee = clamp(eta * sigma * sqrt(blockTime / 2) * k, floor, cap)` and returns it with `OVERRIDE_FEE_FLAG`. The Chainlink CRE risk desk updates sigma on-chain every 30 seconds through `onReport`.

## Can a pool that is already live change its fee?

- A v4 pool's fee mode and hook are part of its `PoolKey`, and the pool id is the hash of that key. An existing static-fee pool can never become dynamic or gain a hook: you create a new pool and migrate liquidity.
- A dynamic-fee pool (fee field `0x800000`) can change its LP fee at any time, but only through its hook: either per swap, by returning a fee with `OVERRIDE_FEE_FLAG` from `beforeSwap` (what clim does), or by storing a new fee with `PoolManager.updateDynamicLPFee`, which reverts unless the caller is the pool's hook.
- clim's own parameters (P\*, floor, cap) are immutable: changing them means a new hook and a new pool.
- A DEX that already runs dynamic fees can integrate the desk without a new pool: its hook or keeper reads `RiskDesk.state()`.

_This is the fixture FAQ shipped with the app. The full FAQ lives in `docs/faq.md`; `npm run sync` copies it here._
````

- [x] **Step 6: Commit**

```bash
git add app/scripts/sync-data.mjs app/scripts/sync-data.test.ts app/src/fixtures
git commit -m "feat(app): sync shared/, lab/out and docs/faq.md into the app with fixture fallback"
```

---

### Task 14: Lab fixtures, first sync, config modules

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `f289f29`. Today every source reads `repo` (`npm run sync` at `d05ee94`, session log 2026-10-07) and the suite is 30 files, 265 tests at `1a246b3` (21 and 170 at the import; the timeWindow, faq and ledger tests were added on 2026-10-07 in `e9aab85`, `3d0ae57` and `4dedb1b`, and 6 ledger and story tests in `c2ef0e5`, then net +1 in audit round 3 (a story test in `080884f`, the sqrtPriceOf test removed in `c9347f4`, a FAQ order test in `2dca157`): 24 files, 211 tests; then the audit round 4 fixes `a078171`, the guided path on /app `d57c3c5` (29 files, 256 tests) and /replay's 7 October storm `d6262e3`, session log 2026-10-07).

**Delegable:** yes
**Depends on:** Tasks 7, 12, 13

The lab fixtures are **synthetic** and labeled as such in every title (`Synthetic storm (fixture)`, `Synthetic A (fixture)`), so no number can be mistaken for a lab result in a screenshot.

**Files:**
- Create: `app/scripts/make-fixtures.ts`, `app/src/lib/config.ts`, `app/src/lib/labData.ts`
- Generated (committed): `app/src/fixtures/lab/{summary,replay-2026-02-04,ptrade-band}.json`, `app/src/generated/{sepolia.json,params.json,faq.ts}`, `app/public/data/lab/*.json`

- [x] **Step 1: Write the fixture generator**

Create `app/scripts/make-fixtures.ts`:

```ts
// Writes shape-identical SYNTHETIC lab fixtures to src/fixtures/lab/. They only exercise the UI;
// every label says "fixture" so no number can be mistaken for a lab result. Run: npm run fixtures
import { mkdirSync, writeFileSync } from "node:fs";
import { feePips } from "@/lib/feeMath";
import type { LabPTradeBand, LabReplay, LabSummary } from "@/lib/lab";
import { mulberry32 } from "@/lib/mock";
import { annualPctToSigmaE9, SQRT_SECONDS_PER_YEAR } from "@/lib/units";

const OUT = new URL("../src/fixtures/lab/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const GENERATED_AT = "fixture (app/scripts/make-fixtures.ts)";
const write = (name: string, data: unknown) => writeFileSync(new URL(name, OUT), `${JSON.stringify(data)}\n`);
const round = (x: number, d = 4) => Number(x.toFixed(d));

/** A synthetic 4-hour storm (74% to 225%/yr) at P* = 20%, S at V's time-average fee. */
function replay(): { file: LabReplay; stats: { arbChangePct: number; feeSBp: number; feeVMin: number; feeVMax: number; pObsV: number } } {
  const rand = mulberry32(42);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const start = Date.parse("2026-02-04T12:00:00Z") / 1000;
  const n = (4 * 3_600) / 12;
  const vol = (i: number) => 74 + (225 - 74) / (1 + Math.exp(-(i / n - 0.6) * 14));
  const feeV: number[] = [];
  const lnm: number[] = [Math.log(2_650)];
  for (let i = 0; i < n; i++) {
    feeV.push(feePips(annualPctToSigmaE9(vol(i) * (1 + 0.1 * gauss())), 41_760, 2_449_490, 10_000, 500, 15_000) / 1e6);
    if (i > 0) lnm.push(lnm[i - 1] + (vol(i) / 100 / SQRT_SECONDS_PER_YEAR) * Math.sqrt(12) * gauss());
  }
  const feeS = feeV.reduce((a, b) => a + b, 0) / n; // equal time-average fee
  const pool = { V: lnm[0], S: lnm[0] };
  const arb = { V: 0, S: 0 };
  let tradesV = 0;
  const f: LabReplay = { fixture: true, window: { startUtc: "2026-02-04T12:00:00Z", endUtc: "2026-02-04T16:00:00Z" }, t: [], sigmaAnnualPct: [], feeVBp: [], feeSBp: round(feeS * 1e4, 2), arbCumVUsd: [], arbCumSUsd: [], price: [] };
  for (let i = 0; i < n; i++) {
    for (const [k, fee] of [["V", feeV[i]], ["S", feeS]] as const) {
      const z = lnm[i] - pool[k];
      if (Math.abs(z) > fee) {
        arb[k] += (0.5 * (Math.abs(z) - fee) ** 2 * 1e6) / 4; // CPMM: ARB ~ V/8 * d^2, for $1M of TVL
        pool[k] = lnm[i] - Math.sign(z) * fee;
        if (k === "V") tradesV++;
      }
    }
    f.t.push(start + i * 12);
    f.sigmaAnnualPct.push(round(vol(i), 2));
    f.feeVBp.push(round(feeV[i] * 1e4, 2));
    f.arbCumVUsd.push(round(arb.V, 2));
    f.arbCumSUsd.push(round(arb.S, 2));
    f.price?.push(round(Math.exp(lnm[i]), 2));
  }
  return {
    file: f,
    stats: { arbChangePct: round((arb.V / arb.S - 1) * 100, 1), feeSBp: f.feeSBp, feeVMin: Math.min(...f.feeVBp), feeVMax: Math.max(...f.feeVBp), pObsV: round(tradesV / n, 3) },
  };
}

function band(): LabPTradeBand {
  const N = 300;
  const grid = [];
  for (let k = 1; k <= 20; k++) {
    const p = k * 0.02;
    const sd = Math.sqrt(((p * (1 - p)) / N) * 2.5); // binomial variance x2.5 for clustering (fixture only)
    grid.push({ p: round(p, 2), lo95: round(Math.max(0, p - 1.96 * sd)), hi95: round(p + 1.96 * sd), lo99: round(Math.max(0, p - 2.576 * sd)), hi99: round(p + 2.576 * sd) });
  }
  return { fixture: true, generatedAt: GENERATED_AT, windowBlocks: N, method: "fixture: binomial band with variance x2.5, not the lab simulation", grid };
}

function summary(r: ReturnType<typeof replay>["stats"]): LabSummary {
  return {
    fixture: true,
    generatedAt: GENERATED_AT,
    setting: { pStar: 0.2, feeMinPips: 500 },
    comparisons: {
      equalAvgFee: [{ period: "Synthetic A (fixture)", arbChangePct: -15 }, { period: "Synthetic B (fixture)", arbChangePct: -10 }],
      equalTraderCost: [{ period: "Synthetic A (fixture)", arbChangePct: -5 }, { period: "Synthetic B (fixture)", arbChangePct: 3 }],
    },
    pTrade: [
      { period: "Synthetic A (fixture)", predicted: 0.2, observed: 0.19, blocks: 10_000 },
      { period: "Synthetic B (fixture)", predicted: 0.19, observed: 0.2, blocks: 10_000 },
    ],
    replay: {
      window: "Synthetic storm (fixture)", sigmaMinPct: 74, sigmaMaxPct: 225, feeVMinBp: r.feeVMin, feeVMaxBp: r.feeVMax, feeSBp: r.feeSBp,
      arbChangePct: r.arbChangePct, arbChangeRangePct: [r.arbChangePct, 0], pTradePredicted: 0.2, pTradeObserved: r.pObsV,
    },
    lpGain: { fullRangeEthPctPerYear: [0, 0], volatileAssetPctPerYearMax: 0, shareFromTop5WeeksPct: 0 },
    modelSeverityRatio: [1, 1],
    inPoolVolGainSharePct: [0, 0],
  };
}

const r = replay();
write("replay-2026-02-04.json", r.file);
write("ptrade-band.json", band());
write("summary.json", summary(r.stats));
console.log("wrote src/fixtures/lab/{replay-2026-02-04,ptrade-band,summary}.json");
```

- [x] **Step 2: Generate the fixtures and run the first sync**

```bash
(cd app && npm run fixtures && npm run sync)
```
Expected: `wrote src/fixtures/lab/{replay-2026-02-04,ptrade-band,summary}.json`, then a table with six rows. `src/generated/faq.ts` shows `repo` (docs/faq.md exists); the other five show `fixture` until plans 01 and 03 deliver. The replay fixture is about 50 KB (1,200 points, columnar).

- [x] **Step 3: Config modules**

Create `app/src/lib/config.ts`:

```ts
import rawParams from "@/generated/params.json";
import rawDeployments from "@/generated/sepolia.json";
import { type Pair, parseDeployments, parseParams } from "./deployments";

// src/generated/* is written by `npm run sync` from shared/ (or from src/fixtures/ until shared/ exists).
export const deployments = parseDeployments(rawDeployments);
export const params = parseParams(rawParams);

export const EXPLORER = "https://sepolia.etherscan.io";

export type DataSource = "mock" | "sepolia";

/** Mock until the pair is deployed; NEXT_PUBLIC_CLIM_SOURCE=mock forces mock data. */
export function dataSource(pair: Pair, forced: string | undefined = process.env.NEXT_PUBLIC_CLIM_SOURCE): DataSource {
  if (forced === "mock") return "mock";
  return deployments.pairs[pair] ? "sepolia" : "mock";
}
```

Create `app/src/lib/labData.ts`:

```ts
import band from "../../public/data/lab/ptrade-band.json";
import replay from "../../public/data/lab/replay-2026-02-04.json";
import summary from "../../public/data/lab/summary.json";
import { parsePTradeBand, parseReplay, parseSummary } from "./lab";

// public/data/lab/* is written by `npm run sync` from lab/out (or src/fixtures/lab until the lab runs).
// The same files are served at /data/lab/*.json so anyone can download the numbers behind the charts.
// Server components only: importing this module in a client component would ship the replay to the browser.
export const labSummary = parseSummary(summary);
export const labReplay = parseReplay(replay);
export const labBand = parsePTradeBand(band);
```

- [x] **Step 4: Run every check**

```bash
(cd app && npm test && npm run typecheck && npm run lint)
```
Expected: `Test Files  13 passed (13)`, `Tests  91 passed | 2 skipped (93)`; `tsc` and `eslint` print nothing.

- [x] **Step 5: Commit**

```bash
git add app/scripts/make-fixtures.ts app/src/lib/config.ts app/src/lib/labData.ts app/src/fixtures/lab app/src/generated app/public/data/lab
git commit -m "feat(app): synthetic lab fixtures, first data sync, config modules"
```

---
### Task 15: Theme, UI primitives and the data hook

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `9ec11b4`. `theme.ts` maps the series and modes to CSS variables (design tokens) instead of the Conventions' raw colours; today V is Chainlink Blue, S gray (dashed), σ Uniswap pink (session log 2026-10-07, "Frontend build log"); `ui.tsx` also exports `Toggle`.

**Delegable:** yes
**Depends on:** Tasks 11, 14

`useClimData(pair)` is the only place that knows where data comes from. Mock: regenerate the mock world every 30 s (same seed, so the picture is stable and the desk never looks stale). Sepolia: load `/data/chain/<pair>.json` if present, then read state and fetch logs from the next block, every 12 s, never two loads at once.

**Files:**
- Create: `app/src/lib/theme.ts`, `app/src/components/ui.tsx`, `app/src/hooks/useClimData.ts`

- [x] **Step 1: Theme**

Create `app/src/lib/theme.ts`:

```ts
import { FeeMode } from "./feeMath";

// Dataviz reference palette (light): one color per entity, the same on every chart.
export const COLORS = {
  V: "#2a78d6", // clim pool (dynamic fee), categorical slot 1
  S: "#eb6834", // static twin pool, slot 2
  sigma: "#1baf7a", // desk volatility, slot 3
  muted: "#898781", // secondary series (DVOL, reported sigma), axes
  grid: "#e1e0d9",
  band: "#cde2fb", // P_trade simulated band (sequential blue step 100)
} as const;

export const MODE_STYLE: Record<FeeMode, { label: string; icon: string; color: string }> = {
  [FeeMode.Normal]: { label: "Normal", icon: "●", color: "#0ca30c" },
  [FeeMode.Degraded]: { label: "Degraded", icon: "▲", color: "#fab219" },
  [FeeMode.Blind]: { label: "Blind", icon: "■", color: "#d03b3b" },
};

/** Deterministic UTC clock label (same on server and client, no hydration mismatch). */
export function utcTime(t: number): string {
  return new Date(t * 1000).toISOString().slice(11, 16);
}
```

- [x] **Step 2: UI primitives**

Create `app/src/components/ui.tsx`:

```tsx
import type { ReactNode } from "react";
import type { FeeMode } from "@/lib/feeMath";
import { MODE_STYLE } from "@/lib/theme";

export function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-black/10 bg-white p-4 ${className}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">{title}</h2>
      {subtitle ? <p className="mt-1 text-xs text-neutral-500">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}

export function ModeBadge({ mode }: { mode: FeeMode }) {
  const m = MODE_STYLE[mode];
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium">
      <span style={{ color: m.color }} aria-hidden>
        {m.icon}
      </span>
      {m.label}
    </span>
  );
}

export function FixtureNote({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{children}</p>;
}

export function TxLink({ hash, live, explorer = "https://sepolia.etherscan.io" }: { hash: string; live: boolean; explorer?: string }) {
  const short = `${hash.slice(0, 6)}…${hash.slice(-4)}`;
  if (!live) return <span className="font-mono text-xs">{short} (mock)</span>;
  return (
    <a className="font-mono text-xs text-blue-700 underline" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      {short}
    </a>
  );
}
```

- [x] **Step 3: Data hook**

Create `app/src/hooks/useClimData.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { fetchPairLogs, fillTimestamps, makeClient, mergeLogs, type PairState, parseSnapshot, readPairState } from "@/lib/chain";
import { type DataSource, dataSource, deployments, params } from "@/lib/config";
import { type Delivery, type DeskReport, decodeDeliveries, decodeReports, decodeSwaps, type SwapRow } from "@/lib/decode";
import type { Pair, PairDeployment } from "@/lib/deployments";
import type { RawLog } from "@/lib/encode";
import { makeMockWorld } from "@/lib/mock";

export const POLL_MS = 12_000;
export const MOCK_REFRESH_MS = 30_000;

export type ClimData = {
  source: DataSource;
  status: "loading" | "ready" | "error";
  error?: string;
  pair?: PairDeployment;
  arbRouter?: Address;
  reports: DeskReport[];
  swaps: SwapRow[];
  deliveries: Delivery[];
  state?: PairState;
  nowSec: number;
  usedSnapshot: boolean;
};

const EMPTY = { reports: [], swaps: [], deliveries: [], nowSec: 0, usedSnapshot: false };

export function useClimData(pairName: Pair): ClimData {
  const source = dataSource(pairName);
  const [data, setData] = useState<ClimData>({ source, status: "loading", ...EMPTY });
  const [nowSec, setNowSec] = useState(0);

  useEffect(() => {
    const tick = () => setNowSec(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (source === "mock") {
      const regenerate = () => {
        const now = Math.floor(Date.now() / 1000);
        const w = makeMockWorld({ nowSec: now, params });
        setData({
          source, status: "ready", pair: w.pair, arbRouter: w.arbRouter,
          reports: decodeReports(w.deskLogs), swaps: decodeSwaps(w.swapLogs), deliveries: decodeDeliveries(w.forwarderLogs),
          state: { desk: w.desk, quote: w.quote, latestBlock: w.latestBlock, protocolFees: w.protocolFees },
          nowSec: now, usedSnapshot: false,
        });
      };
      regenerate();
      const id = setInterval(regenerate, MOCK_REFRESH_MS);
      return () => clearInterval(id);
    }

    const pair = deployments.pairs[pairName];
    if (!pair) return;
    const client = makeClient();
    const logs: Record<"deskLogs" | "swapLogs" | "forwarderLogs", RawLog[]> = { deskLogs: [], swapLogs: [], forwarderLogs: [] };
    let next = pair.startBlock;
    let usedSnapshot = false;
    let first = true;
    let busy = false;

    async function load() {
      if (busy || !pair) return;
      busy = true;
      try {
        if (first) {
          first = false;
          const raw = await fetch(`/data/chain/${pairName}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          const snap = parseSnapshot(raw, pairName);
          if (snap) {
            logs.deskLogs = snap.deskLogs;
            logs.swapLogs = snap.swapLogs;
            logs.forwarderLogs = snap.forwarderLogs;
            next = snap.toBlock + 1;
            usedSnapshot = true;
          }
        }
        const state = await readPairState(client, pair, deployments.uniswap.stateView);
        const to = state.latestBlock.number;
        if (next <= to) {
          const fresh = await fetchPairLogs(client, pair, deployments, next, to);
          const anchor = { block: to, t: state.latestBlock.timestamp };
          for (const k of ["deskLogs", "swapLogs", "forwarderLogs"] as const) logs[k] = mergeLogs(logs[k], fillTimestamps(fresh[k], anchor));
          next = to + 1;
        }
        if (!cancelled) {
          setData({
            source, status: "ready", pair, arbRouter: deployments.routers.arb,
            reports: decodeReports(logs.deskLogs), swaps: decodeSwaps(logs.swapLogs), deliveries: decodeDeliveries(logs.forwarderLogs),
            state, nowSec: state.latestBlock.timestamp, usedSnapshot,
          });
        }
      } catch (e) {
        const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
        if (!cancelled) setData((d) => ({ ...d, source, pair, status: d.status === "ready" ? "ready" : "error", error }));
      } finally {
        busy = false;
      }
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pairName, source]);

  return { ...data, nowSec: nowSec || data.nowSec };
}
```

- [x] **Step 4: Typecheck and lint**

Run: `(cd app && npm run typecheck && npm run lint)`
Expected: no output, exit code 0.

- [x] **Step 5: Commit**

```bash
git add app/src/lib/theme.ts app/src/components/ui.tsx app/src/hooks/useClimData.ts
git commit -m "feat(app): theme, UI primitives and the chain/mock data hook"
```

---

### Task 16: Desk and Quote panels

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `549e910`.

**Delegable:** yes
**Depends on:** Task 15

**Files:**
- Create: `app/src/components/DeskPanel.tsx`, `app/src/components/FeeCurveChart.tsx`, `app/src/components/QuotePanel.tsx`

- [x] **Step 1: Desk panel**

Create `app/src/components/DeskPanel.tsx`:

```tsx
"use client";

import type { ClimData } from "@/hooks/useClimData";
import { params } from "@/lib/config";
import { FLAG_DEGRADED, FLAG_REPLAY, quoteFee } from "@/lib/feeMath";
import { dvolE2ToPct, formatAge, formatPct, sigmaE9ToAnnualPct } from "@/lib/units";
import { ModeBadge, Panel, Stat, TxLink } from "./ui";

// RiskReported.zone (spec §3.4): the model-control traffic light, 0 in the hackathon build.
const ZONES = ["not evaluated", "green", "yellow", "red"];

export function DeskPanel({ data }: { data: ClimData }) {
  const last = data.reports.at(-1);
  const desk = data.state?.desk;
  if (!last || !desk) return <Panel title="Risk desk (Chainlink CRE)">No report yet.</Panel>;
  const mode = quoteFee(desk, data.nowSec, params).mode;
  const latencies = data.reports.slice(-20).map((r) => r.latencySec).sort((a, b) => a - b);
  const medianLatency = latencies[Math.floor(latencies.length / 2)];
  const flags = [desk.flags & FLAG_DEGRADED ? "DEGRADED" : null, desk.flags & FLAG_REPLAY ? "REPLAY" : null].filter(Boolean);
  return (
    <Panel title="Risk desk (Chainlink CRE)" subtitle="4 venues, quorum 3, DON median, signed report to RiskDesk.onReport every 30 s">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="σ applied (hook input)" value={formatPct(sigmaE9ToAnnualPct(desk.sigmaE9))} hint={`reported ${formatPct(sigmaE9ToAnnualPct(last.sigmaReported))}`} />
        <Stat label="RV15" value={formatPct(sigmaE9ToAnnualPct(last.rv15E9))} />
        <Stat label="DVOL (Deribit)" value={last.dvolE2 === 0 ? "n/a" : formatPct(dvolE2ToPct(last.dvolE2))} />
        <Stat label="Venue dispersion" value={`${last.dispBp} bp`} hint={last.dispBp > 25 ? "above 25 bp: degraded" : "limit 25 bp"} />
        <Stat label="Sources" value={`${last.nSources} / 4`} hint={`model zone: ${ZONES[last.zone] ?? last.zone}`} />
        <Stat label="Age τ" value={formatAge(data.nowSec - desk.tObs)} hint={`blind after ${params.tauKillSec} s`} />
        <Stat label="Hook mode" value={<ModeBadge mode={mode} />} hint={flags.length ? flags.join(", ") : undefined} />
        <Stat label="Report latency" value={formatAge(medianLatency)} hint="median of last 20, tObs to inclusion" />
      </div>
      <div className="mt-4">
        <div className="text-xs text-neutral-500">Last CRE reports (seq, onReport tx)</div>
        <ul className="mt-1 space-y-0.5">
          {data.reports.slice(-5).reverse().map((r) => (
            <li key={`${r.txHash}:${r.logIndex}`} className="font-mono text-xs">
              #{r.seq} <TxLink hash={r.txHash} live={data.source === "sepolia"} />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
```

- [x] **Step 2: Theoretical fee curve**

Create `app/src/components/FeeCurveChart.tsx`:

```tsx
"use client";

import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { params } from "@/lib/config";
import { feePips } from "@/lib/feeMath";
import { COLORS } from "@/lib/theme";
import { annualPctToSigmaE9, pipsToBp } from "@/lib/units";

const SIGMAS = Array.from({ length: 51 }, (_, i) => i * 5); // 0..250 %/yr

export function feeCurve() {
  return SIGMAS.map((s) => ({
    sigmaPct: s,
    feeBp: pipsToBp(feePips(annualPctToSigmaE9(s), params.etaE4, params.sqrtHalfDtE6, 10_000, params.feeMinPips, params.feeMaxPips)),
  }));
}

export function FeeCurveChart({ sigmaNowPct, feeNowBp, staticFeeBp }: { sigmaNowPct?: number; feeNowBp?: number; staticFeeBp: number }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={feeCurve()} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="sigmaPct" type="number" domain={[0, 250]} ticks={[0, 50, 100, 150, 200, 250]} unit="%" tick={{ fontSize: 11, fill: COLORS.muted }} label={{ value: "σ (annualised)", position: "insideBottom", offset: -8, fontSize: 11 }} />
          <YAxis unit=" bp" tick={{ fontSize: 11, fill: COLORS.muted }} width={56} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(1)} bp`} labelFormatter={(l) => `σ ${l}%/yr`} />
          <ReferenceLine y={staticFeeBp} stroke={COLORS.S} strokeDasharray="4 4" label={{ value: "S (static)", position: "right", fontSize: 11 }} />
          <ReferenceLine y={pipsToBp(params.feeSafePips)} stroke={COLORS.muted} strokeDasharray="2 4" label={{ value: "blind / degraded floor", position: "insideTopLeft", fontSize: 10 }} />
          <Line type="monotone" dataKey="feeBp" name="V (clim)" stroke={COLORS.V} strokeWidth={2} dot={false} isAnimationActive={false} />
          {sigmaNowPct !== undefined && feeNowBp !== undefined ? (
            <ReferenceDot x={Math.min(250, sigmaNowPct)} y={feeNowBp} r={5} fill={COLORS.V} stroke="#fff" strokeWidth={2} />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [x] **Step 3: Quote panel**

Create `app/src/components/QuotePanel.tsx`:

```tsx
"use client";

import type { ClimData } from "@/hooks/useClimData";
import { params } from "@/lib/config";
import { formatBp, pipsToBp, sigmaE9ToAnnualPct } from "@/lib/units";
import { FeeCurveChart } from "./FeeCurveChart";
import { ModeBadge, Panel, Stat } from "./ui";

export function QuotePanel({ data }: { data: ClimData }) {
  const q = data.state?.quote;
  const desk = data.state?.desk;
  const staticFeeBp = data.pair ? pipsToBp(data.pair.S.key.fee) : 0;
  const eta = params.etaE4 / 1e4;
  return (
    <Panel
      title="Quote: fee now"
      subtitle={`fee = clamp(η · σ · √(Δt/2) · k, ${formatBp(pipsToBp(params.feeMinPips), 0)}, ${formatBp(pipsToBp(params.feeMaxPips), 0)}), η = 1/P* − 0.824 = ${eta.toFixed(3)} (P* = ${(params.pStar * 100).toFixed(0)}%), Δt = 12 s`}
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat label="V: clim pool (hook)" value={q ? formatBp(pipsToBp(q.feePips), 2) : "…"} hint={q ? <ModeBadge mode={q.mode} /> : undefined} />
        <Stat label="S: static twin" value={formatBp(staticFeeBp, 2)} hint="same average fee" />
        <Stat label="σ applied" value={desk ? `${sigmaE9ToAnnualPct(desk.sigmaE9).toFixed(1)}%` : "…"} hint={desk ? `k = ${(desk.kE4 / 1e4).toFixed(2)}` : undefined} />
      </div>
      <FeeCurveChart
        sigmaNowPct={desk ? sigmaE9ToAnnualPct(desk.sigmaE9) : undefined}
        feeNowBp={q ? pipsToBp(q.feePips) : undefined}
        staticFeeBp={staticFeeBp}
      />
    </Panel>
  );
}
```

- [x] **Step 4: Typecheck and lint**

Run: `(cd app && npm run typecheck && npm run lint)`
Expected: no output, exit code 0.

- [x] **Step 5: Commit**

```bash
git add app/src/components/DeskPanel.tsx app/src/components/FeeCurveChart.tsx app/src/components/QuotePanel.tsx
git commit -m "feat(app): desk and quote panels with the theoretical fee curve"
```

---

### Task 17: The weather chart (the answer to "how is the fee computed?")

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commits `e8053b7` and `f41f432`.

**Delegable:** yes
**Depends on:** Task 15

Two stacked charts on one time axis (spec §4, "The picture"): σ on top; below, the fee staircase the hook quotes, each swap's actual fee as a dot sitting on it, S's static fee dashed, blind mode shaded.

**Files:**
- Create: `app/src/components/WeatherChart.tsx`

- [x] **Step 1: Write the component**

Create `app/src/components/WeatherChart.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { ClimData } from "@/hooks/useClimData";
import { params } from "@/lib/config";
import { blindEpisodes, downsample, swapFeeDots, weatherSeries } from "@/lib/series";
import { COLORS, utcTime } from "@/lib/theme";
import { pipsToBp } from "@/lib/units";
import { Panel } from "./ui";

const WINDOWS = [
  { label: "1 h", sec: 3_600 },
  { label: "6 h", sec: 21_600 },
  { label: "24 h", sec: 86_400 },
  { label: "All", sec: Number.POSITIVE_INFINITY },
];
const MAX_POINTS = 1_500;
const axisTick = { fontSize: 11, fill: COLORS.muted };

export function WeatherChart({ data }: { data: ClimData }) {
  const [win, setWin] = useState(WINDOWS[1]);
  const nowBucket = Math.floor(data.nowSec / 10) * 10;
  const { points, dots, blind } = useMemo(() => {
    const from = nowBucket - win.sec;
    const all = weatherSeries(data.reports, params, nowBucket).filter((p) => p.t >= from);
    const v = data.pair ? swapFeeDots(data.swaps, data.pair.V.poolId).filter((d) => d.t >= from) : [];
    const episodes = blindEpisodes(data.reports, params.tauKillSec, nowBucket).filter((e) => e.to >= from);
    return { points: downsample(all, MAX_POINTS), dots: downsample(v, MAX_POINTS), blind: episodes };
  }, [data.reports, data.swaps, data.pair, nowBucket, win]);
  const staticFeeBp = data.pair ? pipsToBp(data.pair.S.key.fee) : 0;
  const domain: [number, number] = points.length ? [points[0].t, points[points.length - 1].t] : [0, 1];

  return (
    <Panel
      title="Weather: volatility and the fee it sets"
      subtitle="Top: volatility published by the CRE desk. Bottom: the fee the hook charges on every swap (line), the fee actually paid by swaps on V (dots), and the static twin S. The fee is never sent by a transaction: Uniswap calls the hook's beforeSwap, which reads σ and returns the fee."
      className="col-span-full"
    >
      <div className="mb-2 flex gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w.label}
            type="button"
            onClick={() => setWin(w)}
            className={`rounded px-2 py-0.5 text-xs ${w === win ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}
          >
            {w.label}
          </button>
        ))}
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} syncId="weather" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="t" type="number" domain={domain} tickFormatter={utcTime} tick={axisTick} hide />
            <YAxis unit="%" tick={axisTick} width={56} />
            <Tooltip labelFormatter={(t) => `${utcTime(Number(t))} UTC`} formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="stepAfter" dataKey="sigmaPct" name="σ applied" stroke={COLORS.sigma} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="sigmaReportedPct" name="σ reported" stroke={COLORS.muted} strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="dvolPct" name="DVOL" stroke={COLORS.muted} strokeWidth={1} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} syncId="weather" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="t" type="number" domain={domain} tickFormatter={utcTime} tick={axisTick} />
            <YAxis unit=" bp" tick={axisTick} width={56} />
            <Tooltip labelFormatter={(t) => `${utcTime(Number(t))} UTC`} formatter={(v) => `${Number(v).toFixed(2)} bp`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {blind.map((e) => (
              <ReferenceArea key={e.from} x1={Math.max(e.from, domain[0])} x2={Math.min(e.to, domain[1])} fill="#d03b3b" fillOpacity={0.08} />
            ))}
            <ReferenceLine y={staticFeeBp} stroke={COLORS.S} strokeWidth={2} strokeDasharray="6 3" label={{ value: "S static", position: "insideTopRight", fontSize: 11 }} />
            <Line type="stepAfter" dataKey="feeVBp" name="V fee (hook)" stroke={COLORS.V} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Scatter data={dots} dataKey="feeBp" name="V swaps (fee paid)" fill={COLORS.V} isAnimationActive={false} shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={2} fill={COLORS.V} fillOpacity={0.6} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-neutral-500">Times in UTC. Shaded: blind mode, the desk was silent for more than {params.tauKillSec} s, so the hook quoted at least {pipsToBp(params.feeSafePips)} bp. No transaction changes the fee: every swap reads the latest CRE report.</p>
    </Panel>
  );
}
```

- [x] **Step 2: Typecheck and lint**

Run: `(cd app && npm run typecheck && npm run lint)`
Expected: no output, exit code 0.

- [x] **Step 3: Commit**

```bash
git add app/src/components/WeatherChart.tsx
git commit -m "feat(app): weather chart, sigma over the fee staircase with swap dots"
```

---

### Task 18: Validation and volatility-quad panels

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `c347a8d`.

**Delegable:** yes
**Depends on:** Task 15

**Files:**
- Create: `app/src/components/ValidationPanel.tsx`, `app/src/components/VolQuadPanel.tsx`

- [x] **Step 1: Validation panel**

Create `app/src/components/ValidationPanel.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ClimData } from "@/hooks/useClimData";
import { params } from "@/lib/config";
import type { LabPTradeBand } from "@/lib/lab";
import { arbBlocksOf, makeBlockClock, makePredictor, pTradeTotals, rollingPTrade } from "@/lib/ptrade";
import { downsample } from "@/lib/series";
import { COLORS, utcTime } from "@/lib/theme";
import { FixtureNote, Panel } from "./ui";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function ValidationPanel({ data, band }: { data: ClimData; band: LabPTradeBand }) {
  const result = useMemo(() => {
    if (!data.pair || !data.arbRouter || data.reports.length === 0 || !data.state) return null;
    const anchors = [...data.reports, ...data.swaps].map((x) => ({ block: x.blockNumber, t: x.blockTimestamp }));
    const clock = makeBlockClock(anchors);
    const fromBlock = data.reports[0].blockNumber;
    const toBlock = data.state.latestBlock.number;
    const window = band.windowBlocks;
    const pools = [
      { name: "V", poolId: data.pair.V.poolId, predictedAt: makePredictor(data.reports, params, clock) },
      { name: "S", poolId: data.pair.S.poolId, predictedAt: makePredictor(data.reports, params, clock, data.pair.S.key.fee) },
    ] as const;
    const totals = pools.map((p) => ({ name: p.name, ...pTradeTotals({ fromBlock, toBlock, arbBlocks: arbBlocksOf(data.swaps, p.poolId, data.arbRouter!), predictedAt: p.predictedAt }) }));
    const step = Math.max(1, Math.floor((toBlock - fromBlock) / 600));
    const series = rollingPTrade({
      fromBlock, toBlock, window, step, arbBlocks: arbBlocksOf(data.swaps, pools[0].poolId, data.arbRouter), predictedAt: pools[0].predictedAt, clock, band,
    }).map((x) => ({ ...x, band95: [x.lo95, x.hi95] }));
    return { totals, series: downsample(series, 800), window };
  }, [data.pair, data.arbRouter, data.reports, data.swaps, data.state, band]);

  return (
    <Panel
      title="Validation: predicted vs observed arbitrage frequency"
      subtitle={`Share of blocks with an arbitrage on V, rolling ${band.windowBlocks} blocks. Model: P_trade = 1 / (η_eff + 0.824), η_eff = fee / (σ·√(Δt/2)). Band: simulated with clustered arbitrage (${band.method}).`}
      className="col-span-full"
    >
      <FixtureNote show={band.fixture}>The band is a fixture until the lab writes lab/out/ptrade-band.json.</FixtureNote>
      {!result ? (
        <p className="text-sm text-neutral-500">{data.arbRouter ? "Waiting for desk reports and swaps." : "Arbitrage router unknown: add routers.arb to shared/deployments/sepolia.json."}</p>
      ) : (
        <>
          <table className="mb-3 text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="pr-6">Pool</th><th className="pr-6">Blocks</th><th className="pr-6">With arbitrage</th><th className="pr-6">Observed</th><th>Predicted</th>
              </tr>
            </thead>
            <tbody>
              {result.totals.map((t) => (
                <tr key={t.name}>
                  <td className="pr-6 font-medium" style={{ color: t.name === "V" ? COLORS.V : COLORS.S }}>{t.name}</td>
                  <td className="pr-6">{t.blocks}</td><td className="pr-6">{t.arbBlocks}</td><td className="pr-6">{pct(t.observed)}</td><td>{pct(t.predicted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.series.length === 0 ? (
            <p className="text-sm text-neutral-500">Need at least {result.window} blocks of data for the rolling chart.</p>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={result.series} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={utcTime} tick={{ fontSize: 11, fill: COLORS.muted }} />
                  <YAxis tickFormatter={(v) => pct(Number(v))} tick={{ fontSize: 11, fill: COLORS.muted }} width={56} />
                  <Tooltip labelFormatter={(t) => `${utcTime(Number(t))} UTC`} formatter={(v) => (Array.isArray(v) ? v.map((x) => pct(Number(x))).join(" to ") : pct(Number(v)))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area dataKey="band95" name="95% band (model)" stroke="none" fill={COLORS.band} isAnimationActive={false} />
                  <Line dataKey="predicted" name="Predicted" stroke="#52514e" strokeDasharray="4 3" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="observed" name="Observed (V)" stroke={COLORS.V} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
```

- [x] **Step 2: Volatility quad**

Create `app/src/components/VolQuadPanel.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { ClimData } from "@/hooks/useClimData";
import { params } from "@/lib/config";
import type { LabPTradeBand } from "@/lib/lab";
import { pnlExplain, sigmaBreakEvenAnnualPct } from "@/lib/pnl";
import { arbBlocksOf, pTradeTotals, makeBlockClock, makePredictor, sigmaArbAnnualPct } from "@/lib/ptrade";
import { timeAverageFeeBp, weatherSeries } from "@/lib/series";
import { dvolE2ToPct, formatPct, sigmaE9ToAnnualPct, tickToEthUsd } from "@/lib/units";
import { Panel, Stat } from "./ui";

export function VolQuadPanel({ data, band }: { data: ClimData; band: LabPTradeBand }) {
  const q = useMemo(() => {
    const last = data.reports.at(-1);
    if (!last || !data.pair || !data.state) return null;
    const pair = data.pair;
    const toBlock = data.state.latestBlock.number;
    const fromBlock = Math.max(data.reports[0].blockNumber, toBlock - band.windowBlocks + 1);
    const clock = makeBlockClock([...data.reports, ...data.swaps].map((x) => ({ block: x.blockNumber, t: x.blockTimestamp })));
    const obs = data.arbRouter
      ? pTradeTotals({ fromBlock, toBlock, arbBlocks: arbBlocksOf(data.swaps, pair.V.poolId, data.arbRouter), predictedAt: makePredictor(data.reports, params, clock) }).observed
      : Number.NaN;
    const from = clock(fromBlock);
    const feeBp = timeAverageFeeBp(weatherSeries(data.reports, params, data.nowSec).filter((p) => p.t >= from), data.nowSec);
    const vSwaps = data.swaps.filter((s) => s.poolId === pair.V.poolId);
    const pnl = pnlExplain({ swaps: data.swaps, reports: data.reports, poolId: pair.V.poolId, token0IsEth: pair.token0IsEth, arbRouter: data.arbRouter });
    const elapsed = vSwaps.length ? data.nowSec - vSwaps[0].blockTimestamp : 0;
    const be = vSwaps.length && elapsed > 0
      ? sigmaBreakEvenAnnualPct((pnl.feeRetailUsd + pnl.feeArbUsd) / elapsed, Number(vSwaps[vSwaps.length - 1].liquidity), tickToEthUsd(last.refTick, pair.token0IsEth))
      : Number.NaN;
    return {
      iv: last.dvolE2 === 0 ? Number.NaN : dvolE2ToPct(last.dvolE2),
      rv: sigmaE9ToAnnualPct(last.rv15E9),
      arb: sigmaArbAnnualPct(feeBp * 100, obs, params.sqrtHalfDtE6),
      be,
    };
  }, [data.reports, data.swaps, data.pair, data.state, data.arbRouter, data.nowSec, band.windowBlocks]);
  const fmt = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "n/a" : formatPct(x));
  return (
    <Panel title="Volatility quad" subtitle="Implied (DVOL) and realised (RV15) from the desk; σ_arb reproduces the observed arbitrage frequency on V; above σ_BE, V's fee income is below its LVR.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="σ_IV (DVOL)" value={fmt(q?.iv)} />
        <Stat label="σ_RV (RV15)" value={fmt(q?.rv)} />
        <Stat label="σ_arb (V, last window)" value={fmt(q?.arb)} />
        <Stat label="σ_BE (V)" value={fmt(q?.be)} />
      </div>
    </Panel>
  );
}
```

- [x] **Step 3: Typecheck and lint**

Run: `(cd app && npm run typecheck && npm run lint)`
Expected: no output, exit code 0.

- [x] **Step 4: Commit**

```bash
git add app/src/components/ValidationPanel.tsx app/src/components/VolQuadPanel.tsx
git commit -m "feat(app): P_trade validation with band and the volatility quad"
```

---

### Task 19: P&L explain, safety and recent-swaps panels

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `85cb8dc`.

**Delegable:** yes
**Depends on:** Task 15

The P&L panel also checks the fairness condition of spec §3.7: if V's realized time-average fee differs from S's fee by more than 10%, it says "Not at equal fee: the lab's comparison is the reference". The safety panel shows the two demo proofs (forged report rejected, blind mode) with transaction hashes, and checks that the protocol fee is 0 (spec §4 step 6). The recent-swaps table is what plan 06's demo video points at (fee paid per swap, arbitrage or retail).

**Files:**
- Create: `app/src/components/PnlPanel.tsx`, `app/src/components/SafetyPanel.tsx`, `app/src/components/RecentSwapsPanel.tsx`

- [x] **Step 1: P&L panel**

Create `app/src/components/PnlPanel.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { ClimData } from "@/hooks/useClimData";
import { params } from "@/lib/config";
import { pnlExplain } from "@/lib/pnl";
import { timeAverageFeeBp, weatherSeries } from "@/lib/series";
import { COLORS } from "@/lib/theme";
import { formatBp, formatUsd, pipsToBp } from "@/lib/units";
import { Panel } from "./ui";

export function PnlPanel({ data }: { data: ClimData }) {
  const rows = useMemo(() => {
    if (!data.pair) return [];
    return (["V", "S"] as const).map((name) => ({
      name,
      ...pnlExplain({ swaps: data.swaps, reports: data.reports, poolId: data.pair![name].poolId, token0IsEth: data.pair!.token0IsEth, arbRouter: data.arbRouter }),
    }));
  }, [data.pair, data.swaps, data.reports, data.arbRouter]);
  const feeCheck = useMemo(() => {
    if (!data.pair || data.reports.length === 0) return null;
    const v = timeAverageFeeBp(weatherSeries(data.reports, params, data.nowSec), data.nowSec);
    const s = pipsToBp(data.pair.S.key.fee);
    return { v, s, equal: Math.abs(v - s) <= 0.1 * s };
  }, [data.pair, data.reports, data.nowSec]);
  if (rows.length === 0) return null;
  const [v, s] = rows;
  const arbChange = s.arbUsd !== 0 ? (v.arbUsd / s.arbUsd - 1) * 100 : 0;
  const cols: { key: keyof (typeof rows)[number]; label: string; usd?: boolean }[] = [
    { key: "swaps", label: "Swaps" },
    { key: "arbSwaps", label: "of which arb" },
    { key: "volumeUsd", label: "Volume", usd: true },
    { key: "feeRetailUsd", label: "FEE retail", usd: true },
    { key: "feeArbUsd", label: "FEE arb", usd: true },
    { key: "arbUsd", label: "ARB (LP loss to arb, net)", usd: true },
    { key: "lvrUsd", label: "LVR", usd: true },
    { key: "netUsd", label: "Hedged LP P&L = FEE retail − ARB", usd: true },
  ];
  return (
    <Panel
      title="LP P&L explain (from logs only)"
      subtitle="Milionis-Moallemi-Roughgarden: a delta-hedged LP earns FEE_retail − ARB, and LVR ≈ ARB + FEE_arb. Arbitrage valued at the bot's own price (recovered from the post-swap price); retail fees and LVR at the desk's refTick."
      className="col-span-full"
    >
      <div className="overflow-x-auto">
        <table className="text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="pr-6">Pool</th>
              {cols.map((c) => <th key={c.key} className="pr-6">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="pr-6 font-medium" style={{ color: r.name === "V" ? COLORS.V : COLORS.S }}>{r.name}</td>
                {cols.map((c) => <td key={c.key} className="pr-6">{c.usd ? formatUsd(r[c.key] as number) : String(r[c.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {feeCheck ? (
        <p className="mt-2 text-sm">
          Time-average fee: V {formatBp(feeCheck.v, 2)}, S {formatBp(feeCheck.s, 2)}.{" "}
          {feeCheck.equal ? "Equal within 10%: a fair comparison." : <span className="font-semibold">Not at equal fee: the lab&apos;s comparison is the reference.</span>}
        </p>
      ) : null}
      <p className="mt-2 text-sm">
        ARB on V vs S: <span className="font-semibold">{arbChange >= 0 ? "+" : ""}{arbChange.toFixed(1)}%</span>
        {data.arbRouter ? null : <span className="text-neutral-500"> (arbitrage router unknown: every swap counted as retail)</span>}
      </p>
    </Panel>
  );
}
```

- [x] **Step 2: Safety panel**

Create `app/src/components/SafetyPanel.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { ClimData } from "@/hooks/useClimData";
import { params } from "@/lib/config";
import { blindEpisodes } from "@/lib/series";
import { utcTime } from "@/lib/theme";
import { formatAge, pipsToBp } from "@/lib/units";
import { Panel, TxLink } from "./ui";

export function SafetyPanel({ data }: { data: ClimData }) {
  const live = data.source === "sepolia";
  const episodes = useMemo(() => blindEpisodes(data.reports, params.tauKillSec, data.nowSec), [data.reports, data.nowSec]);
  const rejected = data.deliveries.filter((d) => !d.accepted);
  const accepted = data.deliveries.length - rejected.length;
  const pf = data.state?.protocolFees;
  return (
    <Panel title="Safety evidence" subtitle="Everything below is read from logs: forwarder deliveries, desk silences, pool state.">
      <ul className="space-y-3 text-sm">
        <li>
          <span className="font-medium">Forged or invalid reports rejected: {rejected.length}</span>
          <span className="text-neutral-500"> (accepted deliveries: {accepted}). A rejected report emits ReportProcessed(…, false) and no RiskReported.</span>
          <ul className="mt-1 space-y-0.5">
            {rejected.slice(-5).map((d) => (
              <li key={`${d.txHash}:${d.logIndex}`} className="text-xs">{utcTime(d.blockTimestamp)} UTC <TxLink hash={d.txHash} live={live} /></li>
            ))}
          </ul>
        </li>
        <li>
          <span className="font-medium">Blind episodes (desk silent over {params.tauKillSec} s, fee at least {pipsToBp(params.feeSafePips)} bp): {episodes.length}</span>
          <ul className="mt-1 space-y-0.5">
            {episodes.slice(-5).map((e) => (
              <li key={e.from} className="text-xs">
                {utcTime(e.from)} to {e.ongoing ? "now" : `${utcTime(e.to)} UTC`} ({formatAge(e.to - e.from)}): last report <TxLink hash={e.lastTx} live={live} />
                {e.resumeTx ? <> , resumed <TxLink hash={e.resumeTx} live={live} /></> : null}
              </li>
            ))}
          </ul>
        </li>
        <li>
          <span className="font-medium">Protocol fee: </span>
          {pf ? (pf.V === 0 && pf.S === 0 ? "0 on V and S, so Swap.fee is the LP fee alone." : `NOT ZERO (V ${pf.V}, S ${pf.S}): Swap.fee includes a protocol share.`) : "…"}
        </li>
        <li className="text-neutral-600">The desk owner can rotate the forwarder; nobody can set σ, the fee or the hook parameters.</li>
      </ul>
    </Panel>
  );
}
```

- [x] **Step 3: Recent swaps**

Create `app/src/components/RecentSwapsPanel.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { ClimData } from "@/hooks/useClimData";
import { recentSwapRows } from "@/lib/pnl";
import { COLORS, utcTime } from "@/lib/theme";
import { Panel, TxLink } from "./ui";

export function RecentSwapsPanel({ data }: { data: ClimData }) {
  const rows = useMemo(
    () => (data.pair ? recentSwapRows({ swaps: data.swaps, pair: data.pair, arbRouter: data.arbRouter, limit: 12 }) : []),
    [data.swaps, data.pair, data.arbRouter],
  );
  return (
    <Panel title="Recent swaps" subtitle="Fee read from each Swap event: on V it is whatever the hook returned at that moment." className="col-span-full">
      <div className="overflow-x-auto">
        <table className="text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="pr-6">Time (UTC)</th><th className="pr-6">Pool</th><th className="pr-6">Side</th><th className="pr-6">Size</th><th className="pr-6">Fee paid</th><th className="pr-6">Kind</th><th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="pr-6">{utcTime(r.t)}</td>
                <td className="pr-6 font-medium" style={{ color: r.pool === "V" ? COLORS.V : COLORS.S }}>{r.pool}</td>
                <td className="pr-6">{r.side}</td>
                <td className="pr-6">{r.ethAmount.toFixed(4)} ETH</td>
                <td className="pr-6">{r.feeBp.toFixed(2)} bp</td>
                <td className="pr-6">{r.kind}</td>
                <td><TxLink hash={r.txHash} live={data.source === "sepolia"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
```

- [x] **Step 4: Typecheck and lint**

Run: `(cd app && npm run typecheck && npm run lint)`
Expected: no output, exit code 0.

- [x] **Step 5: Commit**

```bash
git add app/src/components/PnlPanel.tsx app/src/components/SafetyPanel.tsx app/src/components/RecentSwapsPanel.tsx
git commit -m "feat(app): LP P&L explain, safety evidence and recent swaps panels"
```

---

### Task 20: Dashboard page on mock data

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `43eabbe`. The dashboard page is now `src/app/(app)/app/page.tsx` at `/app` (with `ContractsPanel` below it since 2026-10-07); `/` is the landing `src/app/(site)/page.tsx`. Step 4's mock-data look was checked in clim-front; production reads Sepolia since Task 25, and mock data is only the fallback of a build without contracts. The Step 5 line is in `docs/sessions/2026-10-06.md` ("Frontend build log").

**Delegable:** yes
**Depends on:** Tasks 16, 17, 18, 19

**Files:**
- Create: `app/src/components/Dashboard.tsx`
- Modify: `app/src/app/page.tsx` (replace the Task 1 stub)

- [x] **Step 1: Dashboard**

Create `app/src/components/Dashboard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useClimData } from "@/hooks/useClimData";
import { deployments, EXPLORER } from "@/lib/config";
import type { Pair } from "@/lib/deployments";
import type { LabPTradeBand } from "@/lib/lab";
import { shortHash } from "@/lib/units";
import { DeskPanel } from "./DeskPanel";
import { PnlPanel } from "./PnlPanel";
import { RecentSwapsPanel } from "./RecentSwapsPanel";
import { QuotePanel } from "./QuotePanel";
import { SafetyPanel } from "./SafetyPanel";
import { ValidationPanel } from "./ValidationPanel";
import { VolQuadPanel } from "./VolQuadPanel";
import { WeatherChart } from "./WeatherChart";

export function Dashboard({ band, initialPair = "live" }: { band: LabPTradeBand; initialPair?: Pair }) {
  const pairs: Pair[] = deployments.pairs.replay ? ["live", "replay"] : ["live"];
  const [pair, setPair] = useState<Pair>(initialPair);
  const data = useClimData(pair);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {pairs.length > 1
          ? pairs.map((p) => (
              <button key={p} type="button" onClick={() => setPair(p)} className={`rounded px-3 py-1 text-sm ${p === pair ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}>
                {p === "live" ? "Live pair" : "Replay pair (4 Feb 2026)"}
              </button>
            ))
          : null}
        {data.source === "mock" ? (
          <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
            Mock data: contracts not deployed yet (or NEXT_PUBLIC_CLIM_SOURCE=mock). Same decoders and formulas as live.
          </span>
        ) : data.pair ? (
          <span className="text-xs text-neutral-600">
            Live from Sepolia: RiskDesk{" "}
            <a className="text-blue-700 underline" href={`${EXPLORER}/address/${data.pair.riskDesk}`} target="_blank" rel="noreferrer">{shortHash(data.pair.riskDesk)}</a>
            , hook{" "}
            <a className="text-blue-700 underline" href={`${EXPLORER}/address/${data.pair.hook}`} target="_blank" rel="noreferrer">{shortHash(data.pair.hook)}</a>
            {data.usedSnapshot ? ", history from the frozen snapshot" : ""}
          </span>
        ) : null}
        {data.error ? <span className="text-xs text-red-700">RPC error: {data.error}</span> : null}
      </div>
      {data.status === "loading" ? (
        <p className="text-sm text-neutral-500">Loading desk reports and swaps…</p>
      ) : data.status === "error" ? (
        <p className="text-sm text-red-700">Could not load chain data. Set NEXT_PUBLIC_SEPOLIA_RPC_URL or retry.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <DeskPanel data={data} />
          <QuotePanel data={data} />
          <WeatherChart data={data} />
          <ValidationPanel data={data} band={band} />
          <PnlPanel data={data} />
          <VolQuadPanel data={data} band={band} />
          <SafetyPanel data={data} />
          <RecentSwapsPanel data={data} />
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 2: Home page**

Create (overwrite) `app/src/app/page.tsx`:

```tsx
import { Dashboard } from "@/components/Dashboard";
import { params } from "@/lib/config";
import { labBand } from "@/lib/labData";
import { pipsToBp } from "@/lib/units";

export default function Home() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Storm insurance for Uniswap v4 LPs</h1>
        <p className="text-sm text-neutral-600">
          The LP fee follows the market&apos;s weather: {pipsToBp(params.feeMinPips)} bp when calm, a toll that rises with volatility in a storm.
          Volatility comes from a Chainlink CRE risk desk; the fee is applied by a Uniswap v4 hook on every swap.
        </p>
      </div>
      <Dashboard band={labBand} />
    </div>
  );
}
```

- [x] **Step 3: Build**

Run: `(cd app && npm run typecheck && npm run lint && npm run build)`
Expected: the route table lists `○ /` and `○ /_not-found` as `(Static)`; no error.

- [x] **Step 4: Look at it**

Run `(cd app && npx next start -p 3000)` in the background, open http://localhost:3000, then stop the server (`lsof -ti tcp:3000 | xargs kill`). Expected on mock data:
- an amber badge "Mock data: contracts not deployed yet …";
- Desk: σ around 30 to 45%, 4 / 4 sources, age under 2 min, mode "● Normal", five `(mock)` transaction hashes;
- Quote: the curve flat at 5 bp up to about 27% (fixture P\* = 20%) then rising, a dot at the current σ, the dashed S line at 10.5 bp;
- Weather (6 h): σ calm, a storm to about 200% in the middle; the fee staircase at 5 bp rising to about 35 bp in the storm, a 30 bp degraded step around one third of the window, a red-shaded 30 bp blind step near the end; blue dots on the staircase;
- Validation: V and S around 20% observed and predicted; the observed line mostly inside the light-blue band;
- P&L explain table with "Equal within 10%: a fair comparison", the volatility quad (four percentages), Safety: 1 rejected report, 1 blind episode, protocol fee 0; Recent swaps: 12 rows, V and S, arbitrage and retail, fee paid in bp.

If a panel is missing or a chart is empty, open the browser console, fix, and re-run Steps 3 and 4.

- [x] **Step 5: Log and commit**

Append under `## Decisions` in today's session log:

```markdown
- **Dashboard on mock data (plan 05):** all panels run on a deterministic mock chain whose logs are ABI-encoded like the real ones, so switching to Sepolia changes only the data source (automatic once the live desk, hook and pools are in shared/deployments/sepolia.json; `NEXT_PUBLIC_CLIM_SOURCE=mock` forces mock data).
```

```bash
git add app/src/components/Dashboard.tsx app/src/app/page.tsx docs/sessions
git commit -m "feat(app): dashboard page with desk, quote, weather, validation, P&L, vol quad, safety and swaps"
```

---

### Task 21: Replay and lab pages

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `621a38a`. The pages are `src/app/(app)/replay/page.tsx` and `src/app/(app)/lab/page.tsx`; Task 28 replaced the typed 74 % to 225 % range with the lab's and rounded the numbers, and the "Synthetic fixture" notes no longer show since the real lab outputs are synced.

**Delegable:** yes
**Depends on:** Tasks 14, 15, 20

`/replay` is the demo's highlight (spec §8, Act 2; Task 28 later rounds the lab numbers, replaces the typed volatility range with the lab's and adds the replay-window context): the lab's replay of the 4 February 2026 storm, and below it the on-chain replay pair through the same dashboard once plan 01 records it. `/lab` shows both comparisons (spec §2.7) and the replay-window range next to the highlighted window (audit: avoid the cherry-picking suspicion), plus the honest numbers (LP gain, severity ratio, in-pool volatility share).

**Files:**
- Create: `app/src/components/ReplayCharts.tsx`, `app/src/components/ReplayPanel.tsx`, `app/src/components/BacktestTable.tsx`, `app/src/app/replay/page.tsx`, `app/src/app/lab/page.tsx`

- [x] **Step 1: Replay charts**

Create `app/src/components/ReplayCharts.tsx`:

```tsx
"use client";

import type { ReactElement } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type LabReplay, replayRows } from "@/lib/lab";
import { COLORS, utcTime } from "@/lib/theme";

const tick = { fontSize: 11, fill: COLORS.muted };

function Row({ title, children }: { title: string; children: ReactElement }) {
  return (
    <div>
      <div className="text-xs font-medium text-neutral-600">{title}</div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

export function ReplayCharts({ replay }: { replay: LabReplay }) {
  const data = replayRows(replay);
  const x = <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={utcTime} tick={tick} />;
  const tip = <Tooltip labelFormatter={(t) => `${utcTime(Number(t))} UTC`} formatter={(v) => Number(v).toFixed(2)} />;
  return (
    <div className="space-y-2">
      {replay.price ? (
        <Row title="ETH/USD">
          <LineChart data={data} syncId="replay" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />{x}<YAxis domain={["auto", "auto"]} tick={tick} width={56} />{tip}
            <Line dataKey="price" name="ETH/USD" stroke="#52514e" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </Row>
      ) : null}
      <Row title="σ from the desk (annualised %)">
        <LineChart data={data} syncId="replay" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />{x}<YAxis unit="%" tick={tick} width={56} />{tip}
          <Line type="stepAfter" dataKey="sigmaAnnualPct" name="σ" stroke={COLORS.sigma} dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </Row>
      <Row title="Fee (bp): V follows the storm, S is static at the same time-average">
        <LineChart data={data} syncId="replay" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />{x}<YAxis unit=" bp" tick={tick} width={56} />{tip}<Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="stepAfter" dataKey="feeVBp" name="V (clim)" stroke={COLORS.V} dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="feeSBp" name="S (static)" stroke={COLORS.S} strokeDasharray="6 3" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </Row>
      <Row title="Cumulative ARB: LP losses to arbitrage net of fees (USD)">
        <LineChart data={data} syncId="replay" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />{x}<YAxis tick={tick} width={56} />{tip}<Legend wrapperStyle={{ fontSize: 11 }} />
          <Line dataKey="arbCumVUsd" name="V (clim)" stroke={COLORS.V} dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line dataKey="arbCumSUsd" name="S (static)" stroke={COLORS.S} dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </Row>
    </div>
  );
}
```

- [x] **Step 2: Replay panel**

Create `app/src/components/ReplayPanel.tsx`:

```tsx
import type { LabReplay, LabSummary } from "@/lib/lab";
import { ReplayCharts } from "./ReplayCharts";
import { FixtureNote, Panel, Stat } from "./ui";

const sgn = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

/** The lab's Feb 4 2026 replay: the storm, V's fee leaving S's, and the cumulative arbitrage losses. */
export function ReplayPanel({ replay, summary }: { replay: LabReplay; summary: LabSummary }) {
  const r = summary.replay;
  return (
    <Panel title={`Replay: ${r.window}`} subtitle={`${replay.window.startUtc} to ${replay.window.endUtc}, P* = ${(summary.setting.pStar * 100).toFixed(0)}%, S static at ${r.feeSBp.toFixed(1)} bp (V's time-average).`}>
      <FixtureNote show={replay.fixture || summary.fixture}>Synthetic fixture: the lab has not written lab/out/replay-2026-02-04.json and lab/out/summary.json yet.</FixtureNote>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ARB, V vs S" value={sgn(r.arbChangePct)} hint={`range over windows: ${sgn(r.arbChangeRangePct[0])} to ${sgn(r.arbChangeRangePct[1])}`} />
        <Stat label="σ" value={`${r.sigmaMinPct.toFixed(0)}% to ${r.sigmaMaxPct.toFixed(0)}%`} />
        <Stat label="Fee V (S)" value={`${r.feeVMinBp.toFixed(1)} to ${r.feeVMaxBp.toFixed(1)} bp`} hint={`S: ${r.feeSBp.toFixed(1)} bp`} />
        <Stat label="P_trade V predicted / observed" value={`${r.pTradePredicted.toFixed(3)} / ${r.pTradeObserved.toFixed(3)}`} />
      </div>
      <ReplayCharts replay={replay} />
      <p className="mt-2 text-xs text-neutral-500">Raw data: <a className="underline" href="/data/lab/replay-2026-02-04.json">/data/lab/replay-2026-02-04.json</a></p>
    </Panel>
  );
}
```

- [x] **Step 3: Backtest table**

Create `app/src/components/BacktestTable.tsx`:

```tsx
import type { LabSummary } from "@/lib/lab";

const sgn = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

export function BacktestTable({ summary }: { summary: LabSummary }) {
  const periods = [...new Set([...summary.comparisons.equalAvgFee, ...summary.comparisons.equalTraderCost, ...summary.pTrade].map((x) => x.period))];
  const find = <T extends { period: string }>(xs: T[], p: string) => xs.find((x) => x.period === p);
  return (
    <div className="overflow-x-auto">
      <table className="text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-neutral-500">
            <th className="pr-6">Period</th>
            <th className="pr-6">ARB change, equal time-average fee</th>
            <th className="pr-6">ARB change, equal cost to traders</th>
            <th className="pr-6">P_trade predicted / observed</th>
            <th>Blocks</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const a = find(summary.comparisons.equalAvgFee, p);
            const c = find(summary.comparisons.equalTraderCost, p);
            const t = find(summary.pTrade, p);
            return (
              <tr key={p}>
                <td className="pr-6">{p}</td>
                <td className="pr-6 font-semibold">{a ? sgn(a.arbChangePct) : "n/a"}</td>
                <td className="pr-6 font-semibold">{c ? sgn(c.arbChangePct) : "n/a"}</td>
                <td className="pr-6">{t ? `${t.predicted.toFixed(3)} / ${t.observed.toFixed(3)}` : "n/a"}</td>
                <td>{t ? t.blocks.toLocaleString("en-US") : "n/a"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [x] **Step 4: Pages**

Create `app/src/app/replay/page.tsx`:

```tsx
import { Dashboard } from "@/components/Dashboard";
import { ReplayPanel } from "@/components/ReplayPanel";
import { deployments } from "@/lib/config";
import { labBand, labReplay, labSummary } from "@/lib/labData";

export default function ReplayPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">The 4 February 2026 storm, replayed</h1>
      <p className="text-sm text-neutral-600">
        Binance ETHUSDT, 12:00 to 16:00 UTC: hourly volatility goes from 74% to 225%. Below, the lab&apos;s replay of that window
        {deployments.pairs.replay ? ", then the same window replayed on-chain on Sepolia (replay desk flagged REPLAY, one price series served to every venue path)" : ""}.
      </p>
      <ReplayPanel replay={labReplay} summary={labSummary} />
      {deployments.pairs.replay ? <Dashboard band={labBand} initialPair="replay" /> : null}
    </div>
  );
}
```

Create `app/src/app/lab/page.tsx`:

```tsx
import { BacktestTable } from "@/components/BacktestTable";
import { ReplayPanel } from "@/components/ReplayPanel";
import { FixtureNote, Panel } from "@/components/ui";
import { labReplay, labSummary } from "@/lib/labData";

export default function LabPage() {
  const s = labSummary;
  const [lo, hi] = s.lpGain.fullRangeEthPctPerYear;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Lab: real data, both comparisons</h1>
      <Panel
        title="Backtest summary"
        subtitle={`P* = ${(s.setting.pStar * 100).toFixed(0)}%, floor ${(s.setting.feeMinPips / 100).toFixed(0)} bp. Two fair comparisons against a static fee: at equal time-average fee, and at equal cost to traders (volume rises with volatility).`}
      >
        <FixtureNote show={s.fixture}>Synthetic fixture: the lab has not written lab/out/summary.json yet.</FixtureNote>
        <BacktestTable summary={s} />
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          <li>LP gain, full-range ETH: {lo}% to {hi}% of capital per year (up to {s.lpGain.volatileAssetPctPerYearMax}% on volatile assets); {s.lpGain.shareFromTop5WeeksPct}% of it in the five most turbulent weeks.</li>
          <li>The model predicts how often arbitrage happens; it underestimates how much it takes: observed ARB/LVR is {s.modelSeverityRatio[0]} to {s.modelSeverityRatio[1]} times the model.</li>
          <li>A volatility computed inside the pool gets {s.inPoolVolGainSharePct[0]}% to {s.inPoolVolGainSharePct[1]}% of the same gain: Chainlink CRE is here for robustness (four venues must agree), not accuracy.</li>
        </ul>
        <p className="mt-2 text-xs text-neutral-500">Raw data: <a className="underline" href="/data/lab/summary.json">/data/lab/summary.json</a></p>
      </Panel>
      <ReplayPanel replay={labReplay} summary={s} />
    </div>
  );
}
```

- [x] **Step 5: Build and look**

Run: `(cd app && npm run typecheck && npm run lint && npm run build)`
Expected: `○ /lab` and `○ /replay` in the route table. Then `(cd app && npx next start -p 3000)`, open http://localhost:3000/replay and http://localhost:3000/lab: the replay panel with four stacked charts (ETH/USD, σ rising from 74% to about 225%, V's fee leaving S's dashed line, cumulative ARB with V ending below S) and the yellow "Synthetic fixture" notes; on `/lab`, the table with both comparisons and the three honest-number bullets. Stop the server.

- [x] **Step 6: Commit**

```bash
git add app/src/components/ReplayCharts.tsx app/src/components/ReplayPanel.tsx app/src/components/BacktestTable.tsx app/src/app/replay/page.tsx app/src/app/lab/page.tsx
git commit -m "feat(app): replay and lab pages with both backtest comparisons"
```

---

### Task 22: How-it-works page and FAQ

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `8d5c392`. The page is `src/app/(app)/how/page.tsx` (with `ContractsPanel` at `/how#contracts` since 2026-10-07). `docs/faq.md`'s heading is now "Can a pool that is already live switch to clim?", so Step 2 greps `already live` (2 matches on production, 2026-10-07).

**Delegable:** yes
**Depends on:** Tasks 14, 15

The plain-language explanation uses the live parameters from `params.json` (formula, η, example fees and predicted P_trade at 25/50/100/150/225%). The FAQ below it is `docs/faq.md`, rendered as is (copied by `npm run sync`), so the mentor's two questions ("how is the fee computed?", "can a live pool change its fee?") are answered from one source shared with the README and deck.

**Files:**
- Create: `app/src/app/how/page.tsx`

- [x] **Step 1: Write the page**

Create `app/src/app/how/page.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Panel } from "@/components/ui";
import { FAQ_MD } from "@/generated/faq";
import { params } from "@/lib/config";
import { feePips } from "@/lib/feeMath";
import { predictedPTrade } from "@/lib/ptrade";
import { annualPctToSigmaE9, pipsToBp } from "@/lib/units";

const EXAMPLES = [25, 50, 100, 150, 225];

export default function HowPage() {
  const rows = EXAMPLES.map((s) => {
    const sigma = annualPctToSigmaE9(s);
    const fee = feePips(sigma, params.etaE4, params.sqrtHalfDtE6, 10_000, params.feeMinPips, params.feeMaxPips);
    return { s, fee, p: predictedPTrade(fee, sigma, params.sqrtHalfDtE6) };
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">How clim works</h1>
      <Panel title="1. Four weather stations must agree (Chainlink CRE)">
        <p className="text-sm">
          Every 30 seconds a Chainlink CRE workflow pulls one-minute ETH candles from Coinbase, Kraken, Binance and Hyperliquid, plus
          Deribit&apos;s DVOL. A venue whose last candle is older than 120 s is dropped; with fewer than 3 venues there is no report.
          Each node computes the median price per minute and the 15-minute realised volatility (RV15); the DON takes the median of
          every field and writes one signed report to <code>RiskDesk.onReport</code>.
        </p>
        <p className="mt-2 text-sm">
          RiskDesk only stores the number after checks: reports at least 20 s apart, at most 30 s in the future, at least 3 sources,
          and σ may move only between 0.8× and 2× its previous value per report (volatility rises fast, falls slowly). Dispersion
          between venues above 25 bp flags the report as degraded. No function sets σ or the fee: the owner only chooses which forwarder to trust, and every report stays inside these bounds.
        </p>
      </Panel>
      <Panel title="2. The toll booth reads the weather on every swap (Uniswap v4 hook)">
        <p className="text-sm">
          Nobody sends a transaction to change the fee. On every swap the Uniswap v4 PoolManager calls the hook&apos;s
          <code> beforeSwap</code>; the hook reads <code>RiskDesk.state()</code>, computes the fee and returns it with
          <code> OVERRIDE_FEE_FLAG</code>. The same fee applies in both directions and does not depend on the pool&apos;s own state,
          so splitting a trade or sandwiching it does not change it.
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-neutral-100 p-2 text-xs">
          fee = clamp(η · σ · √(Δt/2) · k, {pipsToBp(params.feeMinPips)} bp, {pipsToBp(params.feeMaxPips)} bp),  η = 1/P* − 0.824 = {(params.etaE4 / 1e4).toFixed(3)},  Δt = 12 s,  k = 1
        </pre>
        <p className="mt-2 text-sm">
          η is chosen so that, when the floor does not bind, a share P* = {(params.pStar * 100).toFixed(0)}% of blocks gets
          arbitraged (Milionis-Moallemi-Roughgarden 2023, fixed-block form by Nezlobin-Tassy 2025). That prediction is checked
          continuously on the dashboard.
        </p>
        <table className="mt-3 text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-neutral-500"><th className="pr-6">σ (annualised)</th><th className="pr-6">Fee</th><th>Predicted share of arbitraged blocks</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.s}><td className="pr-6">{r.s}%</td><td className="pr-6">{pipsToBp(r.fee).toFixed(1)} bp</td><td>{(r.p * 100).toFixed(1)}%</td></tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="3. When the stations go quiet">
        <p className="text-sm">
          If the desk has not reported for {params.tauKillSec} s, the hook is blind and quotes at least {pipsToBp(params.feeSafePips)} bp
          until a fresh report lands. A degraded report (venues disagree) also lifts the fee to at least {pipsToBp(params.feeSafePips)} bp.
        </p>
      </Panel>
      <Panel title="FAQ">
        <div className="text-sm [&_code]:text-xs [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_hr]:my-4 [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2 [&_td]:pr-4 [&_th]:pr-4 [&_th]:text-left">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{FAQ_MD}</ReactMarkdown>
        </div>
      </Panel>
    </div>
  );
}
```

- [x] **Step 2: Build and check the FAQ is there**

Run: `(cd app && npm run typecheck && npm run lint && npm run build)`
Expected: `○ /how` in the route table. Then:

```bash
(cd app && (npx next start -p 3000 >/dev/null 2>&1 &) && sleep 4 && curl -s http://localhost:3000/how | grep -c "already live"; lsof -ti tcp:3000 | xargs kill)
```
Expected: a count of at least `1`.

- [x] **Step 3: Commit**

```bash
git add app/src/app/how/page.tsx
git commit -m "feat(app): how-it-works page with live parameters and the FAQ"
```

---

### Task 23: Chain snapshot script

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); clim-front commit `7d44982`. The refusal is line 16 of `scripts/snapshot.ts`; with the live pair synced, the script ran for real in Task 26.

**Delegable:** yes
**Depends on:** Tasks 11, 14

**Files:**
- Create: `app/scripts/snapshot.ts`

- [x] **Step 1: Write the script**

Create `app/scripts/snapshot.ts`:

```ts
// Freezes the pair's on-chain history (RiskReported + Swap logs) into public/data/chain/<pair>.json.
// The dashboard loads it first and only asks the RPC for newer blocks, so the live URL keeps working
// after the hackathon even on RPCs with pruned log history. Run: npm run snapshot -- live
import { mkdirSync, writeFileSync } from "node:fs";
import { type ChainSnapshot, fetchPairLogs, fillTimestamps, makeClient } from "@/lib/chain";
import { deployments } from "@/lib/config";
import { decodeDeliveries, decodeReports, decodeSwaps } from "@/lib/decode";
import { type Pair, PAIRS, SEPOLIA_CHAIN_ID } from "@/lib/deployments";

const CONFIRMATIONS = 3;

async function main() {
  const pair = (process.argv[2] ?? "live") as Pair;
  if (!PAIRS.includes(pair)) throw new Error(`unknown pair ${pair}, use one of ${PAIRS.join(", ")}`);
  const d = deployments.pairs[pair];
  if (!d) throw new Error(`pair ${pair} is not in src/generated/sepolia.json: run npm run sync after deploying`);
  const client = makeClient();
  const head = await client.getBlock({ blockTag: "latest" });
  const to = Number(head.number) - CONFIRMATIONS;
  const anchor = { block: Number(head.number), t: Number(head.timestamp) };
  const logs = await fetchPairLogs(client, d, deployments, d.startBlock, to);
  const snap: ChainSnapshot = {
    schema: "clim.chainSnapshot/1",
    pair,
    chainId: SEPOLIA_CHAIN_ID,
    fromBlock: d.startBlock,
    toBlock: to,
    generatedAt: new Date().toISOString(),
    deskLogs: fillTimestamps(logs.deskLogs, anchor),
    swapLogs: fillTimestamps(logs.swapLogs, anchor),
    forwarderLogs: fillTimestamps(logs.forwarderLogs, anchor),
  };
  mkdirSync("public/data/chain", { recursive: true });
  writeFileSync(`public/data/chain/${pair}.json`, JSON.stringify(snap));
  console.log(
    `public/data/chain/${pair}.json: blocks ${snap.fromBlock}..${snap.toBlock}, ${decodeReports(snap.deskLogs).length} reports, ${decodeSwaps(snap.swapLogs).length} swaps, ${decodeDeliveries(snap.forwarderLogs).filter((x) => !x.accepted).length} rejected deliveries`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [x] **Step 2: Run it before deployment, expected clean refusal**

Run: `(cd app && npm run snapshot -- live)`
Expected (while the live pair is not deployed): `pair live is not in src/generated/sepolia.json: run npm run sync after deploying`, exit code 1. (Validated in the scratch project against real Sepolia logs: with a temporary plan-04-shaped deployments file pointing at an existing pool and an existing forwarder receiver, it wrote `public/data/chain/live.json` covering 3,000 blocks with 35 swaps and 3 rejected deliveries.)

- [x] **Step 3: Commit**

```bash
git add app/scripts/snapshot.ts
git commit -m "feat(app): freeze on-chain log history into a static snapshot"
```

---

### Task 24: First deployment to Vercel (mock data)

Done in DVB-ANS/clim-front, imported into app/ by master Task 14 (subtree 758ab5a); the URL was logged in clim-front commit `5f51267`. Deployed with the CLI from the clim-front root; since master Task 14 production deploys from the clim repo root (Vercel Root Directory `app`, `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`, Task 25 Step 5), not with `vercel link` in `app/`. Checked on 2026-10-07 with curl: `/`, `/app`, `/replay`, `/lab`, `/how`, `/swap`, `/lp`, `/credits` and `/data/lab/replay-2026-02-04.json` answer 200, and `/how` contains "already live".

**Delegable:** no (uses the maintainer's Vercel account)
**Depends on:** Tasks 20, 21, 22

Done in clim-front: https://clim-zeta.vercel.app (Vercel project `clim`, logged in clim-front's session log). After the import, production deploys from the clim repo root to the same project (Root Directory `app`, Task 25 Step 5), so the URL does not change.

Deploying early gives the submission a live URL from the start; later deployments only refresh data.

- [x] **Step 1: Check the CLI session**

Run: `(cd app && vercel whoami)`
Expected: the maintainer's Vercel username. If it asks to log in, the maintainer runs `vercel login` himself.

- [x] **Step 2: Link and deploy from app/**

```bash
(cd app && vercel link --yes --project clim)
(cd app && vercel deploy --prod --yes)
```
Expected: `vercel link` creates `app/.vercel/` (already ignored by `app/.gitignore`); `vercel deploy` builds remotely (`next build`, same route table as locally) and prints the production URL. The stable address is the production domain of project `clim` (Vercel dashboard → clim → Domains), for example `https://clim-<suffix>.vercel.app`.

- [x] **Step 3: Verify it is public and complete**

```bash
URL=https://<the production domain from Step 2>
curl -s -o /dev/null -w "%{http_code}\n" $URL/ && curl -s $URL/how | grep -c "already live" && curl -s -o /dev/null -w "%{http_code}\n" $URL/data/lab/replay-2026-02-04.json
```
Expected: `200`, a count of at least `1`, `200`. If the page asks for a Vercel login, turn off Vercel Authentication for production in Project Settings → Deployment Protection (judges must reach it without an account).

- [x] **Step 4: Log the URL and commit**

Append under `## Decisions` in today's session log, with the domain from Step 2:

```markdown
- **Live URL (plan 05):** https://<production domain> (Vercel project `clim`, deployed from app/). Mock data until the contracts are deployed; redeploy with `(cd app && vercel deploy --prod --yes)` after every `npm run sync`.
```

```bash
git add docs/sessions
git commit -m "docs(session): record the dashboard's live URL"
```

---

### Task 25: Wire to Sepolia (and re-sync whenever shared/ or lab/out change)

**Delegable:** no (needs the deployed addresses and the running bots)
**Depends on:** plan 01 (`shared/deployments/sepolia.json` with the live desk, hook, pools, `deployBlock` and `routers.arb`; `shared/abis/`), plan 03 (`shared/params.json`, `lab/out/*.json`), plans 02 and 04 (reports and swaps flowing); Task 24

Repeat Steps 1 to 6 every time `shared/` or `lab/out/` changes (P\* decision, new deployment, new lab results).

**Done in clim on 2026-10-07** at clim-front `d05ee94` (imported into `app/`). What differs from the text below: the dashboard is at `/app` (the landing is `/`); `/swap` and `/lp` show only the on-chain mode once the deployment has the live pair (no simulated switch or label in production); the replay pair reads as a finished run (`src/lib/finished.ts`: badge "Finished replay on Sepolia", its span and why its hook now quotes the 30 bp safe fee, history panels ending at its last swap); a Contracts panel on `/app` and `/how#contracts` lists every address with Etherscan and Sourcify links; production deploys from the repo root (Vercel Root Directory `app/`, root `.vercelignore`). Results are in the session log of 2026-10-07 (Build notes).

- [x] **Step 1: Gate check**

```bash
jq '{deployBlock, desk: .riskDesks.live, hook: .hooks.live, V: .pools.liveV.poolId, S: .pools.liveS.poolId, arb: .routers.arb}' shared/deployments/sepolia.json && jq -r .decidedBy shared/params.json && ls lab/out/
```
Expected: no `null` among `deployBlock`, `desk`, `hook`, `V`, `S`, `arb`; `decidedBy` does not start with `PROVISIONAL`. Missing lab files are fine (fixtures stay, flagged on the page).

- [x] **Step 2: Sync**

Run: `(cd app && npm run sync)`
Expected: `src/generated/sepolia.json` and `src/generated/params.json` show `repo`; each lab file shows `repo` once plan 03 wrote it.

- [x] **Step 3: Tests, including the ABI drift guard**

Run: `(cd app && npm test && npm run typecheck && npm run lint && npm run build)`
Expected: no `failed` test, and no skipped one once `shared/abis/RiskDesk.json` and `shared/abis/ClimHook.json` exist (the 2 drift tests now run). Observed: `Tests  156 passed (156)` right after the first sync at clim-front `d05ee94`, then `Test Files  21 passed (21)`, `Tests  170 passed (170)` with Task 28 and the post-import changes. A `deployments: poolId mismatch for liveV` error at build means `shared/deployments/sepolia.json` is wrong: fix it in plan 01's script, not in the app. A schema error from a lab file means plan 03 and Task 7 disagree: reconcile `app/src/lib/lab.ts` (interface 6) and log it.

- [x] **Step 4: Cross-check the dashboard against the chain**

```bash
HOOK=$(jq -r .hooks.live shared/deployments/sepolia.json); DESK=$(jq -r .riskDesks.live shared/deployments/sepolia.json)
cast call $HOOK "quoteFee()(uint24,uint8)" --rpc-url https://sepolia.gateway.tenderly.co
cast call $DESK "state()(uint40,uint32,uint16,uint8,uint32)" --rpc-url https://sepolia.gateway.tenderly.co
```
Then run `(cd app && npx next start -p 3000)`, open http://localhost:3000/app and check:
- the badge reads "Live from Sepolia: RiskDesk 0x…, hook 0x…" with Etherscan links (on the replay pair: "Finished replay on Sepolia");
- the Quote panel's V fee in bp equals the first `quoteFee` value divided by 100, with the same mode (0 normal, 1 degraded, 2 blind);
- the Desk panel's σ applied equals `state().sigmaE9` converted (`sigmaE9 / 1e9 × √31,536,000 × 100` %), and its last `#seq` equals `state().seq`;
- in the weather chart, every blue dot (a real `Swap.fee`) sits on the staircase rebuilt from `RiskReported` logs;
- Validation shows V and S counts; Safety shows protocol fee 0.

Stop the server. Any mismatch is a bug in the app or in a contract: debug with superpowers:systematic-debugging before going on.

Done on 2026-10-07 without a person at the browser: a headless Chromium (Playwright) rendered `/app`, `/swap` and `/replay` against `next start` and against production, the visible numbers (read from the counters' screen-reader copy) were compared with `cast` reads taken a few seconds later (seq, σ, mode, V and S fees, V's price, the replay desk's seq 459 and its blind 30 bp), and every `Swap.fee` on V was checked against the staircase rebuilt from `RiskReported` logs on the frozen snapshots with the app's own `quoteFee` (519 of 519 live, 520 of 520 replay). The table is in the session log.

- [x] **Step 5: Commit and redeploy**

```bash
P=(app/src/generated app/public/data/lab)
git add $P && git commit -m "chore(app): sync Sepolia deployments, params and lab outputs" -- $P
VERCEL_ORG_ID=team_bCob7HCJS9NchRXoSxF72ygr VERCEL_PROJECT_ID=prj_9VyLbkFAAOnESPzvfjKL8MMjVMsm vercel deploy --prod --yes
```
Run the deploy from the repo root: the Vercel project's Root Directory is `app/` and the root `.vercelignore` uploads `app/` only (the build reads nothing outside `app/` after `npm run sync`). Expected: a `Production: https://clim-<hash>-gamween-7559s-projects.vercel.app` line, the alias https://clim-zeta.vercel.app on the new deployment, and `/app` showing "Live from Sepolia".

- [x] **Step 6: Log**

Append under `## Build notes` in today's session log, with the real addresses:

```markdown
- (app) Dashboard wired to Sepolia: RiskDesk <address from shared/deployments>, ClimHook <address>; `quoteFee()` on-chain matches the Quote panel and every `Swap.fee` dot sits on the staircase rebuilt from `RiskReported` logs (plan 05 Task 25).
```

```bash
git add docs/sessions/<today>.md && git commit -m "docs(session): dashboard wired to Sepolia" -- docs/sessions/<today>.md
```

---

### Task 26: Freeze the on-chain history before submission

**Delegable:** no
**Depends on:** Task 25; run after the last demo data (the plan 00 / 06 "on-chain freeze" gate), before the submission deadline

Judges open the URL later; this makes the page load the full history from a static file and ask the RPC only for newer blocks.

- [x] **Step 1: Snapshot**

```bash
(cd app && npm run snapshot -- live)
(cd app && jq -e '.riskDesks.replay' src/generated/sepolia.json >/dev/null && npm run snapshot -- replay || echo "no replay pair")
```
Expected: `public/data/chain/live.json: blocks <startBlock>..<head-3>, <N> reports, <M> swaps, <K> rejected deliveries` with N, M > 0 and K ≥ 1 after the forged-report demo. Observed on 2026-10-07: `live.json: blocks 11856974..11858653, 622 reports, 1033 swaps, 2 rejected deliveries` and `replay.json: blocks 11856974..11858654, 459 reports, 1028 swaps, 0 rejected deliveries` (the replay is finished, so its file is final).

- [x] **Step 2: Build, check, commit, deploy**

```bash
(cd app && npm run build)
git add app/public/data/chain && git commit -m "chore(app): freeze on-chain log history for the submission" -- app/public/data/chain
VERCEL_ORG_ID=team_bCob7HCJS9NchRXoSxF72ygr VERCEL_PROJECT_ID=prj_9VyLbkFAAOnESPzvfjKL8MMjVMsm vercel deploy --prod --yes   # from the repo root (Task 25 Step 5)
```
Then open the production URL: the badge ends with "history from the frozen snapshot", and the charts load in a few seconds.

- [x] **Step 3: Log**

Append under `## Build notes` in today's session log:

```markdown
- (app) On-chain history frozen: app/public/data/chain/live.json covers blocks <from>..<to> (<N> reports, <M> swaps); the live URL reads it first and polls only newer blocks (plan 05 Task 26).
```

```bash
git add docs/sessions/<today>.md && git commit -m "docs(session): on-chain history frozen in the dashboard" -- docs/sessions/<today>.md
```

---

### Task 27: Test-swap page (superseded by `/swap` and `/lp`)

**Delegable:** yes (the browser check needs a wallet with Sepolia ETH)
**Depends on:** Task 25, plan 01 Task 7 (`TestToken.faucet()`)

The Frontend scope upgrade (session log 2026-10-06) made `/swap` and `/lp` core pages, and clim-front built them (its session log, "`/swap`" and "`/lp` through `PoolModifyLiquidityTest`"). They replace this task's former optional page, which minted with the owner-only `mint` and could not work for visitors. Files (in `app/`): `src/app/swap/page.tsx`, `src/app/lp/page.tsx`, `src/components/{SwapForm,LiquidityBoard,LiquidityForm,PositionPanel,FaucetCard,TxSteps,TxModeSwitch,WalletButton,WalletProviders}.tsx`, `src/hooks/{useTxFlow,useChainSteps,useLpState,useStored}.ts`, `src/lib/{wallet,swap,liquidity,tx}.ts` with their tests. Until the live pair is in `shared/deployments/sepolia.json` both pages run a simulated mode (same steps, fake hashes); with the live pair the on-chain mode is the only one shown (since 2026-10-07, no switch). In clim the pages live under `app/src/app/(app)/` and the transaction code also uses `src/lib/{swap,liquidity,tx}.ts`'s `swapArgs`, `fullRangeParams`, `approvalWithMargin` and `withGasMargin`.

**Done on 2026-10-07 by script, not with a browser wallet** (the maintainer was away and no wallet may be connected in a browser): `app/scripts/e2e-onchain.ts` (`npm run e2e:onchain -- <env file with TEST_PRIVATE_KEY> [--out summary.json]`) sends what the UI sends, with the UI's own builders, from a throwaway test key; the browser check of the pages is read-only (they load, show the live numbers and the Connect button). The faucet credits 10 tETH and 25,000 tUSD per hour (`faucetAmount()`, `FAUCET_COOLDOWN()` = 3600).

- [x] **Step 1: Check the pages in a browser, on Sepolia**

After Task 25 (live pair synced and deployed), with MetaMask or Rabby on Sepolia and some Sepolia ETH for gas: open `/lp`, Connect, "Get tETH and tUSD" (two `faucet()` transactions), add 1 tETH of full-range liquidity to pool V; then open `/swap` and swap 0.1 tETH on V, then on S. By script instead: `(cd app && npm run e2e:onchain -- <key file> --out <summary.json>)`; expected `PASS` on every check (V's `Swap.fee` equals `ClimHook.quoteFee()` in the swap's block or the one before, S's equals its PoolKey fee, each position read back from StateView then removed, `FaucetCooldown` decoded on a second run within the hour) and every receipt `success`.
Expected:
- the faucet credits 10 tETH and 25,000 tUSD; a second click within the hour fails with `FaucetCooldown` (decoded thanks to Task 28's ABI fragment);
- `/lp` shows the position (liquidity, value, uncollected fees) and "if you had been in S";
- each swap's status line ends with the fee paid and an Etherscan link; on V it equals the Quote panel's fee at that time, on S the static fee; the dashboard counts these swaps as retail (they go through `uniswap.poolSwapTest`, not `routers.arb`).

- [x] **Step 2: Log**

Append under `## Build notes` in today's session log:
```markdown
- (app) `/swap` and `/lp` checked on Sepolia (by script or with a wallet): faucet <tx>, liquidity added to V <tx>, swap on V paid <x> bp (Quote panel <x> bp), swap on S paid <s> bp (plan 05 Task 27).
```
```bash
git add docs/sessions/<today>.md && git commit -m "docs(session): /swap and /lp checked on Sepolia" -- docs/sessions/<today>.md
```

---

### Task 28: Post-import fixes from the plan review (in clim, after master plan Task 14 imports clim-front)

**Delegable:** yes
**Depends on:** master plan Task 14 Steps 1 to 4 (the app is in `app/`, `npm ci` done); plan 01 Task 7 (the `TestToken` faucet); plan 03 Task 17 (the `replay.windows*` fields of `lab/out/summary.json`; until they exist the replay note is simply not shown)

The plan review (2026-10-06) found what the clim-front build could not know: lab numbers printed with 8 significant digits, a typed volatility range on `/replay` that contradicts the lab, no context for the replay window (at P\* = 0.3 no rolling 4 h window of the storm does better: best −18.4 %, median −2.1 %), and no ABI fragment for the faucet's cooldown error. The fixes below were applied to a scratch import of clim-front at commit `c924078` and checked there (`tsc`, `eslint`, `vitest`, `next build`).

**Files:**
- Create: `app/src/lib/labText.ts`, `app/src/lib/labText.test.ts`
- Modify: `app/src/lib/lab.ts`, `app/src/app/(app)/lab/page.tsx`, `app/src/app/(app)/replay/page.tsx`, `app/src/components/ReplayPanel.tsx`, `app/src/lib/abis.ts`, `app/src/lib/abis.test.ts`

**Done in clim on 2026-10-07** (commit `fix(app): round lab numbers, replay range from data, replay-window context, faucet error ABI`). The imported app is clim-front `d05ee94`, not `c924078`: the pages live under the route group `src/app/(app)/`, and the code below is what was committed. The replay note now uses the README's wording ("no rolling 4 h window of the storm does better (best −18.4 %); median −2.1 %; 66 of 92 windows beat the fixed pool"); the lab page's LP-gain line follows the README too (+0.40 % is the main scenario on an asset twice as volatile, not an upper bound); a drift test checks the TestToken fragments against `shared/abis/TestToken.json`.

- [x] **Step 1: Write the failing test**

`app/src/lib/labText.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { replayWindowNote, roundPct, signedPct, usdPerMillion } from "./labText";

describe("lab numbers as judges read them", () => {
  it("rounds the lab's 8 significant digits", () => {
    expect(signedPct(0.70240233)).toBe("+0.70%");
    expect(signedPct(-0.0981486)).toBe("-0.10%");
    expect(signedPct(-2.1181905, 1)).toBe("-2.1%");
    expect(roundPct(52.87945)).toBe("53%");
    expect(roundPct(103.34705)).toBe("103%");
  });

  it("turns % of capital per year into dollars per $1M of liquidity", () => {
    expect(usdPerMillion(0.39)).toBe("$3,900");
    expect(usdPerMillion(-0.0981486)).toBe("-$981");
    expect(usdPerMillion(0.70240233)).toBe("$7,024");
  });

  it("puts the replay window in the context of the rolling windows, in the README's words", () => {
    const r = { arbChangeRangePct: [-18.366445, 3.1499447] as [number, number], windowsMedianPct: -2.1181905, windowsBetterCount: 66, windowsCount: 92, windowsBeatingChosenCount: 0 };
    expect(replayWindowNote(r)).toBe(
      "Picked during design at an earlier setting, around the sharpest rise in volatility: at this P* no rolling 4 h window of the storm does better (best -18.4%); median -2.1%; 66 of 92 windows beat the fixed pool.",
    );
    expect(replayWindowNote(r)).not.toMatch(/most favou?rable/);
    expect(replayWindowNote({ ...r, windowsBeatingChosenCount: 3 })).toContain("3 of the 92 rolling 4 h windows of the storm did better");
    expect(replayWindowNote({})).toBeNull();
  });
});
```

- [x] **Step 2: Run it, expected FAIL**

Run: `(cd app && npx vitest run src/lib/labText.test.ts)`
Expected: `Error: Cannot find module './labText'` and `Tests  no tests`.

- [x] **Step 3: Minimal implementation**

`app/src/lib/labText.ts`:
```ts
// Display helpers for lab numbers: lab/out/*.json carries 8 significant digits, judges see rounded values
// (shares to whole percent, % of capital per year to 2 decimals), the same rule as the README and the deck (plan 06).

/** Signed percent with a fixed number of decimals: "+0.70%", "-0.10%". */
export function signedPct(x: number, digits = 2): string {
  return `${x > 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

/** A share in whole percent: "53%". */
export function roundPct(x: number): string {
  return `${Math.round(x)}%`;
}

/** A gain in % of capital per year as dollars per year per $1M of liquidity (1% of $1M = $10,000). */
export function usdPerMillion(pctPerYear: number): string {
  const usd = Math.round(Math.abs(pctPerYear) * 10_000);
  return `${pctPerYear < 0 ? "-" : ""}$${usd.toLocaleString("en-US")}`;
}

export type ReplayWindows = {
  arbChangeRangePct?: [number, number];
  windowsMedianPct?: number;
  windowsBetterCount?: number;
  windowsCount?: number;
  windowsBeatingChosenCount?: number;
};

/** The replay window against the rolling 4 h windows of the storm (plan 03 Task 17); null with an older summary.json. */
export function replayWindowNote(r: ReplayWindows): string | null {
  const { windowsMedianPct: median, windowsBetterCount: better, windowsCount: n, windowsBeatingChosenCount: beating } = r;
  if (median === undefined || better === undefined || n === undefined || beating === undefined) return null;
  const best = r.arbChangeRangePct?.[0];
  // The replay window (12:00-16:00) is not one of the rolling windows (they start at :16), so the note says
  // that none does better, in the README's words, rather than calling it the best of them.
  const where = beating === 0
    ? `no rolling 4 h window of the storm does better${best === undefined ? "" : ` (best ${signedPct(best, 1)})`}`
    : `${beating} of the ${n} rolling 4 h windows of the storm did better`;
  return `Picked during design at an earlier setting, around the sharpest rise in volatility: at this P* ${where}; median ${signedPct(median, 1)}; ${better} of ${n} windows beat the fixed pool.`;
}
```

- [x] **Step 4: Run, expected PASS**

Run: `(cd app && npx vitest run src/lib/labText.test.ts)`
Expected: `Tests  3 passed (3)`.

- [x] **Step 5: Use the helpers and the new fields**

Make these exact replacements (each old text occurs once).

In `app/src/lib/lab.ts`, replace
```ts
    arbChangeRangePct: [number, number];
    pTradePredicted: number;
```
with
```ts
    arbChangeRangePct: [number, number];
    // Added by plan 03 Task 17 in the fixer pass; absent from older outputs and from the fixtures.
    windowsMedianPct?: number;
    windowsBetterCount?: number;
    windowsCount?: number;
    windowsBeatingChosenCount?: number;
    pTradePredicted: number;
```

In `app/src/app/(app)/lab/page.tsx`, replace
```tsx
import { labReplay, labSummary } from "@/lib/labData";
```
with
```tsx
import { labReplay, labSummary } from "@/lib/labData";
import { roundPct, signedPct, usdPerMillion } from "@/lib/labText";
```
and replace the three `<li>` lines
```tsx
          <li>LP gain, full-range ETH: {lo}% to {hi}% of capital per year (up to {s.lpGain.volatileAssetPctPerYearMax}% on volatile assets); {s.lpGain.shareFromTop5WeeksPct}% of it in the five most turbulent weeks.</li>
          <li>The model predicts how often arbitrage happens; it underestimates how much it takes: observed ARB/LVR is {s.modelSeverityRatio[0]} to {s.modelSeverityRatio[1]} times the model.</li>
          <li>A volatility computed inside the pool gets {s.inPoolVolGainSharePct[0]}% to {s.inPoolVolGainSharePct[1]}% of the same gain: Chainlink CRE is here for robustness (four venues must agree), not accuracy.</li>
```
with
```tsx
          <li>
            LP gain, full-range ETH: {signedPct(lo)} to {signedPct(hi)} of capital per year ({usdPerMillion(lo)} to {usdPerMillion(hi)} a year per $1M of liquidity).
            In the main scenario, about {roundPct(s.lpGain.shareFromTop5WeeksPct)} of the gain is earned in the five most turbulent weeks; the same scenario on an
            asset twice as volatile (the same year with every return doubled) gains {signedPct(s.lpGain.volatileAssetPctPerYearMax)} a year.
          </li>
          <li>The model predicts how often arbitrage happens; it underestimates how much it takes: observed ARB/LVR is {s.modelSeverityRatio[0].toFixed(2)} to {s.modelSeverityRatio[1].toFixed(2)} times the model.</li>
          <li>A volatility computed inside the pool gets {roundPct(s.inPoolVolGainSharePct[0])} to {roundPct(s.inPoolVolGainSharePct[1])} of the same gain{s.inPoolVolGainSharePct[1] > 100 ? " (above 100%: it did slightly better in one sample)" : ""}: Chainlink CRE is here for robustness (four venues must agree), not accuracy.</li>
```

In `app/src/app/(app)/replay/page.tsx`, replace
```tsx
        Binance ETHUSDT, 12:00 to 16:00 UTC: hourly volatility goes from 74% to 225%. Below, the lab&apos;s replay of that window
```
with
```tsx
        Binance ETHUSDT, 12:00 to 16:00 UTC: the desk&apos;s 15-minute volatility ranges from {Math.round(labSummary.replay.sigmaMinPct)}% to{" "}
        {Math.round(labSummary.replay.sigmaMaxPct)}% a year. Below, the lab&apos;s replay of that window
```

In `app/src/components/ReplayPanel.tsx`, replace
```tsx
import type { LabReplay, LabSummary } from "@/lib/lab";
```
with
```tsx
import type { LabReplay, LabSummary } from "@/lib/lab";
import { replayWindowNote } from "@/lib/labText";
```
and replace
```tsx
      <ReplayCharts replay={replay} />
```
with
```tsx
      {replayWindowNote(r) ? <p className="mb-3 text-xs text-fg-muted">{replayWindowNote(r)}</p> : null}
      <ReplayCharts replay={replay} />
```

In `app/src/lib/abis.ts`, replace
```ts
  // Frontend scope upgrade: public faucet with a fixed amount and a per-address cooldown (plan 01 change).
  "function faucet()",
]);
```
with
```ts
  // Frontend scope upgrade: public faucet with a fixed amount and a per-address cooldown (plan 01 Task 7:
  // 10 tETH or 25,000 tUSD per address per hour). The error lets viem decode a second click within the hour.
  "function faucet()",
  "function faucetAmount() view returns (uint256)",
  "function lastFaucetAt(address account) view returns (uint256)",
  "error FaucetCooldown(uint256 nextAt)",
]);
```

- [x] **Step 6: Run everything**

Run: `(cd app && npm run typecheck && npm run lint && npm test && npm run build)`
Expected: `tsc --noEmit` and `eslint` print no error; no `failed` test and none skipped once `shared/abis/` exists. Observed on 2026-10-07 at clim-front `d05ee94` plus this task: `Test Files  19 passed (19)`, `Tests  160 passed (160)` (156 after the sync, plus labText's 3 and the TestToken drift test); the route table lists `/`, `/app`, `/credits`, `/how`, `/lab`, `/lp`, `/replay` and `/swap`, all static.

- [x] **Step 7: Commit and redeploy**

```bash
P=(app/src/lib/labText.ts app/src/lib/labText.test.ts app/src/lib/lab.ts "app/src/app/(app)/lab/page.tsx" "app/src/app/(app)/replay/page.tsx" app/src/components/ReplayPanel.tsx app/src/lib/abis.ts app/src/lib/abis.test.ts)
git add $P && git commit -m "fix(app): round lab numbers, replay range from data, replay-window context, faucet error ABI" -- $P
```
Commit with the paths (`git commit -- <paths>`): another session may have staged its own files. The redeploy comes with Task 25 Step 5 (from the repo root, see there).

---

## Self-review (performed when writing this plan)

**1. Spec coverage** (spec §3.10, §4, §5, §7, §8 and the orchestrator's list):

| Requirement | Task |
|---|---|
| "/" Desk panel: σ (applied vs reported), RV15, DVOL, dispersion, nSources, age τ, mode, flags, zone, last CRE tx hashes | 16 |
| Quote panel: V vs S fee in bp, theoretical curve fee(σ) with the current point | 16 |
| Weather chart: σ over time with the fee stepping under it, swap fee dots, S line, blind shading (the mentor's "how is the fee computed?") | 8, 17 |
| Validation: rolling P_trade predicted vs observed inside the simulated band; totals for V and S | 9, 18 |
| LP P&L explain per pool (LVR, FEE_arb, ARB, FEE_retail) and the "not at equal fee" label | 10, 19 |
| Volatility quad (σ_IV, σ_RV, σ_arb, σ_BE) | 9, 10, 18 |
| Safety: forged-report rejection and blind-mode evidence with tx hashes; protocol fee 0 check | 5, 8, 11, 19 |
| "/replay" and "/lab": Feb 4 replay (price, σ, fee V vs S, cumulative ARB), backtest summary with both comparisons, replay-window range, honest numbers; same lab files as plan 06 | 7, 21 |
| Recent swaps on the live page (plan 06's demo) | 10, 19 |
| "/how": plain-language explanation + FAQ incl. "can a live pool change its fee?" | 13, 22 |
| `/swap` and `/lp` with a wallet and the faucet (Frontend scope upgrade, built in clim-front) | 27 (check on Sepolia), 28 (faucet error ABI) |
| Data layer: chunked getLogs filtered by poolId, RPC fallback, lab JSON loader, deployments from shared/ | 6, 7, 11, 13, 14 |
| Mock data first, then Sepolia and lab/out | 12, 14, 20, 25 |
| Vercel deployment with exact commands; history frozen for judges | 24, 26 |
| TDD of pure transforms (decoding, series, rolling P_trade, bp formatting) | 2 to 13 |
| Session-log lines at each decision or surprise | 1, 7, 9, 11, 12, 20, 24, 25, 26 |

Gaps, consciously left out: the per-window severity test (spec §7.4) is shown only as the summary's `modelSeverityRatio` range until plan 03 publishes per-window values; the Basel zone colours wait for `zone` to be non-zero (P2).

**2. Placeholder scan.** Searched for TBD, TODO, "implement later", "similar to Task", "add error handling": none. The only angle-bracket fill-ins are runtime values the executor reads off a command output (the Vercel domain, deployed addresses, block numbers) inside session-log lines and the interface example of `shared/deployments/sepolia.json`.

**Fixer pass (2026-10-06).** Tasks 1 to 24 and the scope upgrade ran in DVB-ANS/clim-front; Task 27 became the Sepolia check of `/swap` and `/lp`; Task 28 holds the review's fixes, validated on a scratch `git subtree` import of clim-front `c924078` (126 passed and 2 skipped, typecheck, lint and `next build` with `/lp` and `/swap`).

**3. Type and name consistency.** Checked across tasks: `DeskReport`, `SwapRow`, `Delivery`, `RawLog`, `PairDeployment`, `Params`, `FeeParams`, `Quote`, `FeeMode`, `PairState` (with `protocolFees`), `ClimData` (with `deliveries`), `LabSummary`/`LabReplay`/`ReplayRow`/`LabPTradeBand`, `WeatherPoint`, `SwapView`, `BlindEpisode`, `PTradePoint`; functions `feePips`, `quoteFee`, `decodeReports`, `decodeSwaps`, `decodeDeliveries`, `lastAtOrBefore`, `parseDeployments`, `parseParams`, `computePoolId`, `weatherSeries`, `blindEpisodes`, `timeAverageFeeBp`, `predictedPTrade`, `makePredictor`, `rollingPTrade`, `pTradeTotals`, `sigmaArbAnnualPct`, `pnlExplain`, `sigmaBreakEvenAnnualPct`, `recentSwapRows`, `parseSummary`, `parseReplay`, `replayRows`, `parsePTradeBand`, `bandAt`, `fetchPairLogs(client, pair, deployments, from, to)`, `readPairState(client, pair, stateView)`, `makeMockWorld`. The code was compiled (`tsc --noEmit`), linted, unit-tested (91 passed, 2 skipped) and built (`next build`, 6 static routes) in a scratch copy, then copied into this plan verbatim by a script; a second, fresh scaffold then replayed the plan task by task from this text (every expected FAIL and PASS above, the builds after Tasks 20, 21, 22 and 27, the snapshot refusal, and the pages in a browser were observed).
