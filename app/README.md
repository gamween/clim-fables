# clim × Fables · showcase app

Fables' interface, rebuilt one to one from a measured inventory ([`docs/research/fables-ui-inventory.md`](../docs/research/fables-ui-inventory.md)), with clim grafted where it would live in Fables' product. Showcase by clim, not affiliated with Fables: own domain, permanent banner, an entry notice (not affiliated, not financial advice, testnet, no wallet, unaudited), no wallet connection, no transaction. The repository is linked from every page (header, landing, footer, notice). Live: https://clim-fables.vercel.app

Routes: `/` (landing), `/markets` (Fables' summary rail with the keeper's fee and clim's over 24 hours, and a Fee source column), `/markets/eth` (Fables' ETH/USDG pool, with clim's recommendation in its Dynamic Fee section), `/markets/d`, `/markets/k`, `/markets/f` (clim's testnet pools), `/integrate`, `/evidence`, `/run` (the 7 October fork run), `/credits`.

## Data

- **Live, read only.** Robinhood Chain mainnet (Fables' pool: `currentFee`, `StateView`, `FeePoked` and `Swap` logs) and testnet (clim's `ClimFeePolicy` through `docs/integrate/keeper-read.ts`, `RiskDeskV2`, `ClimPoker` and the pools' hook), over the public RPCs, three blocks behind the head, with retries and batches of at most 50 calls. Log windows start at the exact block of their first second (the RPCs return logs without timestamps). Every number read from a chain carries `data-live`; `npm run check:live` re-reads each one at its block. Log histories (the 24-hour windows of overrides, reports and swaps) are read by the server too: `/api/history/<series>` keeps each in memory, tops it up in the background once older than 20 s and lets the CDN serve it for 30 s, stale while it refreshes; the browser shows it at once and tops it up from the chain with the newer blocks (`src/lib/chain/series.ts`, `seed.ts`). The 7-day keeper series stays a browser read.
- **Synced at build time.** `npm run sync` copies `shared/` into `src/vendor/shared/` (imported as `@clim/shared`), `docs/integrate/keeper-read.ts` into `src/vendor/integrate/`, and the evidence, lab framing strings, integration tables, failure modes and outage snapshot into `src/generated/`. Commit the result: Vercel uploads `app/` only. `npm run sync:check` (CI) fails when a copy is stale.
- **Fables' brand files** (logo, art, favicon, Louize, Inter) are not in git: `npm run fables-assets` copies them from the maintainer's local kit into `public/fables/` before a local run or a deploy. Without them the app builds and runs with fallback fonts and no logo.
- **The social card** (`public/fables/og.jpg`, 2400 x 1260, used by Open Graph and X) is drawn from those files by `npm run og` (Playwright), so it is not in git either.

## Run

    npm ci
    npm run sync
    npm run fables-assets   # needs ../.local/research-2026-10-13/fables-brand
    npm run og              # the social card, from the brand files
    npm run dev             # http://localhost:3000

## Checks

    npm test                # Vitest: formats, fee rule, readers, sync, guardrails
    npm run typecheck
    npm run lint
    npm run build && npm run check:bundle
    npm run e2e:guardrails  # every route at 1470 and 390 px: banner, identity, title, noindex, no wallet, repo link, read-only
                            # RPC methods; and the entry notice on a first visit (the other specs start with it acknowledged)
    npm run check:live      # every live number against the chain (BASE_URL=... for a deployment)
    npm run qa:visual       # screenshots next to Fables' in ../.local/app-qa/, token checklist, 390 px overflow check
    npm run perf            # load time per route on a cold browser (budget 2.5 s on /markets/eth, 3 s elsewhere)

## RPC limits

The public endpoints have no published limits. Measured on 2026-10-14: `eth_getLogs` spans at most 10,000,000 blocks; a JSON-RPC batch of 200 calls got HTTP 429, 100 went through; bursts of header reads hit "Rate Limit Hit, limit will reset in 60 seconds" on mainnet, and some rejected responses carried a duplicated CORS header the browser refuses. The app reads in batches of 50, retries, falls back to `rpc.ordofi.network` on mainnet (which refuses `eth_getLogs`), and keeps the last good values on screen. `NEXT_PUBLIC_RH_MAINNET_RPC_URL` and `NEXT_PUBLIC_RH_TESTNET_RPC_URL` put another endpoint first; they are built into the browser bundle, so never put a key in them. Production sets neither.

## Deploy

Vercel project `clim-fables`, Root Directory `app/`, deployed from the repository root with the root `.vercelignore` (see plan 04b, Task 27). Check first that the brand files and the social card are in place (`npm run fables-assets:check && npm run og:check`):

    set -a; . ~/.config/counsel/deploy.env; set +a
    VERCEL_PROJECT_ID=<id> VERCEL_ORG_ID=<team id> vercel deploy --prod --yes --token "$VERCEL_TOKEN"

The ids are read with `curl -s https://api.vercel.com/v9/projects/clim-fables -H "Authorization: Bearer $VERCEL_TOKEN" | jq -r '"\(.id) \(.accountId)"'`.

## Credits

`THIRD_PARTY_NOTICES.md`, served at `/credits`; every npm package's licence in `public/third-party-licenses.txt` (`npm run licenses`). The TOKEN2049 dashboard this app replaces is at tag `token2049-submission`.
