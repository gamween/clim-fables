# clim × Fables 04b: the showcase app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `app/` with a one-to-one reproduction of Fables' interface (tokens, Louize and Inter, components, layout, motion, their logo and art) in which clim is grafted where it would live in Fables' product, deployed read-only to `clim-fables.vercel.app` with the showcase guardrails tested on every route and every live number checked against the chain.

**Architecture:** A Next.js 16 app in `app/` (it replaces the TOKEN2049 dashboard, which stays at tag `token2049-submission`). Pages are static shells; client components read Robinhood Chain mainnet (Fables, read only) and testnet (clim's desk and pools D, K, F) with viem public clients, three blocks behind the head, with retries, batched calls and exact time windows from block headers. Evidence, lab, docs and `shared/` are synced into the app at build time (`src/generated/`, `src/vendor/`, committed), as v1 did. Fables' brand files are copied from the maintainer's local kit into a gitignored `public/fables/` and uploaded only by the Vercel CLI from his machine.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, TypeScript 5.9.3, viem 2.57.3, CSS Modules (no Tailwind), react-markdown 10.1.0 + remark-gfm 4.0.1 (credits page only), Vitest 5.0.3, Playwright 1.63.0, ESLint 9.39.5 with eslint-config-next 16.3.8, Node 22, Vercel CLI 48.

Spec: `docs/superpowers/specs/2026-10-13-clim-fables-design.md` (§2 look, §3 positioning, §5.5 app, §5.8 CTO checklist). Master plan: `docs/superpowers/plans/2026-10-13-clim-fables-00-master.md` (Task 5, row 04b). Inventory: `docs/research/fables-ui-inventory.md` (the master plan's "Task 1 of 04b" is done: commit `b3803e2`).

---

## Ground rules for this plan

- Read first: `CLAUDE.md`, the latest `docs/sessions/*.md`, the master plan, then `docs/research/fables-ui-inventory.md` (§1 to §5 for the look, §8 for where clim fits).
- Never write to Robinhood Chain mainnet, and never send a transaction from the app or from any command here. Every chain command in this plan is a read (`eth_call`, `eth_getLogs`, `eth_getBlockByNumber`). Do not install, stop or restart the live launchd stack (`fi.clim-fables.*`); `bots/out/outages.json` is only read.
- Never commit Fables' files: `app/public/fables/` is gitignored. Never copy Fables' CSS, JS or contract sources (SPDX UNLICENSED); the look is rebuilt from the inventory's measurements.
- Never print the Vercel token. It lives at `~/.config/counsel/deploy.env` (key `VERCEL_TOKEN`); load it with `set -a; . ~/.config/counsel/deploy.env; set +a` and pass `--token "$VERCEL_TOKEN"`.
- Every number on screen comes from a chain read or a committed evidence or lab file. Never claim better fees than Fables' keeper; the app's own test fails on an undisclaimed "better fee".
- English, conventional commits, no em dash anywhere. Every commit message ends with the session attribution line given in the conversation. Commit and push to `main` (solo repository, master plan working rules). Never `git add -A`: every commit names its files.
- Working directory for `npm` commands: `app/`. Paths in **Files** are relative to the repository root.

## Decisions

1. **Replace `app/`, do not add a second package.** Spec §5.5, `CLAUDE.md`, `.vercelignore` and the README all point at `app/`; v1 is preserved at tag `token2049-submission` (commit `c17da92`, present in this repository and upstream). v1 cannot be kept beside the showcase: it is a Sepolia dashboard (the Sepolia stack was stopped on 2026-10-14), its wallet stack (RainbowKit, wagmi, the MetaMask SDK under a non-commercial licence, `ua-parser-js` under AGPL) contradicts the no-wallet guardrail, and its look (Ventriloc in pink and blue) is unrelated. Two apps would double CI and confuse the CTO. Kept from v1: the build-time sync of the repository's sources of truth (`scripts/sync-data.mjs`, rewritten for the new files, with a `--check` mode for CI), the credits page rendering `THIRD_PARTY_NOTICES.md` (react-markdown, as v1), `npm run licenses`, the anti-framing headers, the deploy from the repository root with Root Directory `app/`, and the idea of an on-chain end-to-end check (rewritten read-only as the live check). Not kept: every v1 component, hook and library (Sepolia-specific), Tailwind, recharts, motion.
2. **Routes mirror Fables'.** `/` (landing), `/markets` (list with a "Fee source" column), `/markets/eth` (Fables' ETH/USDG pool page, the centerpiece; Fables uses `/markets/:symbol`), `/markets/d`, `/markets/k`, `/markets/f` (clim's testnet pools), `/integrate` and `/evidence` (Fables' docs layout), `/run` (the fork run replayed in the pool layout), `/credits`, and Fables' 404. The spec's `/pool/eth-usdg` redirects to `/markets/eth`. The nav pill holds Markets, Integrate, Evidence, Run: Portfolio, Leaderboard and Vote are wallet pages (inventory §8) and are left out.
3. **Data layer.**
   - Clients: `createPublicClient` only (no account, no wallet actions), one per chain, `fallback` over the public endpoints (`rpc.mainnet.chain.robinhood.com` then `rpc.ordofi.network`; `rpc.testnet.chain.robinhood.com`), JSON-RPC batches of at most 50, viem retries with a 2 s delay. Optional `NEXT_PUBLIC_RH_*_RPC_URL` overrides go first; production sets none. No key ever reaches the bundle.
   - Reads three blocks behind the head with `withRetry` (ported from `bots/src/live/lib/retry.ts`).
   - Current state (15 s poll): Fables' `currentFee(poolId, zeroForOne)` both ways and `StateView.getSlot0`; clim's quote through the published level 1 reader `docs/integrate/keeper-read.ts` (vendored byte for byte), the desk's `state()`, and D, K, F's `currentFee` and `getSlot0`, all at one block.
   - Logs (30 s poll, only the new blocks after the first read): `eth_getLogs` in ranges of 5,000,000 blocks (the RPCs cap at 10,000,000). Windows start at the exact first block whose timestamp is at or after `now - window` (interpolation and bisection over block headers), because the public RPCs return `blockTimestamp` as `0x0` in logs. Event times: block headers (cached, 50 per batch) for Fables' `FeePoked` and for K and F; the observation time `tObs` carried by clim's own `Poked` and `RiskReportedV2` (pool D is poked every 30 s: reading 2,880 headers a day would hit the rate limit).
   - The hook's fee is rebuilt from `FeePoked` logs with the rule the lab verified on 1,820 of 1,820 swaps (`max(override, floor, flat x 50 %)`, capped, flat after expiry); a unit test reproduces the lab's published steps of 7 October 2026 exactly.
   - Build-time data: `src/vendor/shared/` (the `shared/` package's sources, deployments and parameters, imported as `@clim/shared`), `src/vendor/integrate/keeper-read.ts`, and `src/generated/` (fork run and reports, gas, the latest live check, the four lab framing strings verbatim, the integration ladder, keeper diff, batch and calldata, the failure-modes table of `docs/security.md` §7, the outage snapshot, the notices). `npm run sync -- --check` fails CI when any committed copy differs from its source. The outage snapshot comes from the gitignored `bots/out/outages.json` (synced when present, never checked); the browser appends the windows found after it with `shared/`'s `outageWindows`.
4. **Fables' assets.** `npm run fables-assets` copies seven files from `.local/research-2026-10-13/fables-brand/` (logo mark, fox-and-star logo, landing landscape, unicorn, USDG mark, Louize Display Medium, Inter) to `app/public/fables/`, which is gitignored: the public MIT repository does not redistribute Fables' brand kit or 205TF's commercial font; the deployed showcase serves them (the maintainer's decision, spec §8). CI builds without them (CSS masks and `@font-face` simply do not load). Credits name every one of them.
5. **Guardrails, tested.** Permanent banner (no button, fixed at the top, never hidden on scroll), "clim × Fables" next to Fables' mark as the brand, an inert `Showcase: no wallet` pill in the account-chip slot, no Connect, Deposit or Swap affordance, `data-network` tags on every live block, no wallet or signing dependency, no signing or sending code (vendored code included), a bundle scan, a CSP whose `connect-src` allows only this site and the three RPC hosts with `form-action 'none'` and `frame-ancestors 'none'`, and a browser check that records every JSON-RPC method the pages send (reads only) and every host they contact.
6. **Where clim is grafted (inventory §8).** Header account slot: the no-wallet pill. Banner: the non-affiliation line. Landing: the thesis and the live pair "keeper now / clim now" in the hero, three feature plates, featured markets with a "Verified by clim" foot band. Markets: the Fee source column and a network column. ETH/USDG: the stat row gains clim's quote, desk volatility and last report; the Dynamic Fee section shows the keeper's step line (mainnet) next to clim's line, or clim's buy and sell lines (Fables' `lineBuy` green and `lineSell` orange), with Fables' rail rows plus clim's; "Fee updates" lists the keeper's overrides and clim's reports with their transactions; the params card adds the desk, policy and poker. Deviations, each said on the page: Fables' TVL, volume, APR, "Daily Fees" and summary rail come from Fables' indexer and are not readable per pool from the chain, so they are replaced by chain values (price, fee, fee source, keeper overrides in 24 h, desk reports) or left out; the Dynamic Fee panel defaults to 24H (clim's line covers 24 hours: a week is about 20,000 logs); clim's per-direction premium is measured against pool D's mid, not Fables' pool's.
7. **Responsive.** Desktop first, calibrated at 1470 x 956 CSS px (the maintainer's MacBook; Fables measured at 1450 x 838). Mobile rules come from Fables' stylesheets (inventory §6: 1140, 1100, 991, 900, 768, 690 container, 640, 575 px); the inventory could not observe mobile live, so the mobile layout is unverified on a phone (open risk).

## Files

| File | Responsibility | Task |
|---|---|---|
| `app/src/`, `app/scripts/`, `app/public/`, `app/postcss.config.mjs` (v1) | removed (v1 stays at tag `token2049-submission`) | 2 |
| `app/package.json`, `app/package-lock.json`, `app/tsconfig.json`, `app/next.config.ts`, `app/eslint.config.mjs`, `app/vitest.config.mts`, `app/.gitignore`, `app/.env.example` | the new app's toolchain, CSP and redirect | 2 |
| `app/src/lib/rpc.ts` | public RPC endpoints, log range | 2 |
| `app/scripts/sync-data.mjs`, `app/scripts/sync-data.test.ts` | build-time copies and extractions, `--check` | 3 |
| `app/THIRD_PARTY_NOTICES.md` | credits and licences, Fables' assets and fonts | 3 |
| `app/src/vendor/**`, `app/src/generated/**` | synced copies (committed, never edited by hand) | 3 |
| `app/scripts/fables-assets.mjs`, `app/scripts/fables-assets.test.ts` | Fables' brand files into gitignored `public/fables/` | 4 |
| `app/src/app/globals.css` | Fables' tokens, fonts, base | 5 |
| `app/src/lib/format.ts` (+ test) | Fables' number, time and address formats | 6 |
| `app/src/lib/fees.ts` (+ test) | the hook's fee rule, step series, window statistics, clim's points | 7 |
| `app/src/lib/tiers.ts`, `app/src/lib/liveKeys.ts` (+ tests) | badges, fee sources, desk state; the text of each live key | 8 |
| `app/src/lib/chain/retry.ts`, `logs.ts`, `blockTimes.ts`, `app/src/test/fakeRpc.ts` (+ tests) | lag and retry, log ranges, block times and exact window starts | 9 |
| `app/src/lib/chain/fables.ts`, `deployments.ts`, `events.ts` (+ tests) | Fables' pool constants, clim's testnet stack, typed events | 10 |
| `app/src/lib/chain/clients.ts`, `decode.ts`, `readFables.ts`, `readClim.ts`, `readClimNow.ts` (+ tests) | read-only clients, decoders, readers | 11 |
| `app/src/lib/windowStats.ts`, `app/src/lib/outages.ts` (+ tests) | window statistics shared with the live check; outage windows | 12 |
| `app/src/components/ui/*` | Fables' component catalog | 13 |
| `app/src/lib/site.ts`, `app/src/components/shell/*`, `app/src/app/layout.tsx`, `app/src/app/icon.svg`, `app/src/guardrails.test.tsx` | banner, header, footer, promo toast, layout; guardrail unit tests | 14 |
| `app/src/components/charts/*`, `app/src/hooks/*` | step chart; polling and log history hooks | 15 |
| `app/src/components/pages.module.css`, `app/src/components/pool/parts.tsx`, `app/src/components/markets/*`, `app/src/app/markets/page.tsx` | pool parts and the markets list | 16 |
| `app/src/components/pool/FeeUpdates.tsx` (+ test), `RecentSwaps.tsx`, `EthUsdgPool.tsx`, `app/src/app/markets/eth/page.tsx` | the ETH/USDG pool page | 17 |
| `app/src/hooks/useDeskOutages.ts`, `app/src/components/pool/Outages.tsx`, `TestnetPool.tsx`, `app/src/app/markets/[pool]/page.tsx` | pools D, K, F | 18 |
| `app/src/components/landing/*`, `app/src/app/page.tsx` | the landing | 19 |
| `app/src/lib/inlineMd.tsx` (+ test), `app/src/components/docs/*`, `app/src/components/integrate/LiveCompose.tsx`, `app/src/app/integrate/page.tsx` | docs layout, Integrate | 20 |
| `app/src/lib/run.ts` (+ test), `app/src/components/run/RunPlayer.tsx`, `app/src/components/evidence/ForkRunChart.tsx`, `app/src/app/run/page.tsx`, `app/src/app/evidence/page.tsx` | the fork run, Run and Evidence | 21 |
| `app/src/app/credits/page.tsx`, `app/src/app/not-found.tsx`, `app/public/third-party-licenses.txt` | credits, 404, npm licences | 22 |
| `app/scripts/check-bundle.mjs` (+ test), `app/playwright.config.ts`, `app/e2e/guardrails.spec.ts` | bundle scan, browser guardrails | 23 |
| `app/e2e/resolvers.ts`, `app/e2e/live.spec.ts` | the headless live check | 24 |
| `app/e2e/visual.spec.ts` | visual QA against Fables' screenshots | 25 |
| `.github/workflows/ci.yml` | job `app` | 26 |
| `.vercelignore` | upload rules for the new app | 27 |
| `app/README.md`, `README.md`, spec §5.5 and §5.8, master plan, `docs/sessions/<date>.md` | documentation | 28 |

## Measured while writing this plan (2026-10-14, at `b3803e2`)

A prototype of every file below was built in a scratch copy (repository read through symlinks, nothing written to the repository) and run against both chains:

| Check | Result |
|---|---|
| `npm ci` | 488 packages |
| `npm run sync:check` | `25 files checked, 0 stale` |
| `npm test` (Vitest) | 22 files, 122 tests passed |
| `npm run typecheck`, `npm run lint` | exit 0, 0 problems (81 files linted) |
| `npm run build` | 13 routes prerendered (`/markets/d`, `/k`, `/f` by `generateStaticParams`) |
| `npm run check:bundle` | `bundle clean: 24 files, no wallet provider, connector or signing request` |
| `npm run e2e:guardrails` | 12 passed (11 routes and the network tags) |
| `npm run check:live` | 7 passed (every `[data-live]` value equal to a fresh chain read at the same block); the first run hit the mainnet rate limit on `/markets` before the resolvers batched and backed off |
| `npm run qa:visual` | 22 token checks match the inventory at 1450 x 838 |

Facts the code relies on, measured with read-only calls:

- Both public RPCs answer CORS `*`, accept JSON-RPC batches of 100 (a batch of 200 got HTTP 429) and cap `eth_getLogs` at 10,000,000 blocks ("query spans N blocks ..., but only 10000000 are allowed"). Their logs carry `blockTimestamp: "0x0"`.
- Mainnet rate limit seen under bursts of header reads: "Rate Limit Hit, limit will reset in 60 seconds". In the browser, some rejected responses carried a duplicated `Access-Control-Allow-Origin: *,*` and surfaced as CORS errors; the fallback endpoint and the retries covered them. `rpc.ordofi.network` serves chain 4663 for `eth_call` and refused `eth_getLogs` with -32005 "the network is busy".
- Fables' ETH/USDG pool key, from its Initialize log (tx `0x1c00f72a65cd83238e496d21776d783974b4e8baf707c7881da6c61a8d5f5a71`): currency0 native ETH, currency1 USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals), fee `0x800000`, tick spacing 10, hook `0x06a889870C8f83640D6816319f72e2aA579b6080`. `currentFee` read 700 both ways at block 88,390,213; the 7-day window held 945 `FeePoked` logs.
- `clim-fables.vercel.app` answered `DEPLOYMENT_NOT_FOUND` and no Vercel project named `clim-fables` exists in the maintainer's scope (`gamween-7559s-projects`); the v1 project `clim` has Root Directory `app`.
- `actions/setup-node` v7.0.0 is commit `820762786026740c76f36085b0efc47a31fe5020`.

---

### Task 1: Baseline

**Files:** none.

- [ ] **Step 1: Check the tree and the v1 tag**

Run: `git status --short && git log --oneline -1 && git rev-parse --short 'token2049-submission^{commit}'`
Expected: no line for a file under `app/`, `.vercelignore`, `.github/` or `README.md` (another session's files stay unstaged); the last line prints `c17da92`, the submitted v1.

- [ ] **Step 2: Check the inputs exist**

Run: `ls .local/research-2026-10-13/fables-brand/assets/logo.svg .local/research-2026-10-13/fables-brand/fonts/louize-display-medium.woff2 .local/fables-ui/measurements.json bots/out/outages.json docs/evidence/fork-run-2026-10-07.json lab/out/fables-storm-2026-10-07.json`
Expected: six paths printed, no "No such file". Without `.local/` (a fresh clone) Tasks 4, 25 and 27 cannot run; stop and ask the maintainer.

- [ ] **Step 3: Tools**

Run: `node --version && npm --version && vercel --version`
Expected: `v22.x`, npm 10 or 11, `Vercel CLI 48.x`.

### Task 2: Replace v1 with the new app's toolchain

**Files:**
- Delete: `app/src/`, `app/scripts/`, `app/public/`, `app/postcss.config.mjs`, `app/package-lock.json`
- Replace: `app/package.json`, `app/tsconfig.json`, `app/next.config.ts`, `app/eslint.config.mjs`, `app/vitest.config.mts`, `app/.gitignore`, `app/.env.example`
- Create: `app/src/lib/rpc.ts`, `app/src/app/layout.tsx` (placeholder, replaced in Task 14), `app/src/app/page.tsx` (placeholder, replaced in Task 19)
- Keep: `app/AGENTS.md`, `app/CLAUDE.md` (Next's agent rules)

- [ ] **Step 1: Remove v1**

```bash
git rm -r -q app/src app/scripts app/public app/postcss.config.mjs app/package-lock.json
rm -rf app/node_modules app/.next
```

- [ ] **Step 2: Write `app/package.json`**

```json
{
  "name": "clim-fables-app",
  "version": "0.2.0",
  "private": true,
  "license": "MIT",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "sync": "node scripts/sync-data.mjs",
    "sync:check": "node scripts/sync-data.mjs --check",
    "fables-assets": "node scripts/fables-assets.mjs",
    "fables-assets:check": "node scripts/fables-assets.mjs --check",
    "check:bundle": "node scripts/check-bundle.mjs",
    "e2e:guardrails": "playwright test e2e/guardrails.spec.ts",
    "check:live": "playwright test e2e/live.spec.ts",
    "qa:visual": "playwright test e2e/visual.spec.ts",
    "licenses": "npx -y generate-license-file@4.2.5 --input package.json --output public/third-party-licenses.txt --overwrite"
  },
  "dependencies": {
    "next": "16.3.8",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "react-markdown": "10.1.0",
    "remark-gfm": "4.0.1",
    "viem": "2.57.3"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@types/node": "22.20.5",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "eslint": "9.39.5",
    "eslint-config-next": "16.3.8",
    "typescript": "5.9.3",
    "vitest": "5.0.3"
  }
}
```

- [ ] **Step 3: Write `app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@clim/shared": ["./src/vendor/shared/src/index.ts"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `app/src/lib/rpc.ts`**

```ts
// Public RPC endpoints the browser reads. No key: these are the chains' public endpoints. An optional override (for
// a private endpoint during development) comes first; it is a NEXT_PUBLIC_ variable, so never put a key in it.
// Observed limits (2026-10-14): eth_getLogs spans at most 10,000,000 blocks on both chains; rpc.ordofi.network
// answers eth_call but refused eth_getLogs with -32005 "the network is busy". No published rate limit.
export const RPC_URLS = {
  mainnet: [process.env.NEXT_PUBLIC_RH_MAINNET_RPC_URL, "https://rpc.mainnet.chain.robinhood.com", "https://rpc.ordofi.network"].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  ),
  testnet: [process.env.NEXT_PUBLIC_RH_TESTNET_RPC_URL, "https://rpc.testnet.chain.robinhood.com"].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  ),
} as const;

/** eth_getLogs block span the public RPCs accept is 10,000,000; the app asks for half. */
export const LOG_CHUNK_BLOCKS = 5_000_000n;
```

- [ ] **Step 5: Write `app/next.config.ts`**

```ts
import type { NextConfig } from "next";
import { RPC_URLS } from "./src/lib/rpc";

const isDev = process.env.NODE_ENV === "development";

// The showcase only reads: the browser may talk to this site and to the public Robinhood Chain RPCs, nothing else.
// No wallet provider, relay or analytics endpoint can be reached (connect-src), no form can post anywhere
// (form-action 'none'), and no other site may frame the app (frame-ancestors 'none').
const rpcOrigins = [...new Set([...RPC_URLS.mainnet, ...RPC_URLS.testnet].map((u) => new URL(u).origin))];
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' ${rpcOrigins.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  async redirects() {
    // The spec named the pool page /pool/eth-usdg; the app mirrors Fables' route, /markets/eth.
    return [{ source: "/pool/eth-usdg", destination: "/markets/eth", permanent: false }];
  },
};

export default nextConfig;
```

- [ ] **Step 6: Write `app/eslint.config.mjs`**

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Vendored copies (byte-identical to shared/ and docs/integrate/, checked by `npm run sync -- --check`) and
  // generated data are linted where they live, not here.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/vendor/**", "src/generated/**", "playwright-report/**", "test-results/**"]),
]);
```

- [ ] **Step 7: Write `app/vitest.config.mts`**

```text
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@clim/shared": fileURLToPath(new URL("./src/vendor/shared/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
  },
});
```

- [ ] **Step 8: Write `app/.gitignore` and `app/.env.example`**

`app/.gitignore`:

```text
# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# dependencies
/node_modules
/.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files (can opt-in for committing if needed)
.env*

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts

!.env.example

# Fables' brand files: copied from the local kit by `npm run fables-assets`, never committed (THIRD_PARTY_NOTICES.md)
/public/fables/

# playwright
/test-results/
/playwright-report/
```

`app/.env.example`:

```text
# Optional. Each is tried before the public endpoint of its chain. They are NEXT_PUBLIC_ variables, built into the
# browser bundle: never put a key or a private endpoint in them. Production sets neither.
NEXT_PUBLIC_RH_MAINNET_RPC_URL=
NEXT_PUBLIC_RH_TESTNET_RPC_URL=
```

- [ ] **Step 9: Placeholder layout and page (replaced in Tasks 14 and 19)**

`app/src/app/layout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
```

`app/src/app/page.tsx`:

```tsx
export default function Home() {
  return <h1>clim × Fables</h1>;
}
```

- [ ] **Step 10: Install and build**

Run: `cd app && npm install --no-audit --no-fund && npx playwright install chromium && npm run typecheck && npm run build`
Expected: `added 488 packages` (give or take a few), then `✓ Compiled successfully` and a route table with `○ /`. `npm install` writes `app/package-lock.json`.

- [ ] **Step 11: Commit**

```bash
git add app/package.json app/package-lock.json app/tsconfig.json app/next.config.ts app/eslint.config.mjs app/vitest.config.mts app/.gitignore app/.env.example app/src/lib/rpc.ts app/src/app/layout.tsx app/src/app/page.tsx
git commit -m "build(app): replace the TOKEN2049 dashboard with the showcase toolchain

v1 stays at tag token2049-submission. Next.js 16, viem, CSS Modules, Vitest, Playwright; no wallet library.
A CSP lets the browser reach this site and the public Robinhood Chain RPCs only."
```

### Task 3: Sync the repository's sources of truth into the app

**Files:**
- Create: `app/scripts/sync-data.mjs`, `app/scripts/sync-data.test.ts`, `app/THIRD_PARTY_NOTICES.md`
- Generated (committed): `app/src/vendor/shared/**`, `app/src/vendor/integrate/keeper-read.ts`, `app/src/generated/*`

- [ ] **Step 1: Write the failing test `app/scripts/sync-data.test.ts`**

````ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOutputs, fenceAfter, firstTable, outageSnapshot, sectionLines, syncData } from "./sync-data.mjs";

const MD = ["# T", "", "## 7. Failure modes", "", "\"Flat\" is the flat fee.", "", "| A | B |", "|---|---|", "| `x` | [l](u) |", "", "## 8. Next", "| C |", "|---|"].join("\n");

describe("markdown extraction", () => {
  it("cuts a section at the next heading of the same level", () => {
    const lines = sectionLines(MD, "## 7.");
    expect(lines).toContain("| `x` | [l](u) |");
    expect(lines.join("\n")).not.toContain("## 8.");
  });
  it("reads the first table with inline markdown kept", () => {
    expect(firstTable(sectionLines(MD, "## 7."))).toEqual({ header: ["A", "B"], rows: [["`x`", "[l](u)"]] });
  });
  it("finds the fenced block after a line", () => {
    const md = "intro\nThe keeper diff, here:\n\n```ts\nconst a = 1;\n```\n";
    expect(fenceAfter(md, "The keeper diff", "ts")).toBe("const a = 1;\n");
  });
  it("throws on a missing heading", () => {
    expect(() => sectionLines(MD, "## 9.")).toThrow("heading not found");
  });
});

describe("outage snapshot", () => {
  it("keeps the windows and their reason, drops the local records", () => {
    const raw = {
      generatedAt: "g", chainId: 46630, riskDesk: "0xd", gapSec: 90, deployBlock: 1, scannedToBlock: 9, chainTimeSec: 100, reportCount: 3,
      lastReport: { seq: 3, tObs: 90 },
      windows: [{ from: 10, to: 200, durationSec: 190, seqBefore: 1, seqAfter: 2, ongoing: false, reason: "restart", local: [{ ts: "x" }] }],
    };
    const s = outageSnapshot(raw);
    expect(s.windows[0]).toEqual({ from: 10, to: 200, durationSec: 190, seqBefore: 1, seqAfter: 2, ongoing: false, reason: "restart" });
    expect(JSON.stringify(s)).not.toContain("local");
  });
});

type Output = { path: string; content: string };
const contentOf = (outs: Output[], path: string): string => {
  const o = outs.find((x) => x.path === path);
  if (!o) throw new Error(`no output ${path}`);
  return o.content;
};

describe("against the repository", () => {
  const appRoot = dirname(dirname(new URL(import.meta.url).pathname));
  const repoRoot = process.env.CLIM_ROOT ?? dirname(appRoot);

  it("builds every output from the real sources", () => {
    const paths = buildOutputs({ repoRoot, appRoot }).map((o: { path: string }) => o.path);
    expect(paths).toEqual(expect.arrayContaining([
      "src/vendor/shared/src/live.ts",
      "src/vendor/shared/deployments/robinhood-testnet.json",
      "src/vendor/integrate/keeper-read.ts",
      "src/generated/fork-run-2026-10-07.json",
      "src/generated/lab-framing.json",
      "src/generated/integrate.json",
      "src/generated/security.json",
      "src/generated/live-check.json",
      "src/generated/notices.ts",
    ]));
  });

  it("quotes the lab framing strings verbatim", () => {
    const framing = JSON.parse(contentOf(buildOutputs({ repoRoot, appRoot }), "src/generated/lab-framing.json"));
    for (const f of framing) expect(JSON.parse(readFileSync(join(repoRoot, f.file), "utf8")).framing).toBe(f.framing);
    expect(framing.map((f: { title: string }) => f.title)).toEqual(["Effective arbitrage interval", "Volatility window", "Volatility estimator", "Per-direction signal"]);
  });

  it("extracts the ladder, the keeper diff and the failure modes", () => {
    const outs = buildOutputs({ repoRoot, appRoot });
    const integrate = JSON.parse(contentOf(outs, "src/generated/integrate.json"));
    expect(integrate.ladder.header[0]).toBe("Level");
    expect(integrate.ladder.rows).toHaveLength(3);
    expect(integrate.keeperDiff).toContain("composeFee(myFeePips, clim)");
    expect(integrate.keeperRead).toBe(readFileSync(join(repoRoot, "docs/integrate/keeper-read.ts"), "utf8"));
    expect(integrate.batchCalls.rows).toHaveLength(6);
    const security = JSON.parse(contentOf(outs, "src/generated/security.json"));
    expect(security.failureModes.header).toEqual(["Failure", "What happens", "Fee on a pool driven by `ClimPoker`", "Proof"]);
    expect(security.intro).toMatch(/^"Flat" is the hook's flat fee/);
  });

  it("writes into an empty app and then finds nothing stale", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sync-"));
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "THIRD_PARTY_NOTICES.md"), "# Notices\n");
    const first = syncData({ repoRoot, appRoot: tmp });
    expect(first.stale.length).toBe(first.outputs.length);
    expect(syncData({ repoRoot, appRoot: tmp, check: true }).stale).toEqual([]);
    writeFileSync(join(tmp, "src/generated/lab-framing.json"), "[]\n");
    expect(syncData({ repoRoot, appRoot: tmp, check: true }).stale).toEqual(["src/generated/lab-framing.json"]);
  });
});
````

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run scripts/sync-data.test.ts`
Expected: FAIL, the suite cannot load `./sync-data.mjs` (not written yet).

- [ ] **Step 3: Write `app/scripts/sync-data.mjs`**

````js
// Copies the repository's single sources of truth into the app, so the app builds on its own (Vercel uploads app/
// only). Two kinds of output, both committed:
// - src/vendor/: byte-identical copies of shared/ (sources, deployments, parameters) and docs/integrate/keeper-read.ts,
//   imported as `@clim/shared` and `@/vendor/integrate/keeper-read`;
// - src/generated/: evidence, lab and docs data, copied or extracted verbatim.
// A missing required source fails the sync (the app ships real data only). bots/out/outages.json is gitignored and
// exists only on the machine that runs the live stack: without it the committed snapshot is kept as it is.
// Run: npm run sync. Check that every committed output matches its source: npm run sync -- --check.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The lab studies quoted on /evidence, in the README's order, with the README's titles. */
export const LAB_FRAMING = [
  { title: "Effective arbitrage interval", file: "lab/out/fables-dt-eff.json" },
  { title: "Volatility window", file: "lab/out/fables-window.json" },
  { title: "Volatility estimator", file: "lab/out/fables-estimator.json" },
  { title: "Per-direction signal", file: "lab/out/fables-direction.json" },
];

export const EVIDENCE_COPIES = [
  ["docs/evidence/fork-run-2026-10-07.json", "src/generated/fork-run-2026-10-07.json"],
  ["docs/evidence/fork-reports-2026-10-07.json", "src/generated/fork-reports-2026-10-07.json"],
  ["docs/evidence/gas-robinhood-testnet.json", "src/generated/gas-robinhood-testnet.json"],
  ["lab/out/fables-storm-2026-10-07.json", "src/generated/fables-storm-2026-10-07.json"],
];

const SHARED_DATA = ["deployments/sepolia.json", "deployments/robinhood-testnet.json", "params.json", "params-fables.json", "keeper-map-fables.json"];

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** Lines of the section that starts with `heading` (a whole line, e.g. "## 7. Failure modes ...") up to the next
 *  heading of the same or a higher level. */
export function sectionLines(md, headingPrefix) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(headingPrefix));
  if (start < 0) throw new Error(`heading not found: ${headingPrefix}`);
  const level = /^#+/.exec(lines[start])[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i]);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out;
}

/** The first Markdown table in `lines`: its header cells and rows of cells, as written (inline Markdown kept). */
export function firstTable(lines) {
  const start = lines.findIndex((l) => l.startsWith("|"));
  if (start < 0) throw new Error("no table");
  const rows = [];
  for (let i = start; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i]);
  const cells = (row) => row.slice(1, row.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
  const [header, separator, ...body] = rows;
  if (!separator || !/^\|[\s|:-]+\|?$/.test(separator)) throw new Error("table without a separator row");
  return { header: cells(header), rows: body.map(cells) };
}

/** The first fenced block of `lang` after the line that starts with `after`. */
export function fenceAfter(md, after, lang) {
  const lines = md.split("\n");
  const from = lines.findIndex((l) => l.startsWith(after));
  if (from < 0) throw new Error(`line not found: ${after}`);
  const open = lines.findIndex((l, i) => i > from && l.trim() === "```" + lang);
  if (open < 0) throw new Error(`no ${lang} block after: ${after}`);
  const close = lines.findIndex((l, i) => i > open && l.trim() === "```");
  return `${lines.slice(open + 1, close).join("\n")}\n`;
}

/** The newest docs/evidence/live-check-YYYY-MM-DD.json. */
export function latestLiveCheck(repoRoot) {
  const files = readdirSync(join(repoRoot, "docs/evidence"))
    .filter((f) => /^live-check-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) throw new Error("no docs/evidence/live-check-*.json");
  return `docs/evidence/${files[files.length - 1]}`;
}

/** The outage record without the Mac's local process records (the reason sentence keeps what they say). */
export function outageSnapshot(raw) {
  const { generatedAt, chainId, riskDesk, gapSec, deployBlock, scannedToBlock, chainTimeSec, reportCount, lastReport, windows } = raw;
  return {
    source: "bots/out/outages.json",
    generatedAt,
    chainId,
    riskDesk,
    gapSec,
    deployBlock,
    scannedToBlock,
    chainTimeSec,
    reportCount,
    lastReport,
    windows: windows.map(({ from, to, durationSec, seqBefore, seqAfter, ongoing, reason }) => ({ from, to, durationSec, seqBefore, seqAfter, ongoing, reason })),
  };
}

/** Every output as { path (relative to the app), content (string), optional? }. The outage snapshot is optional: its
 *  source is local to the live stack's machine and changes every pass, so it is synced when present and never
 *  checked. */
export function buildOutputs({ repoRoot, appRoot }) {
  const read = (rel) => {
    const p = join(repoRoot, rel);
    if (!existsSync(p)) throw new Error(`missing ${rel}: the app ships real data only`);
    return readFileSync(p, "utf8");
  };
  const out = [];
  for (const f of readdirSync(join(repoRoot, "shared/src")).filter((n) => n.endsWith(".ts")).sort()) {
    out.push({ path: `src/vendor/shared/src/${f}`, content: read(`shared/src/${f}`) });
  }
  for (const f of SHARED_DATA) out.push({ path: `src/vendor/shared/${f}`, content: read(`shared/${f}`) });
  out.push({ path: "src/vendor/integrate/keeper-read.ts", content: read("docs/integrate/keeper-read.ts") });

  for (const [from, to] of EVIDENCE_COPIES) out.push({ path: to, content: read(from) });

  const liveCheckFile = latestLiveCheck(repoRoot);
  out.push({ path: "src/generated/live-check.json", content: json({ file: liveCheckFile, data: JSON.parse(read(liveCheckFile)) }) });

  out.push({
    path: "src/generated/lab-framing.json",
    content: json(
      LAB_FRAMING.map(({ title, file }) => {
        const framing = JSON.parse(read(file)).framing;
        if (typeof framing !== "string") throw new Error(`${file}: no framing string`);
        return { title, file, framing };
      }),
    ),
  });

  const integrateMd = read("docs/integrate/README.md");
  out.push({
    path: "src/generated/integrate.json",
    content: json({
      ladder: firstTable(integrateMd.split("\n")),
      keeperDiff: fenceAfter(integrateMd, "The keeper diff", "ts"),
      keeperRead: read("docs/integrate/keeper-read.ts"),
      batchCalls: firstTable(sectionLines(integrateMd, "## Level 2")),
      batchFork: JSON.parse(read("docs/integrate/level2-batch.fork.json")),
      batchTestnet: JSON.parse(read("docs/integrate/level2-batch.testnet.json")),
    }),
  });

  const securityMd = read("docs/security.md");
  const failure = sectionLines(securityMd, "## 7.");
  out.push({
    path: "src/generated/security.json",
    content: json({ intro: failure.find((l) => l.trim().length > 0 && !l.startsWith("|")), failureModes: firstTable(failure) }),
  });

  out.push({
    path: "src/generated/notices.ts",
    content: `// Generated by scripts/sync-data.mjs from THIRD_PARTY_NOTICES.md. Do not edit.\nexport const NOTICES_MD = ${JSON.stringify(readFileSync(join(appRoot, "THIRD_PARTY_NOTICES.md"), "utf8"))};\n`,
  });

  const outages = join(repoRoot, "bots/out/outages.json");
  if (existsSync(outages)) {
    out.push({ path: "src/generated/outages.json", content: json(outageSnapshot(JSON.parse(readFileSync(outages, "utf8")))), optional: true });
  }
  return out;
}

export function syncData({ repoRoot, appRoot, check = false }) {
  const outputs = buildOutputs({ repoRoot, appRoot });
  const stale = [];
  for (const { path, content, optional } of outputs) {
    if (check && optional) continue;
    const dest = join(appRoot, path);
    const current = existsSync(dest) ? readFileSync(dest, "utf8") : null;
    if (current === content) continue;
    stale.push(path);
    if (!check) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
  }
  return { outputs: outputs.map((o) => o.path), stale };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  // The repo root is the parent of app/; CLIM_ROOT overrides it.
  const repoRoot = process.env.CLIM_ROOT ? resolve(process.env.CLIM_ROOT) : dirname(appRoot);
  const check = process.argv.includes("--check");
  const { outputs, stale } = syncData({ repoRoot, appRoot, check });
  if (check && stale.length > 0) {
    console.error(`out of date (run npm run sync): ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(`${outputs.length} files ${check ? "checked" : "synced"}, ${stale.length} ${check ? "stale" : "written"}`);
}
````

- [ ] **Step 4: Write `app/THIRD_PARTY_NOTICES.md` (the sync embeds it for `/credits`)**

```markdown
# Credits and licences

clim × Fables is a showcase by clim. It is not affiliated with Fables. clim's own code is under the MIT licence
(`LICENSE` at the repository root). This page lists what the showcase uses that is not clim's. The licence text of
every npm package in the app's dependencies is in [/third-party-licenses.txt](/third-party-licenses.txt)
(`npm run licenses` regenerates it).

## Fables' look, name and assets

The showcase reproduces the interface of [Fables](https://www.fables.fi) on purpose, to show where clim would sit in
Fables' own product. It does so as a showcase, on its own domain, under a permanent "Showcase by clim, not affiliated
with Fables" banner, with no wallet connection and no transaction.

- **The interface.** Layout, colours, type scale, spacing, radii, shadows and motion were measured on
  `www.fables.fi` on 2026-10-14 and rebuilt from those measurements
  ([docs/research/fables-ui-inventory.md](https://github.com/gamween/clim-fables/blob/main/docs/research/fables-ui-inventory.md)).
  No Fables stylesheet, script or component source is copied; Fables' contract sources (SPDX UNLICENSED) are not in
  this repository, and the app reads Fables' contracts through their published interface only.
- **Name, logo and art.** The Fables name, the fox-and-star logo and mark, the landing landscape, the unicorn
  illustration and the USDG token mark come from Fables' public brand kit at
  [fables.fi/brand](https://www.fables.fi/brand) (downloaded 2026-10-13). They belong to Fables. They are served by the
  deployed showcase only, from `public/fables/`, which is not committed to the repository
  (`npm run fables-assets` copies them from the maintainer's local copy of the kit).
- **Louize.** The display face is Louize Display Medium by 205TF, a commercial typeface, in the subset Fables serves
  on its site. It belongs to 205TF; its use in this showcase is the maintainer's decision. The font file is not
  committed to the repository.
- **Inter.** The text face is Inter, in the build Fables serves. Inter is by Rasmus Andersson and The Inter Project
  Authors, under the SIL Open Font License 1.1 (https://openfontlicense.org). Not committed either, to keep every
  file taken from Fables' kit in one place.
- **Copy.** A few interface strings follow Fables' own wording (for example the "Dynamic Fee" section description and
  the "Current fee" tooltips) so the pages read like Fables' product; every one sits next to clim's own labels.

## Code

- [viem](https://viem.sh) (MIT, © weth, LLC), the only chain library in the app: public clients and ABI encoding.
  No wallet library is a dependency.
- [Next.js](https://nextjs.org) and [React](https://react.dev) (MIT).
- [react-markdown](https://github.com/remarkjs/react-markdown) and [remark-gfm](https://github.com/remarkjs/remark-gfm)
  (MIT, © Espen Hovlandsdal and Titus Wormer), for this page.

## Data

Live numbers are read from Robinhood Chain mainnet (Fables' ETH/USDG pool, read only) and testnet (clim's desk and
pools D, K, F) through their public RPC endpoints. Evidence and lab numbers are quoted from files committed to the
repository, each named where it is shown.

## The TOKEN2049 version

The dashboard clim showed at TOKEN2049 Origins (Ethereum Sepolia, with a wallet and test transactions) and its own
notices are kept at the tag `token2049-submission`:
[DVB-ANS/clim @ token2049-submission](https://github.com/DVB-ANS/clim/tree/token2049-submission).
```

- [ ] **Step 5: Run the test**

Run: `cd app && npx vitest run scripts/sync-data.test.ts`
Expected: `Tests  9 passed (9)`.

- [ ] **Step 6: Sync, then check**

Run: `cd app && npm run sync && npm run sync:check`
Expected: `25 files synced, 25 written`, then `25 files checked, 0 stale`. `ls src/generated` lists `fables-storm-2026-10-07.json fork-reports-2026-10-07.json fork-run-2026-10-07.json gas-robinhood-testnet.json integrate.json lab-framing.json live-check.json notices.ts outages.json security.json`.

- [ ] **Step 7: Commit**

```bash
git add app/scripts/sync-data.mjs app/scripts/sync-data.test.ts app/THIRD_PARTY_NOTICES.md app/src/vendor app/src/generated
git commit -m "feat(app): sync shared/, the level 1 reader, evidence, lab framing and docs tables into the app

npm run sync -- --check fails when a committed copy differs from its source. The outage snapshot comes from
bots/out/outages.json when it exists and is never checked."
```

### Task 4: Fables' brand files, kept out of git

**Files:**
- Create: `app/scripts/fables-assets.mjs`, `app/scripts/fables-assets.test.ts`
- Local only: `app/public/fables/` (gitignored in Task 2)

- [ ] **Step 1: Write the failing test `app/scripts/fables-assets.test.ts`**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyAssets, FABLES_ASSETS, KIT, missingAssets } from "./fables-assets.mjs";

function fakeKit() {
  const repo = mkdtempSync(join(tmpdir(), "kit-"));
  for (const [src] of FABLES_ASSETS) {
    const p = join(repo, KIT, src);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, src);
  }
  return repo;
}

describe("fables-assets", () => {
  it("copies every file the app references and then finds nothing missing", () => {
    const repoRoot = fakeKit();
    const appRoot = mkdtempSync(join(tmpdir(), "app-"));
    expect(missingAssets(appRoot)).toHaveLength(FABLES_ASSETS.length);
    expect(copyAssets({ repoRoot, appRoot })).toBe(FABLES_ASSETS.length);
    expect(missingAssets(appRoot)).toEqual([]);
  });
  it("refuses to run without the brand kit", () => {
    expect(() => copyAssets({ repoRoot: mkdtempSync(join(tmpdir(), "empty-")), appRoot: mkdtempSync(join(tmpdir(), "app-")) })).toThrow("missing in");
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run scripts/fables-assets.test.ts`
Expected: FAIL, `./fables-assets.mjs` cannot be loaded.

- [ ] **Step 3: Write `app/scripts/fables-assets.mjs`**

```js
// Fables' brand files the showcase uses (logo mark, fox-and-star logo, landing art, the USDG token mark, Louize and
// Inter). They belong to Fables and are not committed: public/fables/ is gitignored. This script copies them from the
// brand kit downloaded to .local/ (fables.fi/brand, 2026-10-13) before a local run or a deploy from the maintainer's
// machine; `--check` only verifies they are in place (run before `vercel deploy`).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KIT = ".local/research-2026-10-13/fables-brand";

/** [source in the kit, destination under public/fables/] */
export const FABLES_ASSETS = [
  ["assets/logo.svg", "logo.svg"],
  ["assets/fox_star_logo.svg", "fox_star_logo.svg"],
  ["assets/hero-bg.webp", "hero-bg.webp"],
  ["assets/illustrations_landing_unicorn-ledge.webp", "unicorn-ledge.webp"],
  ["assets/tokens_USDG.svg", "tokens_USDG.svg"],
  ["fonts/louize-display-medium.woff2", "fonts/louize-display-medium.woff2"],
  ["fonts/inter.woff2", "fonts/inter.woff2"],
];

export function missingAssets(appRoot) {
  return FABLES_ASSETS.map(([, dest]) => dest).filter((d) => !existsSync(join(appRoot, "public/fables", d)));
}

export function copyAssets({ repoRoot, appRoot }) {
  const kit = join(repoRoot, KIT);
  const absent = FABLES_ASSETS.filter(([src]) => !existsSync(join(kit, src))).map(([src]) => src);
  if (absent.length > 0) throw new Error(`missing in ${KIT}: ${absent.join(", ")}`);
  for (const [src, dest] of FABLES_ASSETS) {
    const to = join(appRoot, "public/fables", dest);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(kit, src), to);
  }
  return FABLES_ASSETS.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = process.env.CLIM_ROOT ? resolve(process.env.CLIM_ROOT) : dirname(appRoot);
  if (process.argv.includes("--check")) {
    const missing = missingAssets(appRoot);
    if (missing.length > 0) {
      console.error(`public/fables is missing ${missing.join(", ")}: run npm run fables-assets`);
      process.exit(1);
    }
    console.log(`public/fables: ${FABLES_ASSETS.length} files in place`);
  } else {
    console.log(`copied ${copyAssets({ repoRoot, appRoot })} files to public/fables`);
  }
}
```

- [ ] **Step 4: Run the test, copy the files, confirm git ignores them**

Run: `cd app && npx vitest run scripts/fables-assets.test.ts && npm run fables-assets && npm run fables-assets:check && git status --short public`
Expected: `Tests  2 passed (2)`, `copied 7 files to public/fables`, `public/fables: 7 files in place`, and no line from `git status` (the folder is ignored).

- [ ] **Step 5: Commit**

```bash
git add app/scripts/fables-assets.mjs app/scripts/fables-assets.test.ts
git commit -m "feat(app): copy Fables' brand files from the local kit into a gitignored public/fables"
```

### Task 5: Fables' tokens

**Files:**
- Create: `app/src/app/globals.css`

- [ ] **Step 1: Write `app/src/app/globals.css`**

Values from inventory §4 (colour, shadows, type, space, radius, motion) and §6 (gutters). Fonts load from `public/fables/fonts/`.

```css
/* Fables' tokens, from the measured inventory (docs/research/fables-ui-inventory.md §4). The names follow Fables' own
   CSS variable names; the values are re-typed from the measurements, no Fables stylesheet is copied. */

@font-face {
  font-family: "Louize";
  src: url("/fables/fonts/louize-display-medium.woff2") format("woff2");
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("/fables/fonts/inter.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Inter Fallback";
  src: local("Arial");
  size-adjust: 107.89%;
}

:root {
  color-scheme: dark;
  --canvas: #100f0f;
  --card: #1a1919;
  --surface: #1f1e1e;
  --raised: #2a2828;
  --raised-hover: #373434;
  --ink: #ffffff;
  --ink-secondary: #bcbbbb;
  --ink-muted: #8f8e8e;
  --ink-faint: #636161;
  --line-light: rgba(255, 255, 255, 0.06);
  --line: rgba(255, 255, 255, 0.08);
  --line-interactive: rgba(255, 255, 255, 0.12);
  --hover: rgba(255, 255, 255, 0.06);
  --chip-fill: rgba(255, 255, 255, 0.09);
  --skeleton: rgba(255, 255, 255, 0.12);
  --brand: #ccff00;
  --brand-fg: #201d1d;
  --positive: #66c399;
  --negative: #ff773d;
  --accent: #55a7fb;
  --focus-ring: rgba(85, 167, 251, 0.3);
  --session: #d2a022;
  --control-primary: #ffffff;
  --control-primary-hover: #ebe9e9;
  --claim-ground: #1e1e1b;

  --shadow-table: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-pill: 0 2px 8px rgba(0, 0, 0, 0.4);
  --shadow-button: 0 2px 6px rgba(0, 0, 0, 0.45);
  --shadow-menu: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 6px 32px rgba(0, 0, 0, 0.35);
  --shadow-menu-flat: 0 6px 32px rgba(0, 0, 0, 0.35);
  --shadow-control: 0 2px 4px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1);

  --font-display: "Louize", serif;
  --font-text: "Inter", "Inter Fallback", system-ui, sans-serif;

  --s0: 2px;
  --s1: 4px;
  --s1-5: 6px;
  --s2: 8px;
  --s2-5: 10px;
  --s3: 12px;
  --s4: 16px;
  --s4-5: 20px;
  --s5: 24px;
  --s5-5: 28px;
  --s6: 32px;
  --s7: 40px;
  --s8: 64px;

  --radius: 12px;
  --radius-compact: 4px;
  --radius-full: 9999px;
  --radius-highlight: 9px;

  --nav-h: 80px;
  --banner-h: 40px;
  --max-width: 1200px;
  --gutter: 80px;
  --row-gap: 8px;

  --dot-grid: radial-gradient(circle, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  --dot-grid-size: 20px 20px;

  --dur: 0.2s;
  --dur-fast: 0.15s;
  --dur-press: 0.1s;
  --ease-std: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-entrance: cubic-bezier(0.16, 1, 0.3, 1);
}

@media (max-width: 991px) {
  :root {
    --gutter: 32px;
  }
}
@media (max-width: 575px) {
  :root {
    --nav-h: 60px;
    --banner-h: 56px;
    --gutter: 16px;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}
html,
body {
  margin: 0;
  overflow-x: clip;
}
body {
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-text);
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
  letter-spacing: -0.22px;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "calt" off;
}
a {
  color: inherit;
  text-decoration: none;
}
button {
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
}
a,
button {
  transition: scale var(--dur-press) var(--ease-std);
}
a:active,
button:active {
  scale: 0.99;
}
:focus-visible {
  outline: 1px solid var(--accent);
  box-shadow: 0 0 0 2px var(--focus-ring);
  outline-offset: 0;
}
h1,
h2,
h3,
p {
  margin: 0;
}
code {
  font-family: var(--font-text);
}
.tabular {
  font-variant-numeric: lining-nums tabular-nums;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  a:active,
  button:active {
    scale: none;
  }
}
```

- [ ] **Step 2: Import it in the placeholder layout and build**

Add `import "./globals.css";` as the first line of `app/src/app/layout.tsx`, then run `cd app && npm run build`.
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/globals.css app/src/app/layout.tsx
git commit -m "feat(app): Fables' tokens, Louize and Inter, rebuilt from the measured inventory"
```

### Task 6: Formats

**Files:**
- Create: `app/src/lib/format.ts`, `app/src/lib/format.test.ts`

- [ ] **Step 1: Write the failing test `app/src/lib/format.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatAmount,
  formatAvgFeePct,
  formatDayTick,
  formatDuration,
  formatFeePct,
  formatGapPips,
  formatInt,
  formatPct2,
  formatPrice,
  formatSigmaE9,
  formatTooltipTime,
  formatUtcClock,
  formatUtcDateTime,
  shortAddress,
} from "./format";

describe("fees, as Fables shows them", () => {
  it("trims to significant digits", () => {
    expect(formatFeePct(700)).toBe("0.07%");
    expect(formatFeePct(5000)).toBe("0.5%");
    expect(formatFeePct(6000)).toBe("0.6%");
    expect(formatFeePct(1468)).toBe("0.1468%");
    expect(formatFeePct(100)).toBe("0.01%");
    expect(formatFeePct(0)).toBe("0%");
  });
  it("shows a missing fee as a dash", () => {
    expect(formatFeePct(null)).toBe("-");
    expect(formatFeePct(undefined)).toBe("-");
    expect(formatFeePct(Number.NaN)).toBe("-");
  });
  it("keeps 4 decimals on averages", () => {
    expect(formatAvgFeePct(1007)).toBe("0.1007%");
    expect(formatAvgFeePct(700)).toBe("0.0700%");
    expect(formatAvgFeePct(1007.4)).toBe("0.1007%");
  });
});

describe("numbers", () => {
  it("formats prices, amounts and integers with separators", () => {
    expect(formatPrice(2484.834)).toBe("2,484.83");
    expect(formatAmount(7388.254621)).toBe("7,388.25462");
    expect(formatAmount(0.00308)).toBe("0.00308");
    expect(formatInt(86285)).toBe("86,285");
    expect(formatPct2(1.1181)).toBe("111.81%");
  });
  it("annualises the desk's sigma", () => {
    // sigmaE9 = annual / sqrt(31,536,000) x 1e9: 0.4158 a year is 74,042.
    expect(formatSigmaE9(74_042)).toBe("41.58%");
    expect(formatSigmaE9(null)).toBe("-");
  });
  it("signs the venue gap", () => {
    expect(formatGapPips(158)).toBe("+0.0158%");
    expect(formatGapPips(-37)).toBe("-0.0037%");
    expect(formatGapPips(0)).toBe("0%");
  });
});

describe("time", () => {
  it("gives Fables' relative ages", () => {
    expect(formatAge(17)).toBe("17s");
    expect(formatAge(61)).toBe("1m");
    expect(formatAge(7300)).toBe("2h");
    expect(formatAge(200_000)).toBe("2d");
    expect(formatAge(-3)).toBe("0s");
  });
  it("spells durations", () => {
    expect(formatDuration(814)).toBe("13 min 34 s");
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(7500)).toBe("2 h 05 min");
  });
  it("labels axes and tooltips in UTC", () => {
    // 2026-10-12T03:23:00Z
    const t = Date.UTC(2026, 9, 12, 3, 23) / 1000;
    expect(formatDayTick(t)).toBe("Oct 12");
    expect(formatTooltipTime(t)).toBe("Oct 12, 3:23 AM UTC");
    expect(formatTooltipTime(Date.UTC(2026, 9, 12, 12, 5) / 1000)).toBe("Oct 12, 12:05 PM UTC");
    expect(formatUtcClock(1791968679)).toBe("09:04:39 UTC");
    expect(formatUtcDateTime(1791968679)).toBe("2026-10-14 09:04:39 UTC");
  });
});

it("shortens addresses Fables' way", () => {
  expect(shortAddress("0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551")).toBe("0xbac3...e551");
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run src/lib/format.test.ts`
Expected: FAIL, `./format` does not exist.

- [ ] **Step 3: Write `app/src/lib/format.ts`**

```ts
// Number, time and address formats, after Fables' own (docs/research/fables-ui-inventory.md §5): fees in percent never
// in bp, trimmed to significant digits; averages to 4 decimals; prices and amounts with thousands separators; "-" for
// a missing value. Times are UTC so every viewer reads the same text.
import { sigmaE9ToAnnual } from "@clim/shared";

export const MISSING = "-";

const trimZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** A fee in pips (1e-6) as Fables shows it: 700 -> "0.07%", 5000 -> "0.5%", 1468 -> "0.1468%". */
export function formatFeePct(pips: number | null | undefined): string {
  if (pips === null || pips === undefined || !Number.isFinite(pips)) return MISSING;
  return `${trimZeros((pips / 10_000).toFixed(4))}%`;
}

/** An average fee in pips with 4 decimals, as Fables' "0.1007% average over 7d". */
export function formatAvgFeePct(pips: number | null | undefined): string {
  if (pips === null || pips === undefined || !Number.isFinite(pips)) return MISSING;
  return `${(pips / 10_000).toFixed(4)}%`;
}

const twoDecimals = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A price in USDG per ETH: "2,484.83". */
export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return MISSING;
  return twoDecimals.format(n);
}

/** A token amount, up to `maxDecimals` decimals, separators kept: "7,388.25462". */
export function formatAmount(n: number, maxDecimals = 5): string {
  if (!Number.isFinite(n)) return MISSING;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxDecimals }).format(n);
}

/** An integer with separators: "86,285". */
export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return MISSING;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

/** A fraction as a percentage with 2 decimals: 1.1181 -> "111.81%". */
export function formatPct2(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return MISSING;
  return `${twoDecimals.format(fraction * 100)}%`;
}

/** The desk's sigma (per-sqrt-second x 1e9) as annualised volatility: "41.58%". */
export function formatSigmaE9(sigmaE9: number | null | undefined): string {
  if (sigmaE9 === null || sigmaE9 === undefined) return MISSING;
  return formatPct2(sigmaE9ToAnnual(sigmaE9));
}

/** The venue-minus-pool gap in pips of the pool price (1e-6) as a signed percentage: 158 -> "+0.0158%". */
export function formatGapPips(devPips: number | null | undefined): string {
  if (devPips === null || devPips === undefined || !Number.isFinite(devPips)) return MISSING;
  const sign = devPips > 0 ? "+" : devPips < 0 ? "-" : "";
  return `${sign}${trimZeros((Math.abs(devPips) / 10_000).toFixed(4))}%`;
}

/** A relative age, Fables' table style: "17s", "1m", "2h", "3d". */
export function formatAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return MISSING;
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** A duration in plain words: "13 min 34 s", "45 s", "2 h 05 min". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A chart axis label: "Oct 9" (UTC). */
export function formatDayTick(ts: number): string {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** An hour axis label: "14:00" (UTC). */
export function formatHourTick(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** A chart tooltip head: "Oct 12, 3:23 AM UTC". */
export function formatTooltipTime(ts: number): string {
  const d = new Date(ts * 1000);
  const h = d.getUTCHours();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} UTC`;
}

/** A clock time: "09:04:39 UTC". */
export function formatUtcClock(ts: number): string {
  return `${new Date(ts * 1000).toISOString().slice(11, 19)} UTC`;
}

/** A date and time: "2026-10-14 09:04:39 UTC". */
export function formatUtcDateTime(ts: number): string {
  const iso = new Date(ts * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** "0xbac3...e551". */
export function shortAddress(a: string): string {
  return a.length <= 12 ? a : `${a.slice(0, 6)}...${a.slice(-4)}`;
}
```

- [ ] **Step 4: Run it**

Run: `cd app && npx vitest run src/lib/format.test.ts`
Expected: `Tests  10 passed (10)`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/format.ts app/src/lib/format.test.ts
git commit -m "feat(app): Fables' formats for fees, prices, ages, axes and addresses"
```

### Task 7: The hook's fee rule

**Files:**
- Create: `app/src/lib/fees.ts`, `app/src/lib/fees.test.ts`

- [ ] **Step 1: Write the failing test `app/src/lib/fees.test.ts`**

The last `overrideSteps` case rebuilds the lab's published steps of 7 October 2026 (`lab/out/fables-storm-2026-10-07.json`, from Fables' mainnet logs) from its `pokes`.

```ts
import { describe, expect, it } from "vitest";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { climQuoteOf, climSteps, effectiveFee, feeAt, overrideSteps, peakAndLow, pokeCount, timeWeightedAverage, type ClimPoint, type PokeEvent } from "./fees";

const CFG = { floorPips: 100, flatPips: 700, capPips: 6000 };
const tx = "0xaa" as const;
const poke = (t: number, fee: number, ttl = 7200, logIndex = 0): PokeEvent => ({ kind: "poke", t, block: BigInt(t), logIndex, tx, fee0For1: fee, fee1For0: fee, expiry: t + ttl });

describe("effectiveFee, the hook's rule", () => {
  it("charges the flat fee with no override", () => expect(effectiveFee(CFG, null)).toBe(700));
  it("floors an override at max(floor, flat x 50 %)", () => {
    expect(effectiveFee(CFG, 200)).toBe(350);
    expect(effectiveFee({ ...CFG, floorPips: 400 }, 200)).toBe(400);
  });
  it("caps an override", () => expect(effectiveFee(CFG, 9000)).toBe(6000));
  it("passes an override inside the band", () => expect(effectiveFee(CFG, 1468)).toBe(1468));
});

describe("overrideSteps", () => {
  it("starts flat, steps at each poke and falls back at expiry", () => {
    const steps = overrideSteps([poke(100, 1500, 50), poke(300, 900, 50)], CFG, 0, 1000);
    expect(steps.map((s) => [s.t, s.fee0For1, s.overridden])).toEqual([
      [0, 700, false],
      [100, 1500, true],
      [150, 700, false],
      [300, 900, true],
      [350, 700, false],
    ]);
  });
  it("carries an override that is live at the window start", () => {
    const steps = overrideSteps([poke(-100, 2000, 500)], CFG, 0, 1000);
    expect(steps.map((s) => [s.t, s.fee0For1])).toEqual([[0, 2000], [400, 700]]);
  });
  it("ignores an override that expired before the window", () => {
    expect(overrideSteps([poke(-100, 2000, 50)], CFG, 0, 1000).map((s) => [s.t, s.fee0For1])).toEqual([[0, 700]]);
  });
  it("keeps one step per change, and the last log of a block wins", () => {
    const steps = overrideSteps([poke(100, 1500), poke(100, 1600, 7200, 1), poke(200, 1600)], CFG, 0, 1000);
    expect(steps.map((s) => [s.t, s.fee0For1])).toEqual([[0, 700], [100, 1600]]);
  });
  it("drops the override at a clear", () => {
    const events: PokeEvent[] = [poke(100, 1500), { kind: "clear", t: 200, block: 200n, logIndex: 0, tx }];
    expect(overrideSteps(events, CFG, 0, 1000).map((s) => [s.t, s.fee0For1])).toEqual([[0, 700], [100, 1500], [200, 700]]);
  });
  it("keeps the two directions of a per-direction poke apart", () => {
    const e: PokeEvent = { kind: "poke", t: 10, block: 10n, logIndex: 0, tx, fee0For1: 700, fee1For0: 897, expiry: 610 };
    const s = overrideSteps([e], CFG, 0, 100);
    expect(feeAt(s, 50, "0For1")).toBe(700);
    expect(feeAt(s, 50, "1For0")).toBe(897);
  });
  it("rebuilds the 7 October 2026 storm steps the lab published from Fables' own logs", () => {
    const events: PokeEvent[] = storm.pokes.map((p, i) => ({ kind: "poke", t: p.t, block: BigInt(p.t), logIndex: i, tx: p.tx as `0x${string}`, fee0For1: p.feePips, fee1For0: p.feePips, expiry: p.expiry }));
    const steps = overrideSteps(events, storm.config, storm.window.start, storm.window.end);
    expect(steps.map((s) => ({ t: s.t, feePips: s.fee0For1 }))).toEqual(storm.steps);
  });
});

describe("window statistics", () => {
  const steps = overrideSteps([poke(100, 1500, 100)], CFG, 0, 400);
  it("averages over time", () => {
    // 100 s at 700, 100 s at 1500, 200 s at 700 = (70,000 + 150,000 + 140,000) / 400
    expect(timeWeightedAverage(steps, 400, "0For1")).toBe(900);
  });
  it("finds the peak and the low", () => expect(peakAndLow(steps, "0For1")).toEqual({ peak: 1500, low: 700 }));
  it("counts the pokes inside the window", () => expect(pokeCount([poke(-5, 900), poke(100, 1500), poke(400, 900)], 0, 400)).toBe(2));
  it("reads the fee in force at a time", () => {
    expect(feeAt(steps, 150, "1For0")).toBe(1500);
    expect(feeAt(steps, 200, "1For0")).toBe(700);
    expect(feeAt(steps, -1, "1For0")).toBeNull();
  });
});

describe("clim's recommendation", () => {
  const pt = (t: number, seq: number, f01: number, f10: number): ClimPoint => ({ t, block: BigInt(t), logIndex: 0, seq, fee0For1: f01, fee1For0: f10, mode: 0, eventApplied: false, expiry: t + 600, tx });
  it("takes quote() as the lower side of quoteDirectional()", () => {
    expect(climQuoteOf({ fee0For1: 1368, fee1For0: 1652 })).toBe(1368);
  });
  it("starts the window from the last report before it", () => {
    const s = climSteps([pt(-10, 1, 700, 800), pt(30, 2, 900, 900), pt(500, 3, 1000, 1000)], 0, 100);
    expect(s.map((x) => [x.t, x.fee0For1, x.fee1For0])).toEqual([[0, 700, 800], [30, 900, 900]]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run src/lib/fees.test.ts`
Expected: FAIL, `./fees` does not exist.

- [ ] **Step 3: Write `app/src/lib/fees.ts`**

```ts
// The fee a Fables-style override hook charges, rebuilt from its FeePoked logs, and the statistics Fables' "Dynamic Fee"
// panel shows. The rule is the one the lab verified against every swap of Fables' ETH/USDG pool
// (lab/out/fables-compare.json, "rule"; it matched 1,820 of 1,820 swaps) and the one clim's PokeFeeHook implements
// (contracts/src/v2/PokeFeeHook.sol, currentFee): with no live override the pool charges its flat fee; while an
// override is live (expiry > block time) it charges max(override, floor, flat x 50 %), capped.

export type HookConfig = { floorPips: number; flatPips: number; capPips: number };

/** One FeePoked log (a single-fee hook sets both directions to the same fee) or a PokeCleared log. */
export type PokeEvent =
  | { kind: "poke"; t: number; block: bigint; logIndex: number; tx: `0x${string}`; fee0For1: number; fee1For0: number; expiry: number }
  | { kind: "clear"; t: number; block: bigint; logIndex: number; tx: `0x${string}` };

/** The fee from `t` until the next step. `tx` is the poke that set it (absent for the flat fee). */
export type FeeStep = { t: number; fee0For1: number; fee1For0: number; overridden: boolean; tx?: `0x${string}` };

export type Direction = "0For1" | "1For0";

/** Fables' and PokeFeeHook's MAX_POKE_DISCOUNT_BPS: an override never goes below half the flat fee. */
export const MAX_POKE_DISCOUNT_BPS = 5_000;

export function effectiveFee(cfg: HookConfig, poked: number | null): number {
  if (poked === null) return Math.min(cfg.flatPips, cfg.capPips);
  const pokeFloor = Math.max(cfg.floorPips, Math.floor((cfg.flatPips * (10_000 - MAX_POKE_DISCOUNT_BPS)) / 10_000));
  return Math.min(Math.max(poked, pokeFloor), cfg.capPips);
}

const byChainOrder = (a: PokeEvent, b: PokeEvent) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1);

/** The step series of the fee over [from, to]: one step at `from`, then one at each poke, clear or expiry that changes
 *  the fee. Events before `from` set the state at `from` (pass the last override that may still be live). */
export function overrideSteps(events: readonly PokeEvent[], cfg: HookConfig, from: number, to: number): FeeStep[] {
  const sorted = [...events].sort(byChainOrder);
  type Live = { fee0For1: number; fee1For0: number; expiry: number; tx: `0x${string}` };
  let live: Live | null = null;
  const steps: FeeStep[] = [];
  const push = (t: number, l: Live | null) => {
    const step: FeeStep = l
      ? { t, fee0For1: effectiveFee(cfg, l.fee0For1), fee1For0: effectiveFee(cfg, l.fee1For0), overridden: true, tx: l.tx }
      : { t, fee0For1: effectiveFee(cfg, null), fee1For0: effectiveFee(cfg, null), overridden: false };
    const last = steps[steps.length - 1];
    if (last && last.t === t) steps[steps.length - 1] = step;
    else if (!last || last.fee0For1 !== step.fee0For1 || last.fee1For0 !== step.fee1For0 || last.overridden !== step.overridden) steps.push(step);
  };
  const apply = (e: PokeEvent) => {
    live = e.kind === "clear" || e.expiry <= e.t ? null : { fee0For1: e.fee0For1, fee1For0: e.fee1For0, expiry: e.expiry, tx: e.tx };
  };
  let i = 0;
  for (; i < sorted.length && (sorted[i] as PokeEvent).t <= from; i++) apply(sorted[i] as PokeEvent);
  const atFrom = live as Live | null;
  push(from, atFrom && atFrom.expiry > from ? atFrom : null);
  if (atFrom && atFrom.expiry <= from) live = null;
  for (; i < sorted.length && (sorted[i] as PokeEvent).t <= to; i++) {
    const e = sorted[i] as PokeEvent;
    const cur = live as Live | null;
    if (cur && cur.expiry <= e.t) {
      push(cur.expiry, null);
      live = null;
    }
    apply(e);
    push(e.t, live);
  }
  const end = live as Live | null;
  if (end && end.expiry <= to) push(end.expiry, null);
  return steps;
}

const pick = (s: FeeStep, d: Direction) => (d === "0For1" ? s.fee0For1 : s.fee1For0);

/** The fee in force at `t` (the last step at or before `t`), or null before the first step. */
export function feeAt(steps: readonly FeeStep[], t: number, d: Direction): number | null {
  let v: number | null = null;
  for (const s of steps) {
    if (s.t > t) break;
    v = pick(s, d);
  }
  return v;
}

/** Time-weighted average fee over [steps[0].t, to], in pips. */
export function timeWeightedAverage(steps: readonly FeeStep[], to: number, d: Direction): number | null {
  const first = steps[0];
  if (!first || to <= first.t) return null;
  let acc = 0;
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k] as FeeStep;
    const end = Math.min(to, (steps[k + 1] as FeeStep | undefined)?.t ?? to);
    if (end > s.t) acc += pick(s, d) * (end - s.t);
  }
  return acc / (to - first.t);
}

/** Highest and lowest fee in force over the steps' span. */
export function peakAndLow(steps: readonly FeeStep[], d: Direction): { peak: number; low: number } | null {
  if (steps.length === 0) return null;
  const v = steps.map((s) => pick(s, d));
  return { peak: Math.max(...v), low: Math.min(...v) };
}

/** Pokes logged in (from, to]: Fables' "Changes" (how many times the keeper moved the fee in the window). */
export function pokeCount(events: readonly PokeEvent[], from: number, to: number): number {
  return events.filter((e) => e.kind === "poke" && e.t > from && e.t <= to).length;
}

/** clim's recommendation at one report: ClimPoker's Poked log carries quoteDirectional() per side (max'ed with a live
 *  event when eventApplied). quote() is the lower side: quoteDirectional() adds its premium to one side only
 *  (contracts/src/v2/ClimFeePolicy.sol). */
export type ClimPoint = {
  /** The report's observation time (tObs). */
  t: number;
  block: bigint;
  logIndex: number;
  seq: number;
  fee0For1: number;
  fee1For0: number;
  mode: number;
  eventApplied: boolean;
  expiry: number;
  tx: `0x${string}`;
};

export function climQuoteOf(p: Pick<ClimPoint, "fee0For1" | "fee1For0">): number {
  return Math.min(p.fee0For1, p.fee1For0);
}

/** clim's points as steps over [from, to] (the last point before `from`, if given, sets the first step). */
export function climSteps(points: readonly ClimPoint[], from: number, to: number): FeeStep[] {
  const sorted = [...points].sort((a, b) => a.t - b.t || a.seq - b.seq);
  const steps: FeeStep[] = [];
  let before: ClimPoint | null = null;
  for (const p of sorted) {
    if (p.t <= from) before = p;
    else if (p.t <= to) steps.push({ t: p.t, fee0For1: p.fee0For1, fee1For0: p.fee1For0, overridden: true, tx: p.tx });
  }
  if (before) steps.unshift({ t: from, fee0For1: before.fee0For1, fee1For0: before.fee1For0, overridden: true, tx: before.tx });
  return steps;
}
```

- [ ] **Step 4: Run it**

Run: `cd app && npx vitest run src/lib/fees.test.ts`
Expected: `Tests  17 passed (17)`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fees.ts app/src/lib/fees.test.ts
git commit -m "feat(app): the override hook's fee rule, step series and window statistics

It rebuilds the lab's 7 October 2026 steps of Fables' ETH/USDG pool exactly from the keeper's pokes."
```

### Task 8: Badges, fee sources, live key texts

**Files:**
- Create: `app/src/lib/tiers.ts`, `app/src/lib/tiers.test.ts`, `app/src/lib/liveKeys.ts`, `app/src/lib/liveKeys.test.ts`

- [ ] **Step 1: Write the failing tests**

`app/src/lib/tiers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deskBadge, FEE_SOURCE, feeTier, feeTooltip, modeLabel } from "./tiers";

describe("feeTier", () => {
  it("marks a fee above the flat fee as Elevated", () => expect(feeTier(5000, 700)).toEqual({ label: "Elevated", tone: "elevated" }));
  it("shows no badge at the flat fee or below", () => {
    expect(feeTier(700, 700)).toBeNull();
    expect(feeTier(350, 700)).toBeNull();
    expect(feeTier(null, 700)).toBeNull();
  });
});

describe("feeTooltip", () => {
  it("explains an override", () => expect(feeTooltip(5000, 5000, 700)).toMatch(/raised above its schedule/));
  it("explains the resting fee", () => expect(feeTooltip(700, 700, 700)).toBe("The fee this market charges on every swap right now"));
  it("explains two directions", () => expect(feeTooltip(700, 897, 700)).toMatch(/two directions cost different amounts/));
});

describe("deskBadge", () => {
  it("is live while fresh and normal", () => expect(deskBadge(0, 20, 180)).toEqual({ label: "clim: live", tone: "open" }));
  it("is degraded when venues disagree", () => expect(deskBadge(1, 20, 180).label).toBe("clim: degraded"));
  it("is blind past tauKillSec even before the policy says so", () => expect(deskBadge(0, 181, 180).label).toBe("clim: blind"));
  it("is blind when the policy says so", () => expect(deskBadge(2, 0, 180).label).toBe("clim: blind"));
});

it("names every market's fee source, and every clim-side source says testnet", () => {
  expect(Object.keys(FEE_SOURCE)).toEqual(["fables", "D", "K", "F"]);
  expect(FEE_SOURCE.fables.note).toMatch(/mainnet, read only/);
  for (const k of ["D", "K", "F"] as const) expect(FEE_SOURCE[k].note).toMatch(/testnet/);
});

it("labels the policy's modes", () => {
  expect([modeLabel("normal"), modeLabel("degraded"), modeLabel("blind")]).toEqual(["Normal", "Degraded", "Blind"]);
});
```

`app/src/lib/liveKeys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { liveText } from "./liveKeys";

describe("liveText", () => {
  it("formats each kind of key", () => {
    expect(liveText("fables:fee0For1", "3303")).toBe("0.3303%");
    expect(liveText("pool:D:peak", "6000")).toBe("0.6%");
    expect(liveText("clim:quote", "1368")).toBe("0.1368%");
    expect(liveText("fables:avg", "1027.1256712962963")).toBe("0.1027%");
    expect(liveText("fables:price", "3939955770818462841585330")).toBe("2,473.00");
    expect(liveText("pool:D:swaps", "1070")).toBe("1,070");
    expect(liveText("clim:seq", "563")).toBe("563");
    expect(liveText("clim:mode", "normal")).toBe("Normal");
    expect(liveText("clim:tObs", "1791985251")).toBe("13:40:51 UTC");
    expect(liveText("desk:sigma5", "105778")).toBe("59.40%");
    expect(liveText("desk:dev", "-1800")).toBe("-0.18%");
    expect(liveText("roles:poker", "true")).toBe("yes");
  });
  it("refuses a key it does not know", () => expect(() => liveText("fables:tvl", "1")).toThrow("unknown live key"));
});
```

- [ ] **Step 2: Run them**

Run: `cd app && npx vitest run src/lib/tiers.test.ts src/lib/liveKeys.test.ts`
Expected: FAIL, `./tiers` and `./liveKeys` do not exist.

- [ ] **Step 3: Write `app/src/lib/tiers.ts`**

```ts
// Fables' tier badge (docs/research/fables-ui-inventory.md §3.10): a 6 px dot by tier. clim reuses the badge for the
// fee's source and for the desk's state; every clim badge says "clim" or names the testnet in its label.

export type Tone = "open" | "overnight" | "faint" | "elevated" | "brand";

export const TONE_COLOR: Record<Tone, string> = {
  open: "var(--positive)",
  overnight: "var(--session)",
  faint: "var(--ink-faint)",
  elevated: "var(--accent)",
  brand: "var(--brand)",
};

export type Badge = { label: string; tone: Tone };

/** "Elevated" when the fee is above the pool's resting (flat) fee, as Fables marks a keeper override; none otherwise. */
export function feeTier(feePips: number | null, flatPips: number): Badge | null {
  return feePips !== null && feePips > flatPips ? { label: "Elevated", tone: "elevated" } : null;
}

/** Fables' "Current fee" tooltips, by state. */
export function feeTooltip(fee0For1: number | null, fee1For0: number | null, flatPips: number): string {
  if (fee0For1 !== null && fee1For0 !== null && fee0For1 !== fee1For0) {
    return "The fee this market charges right now; the two directions cost different amounts.";
  }
  return feeTier(fee0For1, flatPips)
    ? "The fee this market is charging right now, raised above its schedule to protect liquidity providers."
    : "The fee this market charges on every swap right now";
}

export const MODE_LABEL: Record<number, string> = { 0: "Normal", 1: "Degraded", 2: "Blind" };

/** ClimFeePolicy's mode as the level 1 reader names it (normal, degraded, blind) and as the contract numbers it. */
export const MODE_NUMBER = { normal: 0, degraded: 1, blind: 2 } as const;
export const modeLabel = (mode: keyof typeof MODE_NUMBER) => MODE_LABEL[MODE_NUMBER[mode]] as string;

/** The desk's state: blind once it has been silent for more than tauKillSec (ClimPoker then refuses to poke and a
 *  keeper reading clim ignores it), degraded when the venues disagree, live otherwise. */
export function deskBadge(mode: number, ageSec: number, tauKillSec: number): Badge {
  if (mode === 2 || ageSec > tauKillSec) return { label: "clim: blind", tone: "faint" };
  if (mode === 1) return { label: "clim: degraded", tone: "overnight" };
  return { label: "clim: live", tone: "open" };
}

export type FeeSource = "fables" | "D" | "K" | "F";

/** Who sets each market's fee (the markets list's "Fee source" column). */
export const FEE_SOURCE: Record<FeeSource, Badge & { note: string }> = {
  fables: { label: "Fables keeper", tone: "elevated", note: "Fables' own keeper posts overrides through pokeFee (mainnet, read only)" },
  D: { label: "clim", tone: "brand", note: "ClimPoker pokes clim's policy after every desk report (testnet)" },
  K: { label: "Keeper-style", tone: "overnight", note: "a bot imitating the pattern observed on Fables' pool, not Fables' code (testnet)" },
  F: { label: "Flat", tone: "faint", note: "no override: the hook's flat fee (testnet)" },
};
```

- [ ] **Step 4: Write `app/src/lib/liveKeys.ts`**

```ts
// The text each live key is shown with, from its raw on-chain value. The live check (e2e/live.spec.ts) re-reads the raw
// value at the element's block and expects exactly this text in the element.
import { ethUsdFromSqrtPriceX96 } from "@clim/shared";
import { formatAvgFeePct, formatFeePct, formatGapPips, formatInt, formatPrice, formatSigmaE9, formatUtcClock } from "./format";
import { modeLabel, MODE_NUMBER } from "./tiers";

const ETH_FIRST_18_6 = { token0IsEth: true, decimals0: 18, decimals1: 6 } as const;

export function liveText(key: string, raw: string): string {
  if (/:(fee0For1|fee1For0|peak|low)$/.test(key) || key === "clim:quote") return formatFeePct(Number(raw));
  if (/:(avg|meanSwapFee)$/.test(key)) return formatAvgFeePct(Number(raw));
  if (/:price$/.test(key)) return formatPrice(ethUsdFromSqrtPriceX96(BigInt(raw), ETH_FIRST_18_6));
  if (/:(changes|swaps)$/.test(key) || key === "clim:seq") return formatInt(Number(raw));
  if (key === "clim:mode") return modeLabel(raw as keyof typeof MODE_NUMBER);
  if (key === "clim:tObs") return formatUtcClock(Number(raw));
  if (key === "desk:sigma5") return formatSigmaE9(Number(raw));
  if (key === "desk:dev") return formatGapPips(Number(raw));
  if (key.startsWith("roles:")) return raw === "true" ? "yes" : "no";
  throw new Error(`unknown live key ${key}`);
}
```

- [ ] **Step 5: Run them**

Run: `cd app && npx vitest run src/lib/tiers.test.ts src/lib/liveKeys.test.ts`
Expected: `Tests  13 passed (13)`.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/tiers.ts app/src/lib/tiers.test.ts app/src/lib/liveKeys.ts app/src/lib/liveKeys.test.ts
git commit -m "feat(app): Fables' tier badge logic, each market's fee source, the desk's state and live key texts"
```

### Task 9: Lag, retries, log ranges and block times

**Files:**
- Create: `app/src/lib/chain/retry.ts`, `app/src/lib/chain/retry.test.ts`, `app/src/lib/chain/logs.ts`, `app/src/lib/chain/logs.test.ts`, `app/src/lib/chain/blockTimes.ts`, `app/src/lib/chain/blockTimes.test.ts`, `app/src/test/fakeRpc.ts`

- [ ] **Step 1: Write the test helper `app/src/test/fakeRpc.ts`**

```ts
// A JSON-RPC endpoint in memory, for the read functions' tests: eth_blockNumber, eth_getBlockByNumber, eth_call (by
// exact calldata) and eth_getLogs (by address, block range and topic0). Unknown calls throw, so a test sees every
// request the code makes.
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  numberToHex,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export type FakeLog = { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; logIndex: number; transactionHash: Hex; blockTimestamp: bigint };

export function fakeLog(event: AbiEvent, args: Record<string, unknown>, meta: { address: Address; blockNumber: bigint; logIndex?: number; tx?: Hex; t: number }): FakeLog {
  const topics = encodeEventTopics({ abi: [event], eventName: event.name, args } as never) as Hex[];
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name as string]));
  return { address: meta.address, topics, data, blockNumber: meta.blockNumber, logIndex: meta.logIndex ?? 0, transactionHash: meta.tx ?? `0x${"ab".repeat(32)}`, blockTimestamp: BigInt(meta.t) };
}

export class FakeRpc {
  head = 1000n;
  blockTime = (n: bigint) => Number(n) * 0.1;
  calls = new Map<string, Hex>();
  logs: FakeLog[] = [];
  requests: Array<{ method: string; params: unknown[] }> = [];
  getLogsRanges: Array<[bigint, bigint]> = [];

  onCall<const A extends Abi>(address: Address, abi: A, functionName: string, args: readonly unknown[], result: unknown) {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    this.calls.set(`${address.toLowerCase()}:${data}`, encodeFunctionResult({ abi, functionName, result } as never));
  }

  async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    const p = (params ?? []) as never[];
    this.requests.push({ method, params: p });
    switch (method) {
      case "eth_chainId":
        return "0x1";
      case "eth_blockNumber":
        return numberToHex(this.head);
      case "eth_getBlockByNumber": {
        const n = BigInt(p[0] as string);
        return block(n, this.blockTime(n));
      }
      case "eth_call": {
        const { to, data } = p[0] as { to: Address; data: Hex };
        const r = this.calls.get(`${to.toLowerCase()}:${data}`);
        if (r === undefined) throw new Error(`unexpected eth_call to ${to} ${data.slice(0, 10)}`);
        return r;
      }
      case "eth_getLogs": {
        const f = p[0] as { address: Address; fromBlock: Hex; toBlock: Hex; topics?: Array<Hex | Hex[] | null> };
        const from = BigInt(f.fromBlock);
        const to = BigInt(f.toBlock);
        this.getLogsRanges.push([from, to]);
        const t0 = f.topics?.[0];
        const t0s = t0 === undefined || t0 === null ? null : Array.isArray(t0) ? t0 : [t0];
        const t1 = f.topics?.[1] ?? null;
        return this.logs
          .filter((l) => l.address.toLowerCase() === f.address.toLowerCase() && l.blockNumber >= from && l.blockNumber <= to)
          .filter((l) => t0s === null || t0s.includes(l.topics[0] as Hex))
          .filter((l) => t1 === null || (Array.isArray(t1) ? t1 : [t1]).includes(l.topics[1] as Hex))
          .map((l) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            blockNumber: numberToHex(l.blockNumber),
            blockHash: `0x${"11".repeat(32)}`,
            blockTimestamp: numberToHex(l.blockTimestamp),
            logIndex: numberToHex(l.logIndex),
            transactionHash: l.transactionHash,
            transactionIndex: "0x0",
            removed: false,
          }));
      }
      default:
        throw new Error(`unexpected ${method}`);
    }
  }

  client(): PublicClient {
    return createPublicClient({ transport: custom({ request: (a) => this.request(a) }) }) as PublicClient;
  }
}

function block(n: bigint, t: number) {
  return {
    number: numberToHex(n),
    hash: `0x${n.toString(16).padStart(64, "0")}`,
    parentHash: `0x${"00".repeat(32)}`,
    timestamp: numberToHex(BigInt(Math.floor(t))),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    gasLimit: "0x0",
    gasUsed: "0x0",
    miner: `0x${"00".repeat(20)}`,
    extraData: "0x",
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: `0x${"00".repeat(32)}`,
    stateRoot: `0x${"00".repeat(32)}`,
    receiptsRoot: `0x${"00".repeat(32)}`,
    sha3Uncles: `0x${"00".repeat(32)}`,
    size: "0x0",
    totalDifficulty: "0x0",
    transactions: [],
    uncles: [],
  };
}
```

- [ ] **Step 2: Write the failing tests**

`app/src/lib/chain/retry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { laggedHead, withRetry } from "./retry";

const noSleep = async () => {};

describe("laggedHead", () => {
  it("reads three blocks behind the head", () => expect(laggedHead(100n)).toBe(97n));
  it("never goes below zero", () => expect(laggedHead(2n)).toBe(0n));
});

describe("withRetry", () => {
  it("returns the first success", async () => {
    let n = 0;
    await expect(withRetry(async () => ++n, { sleep: noSleep })).resolves.toBe(1);
  });
  it("retries a failing read, then succeeds", async () => {
    let n = 0;
    const v = await withRetry(async () => {
      if (++n < 3) throw new Error("BlockNotFoundError");
      return "ok";
    }, { sleep: noSleep });
    expect([v, n]).toEqual(["ok", 3]);
  });
  it("throws the last error after every retry", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error(`fail ${n}`); }, { sleep: noSleep })).rejects.toThrow("fail 4");
  });
  it("stops at once when shouldRetry refuses", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error("revert"); }, { sleep: noSleep, shouldRetry: () => false })).rejects.toThrow("revert");
    expect(n).toBe(1);
  });
});
```

`app/src/lib/chain/logs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockAtOrBefore, blockRanges, getLogsChunked } from "./logs";

describe("blockRanges", () => {
  it("splits a span into chunks", () => {
    expect(blockRanges(0n, 25n, 10n)).toEqual([[0n, 9n], [10n, 19n], [20n, 25n]]);
  });
  it("returns one range when the span fits", () => expect(blockRanges(5n, 7n, 10n)).toEqual([[5n, 7n]]));
  it("returns nothing for an empty span", () => expect(blockRanges(8n, 7n, 10n)).toEqual([]));
  it("stays under the RPCs' 10,000,000-block cap by default", () => {
    for (const [a, b] of blockRanges(0n, 23_000_000n)) expect(b - a + 1n <= 10_000_000n).toBe(true);
  });
});

it("concatenates the ranges in order", async () => {
  const calls: Array<[bigint, bigint]> = [];
  const logs = await getLogsChunked(async (a, b) => { calls.push([a, b]); return [Number(a)]; }, 0n, 25n, 10n);
  expect(calls).toEqual([[0n, 9n], [10n, 19n], [20n, 25n]]);
  expect(logs).toEqual([0, 10, 20]);
});

it("steps back far enough in time", () => {
  // 600 s at no less than 0.09 s a block is at most 6,667 blocks.
  expect(blockAtOrBefore(10_000n, 1_000, 400, 0.09)).toBe(3_333n);
  expect(blockAtOrBefore(100n, 1_000, 0, 0.09)).toBe(0n);
});
```

`app/src/lib/chain/blockTimes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeRpc } from "@/test/fakeRpc";
import { blockTimes, firstBlockAtOrAfter } from "./blockTimes";

describe("blockTimes", () => {
  it("reads each block once, in batches of 50", async () => {
    const rpc = new FakeRpc();
    const client = rpc.client();
    const blocks = Array.from({ length: 120 }, (_, i) => BigInt(i));
    const m = await blockTimes(client, [...blocks, 5n]);
    expect(m.get(50n)).toBe(5);
    await blockTimes(client, blocks);
    expect(rpc.requests.filter((r) => r.method === "eth_getBlockByNumber")).toHaveLength(120);
  });
});

describe("firstBlockAtOrAfter", () => {
  it("finds the first block at or after a time with regular blocks", async () => {
    const rpc = new FakeRpc();
    rpc.blockTime = (n) => Number(n) * 0.1;
    const b = await firstBlockAtOrAfter(rpc.client(), 5_000, 1_000_000n, 100_000, 0.09);
    expect(b).toBe(50_000n);
    expect(rpc.requests.length).toBeLessThan(40);
  });
  it("finds it with irregular blocks and a too-short first guess", async () => {
    const rpc = new FakeRpc();
    // 0.05 s blocks before block 500,000, 0.2 s after: the first guess (0.09 s) lands after the target.
    rpc.blockTime = (n) => (n < 500_000n ? Number(n) * 0.05 : 25_000 + Number(n - 500_000n) * 0.2);
    const target = 20_000;
    const b = await firstBlockAtOrAfter(rpc.client(), target, 1_000_000n, rpc.blockTime(1_000_000n), 0.09);
    expect(Math.floor(rpc.blockTime(b))).toBeGreaterThanOrEqual(target);
    expect(Math.floor(rpc.blockTime(b - 1n))).toBeLessThan(target);
  });
  it("returns the block after hi when hi is still before the target", async () => {
    const rpc = new FakeRpc();
    expect(await firstBlockAtOrAfter(rpc.client(), 500, 100n, 10, 0.09)).toBe(101n);
  });
});
```

- [ ] **Step 3: Run them**

Run: `cd app && npx vitest run src/lib/chain`
Expected: FAIL, `./retry`, `./logs` and `./blockTimes` do not exist.

- [ ] **Step 4: Write `app/src/lib/chain/retry.ts`**

```ts
// Ported from bots/src/live/lib/retry.ts (the live scripts' fix of 2026-10-14). The public RPCs of Robinhood Chain are
// load-balanced and some nodes lag the head by a few blocks, so a read pinned to the head block can fail on a node that
// has not seen it yet. The app reads a few blocks behind the head and retries a failed read.

/** Blocks behind the head the app reads at (0.3 s of chain at 0.1 s blocks). */
export const HEAD_LAG_BLOCKS = 3n;
export const READ_RETRIES = 3;
export const READ_RETRY_DELAY_MS = 1_000;

export function laggedHead(head: bigint, lag: bigint = HEAD_LAG_BLOCKS): bigint {
  return head > lag ? head - lag : 0n;
}

export type RetryOptions = {
  retries?: number;
  delayMs?: number;
  shouldRetry?: (e: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

/** `fn()`, tried again up to `retries` times, `delayMs` apart; the last error is thrown when every try failed. */
export async function withRetry<T>(fn: () => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const retries = o.retries ?? READ_RETRIES;
  const delayMs = o.delayMs ?? READ_RETRY_DELAY_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || (o.shouldRetry !== undefined && !o.shouldRetry(e))) throw e;
      await sleep(delayMs);
    }
  }
}
```

- [ ] **Step 5: Write `app/src/lib/chain/logs.ts`**

```ts
import { LOG_CHUNK_BLOCKS } from "@/lib/rpc";

/** [from, to] split into consecutive ranges of at most `chunk` blocks (the public RPCs cap eth_getLogs at 10M). */
export function blockRanges(from: bigint, to: bigint, chunk: bigint = LOG_CHUNK_BLOCKS): Array<[bigint, bigint]> {
  if (to < from) return [];
  const out: Array<[bigint, bigint]> = [];
  for (let a = from; a <= to; a += chunk) out.push([a, a + chunk - 1n < to ? a + chunk - 1n : to]);
  return out;
}

/** Logs of [from, to], fetched range by range, in chain order. */
export async function getLogsChunked<T>(fetchRange: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, chunk?: bigint): Promise<T[]> {
  const out: T[] = [];
  for (const [a, b] of blockRanges(from, to, chunk)) out.push(...(await fetchRange(a, b)));
  return out;
}

/** A block at or before time `t`, from the head and a lower bound on the block time: blocks are at least
 *  `minBlockSec` apart, so stepping back (headTs - t) / minBlockSec blocks lands at or before `t`. Callers filter the
 *  logs by their own timestamp. */
export function blockAtOrBefore(head: bigint, headTs: number, t: number, minBlockSec: number): bigint {
  const back = BigInt(Math.ceil(Math.max(0, headTs - t) / minBlockSec));
  return head > back ? head - back : 0n;
}
```

- [ ] **Step 6: Write `app/src/lib/chain/blockTimes.ts`**

```ts
// Block timestamps. The public RPCs return logs with blockTimestamp "0x0" (checked 2026-10-14 on both chains), so a
// log's time is its block header's timestamp, read with eth_getBlockByNumber. Headers are cached and read in batches of
// at most 50: a JSON-RPC batch of 200 got HTTP 429 from the public endpoints, 100 went through.
import type { PublicClient } from "viem";
import { withRetry } from "./retry";

export const HEADER_BATCH = 50;

const caches = new WeakMap<PublicClient, Map<bigint, number>>();
const cacheOf = (c: PublicClient) => {
  let m = caches.get(c);
  if (!m) caches.set(c, (m = new Map()));
  return m;
};

export async function blockTime(client: PublicClient, n: bigint): Promise<number> {
  const cache = cacheOf(client);
  const hit = cache.get(n);
  if (hit !== undefined) return hit;
  const t = Number((await withRetry(() => client.getBlock({ blockNumber: n }))).timestamp);
  cache.set(n, t);
  return t;
}

/** Timestamps of `blocks`, `HEADER_BATCH` headers at a time. */
export async function blockTimes(client: PublicClient, blocks: readonly bigint[]): Promise<Map<bigint, number>> {
  const cache = cacheOf(client);
  const missing = [...new Set(blocks)].filter((b) => !cache.has(b));
  for (let i = 0; i < missing.length; i += HEADER_BATCH) {
    await Promise.all(missing.slice(i, i + HEADER_BATCH).map((b) => blockTime(client, b)));
  }
  return new Map(blocks.map((b) => [b, cache.get(b) as number]));
}

/** The first block whose timestamp is at or after `target`, searched below `hi` (whose timestamp `hiTs` is at or after
 *  it): interpolation steps, with a bisection every other step so the search always ends (about 6 to 12 headers). */
export async function firstBlockAtOrAfter(client: PublicClient, target: number, hi: bigint, hiTs: number, minBlockSec: number): Promise<bigint> {
  if (hiTs < target) return hi + 1n;
  let back = BigInt(Math.ceil(Math.max(1, hiTs - target) / minBlockSec));
  let lo = hi > back ? hi - back : 0n;
  let loTs = await blockTime(client, lo);
  while (loTs >= target && lo > 0n) {
    back *= 2n;
    lo = hi > back ? hi - back : 0n;
    loTs = await blockTime(client, lo);
  }
  if (loTs >= target) return lo;
  let step = 0;
  while (hi - lo > 1n) {
    const span = hi - lo;
    let mid: bigint;
    if (step++ % 2 === 0 && hiTs > loTs) {
      const frac = (target - loTs) / (hiTs - loTs);
      mid = lo + BigInt(Math.floor(Number(span) * frac));
    } else {
      mid = lo + span / 2n;
    }
    if (mid <= lo) mid = lo + 1n;
    if (mid >= hi) mid = hi - 1n;
    const t = await blockTime(client, mid);
    if (t >= target) {
      hi = mid;
      hiTs = t;
    } else {
      lo = mid;
      loTs = t;
    }
  }
  return hi;
}
```

- [ ] **Step 7: Run them**

Run: `cd app && npx vitest run src/lib/chain`
Expected: `Test Files  3 passed (3)`, `Tests  16 passed (16)`.

- [ ] **Step 8: Commit**

```bash
git add app/src/test/fakeRpc.ts app/src/lib/chain/retry.ts app/src/lib/chain/retry.test.ts app/src/lib/chain/logs.ts app/src/lib/chain/logs.test.ts app/src/lib/chain/blockTimes.ts app/src/lib/chain/blockTimes.test.ts
git commit -m "feat(app): reads behind the head with retries, log ranges under the RPC cap, exact window starts from block headers

The public RPCs return logs with blockTimestamp 0x0, so times come from headers, 50 per batch."
```

### Task 10: Fables' pool, clim's stack, typed events

**Files:**
- Create: `app/src/lib/chain/fables.ts`, `fables.test.ts`, `deployments.ts`, `deployments.test.ts`, `events.ts`, `events.test.ts` (all under `app/src/lib/chain/`)

- [ ] **Step 1: Write the failing tests**

`app/src/lib/chain/fables.test.ts`:

```ts
import { poolIdFromKey } from "@clim/shared";
import { describe, expect, it } from "vitest";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { FABLES } from "./fables";

describe("Fables' ETH/USDG constants", () => {
  it("match the lab's committed record of the pool", () => {
    expect(FABLES.poolId).toBe(storm.poolId);
    expect(FABLES.hook.toLowerCase()).toBe(storm.hook);
    expect(FABLES.keeper.toLowerCase()).toBe(storm.keepers[0]);
    expect(FABLES.config).toEqual(storm.config);
    expect(FABLES.pokeTtlSec).toBe(storm.pokeTtlSec);
    expect(FABLES.chainId).toBe(storm.chainId);
  });
  it("hash to the pool id (ETH native as currency0, USDG, dynamic fee, tick spacing 10, the hook)", () => {
    expect(poolIdFromKey(FABLES.key)).toBe(FABLES.poolId);
  });
});
```

`app/src/lib/chain/deployments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FABLES } from "./fables";
import { LIVE, orientationOf } from "./deployments";

describe("the testnet stack", () => {
  it("parses with the addresses the README publishes", () => {
    expect(LIVE.chainId).toBe(46630);
    expect(LIVE.riskDesk).toBe("0x63f543430982685387C83e4ec55E5a26fd1371Ef");
    expect(LIVE.policy).toBe("0x5f140A5e17826CFcEeeD7cD3FcAe4D56c9e0C519");
    expect(LIVE.poker).toBe("0x99d6c4F74A2ad09471b1B4fd1F0aC68B099cbE07");
    expect(LIVE.hook).toBe("0xBb4afdfd08921e0731199e565eC11724B09b9080");
    expect(LIVE.hookConfig).toEqual(FABLES.config);
  });
  it("orients D, K and F like Fables' pool: ETH as token0, 18 and 6 decimals", () => {
    for (const p of ["D", "K", "F"] as const) expect(orientationOf(p)).toEqual({ token0IsEth: true, decimals0: 18, decimals1: 6 });
  });
});
```

`app/src/lib/chain/events.test.ts`:

```ts
import { climPokerAbi, pokeFeeHookAbi, poolManagerSwapEventAbi, riskDeskV2Abi } from "@clim/shared";
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem";
import { describe, expect, it } from "vitest";
import { FEE_POKED, FEE_POKED_DIRECTIONAL, hookViewAbi, POKED, RISK_REPORTED_V2, SWAP } from "./events";

const events = (abi: readonly unknown[]) => (abi as Array<{ type: string }>).filter((x): x is AbiEvent => x.type === "event");
const fns = (abi: readonly unknown[]) => (abi as Array<{ type: string }>).filter((x): x is AbiFunction => x.type === "function");

describe("event signatures match shared/'s ABIs", () => {
  it("FeePoked, both variants, as in PokeFeeHook (Fables' single-fee FeePoked has the same signature)", () => {
    const sel = events(pokeFeeHookAbi).map((e) => toEventSelector(e));
    expect(sel).toContain(toEventSelector(FEE_POKED));
    expect(sel).toContain(toEventSelector(FEE_POKED_DIRECTIONAL));
    expect(toEventSelector(FEE_POKED)).toBe("0xcb123ffca193ebeb3d5c30d267785371dd417ff0084b636bff5d03f87a2c8e04");
  });
  it("Swap, Poked and RiskReportedV2", () => {
    expect(toEventSelector(SWAP)).toBe(toEventSelector(events(poolManagerSwapEventAbi)[0] as AbiEvent));
    expect(toEventSelector(POKED)).toBe(toEventSelector(events(climPokerAbi)[0] as AbiEvent));
    expect(toEventSelector(RISK_REPORTED_V2)).toBe(toEventSelector(events(riskDeskV2Abi)[0] as AbiEvent));
  });
  it("currentFee(bytes32,bool)", () => {
    expect(toFunctionSelector(hookViewAbi[0])).toBe(toFunctionSelector(fns(pokeFeeHookAbi).find((f) => f.name === "currentFee") as AbiFunction));
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd app && npx vitest run src/lib/chain/fables.test.ts src/lib/chain/deployments.test.ts src/lib/chain/events.test.ts`
Expected: FAIL, the three modules do not exist.

- [ ] **Step 3: Write `app/src/lib/chain/fables.ts`**

```ts
// Fables' ETH/USDG pool on Robinhood Chain mainnet (chain 4663), read only. The values come from the lab's committed
// outputs (lab/out/fables-storm-2026-10-07.json, lab/out/fables-compare.json) and the pool's Initialize log
// (tx 0x1c00f72a65cd83238e496d21776d783974b4e8baf707c7881da6c61a8d5f5a71); fables.test.ts checks them against the
// lab files and recomputes the pool id from the key, and the live check reads them back from the chain.
import type { Address, Hex } from "viem";
import type { HookConfig } from "@/lib/fees";

export const FABLES = {
  chainId: 4663,
  pair: "ETH/USDG",
  poolId: "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551" as Hex,
  key: {
    currency0: "0x0000000000000000000000000000000000000000" as Address,
    currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
    fee: 0x800000,
    tickSpacing: 10,
    hooks: "0x06a889870C8f83640D6816319f72e2aA579b6080" as Address,
  },
  hook: "0x06a889870C8f83640D6816319f72e2aA579b6080" as Address,
  hookContract: "FablesRampETH",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address,
  stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b" as Address,
  accessManager: "0xA362D98B33A7bb5B5E2180a05f995A70FB404f30" as Address,
  keeper: "0x1B6a8808E1D26dba66bA11E52997803C43CAd429" as Address,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
  /** Floor 1 bp, flat 7 bp, cap 60 bp since block 56,022,455 (2026-09-06, PoolConfigured). */
  config: { floorPips: 100, flatPips: 700, capPips: 6000 } satisfies HookConfig,
  configSinceBlock: 56_022_455n,
  /** Every keeper override so far used a 7,200 s TTL (lab/out/fables-storm-2026-10-07.json, pokeTtlSec). */
  pokeTtlSec: 7200,
  /** At least this far apart: the lab measured 0.1023 s blocks; the app steps back with a smaller value. */
  minBlockSec: 0.09,
  explorer: "https://robin.etherscan.io",
  sourcify: "https://repo.sourcify.dev/4663/0x06a889870C8f83640D6816319f72e2aA579b6080",
  app: "https://www.fables.fi/markets/eth",
} as const;

export const fablesTx = (tx: string) => `${FABLES.explorer}/tx/${tx}`;
export const fablesAddress = (a: string) => `${FABLES.explorer}/address/${a}`;
```

- [ ] **Step 4: Write `app/src/lib/chain/deployments.ts`**

```ts
import { LIVE_POOLS, liveOrientation, parseLiveDeployments, type LivePoolName } from "@clim/shared";
import raw from "@/vendor/shared/deployments/robinhood-testnet.json";

/** clim's live reference stack on Robinhood Chain testnet (shared/deployments/robinhood-testnet.json, validated). */
export const LIVE = parseLiveDeployments(raw);
export { LIVE_POOLS };
export type { LivePoolName };

export const TESTNET_EXPLORER = "https://explorer.testnet.chain.robinhood.com";
export const testnetTx = (tx: string) => `${TESTNET_EXPLORER}/tx/${tx}`;
export const testnetAddress = (a: string) => `${TESTNET_EXPLORER}/address/${a}`;
export const testnetCode = (a: string) => `${TESTNET_EXPLORER}/address/${a}?tab=contract`;
export const sourcifyTestnet = (a: string) => `https://repo.sourcify.dev/46630/${a}`;

/** Blocks on testnet are at least this far apart (about 0.11 s measured, spec §2). */
export const TESTNET_MIN_BLOCK_SEC = 0.09;

export const orientationOf = (name: LivePoolName) => liveOrientation(LIVE, LIVE.pools[name]);

/** The pool page slug of each testnet pool: /markets/d, /markets/k, /markets/f. */
export const POOL_SLUGS: Record<string, LivePoolName> = { d: "D", k: "K", f: "F" };
```

- [ ] **Step 5: Write `app/src/lib/chain/events.ts`**

```ts
// The events and views the app reads, typed from their signatures. events.test.ts checks each against the ABI that
// shared/ exports from the compiled contracts (clim's) or from the published interface (Fables' FeePoked, the same
// signature as clim's PokeFeeHook single-fee FeePoked).
import { parseAbi, parseAbiItem } from "viem";

export const FEE_POKED = parseAbiItem("event FeePoked(bytes32 indexed poolId, uint24 fee, uint40 expiry)");
export const FEE_POKED_DIRECTIONAL = parseAbiItem("event FeePoked(bytes32 indexed poolId, uint24 fee0For1, uint24 fee1For0, uint40 expiry)");
export const POKE_CLEARED = parseAbiItem("event PokeCleared(bytes32 indexed poolId)");
export const SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
export const POKED = parseAbiItem(
  "event Poked(uint32 indexed seq, uint40 tObs, uint24 fee0For1, uint24 fee1For0, uint8 mode, bool eventApplied, uint40 expiry, address caller)",
);
export const RISK_REPORTED_V2 = parseAbiItem(
  "event RiskReportedV2(uint32 indexed seq, uint40 tObs, uint32 sigma15Applied, uint32 sigma5Applied, uint32 sigma15Reported, uint32 sigma5Reported, int32 devPips, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 flags)",
);

export const hookViewAbi = parseAbi(["function currentFee(bytes32 poolId, bool zeroForOne) view returns (uint24)"]);
```

- [ ] **Step 6: Run them**

Run: `cd app && npx vitest run src/lib/chain/fables.test.ts src/lib/chain/deployments.test.ts src/lib/chain/events.test.ts`
Expected: `Tests  7 passed (7)`.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/chain/fables.ts app/src/lib/chain/fables.test.ts app/src/lib/chain/deployments.ts app/src/lib/chain/deployments.test.ts app/src/lib/chain/events.ts app/src/lib/chain/events.test.ts
git commit -m "feat(app): Fables' ETH/USDG constants checked against the lab, the testnet stack, typed events"
```

### Task 11: Clients, decoders and readers

**Files:**
- Create: `app/src/lib/chain/clients.ts`, `decode.ts`, `decode.test.ts`, `readFables.ts`, `readClim.ts`, `readClimNow.ts`, `read.test.ts` (all under `app/src/lib/chain/`)

`readClimNow.ts` is separate from `readClim.ts` because it imports the vendored `keeper-read.ts` (an ES module with `import.meta`), which the live check cannot load in Node; the live check imports `readClim.ts` only.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/chain/decode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { climPointFrom, pokeFromClimPoint, pokeFromDirectional, pokeFromSingle, reportFrom, swapFrom } from "./decode";

const m = { blockNumber: 7n, logIndex: 2, transactionHash: "0xaa" as const };
const ETH_USDG = { token0IsEth: true, decimals0: 18, decimals1: 6 };

describe("decoders", () => {
  it("reads a single-fee FeePoked as both directions", () => {
    expect(pokeFromSingle({ ...m, args: { fee: 1468, expiry: 1791975879 } }, 1791968679)).toEqual({ kind: "poke", t: 1791968679, block: 7n, logIndex: 2, tx: "0xaa", fee0For1: 1468, fee1For0: 1468, expiry: 1791975879 });
  });
  it("keeps a directional FeePoked's two fees", () => {
    const p = pokeFromDirectional({ ...m, args: { fee0For1: 700, fee1For0: 897, expiry: 1 } }, 0);
    expect([p.kind === "poke" && p.fee0For1, p.kind === "poke" && p.fee1For0]).toEqual([700, 897]);
  });
  it("reads a Poked log as clim's point, at its observation time", () => {
    const point = climPointFrom({ ...m, args: { seq: 78, tObs: 1791968619, fee0For1: 700, fee1For0: 897, mode: 0, eventApplied: false, expiry: 1791969219 } });
    expect(point).toEqual({ t: 1791968619, block: 7n, logIndex: 2, seq: 78, fee0For1: 700, fee1For0: 897, mode: 0, eventApplied: false, expiry: 1791969219, tx: "0xaa" });
    expect(pokeFromClimPoint(point)).toEqual({ kind: "poke", t: 1791968619, block: 7n, logIndex: 2, tx: "0xaa", fee0For1: 700, fee1For0: 897, expiry: 1791969219 });
  });
  it("reads a desk report", () => {
    const r = reportFrom({ ...m, args: { seq: 81, tObs: 1791969493, sigma15Applied: 35825, sigma5Applied: 39278, devPips: -37, nSources: 4, flags: 0 } });
    expect([r.t, r.seq, r.tObs, r.sigma5E9, r.devPips]).toEqual([1791969493, 81, 1791969493, 39278, -37]);
  });
  it("refuses a pending log", () => {
    expect(() => pokeFromSingle({ ...m, blockNumber: null, args: { fee: 1, expiry: 2 } }, 0)).toThrow("pending log");
  });
});

describe("swapFrom", () => {
  // sqrtPriceX96 of the ETH/USDG pool read on 2026-10-14: about 2,477 USDG per ETH.
  const sqrtPriceX96 = 3943055827863068952403550n;
  it("is a buy when the swapper receives ETH", () => {
    const s = swapFrom({ ...m, args: { amount0: 3_080_000_000_000_000n, amount1: -7_629_000n, fee: 700, sqrtPriceX96 } }, ETH_USDG);
    expect([s.side, s.eth, s.usdg, s.feePips, s.block]).toEqual(["buy", 0.00308, 7.629, 700, 7n]);
    expect(Math.round(s.price)).toBe(2477);
  });
  it("is a sell when the swapper pays ETH", () => {
    expect(swapFrom({ ...m, args: { amount0: -1n, amount1: 1n, fee: 700, sqrtPriceX96 } }, ETH_USDG).side).toBe("sell");
  });
});
```

`app/src/lib/chain/read.test.ts`:

```ts
import { stateViewAbi } from "@clim/shared";
import { describe, expect, it } from "vitest";
import { FakeRpc, fakeLog } from "@/test/fakeRpc";
import { FEE_POKED, FEE_POKED_DIRECTIONAL, hookViewAbi, POKE_CLEARED } from "./events";
import { FABLES } from "./fables";
import { LIVE } from "./deployments";
import { readFablesNow, readFablesPokes } from "./readFables";
import { readPoolPokes } from "./readClim";

const SQRT = 3943055827863068952403550n;

describe("readFablesNow", () => {
  it("reads both directions' currentFee and the price three blocks behind the head", async () => {
    const rpc = new FakeRpc();
    rpc.head = 1000n;
    for (const [dir, fee] of [[true, 700], [false, 700]] as const) rpc.onCall(FABLES.hook, hookViewAbi, "currentFee", [FABLES.poolId, dir], fee);
    rpc.onCall(FABLES.stateView, stateViewAbi, "getSlot0", [FABLES.poolId], [SQRT, -198173, 0, 0]);
    const now = await readFablesNow(rpc.client());
    expect(now.blockNumber).toBe(997n);
    expect([now.fee0For1, now.fee1For0, now.t]).toEqual([700, 700, 99]);
    expect(Math.round(now.price)).toBe(2477);
    const calls = rpc.requests.filter((r) => r.method === "eth_call").map((r) => (r.params as [unknown, string])[1]);
    expect(calls.every((b) => b === "0x3e5")).toBe(true);
  });
});

describe("readFablesPokes", () => {
  it("returns this pool's overrides only, decoded, over ranges of at most 5,000,000 blocks", async () => {
    const rpc = new FakeRpc();
    rpc.logs = [
      fakeLog(FEE_POKED, { poolId: FABLES.poolId, fee: 1468, expiry: 8_000 }, { address: FABLES.hook, blockNumber: 10n, t: 800 }),
      fakeLog(FEE_POKED, { poolId: `0x${"cd".repeat(32)}`, fee: 9, expiry: 8_000 }, { address: FABLES.hook, blockNumber: 11n, t: 801 }),
      fakeLog(FEE_POKED, { poolId: FABLES.poolId, fee: 2657, expiry: 8_060 }, { address: FABLES.hook, blockNumber: 6_000_000n, t: 860 }),
    ];
    const pokes = await readFablesPokes(rpc.client(), 0n, 7_000_000n);
    expect(pokes.map((p) => (p.kind === "poke" ? [p.fee0For1, p.t] : 0))).toEqual([[1468, 1], [2657, 600_000]]);
    expect(rpc.getLogsRanges).toEqual([[0n, 4_999_999n], [5_000_000n, 7_000_000n]]);
  });
});

describe("readPoolPokes", () => {
  it("decodes both FeePoked variants and PokeCleared for one testnet pool", async () => {
    const rpc = new FakeRpc();
    const poolId = LIVE.pools.K.poolId;
    rpc.logs = [
      fakeLog(FEE_POKED, { poolId, fee: 1466, expiry: 9_000 }, { address: LIVE.hook, blockNumber: 5n, t: 100 }),
      fakeLog(FEE_POKED_DIRECTIONAL, { poolId, fee0For1: 700, fee1For0: 900, expiry: 9_000 }, { address: LIVE.hook, blockNumber: 6n, t: 130 }),
      fakeLog(POKE_CLEARED, { poolId }, { address: LIVE.hook, blockNumber: 7n, t: 160 }),
      fakeLog(FEE_POKED, { poolId: LIVE.pools.D.poolId, fee: 5000, expiry: 9_000 }, { address: LIVE.hook, blockNumber: 8n, t: 190 }),
    ];
    const events = await readPoolPokes(rpc.client(), "K", 0n, 100n);
    expect(events.map((e) => (e.kind === "poke" ? [e.fee0For1, e.fee1For0] : "clear"))).toEqual([[1466, 1466], [700, 900], "clear"]);
    expect(events.map((e) => e.t)).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd app && npx vitest run src/lib/chain/decode.test.ts src/lib/chain/read.test.ts`
Expected: FAIL, `./decode`, `./readFables` and `./readClim` do not exist.

- [ ] **Step 3: Write `app/src/lib/chain/clients.ts`**

```ts
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { RPC_URLS } from "@/lib/rpc";

// Read-only clients: createPublicClient has no account and no wallet action. Requests to one endpoint are batched
// (JSON-RPC batch, at most 50 calls: 200 got HTTP 429, 100 went through); a failing endpoint falls back to the next one.
const transport = (urls: readonly string[]) => fallback(urls.map((u) => http(u, { batch: { batchSize: 50, wait: 16 }, retryCount: 2, retryDelay: 2_000, timeout: 20_000 })));

let mainnet: PublicClient | undefined;
let testnet: PublicClient | undefined;

/** Robinhood Chain mainnet (4663): Fables, read only. */
export function mainnetClient(): PublicClient {
  mainnet ??= createPublicClient({ chain: robinhood, transport: transport(RPC_URLS.mainnet) }) as PublicClient;
  return mainnet;
}

/** Robinhood Chain testnet (46630): clim's desk, policy, poker and pools D, K, F. */
export function testnetClient(): PublicClient {
  testnet ??= createPublicClient({ chain: robinhoodTestnet, transport: transport(RPC_URLS.testnet) }) as PublicClient;
  return testnet;
}
```

- [ ] **Step 4: Write `app/src/lib/chain/decode.ts`**

```ts
import { ethUsdFromSqrtPriceX96, type PairOrientation } from "@clim/shared";
import type { Hex } from "viem";
import type { ClimPoint, PokeEvent } from "@/lib/fees";

/** What every decoded log carries. Its time comes from its block header (lib/chain/blockTimes.ts) or, for clim's own
 *  events, from the observation time they carry (tObs). */
type Meta = { blockNumber: bigint | null; logIndex: number | null; transactionHash: Hex | null };

function meta(l: Meta) {
  if (l.blockNumber === null || l.logIndex === null || l.transactionHash === null) throw new Error("pending log");
  return { block: l.blockNumber, logIndex: l.logIndex, tx: l.transactionHash };
}

export function pokeFromSingle(l: Meta & { args: { fee?: number; expiry?: number } }, t: number): PokeEvent {
  const m = meta(l);
  if (l.args.fee === undefined || l.args.expiry === undefined) throw new Error("FeePoked without its fields");
  return { kind: "poke", t, block: m.block, logIndex: m.logIndex, tx: m.tx, fee0For1: l.args.fee, fee1For0: l.args.fee, expiry: l.args.expiry };
}

export function pokeFromDirectional(l: Meta & { args: { fee0For1?: number; fee1For0?: number; expiry?: number } }, t: number): PokeEvent {
  const m = meta(l);
  const { fee0For1, fee1For0, expiry } = l.args;
  if (fee0For1 === undefined || fee1For0 === undefined || expiry === undefined) throw new Error("FeePoked without its fields");
  return { kind: "poke", t, block: m.block, logIndex: m.logIndex, tx: m.tx, fee0For1, fee1For0, expiry };
}

export function clearFrom(l: Meta, t: number): PokeEvent {
  const m = meta(l);
  return { kind: "clear", t, block: m.block, logIndex: m.logIndex, tx: m.tx };
}

/** ClimPoker's Poked log: clim's fee per side at report `seq`, placed at the report's observation time. */
export function climPointFrom(l: Meta & { args: { seq?: number; tObs?: number; fee0For1?: number; fee1For0?: number; mode?: number; eventApplied?: boolean; expiry?: number } }): ClimPoint {
  const m = meta(l);
  const { seq, tObs, fee0For1, fee1For0, mode, eventApplied, expiry } = l.args;
  if (seq === undefined || tObs === undefined || fee0For1 === undefined || fee1For0 === undefined || mode === undefined || eventApplied === undefined || expiry === undefined) {
    throw new Error("Poked without its fields");
  }
  return { t: tObs, block: m.block, logIndex: m.logIndex, seq, fee0For1, fee1For0, mode, eventApplied, expiry, tx: m.tx };
}

export type DeskReport = { t: number; tx: Hex; block: bigint; seq: number; tObs: number; sigma15E9: number; sigma5E9: number; devPips: number; nSources: number; flags: number };

/** A desk report, placed at its observation time. */
export function reportFrom(l: Meta & { args: { seq?: number; tObs?: number; sigma15Applied?: number; sigma5Applied?: number; devPips?: number; nSources?: number; flags?: number } }): DeskReport {
  const m = meta(l);
  const a = l.args;
  if (a.seq === undefined || a.tObs === undefined || a.sigma15Applied === undefined || a.sigma5Applied === undefined || a.devPips === undefined || a.nSources === undefined || a.flags === undefined) {
    throw new Error("RiskReportedV2 without its fields");
  }
  return { t: a.tObs, tx: m.tx, block: m.block, seq: a.seq, tObs: a.tObs, sigma15E9: a.sigma15Applied, sigma5E9: a.sigma5Applied, devPips: a.devPips, nSources: a.nSources, flags: a.flags };
}

/** A swap from the swapper's side: Uniswap v4's Swap amounts are the swapper's deltas (negative = paid into the pool).
 *  `t` is read later, only for the rows a table shows. */
export type SwapRow = { tx: Hex; block: bigint; logIndex: number; side: "buy" | "sell"; eth: number; usdg: number; feePips: number; price: number };

export function swapFrom(l: Meta & { args: { amount0?: bigint; amount1?: bigint; fee?: number; sqrtPriceX96?: bigint } }, o: PairOrientation): SwapRow {
  const m = meta(l);
  const { amount0, amount1, fee, sqrtPriceX96 } = l.args;
  if (amount0 === undefined || amount1 === undefined || fee === undefined || sqrtPriceX96 === undefined) throw new Error("Swap without its fields");
  if (!o.token0IsEth) throw new Error("the app's pools all have ETH as currency0");
  const abs = (x: bigint) => (x < 0n ? -x : x);
  return {
    tx: m.tx,
    block: m.block,
    logIndex: m.logIndex,
    side: amount0 > 0n ? "buy" : "sell",
    eth: Number(abs(amount0)) / 10 ** o.decimals0,
    usdg: Number(abs(amount1)) / 10 ** o.decimals1,
    feePips: fee,
    price: ethUsdFromSqrtPriceX96(sqrtPriceX96, o),
  };
}

/** Pool D's overrides as ClimPoker posted them: the Poked log is emitted in the same transaction as the hook's
 *  FeePoked, with the same fees and expiry, and carries the report's observation time. */
export function pokeFromClimPoint(p: ClimPoint): PokeEvent {
  return { kind: "poke", t: p.t, block: p.block, logIndex: p.logIndex, tx: p.tx, fee0For1: p.fee0For1, fee1For0: p.fee1For0, expiry: p.expiry };
}
```

- [ ] **Step 5: Write `app/src/lib/chain/readFables.ts`**

```ts
// Reads of Fables' ETH/USDG pool on Robinhood Chain mainnet. Every call is an eth_call or eth_getLogs: nothing is sent.
import { ethUsdFromSqrtPriceX96, stateViewAbi } from "@clim/shared";
import type { PublicClient } from "viem";
import type { PokeEvent } from "@/lib/fees";
import { blockTimes } from "./blockTimes";
import { pokeFromSingle, swapFrom, type SwapRow } from "./decode";
import { FEE_POKED, hookViewAbi, SWAP } from "./events";
import { FABLES } from "./fables";
import { getLogsChunked } from "./logs";
import { laggedHead, withRetry } from "./retry";

export const ETH_USDG_ORIENTATION = { token0IsEth: true, decimals0: 18, decimals1: 6 } as const;

export type FablesNow = { blockNumber: bigint; t: number; fee0For1: number; fee1For0: number; sqrtPriceX96: bigint; price: number };

/** The fee a swap would pay now in each direction (the hook's own currentFee) and the pool price, at one block a few
 *  blocks behind the head. */
export async function readFablesNow(client: PublicClient): Promise<FablesNow> {
  return withRetry(async () => {
    const blockNumber = laggedHead(await client.getBlockNumber({ cacheTime: 0 }));
    const fee = (zeroForOne: boolean) => client.readContract({ address: FABLES.hook, abi: hookViewAbi, functionName: "currentFee", args: [FABLES.poolId, zeroForOne], blockNumber });
    const [block, fee0For1, fee1For0, slot0] = await Promise.all([
      client.getBlock({ blockNumber }),
      fee(true),
      fee(false),
      client.readContract({ address: FABLES.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [FABLES.poolId], blockNumber }),
    ]);
    return { blockNumber, t: Number(block.timestamp), fee0For1, fee1For0, sqrtPriceX96: slot0[0], price: ethUsdFromSqrtPriceX96(slot0[0], ETH_USDG_ORIENTATION) };
  });
}

/** The keeper's overrides on the pool in [fromBlock, toBlock] (FeePoked logs of the hook, this pool only). */
export async function readFablesPokes(client: PublicClient, fromBlock: bigint, toBlock: bigint): Promise<PokeEvent[]> {
  const logs = await getLogsChunked(
    (a, b) => withRetry(() => client.getLogs({ address: FABLES.hook, event: FEE_POKED, args: { poolId: FABLES.poolId }, fromBlock: a, toBlock: b })),
    fromBlock,
    toBlock,
  );
  const times = await blockTimes(client, logs.map((l) => l.blockNumber));
  return logs.map((l) => pokeFromSingle(l, times.get(l.blockNumber) as number));
}

/** Swaps of a pool in [fromBlock, toBlock], in chain order. */
export async function readSwaps(client: PublicClient, poolManager: `0x${string}`, poolId: `0x${string}`, fromBlock: bigint, toBlock: bigint): Promise<SwapRow[]> {
  const logs = await getLogsChunked(
    (a, b) => withRetry(() => client.getLogs({ address: poolManager, event: SWAP, args: { id: poolId }, fromBlock: a, toBlock: b })),
    fromBlock,
    toBlock,
  );
  return logs.map((l) => swapFrom(l, ETH_USDG_ORIENTATION));
}
```

- [ ] **Step 6: Write `app/src/lib/chain/readClim.ts`**

```ts
// Log reads of clim's live stack on Robinhood Chain testnet (the current state is in readClimNow.ts). This module does
// not import the vendored keeper reader, so the live check can load it in Node.
import { accessManagerAbi, type LivePoolName } from "@clim/shared";
import type { PublicClient } from "viem";
import type { ClimPoint, PokeEvent } from "@/lib/fees";
import { blockTimes } from "./blockTimes";
import { climPointFrom, clearFrom, pokeFromClimPoint, pokeFromDirectional, pokeFromSingle, reportFrom, type DeskReport } from "./decode";
import { LIVE } from "./deployments";
import { FEE_POKED, FEE_POKED_DIRECTIONAL, POKE_CLEARED, POKED, RISK_REPORTED_V2 } from "./events";
import { getLogsChunked } from "./logs";
import { laggedHead, withRetry } from "./retry";

/** ClimPoker's pokes of pool D in [fromBlock, toBlock]: clim's recommendation at each desk report. */
export async function readClimPoints(client: PublicClient, fromBlock: bigint, toBlock: bigint): Promise<ClimPoint[]> {
  const logs = await getLogsChunked((a, b) => withRetry(() => client.getLogs({ address: LIVE.poker, event: POKED, fromBlock: a, toBlock: b })), fromBlock, toBlock);
  return logs.map(climPointFrom);
}

/** The desk's reports in [fromBlock, toBlock]. */
export async function readDeskReports(client: PublicClient, fromBlock: bigint, toBlock: bigint): Promise<DeskReport[]> {
  const logs = await getLogsChunked((a, b) => withRetry(() => client.getLogs({ address: LIVE.riskDesk, event: RISK_REPORTED_V2, fromBlock: a, toBlock: b })), fromBlock, toBlock);
  return logs.map(reportFrom);
}

/** Overrides and clears of one testnet pool in [fromBlock, toBlock] (both FeePoked variants and PokeCleared), in chain
 *  order, each at its block's time. viem filters one event per getLogs by an indexed argument, so the three are read
 *  side by side. Pool D is poked every 30 s: its page reads ClimPoker's Poked logs instead (readClimPoints), which
 *  carry the same fees and expiry and the report's time, so it does not read 2,880 block headers a day. */
export async function readPoolPokes(client: PublicClient, pool: LivePoolName, fromBlock: bigint, toBlock: bigint): Promise<PokeEvent[]> {
  const poolId = LIVE.pools[pool].poolId;
  const range = (a: bigint, b: bigint) =>
    withRetry(async () => {
      const [single, directional, cleared] = await Promise.all([
        client.getLogs({ address: LIVE.hook, event: FEE_POKED, args: { poolId }, fromBlock: a, toBlock: b }),
        client.getLogs({ address: LIVE.hook, event: FEE_POKED_DIRECTIONAL, args: { poolId }, fromBlock: a, toBlock: b }),
        client.getLogs({ address: LIVE.hook, event: POKE_CLEARED, args: { poolId }, fromBlock: a, toBlock: b }),
      ]);
      const times = await blockTimes(client, [...single, ...directional, ...cleared].map((l) => l.blockNumber));
      const at = (n: bigint) => times.get(n) as number;
      return [...single.map((l) => pokeFromSingle(l, at(l.blockNumber))), ...directional.map((l) => pokeFromDirectional(l, at(l.blockNumber))), ...cleared.map((l) => clearFrom(l, at(l.blockNumber)))];
    });
  const events = await getLogsChunked(range, fromBlock, toBlock);
  return events.sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1));
}

/** How far back each pool's overrides can still be live at a window's start: ClimPoker's TTL (600 s) on D, the
 *  keeper-style bot's (7,200 s) on K; F is never poked. */
export const POOL_LOOKBACK_SEC: Record<LivePoolName, number> = { D: 600, K: 7200, F: 7200 };

/** A testnet pool's overrides: pool D's from ClimPoker's Poked logs (one per report, at the report's time), K's and F's
 *  from the hook's logs at their blocks' times. */
export async function readPoolOverrides(client: PublicClient, pool: LivePoolName, fromBlock: bigint, toBlock: bigint): Promise<PokeEvent[]> {
  if (pool === "D") return (await readClimPoints(client, fromBlock, toBlock)).map(pokeFromClimPoint);
  return readPoolPokes(client, pool, fromBlock, toBlock);
}

/** The level 2 roles on clim's testnet AccessManager: FEE_POKER (1) held by ClimPoker, CLIM_RUNNER (7) by the runner. */
export async function readLevel2Roles(client: PublicClient): Promise<{ blockNumber: bigint; pokerHasFeePoker: boolean; runnerHasClimRunner: boolean }> {
  return withRetry(async () => {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const blockNumber = laggedHead(head);
    const role = (id: bigint, account: `0x${string}`) => client.readContract({ address: LIVE.accessManager, abi: accessManagerAbi, functionName: "hasRole", args: [id, account], blockNumber });
    const [a, b] = await Promise.all([role(BigInt(LIVE.roles.feePoker), LIVE.poker), role(BigInt(LIVE.roles.climRunner), LIVE.roles.runner)]);
    return { blockNumber, pokerHasFeePoker: a[0], runnerHasClimRunner: b[0] };
  });
}
```

- [ ] **Step 7: Write `app/src/lib/chain/readClimNow.ts`**

```ts
// clim's current state on Robinhood Chain testnet. The policy quote comes from the published level 1 reader
// (docs/integrate/keeper-read.ts, vendored byte for byte), so the app shows exactly what a keeper would read.
import { ethUsdFromSqrtPriceX96, riskDeskV2Abi, stateViewAbi, type LivePoolName } from "@clim/shared";
import type { PublicClient } from "viem";
import { readClimQuote, type ClimQuote } from "@/vendor/integrate/keeper-read";
import { LIVE, LIVE_POOLS, orientationOf } from "./deployments";
import { hookViewAbi } from "./events";
import { HEAD_LAG_BLOCKS, withRetry } from "./retry";

export type DeskState = { tObs: number; sigma15E9: number; sigma5E9: number; devPips: number; kE4: number; flags: number; seq: number };
export type PoolNow = { fee0For1: number; fee1For0: number; sqrtPriceX96: bigint; price: number };
export type ClimNow = { quote: ClimQuote; desk: DeskState; pools: Record<LivePoolName, PoolNow> };

/** clim's quote (both directions, mode, observation), the desk's state, and pools D, K and F, all at one block. */
export async function readClimNow(client: PublicClient): Promise<ClimNow> {
  return withRetry(async () => {
    const quote = await readClimQuote(client, { policy: LIVE.policy, lagBlocks: HEAD_LAG_BLOCKS });
    const blockNumber = quote.blockNumber;
    const st = await client.readContract({ address: LIVE.riskDesk, abi: riskDeskV2Abi, functionName: "state", blockNumber });
    const pools = await Promise.all(
      LIVE_POOLS.map(async (name) => {
        const poolId = LIVE.pools[name].poolId;
        const [fee0For1, fee1For0, slot0] = await Promise.all([
          client.readContract({ address: LIVE.hook, abi: hookViewAbi, functionName: "currentFee", args: [poolId, true], blockNumber }),
          client.readContract({ address: LIVE.hook, abi: hookViewAbi, functionName: "currentFee", args: [poolId, false], blockNumber }),
          client.readContract({ address: LIVE.uniswap.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [poolId], blockNumber }),
        ]);
        return [name, { fee0For1, fee1For0, sqrtPriceX96: slot0[0], price: ethUsdFromSqrtPriceX96(slot0[0], orientationOf(name)) }] as const;
      }),
    );
    return {
      quote,
      desk: { tObs: st[0], sigma15E9: st[1], sigma5E9: st[2], devPips: st[3], kE4: st[4], flags: st[5], seq: st[6] },
      pools: Object.fromEntries(pools) as Record<LivePoolName, PoolNow>,
    };
  });
}
```

- [ ] **Step 8: Run them and typecheck**

Run: `cd app && npx vitest run src/lib/chain/decode.test.ts src/lib/chain/read.test.ts && npm run typecheck`
Expected: `Tests  10 passed (10)`, typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/chain/clients.ts app/src/lib/chain/decode.ts app/src/lib/chain/decode.test.ts app/src/lib/chain/readFables.ts app/src/lib/chain/readClim.ts app/src/lib/chain/readClimNow.ts app/src/lib/chain/read.test.ts
git commit -m "feat(app): read-only clients and readers for Fables' pool and clim's testnet stack

clim's quote comes from the published level 1 reader; pool D's overrides from ClimPoker's Poked logs at the report's time."
```

### Task 12: Window statistics and outage windows

**Files:**
- Create: `app/src/lib/windowStats.ts`, `app/src/lib/windowStats.test.ts`, `app/src/lib/outages.ts`, `app/src/lib/outages.test.ts`

- [ ] **Step 1: Write the failing tests**

`app/src/lib/windowStats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SwapRow } from "./chain/decode";
import type { PokeEvent } from "./fees";
import { feeWindow, swapWindow } from "./windowStats";

const CFG = { floorPips: 100, flatPips: 700, capPips: 6000 };
const poke = (t: number, fee: number, ttl = 7200): PokeEvent => ({ kind: "poke", t, block: BigInt(t), logIndex: 0, tx: "0xaa", fee0For1: fee, fee1For0: fee, expiry: t + ttl });

describe("feeWindow", () => {
  it("summarises a window like Fables' Dynamic Fee rail", () => {
    const w = feeWindow([poke(500, 1000), poke(1500, 3000, 100)], CFG, 2000, 1000);
    expect([w.fromTs, w.toTs]).toEqual([1000, 2000]);
    // 500 s at 1000 (override from t=500 live), 100 s at 3000, 400 s at 700 (expired at 1600)
    expect(w.avg).toBe((500 * 1000 + 100 * 3000 + 400 * 700) / 1000);
    expect([w.peak, w.low, w.changes]).toEqual([3000, 700, 1]);
  });
});

describe("swapWindow", () => {
  const swap = (block: number, feePips: number): SwapRow => ({ tx: "0xaa", block: BigInt(block), logIndex: 0, side: "buy", eth: 1, usdg: 1, feePips, price: 1 });
  it("counts the window's swaps and averages the fee they paid", () => {
    expect(swapWindow([swap(15, 900), swap(20, 1100)])).toEqual({ count: 2, meanFeePips: 1000 });
  });
  it("has no mean without swaps", () => expect(swapWindow([])).toEqual({ count: 0, meanFeePips: null }));
});
```

`app/src/lib/outages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import snapshot from "@/generated/outages.json";
import { mergeOutages, type OutageSnapshot } from "./outages";

const SNAP: OutageSnapshot = {
  generatedAt: "2026-10-14T13:06:36.277Z",
  gapSec: 90,
  deployBlock: 1,
  scannedToBlock: 100,
  chainTimeSec: 1000,
  reportCount: 3,
  lastReport: { seq: 3, tObs: 990 },
  windows: [{ from: 100, to: 450, durationSec: 350, seqBefore: 1, seqAfter: 2, ongoing: false, reason: "processes stopped and restarted: desk" }],
};

describe("mergeOutages", () => {
  it("keeps the recorded windows and their reasons", () => {
    const w = mergeOutages(SNAP, [], 1000);
    expect(w).toEqual([{ ...SNAP.windows[0], source: "record" }]);
  });
  it("adds a gap found in the reports after the snapshot", () => {
    const w = mergeOutages(SNAP, [{ seq: 4, tObs: 1020 }, { seq: 5, tObs: 1500 }], 1510);
    expect(w).toHaveLength(2);
    expect(w[1]).toMatchObject({ from: 1020, to: 1500, durationSec: 480, seqBefore: 4, seqAfter: 5, source: "chain" });
  });
  it("reports an ongoing silence", () => {
    const w = mergeOutages(SNAP, [], 2000);
    expect(w[1]).toMatchObject({ from: 990, to: null, ongoing: true, source: "chain" });
  });
  it("rebuilds a window recorded while ongoing from the chain, once, with the operator's reason", () => {
    const open = { from: 990, to: null, durationSec: 60, seqBefore: 3, seqAfter: null, ongoing: true, reason: "processes stopped and restarted: desk" };
    const snap: OutageSnapshot = { ...SNAP, chainTimeSec: 1050, windows: [...SNAP.windows, open] };
    const closed = mergeOutages(snap, [{ seq: 4, tObs: 1500 }, { seq: 5, tObs: 1530 }], 1540);
    expect(closed).toHaveLength(2);
    expect(closed[1]).toEqual({ from: 990, to: 1500, durationSec: 510, seqBefore: 3, seqAfter: 4, ongoing: false, source: "chain", reason: open.reason });
    const silent = mergeOutages(snap, [], 2000);
    expect(silent).toHaveLength(2);
    expect(silent[1]).toMatchObject({ from: 990, to: null, ongoing: true, source: "chain", reason: open.reason });
  });
  it("reads the committed snapshot", () => {
    expect(snapshot.gapSec).toBe(90);
    expect(snapshot.windows.length).toBeGreaterThan(0);
    for (const x of snapshot.windows) expect(x.durationSec).toBeGreaterThan(90);
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd app && npx vitest run src/lib/windowStats.test.ts src/lib/outages.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write `app/src/lib/windowStats.ts`**

```ts
// The statistics of one fee window, computed the same way by the pages and by the live check (e2e/live.spec.ts), so
// the check compares like with like: the page's numbers against a fresh read of the same blocks.
import { overrideSteps, peakAndLow, pokeCount, timeWeightedAverage, type Direction, type FeeStep, type HookConfig, type PokeEvent } from "./fees";
import type { SwapRow } from "./chain/decode";

export type FeeWindow = { fromTs: number; toTs: number; steps: FeeStep[]; avg: number | null; peak: number | null; low: number | null; changes: number };

export function feeWindow(events: readonly PokeEvent[], cfg: HookConfig, toTs: number, windowSec: number, d: Direction = "0For1"): FeeWindow {
  const fromTs = toTs - windowSec;
  const steps = overrideSteps(events, cfg, fromTs, toTs);
  const pl = peakAndLow(steps, d);
  return { fromTs, toTs, steps, avg: timeWeightedAverage(steps, toTs, d), peak: pl?.peak ?? null, low: pl?.low ?? null, changes: pokeCount(events, fromTs, toTs) };
}

export type SwapWindow = { count: number; meanFeePips: number | null };

/** Swaps of a window whose blocks were chosen from timestamps (useLogHistory): every swap read is in the window. */
export function swapWindow(swaps: readonly SwapRow[]): SwapWindow {
  return { count: swaps.length, meanFeePips: swaps.length ? swaps.reduce((a, x) => a + x.feePips, 0) / swaps.length : null };
}
```

- [ ] **Step 4: Write `app/src/lib/outages.ts`**

```ts
// The desk's outage windows: the snapshot the live stack recorded (bots/out/outages.json, synced at build time, with
// the operator's reason for each window) followed by the windows recomputed in the browser from the RiskReportedV2
// logs after the snapshot, with shared/'s outageWindows (the same function the recorder uses).
import { outageWindows, type OutageWindow, type ReportPoint } from "@clim/shared";

export type OutageSnapshot = {
  generatedAt: string;
  gapSec: number;
  deployBlock: number;
  scannedToBlock: number;
  chainTimeSec: number;
  reportCount: number;
  lastReport: ReportPoint | null;
  windows: Array<OutageWindow & { reason: string }>;
};

export type ShownOutage = OutageWindow & { reason: string; source: "record" | "chain" };

/** The recorder also writes the window still open when it ran (its `from` is snapshot.lastReport's tObs). That window is
 *  not copied: the recomputation from lastReport rebuilds it from the chain (closed by the first new report, or still
 *  ongoing), and it keeps the operator's reason. */
export function mergeOutages(snapshot: OutageSnapshot, newReports: readonly ReportPoint[], nowSec: number): ShownOutage[] {
  const recorded: ShownOutage[] = snapshot.windows.filter((w) => !w.ongoing).map((w) => ({ ...w, source: "record" }));
  const openReason = new Map(snapshot.windows.filter((w) => w.ongoing).map((w) => [w.from, w.reason]));
  const series = [...(snapshot.lastReport ? [snapshot.lastReport] : []), ...[...newReports].sort((a, b) => a.seq - b.seq)];
  const live = outageWindows(series, { gapSec: snapshot.gapSec, nowSec }).map(
    (w): ShownOutage => ({
      ...w,
      source: "chain",
      reason: openReason.get(w.from) ?? (w.ongoing ? "ongoing: the desk has not reported since" : "measured on chain after the last recorded snapshot; no operator record"),
    }),
  );
  return [...recorded, ...live];
}
```

- [ ] **Step 5: Run them**

Run: `cd app && npx vitest run src/lib/windowStats.test.ts src/lib/outages.test.ts`
Expected: `Tests  8 passed (8)`.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/windowStats.ts app/src/lib/windowStats.test.ts app/src/lib/outages.ts app/src/lib/outages.test.ts
git commit -m "feat(app): window statistics shared with the live check, outage windows after the recorded snapshot"
```

### Task 13: Fables' component catalog

**Files:**
- Create: `app/src/components/ui/icons.tsx`, `ui.module.css`, `kit.tsx`, `FilterToggle.tsx`, `CopyButton.tsx` (under `app/src/components/ui/`)

Inventory §3: card shell, chart panel, segmented switcher, period buttons, stat block, tier badge, asset badge, info tooltip, live dot, skeleton, buttons, pair logo. `LiveValue` marks every chain-read number for the live check (Task 24).

- [ ] **Step 1: Write `app/src/components/ui/icons.tsx`**

```tsx
// clim's own 16 px icons (two-tone like Fables' nav icons: --icon-1 faint, --icon-2 muted). Drawn for this app; no
// Fables icon is copied.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 16, ...p }: P) => ({ width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, ...p });

export const InfoIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.2" />
    <path d="M8 7.2v3.8M8 5.2v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
export const ArrowRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ArrowLeftIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 8H3.5M7 4.5 3.5 8 7 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ExternalIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5.5 4.5h6v6M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ChevronRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6.5 4 4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M10.5 3.5h-6a1 1 0 0 0-1 1v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
export const MenuIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
export const MarketsIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="3" height="8" rx="1" fill="var(--icon-1, #636161)" />
    <rect x="6.5" y="2" width="3" height="12" rx="1" fill="var(--icon-2, #8f8e8e)" />
    <rect x="11" y="8" width="3" height="6" rx="1" fill="var(--icon-1, #636161)" />
  </svg>
);
export const IntegrateIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="1.5" y="3" width="6" height="10" rx="2" fill="var(--icon-1, #636161)" />
    <rect x="8.5" y="3" width="6" height="10" rx="2" fill="var(--icon-2, #8f8e8e)" />
  </svg>
);
export const EvidenceIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="1.5" width="11" height="13" rx="2" fill="var(--icon-1, #636161)" />
    <path d="m5.5 8.5 1.8 1.8L11 6.5" stroke="var(--icon-2, #8f8e8e)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const RunIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.5" fill="var(--icon-1, #636161)" />
    <path d="M6.5 5.5v5l4-2.5-4-2.5Z" fill="var(--icon-2, #8f8e8e)" />
  </svg>
);
export const EthMark = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <circle cx="16" cy="16" r="16" fill="#2a2828" />
    <path d="M16 5.5 9.5 16.3 16 20.1l6.5-3.8L16 5.5Z" fill="#bcbbbb" />
    <path d="M16 21.4 9.5 17.6 16 26.5l6.5-8.9-6.5 3.8Z" fill="#8f8e8e" />
  </svg>
);
```

- [ ] **Step 2: Write `app/src/components/ui/ui.module.css`**

```css
/* Fables' component catalog (docs/research/fables-ui-inventory.md §3), rebuilt from the measurements. */

.card {
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow-table);
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  padding: 8px;
}
.dotted {
  background-image: var(--dot-grid);
  background-size: var(--dot-grid-size);
}

/* Section: title Inter 20/24 500, description 14/20 secondary max 76ch, head to body 40. */
.section {
  display: flex;
  flex-direction: column;
  gap: 40px;
}
.sectionHead {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sectionTitle {
  font-size: 20px;
  line-height: 24px;
  font-weight: 500;
  letter-spacing: -0.3px;
}
.sectionDesc {
  color: var(--ink-secondary);
  max-width: 76ch;
}
.rule {
  height: 1px;
  background: var(--line-light);
  margin: 4px 0;
  border: 0;
}

/* Aside grid: 308 px rail and the chart panel, gap 40 (one column below 690 px of container). */
.aside {
  container-type: inline-size;
}
.asideGrid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 40px;
}
@container (min-width: 690px) {
  .asideGrid {
    grid-template-columns: 308px 1fr;
  }
}
.rail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}
.railRows {
  display: flex;
  flex-direction: column;
}
.railRow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}
.railLabel {
  color: var(--ink-secondary);
  text-decoration: underline dashed var(--line-interactive);
  text-underline-offset: 4px;
}
.railValue {
  font-weight: 500;
  font-variant-numeric: lining-nums tabular-nums;
  text-align: right;
}

/* Stat block. */
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.statLabel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-secondary);
}
.statValue {
  font-size: 24px;
  line-height: 28.8px;
  font-weight: 500;
  font-variant-numeric: lining-nums tabular-nums;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.statSecondary {
  color: var(--ink-secondary);
  font-variant-numeric: lining-nums tabular-nums;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Tier badge: 20 tall, raised, full radius, padding 2 8, gap 8, Inter 12/16 500 secondary, 6 px dot. */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 20px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--raised);
  color: var(--ink-secondary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: -0.13px;
  white-space: nowrap;
}
.badgeDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

/* Asset badge: 20 tall, chip fill, padding 2 6 2 4, Inter 10/10 500, divider before the class. */
.assetBadge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  padding: 2px 6px 2px 4px;
  border-radius: var(--radius-full);
  background: var(--chip-fill);
  font-size: 10px;
  line-height: 10px;
  font-weight: 500;
  letter-spacing: -0.11px;
  white-space: nowrap;
}
.assetDivider {
  width: 1px;
  height: 10px;
  background: var(--ink-muted);
}
.testnet {
  color: var(--session);
}

/* Info tooltip: shows after 0.3 s, bubble max 300, surface, hairline, radius 12, padding 8 12, Inter 12/16. */
.tip {
  position: relative;
  display: inline-flex;
  color: var(--ink-secondary);
  cursor: help;
}
.tipBubble {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  translate: -50% 2px;
  width: max-content;
  max-width: 300px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--line-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow-menu-flat);
  color: var(--ink);
  font-size: 12px;
  line-height: 16px;
  font-weight: 400;
  letter-spacing: -0.13px;
  white-space: pre-line;
  text-align: left;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  z-index: 50;
  transition:
    opacity var(--dur) var(--ease-entrance),
    translate var(--dur) var(--ease-entrance),
    visibility 0s linear var(--dur);
}
.tip:hover .tipBubble,
.tip:focus-within .tipBubble {
  opacity: 1;
  visibility: visible;
  translate: -50% 0;
  transition-delay: 0.3s;
}

/* Live dot: 8 px lime with a ring pulse (scale 2.4, fade), 1.8 s ease-out. */
.live {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
}
.liveDot {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
}
.liveDot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: inherit;
  animation: pulse 1.8s ease-out infinite;
}
.liveDotGreen {
  background: var(--positive);
}
@keyframes pulse {
  from {
    scale: 1;
    opacity: 0.6;
  }
  to {
    scale: 2.4;
    opacity: 0;
  }
}

/* Segmented switcher (FilterToggle). */
.toggle {
  position: relative;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line-light);
}
.toggleHighlight {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: var(--highlight-left, 2px);
  width: var(--highlight-width, 0);
  border-radius: var(--radius-highlight);
  background: var(--raised);
  transition:
    left var(--dur) var(--ease-std),
    width var(--dur) var(--ease-std);
}
.toggleItem {
  position: relative;
  height: 26px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  border-radius: var(--radius-highlight);
  cursor: pointer;
  transition: color 0.3s;
}
.toggleItem[aria-checked="true"],
.toggleItem:hover {
  color: var(--ink);
}

/* Period buttons: 24 tall, padding 4 8, radius 4, 12/16 500; on white; hover raised. */
.periods {
  display: inline-flex;
  gap: 2px;
}
.period {
  height: 24px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-compact);
  background: transparent;
  color: var(--ink-secondary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  cursor: pointer;
}
.period[aria-pressed="true"] {
  color: var(--ink);
}
@media (hover: hover) and (min-width: 576px) {
  .period:hover {
    background: var(--raised);
  }
}

/* Chart panel: card, radius 12, top bar padding 8 12 0, plot with dot grid, legend 38 tall with a top hairline. */
.panel {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border-radius: var(--radius);
  overflow: hidden;
  min-width: 0;
}
.panelTop {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 0;
  min-height: 34px;
}
.panelLegend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
  padding: 0 12px;
  border-top: 1px solid var(--line-light);
  color: var(--ink-secondary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  flex-wrap: wrap;
}
.swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swatchLine {
  width: 12px;
  height: 4px;
  border-radius: 2px;
}

/* Buttons. */
.primary,
.secondary,
.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 16px;
  border-radius: var(--radius);
  border: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-std),
    box-shadow var(--dur-fast) var(--ease-std),
    scale var(--dur-press) var(--ease-std);
}
.primary {
  background: var(--control-primary);
  color: var(--canvas);
  box-shadow: var(--shadow-button);
}
.primary:hover {
  background: var(--control-primary-hover);
}
.secondary {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-button), 0 0 0 1px var(--line);
}
.secondary:hover {
  background: color-mix(in srgb, var(--surface), white 6%);
}
.cta {
  height: auto;
  padding: 10px 16px;
  background: var(--surface);
  box-shadow: var(--shadow-button), 0 0 0 1px var(--line);
}
.cta:hover {
  box-shadow: var(--shadow-button), 0 0 0 1px var(--line-interactive);
}
.iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-secondary);
  cursor: pointer;
}
.iconButton:hover {
  background: var(--hover);
  color: var(--ink);
}

/* Inline links. */
.extLink {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--ink-secondary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.extLink:hover {
  color: var(--ink);
}
.address {
  color: var(--ink);
  text-decoration: underline dotted var(--ink-muted);
  text-underline-offset: 3px;
  font-variant-numeric: lining-nums tabular-nums;
}

/* Skeleton. */
.skeleton {
  display: inline-block;
  min-width: 48px;
  height: 0.9em;
  border-radius: var(--radius-full);
  background: var(--skeleton);
  animation: skeleton 1.5s ease-in-out infinite;
  vertical-align: middle;
}
@keyframes skeleton {
  50% {
    opacity: 0.4;
  }
}

/* Pair logo: two halves of one circle with a 2 px gap. */
.pair {
  position: relative;
  display: inline-block;
  flex: none;
}
.pairHalf {
  position: absolute;
  top: 0;
  height: 100%;
  overflow: hidden;
}
.pairHalf img,
.pairHalf svg {
  display: block;
}

/* Error line under a section whose read failed. */
.readError {
  color: var(--negative);
  font-size: 12px;
  line-height: 16px;
}
```

- [ ] **Step 3: Write `app/src/components/ui/kit.tsx`**

```tsx
// Fables' components, rebuilt for the showcase (docs/research/fables-ui-inventory.md §3). Presentational only.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { TONE_COLOR, type Badge } from "@/lib/tiers";
import { EthMark, ExternalIcon, InfoIcon } from "./icons";
import s from "./ui.module.css";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

export function Card({ children, dotted, className, style }: { children: ReactNode; dotted?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx(s.card, dotted && s.dotted, className)} style={style}>
      {children}
    </div>
  );
}

export function Section({ id, title, description, children, aside }: { id?: string; title: ReactNode; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className={s.section}>
      <div className={s.sectionHead} style={{ flexDirection: aside ? "row" : "column", justifyContent: "space-between", alignItems: aside ? "flex-end" : undefined }}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle} data-qa="section-title">{title}</h2>
          {description ? <p className={s.sectionDesc}>{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const Rule = () => <hr className={s.rule} />;

export function AsideGrid({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className={s.aside}>
      <div className={s.asideGrid}>
        <div className={s.rail}>{rail}</div>
        {children}
      </div>
    </div>
  );
}

export function RailRows({ rows }: { rows: Array<{ label: string; tip?: string; value: ReactNode }> }) {
  return (
    <div className={s.railRows}>
      {rows.map((r) => (
        <div key={r.label} className={s.railRow}>
          <span className={s.railLabel} title={r.tip}>
            {r.label}
          </span>
          <span className={s.railValue}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className={s.tip} tabIndex={0} aria-label={text}>
      <InfoIcon size={18} />
      <span className={s.tipBubble} role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function Stat({ label, tip, value, secondary }: { label: string; tip?: string; value: ReactNode; secondary?: ReactNode }) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>
        {label}
        {tip ? <InfoTip text={tip} /> : null}
      </span>
      <span className={s.statValue} data-qa="stat-value">
        {value}
      </span>
      {secondary !== undefined ? <span className={s.statSecondary}>{secondary}</span> : null}
    </div>
  );
}

export function TierBadge({ badge, title }: { badge: Badge; title?: string }) {
  return (
    <span className={s.badge} title={title} data-badge={badge.label}>
      <span className={s.badgeDot} style={{ background: TONE_COLOR[badge.tone] }} />
      {badge.label}
    </span>
  );
}

/** "Robinhood | Mainnet" or "Robinhood | Testnet", in Fables' asset badge style. Every live block carries one. */
export function NetworkTag({ network }: { network: "mainnet" | "testnet" }) {
  return (
    <span className={s.assetBadge} data-network={network}>
      <span>Robinhood</span>
      <span className={s.assetDivider} />
      <span className={network === "testnet" ? s.testnet : undefined}>{network === "mainnet" ? "Mainnet" : "Testnet"}</span>
    </span>
  );
}

export function AssetBadge({ name, kind }: { name: string; kind: string }) {
  return (
    <span className={s.assetBadge}>
      <EthMark size={12} />
      <span>{name}</span>
      <span className={s.assetDivider} />
      <span>{kind}</span>
    </span>
  );
}

export function LiveDot({ label = "Live", green }: { label?: string; green?: boolean }) {
  return (
    <span className={s.live}>
      <span className={cx(s.liveDot, green && s.liveDotGreen)} />
      {label}
    </span>
  );
}

export const Skeleton = ({ width }: { width?: number }) => <span className={s.skeleton} style={width ? { width } : undefined} aria-label="loading" />;

export function ButtonLink({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "cta" }) {
  const cls = variant === "primary" ? s.primary : variant === "cta" ? s.cta : s.secondary;
  return href.startsWith("http") ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link className={cls} href={href}>
      {children}
    </Link>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={s.extLink} href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalIcon size={14} />
    </a>
  );
}

export function AddressLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return (
    <a className={s.address} href={href} target="_blank" rel="noreferrer" title={title}>
      {children}
    </a>
  );
}

/** ETH and USDG as two halves of one circle (Fables' pair logo); USDG's mark is Fables' file, ETH's is clim's. */
export function PairLogo({ size = 40 }: { size?: number }) {
  const half = size / 2 - 1;
  return (
    <span className={s.pair} style={{ width: size, height: size }} aria-hidden>
      <span className={s.pairHalf} style={{ left: 0, width: half }}>
        <EthMark size={size} />
      </span>
      <span className={s.pairHalf} style={{ right: 0, width: half }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 2-colour SVG at a fixed size, nothing to optimise */}
        <img src="/fables/tokens_USDG.svg" alt="" width={size} height={size} style={{ marginLeft: -(size - half) }} />
      </span>
    </span>
  );
}

export function ChartPanel({ top, children, legend, style }: { top?: ReactNode; children: ReactNode; legend?: ReactNode; style?: CSSProperties }) {
  return (
    <div className={s.panel} style={style} data-qa="chart-panel">
      {top ? <div className={s.panelTop}>{top}</div> : null}
      {children}
      {legend ? <div className={s.panelLegend}>{legend}</div> : null}
    </div>
  );
}

export function Swatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className={s.swatch}>
      <span className={s.swatchLine} style={dashed ? { background: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 5px)` } : { background: color }} />
      {label}
    </span>
  );
}

export const ReadError = ({ error }: { error: unknown }) => (
  <p className={s.readError} role="alert">
    Read failed: {error instanceof Error ? error.message.split("\n")[0] : String(error)}. Retrying.
  </p>
);

export type LiveKind = "fee" | "avgfee" | "price" | "int" | "count" | "sigma" | "gap" | "mode" | "clock" | "bool";

/** A number read from a chain. The live check (e2e/live.spec.ts) re-reads every [data-live] element's key at its
 *  block and compares both the raw value and the text. */
export function LiveValue({ k, chain, block, raw, text, range }: { k: string; chain: "mainnet" | "testnet"; block: bigint; raw: string | number | bigint | boolean; text: string; range?: { fromBlock: bigint; toBlock: bigint; fromTs: number; toTs: number } }) {
  return (
    <span
      data-live={k}
      data-chain={chain}
      data-block={block.toString()}
      data-raw={String(raw)}
      data-from-block={range?.fromBlock.toString()}
      data-to-block={range?.toBlock.toString()}
      data-from-ts={range?.fromTs}
      data-to-ts={range?.toTs}
      className="tabular"
    >
      {text}
    </span>
  );
}
```

- [ ] **Step 4: Write `app/src/components/ui/FilterToggle.tsx`**

```tsx
"use client";
// Fables' segmented switcher: a radiogroup with a highlight that slides to the active item.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import s from "./ui.module.css";

export function FilterToggle<T extends string>({ options, value, onChange, label }: { options: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[value];
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);
  const style = box ? ({ "--highlight-left": `${box.left}px`, "--highlight-width": `${box.width}px` } as CSSProperties) : undefined;
  return (
    <div className={s.toggle} role="radiogroup" aria-label={label} style={style}>
      <span className={s.toggleHighlight} aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[o.value] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={s.toggleItem}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodButtons<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={s.periods}>
      {options.map((o) => (
        <button key={o} type="button" className={s.period} aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `app/src/components/ui/CopyButton.tsx`**

```tsx
"use client";
import { useState } from "react";
import { CopyIcon } from "./icons";

/** Copies a value to the clipboard (an address, a pool id, calldata). Nothing else. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={done ? "Copied" : `Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      style={{ border: 0, background: "transparent", color: done ? "var(--positive)" : "var(--ink-secondary)", cursor: "pointer", padding: 2, display: "inline-flex" }}
    >
      <CopyIcon />
    </button>
  );
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `cd app && npm run typecheck && npm run lint`
Expected: exit 0, no output from ESLint.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/ui
git commit -m "feat(app): Fables' component catalog rebuilt from the inventory, with LiveValue for chain-read numbers"
```

### Task 14: The shell and its guardrails

**Files:**
- Create: `app/src/lib/site.ts`, `app/src/guardrails.test.tsx`, `app/src/components/shell/shell.module.css`, `Banner.tsx`, `Header.tsx`, `Footer.tsx`, `PromoToast.tsx` (under `app/src/components/shell/`), `app/src/app/icon.svg`
- Replace: `app/src/app/layout.tsx`

- [ ] **Step 1: Write `app/src/lib/site.ts`**

```ts
// The showcase's identity and guardrails (CLAUDE.md, spec §5.5). Tests import these strings: the banner, the nav
// identity and the inert wallet pill are checked on every route.
export const SITE_NAME = "clim × Fables";
export const BANNER_TEXT = "Showcase by clim, not affiliated with Fables";
export const BANNER_DETAIL = "Live data, read only. No wallet, no transaction.";
export const NO_WALLET_TEXT = "Showcase: no wallet";
export const SITE_URL = "https://clim-fables.vercel.app";
export const REPO_URL = "https://github.com/gamween/clim-fables";
export const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;
export const FABLES_APP_URL = "https://www.fables.fi";

export const NAV = [
  { href: "/markets", label: "Markets", icon: "markets" },
  { href: "/integrate", label: "Integrate", icon: "integrate" },
  { href: "/evidence", label: "Evidence", icon: "evidence" },
  { href: "/run", label: "Run", icon: "run" },
] as const;

/** Every route the app serves, for the guardrail and live checks. */
export const ROUTES = ["/", "/markets", "/markets/eth", "/markets/d", "/markets/k", "/markets/f", "/integrate", "/evidence", "/run", "/credits"] as const;
```

- [ ] **Step 2: Write the failing guardrail test `app/src/guardrails.test.tsx`**

```tsx
// The showcase guardrails (CLAUDE.md, spec §5.5), checked without a browser: no wallet library, no code that signs or
// sends, the banner and the nav identity. e2e/guardrails.spec.ts checks the same on every built route.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Banner } from "@/components/shell/Banner";
import { Brand, NoWalletPill } from "@/components/shell/Header";
import { BANNER_TEXT, NO_WALLET_TEXT, ROUTES } from "@/lib/site";
import { RPC_URLS } from "@/lib/rpc";

const APP = join(__dirname, "..");

/** Wallet and signing libraries the app must never depend on. */
const FORBIDDEN_PACKAGES = [/^wagmi$/, /^@wagmi\//, /^@rainbow-me\//, /^@metamask\//, /^@walletconnect\//, /^@reown\//, /^@coinbase\/wallet-sdk$/, /^ethers$/, /^web3$/, /^@web3-onboard\//, /^@privy-io\//, /^@dynamic-labs\//, /^connectkit$/, /^@safe-global\//];

/** Calls that sign, send or ask a wallet for accounts. */
const FORBIDDEN_CODE = /createWalletClient|walletActions|sendTransaction|sendRawTransaction|writeContract|signMessage|signTypedData|signTransaction|privateKeyToAccount|mnemonicToAccount|eth_requestAccounts|eth_sendTransaction|personal_sign|window\.ethereum|wallet_[a-zA-Z]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx|mjs|js)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("no wallet, no transaction", () => {
  it("depends on no wallet or signing library", () => {
    const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => FORBIDDEN_PACKAGES.some((r) => r.test(d)))).toEqual([]);
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["next", "react", "react-dom", "react-markdown", "remark-gfm", "viem"]);
  });
  it("has no code path that signs or sends, vendored code included", () => {
    const hits = sourceFiles(join(APP, "src")).filter((f) => FORBIDDEN_CODE.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("talks to the public Robinhood Chain RPCs only", () => {
    for (const u of [...RPC_URLS.mainnet, ...RPC_URLS.testnet]) expect(new URL(u).protocol).toBe("https:");
    expect(RPC_URLS.mainnet).toContain("https://rpc.mainnet.chain.robinhood.com");
    expect(RPC_URLS.testnet).toContain("https://rpc.testnet.chain.robinhood.com");
  });
});

describe("wording", () => {
  const texts = () => [...sourceFiles(join(APP, "src")).filter((f) => !f.includes("/vendor/") && !f.includes("/generated/")), join(APP, "THIRD_PARTY_NOTICES.md")].map((f) => [f, readFileSync(f, "utf8")] as const);
  it("never claims better fees, only disclaims them", () => {
    for (const [file, text] of texts()) {
      for (const m of text.matchAll(/better fees?/gi)) {
        const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
        expect({ file, disclaimed: /\b(not|no|nothing|never)\b/.test(before) }).toEqual({ file, disclaimed: true });
      }
    }
  });
  it("has no em dash", () => {
    for (const [file, text] of texts()) expect({ file, emDash: text.includes("\u2014") }).toEqual({ file, emDash: false });
  });
});

describe("identity", () => {
  it("renders the permanent banner with no way to dismiss it", () => {
    const html = renderToStaticMarkup(<Banner />);
    expect(html).toContain(BANNER_TEXT);
    expect(html).toContain('data-guard="banner"');
    expect(html).not.toMatch(/<button/);
  });
  it("names the site clim × Fables next to Fables' mark", () => {
    const html = renderToStaticMarkup(<Brand />);
    expect(html.replace(/<[^>]+>/g, "")).toBe("clim×Fables");
    expect(html).toContain('aria-label="clim × Fables, home"');
  });
  it("puts an inert pill where Fables shows Connect", () => {
    const html = renderToStaticMarkup(<NoWalletPill />);
    expect(html).toContain(NO_WALLET_TEXT);
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<(button|a)\b/);
    expect(html.toLowerCase()).not.toContain("connect");
  });
  it("mounts the banner and the header in the root layout", () => {
    const layout = readFileSync(join(APP, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("<Banner />");
    expect(layout).toContain("<Header />");
  });
  it("lists every route the guardrail checks visit", () => {
    expect(ROUTES).toEqual(["/", "/markets", "/markets/eth", "/markets/d", "/markets/k", "/markets/f", "/integrate", "/evidence", "/run", "/credits"]);
  });
});
```

- [ ] **Step 3: Run it**

Run: `cd app && npx vitest run src/guardrails.test.tsx`
Expected: FAIL, `@/components/shell/Banner` does not exist.

- [ ] **Step 4: Write `app/src/components/shell/shell.module.css`**

```css
/* Global shell (docs/research/fables-ui-inventory.md §1): banner 40, header 80, content column 1200, footer. */

.banner {
  position: fixed;
  inset: 0 0 auto 0;
  height: var(--banner-h);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 40px;
  background:
    radial-gradient(280px circle at 168px calc(100% + 26px), rgb(171 199 65 / 0.2), transparent 70%),
    radial-gradient(280px circle at calc(100% - 196px) -26px, rgb(171 199 65 / 0.2), transparent 70%),
    var(--claim-ground);
  box-shadow: inset 0 -1px var(--line-light);
  color: var(--ink);
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: -0.13px;
  overflow: hidden;
}
.banner::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--dot-grid);
  background-size: var(--dot-grid-size);
  mask-image:
    radial-gradient(280px circle at 168px calc(100% + 26px), black, transparent 70%),
    radial-gradient(280px circle at calc(100% - 196px) -26px, black, transparent 70%);
  pointer-events: none;
}
.bannerMark {
  width: 20px;
  height: 13px;
  background: var(--brand);
  mask: url("/fables/logo.svg") center / contain no-repeat;
  flex: none;
}
.bannerMuted {
  color: var(--ink-secondary);
}
@media (max-width: 575px) {
  .banner {
    justify-content: flex-start;
    padding: 0 16px;
    flex-wrap: wrap;
    align-content: center;
    gap: 0 8px;
  }
}

.header {
  position: fixed;
  top: var(--banner-h);
  left: 0;
  right: 0;
  height: var(--nav-h);
  z-index: 9000;
  padding: 0 var(--gutter);
  background: var(--canvas);
  transition: box-shadow var(--dur) ease-in-out;
}
.headerScrolled {
  box-shadow: 0 1px 0 var(--line-light);
}
.headerInner {
  position: relative;
  max-width: var(--max-width);
  height: 100%;
  margin: 0 auto;
  padding: 22px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
}
.brandLogo {
  height: 32px;
  aspect-ratio: 500 / 328;
  background: currentColor;
  mask: url("/fables/logo.svg") center / contain no-repeat;
  transition: color var(--dur-fast);
}
.brand:hover .brandLogo {
  color: var(--brand);
}
.brandText {
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 32px;
  font-weight: 500;
  letter-spacing: 0;
  white-space: nowrap;
}
.brandTimes {
  color: var(--ink-muted);
  padding: 0 0.12em;
}
@media (max-width: 1100px) {
  .brandLogo {
    height: 28px;
  }
  .brandText {
    font-size: 28px;
    line-height: 28px;
  }
}

.nav {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  display: flex;
  gap: 2px;
  padding: 6px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line-light);
  box-shadow: var(--shadow-pill);
}
.navIndicator {
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: var(--nav-left, 6px);
  width: var(--nav-width, 0);
  border-radius: 5px;
  background: var(--raised);
  transition:
    left var(--dur) var(--ease-std),
    width var(--dur) var(--ease-std);
}
.navLink {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  border-radius: 5px;
  color: var(--ink-secondary);
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  --icon-1: var(--ink-faint);
  --icon-2: var(--ink-muted);
  transition:
    background-color var(--dur-fast),
    color var(--dur-fast),
    scale var(--dur-fast);
}
.navLink[aria-current="page"] {
  color: var(--ink);
  --icon-1: var(--ink-muted);
  --icon-2: var(--ink-secondary);
}
@media (hover: hover) and (min-width: 576px) {
  .navLink:not([aria-current="page"]):hover {
    background: var(--raised);
    color: var(--ink);
  }
}
@media (max-width: 1100px) {
  .nav {
    display: none;
  }
}

.right {
  display: flex;
  align-items: center;
  gap: 4px;
}
/* The account chip's slot. The showcase never connects a wallet: this pill is inert. */
.noWallet {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 8px 12px 8px 8px;
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-button), inset 0 0 0 1px var(--line-light);
  color: var(--ink-secondary);
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  cursor: default;
  user-select: none;
  white-space: nowrap;
}
.noWalletDot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: repeating-linear-gradient(135deg, var(--raised) 0 3px, var(--surface) 3px 6px);
  box-shadow: inset 0 0 0 1px var(--line);
}

.menuWrap {
  position: relative;
}
.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 12px);
  width: 234px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-menu);
  transform-origin: top right;
  animation: menuIn 0.1s var(--ease-std);
}
@keyframes menuIn {
  from {
    scale: 0.96;
    translate: 0 -4px;
    opacity: 0;
  }
}
.menuItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 14px;
  line-height: 20px;
  color: var(--ink);
}
.menuItem:hover {
  background: var(--hover);
}
.menuSep {
  height: 1px;
  background: var(--line-light);
  margin: 4px 0;
}

.main {
  flex: 1;
  width: 100%;
  max-width: calc(var(--max-width) + 2 * var(--gutter));
  margin: 0 auto;
  padding: calc(var(--nav-h) + var(--banner-h) + 48px) var(--gutter) 64px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.shell::before {
  content: "";
  position: fixed;
  left: 15vw;
  top: 0;
  width: 70vw;
  height: 100%;
  box-shadow: 0 0 200px 160px var(--canvas);
  z-index: -1;
  pointer-events: none;
}

.footer {
  width: min(100%, calc(var(--max-width) + 2 * var(--gutter)));
  margin: 0 auto;
  padding: 48px var(--gutter);
}
.footerTop {
  display: flex;
  justify-content: space-between;
  gap: 48px;
}
.footerBlurb {
  max-width: 46ch;
  margin-top: 16px;
  color: var(--ink-secondary);
}
.footerCols {
  display: flex;
  gap: 48px 72px;
  flex-wrap: wrap;
}
.footerCol {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.footerTitle {
  font-size: 14px;
  line-height: 1.1;
  font-weight: 450;
  margin-bottom: 4px;
}
.footerLink {
  font-size: 14px;
  line-height: 1.25;
  font-weight: 450;
  color: var(--ink-secondary);
  transition: color var(--dur-fast);
}
.footerLink:hover {
  color: var(--ink);
}
.footerBottom {
  margin-top: 96px;
  display: flex;
  justify-content: flex-end;
  gap: 24px;
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 16px;
  flex-wrap: wrap;
}
@media (max-width: 991px) {
  .footerTop {
    flex-direction: column;
  }
}

.toast {
  position: fixed;
  left: 20px;
  bottom: 16px;
  width: 220px;
  aspect-ratio: 13.75 / 9.1875;
  z-index: 8000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 16px;
  border-radius: var(--radius);
  background-color: var(--card);
  background-image: var(--dot-grid);
  background-size: var(--dot-grid-size);
  box-shadow: inset 0 0 0 1px var(--line-light);
  overflow: hidden;
}
.toastSlide {
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: slideIn var(--dur) var(--ease-std);
}
@keyframes slideIn {
  from {
    opacity: 0;
    translate: 0 3px;
  }
}
.toastBadge {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--brand-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 20px;
}
.toastTitle {
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}
.toastBody {
  font-size: 14px;
  line-height: 19px;
  color: var(--ink-muted);
}
.toastRing {
  position: absolute;
  top: 16px;
  right: 16px;
}
.toastClose {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-muted);
  opacity: 0;
  cursor: pointer;
}
.toast:hover .toastRing {
  opacity: 0;
}
.toast:hover .toastClose {
  opacity: 1;
}
@media (max-width: 575px) {
  .toast {
    left: 16px;
    right: 16px;
    width: auto;
    aspect-ratio: auto;
    min-height: 96px;
  }
}
```

- [ ] **Step 5: Write `app/src/components/shell/Banner.tsx`**

```tsx
import { BANNER_DETAIL, BANNER_TEXT } from "@/lib/site";
import s from "./shell.module.css";

/** Fables' announcement bar, made permanent: no dismiss button, never hidden on scroll. */
export function Banner() {
  return (
    <div className={s.banner} role="note" data-guard="banner" data-qa="banner">
      <span className={s.bannerMark} aria-hidden />
      <strong style={{ fontWeight: 500 }}>{BANNER_TEXT}</strong>
      <span className={s.bannerMuted}>· {BANNER_DETAIL}</span>
    </div>
  );
}
```

- [ ] **Step 6: Write `app/src/components/shell/Header.tsx`**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { EvidenceIcon, ExternalIcon, IntegrateIcon, MarketsIcon, MenuIcon, RunIcon } from "@/components/ui/icons";
import uiStyles from "@/components/ui/ui.module.css";
import { FABLES_APP_URL, NAV, NO_WALLET_TEXT, REPO_URL, repoFile } from "@/lib/site";
import s from "./shell.module.css";

const ICONS = { markets: MarketsIcon, integrate: IntegrateIcon, evidence: EvidenceIcon, run: RunIcon } as const;

export function activeHref(pathname: string): string | null {
  const hit = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return hit ? hit.href : null;
}

/** The brand: Fables' mark next to "clim × Fables", never Fables' logo alone. */
export function Brand() {
  return (
    <Link href="/" className={s.brand} aria-label="clim × Fables, home" data-guard="identity">
      <span className={s.brandLogo} aria-hidden />
      <span className={s.brandText} data-qa="brand-text">
        clim<span className={s.brandTimes}>×</span>Fables
      </span>
    </Link>
  );
}

/** Where Fables shows the account chip or "Connect". Inert: the showcase never connects a wallet. */
export function NoWalletPill() {
  return (
    <span className={s.noWallet} data-guard="no-wallet" aria-disabled="true" title="This showcase has no wallet and sends no transaction">
      <span className={s.noWalletDot} aria-hidden />
      {NO_WALLET_TEXT}
    </span>
  );
}

function NavPill({ pathname }: { pathname: string }) {
  const active = activeHref(pathname);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = active ? refs.current[active] : null;
    setBox(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [active]);
  const style = box ? ({ "--nav-left": `${box.left}px`, "--nav-width": `${box.width}px` } as CSSProperties) : undefined;
  return (
    <nav className={s.nav} aria-label="Main" style={style} data-qa="nav">
      {box ? <span className={s.navIndicator} aria-hidden /> : null}
      {NAV.map((n) => {
        const Icon = ICONS[n.icon];
        return (
          <Link
            key={n.href}
            href={n.href}
            className={s.navLink}
            aria-current={active === n.href ? "page" : undefined}
            ref={(el) => {
              refs.current[n.href] = el;
            }}
          >
            <Icon />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Menu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  const items = [
    ...NAV.map((n) => ({ href: n.href, label: n.label, external: false })),
    { href: "/credits", label: "Credits and licences", external: false },
    { href: REPO_URL, label: "Source on GitHub", external: true },
    { href: repoFile("docs/security.md"), label: "Security", external: true },
    { href: FABLES_APP_URL, label: "Fables' own app", external: true },
  ];
  return (
    <div className={s.menuWrap} ref={wrap}>
      <button type="button" className={uiStyles.iconButton} aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MenuIcon />
      </button>
      {open ? (
        <div className={s.menu} role="menu">
          {items.map((i, k) => (
            <div key={i.href}>
              {k === NAV.length ? <div className={s.menuSep} /> : null}
              {i.external ? (
                <a className={s.menuItem} role="menuitem" href={i.href} target="_blank" rel="noreferrer">
                  {i.label}
                  <ExternalIcon size={14} />
                </a>
              ) : (
                <Link className={s.menuItem} role="menuitem" href={i.href} onClick={() => setOpen(false)}>
                  {i.label}
                </Link>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 0);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`${s.header} ${scrolled ? s.headerScrolled : ""}`} data-qa="header">
      <div className={s.headerInner}>
        <Brand />
        <NavPill pathname={pathname} />
        <div className={s.right}>
          <NoWalletPill />
          <Menu />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 7: Write `app/src/components/shell/Footer.tsx`**

```tsx
import Link from "next/link";
import { FABLES_APP_URL, REPO_URL, repoFile } from "@/lib/site";
import s from "./shell.module.css";

const COLUMNS = [
  { title: "Showcase", links: [["Markets", "/markets"], ["Integrate", "/integrate"], ["Evidence", "/evidence"], ["Run", "/run"]] },
  { title: "Sources", links: [["Repository", REPO_URL], ["Integration guide", repoFile("docs/integrate/README.md")], ["Security", repoFile("docs/security.md")], ["Evidence files", `${REPO_URL}/tree/main/docs/evidence`]] },
  { title: "About", links: [["Credits and licences", "/credits"], ["Fables' own app", FABLES_APP_URL], ["TOKEN2049 submission", "https://github.com/DVB-ANS/clim/tree/token2049-submission"]] },
] as const;

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.footerTop}>
        <div>
          <span className={s.brand}>
            <span className={s.brandLogo} aria-hidden />
            <span className={s.brandText}>
              clim<span className={s.brandTimes}>×</span>Fables
            </span>
          </span>
          <p className={s.footerBlurb}>
            A showcase by clim: a verifiable volatility desk for Fables&apos; dynamic fees on Robinhood Chain. Not affiliated with Fables. Fables&apos; name, logo, art and fonts
            belong to Fables.
          </p>
        </div>
        <div className={s.footerCols}>
          {COLUMNS.map((c) => (
            <div key={c.title} className={s.footerCol}>
              <span className={s.footerTitle}>{c.title}</span>
              {c.links.map(([label, href]) =>
                href.startsWith("http") ? (
                  <a key={label} className={s.footerLink} href={href} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                ) : (
                  <Link key={label} className={s.footerLink} href={href}>
                    {label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className={s.footerBottom}>
        <span>MIT for clim&apos;s code</span>
        <span>Live data read from Robinhood Chain mainnet (Fables) and testnet (clim)</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 8: Write `app/src/components/shell/PromoToast.tsx`**

```tsx
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import s from "./shell.module.css";

const SLIDES = [
  { title: "clim is watching ETH/USDG", body: "Fables' live fee next to clim's, read from the chain.", href: "/markets/eth" },
  { title: "Level 2 is one batch", body: "One AccessManager batch, revocable in one call.", href: "/integrate" },
  { title: "Replay the 7 October storm", body: "clim's pokes on Fables' real hook, on a fork.", href: "/run" },
] as const;
const SLIDE_MS = 7_000;

/** Fables' rotating promo card (bottom left), carrying clim's three entry points. */
export function PromoToast() {
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(id);
  }, []);
  if (hidden) return null;
  const slide = SLIDES[i] ?? SLIDES[0];
  return (
    <aside className={s.toast} aria-label="clim">
      <span className={s.toastBadge} aria-hidden>
        c
      </span>
      <svg className={s.toastRing} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <circle cx="6" cy="6" r="5" fill="none" stroke="var(--raised)" strokeWidth="1.5" />
        <circle key={i} cx="6" cy="6" r="5" fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeDasharray="31.4" strokeDashoffset="31.4" transform="rotate(-90 6 6)">
          <animate attributeName="stroke-dashoffset" from="31.4" to="0" dur={`${SLIDE_MS / 1000}s`} fill="freeze" />
        </circle>
      </svg>
      <button type="button" className={s.toastClose} aria-label="Hide" onClick={() => setHidden(true)}>
        ×
      </button>
      <Link key={slide.href} href={slide.href} className={s.toastSlide}>
        <span className={s.toastTitle}>{slide.title}</span>
        <span className={s.toastBody}>{slide.body}</span>
      </Link>
    </aside>
  );
}
```

- [ ] **Step 9: Replace `app/src/app/layout.tsx` and add clim's own favicon**

`app/src/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import { Banner } from "@/components/shell/Banner";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { PromoToast } from "@/components/shell/PromoToast";
import s from "@/components/shell/shell.module.css";
import { BANNER_TEXT, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: `${BANNER_TEXT}. Fables' live dynamic fee on Robinhood Chain next to clim's verifiable volatility desk, read only.`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#100f0f", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <div className={s.shell}>
          <Banner />
          <Header />
          <main className={s.main}>{children}</main>
          <Footer />
        </div>
        <PromoToast />
      </body>
    </html>
  );
}
```

`app/src/app/icon.svg` (clim's mark, not Fables' favicon):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#100f0f"/><text x="16" y="22" text-anchor="middle" font-family="Georgia, serif" font-size="18" fill="#ccff00">c</text></svg>
```

- [ ] **Step 10: Run the test, typecheck, lint, build**

Run: `cd app && npx vitest run src/guardrails.test.tsx && npm run typecheck && npm run lint && npm run build`
Expected: `Tests  10 passed (10)`, exit 0 for both checks, `✓ Compiled successfully`.

- [ ] **Step 11: Commit**

```bash
git add app/src/lib/site.ts app/src/guardrails.test.tsx app/src/components/shell app/src/app/layout.tsx app/src/app/icon.svg
git commit -m "feat(app): Fables' shell with the permanent non-affiliation banner, clim x Fables identity and an inert no-wallet pill

Guardrail tests: no wallet dependency, no signing or sending code, public RPCs only, no em dash, better fees only disclaimed."
```

### Task 15: The step chart and the data hooks

**Files:**
- Create: `app/src/components/charts/scale.ts`, `scale.test.ts`, `chart.module.css`, `StepChart.tsx` (under `app/src/components/charts/`), `app/src/hooks/usePoll.ts`, `app/src/hooks/useLogHistory.ts`, `app/src/hooks/live.ts`

- [ ] **Step 1: Write the failing test `app/src/components/charts/scale.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { stepArea, stepPath, timeTicks, valueAt, yRange } from "./scale";

const F = { from: 0, to: 100, yMin: 0, yMax: 10, width: 1000, height: 100 };

describe("stepPath", () => {
  it("draws horizontal then vertical segments and runs to the end", () => {
    expect(stepPath([{ t: 0, v: 5 }, { t: 50, v: 10 }], F)).toBe("M0 50 H500 V0 H1000");
  });
  it("clamps a point before the window to its start", () => expect(stepPath([{ t: -20, v: 0 }], F)).toBe("M0 100 H1000"));
  it("is empty without points", () => expect(stepPath([], F)).toBe(""));
  it("closes the area to the baseline", () => expect(stepArea([{ t: 10, v: 5 }], F)).toBe("M100 50 H1000 V100 H100 Z"));
});

describe("valueAt", () => {
  const pts = [{ t: 10, v: 1 }, { t: 20, v: 2 }];
  it("holds a value until the next point", () => expect(valueAt(pts, 15)).toBe(1));
  it("is null before the first point", () => expect(valueAt(pts, 5)).toBeNull());
});

describe("timeTicks", () => {
  it("labels days over a week", () => {
    const from = Date.UTC(2026, 9, 7, 12) / 1000;
    const ticks = timeTicks(from, from + 7 * 86_400);
    expect(ticks.map((t) => t.label)).toEqual(["Oct 8", "Oct 9", "Oct 10", "Oct 11", "Oct 12", "Oct 13", "Oct 14"]);
  });
  it("labels hours over a day", () => {
    const from = Date.UTC(2026, 9, 14, 0, 30) / 1000;
    expect(timeTicks(from, from + 86_400).map((t) => t.label)).toEqual(["04:00", "08:00", "12:00", "16:00", "20:00", "00:00"]);
  });
  it("labels quarter hours over the 90-minute run", () => {
    // the fork run's window, 1791337200 .. 1791342600 (2026-10-07 01:40 to 03:10 UTC)
    expect(timeTicks(1791337200, 1791342600).map((t) => t.label)).toEqual(["01:45", "02:00", "02:15", "02:30", "02:45", "03:00"]);
  });
});

it("gives the y range some headroom", () => {
  expect(yRange([700, 6000])).toEqual({ yMin: 0, yMax: 6480 });
  expect(yRange([])).toEqual({ yMin: 0, yMax: 1 });
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run src/components/charts`
Expected: FAIL, `./scale` does not exist.

- [ ] **Step 3: Write `app/src/components/charts/scale.ts`**

```ts
// Pure geometry of Fables-style step charts: an SVG path of H/V segments (Fables draws its fee line this way) and the
// time ticks under it.
import { formatDayTick, formatHourTick } from "@/lib/format";

export type Point = { t: number; v: number };
export type Frame = { from: number; to: number; yMin: number; yMax: number; width: number; height: number };

export const xOf = (f: Frame, t: number) => ((t - f.from) / (f.to - f.from)) * f.width;
export const yOf = (f: Frame, v: number) => f.height - ((v - f.yMin) / (f.yMax - f.yMin)) * f.height;

const r = (n: number) => Math.round(n * 100) / 100;

/** "M x0 y0 H x1 V y1 ... H xEnd": each value holds until the next point, the last one until `to`. Points before
 *  `from` are clamped to it. */
export function stepPath(points: readonly Point[], f: Frame): string {
  if (points.length === 0) return "";
  const parts: string[] = [];
  points.forEach((p, i) => {
    const x = r(xOf(f, Math.max(p.t, f.from)));
    const y = r(yOf(f, p.v));
    parts.push(i === 0 ? `M${x} ${y}` : `H${x} V${y}`);
  });
  parts.push(`H${r(f.width)}`);
  return parts.join(" ");
}

/** The step path closed down to the baseline, for the area under the line. */
export function stepArea(points: readonly Point[], f: Frame): string {
  const line = stepPath(points, f);
  if (!line) return "";
  const first = points[0] as Point;
  return `${line} V${r(f.height)} H${r(xOf(f, Math.max(first.t, f.from)))} Z`;
}

/** The value in force at `t`, or null before the first point. */
export function valueAt(points: readonly Point[], t: number): number | null {
  let v: number | null = null;
  for (const p of points) {
    if (p.t > t) break;
    v = p.v;
  }
  return v;
}

const STEPS = [300, 900, 1800, 3600, 7200, 14_400, 21_600, 43_200, 86_400];

/** At most `max` ticks on round UTC times: days ("Oct 9") for windows over two days, hours ("14:00") otherwise. */
export function timeTicks(from: number, to: number, max = 8): Array<{ t: number; label: string }> {
  const span = to - from;
  const step = span > 2 * 86_400 ? 86_400 : (STEPS.find((s) => span / s <= max) ?? 86_400);
  const out: Array<{ t: number; label: string }> = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push({ t, label: step >= 86_400 ? formatDayTick(t) : formatHourTick(t) });
  return out;
}

/** A y range that shows every series with a little headroom; never below 0. */
export function yRange(values: readonly number[], floor = 0): { yMin: number; yMax: number } {
  if (values.length === 0) return { yMin: floor, yMax: floor + 1 };
  const max = Math.max(...values);
  return { yMin: floor, yMax: max <= floor ? floor + 1 : floor + (max - floor) * 1.08 };
}
```

- [ ] **Step 4: Run it**

Run: `cd app && npx vitest run src/components/charts`
Expected: `Tests  10 passed (10)`.

- [ ] **Step 5: Write `app/src/components/charts/chart.module.css`**

```css
/* Fables' chart plot: 249 tall, dot grid, top and bottom fade; crosshair, dot and a 200 px tooltip on hover. */
.plot {
  position: relative;
  height: var(--plot-h, 249px);
  margin: 8px 0 0;
  background-image: var(--dot-grid);
  background-size: var(--dot-grid-size);
  touch-action: pan-y;
}
.svg {
  position: absolute;
  inset: 0 0 22px 0;
  width: 100%;
  height: calc(100% - 22px);
  overflow: visible;
}
.svg path {
  vector-effect: non-scaling-stroke;
}
.reveal {
  animation: reveal 0.9s cubic-bezier(0.65, 0, 0.35, 1);
}
@keyframes reveal {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}
.ticks {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 22px;
}
.tick {
  position: absolute;
  bottom: 4px;
  translate: -50% 0;
  color: var(--ink-secondary);
  font-size: 11px;
  line-height: 14px;
  white-space: nowrap;
}
.crosshair {
  position: absolute;
  top: 0;
  bottom: 22px;
  width: 1px;
  background: var(--line-interactive);
  pointer-events: none;
}
.dot {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  border: 2px solid var(--card);
  pointer-events: none;
}
.tooltip {
  position: absolute;
  top: 8px;
  min-width: 200px;
  padding: 6px 8px 4px;
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-menu);
  pointer-events: none;
  z-index: 5;
  font-size: 12px;
  line-height: 16px;
}
.tooltipHead {
  font-weight: 500;
  margin-bottom: 4px;
}
.tooltipRow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
}
.tooltipLabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-secondary);
}
.tooltipDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.tooltipValue {
  font-variant-numeric: lining-nums tabular-nums;
}
.empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.loadingMark {
  width: 56px;
  height: 37px;
  background: var(--ink);
  mask: url("/fables/logo.svg") center / contain no-repeat;
  animation: breathe 1.5s ease-in-out infinite;
}
@keyframes breathe {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 0.12;
  }
}
```

- [ ] **Step 6: Write `app/src/components/charts/StepChart.tsx`**

```tsx
"use client";
import { useId, useRef, useState, type CSSProperties } from "react";
import { formatTooltipTime } from "@/lib/format";
import s from "./chart.module.css";
import { stepArea, stepPath, timeTicks, valueAt, xOf, yOf, yRange, type Frame, type Point } from "./scale";

export type Series = { id: string; label: string; color: string; points: Point[]; dashed?: boolean; area?: boolean };
export type Marker = { t: number; v: number; color: string };

const W = 1000;
const H = 227;

/** A step chart in Fables' style: lines drawn with H/V segments, a crosshair, a dot per series and a tooltip with one
 *  row per series. Values are fees in pips; `format` turns them into text. */
export function StepChart({ series, from, to, format, height = 249, markers = [], loading = false, empty }: {
  series: Series[];
  from: number;
  to: number;
  format: (v: number) => string;
  height?: number;
  markers?: Marker[];
  loading?: boolean;
  empty?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const values = [...series.flatMap((x) => x.points.map((p) => p.v)), ...markers.map((m) => m.v)];
  const f: Frame = { from, to, ...yRange(values), width: W, height: H };
  const hasData = series.some((x) => x.points.length > 0);

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHoverT(from + frac * (to - from));
  };

  const hx = hoverT === null ? 0 : (xOf(f, hoverT) / W) * 100;
  const plotH = height - 22;
  return (
    <div className={s.plot} style={{ "--plot-h": `${height}px` } as CSSProperties} ref={box} onPointerMove={onMove} onPointerLeave={() => setHoverT(null)}>
      {loading || !hasData ? (
        <div className={s.empty}>{loading ? <span className={s.loadingMark} aria-label="loading" /> : <span style={{ color: "var(--ink-muted)" }}>{empty ?? "No data in this window"}</span>}</div>
      ) : (
        <svg className={`${s.svg} ${s.reveal}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            {series.map((x) => (
              <linearGradient key={x.id} id={`${gid}-${x.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={x.color} stopOpacity={0.4} />
                <stop offset="100%" stopColor={x.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {series.map((x) => (x.area ? <path key={`a-${x.id}`} d={stepArea(x.points, f)} fill={`url(#${gid}-${x.id})`} stroke="none" /> : null))}
          {series.map((x) => (
            <path key={x.id} d={stepPath(x.points, f)} fill="none" stroke={x.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={x.dashed ? "4 3" : undefined} data-series={x.id} />
          ))}
          {markers.map((m, i) => (
            <circle key={i} cx={xOf(f, m.t)} cy={yOf(f, m.v)} r={3} fill={m.color} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}
      <div className={s.ticks} aria-hidden>
        {timeTicks(from, to).map((t) => (
          <span key={t.t} className={s.tick} style={{ left: `${(xOf(f, t.t) / W) * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      {hoverT !== null && hasData && !loading ? (
        <>
          <span className={s.crosshair} style={{ left: `${hx}%` }} />
          {series.map((x) => {
            const v = valueAt(x.points, hoverT);
            return v === null ? null : <span key={x.id} className={s.dot} style={{ left: `${hx}%`, top: (yOf(f, v) / H) * plotH, background: x.color }} />;
          })}
          <div className={s.tooltip} style={hx > 60 ? { right: `calc(${100 - hx}% + 12px)` } : { left: `calc(${hx}% + 12px)` }}>
            <div className={s.tooltipHead}>{formatTooltipTime(Math.round(hoverT))}</div>
            {series.map((x) => {
              const v = valueAt(x.points, hoverT);
              return (
                <div key={x.id} className={s.tooltipRow}>
                  <span className={s.tooltipLabel}>
                    <span className={s.tooltipDot} style={{ background: x.color }} />
                    {x.label}
                  </span>
                  <span className={s.tooltipValue}>{v === null ? "-" : format(v)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Write `app/src/hooks/usePoll.ts`**

```ts
"use client";
import { useEffect, useRef, useState } from "react";

export type Polled<T> = { data: T | null; error: unknown; updatedAt: number | null };

/** Calls `fn` now and every `intervalMs` while the tab is visible; keeps the last good value when a call fails.
 *  A new `key` starts over. */
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number, key = ""): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: null, error: null, updatedAt: null });
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState !== "hidden") {
        try {
          const data = await fnRef.current();
          if (alive) setState({ data, error: null, updatedAt: Date.now() });
        } catch (error) {
          if (alive) setState((s) => ({ ...s, error }));
        }
      }
      if (alive) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [intervalMs, key]);
  return state;
}
```

- [ ] **Step 8: Write `app/src/hooks/useLogHistory.ts`**

```ts
"use client";
import { useRef } from "react";
import type { PublicClient } from "viem";
import { blockTime, firstBlockAtOrAfter } from "@/lib/chain/blockTimes";
import { laggedHead, withRetry } from "@/lib/chain/retry";
import { usePoll } from "./usePoll";

export type History<T> = {
  items: T[];
  /** Every log of [fromBlock, toBlock] was read; fromBlock is the first block at or after toTs - windowSec - lookbackSec. */
  fromBlock: bigint;
  toBlock: bigint;
  toTs: number;
  windowSec: number;
};

type Options<T> = {
  key: string;
  client: () => PublicClient;
  read: (client: PublicClient, fromBlock: bigint, toBlock: bigint) => Promise<T[]>;
  windowSec: number;
  /** Extra history before the window (a poke's TTL), so the state at the window's start is known. */
  lookbackSec: number;
  minBlockSec: number;
  pollMs: number;
};

/** Logs over a sliding time window whose first block is found exactly from block timestamps: the first call reads the
 *  whole window (in ranges the RPC accepts), each next one only the blocks since the last call, and drops the items
 *  that fell out of the window. */
export function useLogHistory<T extends { block: bigint }>(o: Options<T>) {
  const state = useRef<{ key: string; history: History<T> | null }>({ key: o.key, history: null });
  return usePoll<History<T>>(
    async () => {
      if (state.current.key !== o.key) state.current = { key: o.key, history: null };
      const client = o.client();
      const toBlock = laggedHead(await withRetry(() => client.getBlockNumber({ cacheTime: 0 })));
      const toTs = await blockTime(client, toBlock);
      const fromBlock = await firstBlockAtOrAfter(client, toTs - o.windowSec - o.lookbackSec, toBlock, toTs, o.minBlockSec);
      const prev = state.current.history;
      let items: T[];
      if (prev === null || fromBlock < prev.fromBlock) {
        items = await o.read(client, fromBlock, toBlock);
      } else {
        items = toBlock > prev.toBlock ? [...prev.items, ...(await o.read(client, prev.toBlock + 1n, toBlock))] : prev.items;
      }
      const next = { items: items.filter((x) => x.block >= fromBlock), fromBlock, toBlock, toTs, windowSec: o.windowSec };
      state.current = { key: o.key, history: next };
      return next;
    },
    o.pollMs,
    o.key,
  );
}
```

- [ ] **Step 9: Write `app/src/hooks/live.ts`**

```ts
"use client";
// The app's live reads. Polling: 15 s for the current state, 30 s for logs (only the new blocks are read).
import type { LivePoolName } from "@clim/shared";
import { mainnetClient, testnetClient } from "@/lib/chain/clients";
import { LIVE, TESTNET_MIN_BLOCK_SEC } from "@/lib/chain/deployments";
import { FABLES } from "@/lib/chain/fables";
import { POOL_LOOKBACK_SEC, readClimPoints, readDeskReports, readLevel2Roles, readPoolOverrides } from "@/lib/chain/readClim";
import { readClimNow } from "@/lib/chain/readClimNow";
import { readFablesNow, readFablesPokes, readSwaps } from "@/lib/chain/readFables";
import { useLogHistory } from "./useLogHistory";
import { usePoll } from "./usePoll";

export const NOW_POLL_MS = 15_000;
export const LOG_POLL_MS = 30_000;

export const useFablesNow = () => usePoll(() => readFablesNow(mainnetClient()), NOW_POLL_MS, "fables-now");
export const useClimNow = () => usePoll(() => readClimNow(testnetClient()), NOW_POLL_MS, "clim-now");
export const useLevel2Roles = () => usePoll(() => readLevel2Roles(testnetClient()), 60_000, "roles");

/** Fables' keeper overrides over the window, plus one TTL before it (an override posted then may still be live). */
export const useFablesPokes = (windowSec: number) =>
  useLogHistory({ key: `fables-pokes-${windowSec}`, client: mainnetClient, read: readFablesPokes, windowSec, lookbackSec: FABLES.pokeTtlSec, minBlockSec: FABLES.minBlockSec, pollMs: LOG_POLL_MS });

/** clim's recommendation at each report (ClimPoker's Poked logs), plus one minute before the window. */
export const useClimPoints = (windowSec: number) =>
  useLogHistory({ key: `clim-points-${windowSec}`, client: testnetClient, read: readClimPoints, windowSec, lookbackSec: 60, minBlockSec: TESTNET_MIN_BLOCK_SEC, pollMs: LOG_POLL_MS });

export const useDeskReports = (windowSec: number) =>
  useLogHistory({ key: `desk-${windowSec}`, client: testnetClient, read: readDeskReports, windowSec, lookbackSec: 0, minBlockSec: TESTNET_MIN_BLOCK_SEC, pollMs: LOG_POLL_MS });

/** A testnet pool's overrides (readPoolOverrides), with one TTL of history before the window. */
export const usePoolPokes = (pool: LivePoolName, windowSec: number) =>
  useLogHistory({
    key: `pool-${pool}-${windowSec}`,
    client: testnetClient,
    read: (c, a, b) => readPoolOverrides(c, pool, a, b),
    windowSec,
    lookbackSec: POOL_LOOKBACK_SEC[pool],
    minBlockSec: TESTNET_MIN_BLOCK_SEC,
    pollMs: LOG_POLL_MS,
  });

export const useFablesSwaps = (windowSec: number) =>
  useLogHistory({
    key: `fables-swaps-${windowSec}`,
    client: mainnetClient,
    read: (c, a, b) => readSwaps(c, FABLES.poolManager, FABLES.poolId, a, b),
    windowSec,
    lookbackSec: 0,
    minBlockSec: FABLES.minBlockSec,
    pollMs: LOG_POLL_MS,
  });

export const usePoolSwaps = (pool: LivePoolName, windowSec: number) =>
  useLogHistory({
    key: `pool-swaps-${pool}-${windowSec}`,
    client: testnetClient,
    read: (c, a, b) => readSwaps(c, LIVE.uniswap.poolManager, LIVE.pools[pool].poolId, a, b),
    windowSec,
    lookbackSec: 0,
    minBlockSec: TESTNET_MIN_BLOCK_SEC,
    pollMs: LOG_POLL_MS,
  });
```

- [ ] **Step 10: Typecheck and lint**

Run: `cd app && npm run typecheck && npm run lint`
Expected: exit 0, no ESLint output.

- [ ] **Step 11: Commit**

```bash
git add app/src/components/charts app/src/hooks/usePoll.ts app/src/hooks/useLogHistory.ts app/src/hooks/live.ts
git commit -m "feat(app): Fables-style step chart, polling and sliding log windows read incrementally"
```

### Task 16: Pool parts and the markets list

**Files:**
- Create: `app/src/components/pages.module.css`, `app/src/components/pool/parts.tsx`, `app/src/components/markets/MarketsTable.tsx`, `app/src/components/markets/MarketsHeadStats.tsx`, `app/src/app/markets/page.tsx`

- [ ] **Step 1: Write `app/src/components/pages.module.css`**

```css
/* Page-level layouts: markets head, pool header and stat row, row tables, params card (inventory §2.2, §2.3). */

.pageHead {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 32px;
  flex-wrap: wrap;
}
.pageTitle {
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 33.6px;
  font-weight: 500;
  letter-spacing: 0;
}
.pageDesc {
  margin-top: 8px;
  color: var(--ink-muted);
  line-height: 18.9px;
}
.headStats {
  display: flex;
  gap: 32px;
}
.headStats > * + * {
  border-left: 1px solid var(--line-light);
  padding-left: 32px;
}
.headValue {
  font-size: 24px;
  line-height: 24px;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 48px;
}
.filterBar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* Pool page: content 1040 wide inside the 1200 column (padding 80 on each side), top 144 from the page top. */
.pool {
  width: 100%;
  max-width: 1040px;
  margin: -24px auto 0;
  display: flex;
  flex-direction: column;
  gap: 48px;
}
.poolHead {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-secondary);
  width: fit-content;
}
.back:hover {
  color: var(--ink);
}
.identity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.identityLeft {
  display: flex;
  align-items: center;
  gap: 16px;
}
.pairTitle {
  font-size: 28px;
  line-height: 33.6px;
  font-weight: 500;
}
.pairSub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-weight: 500;
  flex-wrap: wrap;
}
.pairSubMuted {
  font-weight: 400;
  color: var(--ink-secondary);
}
.actions {
  display: flex;
  gap: 8px;
}
.statRow {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 32px;
}
.statRow > * {
  padding-right: 32px;
  border-right: 1px solid var(--line-light);
}
.statRow > *:last-child {
  border-right: 0;
  padding-right: 0;
}
@media (max-width: 1140px) {
  .statRow {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
  .statRow > * {
    border-right: 0;
    padding-right: 0;
  }
}
@media (max-width: 575px) {
  .statRow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* Row table: separate rows 8 px apart, head cells on canvas, body cells on surface, rounded row ends. */
.tableWrap {
  overflow-x: auto;
}
.table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 8px;
  margin: -8px 0;
}
.table th {
  height: 50px;
  padding: 12px 16px;
  background: var(--canvas);
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: -0.13px;
  text-align: left;
  white-space: nowrap;
}
.table th:first-child,
.table td:first-child {
  border-radius: var(--radius) 0 0 var(--radius);
}
.table th:last-child,
.table td:last-child {
  border-radius: 0 var(--radius) var(--radius) 0;
}
.table td {
  height: 56px;
  padding: 0 16px;
  background: var(--surface);
  transition: background-color var(--dur);
  white-space: nowrap;
}
.table tbody tr:hover td {
  background: var(--canvas);
}
.tall td {
  height: 76px;
}
.num {
  text-align: right !important;
  font-variant-numeric: lining-nums tabular-nums;
}
.marketCell {
  display: flex;
  align-items: center;
  gap: 12px;
}
.marketName {
  font-weight: 500;
  display: block;
  margin-bottom: 4px;
}
.chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  color: var(--ink-secondary);
}
.chevron:hover {
  background: var(--raised-hover);
  color: var(--ink);
}
.typeDot {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.typeDot::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dot, var(--ink-faint));
}
.muted {
  color: var(--ink-secondary);
}
.txCard {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 20px 20px 12px;
  box-shadow: var(--shadow-table);
}
.txCard .table td {
  background: var(--surface);
}
.txCard .table tbody tr:hover td {
  background: var(--canvas);
}

/* Params card: two columns, rows padding 10 0, odd rows with a right hairline. */
.params {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 10px 20px;
  background: var(--card);
  border-radius: var(--radius);
}
.param {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
}
.param:nth-child(odd) {
  border-right: 1px solid var(--line-light);
  padding-right: 20px;
}
.param:nth-child(even) {
  padding-left: 20px;
}
.paramLabel {
  color: var(--ink-secondary);
  text-decoration: underline dashed var(--line-interactive);
  text-underline-offset: 4px;
}
.paramValue {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  font-variant-numeric: lining-nums tabular-nums;
}
@media (max-width: 640px) {
  .params {
    grid-template-columns: 1fr;
  }
  .param:nth-child(odd) {
    border-right: 0;
    padding-right: 0;
  }
  .param:nth-child(even) {
    padding-left: 0;
  }
}

.note {
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 20px;
}
.split {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.splitLabel {
  color: var(--ink-secondary);
  font-size: 14px;
  font-weight: 400;
}
```

- [ ] **Step 2: Write `app/src/components/pool/parts.tsx`**

```tsx
// Pieces shared by the pool pages: the fee value (one or two directions), the Dynamic Fee rail, the params card and the
// transactions table, each in Fables' layout.
import Link from "next/link";
import type { ReactNode } from "react";
import { AddressLink, LiveValue, NetworkTag, PairLogo, RailRows, Rule, Skeleton, Stat } from "@/components/ui/kit";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { CopyButton } from "@/components/ui/CopyButton";
import type { SwapRow } from "@/lib/chain/decode";
import { formatAge, formatAmount, formatAvgFeePct, formatFeePct, formatInt, shortAddress } from "@/lib/format";
import type { FeeWindow } from "@/lib/windowStats";
import p from "../pages.module.css";

type Chain = "mainnet" | "testnet";

/** One fee when both directions pay the same, "Sell / Buy" otherwise (ETH is currency0: zero-for-one sells ETH). */
export function FeeValue({ prefix, chain, block, fee0For1, fee1For0 }: { prefix: string; chain: Chain; block: bigint; fee0For1: number; fee1For0: number }) {
  if (fee0For1 === fee1For0) {
    return (
      <span>
        <LiveValue k={`${prefix}:fee0For1`} chain={chain} block={block} raw={fee0For1} text={formatFeePct(fee0For1)} />
        <span hidden>
          <LiveValue k={`${prefix}:fee1For0`} chain={chain} block={block} raw={fee1For0} text={formatFeePct(fee1For0)} />
        </span>
      </span>
    );
  }
  return (
    <span className={p.split}>
      <span className={p.splitLabel}>Buy</span>
      <LiveValue k={`${prefix}:fee1For0`} chain={chain} block={block} raw={fee1For0} text={formatFeePct(fee1For0)} />
      <span className={p.splitLabel}>Sell</span>
      <LiveValue k={`${prefix}:fee0For1`} chain={chain} block={block} raw={fee0For1} text={formatFeePct(fee0For1)} />
    </span>
  );
}

export function PoolHeader({ title, network, sub, actions }: { title: string; network: Chain; sub: ReactNode; actions?: ReactNode }) {
  return (
    <div className={p.poolHead} data-qa="pool-head">
      <Link href="/markets" className={p.back}>
        <ArrowLeftIcon /> Back
      </Link>
      <div className={p.identity}>
        <div className={p.identityLeft}>
          <PairLogo size={61} />
          <div>
            <h1 className={p.pairTitle}>{title}</h1>
            <div className={p.pairSub}>
              {sub}
              <NetworkTag network={network} />
            </div>
          </div>
        </div>
        {actions ? <div className={p.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}

/** Fables' Dynamic Fee rail: the current fee, its average over the window, then peak, low and changes. */
export function FeeRail({ prefix, chain, current, win, history, label, extra }: {
  prefix: string;
  chain: Chain;
  current: ReactNode;
  win: FeeWindow | null;
  history: { fromBlock: bigint; toBlock: bigint } | null;
  label: string;
  extra?: Array<{ label: string; tip?: string; value: ReactNode }>;
}) {
  const range = win && history ? { fromBlock: history.fromBlock, toBlock: history.toBlock, fromTs: win.fromTs, toTs: win.toTs } : undefined;
  const v = (k: string, raw: number | null, text: string) =>
    range && raw !== null && history ? <LiveValue k={`${prefix}:${k}`} chain={chain} block={history.toBlock} raw={raw} text={text} range={range} /> : <Skeleton />;
  return (
    <>
      <Stat
        label="Current fee"
        tip="The fee a swap pays now, read from the hook's currentFee"
        value={current}
        secondary={win && range ? <span>{v("avg", win.avg, formatAvgFeePct(win.avg))} average over {label}</span> : <Skeleton width={160} />}
      />
      <Rule />
      <RailRows
        rows={[
          { label: "Peak", tip: `The dearest this market's fee has been in the last ${label}`, value: v("peak", win?.peak ?? null, formatFeePct(win?.peak)) },
          { label: "Low", tip: `The cheapest this market's fee has been in the last ${label}`, value: v("low", win?.low ?? null, formatFeePct(win?.low)) },
          { label: "Changes", tip: "How many overrides were posted in the window (FeePoked logs)", value: v("changes", win?.changes ?? null, formatInt(win?.changes)) },
          ...(extra ?? []),
        ]}
      />
    </>
  );
}

export function ParamsCard({ rows }: { rows: Array<{ label: string; tip?: string; value: ReactNode; copy?: string }> }) {
  return (
    <div className={p.params}>
      {rows.map((r) => (
        <div key={r.label} className={p.param}>
          <span className={p.paramLabel} title={r.tip}>
            {r.label}
          </span>
          <span className={p.paramValue}>
            {r.value}
            {r.copy ? <CopyButton value={r.copy} label={r.label} /> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Fables' "Recent transactions" table, for swaps: newest first. Times are read for the rows shown only. */
export function SwapsTable({ swaps, times, nowTs, txUrl }: { swaps: readonly SwapRow[]; times: ReadonlyMap<bigint, number> | null; nowTs: number; txUrl: (tx: string) => string }) {
  return (
    <div className={p.txCard}>
      <div className={p.tableWrap}>
        <table className={p.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th className={p.num}>ETH</th>
              <th className={p.num}>USDG</th>
              <th className={p.num}>Fee paid</th>
              <th className={p.num}>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {swaps.length === 0 ? (
              <tr>
                <td colSpan={6} className={p.muted}>
                  No swap in this window
                </td>
              </tr>
            ) : (
              swaps.map((s) => {
                const t = times?.get(s.block);
                return (
                  <tr key={`${s.tx}-${s.logIndex}`}>
                    <td title={t === undefined ? undefined : new Date(t * 1000).toISOString()}>{t === undefined ? "-" : formatAge(nowTs - t)}</td>
                    <td>
                      <span className={p.typeDot} style={{ ["--dot" as string]: s.side === "buy" ? "var(--positive)" : "var(--negative)" }}>
                        {s.side === "buy" ? "Buy ETH" : "Sell ETH"}
                      </span>
                    </td>
                    <td className={p.num}>{formatAmount(s.eth)}</td>
                    <td className={p.num}>{formatAmount(s.usdg, 2)}</td>
                    <td className={p.num}>{formatFeePct(s.feePips)}</td>
                    <td className={p.num}>
                      <AddressLink href={txUrl(s.tx)}>{shortAddress(s.tx)}</AddressLink>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `app/src/components/markets/MarketsTable.tsx`**

```tsx
"use client";
// Fables' markets table with a "Fee source" column. TVL, volume and APR come from Fables' own indexer and are not
// readable per pool from the chain, so the showcase shows what the chain gives: the price, the fee a swap pays now and
// who sets it.
import Link from "next/link";
import { useState } from "react";
import { FilterToggle } from "@/components/ui/FilterToggle";
import { AssetBadge, InfoTip, LiveValue, NetworkTag, PairLogo, ReadError, Skeleton, TierBadge } from "@/components/ui/kit";
import { ChevronRightIcon } from "@/components/ui/icons";
import { FeeValue } from "@/components/pool/parts";
import { useClimNow, useFablesNow } from "@/hooks/live";
import { formatPrice } from "@/lib/format";
import { FEE_SOURCE, feeTier, type FeeSource } from "@/lib/tiers";
import { FABLES } from "@/lib/chain/fables";
import { LIVE } from "@/lib/chain/deployments";
import p from "../pages.module.css";

type Filter = "all" | "mainnet" | "testnet";
type Row = { key: FeeSource; href: string; name: string; network: "mainnet" | "testnet"; asset: [string, string] };

export const MARKET_ROWS: Row[] = [
  { key: "fables", href: "/markets/eth", name: "ETH/USDG", network: "mainnet", asset: ["Ethereum", "Crypto"] },
  { key: "D", href: "/markets/d", name: "tETH/tUSDG · D", network: "testnet", asset: ["Test ETH", "clim"] },
  { key: "K", href: "/markets/k", name: "tETH/tUSDG · K", network: "testnet", asset: ["Test ETH", "Keeper-style"] },
  { key: "F", href: "/markets/f", name: "tETH/tUSDG · F", network: "testnet", asset: ["Test ETH", "Flat"] },
];

export function MarketsTable({ filterable = false, limit }: { filterable?: boolean; limit?: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const fables = useFablesNow();
  const clim = useClimNow();
  const rows = MARKET_ROWS.filter((r) => filter === "all" || r.network === filter).slice(0, limit);

  const cells = (r: Row) => {
    if (r.key === "fables") {
      const f = fables.data;
      return {
        price: f ? <LiveValue k="fables:price" chain="mainnet" block={f.blockNumber} raw={f.sqrtPriceX96} text={formatPrice(f.price)} /> : <Skeleton />,
        fee: f ? <FeeValue prefix="fables" chain="mainnet" block={f.blockNumber} fee0For1={f.fee0For1} fee1For0={f.fee1For0} /> : <Skeleton />,
        tier: f ? feeTier(Math.max(f.fee0For1, f.fee1For0), FABLES.config.flatPips) : null,
      };
    }
    const c = clim.data;
    const pool = c?.pools[r.key];
    return {
      price: c && pool ? <LiveValue k={`pool:${r.key}:price`} chain="testnet" block={c.quote.blockNumber} raw={pool.sqrtPriceX96} text={formatPrice(pool.price)} /> : <Skeleton />,
      fee: c && pool ? <FeeValue prefix={`pool:${r.key}`} chain="testnet" block={c.quote.blockNumber} fee0For1={pool.fee0For1} fee1For0={pool.fee1For0} /> : <Skeleton />,
      tier: pool ? feeTier(Math.max(pool.fee0For1, pool.fee1For0), LIVE.hookConfig.flatPips) : null,
    };
  };

  return (
    <>
      {filterable ? (
        <div className={p.filterBar}>
          <FilterToggle
            label="Network"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All networks" },
              { value: "mainnet", label: "Mainnet" },
              { value: "testnet", label: "Testnet" },
            ]}
          />
        </div>
      ) : null}
      <div className={p.tableWrap}>
        <table className={`${p.table} ${p.tall}`} data-qa="markets-table">
          <thead>
            <tr>
              <th>Market</th>
              <th className={p.num}>Price</th>
              <th className={p.num}>Current fee</th>
              <th>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Fee source <InfoTip text="Who sets each pool's fee: Fables' keeper on mainnet; on testnet, clim (pool D), a keeper-style bot (K) or nobody (F, flat)" />
                </span>
              </th>
              <th>Network</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = cells(r);
              const src = FEE_SOURCE[r.key];
              return (
                <tr key={r.key} data-market={r.key}>
                  <td>
                    <Link href={r.href} className={p.marketCell}>
                      <PairLogo size={40} />
                      <span>
                        <span className={p.marketName}>{r.name}</span>
                        <AssetBadge name={r.asset[0]} kind={r.asset[1]} />
                      </span>
                    </Link>
                  </td>
                  <td className={p.num}>{c.price}</td>
                  <td className={p.num}>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                      {c.fee}
                      {c.tier ? <TierBadge badge={c.tier} /> : null}
                    </span>
                  </td>
                  <td>
                    <TierBadge badge={src} title={src.note} />
                  </td>
                  <td>
                    <NetworkTag network={r.network} />
                  </td>
                  <td className={p.num}>
                    <Link href={r.href} className={p.chevron} aria-label={`Open ${r.name}`}>
                      <ChevronRightIcon />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {fables.error ? <ReadError error={fables.error} /> : null}
      {clim.error ? <ReadError error={clim.error} /> : null}
    </>
  );
}
```

- [ ] **Step 4: Write `app/src/components/markets/MarketsHeadStats.tsx`**

```tsx
"use client";
import { InfoTip, LiveValue, Skeleton } from "@/components/ui/kit";
import { useClimNow, useFablesPokes } from "@/hooks/live";
import { formatInt } from "@/lib/format";
import { feeWindow } from "@/lib/windowStats";
import { FABLES } from "@/lib/chain/fables";
import p from "../pages.module.css";
import u from "../ui/ui.module.css";

/** Fables' header stats slot ("Daily Fees", "Lifetime Fees"), holding what the chain gives: the keeper's overrides in
 *  24 hours and the desk's report counter. */
export function MarketsHeadStats() {
  const pokes = useFablesPokes(86_400);
  const clim = useClimNow();
  const win = pokes.data ? feeWindow(pokes.data.items, FABLES.config, pokes.data.toTs, 86_400) : null;
  return (
    <dl className={p.headStats} style={{ margin: 0 }}>
      <div>
        <dt className={u.statLabel}>
          Keeper overrides (24h) <InfoTip text="FeePoked logs of Fables' ETH/USDG hook over the last 24 hours (mainnet)" />
        </dt>
        <dd className={`${u.statValue} ${p.headValue}`} style={{ margin: "4px 0 0" }}>
          {win && pokes.data ? (
            <LiveValue k="fables:changes" chain="mainnet" block={pokes.data.toBlock} raw={win.changes} text={formatInt(win.changes)} range={{ fromBlock: pokes.data.fromBlock, toBlock: pokes.data.toBlock, fromTs: win.fromTs, toTs: win.toTs }} />
          ) : (
            <Skeleton />
          )}
        </dd>
      </div>
      <div>
        <dt className={u.statLabel}>
          clim desk reports <InfoTip text="The desk's report counter (seq) since it was deployed on testnet" />
        </dt>
        <dd className={`${u.statValue} ${p.headValue}`} style={{ margin: "4px 0 0" }}>
          {clim.data ? <LiveValue k="clim:seq" chain="testnet" block={clim.data.quote.blockNumber} raw={clim.data.quote.seq} text={formatInt(clim.data.quote.seq)} /> : <Skeleton />}
        </dd>
      </div>
    </dl>
  );
}
```

- [ ] **Step 5: Write `app/src/app/markets/page.tsx`**

```tsx
import type { Metadata } from "next";
import { MarketsHeadStats } from "@/components/markets/MarketsHeadStats";
import { MarketsTable } from "@/components/markets/MarketsTable";
import { Card } from "@/components/ui/kit";
import p from "@/components/pages.module.css";

export const metadata: Metadata = { title: "Markets" };

export default function MarketsPage() {
  return (
    <div className={p.stack} data-qa="page">
      <div className={p.pageHead}>
        <div>
          <h1 className={p.pageTitle} data-qa="page-title">
            Markets
          </h1>
          <p className={p.pageDesc}>Fables&apos; ETH/USDG pool, read live from Robinhood Chain mainnet, next to clim&apos;s three reference pools on testnet.</p>
        </div>
        <MarketsHeadStats />
      </div>
      <Card>
        <MarketsTable filterable />
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Build and look at it**

Run: `cd app && npm run typecheck && npm run lint && npm run build && npx next start -p 3311`
Open `http://localhost:3311/markets` at 1470 px. Expected: Fables' markets layout; four rows (ETH/USDG with "Fables keeper" and a Mainnet tag; tETH/tUSDG D, K, F with "clim", "Keeper-style", "Flat" and Testnet tags); prices around the live ETH price and fees in percent within about 30 s; the header stats show the keeper's overrides in 24 h and the desk's report counter. Stop the server (Ctrl+C).

- [ ] **Step 7: Commit**

```bash
git add app/src/components/pages.module.css app/src/components/pool/parts.tsx app/src/components/markets app/src/app/markets/page.tsx
git commit -m "feat(app): the markets list with a Fee source column and network tags, read live from both chains"
```

### Task 17: The ETH/USDG pool page

**Files:**
- Create: `app/src/components/pool/FeeUpdates.tsx`, `FeeUpdates.test.ts`, `RecentSwaps.tsx`, `EthUsdgPool.tsx` (under `app/src/components/pool/`), `app/src/app/markets/eth/page.tsx`

- [ ] **Step 1: Write the failing test `app/src/components/pool/FeeUpdates.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { DeskReport } from "@/lib/chain/decode";
import type { ClimPoint, PokeEvent } from "@/lib/fees";
import { feeUpdateRows } from "./FeeUpdates";

const poke = (t: number): PokeEvent => ({ kind: "poke", t, block: 1n, logIndex: 0, tx: `0x${String(t).padStart(64, "0")}`, fee0For1: 900, fee1For0: 900, expiry: t + 7200 });
const point = (t: number, seq: number): ClimPoint => ({ t, block: 1n, logIndex: 0, seq, fee0For1: 700, fee1For0: 897, mode: 0, eventApplied: false, expiry: t + 600, tx: `0x${String(t).padStart(64, "1")}` });
const report = (seq: number): DeskReport => ({ t: 0, tx: `0x${String(seq).padStart(64, "2")}`, block: 1n, seq, tObs: 0, sigma15E9: 0, sigma5E9: 0, devPips: 0, nSources: 4, flags: 0 });

describe("feeUpdateRows", () => {
  it("merges both sources newest first, with clim's report transaction joined by seq", () => {
    const rows = feeUpdateRows([poke(100), poke(300)], [point(200, 7), point(400, 8)], [report(8)], 3);
    expect(rows.map((r) => [r.t, r.source])).toEqual([[400, "clim"], [300, "keeper"], [200, "clim"]]);
    expect(rows[0]?.reportTx).toBe(report(8).tx);
    expect(rows[2]?.reportTx).toBeUndefined();
    expect(rows[1]?.txUrl).toMatch(/^https:\/\/robin\.etherscan\.io\/tx\//);
    expect(rows[0]?.txUrl).toMatch(/^https:\/\/explorer\.testnet\.chain\.robinhood\.com\/tx\//);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run src/components/pool`
Expected: FAIL, `./FeeUpdates` does not exist.

- [ ] **Step 3: Write `app/src/components/pool/FeeUpdates.tsx`**

```tsx
// Fables' transactions table, used for fee updates: the keeper's overrides on mainnet and clim's reports on testnet,
// newest first, each linked to its transaction (inventory §8: "rows of pokeFee calls with type dots").
import { AddressLink, NetworkTag } from "@/components/ui/kit";
import type { DeskReport } from "@/lib/chain/decode";
import { testnetTx } from "@/lib/chain/deployments";
import { fablesTx } from "@/lib/chain/fables";
import type { ClimPoint, PokeEvent } from "@/lib/fees";
import { formatAge, formatFeePct, formatUtcClock, shortAddress } from "@/lib/format";
import { MODE_LABEL } from "@/lib/tiers";
import p from "../pages.module.css";

type Row = { t: number; key: string; source: "keeper" | "clim"; fee0For1: number; fee1For0: number; detail: string; tx: string; txUrl: string; reportTx?: string };

export function feeUpdateRows(pokes: readonly PokeEvent[], points: readonly ClimPoint[], reports: readonly DeskReport[], limit: number): Row[] {
  const reportBySeq = new Map(reports.map((r) => [r.seq, r.tx]));
  const keeper: Row[] = pokes.flatMap((e) =>
    e.kind === "poke" ? [{ t: e.t, key: `${e.tx}-${e.logIndex}`, source: "keeper" as const, fee0For1: e.fee0For1, fee1For0: e.fee1For0, detail: `until ${formatUtcClock(e.expiry)}`, tx: e.tx, txUrl: fablesTx(e.tx) }] : [],
  );
  const clim: Row[] = points.map((c) => ({
    t: c.t,
    key: `${c.tx}-${c.seq}`,
    source: "clim" as const,
    fee0For1: c.fee0For1,
    fee1For0: c.fee1For0,
    detail: `report ${c.seq} · ${MODE_LABEL[c.mode] ?? c.mode}${c.eventApplied ? " · event" : ""}`,
    tx: c.tx,
    txUrl: testnetTx(c.tx),
    reportTx: reportBySeq.get(c.seq),
  }));
  return [...keeper, ...clim].sort((a, b) => b.t - a.t).slice(0, limit);
}

export function FeeUpdates({ rows, nowTs }: { rows: Row[]; nowTs: number }) {
  return (
    <div className={p.txCard}>
      <div className={p.tableWrap}>
        <table className={p.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Network</th>
              <th className={p.num}>Buy ETH</th>
              <th className={p.num}>Sell ETH</th>
              <th>Detail</th>
              <th className={p.num}>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td title={new Date(r.t * 1000).toISOString()}>{formatAge(nowTs - r.t)}</td>
                <td>
                  <span className={p.typeDot} style={{ ["--dot" as string]: r.source === "keeper" ? "var(--accent)" : "var(--brand)" }}>
                    {r.source === "keeper" ? "Fables keeper" : "clim"}
                  </span>
                </td>
                <td>
                  <NetworkTag network={r.source === "keeper" ? "mainnet" : "testnet"} />
                </td>
                <td className={p.num}>{formatFeePct(r.fee1For0)}</td>
                <td className={p.num}>{formatFeePct(r.fee0For1)}</td>
                <td className={p.muted}>{r.detail}</td>
                <td className={p.num}>
                  {r.reportTx ? (
                    <>
                      <AddressLink href={testnetTx(r.reportTx)} title="the desk report">
                        report
                      </AddressLink>{" "}
                      ·{" "}
                    </>
                  ) : null}
                  <AddressLink href={r.txUrl} title={r.source === "keeper" ? "the keeper's pokeFee" : "ClimPoker.poke on pool D"}>
                    {shortAddress(r.tx)}
                  </AddressLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it**

Run: `cd app && npx vitest run src/components/pool`
Expected: `Tests  1 passed (1)`.

- [ ] **Step 5: Write `app/src/components/pool/RecentSwaps.tsx`**

```tsx
"use client";
import type { PublicClient } from "viem";
import { Skeleton } from "@/components/ui/kit";
import type { History } from "@/hooks/useLogHistory";
import { usePoll } from "@/hooks/usePoll";
import { blockTimes } from "@/lib/chain/blockTimes";
import type { SwapRow } from "@/lib/chain/decode";
import { SwapsTable } from "./parts";

/** The newest `limit` swaps of a window, with their block times. */
export function RecentSwaps({ history, client, txUrl, limit = 10 }: { history: History<SwapRow> | null; client: () => PublicClient; txUrl: (tx: string) => string; limit?: number }) {
  const rows = history ? [...history.items].reverse().slice(0, limit) : [];
  const key = rows.map((r) => r.block.toString()).join(",");
  const times = usePoll(() => blockTimes(client(), rows.map((r) => r.block)), 30_000, key);
  if (!history) return <Skeleton width={300} />;
  return <SwapsTable swaps={rows} times={times.data} nowTs={history.toTs} txUrl={txUrl} />;
}
```

- [ ] **Step 6: Write `app/src/components/pool/EthUsdgPool.tsx`**

```tsx
"use client";
// Fables' ETH/USDG pool page with clim grafted into its Dynamic Fee section (inventory §2.3 and §8). Fables' side is
// read live from Robinhood Chain mainnet; clim's from the testnet desk. Nothing here sends a transaction.
import Link from "next/link";
import { useState } from "react";
import { StepChart, type Series } from "@/components/charts/StepChart";
import { FilterToggle, PeriodButtons } from "@/components/ui/FilterToggle";
import { AddressLink, AsideGrid, ButtonLink, ChartPanel, LiveDot, LiveValue, NetworkTag, ReadError, Section, Skeleton, Stat, Swatch, TierBadge } from "@/components/ui/kit";
import { ExternalIcon } from "@/components/ui/icons";
import { useClimNow, useClimPoints, useDeskReports, useFablesNow, useFablesPokes, useFablesSwaps } from "@/hooks/live";
import { mainnetClient } from "@/lib/chain/clients";
import { LIVE, sourcifyTestnet, testnetCode } from "@/lib/chain/deployments";
import { FABLES, fablesAddress, fablesTx } from "@/lib/chain/fables";
import { climQuoteOf, climSteps } from "@/lib/fees";
import { formatAge, formatFeePct, formatGapPips, formatInt, formatPrice, formatSigmaE9, formatUtcClock, shortAddress } from "@/lib/format";
import { deskBadge, feeTier, feeTooltip, MODE_NUMBER, modeLabel } from "@/lib/tiers";
import { feeWindow } from "@/lib/windowStats";
import p from "../pages.module.css";
import { FeeUpdates, feeUpdateRows } from "./FeeUpdates";
import { FeeRail, FeeValue, ParamsCard, PoolHeader } from "./parts";
import { RecentSwaps } from "./RecentSwaps";

const PERIODS = { "24H": 86_400, "7D": 7 * 86_400 } as const;
type Period = keyof typeof PERIODS;
type View = "both" | "direction";

export function EthUsdgPool() {
  const [period, setPeriod] = useState<Period>("24H");
  const [view, setView] = useState<View>("both");
  const windowSec = PERIODS[period];
  const fables = useFablesNow();
  const clim = useClimNow();
  const pokes = useFablesPokes(windowSec);
  const points = useClimPoints(PERIODS["24H"]);
  const reports = useDeskReports(900);
  const swaps = useFablesSwaps(600);

  const f = fables.data;
  const c = clim.data;
  const win = pokes.data ? feeWindow(pokes.data.items, FABLES.config, pokes.data.toTs, windowSec) : null;
  const climAge = c ? c.quote.blockTimestamp - c.quote.tObs : null;
  const badge = c && climAge !== null ? deskBadge(MODE_NUMBER[c.quote.mode], climAge, c.quote.tauKillSec) : null;

  const series: Series[] = [];
  if (win) series.push({ id: "keeper", label: "Fables keeper", color: "var(--brand)", area: true, points: win.steps.map((s) => ({ t: s.t, v: s.fee0For1 })) });
  if (points.data && win) {
    const cs = climSteps(points.data.items, Math.max(win.fromTs, points.data.toTs - PERIODS["24H"]), points.data.toTs);
    if (view === "both") series.push({ id: "clim", label: "clim", color: "var(--ink)", points: cs.map((s) => ({ t: s.t, v: climQuoteOf(s) })) });
    else {
      series.push({ id: "buy", label: "clim, buy ETH", color: "var(--positive)", points: cs.map((s) => ({ t: s.t, v: s.fee1For0 })) });
      series.push({ id: "sell", label: "clim, sell ETH", color: "var(--negative)", points: cs.map((s) => ({ t: s.t, v: s.fee0For1 })) });
    }
  }

  const tier = f ? feeTier(Math.max(f.fee0For1, f.fee1For0), FABLES.config.flatPips) : null;
  const nowTs = f?.t ?? c?.quote.blockTimestamp ?? 0;

  return (
    <div className={p.pool} data-qa="pool">
      <PoolHeader
        title="ETH / USDG"
        network="mainnet"
        sub={
          <>
            Uniswap v4 <span className={p.pairSubMuted}>on</span> Robinhood Chain <span className={p.pairSubMuted}>· Fables&apos; pool, read only</span>
          </>
        }
        actions={
          <>
            <ButtonLink href={FABLES.app} variant="primary">
              Open on Fables <ExternalIcon size={14} />
            </ButtonLink>
            <ButtonLink href={fablesAddress(FABLES.hook)}>
              RobinScan <ExternalIcon size={14} />
            </ButtonLink>
          </>
        }
      />

      <div className={p.statRow}>
        <Stat
          label="Current fee"
          tip={f ? feeTooltip(f.fee0For1, f.fee1For0, FABLES.config.flatPips) : "The fee this market charges on every swap right now"}
          value={f ? <FeeValue prefix="fables" chain="mainnet" block={f.blockNumber} fee0For1={f.fee0For1} fee1For0={f.fee1For0} /> : "-"}
          secondary={tier ? <TierBadge badge={tier} title="Fables' keeper has raised the fee above the flat 0.07%" /> : f ? "flat fee" : <Skeleton />}
        />
        <Stat
          label="Price"
          tip="USDG per ETH from the pool's slot0 (Uniswap v4 StateView)"
          value={f ? <LiveValue k="fables:price" chain="mainnet" block={f.blockNumber} raw={f.sqrtPriceX96} text={formatPrice(f.price)} /> : "-"}
          secondary="USDG per ETH"
        />
        <Stat
          label="clim now"
          tip="ClimFeePolicy.quote() on the testnet desk: clim's recommendation for this pool, not applied to it"
          value={c ? <LiveValue k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} /> : "-"}
          secondary={badge ? <TierBadge badge={badge} /> : <Skeleton />}
        />
        <Stat
          label="Desk volatility"
          tip="Annualised 5-minute volatility the desk last reported (RiskDeskV2.state, sigma5)"
          value={c ? <LiveValue k="desk:sigma5" chain="testnet" block={c.quote.blockNumber} raw={c.desk.sigma5E9} text={formatSigmaE9(c.desk.sigma5E9)} /> : "-"}
          secondary="5 min, four venues"
        />
        <Stat
          label="Last report"
          tip="The desk's last observation; blind after tauKillSec without one"
          value={c ? <span>{formatAge(climAge)}</span> : "-"}
          secondary={c ? <span>report <LiveValue k="clim:seq" chain="testnet" block={c.quote.blockNumber} raw={c.quote.seq} text={formatInt(c.quote.seq)} /></span> : <Skeleton />}
        />
      </div>
      {fables.error ? <ReadError error={fables.error} /> : null}
      {clim.error ? <ReadError error={clim.error} /> : null}

      <Section
        id="dynamic-fee"
        title="Dynamic Fee"
        description="This market leverages dynamic fees to optimize rewards for liquidity providers. Fables' keeper sets it on mainnet; clim's testnet desk publishes its own recommendation next to it, read live from both chains."
      >
        <AsideGrid
          rail={
            <FeeRail
              prefix="fables"
              chain="mainnet"
              label={period === "24H" ? "24h" : "7d"}
              current={f ? <FeeValue prefix="fables" chain="mainnet" block={f.blockNumber} fee0For1={f.fee0For1} fee1For0={f.fee1For0} /> : "-"}
              win={win}
              history={pokes.data}
              extra={[
                { label: "clim now", tip: "ClimFeePolicy.quote(), testnet", value: c ? <LiveValue k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} /> : <Skeleton /> },
                {
                  label: "clim buy / sell",
                  tip: "ClimFeePolicy.quoteDirectional(): the premium goes to the side the venue-pool gap makes toxic (measured against pool D on testnet)",
                  value: c ? (
                    <span>
                      <LiveValue k="clim:fee1For0" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee1For0} text={formatFeePct(c.quote.fee1For0)} /> /{" "}
                      <LiveValue k="clim:fee0For1" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee0For1} text={formatFeePct(c.quote.fee0For1)} />
                    </span>
                  ) : (
                    <Skeleton />
                  ),
                },
                { label: "Desk mode", tip: "normal, degraded (venues disagree) or blind (no report for tauKillSec)", value: c ? <LiveValue k="clim:mode" chain="testnet" block={c.quote.blockNumber} raw={c.quote.mode} text={modeLabel(c.quote.mode)} /> : <Skeleton /> },
                { label: "Venue gap", tip: "Venue mid minus pool D's mid, as the desk last reported it (devPips)", value: c ? <LiveValue k="desk:dev" chain="testnet" block={c.quote.blockNumber} raw={c.desk.devPips} text={formatGapPips(c.desk.devPips)} /> : <Skeleton /> },
                { label: "Observed at", tip: "The desk's last observation time (tObs)", value: c ? <LiveValue k="clim:tObs" chain="testnet" block={c.quote.blockNumber} raw={c.quote.tObs} text={formatUtcClock(c.quote.tObs)} /> : <Skeleton /> },
              ]}
            />
          }
        >
          <ChartPanel
            top={
              <>
                <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
                  <LiveDot />
                  <FilterToggle
                    label="clim's line"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: "both", label: "Both fees" },
                      { value: "direction", label: "clim per direction" },
                    ]}
                  />
                </span>
                <PeriodButtons options={["24H", "7D"] as const} value={period} onChange={setPeriod} />
              </>
            }
            legend={
              <>
                <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
                  {series.map((x) => (
                    <Swatch key={x.id} color={x.color} label={x.label} />
                  ))}
                </span>
                <span style={{ display: "inline-flex", gap: 8 }}>
                  <NetworkTag network="mainnet" />
                  <NetworkTag network="testnet" />
                </span>
              </>
            }
          >
            <StepChart series={series} from={win?.fromTs ?? 0} to={win?.toTs ?? 1} format={formatFeePct} loading={!win} />
          </ChartPanel>
        </AsideGrid>
        <p className={p.note}>
          clim&apos;s line is a recommendation computed by the testnet desk (ClimFeePolicy); it is not applied to Fables&apos; pool. Its per-direction premium is measured against pool
          D&apos;s mid on testnet. clim&apos;s line covers the last 24 hours (one report every 30 s){period === "7D" ? "; the keeper's covers 7 days" : ""}. clim does not claim lower or
          better fees than the keeper: the lab&apos;s comparison is on the Evidence page.
        </p>
      </Section>

      <Section id="fee-updates" title="Fee updates" description="The keeper's overrides on Fables' pool and clim's reports, newest first. Each links to its transaction.">
        {pokes.data && points.data ? (
          <FeeUpdates rows={feeUpdateRows(pokes.data.items, points.data.items, reports.data?.items ?? [], 12)} nowTs={nowTs} />
        ) : (
          <Skeleton width={300} />
        )}
      </Section>

      <Section id="verify" title="Pool and desk" description="Fables' pool on mainnet and clim's desk on testnet. Every contract is verified; follow the links.">
        <ParamsCard
          rows={[
            { label: "Pool ID", value: <AddressLink href={fablesAddress(FABLES.poolManager)}>{shortAddress(FABLES.poolId)}</AddressLink>, copy: FABLES.poolId },
            { label: "PoolManager", value: <AddressLink href={fablesAddress(FABLES.poolManager)}>{shortAddress(FABLES.poolManager)}</AddressLink>, copy: FABLES.poolManager },
            { label: "Fee model", value: "Dynamic" },
            { label: "Tick spacing", value: String(FABLES.key.tickSpacing) },
            { label: "Hook (Fables)", tip: `${FABLES.hookContract}, verified on Sourcify`, value: <AddressLink href={FABLES.sourcify}>{shortAddress(FABLES.hook)}</AddressLink>, copy: FABLES.hook },
            { label: "Flat, floor, cap", value: `${formatFeePct(FABLES.config.flatPips)}, ${formatFeePct(FABLES.config.floorPips)}, ${formatFeePct(FABLES.config.capPips)}` },
            { label: "Keeper (Fables)", value: <AddressLink href={fablesAddress(FABLES.keeper)}>{shortAddress(FABLES.keeper)}</AddressLink>, copy: FABLES.keeper },
            { label: "AccessManager (Fables)", value: <AddressLink href={fablesAddress(FABLES.accessManager)}>{shortAddress(FABLES.accessManager)}</AddressLink>, copy: FABLES.accessManager },
            { label: "Risk desk (clim)", tip: "RiskDeskV2 on testnet, Blockscout and Sourcify", value: <AddressLink href={testnetCode(LIVE.riskDesk)}>{shortAddress(LIVE.riskDesk)}</AddressLink>, copy: LIVE.riskDesk },
            { label: "Fee policy (clim)", value: <AddressLink href={sourcifyTestnet(LIVE.policy)}>{shortAddress(LIVE.policy)}</AddressLink>, copy: LIVE.policy },
            { label: "Poker (clim)", value: <AddressLink href={testnetCode(LIVE.poker)}>{shortAddress(LIVE.poker)}</AddressLink>, copy: LIVE.poker },
            { label: "Integration", value: <Link href="/integrate">Levels 0, 1, 2</Link> },
          ]}
        />
      </Section>

      <Section id="transactions" title="Recent transactions" description="Swaps against this market in the last 10 minutes, newest first, read from the PoolManager's Swap logs.">
        <RecentSwaps history={swaps.data} client={mainnetClient} txUrl={fablesTx} />
      </Section>
    </div>
  );
}
```

- [ ] **Step 7: Write `app/src/app/markets/eth/page.tsx`**

```tsx
import type { Metadata } from "next";
import { EthUsdgPool } from "@/components/pool/EthUsdgPool";

export const metadata: Metadata = { title: "ETH / USDG" };

export default function EthUsdgPage() {
  return <EthUsdgPool />;
}
```

- [ ] **Step 8: Build and look at it**

Run: `cd app && npm run typecheck && npm run lint && npm run build && npx next start -p 3311`, then `curl -sI http://localhost:3311/pool/eth-usdg | grep -i '^location'`.
Expected: `location: /markets/eth`. At `http://localhost:3311/markets/eth` (1470 px): Fables' pool header with "Open on Fables" and "RobinScan" (no Deposit), the stat row (current fee with "Elevated" when above 0.07 %, price, clim now with "clim: live", desk volatility, last report), the Dynamic Fee section with the keeper's lime step line and clim's white line within about a minute, "clim per direction" switching to green and orange lines, Fee updates with both sources, the params card, recent swaps. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add app/src/components/pool/FeeUpdates.tsx app/src/components/pool/FeeUpdates.test.ts app/src/components/pool/RecentSwaps.tsx app/src/components/pool/EthUsdgPool.tsx app/src/app/markets/eth/page.tsx
git commit -m "feat(app): Fables' ETH/USDG pool page with clim's recommendation in its Dynamic Fee section

The keeper's fee (mainnet) and clim's quote and quoteDirectional (testnet desk), each fee update linked to its transaction."
```

### Task 18: Pools D, K and F

**Files:**
- Create: `app/src/hooks/useDeskOutages.ts`, `app/src/components/pool/Outages.tsx`, `app/src/components/pool/TestnetPool.tsx`, `app/src/app/markets/[pool]/page.tsx`

- [ ] **Step 1: Write `app/src/hooks/useDeskOutages.ts`**

```ts
"use client";
import snapshot from "@/generated/outages.json";
import { testnetClient } from "@/lib/chain/clients";
import { readDeskReports } from "@/lib/chain/readClim";
import { laggedHead, withRetry } from "@/lib/chain/retry";
import { mergeOutages, type OutageSnapshot, type ShownOutage } from "@/lib/outages";
import { usePoll } from "./usePoll";

const SNAPSHOT = snapshot as OutageSnapshot;

/** The recorded windows, then the reports since the snapshot's last scanned block, read once a minute. */
export function useDeskOutages() {
  return usePoll<{ windows: ShownOutage[]; gapSec: number; scannedToBlock: number }>(
    async () => {
      const client = testnetClient();
      const head = laggedHead(await withRetry(() => client.getBlockNumber({ cacheTime: 0 })));
      const nowSec = Number((await withRetry(() => client.getBlock({ blockNumber: head }))).timestamp);
      const reports = await readDeskReports(client, BigInt(SNAPSHOT.scannedToBlock) + 1n, head);
      return { windows: mergeOutages(SNAPSHOT, reports.map((r) => ({ seq: r.seq, tObs: r.tObs })), nowSec), gapSec: SNAPSHOT.gapSec, scannedToBlock: SNAPSHOT.scannedToBlock };
    },
    60_000,
    "outages",
  );
}
```

- [ ] **Step 2: Write `app/src/components/pool/Outages.tsx`**

```tsx
"use client";
// The desk's outage windows: the recorded snapshot plus what the chain shows since (lib/outages.ts).
import { useDeskOutages } from "@/hooks/useDeskOutages";
import { AddressLink, Skeleton } from "@/components/ui/kit";
import { LIVE, testnetAddress } from "@/lib/chain/deployments";
import { formatDuration, formatUtcDateTime } from "@/lib/format";
import p from "../pages.module.css";

export function OutagesTable() {
  const { data, error } = useDeskOutages();
  if (!data) return error ? <p className={p.note}>The outage record could not be read from the chain; the recorded windows are in the evidence files.</p> : <Skeleton width={300} />;
  return (
    <div className={p.txCard}>
      <div className={p.tableWrap}>
        <table className={p.table}>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th className={p.num}>Silent for</th>
              <th className={p.num}>Reports</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {[...data.windows].reverse().map((w) => (
              <tr key={`${w.seqBefore}-${w.from}`}>
                <td>{formatUtcDateTime(w.from)}</td>
                <td>{w.to === null ? "ongoing" : formatUtcDateTime(w.to)}</td>
                <td className={p.num}>{formatDuration(w.durationSec)}</td>
                <td className={p.num}>
                  {w.seqBefore} to {w.seqAfter ?? "-"}
                </td>
                <td className={p.muted} style={{ whiteSpace: "normal" }}>
                  {w.reason}
                  {w.source === "chain" ? " (chain)" : " (operator's record)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={p.note} style={{ padding: "12px 4px 0" }}>
        A window is a gap of more than {data.gapSec} s between two RiskReportedV2 events of the desk <AddressLink href={testnetAddress(LIVE.riskDesk)}>RiskDeskV2</AddressLink>. While the desk is
        silent, pool D keeps its last override until it expires (600 s after its observation), then charges the flat fee (docs/security.md §7). Recorded up to block{" "}
        {data.scannedToBlock.toLocaleString("en-US")}, read from the chain after it.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Write `app/src/components/pool/TestnetPool.tsx`**

```tsx
"use client";
// clim's reference pools on Robinhood Chain testnet (spec §5.7): D driven by ClimPoker from the live desk, K by a
// keeper-style bot, F flat. Same page as Fables' pool, labelled testnet throughout; test tokens, no value at stake.
import type { LivePoolName } from "@clim/shared";
import { StepChart, type Series } from "@/components/charts/StepChart";
import { AddressLink, AsideGrid, ButtonLink, ChartPanel, LiveDot, LiveValue, NetworkTag, ReadError, Section, Skeleton, Stat, Swatch, TierBadge } from "@/components/ui/kit";
import { ExternalIcon } from "@/components/ui/icons";
import { useClimNow, usePoolPokes, usePoolSwaps } from "@/hooks/live";
import { testnetClient } from "@/lib/chain/clients";
import { LIVE, sourcifyTestnet, testnetAddress, testnetCode, testnetTx } from "@/lib/chain/deployments";
import { formatAvgFeePct, formatFeePct, formatInt, formatPrice, shortAddress } from "@/lib/format";
import { FEE_SOURCE, feeTier, feeTooltip } from "@/lib/tiers";
import { feeWindow, swapWindow } from "@/lib/windowStats";
import p from "../pages.module.css";
import { OutagesTable } from "./Outages";
import { FeeRail, FeeValue, ParamsCard, PoolHeader } from "./parts";
import { RecentSwaps } from "./RecentSwaps";

const DAY = 86_400;

export function TestnetPool({ name }: { name: LivePoolName }) {
  const pool = LIVE.pools[name];
  const clim = useClimNow();
  const pokes = usePoolPokes(name, DAY);
  const swaps = usePoolSwaps(name, DAY);
  const c = clim.data;
  const now = c?.pools[name];
  const block = c?.quote.blockNumber ?? 0n;
  const win = pokes.data ? feeWindow(pokes.data.items, LIVE.hookConfig, pokes.data.toTs, DAY) : null;
  const sw = swaps.data ? swapWindow(swaps.data.items) : null;
  const directional = win ? win.steps.some((s) => s.fee0For1 !== s.fee1For0) : false;
  const series: Series[] = win
    ? directional
      ? [
          { id: "buy", label: "Buy ETH", color: "var(--positive)", points: win.steps.map((s) => ({ t: s.t, v: s.fee1For0 })) },
          { id: "sell", label: "Sell ETH", color: "var(--negative)", points: win.steps.map((s) => ({ t: s.t, v: s.fee0For1 })) },
        ]
      : [{ id: "fee", label: "Fee", color: "var(--brand)", area: true, points: win.steps.map((s) => ({ t: s.t, v: s.fee0For1 })) }]
    : [];
  const source = FEE_SOURCE[name];
  const tier = now ? feeTier(Math.max(now.fee0For1, now.fee1For0), LIVE.hookConfig.flatPips) : null;
  const swapRange = sw && swaps.data ? { fromBlock: swaps.data.fromBlock, toBlock: swaps.data.toBlock, fromTs: swaps.data.toTs - DAY, toTs: swaps.data.toTs } : undefined;

  return (
    <div className={p.pool} data-qa="pool">
      <PoolHeader
        title={`tETH / tUSDG · Pool ${name}`}
        network="testnet"
        sub={
          <>
            Uniswap v4 <span className={p.pairSubMuted}>on</span> Robinhood Chain testnet <span className={p.pairSubMuted}>· {pool.driver}</span>
          </>
        }
        actions={
          <ButtonLink href={testnetCode(LIVE.hook)}>
            Blockscout <ExternalIcon size={14} />
          </ButtonLink>
        }
      />

      <div className={p.statRow}>
        <Stat
          label="Current fee"
          tip={now ? feeTooltip(now.fee0For1, now.fee1For0, LIVE.hookConfig.flatPips) : "The fee this market charges on every swap right now"}
          value={now ? <FeeValue prefix={`pool:${name}`} chain="testnet" block={block} fee0For1={now.fee0For1} fee1For0={now.fee1For0} /> : "-"}
          secondary={tier ? <TierBadge badge={tier} /> : now ? "flat fee" : <Skeleton />}
        />
        <Stat label="Price" tip="tUSDG per tETH from slot0" value={now ? <LiveValue k={`pool:${name}:price`} chain="testnet" block={block} raw={now.sqrtPriceX96} text={formatPrice(now.price)} /> : "-"} secondary="tUSDG per tETH" />
        <Stat label="Fee source" tip={source.note} value={<TierBadge badge={source} />} secondary={name === "D" ? "ClimPoker" : name === "K" ? "keeper-style bot" : "no override"} />
        <Stat
          label="Swaps (24h)"
          tip="Arbitrage and retail bots trade every pool against real venue prices"
          value={sw && swaps.data && swapRange ? <LiveValue k={`pool:${name}:swaps`} chain="testnet" block={swaps.data.toBlock} raw={sw.count} text={formatInt(sw.count)} range={swapRange} /> : "-"}
          secondary="arbitrage and retail"
        />
        <Stat
          label="Mean fee paid (24h)"
          tip="The average Swap.fee of the swaps in the last 24 hours"
          value={sw && swaps.data && swapRange && sw.meanFeePips !== null ? <LiveValue k={`pool:${name}:meanSwapFee`} chain="testnet" block={swaps.data.toBlock} raw={sw.meanFeePips} text={formatAvgFeePct(sw.meanFeePips)} range={swapRange} /> : "-"}
          secondary="per swap"
        />
      </div>
      {clim.error ? <ReadError error={clim.error} /> : null}

      <Section id="dynamic-fee" title="Dynamic Fee" description={`${source.label}: ${source.note}. The fee in force over the last 24 hours, rebuilt with the hook's own rule from ${name === "D" ? "ClimPoker's Poked logs, each at its report's observation time" : "the hook's FeePoked logs, each at its block's time"}.`}>
        <AsideGrid
          rail={
            <FeeRail
              prefix={`pool:${name}`}
              chain="testnet"
              label="24h"
              current={now ? <FeeValue prefix={`pool:${name}`} chain="testnet" block={block} fee0For1={now.fee0For1} fee1For0={now.fee1For0} /> : "-"}
              win={win}
              history={pokes.data}
            />
          }
        >
          <ChartPanel
            top={
              <>
                <LiveDot />
                <span style={{ color: "var(--ink-secondary)", fontSize: 12 }}>24H</span>
              </>
            }
            legend={
              <>
                <span style={{ display: "inline-flex", gap: 12 }}>
                  {series.map((x) => (
                    <Swatch key={x.id} color={x.color} label={x.label} />
                  ))}
                </span>
                <NetworkTag network="testnet" />
              </>
            }
          >
            <StepChart series={series} from={win?.fromTs ?? 0} to={win?.toTs ?? 1} format={formatFeePct} loading={!win} />
          </ChartPanel>
        </AsideGrid>
      </Section>

      {name === "D" ? (
        <Section id="outages" title="Desk outages" description="Windows in which clim's desk sent no report, measured on chain. The live stack runs on the maintainer's Mac; every silence is published as measured.">
          <OutagesTable />
        </Section>
      ) : null}

      <Section id="pool" title="Pool">
        <ParamsCard
          rows={[
            { label: "Pool ID", value: <AddressLink href={testnetAddress(LIVE.uniswap.poolManager)}>{shortAddress(pool.poolId)}</AddressLink>, copy: pool.poolId },
            { label: "Hook (clim's PokeFeeHook)", value: <AddressLink href={sourcifyTestnet(LIVE.hook)}>{shortAddress(LIVE.hook)}</AddressLink>, copy: LIVE.hook },
            { label: "Tick spacing", value: String(pool.key.tickSpacing) },
            { label: "Flat, floor, cap", value: `${formatFeePct(LIVE.hookConfig.flatPips)}, ${formatFeePct(LIVE.hookConfig.floorPips)}, ${formatFeePct(LIVE.hookConfig.capPips)}` },
            { label: "tETH", value: <AddressLink href={testnetAddress(LIVE.tokens.tETH.address)}>{shortAddress(LIVE.tokens.tETH.address)}</AddressLink>, copy: LIVE.tokens.tETH.address },
            { label: "tUSDG", value: <AddressLink href={testnetAddress(LIVE.tokens.tUSDG.address)}>{shortAddress(LIVE.tokens.tUSDG.address)}</AddressLink>, copy: LIVE.tokens.tUSDG.address },
          ]}
        />
      </Section>

      <Section id="transactions" title="Recent transactions" description="Swaps against this pool in the last 24 hours, newest first.">
        <RecentSwaps history={swaps.data} client={testnetClient} txUrl={testnetTx} />
      </Section>
    </div>
  );
}
```

- [ ] **Step 4: Write `app/src/app/markets/[pool]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TestnetPool } from "@/components/pool/TestnetPool";
import { POOL_SLUGS } from "@/lib/chain/deployments";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(POOL_SLUGS).map((pool) => ({ pool }));
}

export async function generateMetadata({ params }: { params: Promise<{ pool: string }> }): Promise<Metadata> {
  const { pool } = await params;
  return { title: `Pool ${POOL_SLUGS[pool] ?? ""} (testnet)` };
}

export default async function TestnetPoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params;
  const name = POOL_SLUGS[pool];
  if (!name) notFound();
  return <TestnetPool name={name} />;
}
```

- [ ] **Step 5: Build**

Run: `cd app && npm run typecheck && npm run lint && npm run build`
Expected: the route table lists `● /markets/d`, `● /markets/k`, `● /markets/f` under `/markets/[pool]`.

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useDeskOutages.ts app/src/components/pool/Outages.tsx app/src/components/pool/TestnetPool.tsx "app/src/app/markets/[pool]/page.tsx"
git commit -m "feat(app): clim's testnet pools D, K, F in Fables' pool layout, with the desk's outage windows on D"
```

### Task 19: The landing

**Files:**
- Create: `app/src/components/landing/landing.module.css`, `app/src/components/landing/Landing.tsx`
- Replace: `app/src/app/page.tsx`

- [ ] **Step 1: Write `app/src/components/landing/landing.module.css`**

```css
/* Landing (inventory §2.1): hero card 1200 x 326, feature grid 3 x 384, featured markets card with a foot band. */
.hero {
  position: relative;
  border-radius: var(--radius);
  background: var(--card);
  padding: 12px;
  overflow: hidden;
}
.heroArt {
  position: absolute;
  inset: 0;
  background: url("/fables/hero-bg.webp") center / cover no-repeat;
  opacity: 0.46;
}
.heroArt::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--dot-grid);
  background-size: var(--dot-grid-size);
}
.heroInner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 64px 40px 80px;
  text-align: center;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--raised);
  border: 1px solid var(--line-light);
  font-weight: 500;
}
.headline {
  font-family: var(--font-display);
  font-size: 48px;
  line-height: 56px;
  font-weight: 500;
  letter-spacing: 0.24px;
}
.turn {
  color: var(--brand);
}
.subline {
  max-width: 64ch;
  color: var(--ink-muted);
  font-weight: 500;
}
.subline a {
  color: var(--ink-secondary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.subline a:hover {
  color: var(--ink);
}
.pills {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.pill {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.pillFace {
  min-width: 105px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-compact);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  line-height: 22px;
  font-weight: 500;
  letter-spacing: -0.5px;
  font-variant-numeric: lining-nums tabular-nums;
  background: color-mix(in srgb, var(--raised) 50%, transparent);
  color: var(--ink-secondary);
  animation: rise 1.007s var(--ease-entrance);
}
.pillLit {
  background: var(--brand);
  color: var(--brand-fg);
}
.pillWhite {
  background: var(--ink);
  color: var(--canvas);
}
.pillLabel {
  font-size: 12px;
  line-height: 16px;
  color: var(--ink-secondary);
}
@keyframes rise {
  from {
    translate: 0 28px;
    opacity: 0;
  }
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.feature {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.plate {
  position: relative;
  height: 200px;
  border-radius: var(--radius);
  background-color: var(--card);
  background-image: var(--dot-grid);
  background-size: var(--dot-grid-size);
  box-shadow: var(--shadow-table);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 48px 16px 16px;
}
.tag {
  position: absolute;
  top: 12px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--raised);
  border: 1px solid var(--line-light);
  font-weight: 500;
}
.featureText {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.featureTitle {
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  letter-spacing: -0.25px;
}
.featureDesc {
  font-size: 16px;
  line-height: 24px;
  letter-spacing: -0.25px;
  color: var(--ink-secondary);
}
.band {
  position: relative;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--raised), var(--raised-hover));
}
.bandMark {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  translate: -50% -50%;
  border: 2px solid var(--card);
}
.bandLabels {
  display: flex;
  justify-content: space-between;
  width: 100%;
  margin-top: 12px;
  color: var(--ink-secondary);
  font-size: 12px;
}
.deskTicker {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.deskSeq {
  font-size: 36px;
  line-height: 40px;
  font-weight: 500;
  font-variant-numeric: lining-nums tabular-nums;
}
.featured {
  position: relative;
  margin-top: 40px;
}
.unicorn {
  position: absolute;
  right: 24px;
  top: -56px;
  width: 64px;
  height: 64px;
  background: url("/fables/unicorn-ledge.webp") center / contain no-repeat;
  pointer-events: none;
}
.featuredHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px 12px;
}
.featuredTitle {
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 32px;
  font-weight: 500;
}
.viewAll {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--radius);
  background: var(--card);
}
.viewAllInner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--ink-secondary);
}
.viewAll:hover svg {
  translate: 2px 0;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 96px;
  margin-top: 8px;
  padding: 20px 28px;
  border-radius: var(--radius);
  background: var(--canvas);
}
.footLeft {
  display: flex;
  align-items: center;
  gap: 16px;
}
.footMark {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--brand-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 28px;
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--brand) 12%, transparent);
}
.footTitle {
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}
.footSub {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--ink-secondary);
}
@media (max-width: 768px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 575px) {
  .headline {
    font-size: 32px;
    line-height: 38px;
    letter-spacing: 0.16px;
  }
  .foot {
    height: auto;
    flex-direction: column;
    align-items: flex-start;
  }
}
```

- [ ] **Step 2: Write `app/src/components/landing/Landing.tsx`**

```tsx
"use client";
// Fables' landing (inventory §2.1) with clim's thesis in the hero and the live number under it: the keeper's fee on
// Fables' pool now against clim's recommendation now.
import Link from "next/link";
import { MarketsTable } from "@/components/markets/MarketsTable";
import { ButtonLink, Card, LiveDot, LiveValue, NetworkTag, Skeleton, TierBadge } from "@/components/ui/kit";
import { ArrowRightIcon, ExternalIcon } from "@/components/ui/icons";
import { useClimNow, useFablesNow } from "@/hooks/live";
import { FABLES } from "@/lib/chain/fables";
import { formatFeePct, formatInt } from "@/lib/format";
import { repoFile } from "@/lib/site";
import { deskBadge, MODE_NUMBER } from "@/lib/tiers";
import s from "./landing.module.css";

/** The effective floor of an override on Fables' pool: max(floor, flat x 50 %). */
const EFFECTIVE_FLOOR = Math.max(FABLES.config.floorPips, FABLES.config.flatPips / 2);

function bandPos(pips: number) {
  const lo = EFFECTIVE_FLOOR;
  const hi = FABLES.config.capPips;
  return `${Math.min(100, Math.max(0, ((pips - lo) / (hi - lo)) * 100))}%`;
}

export function Landing() {
  const f = useFablesNow().data;
  const c = useClimNow().data;
  const age = c ? c.quote.blockTimestamp - c.quote.tObs : null;
  return (
    <>
      <section className={s.hero} data-qa="hero">
        <div className={s.heroArt} aria-hidden />
        <div className={s.heroInner}>
          <span className={s.eyebrow}>
            <LiveDot green label="" />
            Live on Robinhood
          </span>
          <h1 className={s.headline} data-qa="headline">
            Fables&apos; keeper sets the fee.
            <br />
            <span className={s.turn}>clim checks it in public.</span>
          </h1>
          <div className={s.pills} aria-label="The fee now">
            <span className={s.pill}>
              <span className={`${s.pillFace} ${s.pillLit}`}>{f ? <LiveValue k="fables:fee0For1" chain="mainnet" block={f.blockNumber} raw={f.fee0For1} text={formatFeePct(f.fee0For1)} /> : <Skeleton />}</span>
              <span className={s.pillLabel}>Fables keeper, now</span>
              <NetworkTag network="mainnet" />
            </span>
            <span className={s.pill}>
              <span className={`${s.pillFace} ${s.pillWhite}`}>{c ? <LiveValue k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} /> : <Skeleton />}</span>
              <span className={s.pillLabel}>clim&apos;s recommendation, now</span>
              <NetworkTag network="testnet" />
            </span>
          </div>
          <p className={s.subline}>
            A Chainlink CRE desk reads ETH on four exchanges every 30 s and publishes a fee anyone can recompute, next to the fee Fables&apos; keeper sets on ETH/USDG. A showcase, read only.{" "}
            <a href={repoFile("docs/integrate/README.md")} target="_blank" rel="noreferrer">
              Read the integration guide <ExternalIcon size={14} />
            </a>
          </p>
        </div>
      </section>

      <div className={s.grid}>
        <div className={s.feature}>
          <div className={s.plate}>
            <span className={s.tag}>Two fees</span>
            <div className={s.pills}>
              <span className={s.pillFace}>{formatFeePct(FABLES.config.flatPips)}</span>
              <span className={`${s.pillFace} ${s.pillLit}`}>{f ? <LiveValue k="fables:fee0For1" chain="mainnet" block={f.blockNumber} raw={f.fee0For1} text={formatFeePct(f.fee0For1)} /> : <Skeleton />}</span>
              <span className={`${s.pillFace} ${s.pillWhite}`}>{c ? <LiveValue k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} /> : <Skeleton />}</span>
            </div>
          </div>
          <div className={s.featureText}>
            <span className={s.featureTitle}>Two fees, one chart</span>
            <span className={s.featureDesc}>The flat fee, Fables&apos; live override and clim&apos;s recommendation, each read from the chain.</span>
          </div>
        </div>
        <div className={s.feature}>
          <div className={s.plate}>
            <span className={s.tag}>Desk</span>
            <div className={s.deskTicker}>
              <span className={s.deskSeq}>{c ? <LiveValue k="clim:seq" chain="testnet" block={c.quote.blockNumber} raw={c.quote.seq} text={formatInt(c.quote.seq)} /> : <Skeleton />}</span>
              <span className={s.pillLabel}>reports so far</span>
              {c && age !== null ? <TierBadge badge={deskBadge(MODE_NUMBER[c.quote.mode], age, c.quote.tauKillSec)} /> : null}
            </div>
          </div>
          <div className={s.featureText}>
            <span className={s.featureTitle}>Verifiable by anyone</span>
            <span className={s.featureDesc}>Four venues, one report every 30 s, a fee formula anyone can recompute from the chain.</span>
          </div>
        </div>
        <div className={s.feature}>
          <div className={s.plate} style={{ flexDirection: "column" }}>
            <span className={s.tag}>Bounds</span>
            <div className={s.band}>
              {f ? <span className={s.bandMark} style={{ left: bandPos(f.fee0For1), background: "var(--brand)" }} title="Fables keeper" /> : null}
              {c ? <span className={s.bandMark} style={{ left: bandPos(c.quote.fee), background: "var(--ink)" }} title="clim" /> : null}
            </div>
            <div className={s.bandLabels}>
              <span>{formatFeePct(EFFECTIVE_FLOOR)}</span>
              <span>{formatFeePct(FABLES.config.capPips)}</span>
            </div>
          </div>
          <div className={s.featureText}>
            <span className={s.featureTitle}>Inside your bounds</span>
            <span className={s.featureDesc}>Your hook&apos;s floor, cap and TTL; only roles you grant; revoked in one call.</span>
          </div>
        </div>
      </div>

      <div className={s.featured}>
        <span className={s.unicorn} aria-hidden />
        <Card>
          <div className={s.featuredHead}>
            <h2 className={s.featuredTitle}>Featured markets</h2>
            <Link href="/markets" className={s.viewAll}>
              <span className={s.viewAllInner}>
                View all markets <ArrowRightIcon size={14} />
              </span>
            </Link>
          </div>
          <MarketsTable />
          <div className={s.foot}>
            <div className={s.footLeft}>
              <span className={s.footMark} aria-hidden>
                c
              </span>
              <div>
                <div className={s.footTitle}>Verified by clim</div>
                <div className={s.footSub}>Every number here is read from the chain or quoted from a committed evidence file</div>
              </div>
            </div>
            <ButtonLink href="/evidence" variant="cta">
              See the evidence
            </ButtonLink>
          </div>
        </Card>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Replace `app/src/app/page.tsx`**

```tsx
import { Landing } from "@/components/landing/Landing";

export default function Home() {
  return <Landing />;
}
```

- [ ] **Step 4: Build**

Run: `cd app && npm run typecheck && npm run lint && npm run build`
Expected: exit 0 and `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/landing app/src/app/page.tsx
git commit -m "feat(app): Fables' landing with clim's thesis and the live keeper and clim fees in the hero"
```

### Task 20: Docs layout and Integrate

**Files:**
- Create: `app/src/lib/inlineMd.tsx`, `app/src/lib/inlineMd.test.tsx`, `app/src/components/docs/docs.module.css`, `app/src/components/docs/Docs.tsx`, `app/src/components/integrate/LiveCompose.tsx`, `app/src/app/integrate/page.tsx`

- [ ] **Step 1: Write the failing test `app/src/lib/inlineMd.test.tsx`**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { inlineMd, resolveHref } from "./inlineMd";

describe("resolveHref", () => {
  it("points a relative link at the file on GitHub", () => {
    expect(resolveHref("../../cre/README.md", "docs/integrate")).toBe("https://github.com/gamween/clim-fables/blob/main/cre/README.md");
    expect(resolveHref("keeper-read.ts", "docs/integrate")).toBe("https://github.com/gamween/clim-fables/blob/main/docs/integrate/keeper-read.ts");
    expect(resolveHref("sessions/2026-10-14.md", "docs")).toBe("https://github.com/gamween/clim-fables/blob/main/docs/sessions/2026-10-14.md");
  });
  it("keeps anchors and folders", () => {
    expect(resolveHref("../../shared/abis/", "docs/integrate")).toBe("https://github.com/gamween/clim-fables/tree/main/shared/abis");
    expect(resolveHref("README.md#gas-and-cost", "docs/integrate")).toBe("https://github.com/gamween/clim-fables/blob/main/docs/integrate/README.md#gas-and-cost");
  });
  it("leaves absolute links alone", () => expect(resolveHref("https://x.y/z", "docs")).toBe("https://x.y/z"));
});

it("renders code and links, and nothing else", () => {
  const html = renderToStaticMarkup(<p>{inlineMd("see [`keeper-read.ts`](keeper-read.ts) and `max` <b>", "docs/integrate")}</p>);
  expect(html).toBe(
    '<p>see <a href="https://github.com/gamween/clim-fables/blob/main/docs/integrate/keeper-read.ts" target="_blank" rel="noreferrer"><code>keeper-read.ts</code></a> and <code>max</code> &lt;b&gt;</p>',
  );
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run src/lib/inlineMd.test.tsx`
Expected: FAIL, `./inlineMd` does not exist.

- [ ] **Step 3: Write `app/src/lib/inlineMd.tsx`**

```tsx
// Inline Markdown of the repository's docs (table cells, quoted lines): `code` and [text](href), nothing else. Relative
// links resolve against the document's folder and point at the file on GitHub.
import type { ReactNode } from "react";
import { REPO_URL } from "./site";

export function resolveHref(href: string, docDir: string): string {
  if (/^https?:\/\//.test(href)) return href;
  const [path, hash] = href.split("#");
  const parts = `${docDir}/${path}`.split("/").filter((x) => x !== "" && x !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else out.push(p);
  }
  const joined = out.join("/");
  const kind = joined.endsWith("/") || !/\.[a-z0-9]+$/i.test(joined) ? "tree" : "blob";
  return `${REPO_URL}/${kind}/main/${joined}${hash ? `#${hash}` : ""}`;
}

const TOKEN = /(`[^`]+`)|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inlineMd(text: string, docDir: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<code key={i++}>{m[1].slice(1, -1)}</code>);
    else if (m[2] !== undefined && m[3] !== undefined) {
      out.push(
        <a key={i++} href={resolveHref(m[3], docDir)} target="_blank" rel="noreferrer">
          {inlineMd(m[2], docDir)}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
```

- [ ] **Step 4: Run it**

Run: `cd app && npx vitest run src/lib/inlineMd.test.tsx`
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Write `app/src/components/docs/docs.module.css`**

```css
/* Fables' docs layout (inventory §2.10): a 220 px sidebar and a 718 px main column, Inter 16/24 body. */
.docs {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 48px;
  max-width: 1040px;
  margin: 8px auto 0;
  width: 100%;
}
.sidebar {
  position: sticky;
  top: calc(var(--nav-h) + var(--banner-h) + 24px);
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.group {
  display: flex;
  flex-direction: column;
}
.groupLabel {
  color: var(--ink-muted);
  margin-bottom: 4px;
}
.leaf {
  padding: 8px 0;
  font-size: 14px;
  line-height: 22px;
  letter-spacing: -0.09px;
  color: var(--ink-muted);
  transition: color 0.18s;
}
.leaf:hover {
  color: var(--ink-secondary);
}
.leafActive {
  color: var(--ink);
}
.main {
  max-width: 718px;
  font-size: 16px;
  line-height: 24px;
  letter-spacing: -0.09px;
  color: var(--ink-secondary);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.main h1 {
  font-size: 24px;
  line-height: 30px;
  font-weight: 600;
  letter-spacing: -0.24px;
  color: var(--ink);
}
.main h2 {
  font-size: 20px;
  line-height: 22.67px;
  font-weight: 600;
  letter-spacing: -0.33px;
  color: var(--ink);
  margin-top: 32px;
  scroll-margin-top: calc(var(--nav-h) + var(--banner-h) + 24px);
}
.main h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
  margin-top: 8px;
}
.main a {
  color: var(--accent);
  text-decoration: underline;
}
.main a:hover {
  opacity: 0.7;
}
.main strong {
  color: var(--ink);
  font-weight: 500;
}
.main code {
  color: var(--ink);
  background: var(--chip-fill);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.92em;
}
.lead {
  margin-top: 2px;
}
.ruleBig {
  height: 1px;
  background: var(--line);
  border: 0;
  margin: 24px 0 32px;
}
.tableWrap {
  border-radius: var(--radius);
  overflow-x: auto;
  box-shadow: 0 0 0 1px var(--line);
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  line-height: 20px;
}
.table th {
  background: var(--canvas);
  color: var(--ink);
  font-weight: 500;
  text-align: left;
  padding: 16px;
  vertical-align: bottom;
}
.table td {
  padding: 16px;
  border-top: 1px solid var(--line);
  vertical-align: top;
}
.table tr:nth-child(even) td {
  background: var(--card);
}
.caption {
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 20px;
}
.callout {
  border-radius: var(--radius);
  padding: 10px 12px;
  font-size: 14px;
  line-height: 21px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}
.calloutGood {
  background: color-mix(in srgb, var(--positive) 12%, transparent);
  color: var(--positive);
}
.calloutWarn {
  background: color-mix(in srgb, var(--session) 15%, transparent);
  color: var(--session);
}
.code {
  margin: 0;
  padding: 16px;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line-light);
  color: var(--ink);
  font-family: var(--font-text);
  font-size: 13px;
  line-height: 20px;
  overflow-x: auto;
  white-space: pre;
  font-variant-numeric: lining-nums tabular-nums;
}
.details summary {
  cursor: pointer;
  color: var(--ink);
}
.quote {
  margin: 0;
  padding: 12px 16px;
  border-left: 2px solid var(--brand);
  background: var(--card);
  border-radius: 0 var(--radius) var(--radius) 0;
  color: var(--ink);
}
.pass {
  color: var(--positive);
  font-weight: 500;
}
.fail {
  color: var(--negative);
  font-weight: 500;
}
@media (max-width: 900px) {
  .docs {
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: static;
  }
}
```

- [ ] **Step 6: Write `app/src/components/docs/Docs.tsx`**

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { inlineMd } from "@/lib/inlineMd";
import s from "./docs.module.css";

export const SIDEBAR = [
  {
    label: "Integrate",
    href: "/integrate",
    items: [
      ["The ladder", "#ladder"],
      ["Level 1: keeper input", "#level-1"],
      ["Level 2: the batch", "#level-2"],
      ["Verify the contracts", "#verify"],
      ["Path to mainnet", "#mainnet"],
    ],
  },
  {
    label: "Evidence",
    href: "/evidence",
    items: [
      ["Results, as measured", "#results"],
      ["The fork run", "#fork-run"],
      ["Gas and cadence", "#gas"],
      ["The live loop", "#live-loop"],
      ["Desk outages", "#outages"],
      ["Failure modes", "#security"],
    ],
  },
] as const;

export function DocsLayout({ current, children }: { current: "/integrate" | "/evidence"; children: ReactNode }) {
  return (
    <div className={s.docs}>
      <aside className={s.sidebar} aria-label="On this page">
        {SIDEBAR.map((g) => (
          <div key={g.href} className={s.group}>
            <Link href={g.href} className={s.groupLabel}>
              {g.label}
            </Link>
            {g.items.map(([label, hash]) => (
              <Link key={hash} href={`${g.href}${hash}`} className={g.href === current ? `${s.leaf} ${s.leafActive}` : s.leaf}>
                {label}
              </Link>
            ))}
          </div>
        ))}
        <Link href="/run" className={s.leaf}>
          Replay the run
        </Link>
      </aside>
      <article className={s.main}>{children}</article>
    </div>
  );
}

export const Rule = () => <hr className={s.ruleBig} />;
export const Caption = ({ children }: { children: ReactNode }) => <p className={s.caption}>{children}</p>;
export const Callout = ({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "good" | "warn" }) => (
  <div className={`${s.callout} ${tone === "good" ? s.calloutGood : tone === "warn" ? s.calloutWarn : ""}`}>{children}</div>
);
export const Code = ({ children }: { children: string }) => <pre className={s.code}>{children}</pre>;

/** A Markdown table from the repository's docs, cells rendered with their inline code and links. */
export function MdTable({ table, docDir }: { table: { header: string[]; rows: string[][] }; docDir: string }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {table.header.map((h) => (
              <th key={h}>{inlineMd(h, docDir)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{inlineMd(c, docDir)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Table({ header, rows }: { header: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const docsStyles = s;
```

- [ ] **Step 7: Write `app/src/components/integrate/LiveCompose.tsx`**

```tsx
"use client";
// Level 1, live: the published composeFee (docs/integrate/keeper-read.ts, vendored) applied to Fables' fee now and
// clim's quote now. A display of what the keeper diff would post, never a transaction.
import { LiveValue, NetworkTag, Skeleton } from "@/components/ui/kit";
import { useClimNow, useFablesNow, useLevel2Roles } from "@/hooks/live";
import { formatFeePct } from "@/lib/format";
import { composeFee } from "@/vendor/integrate/keeper-read";
import { Table } from "@/components/docs/Docs";

export function LiveCompose() {
  const f = useFablesNow().data;
  const c = useClimNow().data;
  if (!f || !c) return <Skeleton width={240} />;
  const composed = composeFee(f.fee0For1, c.quote);
  return (
    <Table
      header={["Input", "Read from", "Fee"]}
      rows={[
        ["Fables' keeper fee now (currentFee)", <NetworkTag key="m" network="mainnet" />, <LiveValue key="v" k="fables:fee0For1" chain="mainnet" block={f.blockNumber} raw={f.fee0For1} text={formatFeePct(f.fee0For1)} />],
        ["clim's quote() now", <NetworkTag key="t" network="testnet" />, <LiveValue key="v" k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} />],
        [
          <strong key="l">composeFee(keeper, clim)</strong>,
          composed.climUsed ? "clim is fresh, so it counts" : "clim is blind or stale: the keeper's fee alone",
          <strong key="v">
            {formatFeePct(composed.fee)} ({composed.source === "clim" ? "clim's" : "the keeper's"})
          </strong>,
        ],
      ]}
    />
  );
}

export function LiveRoles() {
  const r = useLevel2Roles().data;
  if (!r) return <Skeleton width={240} />;
  const yes = (v: boolean) => (v ? "yes" : "no");
  return (
    <Table
      header={["Role on clim's testnet AccessManager", "Held"]}
      rows={[
        ["FEE_POKER (1) by ClimPoker", <LiveValue key="a" k="roles:poker" chain="testnet" block={r.blockNumber} raw={r.pokerHasFeePoker} text={yes(r.pokerHasFeePoker)} />],
        ["CLIM_RUNNER (7) by clim's runner", <LiveValue key="b" k="roles:runner" chain="testnet" block={r.blockNumber} raw={r.runnerHasClimRunner} text={yes(r.runnerHasClimRunner)} />],
      ]}
    />
  );
}
```

- [ ] **Step 8: Write `app/src/app/integrate/page.tsx`**

```tsx
import type { Metadata } from "next";
import { Callout, Caption, Code, DocsLayout, docsStyles, MdTable, Rule, Table } from "@/components/docs/Docs";
import { LiveCompose, LiveRoles } from "@/components/integrate/LiveCompose";
import { CopyButton } from "@/components/ui/CopyButton";
import integrate from "@/generated/integrate.json";
import { LIVE, sourcifyTestnet, testnetCode } from "@/lib/chain/deployments";
import { FABLES } from "@/lib/chain/fables";
import { shortAddress } from "@/lib/format";
import { repoFile } from "@/lib/site";

export const metadata: Metadata = { title: "Integrate" };

const CONTRACTS = [
  ["RiskDeskV2", LIVE.riskDesk],
  ["ClimFeePolicy", LIVE.policy],
  ["ClimPoker", LIVE.poker],
  ["PokeFeeHook (pools D, K, F)", LIVE.hook],
  ["AccessManager (OpenZeppelin)", LIVE.accessManager],
] as const;

export default function IntegratePage() {
  const batch = integrate.batchFork;
  return (
    <DocsLayout current="/integrate">
      <h1>Integrate</h1>
      <p className={docsStyles.lead}>
        What Fables would change, level by level, with the exact code. Quoted from <a href={repoFile("docs/integrate/README.md")}>docs/integrate/README.md</a>; every address is in{" "}
        <a href={repoFile("shared/deployments/robinhood-testnet.json")}>shared/deployments/robinhood-testnet.json</a>.
      </p>
      <Callout>clim × Fables is a showcase, not affiliated with Fables. Nothing on this page sends a transaction: the live tables are reads.</Callout>
      <Rule />

      <h2 id="ladder">The ladder</h2>
      <MdTable table={integrate.ladder} docDir="docs/integrate" />

      <h2 id="level-1">Level 1: read clim from the keeper</h2>
      <p>
        The keeper diff, around the call it already makes. <code>composeFee</code> returns the higher of the keeper&apos;s fee and clim&apos;s <code>quote()</code> while the desk is fresh, and the
        keeper&apos;s fee alone when it is blind: clim can raise the fee, never lower the keeper&apos;s.
      </p>
      <Code>{integrate.keeperDiff}</Code>
      <h3>Composed now</h3>
      <LiveCompose />
      <Caption>Fables&apos; ETH/USDG hook takes one fee for both directions, so the keeper composes with quote(); a per-direction hook would use composeDirectional with quoteDirectional().</Caption>
      <details>
        <summary>The whole reader, keeper-read.ts (viem only, drop-in)</summary>
        <Code>{integrate.keeperRead}</Code>
      </details>

      <h2 id="level-2">Level 2: the AccessManager batch</h2>
      <p>
        <code>ClimPoker</code> holds FEE_POKER on the hook and is governed by Fables&apos; own AccessManager. The batch, in order, generated by <a href={repoFile("docs/integrate/level2-batch.ts")}>level2-batch.ts</a>{" "}
        from the compiled ABIs:
      </p>
      <MdTable table={integrate.batchCalls} docDir="docs/integrate" />
      <p>
        All six go in one transaction, <code>multicall(bytes[])</code> on the AccessManager <code>{shortAddress(batch.multicall.to)}</code>. The calldata, as sent to Fables&apos; real AccessManager on a mainnet fork by{" "}
        <a href={repoFile("contracts/test/fork/Level2Batch.t.sol")}>Level2Batch.t.sol</a>:
      </p>
      <Table
        header={["Call", "Calldata"]}
        rows={[
          ["multicall (the batch)", <span key="m" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><code>{`${batch.multicall.data.slice(0, 18)}...${batch.multicall.data.slice(-8)}`}</code><CopyButton value={batch.multicall.data} label="the batch calldata" /></span>],
          [batch.revoke.stop.description, <span key="r" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><code>{`${batch.revoke.stop.data.slice(0, 18)}...${batch.revoke.stop.data.slice(-8)}`}</code><CopyButton value={batch.revoke.stop.data} label="the revocation calldata" /></span>],
        ]}
      />
      <h3>Live on clim&apos;s testnet</h3>
      <p>The same calls were sent to clim&apos;s own AccessManager when the stack was deployed; the roles, read now:</p>
      <LiveRoles />

      <h2 id="verify">Verify the contracts</h2>
      <Table
        header={["Contract", "Address", "Blockscout", "Sourcify"]}
        rows={[
          ...CONTRACTS.map(([name, a]) => [name, <code key="a">{shortAddress(a)}</code>, <a key="b" href={testnetCode(a)}>code</a>, <a key="s" href={sourcifyTestnet(a)}>match</a>]),
          [`Fables' ${FABLES.hookContract} (mainnet)`, <code key="a">{shortAddress(FABLES.hook)}</code>, <a key="b" href={`${FABLES.explorer}/address/${FABLES.hook}#code`}>RobinScan</a>, <a key="s" href={FABLES.sourcify}>match</a>],
        ]}
      />

      <h2 id="mainnet">Path to mainnet</h2>
      <p>
        CRE writes to Robinhood Chain testnet only today, so the desk runs there, in the CRE simulator. Level 1 works now: a mainnet keeper can read the testnet desk. When CRE writes to mainnet the desk,
        the policy and ClimPoker are redeployed unchanged; what changes is configuration only. Details in{" "}
        <a href={`${repoFile("docs/integrate/README.md")}#honest-status-and-the-path-to-mainnet`}>Honest status and the path to mainnet</a>.
      </p>
    </DocsLayout>
  );
}
```

- [ ] **Step 9: Build**

Run: `cd app && npm run typecheck && npm run lint && npm run build`
Expected: `○ /integrate` in the route table.

- [ ] **Step 10: Commit**

```bash
git add app/src/lib/inlineMd.tsx app/src/lib/inlineMd.test.tsx app/src/components/docs app/src/components/integrate app/src/app/integrate/page.tsx
git commit -m "feat(app): Integrate in Fables' docs layout: the ladder, the keeper diff composed live, the level 2 batch and its roles"
```

### Task 21: The fork run, Run and Evidence

**Files:**
- Create: `app/src/lib/run.ts`, `app/src/lib/run.test.ts`, `app/src/components/run/RunPlayer.tsx`, `app/src/components/evidence/ForkRunChart.tsx`, `app/src/app/run/page.tsx`, `app/src/app/evidence/page.tsx`

- [ ] **Step 1: Write the failing test `app/src/lib/run.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import reports from "@/generated/fork-reports-2026-10-07.json";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { FABLES } from "./chain/fables";
import { atCursor, buildRun, upTo } from "./run";

const run = buildRun(forkRun, reports, storm);

describe("the recorded fork run", () => {
  it("was run against Fables' real ETH/USDG hook", () => {
    expect(forkRun.hook).toBe(FABLES.hook);
    expect(forkRun.poolId).toBe(FABLES.poolId);
  });
  it("summarises what the README's jq prints", () => {
    expect(run.summary).toMatchObject({ pokes: 180, swaps: 36, swapReverts: 0, forkBlock: 82093378 });
    expect(run.summary.minPokedPips).toBe(Math.min(...forkRun.pokedPips));
    expect(run.summary.maxPokedPips).toBe(Math.max(...forkRun.pokedPips));
  });
  it("puts the keeper's real fee and clim's on the same 90-minute window", () => {
    expect([run.from, run.to]).toEqual([1791337200, 1791342600]);
    expect(run.keeper[0]).toEqual({ t: 1791337200, v: 700 });
    expect(run.clim).toHaveLength(180);
  });
  it("reads every series at the cursor", () => {
    const c = atCursor(run, 1791338250);
    expect(c.keeper).toBe(1468);
    expect(c.clim).not.toBeNull();
    expect(c.swaps).toBe(forkRun.swapT.filter((t) => t <= 1791338250).length);
    expect(upTo(run.clim, run.from + 30)).toEqual([run.clim[0]]);
  });
});

it("refuses a run whose window differs from the keeper's", () => {
  expect(() => buildRun(forkRun, { ...reports, window: { start: 0, end: 1 } }, storm)).toThrow("differ");
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run src/lib/run.test.ts`
Expected: FAIL, `./run` does not exist.

- [ ] **Step 3: Write `app/src/lib/run.ts`**

```ts
// The recorded fork run of 2026-10-07 (docs/evidence/fork-run-2026-10-07.json): clim's desk reports replayed on a fork
// of Robinhood Chain mainnet against Fables' real ETH/USDG hook, with Fables' own keeper fee over the same window
// (lab/out/fables-storm-2026-10-07.json, rebuilt from its mainnet logs) next to it.
import { sigmaE9ToAnnual } from "@clim/shared";
import type { Point } from "@/components/charts/scale";
import { valueAt } from "@/components/charts/scale";

export type ForkRun = {
  forkBlock: number;
  hook: string;
  poolId: string;
  etaE4: number;
  sigmaEstimator: string;
  note: string;
  t: number[];
  pokedPips: number[];
  currentFee0For1Pips: number[];
  currentFee1For0Pips: number[];
  swapT: number[];
  swapFeePips: number[];
  swapZeroForOne: boolean[];
  swapReverts: number;
};
export type ForkReports = { window: { start: number; end: number }; tObs: number[]; sigma5E9: number[]; sigma15E9: number[]; devPips: number[] };
export type Storm = { window: { start: number; end: number }; steps: Array<{ t: number; feePips: number }>; pokes: Array<{ t: number; feePips: number; tx: string }> };

export type Swap = { t: number; feePips: number; zeroForOne: boolean };
export type Run = {
  from: number;
  to: number;
  clim: Point[];
  current: Point[];
  keeper: Point[];
  sigma5: Point[];
  dev: Point[];
  swaps: Swap[];
  summary: { pokes: number; minPokedPips: number; maxPokedPips: number; swaps: number; swapReverts: number; forkBlock: number; keeperPokes: number };
};

export function buildRun(run: ForkRun, reports: ForkReports, storm: Storm): Run {
  if (run.t.length !== run.pokedPips.length || run.swapT.length !== run.swapFeePips.length) throw new Error("fork run arrays differ in length");
  if (storm.window.start !== reports.window.start || storm.window.end !== reports.window.end) throw new Error("the keeper's window and the run's differ");
  return {
    from: reports.window.start,
    to: reports.window.end,
    clim: run.t.map((t, i) => ({ t, v: run.pokedPips[i] as number })),
    current: run.t.map((t, i) => ({ t, v: run.currentFee0For1Pips[i] as number })),
    keeper: storm.steps.map((s) => ({ t: s.t, v: s.feePips })),
    sigma5: reports.tObs.map((t, i) => ({ t, v: sigmaE9ToAnnual(reports.sigma5E9[i] as number) })),
    dev: reports.tObs.map((t, i) => ({ t, v: reports.devPips[i] as number })),
    swaps: run.swapT.map((t, i) => ({ t, feePips: run.swapFeePips[i] as number, zeroForOne: run.swapZeroForOne[i] as boolean })),
    summary: {
      pokes: run.pokedPips.length,
      minPokedPips: Math.min(...run.pokedPips),
      maxPokedPips: Math.max(...run.pokedPips),
      swaps: run.swapT.length,
      swapReverts: run.swapReverts,
      forkBlock: run.forkBlock,
      keeperPokes: storm.pokes.length,
    },
  };
}

/** Each series cut at `t`, for the replay's moving cursor. */
export function upTo(points: readonly Point[], t: number): Point[] {
  return points.filter((p) => p.t <= t);
}

export function atCursor(run: Run, t: number) {
  return {
    clim: valueAt(run.clim, t),
    keeper: valueAt(run.keeper, t),
    sigma5: valueAt(run.sigma5, t),
    dev: valueAt(run.dev, t),
    swaps: run.swaps.filter((s) => s.t <= t).length,
  };
}
```

- [ ] **Step 4: Run it**

Run: `cd app && npx vitest run src/lib/run.test.ts`
Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Write `app/src/components/run/RunPlayer.tsx`**

```tsx
"use client";
// The recorded run, replayed in Fables' pool layout: a cursor moves through the 90 minutes of the 7 October 2026 storm
// and reveals clim's pokes on Fables' real hook (fork) next to Fables' own keeper fee (mainnet, same window).
import { useEffect, useState } from "react";
import { StepChart } from "@/components/charts/StepChart";
import { PeriodButtons } from "@/components/ui/FilterToggle";
import { AsideGrid, ChartPanel, RailRows, Rule, Stat, Swatch } from "@/components/ui/kit";
import forkReports from "@/generated/fork-reports-2026-10-07.json";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { formatFeePct, formatGapPips, formatPct2, formatTooltipTime } from "@/lib/format";
import { atCursor, buildRun, upTo } from "@/lib/run";
import u from "@/components/ui/ui.module.css";

const RUN = buildRun(forkRun, forkReports, storm);
const SPEEDS = { "30x": 30, "60x": 60, "120x": 120 } as const;
type Speed = keyof typeof SPEEDS;
const TICK_MS = 100;

export function RunPlayer() {
  const [t, setT] = useState(RUN.to);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("60x");
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((v) => {
        const next = v + (SPEEDS[speed] * TICK_MS) / 1000;
        if (next >= RUN.to) {
          setPlaying(false);
          return RUN.to;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed]);
  const c = atCursor(RUN, t);
  const play = () => {
    if (t >= RUN.to) setT(RUN.from);
    setPlaying((v) => !v);
  };
  return (
    <AsideGrid
      rail={
        <>
          <Stat label="Cursor" value={<span style={{ fontSize: 16 }}>{formatTooltipTime(Math.round(t))}</span>} secondary="2026-10-07, on the fork" />
          <Rule />
          <RailRows
            rows={[
              { label: "clim, poked", tip: "The fee ClimPoker sent to Fables' hook on the fork", value: formatFeePct(c.clim) },
              { label: "Fables keeper", tip: "The fee Fables' keeper set on mainnet at the same time", value: formatFeePct(c.keeper) },
              { label: "σ 5 min", tip: "The desk's 5-minute volatility in the replayed report", value: c.sigma5 === null ? "-" : formatPct2(c.sigma5) },
              { label: "Venue gap", tip: "Venue mid minus Fables' pool mid in the replayed report", value: formatGapPips(c.dev) },
              { label: "Swaps so far", value: String(c.swaps) },
            ]}
          />
        </>
      }
    >
      <ChartPanel
        top={
          <>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <button type="button" className={u.secondary} style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={play} aria-pressed={playing}>
                {playing ? "Pause" : t >= RUN.to ? "Replay" : "Play"}
              </button>
              <input
                type="range"
                aria-label="Cursor"
                min={RUN.from}
                max={RUN.to}
                step={30}
                value={Math.round(t)}
                onChange={(e) => {
                  setPlaying(false);
                  setT(Number(e.target.value));
                }}
                style={{ width: 220, accentColor: "var(--brand)" }}
              />
            </span>
            <PeriodButtons options={Object.keys(SPEEDS) as Speed[]} value={speed} onChange={setSpeed} />
          </>
        }
        legend={
          <>
            <span style={{ display: "inline-flex", gap: 12 }}>
              <Swatch color="var(--brand)" label="Fables keeper (mainnet)" />
              <Swatch color="var(--ink)" label="clim on the fork" />
              <Swatch color="var(--positive)" label="swap, buy" />
              <Swatch color="var(--negative)" label="swap, sell" />
            </span>
          </>
        }
      >
        <StepChart
          from={RUN.from}
          to={RUN.to}
          format={formatFeePct}
          series={[
            { id: "keeper", label: "Fables keeper", color: "var(--brand)", area: true, points: upTo(RUN.keeper, t) },
            { id: "clim", label: "clim on the fork", color: "var(--ink)", points: upTo(RUN.clim, t) },
          ]}
          markers={RUN.swaps.filter((s) => s.t <= t).map((s) => ({ t: s.t, v: s.feePips, color: s.zeroForOne ? "var(--negative)" : "var(--positive)" }))}
        />
      </ChartPanel>
    </AsideGrid>
  );
}
```

- [ ] **Step 6: Write `app/src/app/run/page.tsx`**

The summary is computed in the server component itself: a client module's exports are references, not values, on the server (a prerender of `/run` fails with "Invalid time value" otherwise).

```tsx
import type { Metadata } from "next";
import { RunPlayer } from "@/components/run/RunPlayer";
import { ButtonLink, NetworkTag, Section, Stat } from "@/components/ui/kit";
import forkReports from "@/generated/fork-reports-2026-10-07.json";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { buildRun } from "@/lib/run";
import { FABLES } from "@/lib/chain/fables";
import { formatFeePct, formatInt, formatUtcDateTime } from "@/lib/format";
import { repoFile } from "@/lib/site";
import p from "@/components/pages.module.css";

export const metadata: Metadata = { title: "The run" };

// Server-side: a client module's exports are references, not values, in a server component.
const RUN = buildRun(forkRun, forkReports, storm);
const RUN_SUMMARY = RUN.summary;
const RUN_WINDOW = { from: RUN.from, to: RUN.to };

export default function RunPage() {
  return (
    <div className={p.pool}>
      <div className={p.poolHead}>
        <div className={p.identity}>
          <div>
            <h1 className={p.pairTitle}>The run, 7 October 2026</h1>
            <div className={p.pairSub}>
              <span className={p.pairSubMuted}>A fork of Robinhood Chain mainnet at block {formatInt(RUN_SUMMARY.forkBlock)}, against Fables&apos; real ETH/USDG hook. Nothing was sent to mainnet.</span>
              <NetworkTag network="mainnet" />
            </div>
          </div>
          <div className={p.actions}>
            <ButtonLink href={repoFile("docs/evidence/fork-run-2026-10-07.json")}>The recorded file</ButtonLink>
          </div>
        </div>
      </div>
      <div className={p.statRow}>
        <Stat label="Pokes" tip="ClimPoker.poke() calls on the fork, one per replayed desk report" value={formatInt(RUN_SUMMARY.pokes)} secondary="one every 30 s" />
        <Stat label="Poked fee" tip="Lowest and highest fee clim sent to Fables' hook" value={`${formatFeePct(RUN_SUMMARY.minPokedPips)} to ${formatFeePct(RUN_SUMMARY.maxPokedPips)}`} secondary="inside the hook's band" />
        <Stat label="Swaps" tip="Swaps sent both ways on the fork; each paid the hook's currentFee" value={formatInt(RUN_SUMMARY.swaps)} secondary={`${RUN_SUMMARY.swapReverts} reverted`} />
        <Stat label="Keeper overrides" tip="Fables' keeper's FeePoked logs on mainnet in the same window" value={formatInt(RUN_SUMMARY.keeperPokes)} secondary="mainnet, same window" />
        <Stat label="Window" value={<span style={{ fontSize: 16 }}>{formatUtcDateTime(RUN_WINDOW.from).slice(11)}</span>} secondary={`to ${formatUtcDateTime(RUN_WINDOW.to).slice(11)}`} />
      </div>
      <Section
        title="Replay"
        description="clim's desk reports for the storm, replayed every 30 s; ClimPoker pokes Fables' real hook on the fork after each one, and swaps both ways pay the hook's fee. Fables' own keeper fee over the same 90 minutes is drawn next to it, rebuilt from its mainnet logs."
      >
        <RunPlayer />
        <p className={p.note}>
          Recorded by <code>npm run demo:fork</code> ({forkRun.sigmaEstimator} estimator, etaE4 {formatInt(forkRun.etaE4)}). {forkRun.note}. Hook <code>{FABLES.hook}</code>. The run shows
          that clim&apos;s pokes land inside Fables&apos; bounds on its real hook and that swaps pay them; it is not a claim that clim prices the storm better than the keeper.
        </p>
      </Section>
    </div>
  );
}
```

- [ ] **Step 7: Write `app/src/components/evidence/ForkRunChart.tsx`**

```tsx
"use client";
import { StepChart } from "@/components/charts/StepChart";
import { ChartPanel, Swatch } from "@/components/ui/kit";
import forkReports from "@/generated/fork-reports-2026-10-07.json";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { formatFeePct } from "@/lib/format";
import { buildRun } from "@/lib/run";

const RUN = buildRun(forkRun, forkReports, storm);

/** The whole fork run at once: Fables' keeper on mainnet and clim on the fork, same window. */
export function ForkRunChart() {
  return (
    <ChartPanel
      legend={
        <span style={{ display: "inline-flex", gap: 12 }}>
          <Swatch color="var(--brand)" label="Fables keeper (mainnet)" />
          <Swatch color="var(--ink)" label="clim on the fork" />
        </span>
      }
    >
      <StepChart
        from={RUN.from}
        to={RUN.to}
        format={formatFeePct}
        height={220}
        series={[
          { id: "keeper", label: "Fables keeper", color: "var(--brand)", area: true, points: RUN.keeper },
          { id: "clim", label: "clim on the fork", color: "var(--ink)", points: RUN.clim },
        ]}
      />
    </ChartPanel>
  );
}
```

- [ ] **Step 8: Write `app/src/app/evidence/page.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Caption, DocsLayout, docsStyles as s, MdTable, Rule, Table } from "@/components/docs/Docs";
import { ForkRunChart } from "@/components/evidence/ForkRunChart";
import { OutagesTable } from "@/components/pool/Outages";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import gas from "@/generated/gas-robinhood-testnet.json";
import labFraming from "@/generated/lab-framing.json";
import liveCheck from "@/generated/live-check.json";
import security from "@/generated/security.json";
import { formatFeePct, formatInt } from "@/lib/format";
import { inlineMd } from "@/lib/inlineMd";
import { repoFile } from "@/lib/site";

export const metadata: Metadata = { title: "Evidence" };

const GAS_ROWS = [
  ["Desk report (CRE simulator, through the mock forwarder)", gas.deskReport],
  ["ClimPoker.poke() on pool D", gas.poke],
  ["Keeper-style pokeFee on pool K", gas.keeperPoke],
  ["Arbitrage swap", gas.arbSwap],
  ["Retail swap", gas.retailSwap],
] as const;

export default function EvidencePage() {
  const checks = Object.entries(liveCheck.data.checks);
  return (
    <DocsLayout current="/evidence">
      <h1>Evidence</h1>
      <p className={s.lead}>
        Every number on this page is quoted from a committed file in the repository, named next to it; the live numbers elsewhere in the showcase are read from the chain. Results are published as
        measured, including where Fables&apos; keeper does better.
      </p>
      <Rule />

      <h2 id="results">Results, as measured</h2>
      <p>Lab studies on Fables&apos; ETH/USDG pool, 2026-09-07 to 2026-10-12, quoted verbatim from the framing field of each output:</p>
      {labFraming.map((f) => (
        <div key={f.file}>
          <h3>{f.title}</h3>
          <blockquote className={s.quote}>{f.framing}</blockquote>
          <Caption>
            <a href={repoFile(f.file)}>{f.file}</a>
          </Caption>
        </div>
      ))}
      <Callout>clim does not claim lower or better fees than Fables&apos; keeper. The case is verifiability, redundancy and the per-direction signal.</Callout>

      <h2 id="fork-run">The fork run, 7 October 2026</h2>
      <p>
        The storm of 7 October replayed on a fork of Robinhood Chain mainnet (block {formatInt(forkRun.forkBlock)}) against Fables&apos; real ETH/USDG hook: {forkRun.pokedPips.length} pokes from{" "}
        {formatFeePct(Math.min(...forkRun.pokedPips))} to {formatFeePct(Math.max(...forkRun.pokedPips))}, {forkRun.swapFeePips.length} swaps, {forkRun.swapReverts} reverted. Fables&apos; own keeper fee over the same
        window is rebuilt from its mainnet logs.
      </p>
      <ForkRunChart />
      <Caption>
        <a href={repoFile("docs/evidence/fork-run-2026-10-07.json")}>docs/evidence/fork-run-2026-10-07.json</a> and <a href={repoFile("lab/out/fables-storm-2026-10-07.json")}>lab/out/fables-storm-2026-10-07.json</a>.{" "}
        <Link href="/run">Replay it</Link>.
      </Caption>

      <h2 id="gas">Gas and cadence</h2>
      <Table
        header={["Transaction", "Receipts", "Gas, median", "Gas, p90"]}
        rows={GAS_ROWS.map(([label, g]) => [label, formatInt(g.n), formatInt(g.gasUsedMedian), formatInt(g.gasUsedP90)])}
      />
      <p>
        Cadence over blocks {formatInt(gas.cadence.fromBlock)} to {formatInt(gas.cadence.toBlock)}: {formatInt(gas.cadence.deskReport.n)} desk reports, a median gap of {gas.cadence.deskReport.medianGapSec} s (p90{" "}
        {gas.cadence.deskReport.p90GapSec} s), {formatInt(gas.cadence.deskReport.perDay)} reports a day; {formatInt(gas.cadence.poke.perDay)} pokes a day.
      </p>
      <Caption>
        <a href={repoFile("docs/evidence/gas-robinhood-testnet.json")}>docs/evidence/gas-robinhood-testnet.json</a> (chain {gas.chainId}, generated {gas.generatedAt}). The cost section of the integration guide is generated
        from it.
      </Caption>

      <h2 id="live-loop">The live loop</h2>
      <Table
        header={["Check", "Result"]}
        rows={checks.map(([name, c]) => [name, <span key="r" className={c.pass ? s.pass : s.fail}>{c.pass ? "PASS" : "FAIL"}</span>])}
      />
      <Caption>
        <a href={repoFile(liveCheck.file)}>{liveCheck.file}</a>, blocks {formatInt(Number(liveCheck.data.fromBlock))} to {formatInt(Number(liveCheck.data.toBlock))} (<code>cd bots && bun run live:verify</code>).
      </Caption>

      <h2 id="outages">Desk outages</h2>
      <OutagesTable />

      <h2 id="security">Failure modes and the fee that results</h2>
      <p>{inlineMd(security.intro, "docs")}</p>
      <MdTable table={security.failureModes} docDir="docs" />
      <Caption>
        From <a href={repoFile("docs/security.md")}>docs/security.md</a> §7, which also covers who controls what, the desk&apos;s guards and the CRE path.
      </Caption>
    </DocsLayout>
  );
}
```

- [ ] **Step 9: Build**

Run: `cd app && npm run typecheck && npm run lint && npm run build`
Expected: `○ /evidence` and `○ /run` in the route table.

- [ ] **Step 10: Commit**

```bash
git add app/src/lib/run.ts app/src/lib/run.test.ts app/src/components/run app/src/components/evidence app/src/app/run/page.tsx app/src/app/evidence/page.tsx
git commit -m "feat(app): replay of the 7 October fork run next to Fables' keeper, and the evidence page

Lab framing strings verbatim, gas and cadence, the live loop check, outages and the failure modes of docs/security.md."
```

### Task 22: Credits, licences and the 404

**Files:**
- Create: `app/src/app/credits/page.tsx`, `app/src/app/not-found.tsx`, `app/public/third-party-licenses.txt`

- [ ] **Step 1: Write `app/src/app/credits/page.tsx`**

```tsx
import type { Metadata } from "next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { docsStyles as s } from "@/components/docs/Docs";
import { NOTICES_MD } from "@/generated/notices";

export const metadata: Metadata = { title: "Credits and licences" };

/** THIRD_PARTY_NOTICES.md, rendered: Fables' assets, fonts and the npm packages' licences. */
export default function CreditsPage() {
  return (
    <article className={s.main} style={{ margin: "8px auto 0", width: "100%" }}>
      <Markdown remarkPlugins={[remarkGfm]}>{NOTICES_MD}</Markdown>
    </article>
  );
}
```

- [ ] **Step 2: Write `app/src/app/not-found.tsx`**

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "64px 0" }}>
      <span aria-hidden style={{ width: 200, height: 131, background: "var(--ink)", mask: "url(/fables/fox_star_logo.svg) center / contain no-repeat" }} />
      <p style={{ fontSize: 16, lineHeight: "24px", fontWeight: 450, color: "var(--ink-secondary)" }}>Sorry, we couldn&apos;t find that page.</p>
      <Link href="/" style={{ color: "var(--ink-muted)" }}>
        Back to Home
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Generate the npm licences file**

Run: `cd app && npm run licenses && head -3 public/third-party-licenses.txt && grep -ci "wagmi\|metamask\|rainbowkit" public/third-party-licenses.txt`
Expected: `This file was generated with the generate-license-file npm package!`, then `0` (no wallet package is a dependency). npm may warn `EBADENGINE`; the file is written anyway.

- [ ] **Step 4: Run every unit test, typecheck, lint, build**

Run: `cd app && npm test && npm run typecheck && npm run lint && npm run build`
Expected: `Test Files  21 passed (21)`, `Tests  121 passed (121)` (the bundle test of Task 23 brings it to 22 and 122), exit 0, and a route table listing `/`, `/credits`, `/evidence`, `/integrate`, `/markets`, `/markets/d`, `/markets/k`, `/markets/f`, `/markets/eth` and `/run`.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/credits/page.tsx app/src/app/not-found.tsx app/public/third-party-licenses.txt
git commit -m "feat(app): credits and licences (Fables' assets and fonts named), npm licences, Fables' 404"
```

### Task 23: Bundle scan and browser guardrails

**Files:**
- Create: `app/scripts/check-bundle.mjs`, `app/scripts/check-bundle.test.ts`, `app/playwright.config.ts`, `app/e2e/guardrails.spec.ts`

- [ ] **Step 1: Write the failing test `app/scripts/check-bundle.test.ts`**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { scanBundle } from "./check-bundle.mjs";

it("finds a wallet request in a built chunk and passes a clean one", () => {
  const dir = mkdtempSync(join(tmpdir(), "static-"));
  mkdirSync(join(dir, "chunks"));
  writeFileSync(join(dir, "chunks/a.js"), 'e.request({method:"eth_call"})');
  expect(scanBundle(dir)).toEqual([]);
  writeFileSync(join(dir, "chunks/b.js"), 'e.request({method:"eth_requestAccounts"})');
  expect(scanBundle(dir)).toEqual(["chunks/b.js: eth_requestAccounts"]);
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run scripts/check-bundle.test.ts`
Expected: FAIL, `./check-bundle.mjs` cannot be loaded.

- [ ] **Step 3: Write `app/scripts/check-bundle.mjs`**

```js
// After `next build`: the browser bundle carries no wallet provider, connector or signing request. viem's public
// client keeps its sendRawTransaction action in the bundle (it ships with publicActions, and the app never calls it:
// src/guardrails.test.tsx scans the sources, e2e/guardrails.spec.ts records every RPC method the pages send), so that
// one string is not in this list, nor is "WalletConnect", which is in the name of one of viem's RPC error classes
// (WalletConnectSessionSettlementError); the lowercase package and relay name "walletconnect" is.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_IN_BUNDLE = [
  "eth_requestAccounts",
  "eth_accounts",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData",
  "wallet_requestPermissions",
  "wallet_switchEthereumChain",
  "walletconnect",
  "rainbowkit",
  "metamask",
  "MetaMask",
  "window.ethereum",
  "coinbaseWallet",
];

function jsFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? jsFiles(p) : n.endsWith(".js") ? [p] : [];
  });
}

export function scanBundle(staticDir) {
  const hits = [];
  for (const f of jsFiles(staticDir)) {
    const text = readFileSync(f, "utf8");
    for (const s of FORBIDDEN_IN_BUNDLE) if (text.includes(s)) hits.push(`${f.slice(staticDir.length + 1)}: ${s}`);
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const staticDir = join(dirname(dirname(fileURLToPath(import.meta.url))), ".next/static");
  const hits = scanBundle(staticDir);
  if (hits.length > 0) {
    console.error(`wallet code in the bundle:\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log(`bundle clean: ${jsFiles(staticDir).length} files, no wallet provider, connector or signing request`);
}
```

- [ ] **Step 4: Run the test and the scan**

Run: `cd app && npx vitest run scripts/check-bundle.test.ts && npm run build && npm run check:bundle`
Expected: `Tests  1 passed (1)`, then `bundle clean: 24 files, no wallet provider, connector or signing request` (the file count moves with the build).

- [ ] **Step 5: Write `app/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

// BASE_URL points the checks at a deployment (for instance https://clim-fables.vercel.app); without it they start the
// production build locally (`npm run build` first). Viewport: the maintainer's MacBook, 1470 x 956 CSS px.
const external = process.env.BASE_URL;
const PORT = 3311;

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: external ?? `http://localhost:${PORT}`, browserName: "chromium", viewport: { width: 1470, height: 956 } },
  webServer: external ? undefined : { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}/markets`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
```

- [ ] **Step 6: Write `app/e2e/guardrails.spec.ts`**

```ts
// Every route keeps the showcase guardrails (CLAUDE.md, spec §5.5): the permanent banner, "clim × Fables" in the nav,
// the inert wallet pill and no "Connect", and pages that only ever read the chain.
import { expect, test } from "@playwright/test";
import { BANNER_TEXT, NO_WALLET_TEXT, ROUTES } from "../src/lib/site";

/** JSON-RPC methods the app may send: reads only. */
const READ_METHODS = new Set(["eth_call", "eth_getLogs", "eth_blockNumber", "eth_getBlockByNumber", "eth_chainId"]);
const RPC_HOSTS = ["rpc.mainnet.chain.robinhood.com", "rpc.testnet.chain.robinhood.com", "rpc.ordofi.network"];

for (const route of [...ROUTES, "/no-such-page"]) {
  test(`guardrails on ${route}`, async ({ page, baseURL }) => {
    const site = new URL(baseURL ?? "http://localhost").host;
    const methods = new Set<string>();
    const hosts = new Set<string>();
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.protocol.startsWith("http") && url.host !== site) hosts.add(url.host);
      if (!RPC_HOSTS.includes(url.host) || req.method() !== "POST") return;
      const body = req.postDataJSON() as { method: string } | Array<{ method: string }>;
      for (const call of Array.isArray(body) ? body : [body]) methods.add(call.method);
    });
    await page.goto(route);
    await expect(page).toHaveTitle(/clim × Fables/);

    const banner = page.locator('[data-guard="banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(BANNER_TEXT);
    await expect(banner.locator("button, a")).toHaveCount(0);

    await expect(page.locator('[data-guard="identity"]')).toHaveText("clim×Fables");
    const pill = page.locator('[data-guard="no-wallet"]');
    await expect(pill).toHaveText(NO_WALLET_TEXT);
    await expect(pill).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: /connect|wallet/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /connect wallet|deposit|swap/i })).toHaveCount(0);

    // The banner stays on screen after a scroll.
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(500);
    expect((await banner.boundingBox())?.y).toBe(0);

    // Let the live reads run, then check that every RPC call was a read and that no other host was contacted.
    await page.waitForTimeout(8_000);
    expect([...methods].filter((m) => !READ_METHODS.has(m))).toEqual([]);
    expect([...hosts].filter((h) => !RPC_HOSTS.includes(h))).toEqual([]);
  });
}

test("pool pages label their network", async ({ page }) => {
  for (const [route, network] of [["/markets/eth", "mainnet"], ["/markets/d", "testnet"], ["/markets/k", "testnet"], ["/markets/f", "testnet"]] as const) {
    await page.goto(route);
    await expect(page.locator(`[data-qa="pool-head"] [data-network="${network}"]`)).toBeVisible();
  }
});
```

- [ ] **Step 7: Run the browser guardrails**

Run: `cd app && npm run e2e:guardrails`
Expected: `12 passed` (about 2 minutes: each route lets its reads run for 8 s and records every JSON-RPC method). A stale `next start` on port 3311 from an earlier step is reused by Playwright outside CI: stop it first (`lsof -ti tcp:3311 | xargs kill`) so the checks run on the latest build.

- [ ] **Step 8: Commit**

```bash
git add app/scripts/check-bundle.mjs app/scripts/check-bundle.test.ts app/playwright.config.ts app/e2e/guardrails.spec.ts
git commit -m "test(app): bundle scan for wallet code and browser guardrails on every route

Banner fixed and undismissable, clim x Fables identity, no Connect, read-only JSON-RPC methods, no host but the RPCs."
```

### Task 24: The headless live check

**Files:**
- Create: `app/e2e/resolvers.ts`, `app/e2e/live.spec.ts`

- [ ] **Step 1: Write `app/e2e/resolvers.ts`**

```ts
// Reads, from a fresh client in Node, the value behind every live key at the block the page read it, so the live check
// compares the page with the chain itself.
import { accessManagerAbi, climFeePolicyAbi, riskDeskV2Abi, stateViewAbi, type LivePoolName } from "@clim/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { LIVE } from "../src/lib/chain/deployments";
import { hookViewAbi } from "../src/lib/chain/events";
import { FABLES } from "../src/lib/chain/fables";
import { readPoolOverrides } from "../src/lib/chain/readClim";
import { readFablesPokes, readSwaps } from "../src/lib/chain/readFables";
import { feeWindow, swapWindow } from "../src/lib/windowStats";

export type LiveElement = { key: string; chain: string; block: string; raw: string; text: string; fromBlock?: string; toBlock?: string; fromTs?: string; toTs?: string };

// The public endpoints rate-limit ("Rate Limit Hit, limit will reset in 60 seconds"): batch like the app and back off
// for up to about a minute (2 + 4 + 8 + 16 + 32 s) before a read fails.
const transport = (url: string) => http(url, { batch: { batchSize: 50, wait: 16 }, retryCount: 5, retryDelay: 2_000 });
const mainnet = createPublicClient({ chain: robinhood, transport: transport(process.env.RH_MAINNET_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com") }) as PublicClient;
const testnet = createPublicClient({ chain: robinhoodTestnet, transport: transport(process.env.RH_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com") }) as PublicClient;
const MODES = ["normal", "degraded", "blind"] as const;

function range(e: LiveElement) {
  if (!e.fromBlock || !e.toBlock || !e.fromTs || !e.toTs) throw new Error(`${e.key}: no range`);
  return { fromBlock: BigInt(e.fromBlock), toBlock: BigInt(e.toBlock), fromTs: Number(e.fromTs), toTs: Number(e.toTs) };
}

/** The raw value of `e.key` on chain at `e.block` (or over its range), as the page writes it in data-raw. */
export async function resolve(e: LiveElement): Promise<string> {
  const blockNumber = BigInt(e.block);
  const [ns, a, b] = e.key.split(":") as [string, string, string | undefined];
  if (ns === "fables") {
    if (a === "fee0For1" || a === "fee1For0") {
      return String(await mainnet.readContract({ address: FABLES.hook, abi: hookViewAbi, functionName: "currentFee", args: [FABLES.poolId, a === "fee0For1"], blockNumber }));
    }
    if (a === "price") return String((await mainnet.readContract({ address: FABLES.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [FABLES.poolId], blockNumber }))[0]);
    const r = range(e);
    const w = feeWindow(await readFablesPokes(mainnet, r.fromBlock, r.toBlock), FABLES.config, r.toTs, r.toTs - r.fromTs);
    return windowValue(w, a);
  }
  if (ns === "clim") {
    if (a === "quote" || a === "mode") {
      const [fee, mode] = await testnet.readContract({ address: LIVE.policy, abi: climFeePolicyAbi, functionName: "quote", blockNumber });
      return a === "quote" ? String(fee) : MODES[mode] ?? String(mode);
    }
    if (a === "fee0For1" || a === "fee1For0") {
      const [f01, f10] = await testnet.readContract({ address: LIVE.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional", blockNumber });
      return String(a === "fee0For1" ? f01 : f10);
    }
    const [tObs, seq] = await testnet.readContract({ address: LIVE.policy, abi: climFeePolicyAbi, functionName: "lastObservation", blockNumber });
    return String(a === "seq" ? seq : tObs);
  }
  if (ns === "desk") {
    const st = await testnet.readContract({ address: LIVE.riskDesk, abi: riskDeskV2Abi, functionName: "state", blockNumber });
    return String(a === "sigma5" ? st[2] : st[3]);
  }
  if (ns === "roles") {
    const [id, who] = a === "poker" ? [BigInt(LIVE.roles.feePoker), LIVE.poker] : [BigInt(LIVE.roles.climRunner), LIVE.roles.runner];
    return String((await testnet.readContract({ address: LIVE.accessManager, abi: accessManagerAbi, functionName: "hasRole", args: [id, who], blockNumber }))[0]);
  }
  if (ns === "pool" && b) {
    const pool = a as LivePoolName;
    const poolId = LIVE.pools[pool].poolId;
    if (b === "fee0For1" || b === "fee1For0") return String(await testnet.readContract({ address: LIVE.hook, abi: hookViewAbi, functionName: "currentFee", args: [poolId, b === "fee0For1"], blockNumber }));
    if (b === "price") return String((await testnet.readContract({ address: LIVE.uniswap.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [poolId], blockNumber }))[0]);
    const r = range(e);
    if (b === "swaps" || b === "meanSwapFee") {
      const sw = swapWindow(await readSwaps(testnet, LIVE.uniswap.poolManager, poolId, r.fromBlock, r.toBlock));
      return String(b === "swaps" ? sw.count : sw.meanFeePips);
    }
    const w = feeWindow(await readPoolOverrides(testnet, pool, r.fromBlock, r.toBlock), LIVE.hookConfig, r.toTs, r.toTs - r.fromTs);
    return windowValue(w, b);
  }
  throw new Error(`no resolver for ${e.key}`);
}

function windowValue(w: ReturnType<typeof feeWindow>, field: string): string {
  if (field === "avg") return String(w.avg);
  if (field === "peak") return String(w.peak);
  if (field === "low") return String(w.low);
  if (field === "changes") return String(w.changes);
  throw new Error(`no window field ${field}`);
}
```

- [ ] **Step 2: Write `app/e2e/live.spec.ts`**

```ts
// The headless live check: each route at 1470 px, every number marked [data-live] re-read from the chain at the block
// the page read it (or over the same blocks for a window statistic), compared raw and as shown. Run against the local
// build (`npm run check:live`) or a deployment (`BASE_URL=https://clim-fables.vercel.app npm run check:live`).
import { expect, test } from "@playwright/test";
import { liveText } from "../src/lib/liveKeys";
import { resolve, type LiveElement } from "./resolvers";

const fee = (p: string) => [`${p}:fee0For1`, `${p}:fee1For0`];
const window = (p: string) => [`${p}:avg`, `${p}:peak`, `${p}:low`, `${p}:changes`];
const pool = (n: string) => [...fee(`pool:${n}`), `pool:${n}:price`, ...window(`pool:${n}`), `pool:${n}:swaps`];

/** Keys each route must show once its reads have landed. */
const EXPECTED: Record<string, string[]> = {
  "/": ["fables:fee0For1", "clim:quote", "clim:seq"],
  "/markets": [...fee("fables"), "fables:price", "fables:changes", "clim:seq", ...["D", "K", "F"].flatMap((n) => [...fee(`pool:${n}`), `pool:${n}:price`])],
  "/markets/eth": [...fee("fables"), "fables:price", ...window("fables"), "clim:quote", ...fee("clim"), "clim:mode", "clim:seq", "clim:tObs", "desk:sigma5", "desk:dev"],
  "/markets/d": [...pool("D"), "pool:D:meanSwapFee"],
  "/markets/k": [...pool("K"), "pool:K:meanSwapFee"],
  "/markets/f": [...pool("F"), "pool:F:meanSwapFee"],
  "/integrate": ["fables:fee0For1", "clim:quote", "roles:poker", "roles:runner"],
};

async function liveElements(page: import("@playwright/test").Page): Promise<LiveElement[]> {
  return page.$$eval("[data-live]", (els) =>
    els.map((el) => {
      const d = (el as HTMLElement).dataset;
      return { key: d.live ?? "", chain: d.chain ?? "", block: d.block ?? "", raw: d.raw ?? "", text: (el.textContent ?? "").trim(), fromBlock: d.fromBlock, toBlock: d.toBlock, fromTs: d.fromTs, toTs: d.toTs };
    }),
  );
}

for (const [route, keys] of Object.entries(EXPECTED)) {
  test(`live numbers on ${route} match the chain`, async ({ page }) => {
    await page.goto(route);
    const missing = async () => {
      const shown = new Set((await liveElements(page)).map((e) => e.key));
      return keys.filter((k) => !shown.has(k));
    };
    await expect.poll(missing, { timeout: 150_000, intervals: [2_000] }).toEqual([]);
    const elements = await liveElements(page);
    const seen = new Set<string>();
    for (const e of elements) {
      const id = `${e.key}@${e.block}:${e.fromBlock ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const chainRaw = await resolve(e);
      expect.soft(e.raw, `${e.key} at block ${e.block}`).toBe(chainRaw);
      expect.soft(e.text, `${e.key} as shown`).toBe(liveText(e.key, chainRaw));
    }
    test.info().annotations.push({ type: "checked", description: `${seen.size} live values on ${route}` });
  });
}
```

- [ ] **Step 3: Run it against the local build**

Run: `cd app && npm run typecheck && npm run build && npm run check:live`
Expected: `7 passed` (about 3 minutes). Each test annotates how many live values it checked. A failure names the key, its block and the page's value against the chain's. A "Rate Limit Hit" that outlasts the backoff means the public endpoint throttled this machine: wait one minute and rerun the failed route with `npx playwright test e2e/live.spec.ts -g "<route> match"`.

- [ ] **Step 4: Commit**

```bash
git add app/e2e/resolvers.ts app/e2e/live.spec.ts
git commit -m "test(app): headless live check, every [data-live] number against a fresh chain read at the same block"
```

### Task 25: Visual QA against Fables' screenshots

**Files:**
- Create: `app/e2e/visual.spec.ts`
- Local only: `.local/app-qa/` (gitignored at the root)

- [ ] **Step 1: Write `app/e2e/visual.spec.ts`**

```ts
// Visual QA: each route at Fables' capture size (1450 x 838 CSS px, the maintainer's window), saved next to the Fables
// screenshot of the same surface, and the measured tokens of docs/research/fables-ui-inventory.md checked on the built
// page. Writes .local/app-qa/ (gitignored): <route>.png, <route>-full.png and index.html. Run: npm run qa:visual.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";

const REPO = join(__dirname, "..", "..");
const OUT = join(REPO, ".local/app-qa");
const UI = join(REPO, ".local/fables-ui");
const KIT = join(REPO, ".local/research-2026-10-13/fables-brand/screenshots");

/** Each route and the Fables capture of the same surface. */
const PAIRS = [
  { route: "/", slug: "landing", fables: [join(KIT, "01-landing-hero.jpg"), join(KIT, "09-landing-features-table.jpg")] },
  { route: "/markets", slug: "markets", fables: [join(UI, "02-markets-desktop.jpg")] },
  { route: "/markets/eth", slug: "pool-eth", fables: [join(UI, "03-pool-eth-top.jpg"), join(UI, "04-pool-eth-dynamic-fee.jpg")] },
  { route: "/markets/d", slug: "pool-d", fables: [join(UI, "03-pool-eth-top.jpg")] },
  { route: "/integrate", slug: "integrate", fables: [join(UI, "10-docs-dynamic-fees.jpg")] },
  { route: "/evidence", slug: "evidence", fables: [join(UI, "10-docs-dynamic-fees.jpg")] },
  { route: "/run", slug: "run", fables: [join(UI, "04-pool-eth-dynamic-fee.jpg")] },
  { route: "/no-such-page", slug: "not-found", fables: [join(KIT, "07-404-mascot.jpg")] },
];

/** Measured on www.fables.fi (inventory §1 to §4, .local/fables-ui/measurements.json). */
const TOKENS = [
  { route: "/markets", what: "canvas", sel: "body", prop: "backgroundColor", want: "rgb(16, 15, 15)" },
  { route: "/markets", what: "body text", sel: "body", prop: "fontSize", want: "14px" },
  { route: "/markets", what: "body family", sel: "body", prop: "fontFamily", want: /^Inter/ },
  { route: "/markets", what: "banner height", sel: '[data-qa="banner"]', prop: "height", want: "40px" },
  { route: "/markets", what: "header height", sel: '[data-qa="header"]', prop: "height", want: "80px" },
  { route: "/markets", what: "nav pill height", sel: '[data-qa="nav"]', prop: "height", want: "46px" },
  { route: "/markets", what: "nav pill surface", sel: '[data-qa="nav"]', prop: "backgroundColor", want: "rgb(31, 30, 30)" },
  { route: "/markets", what: "nav pill radius", sel: '[data-qa="nav"]', prop: "borderRadius", want: "12px" },
  { route: "/markets", what: "wordmark", sel: '[data-qa="brand-text"]', prop: "fontSize", want: "32px" },
  { route: "/markets", what: "wordmark family", sel: '[data-qa="brand-text"]', prop: "fontFamily", want: /^Louize/ },
  { route: "/markets", what: "content column", sel: '[data-qa="page"]', prop: "width", want: "1200px" },
  { route: "/markets", what: "page title", sel: '[data-qa="page-title"]', prop: "fontSize", want: "28px" },
  { route: "/markets", what: "table head height", sel: '[data-qa="markets-table"] th', prop: "height", want: "50px" },
  { route: "/markets", what: "market row height", sel: '[data-qa="markets-table"] td', prop: "height", want: "76px" },
  { route: "/markets/eth", what: "pool column", sel: '[data-qa="pool"]', prop: "width", want: "1040px" },
  { route: "/markets/eth", what: "stat value", sel: '[data-qa="stat-value"]', prop: "fontSize", want: "24px" },
  { route: "/markets/eth", what: "section title", sel: '[data-qa="section-title"]', prop: "fontSize", want: "20px" },
  { route: "/markets/eth", what: "chart panel", sel: '[data-qa="chart-panel"]', prop: "backgroundColor", want: "rgb(26, 25, 25)" },
  { route: "/markets/eth", what: "chart panel radius", sel: '[data-qa="chart-panel"]', prop: "borderRadius", want: "12px" },
  { route: "/", what: "hero card", sel: '[data-qa="hero"]', prop: "backgroundColor", want: "rgb(26, 25, 25)" },
  { route: "/", what: "hero headline", sel: '[data-qa="headline"]', prop: "fontSize", want: "48px" },
  { route: "/", what: "hero leading", sel: '[data-qa="headline"]', prop: "lineHeight", want: "56px" },
] as const;

test.use({ viewport: { width: 1450, height: 838 } });

test("screenshots next to Fables' and the token checklist", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  for (const p of PAIRS) {
    await page.goto(p.route);
    await page.waitForTimeout(12_000);
    await page.screenshot({ path: join(OUT, `${p.slug}.png`) });
    await page.screenshot({ path: join(OUT, `${p.slug}-full.png`), fullPage: true });
  }
  const results: Array<{ route: string; what: string; sel: string; prop: string; want: string; got: string; pass: boolean }> = [];
  for (const t of TOKENS) {
    await page.goto(t.route);
    const el = page.locator(t.sel).first();
    await el.waitFor();
    const got = await el.evaluate((node, prop) => {
      if (prop === "width" || prop === "height") return `${Math.round(node.getBoundingClientRect()[prop])}px`;
      return getComputedStyle(node)[prop as "color"];
    }, t.prop);
    const pass = typeof t.want === "string" ? got === t.want : t.want.test(got);
    results.push({ route: t.route, what: t.what, sel: t.sel, prop: t.prop, want: String(t.want), got, pass });
  }
  const rel = (f: string) => relative(OUT, f);
  const html = `<!doctype html><meta charset="utf-8"><title>clim × Fables visual QA</title>
<style>body{background:#100f0f;color:#fff;font:14px Inter,system-ui;margin:24px}img{width:100%;border:1px solid #333}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}td,th{padding:6px 10px;border-bottom:1px solid #333;text-align:left}.ok{color:#66c399}.ko{color:#ff773d}</style>
<h1>clim × Fables, visual QA at 1450 x 838</h1>
<table><tr><th>Route</th><th>Token</th><th>Selector</th><th>Property</th><th>Fables</th><th>Showcase</th><th></th></tr>
${results.map((r) => `<tr><td>${r.route}</td><td>${r.what}</td><td><code>${r.sel}</code></td><td>${r.prop}</td><td>${r.want}</td><td>${r.got}</td><td class="${r.pass ? "ok" : "ko"}">${r.pass ? "match" : "differs"}</td></tr>`).join("\n")}
</table>
${PAIRS.map((p) => `<h2>${p.route}</h2><div class="pair"><div><p>Showcase</p><img src="${p.slug}.png"></div><div><p>Fables</p>${p.fables.map((f) => `<img src="${rel(f)}">`).join("")}</div></div>`).join("\n")}`;
  writeFileSync(join(OUT, "index.html"), html);
  for (const r of results) expect.soft(r.got, `${r.route} ${r.what} (${r.sel} ${r.prop})`).toBe(r.pass ? r.got : r.want);
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npm run fables-assets:check && npm run qa:visual && open ../.local/app-qa/index.html`
Expected: `1 passed`; the page lists the 22 token checks, each "match", then each route's screenshot next to Fables'.

- [ ] **Step 3: Review the pairs by eye, with this checklist**

For each pair, compare at 1450 px and note any difference in `docs/sessions/<date>.md`:
- shell: banner 40 px with the lime glows and dot grid; header 80 px; brand at the content's left edge (x 125); nav pill centred; right cluster at x 1325;
- type: Louize only on the wordmark, the landing headline, "Markets", "Featured markets"; everything else Inter; pool title Inter 28;
- colour: canvas `#100f0f`, cards `#1a1919`, surfaces `#1f1e1e`, raised `#2a2828`, lime only on accents and the keeper's line;
- tables: 8 px row gaps, head cells on canvas, 76 px market rows and 56 px other rows, rounded row ends, hover to canvas;
- Dynamic Fee: rail 308 px, panel 692 px, plot 249 px with dot grid, step line 2 px, tooltip 200 px with a row per series;
- docs: sidebar 220 px, main 718 px, Inter 16/24, blue links;
- motion: menus pop in 0.1 s, chart reveal 0.9 s, live dot pulse 1.8 s; nothing moves with `prefers-reduced-motion`;
- mobile (not observed on Fables live, inventory §0): at 390 px wide in Chrome's device toolbar, the nav pill is hidden (menu), tables scroll horizontally, the stat row wraps to two columns, the banner wraps onto two lines.

- [ ] **Step 4: Commit**

```bash
git add app/e2e/visual.spec.ts
git commit -m "test(app): visual QA, screenshots next to Fables' at 1450 px and the inventory's token checklist"
```

### Task 26: CI

**Files:**
- Modify: `.github/workflows/ci.yml` (append a job after `typescript`)

- [ ] **Step 1: Append the `app` job to `.github/workflows/ci.yml`**

```yaml
  app:
    name: app (vitest, typecheck, lint, build, guardrails)
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    defaults:
      run:
        working-directory: app
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: app/package-lock.json
      - name: Install
        run: npm ci
      - name: Synced copies match the repository
        run: npm run sync:check
      - name: Unit and guardrail tests
        run: npm test
      - name: Typecheck
        run: npm run typecheck
      - name: Lint
        run: npm run lint
      - name: Build (without Fables' brand files, which are not in git)
        run: npm run build
      - name: No wallet code in the bundle
        run: npm run check:bundle
      - name: Chromium
        run: npx playwright install --with-deps chromium
      - name: Guardrails on every route (the pages read the public RPCs; nothing is sent)
        run: npm run e2e:guardrails
```

Also change the workflow's first comment line to: `# CI for clim x Fables: contracts (Foundry), lab (Python, uv), TypeScript packages (Bun), the showcase app (Node). No secret is needed:`.

- [ ] **Step 2: Check the YAML parses and the job runs locally**

Run: `ruby -ryaml -e 'y = YAML.load_file(".github/workflows/ci.yml"); puts y["jobs"].keys.join(" ")'` then `cd app && rm -rf node_modules .next && npm ci && npm run sync:check && npm test && npm run typecheck && npm run lint && npm run build && npm run check:bundle`
Expected: `contracts lab typescript app`, then every app command exits 0 (`Tests  122 passed (122)`).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: app job with synced data check, unit and guardrail tests, typecheck, lint, build, bundle scan and browser guardrails"
```

### Task 27: Vercel project and production deploy

**Files:**
- Modify: `.vercelignore`

- [ ] **Step 1: Replace `.vercelignore`**

```text
# Vercel deploys the showcase app only: the project clim-fables has Root Directory app/, and `vercel deploy --prod`
# runs from the repo root. Upload app/ and nothing else. `npm run sync` (in app/) has already copied what the build
# reads from shared/, docs/, lab/out and bots/out into app/src/vendor and app/src/generated (committed).
# app/public/fables/ (Fables' brand files, gitignored) is uploaded from the maintainer's machine on purpose.
/*
!/app
/app/node_modules
/app/.next
/app/.vercel
/app/.env*
!/app/.env.example
/app/coverage
/app/*.tsbuildinfo
/app/test-results
/app/playwright-report
```

- [ ] **Step 2: Gate the deploy**

Run: `cd app && npm run sync && git status --short src/generated && npm run fables-assets:check && npm test && npm run build && npm run check:bundle`
Expected: no line from `git status` (else commit the refreshed `src/generated/outages.json` first: `git add app/src/generated/outages.json && git commit -m "chore(app): refresh the outage snapshot"`), `public/fables: 7 files in place`, tests and build green, bundle clean.

- [ ] **Step 3: Create the project and set its Root Directory (from the repository root; the token is never printed)**

```bash
set -a; . ~/.config/counsel/deploy.env; set +a
vercel project add clim-fables --token "$VERCEL_TOKEN"
curl -s -X PATCH "https://api.vercel.com/v9/projects/clim-fables" -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"rootDirectory":"app","framework":"nextjs"}' | jq '{name, rootDirectory, framework}'
curl -s "https://api.vercel.com/v9/projects/clim-fables" -H "Authorization: Bearer $VERCEL_TOKEN" | jq -r '"\(.id) \(.accountId)"' > /tmp/clim-fables-vercel-ids
```

Expected: `Success! Project clim-fables added`, then `{"name":"clim-fables","rootDirectory":"app","framework":"nextjs"}`. `/tmp/clim-fables-vercel-ids` holds the project and team ids (not secrets).

- [ ] **Step 4: Deploy to production without touching the repository's `.vercel` link**

```bash
read -r VERCEL_PROJECT_ID VERCEL_ORG_ID < /tmp/clim-fables-vercel-ids
export VERCEL_PROJECT_ID VERCEL_ORG_ID
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

Expected: the CLI ends with `Production: https://clim-fables-<hash>.vercel.app` and `Aliased: https://clim-fables.vercel.app`. If the alias line names another domain, assign it: `vercel alias set <the Production URL> clim-fables.vercel.app --token "$VERCEL_TOKEN"`; if Vercel answers that the domain is taken, stop and ask the maintainer for another name (`clim-fables-showcase.vercel.app` is the fallback to propose).

- [ ] **Step 5: Smoke the production site**

```bash
curl -s https://clim-fables.vercel.app/markets | grep -c "Showcase by clim, not affiliated with Fables"
curl -sI https://clim-fables.vercel.app/fables/fonts/louize-display-medium.woff2 | head -1
curl -sI https://clim-fables.vercel.app/ | grep -i -E "content-security-policy|x-frame-options"
curl -sI https://clim-fables.vercel.app/pool/eth-usdg | grep -i '^location'
```

Expected: `1` or more; `HTTP/2 200`; the CSP with `connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://rpc.ordofi.network https://rpc.testnet.chain.robinhood.com` and `frame-ancestors 'none'`, and `x-frame-options: DENY`; `location: /markets/eth`.

- [ ] **Step 6: Run the browser checks against production**

Run: `cd app && BASE_URL=https://clim-fables.vercel.app npm run e2e:guardrails && BASE_URL=https://clim-fables.vercel.app npm run check:live`
Expected: `12 passed`, then `7 passed`.

- [ ] **Step 7: Commit**

```bash
git add .vercelignore
git commit -m "chore(deploy): upload the showcase app to the Vercel project clim-fables (Root Directory app/)"
```

### Task 28: Documentation and push

**Files:**
- Replace: `app/README.md`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-13-clim-fables-design.md` (§5.5 routes, §5.8 last but two rows), `docs/superpowers/plans/2026-10-13-clim-fables-00-master.md` (table row 04b, Task 5), `docs/sessions/<execution date>.md`

- [ ] **Step 1: Replace `app/README.md`**

```markdown
# clim × Fables · showcase app

Fables' interface, rebuilt one to one from a measured inventory ([`docs/research/fables-ui-inventory.md`](../docs/research/fables-ui-inventory.md)), with clim grafted where it would live in Fables' product. Showcase by clim, not affiliated with Fables: own domain, permanent banner, no wallet connection, no transaction. Live: https://clim-fables.vercel.app

Routes: `/` (landing), `/markets` (with a Fee source column), `/markets/eth` (Fables' ETH/USDG pool, with clim's recommendation in its Dynamic Fee section), `/markets/d`, `/markets/k`, `/markets/f` (clim's testnet pools), `/integrate`, `/evidence`, `/run` (the 7 October fork run), `/credits`.

## Data

- **Live, read only.** Robinhood Chain mainnet (Fables' pool: `currentFee`, `StateView`, `FeePoked` and `Swap` logs) and testnet (clim's `ClimFeePolicy` through `docs/integrate/keeper-read.ts`, `RiskDeskV2`, `ClimPoker` and the pools' hook), over the public RPCs, three blocks behind the head, with retries and batches of at most 50 calls. Log windows start at the exact block of their first second (the RPCs return logs without timestamps). Every number read from a chain carries `data-live`; `npm run check:live` re-reads each one at its block.
- **Synced at build time.** `npm run sync` copies `shared/` into `src/vendor/shared/` (imported as `@clim/shared`), `docs/integrate/keeper-read.ts` into `src/vendor/integrate/`, and the evidence, lab framing strings, integration tables, failure modes and outage snapshot into `src/generated/`. Commit the result: Vercel uploads `app/` only. `npm run sync:check` (CI) fails when a copy is stale.
- **Fables' brand files** (logo, art, Louize, Inter) are not in git: `npm run fables-assets` copies them from the maintainer's local kit into `public/fables/` before a local run or a deploy. Without them the app builds and runs with fallback fonts and no logo.

## Run

    npm ci
    npm run sync
    npm run fables-assets   # needs ../.local/research-2026-10-13/fables-brand
    npm run dev             # http://localhost:3000

## Checks

    npm test                # Vitest: formats, fee rule, readers, sync, guardrails
    npm run typecheck
    npm run lint
    npm run build && npm run check:bundle
    npm run e2e:guardrails  # every route: banner, identity, no wallet, read-only RPC methods
    npm run check:live      # every live number against the chain (BASE_URL=... for a deployment)
    npm run qa:visual       # screenshots next to Fables' in ../.local/app-qa/, token checklist

## RPC limits

The public endpoints have no published limits. Measured on 2026-10-14: `eth_getLogs` spans at most 10,000,000 blocks; a JSON-RPC batch of 200 calls got HTTP 429, 100 went through; bursts of header reads hit "Rate Limit Hit, limit will reset in 60 seconds" on mainnet, and some rejected responses carried a duplicated CORS header the browser refuses. The app reads in batches of 50, retries, falls back to `rpc.ordofi.network` on mainnet (which refuses `eth_getLogs`), and keeps the last good values on screen. `NEXT_PUBLIC_RH_MAINNET_RPC_URL` and `NEXT_PUBLIC_RH_TESTNET_RPC_URL` put another endpoint first; they are built into the browser bundle, so never put a key in them. Production sets neither.

## Deploy

Vercel project `clim-fables`, Root Directory `app/`, deployed from the repository root with the root `.vercelignore` (see plan 04b, Task 27):

    set -a; . ~/.config/counsel/deploy.env; set +a
    VERCEL_PROJECT_ID=<id> VERCEL_ORG_ID=<team id> vercel deploy --prod --yes --token "$VERCEL_TOKEN"

The ids are read with `curl -s https://api.vercel.com/v9/projects/clim-fables -H "Authorization: Bearer $VERCEL_TOKEN" | jq -r '"\(.id) \(.accountId)"'`.

## Credits

`THIRD_PARTY_NOTICES.md`, served at `/credits`; every npm package's licence in `public/third-party-licenses.txt` (`npm run licenses`). The TOKEN2049 dashboard this app replaces is at tag `token2049-submission`.
```

- [ ] **Step 2: Edit the root `README.md`**

1. In the link bar (line 16), put the app first: `**[Showcase app](https://clim-fables.vercel.app)** · **[Verify in 10 minutes](#verify-in-10-minutes)** · ...` (the rest unchanged).
2. In "What is live and what is simulated", add as the first row: `| The showcase app | [clim-fables.vercel.app](https://clim-fables.vercel.app): Fables' interface rebuilt with clim grafted in; reads Fables on mainnet and clim on testnet live; no wallet, no transaction ([`app/`](app/)) |`
3. In "Repository", add after the `docs/` row: ``| [`app/`](app/) | The showcase app (Next.js): Fables' interface with clim's desk, pools, integration and evidence, read live; deployed at [clim-fables.vercel.app](https://clim-fables.vercel.app) |``
4. In "Run every test", add the line `(cd app && npm ci && npm run sync:check && npm test && npm run typecheck && npm run lint && npm run build)`.
5. In "License", replace the two lines starting "- `app/` (the TOKEN2049 dashboard)" with: ``- `app/` (the showcase) lists what is not clim's (Fables' brand files and fonts, which belong to Fables and 205TF and are not committed; its npm packages) in [`app/THIRD_PARTY_NOTICES.md`](app/THIRD_PARTY_NOTICES.md); the TOKEN2049 dashboard's notices stay at tag `token2049-submission`.``

Run: `cd docs/integrate && bun test test/docs.test.ts`
Expected: every test passes (the README still quotes every framing string, lists every testnet contract, has no em dash and only disclaims better fees).

- [ ] **Step 3: Update the spec**

In `docs/superpowers/specs/2026-10-13-clim-fables-design.md` §5.5, replace the **Routes** list with:

```markdown
**Routes (mirroring Fables', plan 04b):**
- `/`: the thesis in one line and the live number (the keeper's fee against clim's recommendation now);
- `/markets`: Fables' list with a "Fee source" column (Fables keeper; clim, keeper-style and flat on testnet);
- `/markets/eth` (`/pool/eth-usdg` redirects there): their pool page with clim in its Dynamic Fee section, showing the
  live overrides against clim's recommendation, sigma, the per-direction fees and the gap;
- `/markets/d`, `/markets/k`, `/markets/f`: clim's testnet pools, with the desk's outages on D;
- `/integrate`: the three levels with exact code (RPC read, the AccessManager batch, `ClimPoker`);
- `/evidence`: the lab, every number with its file; `/run`: the recorded fork run replayed.
```

In §5.8, replace the end of the "Code quality?" row, "App tests and lint join CI with plan 04b", with "the `app` job: synced data check, unit and guardrail tests, typecheck, lint, build, bundle scan and browser guardrails".

- [ ] **Step 4: Update the master plan**

In `docs/superpowers/plans/2026-10-13-clim-fables-00-master.md`: in the table, replace `` `clim-fables-04b-app.md`, dated the day it is written`` with `` `2026-10-14-clim-fables-04b-app.md` ``; in Task 5, tick "Write plan 04b" and, once Task 27 passed, "Execute 04b".

- [ ] **Step 5: Log the session**

Append to `docs/sessions/<execution date>.md` one bullet per line below, each with the numbers its command printed:

```markdown
- (app) Plan 04b executed: `app/` replaced (v1 at tag `token2049-submission`). Vitest: <files> files, <tests> tests; typecheck, lint, build, bundle scan clean; `e2e:guardrails` <n> passed; `check:live` <n> passed locally.
- (app) Deployed to https://clim-fables.vercel.app (Vercel project clim-fables, Root Directory app/, deployment <Production URL>); against production `e2e:guardrails` <n> passed, `check:live` <n> passed.
- (app) Visual QA at 1450 px: <n> of 22 token checks match; differences seen by eye: <list, or "none">. Mobile not verified on a phone.
```

- [ ] **Step 6: Commit and push**

```bash
git add app/README.md README.md docs/superpowers/specs/2026-10-13-clim-fables-design.md docs/superpowers/plans/2026-10-13-clim-fables-00-master.md docs/sessions/<execution date>.md
git commit -m "docs: the showcase app in the README, spec routes, master plan and session log"
git push
```

Then: `gh run list --workflow ci.yml --limit 1` until the run on `main` completes; expected `completed success` with the four jobs green (`gh run view --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'`).

---

## Self-review against the brief

| Requirement | Where |
|---|---|
| One-to-one Fables UI: tokens, Louize + Inter, components, layout, motion, their illustrations and logo | Tasks 5, 13, 14, 16 to 22; assets Task 4; checked in Task 25 |
| Own domain, new Vercel project `clim-fables` | Task 27 |
| Permanent non-dismissable banner "Showcase by clim, not affiliated with Fables" | Task 14 (unit test), Task 23 (every route, after a scroll) |
| "clim × Fables" next to their logo, never their logo alone | Task 14 `Brand`, tests in Tasks 14 and 23 |
| No wallet connection; inert "Showcase: no wallet" pill | Task 14 `NoWalletPill`; no Connect, Deposit or Swap checked in Task 23 |
| No transaction from the app | Task 14 source scan, Task 23 bundle scan, RPC method recording and CSP |
| Live data read only, testnet and mainnet labelled | Tasks 9 to 11 (reads only), `NetworkTag` on every live block, Task 23 network test |
| Desktop first at about 1470 px; mobile from their stylesheet rules, unobserved | Decision 7, breakpoints in the CSS of Tasks 5, 13, 14, 16, 19, 20; Task 25 checklist |
| Landing, markets with Fee source, ETH/USDG Dynamic Fee centerpiece (keeper FeePoked and currentFee next to clim's quote and quoteDirectional, step chart with buy and sell lines, Elevated badge, desk freshness, verify links, tx of each report) | Tasks 16, 17, 19 |
| Pools D, K, F with live fees, swaps and outage windows | Task 18 (snapshot plus `outageWindows` on chain) |
| Integrate: the ladder, the keeper-read snippet, the level 2 batch | Task 20 (from `docs/integrate/` through the sync) |
| Evidence: lab framing verbatim, fork run with Fables' keeper line, gas and cadence, security summary | Task 21 |
| Run view replaying `fork-run-2026-10-07.json` | Task 21 |
| Every number from a chain read or a committed file; never better fees | Decision 3, `LiveValue` and the live check (Task 24), sync check (Task 3), wording test (Task 14) |
| Client-side viem with retries and lag; build-time sync; no key; rate limits documented | Tasks 2, 9, 11, 3; `app/README.md` (Task 28) |
| Replace vs new package, justified; THIRD_PARTY_NOTICES with Fables' attribution | Decision 1, Task 3 |
| Unit tests (parsers, formatters, fee composition, badge logic), guardrail tests, headless live check at 1470 px, typecheck, lint, build | Tasks 3 to 24 |
| CI job | Task 26 |
| Vercel deploy with the existing token approach, never printed | Task 27 |
| README app row | Task 28 |
| Visual QA beside Fables' screenshots with a token checklist | Task 25 |

Consistency checks done on the prototype: every import resolves (typecheck), `LIVE` matches `shared/deployments/robinhood-testnet.json` and the README's addresses (`deployments.test.ts`), Fables' constants match the lab files and hash to the pool id (`fables.test.ts`), event selectors match `shared/`'s ABIs (`events.test.ts`), and every `[data-live]` key has both a resolver (`e2e/resolvers.ts`) and a text rule (`src/lib/liveKeys.ts`), exercised by the live check.

## Open risks

- **Fables' assets and Louize.** The deployed site serves Fables' logo, art and 205TF's commercial Louize; the repository does not. Licensing is the maintainer's call (spec §8). A clone deploy without `.local/` ships fallback fonts and no logo; Task 27 gates on `fables-assets:check`.
- **Public RPC limits.** No published limits; mainnet rate-limited bursts during the prototype ("limit will reset in 60 seconds"), and some rejected responses fail CORS in the browser. The app degrades to stale values and retries; a sustained limit would leave skeletons. A keyless private endpoint can be set with `NEXT_PUBLIC_RH_*_RPC_URL` if needed.
- **Load per visit.** The ETH/USDG page reads 24 h of clim's reports (about 2,880 logs) and the keeper's 24 h of overrides with their block headers; 7D adds about 1,400 headers. Pools D, K, F read 24 h of swaps (a few thousand logs each).
- **Times.** Pool D's and clim's points sit at each report's observation time (`tObs`), a few seconds before the poke lands; their averages are time-weighted on that clock, said on the page.
- **Outage snapshot freshness.** `src/generated/outages.json` is as fresh as the last sync and commit; windows after it come from the chain without the operator's reason. A stale snapshot makes the browser read more `RiskReportedV2` logs.
- **Live data in CI.** The guardrail job loads pages that call the public RPCs from GitHub's runners; the checks do not depend on the answers, but an RPC outage slows the job (each route waits 8 s).
- **Mobile.** Built from Fables' stylesheet breakpoints, never observed live on Fables or verified on a phone.
- **viem's sendRawTransaction.** It ships in the bundle with viem's public actions; nothing calls it (source scan, method recording), but the bundle scan cannot list it as forbidden.
- **Next.js 16 conventions.** `next lint` is gone (ESLint runs directly); `params` is a promise; server components cannot read values exported by client modules (the `/run` page computes its own summary).
