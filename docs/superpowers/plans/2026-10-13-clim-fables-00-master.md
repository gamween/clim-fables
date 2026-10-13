# clim × Fables: master plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn clim into a showcase Fables' CTO can integrate: a verifiable volatility desk feeding Fables' dynamic fee on Robinhood Chain, with live reference pools, a recorded fork run against Fables' real hook, a one-to-one Fables-style app and a Figma deck.

**Architecture:** The lab calibrates the fee policy on Fables' own ETH/USDG data. Contracts split data (`RiskDeskV2`), policy (`ClimFeePolicy`, immutable parameters from the lab) and action (`ClimPoker`, which calls Fables' `pokeFee`), plus an independent `PokeFeeHook` (written from Fables' published ABI) for our testnet pools. The CRE workflow writes to Robinhood Chain testnet; the app reads Fables mainnet (read only), the testnet desk and pools, and the recorded fork run.

**Tech Stack:** Python 3.12 + numpy (lab, uv), Foundry + Solidity 0.8.26 + Uniswap v4 + OpenZeppelin 5.5 (contracts), Chainlink CRE TypeScript SDK (desk), Bun (bots), Next.js (app), Figma (deck).

Spec: `docs/superpowers/specs/2026-10-13-clim-fables-design.md`.

---

## Plans and gates

| Plan | File | Written | Gate to pass before the next plan |
|---|---|---|---|
| 00 | this file | now | Task 1 below done |
| 01 Lab | `2026-10-13-clim-fables-01-lab.md` | now | `shared/params-fables.json` exists, lab tests green, the three studies published in `lab/out/` |
| 02 Contracts | `2026-10-13-clim-fables-02-contracts.md` | now | Unit and fork tests green; `docs/evidence/fork-run-*.json` recorded against Fables' real ETH/USDG hook |
| 03 Desk and live pools | `2026-10-13-clim-fables-03-live.md` | at gate 02, with the deployed ABIs and `params-fables.json` | CRE desk reporting on Robinhood testnet; pools D, K, F live with bots; contracts verified on Sourcify and Blockscout; Sepolia bots stopped |
| 04 Showcase app | `2026-10-13-clim-fables-04-app.md` | at gate 03, after the Fables UI inventory (its Task 1) | App deployed to `clim-fables.vercel.app`, every live number checked against the chain, CI green, README "Verify in 10 minutes" |
| 05 Deck and message | `2026-10-13-clim-fables-05-deck.md` | at gate 04 | Figma frames in the Clim team's Main file, PDF exported, Telegram draft shown to the maintainer (never sent without his explicit go) |

Plans 03 to 05 are written when their gate opens because they consume artifacts that do not exist yet (lab parameters, deployed addresses, the UI inventory). Each is written with the same skill and saved next to this file.

Baselines measured on 2026-10-13 in this repository: `forge test` 73 passed, 2 skipped; `lab` pytest 99 passed, 1 skipped.

## Working rules (all plans)

- Code, comments, commits, PRs and docs in English. Conventional commits. Every commit message ends with the session attribution line given in the conversation.
- The maintainer's repository: commit and push to `main` freely, no PR needed (it is a solo repository).
- No Fables source code is ever copied. Interfaces are written from the published ABI (function and event signatures) only.
- Nothing is written to Robinhood Chain mainnet. Mainnet is read through RPC and Etherscan V2; actions happen on an anvil fork or on testnet.
- Testnet keys only, kept in `.env` files that are gitignored. `.local/` is gitignored and holds raw research data.
- Every number that reaches the app, the README or the deck comes from a script output in `lab/out/`, `docs/evidence/` or a live chain read.
- Log decisions and surprises in `docs/sessions/<today>.md`.

---

### Task 1: Repository identity

**Files:**
- Modify: `CLAUDE.md` (whole file)
- Modify: `README.md:1-20` (header only; the full README is rewritten in plan 04)

- [ ] **Step 1: Replace `CLAUDE.md`**

```markdown
# clim × Fables

A verifiable volatility desk for Fables' dynamic fees on Robinhood Chain. clim's Chainlink CRE "risk desk" measures ETH volatility and the venue-versus-pool price gap on four exchanges every 30 s; `ClimPoker` turns it into Fables' `pokeFee` calls. This repository continues clim, built at TOKEN2049 Origins (Singapore, 2026-10-06 to 08; submitted state frozen at tag `token2049-submission` in DVB-ANS/clim). It is a showcase, not affiliated with Fables.

## Where things are
- Spec: `docs/superpowers/specs/2026-10-13-clim-fables-design.md` (the hackathon spec `2026-10-06-clim-design.md` is history).
- Plans: `docs/superpowers/plans/2026-10-13-clim-fables-00-master.md` gives the order and the gates; `01` to `05` are per subsystem.
- Session logs: `docs/sessions/YYYY-MM-DD.md`.
- Lab (Python, uv): `lab/`. Fables studies write `lab/out/fables-*.json`; decided parameters go to `shared/params-fables.json`.
- Contracts (Foundry): `contracts/`. v1 (Sepolia) in `src/*.sol`, clim × Fables in `src/v2/`.
- CRE workflow: `cre/`. Bots: `bots/`. App: `app/`.
- Raw research data (not published): `.local/research-2026-10-13/`.

## Working rules
- Start of every session: read `CLAUDE.local.md` if present, the latest `docs/sessions/*.md`, then the master plan.
- Never copy Fables source code (SPDX UNLICENSED). Interfaces come from the published ABI only.
- Never write to Robinhood Chain mainnet. Read it; act on an anvil fork or on testnet (chain 46630).
- Every published number comes from a script output or a live chain read. Results are published as measured, including where Fables' keeper does better.
- Never claim clim sets better fees than Fables' keeper. The pitch is verifiability, redundancy and the per-direction signal.
- The app is a showcase: own domain, permanent non-affiliation banner, no wallet connection, no real transaction.
- Never commit secrets: `.env`, `secrets.yaml` are gitignored; testnet keys only.
- Git: conventional commits in English; push to `main`.
- Any message to Fables (Telegram, email) is a draft shown to the maintainer as plain text and is never sent without his explicit go on the exact text.
```

- [ ] **Step 2: Replace the README header (lines 1 to the end of the first `</div>`) with a pointer block**

Replace everything from the first line through the first `</div>` line with:

```markdown
<div align="center">

# ⛈️ clim × Fables

**A verifiable volatility desk for Fables' dynamic fees on Robinhood Chain. Showcase, not affiliated with Fables.**

Work in progress. The state submitted to TOKEN2049 Origins (Singapore, October 2026) is frozen at
[DVB-ANS/clim @ token2049-submission](https://github.com/DVB-ANS/clim/tree/token2049-submission); the sections below
still describe that version until plan 04 rewrites this README.

</div>
```

- [ ] **Step 3: Check nothing else references the removed header markers**

Run: `grep -n "clim:begin links" README.md docs/submission -r | head`
Expected: matches only inside `docs/submission/` (the v1 submission tooling). If `README.md` still matches, the replacement in Step 2 did not cover the links block: remove the `<!-- clim:begin links -->` to `<!-- clim:end links -->` block from `README.md`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: clim x Fables repository identity (CLAUDE.md, README header)"
git push
```

### Task 2: Execute plan 01 (lab)

- [ ] Execute `docs/superpowers/plans/2026-10-13-clim-fables-01-lab.md` task by task.
- [ ] Gate: `cd lab && uv run pytest -q` green, `lab/out/fables-dt-eff.json`, `lab/out/fables-window.json`, `lab/out/fables-direction.json` and `shared/params-fables.json` committed.

### Task 3: Execute plan 02 (contracts and fork run)

- [ ] Execute `docs/superpowers/plans/2026-10-13-clim-fables-02-contracts.md` task by task.
- [ ] Gate: `cd contracts && forge test` green including the Robinhood fork suite (`RH_MAINNET_RPC_URL` set), `docs/evidence/fork-run-*.json` committed.

### Task 4: Write and execute plan 03 (desk and live pools)

- [ ] Write `docs/superpowers/plans/2026-10-13-clim-fables-03-live.md` with superpowers:writing-plans. Inputs: spec §5.2 and §5.7, `shared/params-fables.json`, the v2 ABIs exported by plan 02, the Robinhood facts in spec §2 (testnet 46630, forwarders, Uniswap v4 addresses, `ArbSys` block number caveat), the v1 CRE workflow in `cre/` and the v1 bots in `bots/`.
- [ ] Execute it. Gate as in the table above. Stopping the Sepolia bots: `pkill -f "cre-loop --pair live"; pkill -f "arb --pair live"; pkill -f "noise --pair live"; pkill -f "status --pair live"`, then `sudo pmset -a disablesleep 0` (ask the maintainer: the Pauline app owns that switch).

### Task 5: Write and execute plan 04 (app)

- [ ] Write `docs/superpowers/plans/2026-10-13-clim-fables-04-app.md`. Its Task 1 is the Fables UI inventory (every page, component, state, motion and copy pattern of fables.fi and its app, read through the browser, screenshots kept in `.local/`, no wallet connected), written to `docs/research/fables-ui-inventory.md`. Inputs: spec §2 (Fables look), §5.5, §5.8, the brand files in `.local/research-2026-10-13/fables-brand/`. Plan 04 also owns, for the CTO checklist (spec §5.8): `docs/security.md` (threat model of `RiskDeskV2`, `ClimFeePolicy`, `ClimPoker` and the CRE path, each failure mode with the fee that results and the test that proves it), the exact level 1 keeper diff (`docs/integrate/keeper-read.ts`), the level 2 AccessManager batch calldata (`grantRole`, `setTargetFunctionRole` for ClimPoker's restricted functions, the CLIM_RUNNER role), measured gas per poke and per report on Robinhood testnet, the GitHub Actions CI (forge, lab, app tests and lint), and the README's "Verify in 10 minutes" path.
- [ ] Execute it. Gate as in the table above.

### Task 6: Write and execute plan 05 (deck and message)

- [ ] Write `docs/superpowers/plans/2026-10-13-clim-fables-05-deck.md`. Inputs: spec §5.6, the app, `lab/out/`, `docs/evidence/`, the Figma rules in memory (Main file of the Clim team, one named group `clim × Fables`, frames 1920 × 1080, tidy layers).
- [ ] Execute it. The Telegram draft to Fables' CTO is shown to the maintainer as plain text and never sent without his explicit go.
