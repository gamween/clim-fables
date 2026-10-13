# clim × Fables: design

Date: 2026-10-13. Status: approved in brainstorming, pending the maintainer's review of this file.

## 1. Goal

Turn clim (TOKEN2049 Origins, Ethereum Sepolia, no prize) into a showcase that the Fables team can integrate: a
verifiable volatility desk (Chainlink CRE) that feeds Fables' existing dynamic fee on Robinhood Chain, without a new
pool and without a change to Fables' contracts. The audience is Fables' CTO. Success means he can see, in his own
product's look, what clim would do on his live ETH/USDG pool, how it plugs in, and a run that proves it.

No deadline: everything is built cleanly, and the deck is sent when it is ready.

Non-goals:
- no clim hook or pool of our own (clim plugs into Fables, it does not compete with it);
- nothing written to Robinhood Chain mainnet (mainnet is read only; actions happen on a mainnet fork and on testnet);
- never claim that clim sets better fees than Fables' keeper (see §3);
- no "ask" in the deck.

## 2. What the research established (2026-10-13)

Raw notes, scripts and data: `.local/research-2026-10-13/` (gitignored, not published).

### Fables' fee mechanism (verified source on Sourcify, SPDX UNLICENSED)

- ETH/USDG pool `0xbac3aa3b…e551`, hook FablesRampETH `0x06a889870C8f83640D6816319f72e2aA579b6080`.
- With no override the pool charges a flat fee (7 bp on ETH/USDG); a live override replaces it until it expires.
  - Config since 2026-09-06: floor 1 bp, flat 7 bp, cap 60 bp.
  - At swap time an override is floored at `max(pokeFloor, flat × 50%)` and capped, so the band is 3.5 to 60 bp.
- The hook reads no on-chain oracle. Its own comment: "a flat fee plus an oracle-driven off-chain poke is both
  simpler and strictly better where it matters", and LVR "is invisible without an ORACLE".
- Override entry point: `pokeFee(PoolId poolId, uint24 fee, uint40 ttl) external restricted`.
  - It reverts above the cap, below the floor, or with a TTL of 0 or over 72 h.
  - `clearPoke(PoolId)` removes an override; `currentFee(PoolId, bool zeroForOne)` is a view of the fee a swap would
    pay now.
- Access is an OpenZeppelin AccessManager `0xA362D98B…4f30`.
  - FEE_POKER (role 1) is held by three keys; POKER_ADMIN (role 5) is the deployer and administers FEE_POKER.
  - The code calls the poker role "the one hot key in the system … the likeliest to be compromised".
- Newer hook generation (around block 54.55M):
  - `pokeFee(PoolId, uint24 fee0For1, uint24 fee1For0, uint40 ttl)` sets one fee per swap direction;
  - `setPoolAsymmetry` adds a standing one-sided premium;
  - `autonomousFee(PoolId, bool)` is documented as "the keeper's composition input";
  - ETH/USDG is still on the single-fee hook.

### The keeper's behavior (2026-09-29 to 2026-10-13, ETH/USDG)

- 1,512 overrides, all from one EOA, all with a 7,200 s TTL. The median gap is 179 s, so the pool is effectively
  always under an override.
- Values: minimum 7 bp, median 14.8 bp, 35 posts at the 60 bp cap.
- Correlation with Binance realized volatility: 0.83 (5 min), 0.76 (15 min), 0.46 (60 min).

### Robinhood Chain

- Arbitrum stack, ETH gas.
  - Mainnet: chain ID 4663, about 0.10 s blocks.
  - Testnet: chain ID 46630, settles to Sepolia, about 0.11 s blocks.
  - Both have 1 s timestamps.
- `block.number` returns the L1 block; the L2 block is `ArbSys(0x64).arbBlockNumber()`.
- Uniswap v4 is official on mainnet: PoolManager `0x8366a39c…0951`, StateView `0xf3334192…673b`. The same
  bytecode sits at the same addresses on testnet.
- Chainlink:
  - CRE writes to `robinhood-testnet` (KeystoneForwarder `0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19`, mock
    forwarder `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885`), not to mainnet yet; SDK 1.23 already knows the mainnet
    selector.
  - Data Feeds, Data Streams and CCIP are live on mainnet.
- Sourcify supports both chains; Blockscout verifies on testnet, Etherscan V2 on mainnet.

### Fables' look (official kit at fables.fi/brand, CSS `:root`)

- One dark theme.
  - Canvas #100f0f; card #1a1919; surface #1f1e1e; raised #2a2828.
  - Ink #ffffff, #bcbbbb, #8f8e8e, #636161.
  - Brand #ccff00 (text on it #201d1d); positive #66c399; negative #ff773d; focus #55a7fb.
  - Lines are white at 6, 8 and 12 % alpha.
- Type:
  - Louize Display Medium (205TF) for headings;
  - Inter Variable for UI, with tabular numbers and muted decimals;
  - no monospace.
- Layout: radius 12 px, max width 1,200 px, a 20 px dot grid, a segmented pill nav, row tables with 8 px gaps,
  hand-made SVG charts.
- Motion uses `cubic-bezier(.4,0,.2,1)` at 0.15 to 0.2 s.
- Storybook art: the fox and 7-point star mark, a dragon, a unicorn, an archer and a chest.
- Voice: "Once upon a time / The Prologue", sober British copy.
- Their stack: a Vite + Preact SPA.

## 3. Positioning

Fables' keeper is good: it tracks 5-minute volatility and, in clim's own lab, beat clim's rule at equal average fee on
the September CPI and FOMC storms. The pitch is therefore not "better fees" but:

1. **Verifiability.** A public baseline recomputed from four exchanges, signed by a Chainlink DON, under the one hot
   key Fables' own code flags.
2. **Redundancy.** Fables' event overrides stay on top. clim is a floor and a fallback, never a replacement.
3. **The external mid.** A cross-venue price signal per swap direction, the input that Fables' new per-direction
   hooks need and that their code says is invisible on-chain.
4. **Transparency for LPs.** The fee formula article Fables announced and has not shipped can point to a live,
   public desk.

Every comparison is published as measured, including where the keeper does better.

## 4. Architecture

```
Coinbase · Kraken · Binance · Hyperliquid
              │
  Chainlink CRE risk desk, every 30 s, Robinhood Chain testnet (46630)
              │ signed report (KeystoneForwarder; mock forwarder in simulation)
              ▼
  RiskDesk v2 (testnet): sigma 5 min, sigma 15 min, venue mid vs pool mid per direction,
                         recommendedFee() bounded like Fables' hook
              │
   ┌──────────┼─────────────────────────────┐
   ▼          ▼                             ▼
 Level 0    Level 1                       Level 2
 Shadow     Fables' keeper reads          ClimPoker adapter holding FEE_POKER:
 (reads     recommendedFee() over RPC     fee = max(desk, keeper's event override)
 mainnet)   and composes                  -> pokeFee(poolId, fee, ttl) on Fables' hook
                                          (shown on a Robinhood mainnet fork against
                                          the real ETH/USDG hook)
```

### Integration ladder (what Fables would do)

| Level | Fables' work | Risk to Fables |
|---|---|---|
| 0. Shadow | None: the showcase compares their live overrides with clim's recommendation | None |
| 1. Keeper input | A few lines in their off-chain keeper: read `recommendedFee()` over RPC and compose | No contract touched |
| 2. On-chain adapter | One `grantRole(FEE_POKER, ClimPoker, 0)`, revocable at any time | Bounded by their hook's floor, cap and TTL; a silent desk means no poke and a return to the flat fee after the TTL |

Level 1 works while CRE has no mainnet write: an off-chain keeper can read the testnet desk. When CRE writes to
mainnet, the desk is redeployed there unchanged.

## 5. Components

### 5.1 Lab (`lab/`)

Data:
- Fables ETH/USDG swaps and overrides since 2026-09-06;
- Binance 1 s prices;
- Coinbase, Kraken and Hyperliquid 1 min prices;
- the existing lab cache and the fables-farming history are reused where they cover the window.

Three studies, each a script, a JSON output and tests, each published as measured:

1. **Δt recalibration.**
   - Classify arbitrage swaps (those that move the pool price toward the venue mid).
   - Estimate the effective arbitrage interval two ways:
     - invert the arbitrage frequency (spec §σ_arb, solved for Δt, with c = 1 and c = 0.824);
     - measure the delay from the venue mid leaving the no-arbitrage band to the arbitrage landing.
   - Validate on held-out weeks.
   - Re-run the P* decision with Fables' floor (3.5 to 7 bp) and cap (60 bp).
   - Output: the parameters of `RiskDesk` v2 and `ClimPoker`.
2. **Volatility window.** 5 min against 15 min: agreement with the keeper, and LP loss to arbitrage at equal average
   fee.
3. **Directional signal.**
   - Does the venue mid minus the pool mid, per direction, predict which side is toxic?
   - Measured by markouts of the flow at 5 s, 30 s and 5 min.
   - Output: the per-direction fee rule for the new hooks, or a documented negative result.

### 5.2 CRE workflow (`cre/risk-desk` v2)

- Target `robinhood-testnet`.
- It adds sigma over 5 min and the venue-mid against Fables-pool-mid deviation per direction. The pool mid is read
  from mainnet StateView over HTTP, as data, not as a write.
- Quorum, staleness and dispersion rules are unchanged.
- The friction log continues in `docs/feedback/cre-friction-log.md`.

### 5.3 Contracts (`contracts/`, Foundry)

**`RiskDesk` v2:**
- same guards as v1: report spacing, skew, quorum, volatility envelope, no setter for sigma or the fee;
- adds `recommendedFee()` (single fee) and `recommendedFees()` (`fee0For1`, `fee1For0`), already clamped to the
  target pool's band;
- has a `blind` state when stale.

**`ClimPoker`:**
- holds FEE_POKER;
- `poke(PoolId)` reads the desk, takes `max(desk fee, keeper event override)` where the keeper may post an event
  override with its own expiry, and calls `pokeFee` with a TTL;
- does nothing when the desk is blind;
- is permissionless to trigger, so anyone can poke and the fee always comes from the desk;
- talks to Fables' hook through a minimal interface that we write: the function signatures are public, but their
  source is UNLICENSED and is never copied.

**Tests:**
- unit tests for both contracts;
- fork tests on Robinhood mainnet against the real ETH/USDG hook (impersonate POKER_ADMIN, grant the role, poke,
  check `currentFee`), covering bounds, TTL expiry, a blind desk, and the composition with an event override;
- verification on Sourcify and Blockscout.

### 5.4 The run (`npm run demo:fork`)

1. Fork Robinhood mainnet at a block inside a real volatile window.
2. Deploy `RiskDesk` v2 and `ClimPoker`, and grant FEE_POKER by impersonating POKER_ADMIN.
3. Replay the desk's reports for that window, call `poke`, and send swaps both ways.
4. Record every transaction, `currentFee` and `Swap.fee` into `docs/evidence/fork-run-<date>.json`.

The app replays this file (§5.5), and a screen recording goes into the deck. The live testnet desk runs continuously
alongside.

### 5.5 Showcase app (`app/`, deployed as a new Vercel project, `clim-fables.vercel.app`)

**Fidelity:**
- Before building, a full inventory of fables.fi: every page, component, state, animation and copy pattern, written to
  `docs/research/fables-ui-inventory.md` with screenshots kept local.
- The app reproduces Fables' UI one to one (tokens, Louize and Inter, components, art, motion) and grafts clim where
  it would live in their product: the ETH/USDG pool page with a clim panel, the fee detail, and the market list with
  each pool's fee source.

**Showcase guardrails (never pass as the real Fables):**
- our own domain;
- a permanent "Showcase by clim, not affiliated with Fables" banner;
- "clim × Fables" in the nav;
- no wallet connection and no real transaction: live data is read only, and actions are the recorded fork run.

**Routes:**
- `/`: the thesis in one line and the live number (the keeper's override against clim's recommendation now);
- `/pool/eth-usdg`: their pool page with the clim panel, showing the live overrides against clim's recommendation,
  sigma, the toxic side and the gaps;
- `/integrate`: the three levels with exact code (RPC read, `grantRole`, `ClimPoker`) and the recorded run;
- `/evidence`: the lab, every number with its script.

**Data:**
- Fables mainnet logs and StateView, read live;
- the testnet `RiskDesk`;
- the lab outputs and fork-run evidence, synced at build time as in v1.

**Tests:**
- unit tests on parsers and fee maths, typecheck, lint, build;
- a headless check that every live number matches the chain.

### 5.6 Deck (Figma, file Main of the Clim team, group `clim × Fables`)

- 1920 × 1080 frames, in Fables' look with Louize, co-branded "clim × Fables".
- About 10 slides:
  1. cover;
  2. what we read in your hook (the "oracle-driven poke" comment);
  3. the hot key;
  4. clim in one slide;
  5. shadow, live;
  6. the per-direction signal for the new hooks;
  7. evidence, gaps included;
  8. the integration ladder;
  9. the run;
  10. what is live and the links.
- No ask.
- Exported to PDF.
- Then a Telegram draft to Fables' CTO, shown to the maintainer as plain text and never sent without his explicit go on
  the exact text.

## 6. Repository and clim closure

- `DVB-ANS/clim` is frozen. Tag `token2049-submission` points at `c17da92`, the commit submitted 2026-10-07 23:51 SGT.
  The post-hack run log snapshot is pushed.
- This repository, `gamween/clim-fables`, is public with the full history. `upstream` is `DVB-ANS/clim`. MIT for our
  code.
- The README credits the TOKEN2049 Origins origin and states the showcase and non-affiliation.
- The Sepolia bots keep running until the testnet desk is live, then they stop and the Mac's sleep is restored.
- The message to the Chainlink mentor stays a draft that the maintainer sends himself.
- The vault gets a project note next to the TOKEN2049 Origins overview.

## 7. Order of work

1. Lab: the three studies, which set the parameters.
2. Contracts and fork tests, then the run.
3. CRE workflow v2 on Robinhood testnet, and the desk going live.
4. Fables UI inventory, then the showcase app.
5. Deck, then the Telegram draft.

## 8. Open points

- Louize is a commercial font. The maintainer chose to use it; licensing is his call.
- Fables' docs block AI agents in robots.txt, so the maintainer reads the fees and security pages himself before the
  deck.
- CRE deploy access to a DON (requested 2026-10-06) is still pending, so the desk runs in the CRE simulator, as in v1,
  until then.
