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
