# clim 02 · CRE Risk Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chainlink CRE workflow, `cre/risk-desk`, that every 30 s measures ETH 15-minute realized volatility on four venues with a 3-of-4 quorum, reaches DON consensus field by field (median), and writes the canonical signed report to `RiskDesk.onReport` on Ethereum Sepolia. It is proven by `cre workflow simulate --broadcast` transactions, and by a DON deployment if deploy access is granted.

**Architecture:** One TypeScript workflow with two handlers that share `onTick`: [0] cron `*/30 * * * * *`, [1] HTTP trigger (tested in listen mode; the 30 s loops run the cron handler, `--trigger-index 0`). In node mode it fetches six public endpoints concurrently and runs a pure estimator. In DON mode it aggregates with `ConsensusAggregationByFields(median)`, reads `RiskDesk.state()`, signs with `runtime.report`, writes with `EVMClient.writeReport`, then re-reads `state()` to confirm that the desk applied the report. The pure modules (estimator, parsers, report encoding) are built test-first on fixtures captured from the real endpoints. The wiring is built test-first with the SDK's test runtime and capability mocks.

**Tech Stack:** CRE CLI v1.37.0, `@chainlink/cre-sdk` 1.23.0, viem 2.57.3, zod 3.25.76, TypeScript 5.9.3, bun 1.3.9 (runtime, test runner, `cre-compile` to WASM), Foundry `cast` and `jq` for on-chain checks.

---

## Before you start (read once)

### Where commands run
- Repo root: `~/Development/hackathons/clim`. Every command in this plan starts from the repo root. Commands that need another directory start with `cd`, inside a subshell `( ... )` so the next command starts from the root again.
- The CRE project root is `cre/` (it holds `project.yaml`), and the workflow folder is `cre/risk-desk/`. Run `cre workflow ...` from `cre/` and `bun ...` from `cre/risk-desk/`.

### Facts verified while writing this plan (2026-10-06)

| Fact | Value | How it was verified |
|---|---|---|
| CRE CLI | v1.37.0 (released 2026-10-05). `cre workflow build` and `cre templates list` work without login. `cre init` and `cre workflow simulate` refuse to run without `cre login`. | Release binary downloaded and run on this Mac |
| SDK | `@chainlink/cre-sdk` 1.23.0 (latest on npm). Test utilities in `@chainlink/cre-sdk/test`: `test`, `newTestRuntime`, `HttpActionsMock`, `EvmMock`, `REPORT_METADATA_HEADER_LENGTH` (109) | npm, SDK source, and every test below run with bun 1.3.9 |
| Whole workflow of this plan | 36 unit tests pass (plus 3 ABI-sync tests against a sample ABI), `tsc --noEmit` is clean, and `cre workflow build` compiles it to a 2.7 MB WASM | Run in a scratch copy of exactly the code below |
| Sepolia chain selector | `16015286601757825753` (`ethereum-testnet-sepolia`) | SDK chain selectors, docs |
| Simulation forwarder | `MockKeystoneForwarder` `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`, `typeAndVersion()` = "MockKeystoneForwarder 1.0.0" | `cast call` on Sepolia, forwarder directory |
| Production forwarder | `KeystoneForwarder` `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, `typeAndVersion()` = "KeystoneForwarder 1.0.0" | `cast call` on Sepolia, forwarder directory |
| Quotas | cron at most once per 30 s; 15 HTTP calls, 250 KB per response, 10 s connection timeout; 15 EVM reads; HTTP trigger 1 run per 30 s with burst 1, which the simulator also enforces by default (`--limits default`); log line at most 1 KB; private registry 3 workflows per organization | docs.chain.link/cre/service-quotas (2026-09-16), cre-cli `limits.json` |
| `simulate` flags | `--broadcast`, `--non-interactive`, `--trigger-index`, `--target`, `--wasm` (prebuilt binary, skips compilation; a relative path resolves from the workflow folder, not the current directory, so the loop passes an absolute path: Task 9), `--listen` (HTTP and log triggers only, not cron), `--http-payload` (required for the HTTP trigger in non-interactive mode), `--http-trigger-port` (default 2000), `--limits` | cre-cli v1.37.0 docs and source |
| Listen mode | serves `POST http://localhost:2000/trigger` and reads the payload from the body `{"input": ...}`. The docs page shows a POST of the raw JSON to `http://localhost:2000`. | cre-cli source `cmd/workflow/simulate/simulate.go` |
| Mock forwarder | `report()` never reverts when the receiver's `onReport` reverts: it emits `ReportProcessed(receiver, executionId, reportId, false)`. With `--broadcast`, the simulator then still returns `receiverContractExecutionStatus = SUCCESS`. | chainlink-evm `MockKeystoneForwarder.sol`; chainlink `core/capabilities/fakes/evm_chain.go`; on Sepolia, clim's own forged report, tx `0x34ee46a6947d2831fdb3e5a09f831008589efd9cf099f61dca86dc4cdadc53d9` (a `report()` from the throwaway key `0x216F01B67b85E1A4D69de2e802eb56bc9f9653fe` to the live desk, 2026-10-06 16:27 UTC; `bots/src/scripts/forge-report.ts` sends from the `NOISE_<PAIR>` key instead, its demo tx is `0xadc28d17bde52a6b38627ed734783924876454005b6a7c5e7b3fda49f1fa6c02`), has status 1, `ReportProcessed(..., false)` and no `RiskReported` (`cast receipt`) |
| Dry run | `eth_call` of `forwarder.report`, so it always "succeeds" and returns no tx hash | chainlink `fakes/evm_chain.go` (`dryRunWriteReport`) |
| Endpoints | all six answered HTTP 200 from Singapore. Response shapes are in the fixtures of Task 4. | curl |
| Sepolia gas | about 1.06 gwei. Mock-forwarder report transactions use 100k to 285k gas, depending on the receiver. | `cast gas-price`, `cast receipt` |
| Plan 04 (already written) | This plan implements plan 04's contracts with plan 02 (log lines, replay server format) and reads its deployments shape | `docs/superpowers/plans/2026-10-06-clim-04-bots-ops.md`, "Contracts with other plans" 1, 6 and 7 |

### Units (the same as the spec)
- `sigmaE9` = sigma per square-root second × 1e9; annual sigma = per-second sigma × √31,536,000. Reference points: 48 %/yr = 85,475; 10 %/yr = 17,807 (`SIGMA_MIN_E9`); 1000 %/yr = 1,780,730 (`SIGMA_MAX_E9`).
- `dvolE2` = DVOL × 100 (47.55 becomes 4,755).

### Logging rules for this plan
- **Friction log** (`docs/feedback/cre-friction-log.md`): append rows to the existing table in this exact format. If a number below is already taken, use the next free number.
  `| <n> | <Area> | <What we hit> | <Suggestion> | <Status> |`
- **Session log**: append bullets under a `## Build notes` heading at the end of today's log (`docs/sessions/2026-10-06.md` on day 1, `docs/sessions/2026-10-07.md` on day 2). Create the heading once if it is missing, and prefix CRE bullets with `(CRE)`.
- **Living plan:** if reality differs from this plan (a command, an output, an API shape), fix this file in the same commit and add a session-log bullet that says what changed.

### Deviations from the canonical layout (explicit)
This plan only adds files. It adds `cre/.env.example`, `cre/README.md`, `cre/scripts/sim-loop.sh` (the simulation loop, which plan 04's `bun run cre-loop` wraps), `cre/risk-desk/config.production.json`, `cre/risk-desk/fixtures/`, `cre/risk-desk/scripts/` (`capture-fixtures.sh`, `sync-config.ts`, `latency.ts`) and `cre/risk-desk/abi-sync.test.ts`.

The workflow config has one field beyond the canonical list: `httpAuthorizedKeys` (array of EVM addresses). It is `[]` in simulation. It must be non-empty to deploy, because the CLI rejects deploying an HTTP trigger without authorized keys.

### Interfaces this plan publishes (other plans must match them)
- **Report** (abi.encode, no selector): `(uint40 tObs, uint32 sigmaE9, uint32 rv15E9, uint16 dvolE2, int24 refTick, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 zone)`.
  - `tObs` = DON time (unix seconds) at the start of the execution.
  - `sigmaE9 == rv15E9` in this version.
  - `kE4 = 10000`.
  - `zone`: 0 = not validated (always 0 here), 1 = green, 2 = yellow, 3 = red (spec §3.4).
  - `dvolE2 = 0` means DVOL was unavailable.
  - `refTick = floor(ln(p)/ln(1.0001))` when tETH is token0, and `floor(-ln(p)/ln(1.0001))` otherwise (18/18 decimals), where `p` is the median USD price of the last minute used.
  - `dispBp` = the farthest venue from that median, in bp, rounded up.
- **RiskDesk reads:** `state() returns (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags, uint32 seq)`.
  - The workflow skips a write when `tObs < state.tObs + 20`.
  - It confirms a write by `state().tObs == report.tObs`.
- **Replay mode** (matches contract 7 of plan 04, already written):
  - `replayUrl` is the replay server's base URL (`http://127.0.0.1:8787` by default).
  - For each configured venue, the workflow calls `GET <replayUrl>/venue/<venue>/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20`.
  - The server returns one historical Binance ETHUSDT series in Binance kline format, with timestamps shifted to the wall clock. Its USDT prices are used as USD, and there is no DVOL.
  - So replay reports carry `nSources` = number of venue paths (4), `dispBp = 0` and `dvolE2 = 0`, and the replay desk's REPLAY flag (bit 1) discloses that this is one series. The deck must say so.
- **Log lines parsed by plan 04's `bots/src/sim-loop.ts`** (`bun run cre-loop`, its contract 6):
  - after `writeReport`, exactly `Write report transaction succeeded: 0x<64 hex>` (kept in the transcripts; it is printed before the final line, so it is not the run's outcome);
  - the run's final line is one of `REPORT applied ... tx=0x..`, `REPORT sent, desk state unreadable after tx=0x..`, `NOT APPLIED: ... tx=0x..`, `REJECTED by RiskDesk (onReport reverted) tx=0x..`, `DRY RUN: ...`, or a line containing `clim: no report (<reason>)` for every skip.
  - Plan 04 runs this plan's loop script, `cre/scripts/sim-loop.sh <staging-settings|replay-settings> --broadcast`, from `cre/` (cron handler, index 0).
- **`shared/deployments/sepolia.json` keys read by `cre/risk-desk/scripts/sync-config.ts`** (the shape of plan 04's `parseDeployments`):
  - `tokens.tETH.address` and `tokens.tUSD.address`;
  - `riskDesks.live` and `riskDesks.replay`;
  - `riskDesks.don`, a new optional key that this plan adds in Task 13; plan 04's loader must tolerate it.
  - If the names change, edit the `KEYS` constant in that script only.
- **Keys:** the address of `CRE_ETH_PRIVATE_KEY` in `cre/.env` must be the `simOperator` of the live desk. The replay desk has its own operator key in `cre/.env.replay` (plan 01 Task 18 creates it and deploys the replay desk with it as `simOperator`), so the live and replay loops never send from the same key; the loop script selects it with `ENV_FILE=.env.replay` (Task 9), which passes `-e .env.replay` to the CLI. RiskDesk exposes `simOperator()` as a public getter (it is used in Tasks 10 and 12).
- **Simulation loops:** `cre/scripts/sim-loop.sh <staging-settings|replay-settings> [--broadcast]` (Task 9) is the only loop. It builds the WASM once and runs `simulate --wasm` every 30 s. Run it alone for smoke tests (Tasks 9 and 10); for the demo, plan 04's `bun run cre-loop --pair live|replay` runs the same script and records every run (receipt, `ReportProcessed.result`, decoded `RiskReported`, one transcript per run).
  - Never run two loops on the same desk (for example the script by hand and `cre-loop`): they would collide on the 20 s MIN_GAP.
- **DON desk (Task 13):** plan 01's desk deployment must accept the production forwarder address (`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`). The desk is then switched out of simulation mode with `disableSim()`.

## File structure

| Path | Responsibility |
|---|---|
| `cre/project.yaml` | CRE targets (`staging-settings`, `replay-settings`, `production-settings`) and the Sepolia RPC |
| `cre/secrets.example.yaml` | Documents that the workflow needs no secrets |
| `cre/.env.example` | Template for `cre/.env` (`CRE_ETH_PRIVATE_KEY`, `SEPOLIA_RPC_URL`), which is gitignored |
| `cre/README.md` | What the desk computes, the trust model, how to run it, evidence (judges read it) |
| `cre/scripts/sim-loop.sh` | The simulation loop: build the WASM once, `simulate --wasm` every 30 s, log to `cre/logs/`; plan 04's `bun run cre-loop` runs it and records each run |
| `cre/risk-desk/package.json`, `tsconfig.json` | Pinned dependencies; typecheck scope (`main.ts` and its imports) |
| `cre/risk-desk/workflow.yaml` | Workflow name, entry point and config per target |
| `cre/risk-desk/config.{staging,replay,production}.json` | Runtime config (desk address, venues, mode, token order, HTTP trigger keys) |
| `cre/risk-desk/main.ts` | Runner entry point |
| `cre/risk-desk/workflow.ts` | Config schema, handlers, node-mode observation, consensus, report, write, confirmation |
| `cre/risk-desk/venues.ts` | Venue requests, response parsers, concurrent node-mode fetch (live and replay) |
| `cre/risk-desk/estimator.ts` | Pure estimator: USD normalization, staleness, quorum, per-minute median, RV15, dispersion, tick |
| `cre/risk-desk/report.ts` | Report ABI, encoder and decoder, RiskDesk `state()` ABI, constants (MIN_GAP, kE4, zones) |
| `cre/risk-desk/*.test.ts` | bun tests: estimator, venues (fixtures), report (golden value from Foundry), workflow (SDK mocks), ABI sync |
| `cre/risk-desk/fixtures/` | Real responses of the six sources at `now.txt` = 1791282309 (2026-10-06 10:25:09 UTC) |
| `cre/risk-desk/scripts/capture-fixtures.sh` | Captures one snapshot of the six sources (endpoint health check) |
| `cre/risk-desk/scripts/sync-config.ts` | Copies desk addresses and token order from `shared/deployments/sepolia.json` into the configs |
| `cre/risk-desk/scripts/latency.ts` | Measures `block.timestamp - tObs` over the `RiskReported` events of a desk |
| `.gitignore` (modify) | Ignores WASM builds and simulation logs |

---

### Task 1: Toolchain, CRE account and an early deploy-access request

**Delegable:** no. It needs Sofiane's CRE account, his 2FA and a browser. Teammates who will run simulations later need an invitation to the organization (Step 6).
**Depends on:** nothing. Do it first: deploy access is reviewed by people and can take hours.

**Files:**
- Modify: `docs/feedback/cre-friction-log.md`
- Modify: today's session log

Both installers only add their folder (`~/.bun/bin`, `~/.cre/bin`) to `~/.zshrc`. Claude Code's Bash tool does not re-read it during a session, so a later tool call would not find `bun` or `cre`, and `cre workflow build` and `simulate` themselves run `bun` (cre-cli `cmd/common/compile.go`). Each step therefore also links the binary into `/opt/homebrew/bin`, which is on PATH and writable without sudo on this Mac.

- [x] **Step 1: Install bun 1.3.9 (the version this plan was validated with)**

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.9" && ln -sf "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun && ln -sf "$HOME/.bun/bin/bun" /opt/homebrew/bin/bunx && bun --version && which bun
```

Expected: `1.3.9`, then `/opt/homebrew/bin/bun`.

- [x] **Step 2: Install the CRE CLI**

```bash
curl -sSL https://app.chain.link/cre/install.sh | bash && ln -sf "$HOME/.cre/bin/cre" /opt/homebrew/bin/cre && cre version && which cre
```

Expected: `CRE CLI version v1.37.0`, then `/opt/homebrew/bin/cre`. A newer version is fine: write it in the session log in Step 7. If macOS Gatekeeper blocks the binary, run `xattr -c ~/.cre/bin/cre`.

- [x] **Step 3: Create the CRE account (once, in a browser)**

Open https://app.chain.link/cre/discover, click "Create an account", verify the email and set up 2FA. This creates an organization that Sofiane owns.

- [x] **Step 4: Log the CLI in (interactive: run it yourself; in Claude Code, type `! cre login`)**

```bash
cre login
cre whoami
```

Expected: `Login completed successfully`. `cre whoami` then prints the email, the Organization ID and `Deploy Access:` followed by `Not enabled` or `Enabled`.

- [x] **Step 5: Request deploy access now (interactive, in a regular terminal)**

Run it in a regular terminal window (Terminal or iTerm), not with Claude Code's `!` prefix: the confirmation prompt needs a TTY, and without one the CLI fails with `huh: could not open a new TTY` (friction row 17). Run it after `cre login`: before it, the CLI reports a misleading "account may not be fully set up" error (friction row 16).

```bash
cre account access
```

Answer `Yes`, then paste this use case:

```text
clim: a CRE risk desk for Uniswap v4 LPs. A cron workflow (every 30 s) fetches 1-minute ETH candles from Coinbase, Kraken, Binance and Hyperliquid plus Deribit DVOL, computes 15-minute realized volatility with a 3-of-4 venue quorum, reaches consensus by field medians and writes a signed report to a RiskDesk consumer on Ethereum Sepolia; a Uniswap v4 hook sets the LP fee from it on every swap. Built at TOKEN2049 Origins for the Chainlink CRE track; submission 2026-10-07 23:59 SGT.
```

Expected: `✓ Access request submitted successfully!`

- [ ] **Step 6: Only when delegating simulation work: invite teammates** **Cut (2026-10-07):** solo project (`docs/submission/team.json` lists one member); no simulation work was delegated, so nobody was invited to the CRE organization.

Invite them from the organization page of the CRE UI (https://app.chain.link/cre/discover; the flow is described in https://docs.chain.link/cre/account/creating-account, "Join an existing organization"). Each teammate then runs Steps 1, 2 and 4. Without an account, they can still run `bun test` and `cre workflow build`.

- [x] **Step 7: Log the toolchain and the planning-time CRE findings**

Append under `## Build notes` in today's session log. If your values differ, write the values you observed:

```markdown
- (CRE) Toolchain: bun 1.3.9, CRE CLI v1.37.0, @chainlink/cre-sdk 1.23.0, both linked into `/opt/homebrew/bin` (the installers only edit `~/.zshrc`). Deploy access requested with `cre account access`; status: Not enabled.
```

In `docs/feedback/cre-friction-log.md`, replace the whole row that starts with `| 2 |` with:

```markdown
| 2 | Docs | One docs page says the mock forwarder does not call the consumer's `onReport`, while the mock's source does call it. | Align the docs with the code. | source confirms the mock calls `onReport` (chainlink-evm `contracts/cre/src/dev/MockKeystoneForwarder.sol`, `route`); docs page to re-find |
```

Replace the whole row that starts with `| 3 |` with:

```markdown
| 3 | Periodic workflows in simulation | A cron trigger fires once per `simulate` run, so demoing a 30 s cadence needs a shell loop. | A `--watch` / `--loop` mode for cron workflows. | partly addressed in cre v1.37.0: `cre workflow build` + `simulate --wasm` skips recompiling; `--listen` keeps one process alive for HTTP and log triggers, not cron. We loop with `cre/scripts/sim-loop.sh`. |
```

Replace the whole row that starts with `| 5 |` with:

```markdown
| 5 | Quotas and latency | Cron minimum interval 30 s, 15 HTTP calls per execution, 250 KB per response, 10 s connection timeout, one HTTP-trigger run per 30 s. End-to-end latency (trigger → consensus → on-chain inclusion) is not documented. | Publish typical end-to-end latency per network. | quotas confirmed (service-quotas page, 2026-09-16); we measure latency with `cre/risk-desk/scripts/latency.ts` |
```

Append these rows at the end of the table:

```markdown
| 9 | Simulation write status | With `--broadcast`, `WriteReportReply.receiverContractExecutionStatus` is SUCCESS whenever the forwarder tx is mined, but `MockKeystoneForwarder.report` never reverts when the consumer's `onReport` reverts (it emits `ReportProcessed(..., false)`). A rejected report looks like a success to the workflow. Example on Sepolia: our forged report, tx `0x34ee46a6947d2831fdb3e5a09f831008589efd9cf099f61dca86dc4cdadc53d9`, status 1, `ReportProcessed` false, no `RiskReported`. Workaround in clim: re-read `RiskDesk.state()` after each write. | Decode `ReportProcessed` in the simulator's EVM chain and return REVERTED; say it in the onchain-write guide. | `confirmed` on Sepolia 2026-10-06 with our forged report (also on a Sepolia fork in `contracts/test/fork/MockForwarder.fork.t.sol`) |
| 10 | Dry run | The dry run `eth_call`s the mock forwarder, which swallows consumer reverts, so a dry run cannot tell whether the consumer would accept the report. | Dry-run the consumer call itself, or decode the forwarder's return value. | seen in source (`dryRunWriteReport`) |
| 11 | Listen mode docs | The docs say to POST the raw JSON to `http://localhost:2000`. cre-cli v1.37.0 serves `POST /trigger` and reads the payload from `{"input": ...}`. Non-interactive listen also requires `--http-payload` for the first run. | Align "Testing HTTP Triggers in Simulation" with the code. | seen in source, to confirm (Task 9) |
| 12 | Simulation limits | By default the simulator enforces the production HTTP-trigger rate (one run per 30 s, burst 1), so a 30 s POST loop can hit "Trigger rate limited". | Mention it next to `--listen`; `--limits none` lifts it. | seen in source, to confirm (Task 9) |
| 13 | CLI auth | `cre init` and `cre workflow simulate` require `cre login` even for local scaffolding and local runs, while `cre templates list` and `cre workflow build` do not. Teammates without an account cannot run the simulator. | Allow offline dry-run simulation, or say in the install guide that an account is needed before the first simulation. | observed (cre v1.37.0) |
| 14 | SDK exports | `TxStatus` is exported from `@chainlink/cre-sdk`, but the EVM `ReceiverContractExecutionStatus` enum is only reachable through `@chainlink/cre-sdk/pb` (`EVM_PB`). | Export it next to `TxStatus`. | observed (SDK 1.23.0) |
| 15 | Docs | The macOS/Linux install page shows empty version strings ("The recommended version at the time of writing is ****.", expected output "CRE CLI version "). | Fix the version variable on the page. | observed 2026-10-06 |
```

Row 9 first cited tx `0x276dacda91143cb6b8ace8c4d11c8ed8df837620afc01e9fea81c1338a8aa13d`, which is another team's report (sender `0xb0D05849267b6a4bcC388DDA679047006de8c309`, consumer `0x059eef3dd2c40aac9ab63f9d2a4e8322d75035f0`), mined before clim was deployed; the row above and the friction log now cite clim's own forged report. The friction log's rows carry their final status and wording (audit r1, 2026-10-07).

- [x] **Step 8: Commit**

```bash
git add docs/feedback/cre-friction-log.md docs/sessions/
git commit -m "docs(cre): log CRE toolchain, deploy-access request and planning-time findings"
```

---

### Task 2: Scaffold the CRE project

**Delegable:** yes
**Depends on:** Task 1 Steps 1 and 2 (bun and cre installed; no login needed)

`cre init` is not used: it needs a login, and it would generate a hello-world project that we would overwrite. The files below follow the layout that `cre init -t hello-world-ts` produces, adapted to three targets and pinned dependencies.

**Files:**
- Create: `cre/project.yaml`, `cre/secrets.example.yaml`, `cre/.env.example`
- Create: `cre/risk-desk/package.json`, `cre/risk-desk/tsconfig.json`, `cre/risk-desk/workflow.yaml`
- Create: `cre/risk-desk/config.staging.json`, `cre/risk-desk/config.replay.json`, `cre/risk-desk/config.production.json`
- Modify: `.gitignore`

- [x] **Step 1: Create `cre/project.yaml`**

```yaml
# clim CRE project settings (cre CLI >= 1.37).
# Targets: staging-settings = live simulation, replay-settings = replay simulation,
# production-settings = a DON target (private registry) that was never used: DON deploy access was not granted,
# so its config.production.json keeps the placeholder desk 0x...dEaD (riskDesks.don is null in shared/deployments).
# Every target must also exist in risk-desk/workflow.yaml.
staging-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: https://ethereum-sepolia-rpc.publicnode.com
replay-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: https://ethereum-sepolia-rpc.publicnode.com
production-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: https://ethereum-sepolia-rpc.publicnode.com
```

- [x] **Step 2: Create `cre/secrets.example.yaml` and `cre/.env.example`**

`cre/secrets.example.yaml`:

```yaml
# The clim risk desk reads only public endpoints, so it declares no secrets.
# If a source ever needs a key: copy this file to secrets.yaml (gitignored), map the secret name to an
# environment variable defined in cre/.env, and set workflow-artifacts.secrets-path: "../secrets.yaml"
# in risk-desk/workflow.yaml.
secretsNames: {}
```

`cre/.env.example`:

```bash
# Copy to cre/.env (gitignored). Testnet keys only.
# Sends the report transactions of `cre workflow simulate --broadcast` through the Sepolia MockKeystoneForwarder.
# Its address must be RiskDesk's simOperator (plan 01), otherwise RiskDesk rejects every simulated report.
CRE_ETH_PRIVATE_KEY=
# Optional RPC for risk-desk/scripts/latency.ts (unset: the public RPC). Bun loads .env from the working
# directory only: run it from cre/ (bun risk-desk/scripts/latency.ts <desk> [blocks]), or from cre/risk-desk
# with --env-file=../.env. The CLI itself uses project.yaml.
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

- [x] **Step 3: Create `cre/risk-desk/package.json`, `cre/risk-desk/tsconfig.json` and `cre/risk-desk/workflow.yaml`**

`cre/risk-desk/package.json`:

```json
{
  "name": "clim-risk-desk",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "license": "MIT",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@chainlink/cre-sdk": "1.23.0",
    "viem": "2.57.3",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "typescript": "5.9.3"
  }
}
```

`cre/risk-desk/tsconfig.json`. `include` lists only `main.ts`: the CRE compiler typechecks the workflow and everything it imports, and the tests stay outside that scope.

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": []
  },
  "include": ["main.ts"]
}
```

`cre/risk-desk/workflow.yaml`:

```yaml
# clim risk-desk workflow settings, one block per target of ../project.yaml.
staging-settings:
  user-workflow:
    workflow-name: "clim-risk-desk-staging"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.staging.json"
    secrets-path: ""
replay-settings:
  user-workflow:
    workflow-name: "clim-risk-desk-replay"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.replay.json"
    secrets-path: ""
production-settings:
  user-workflow:
    workflow-name: "clim-risk-desk"
    deployment-registry: "private"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.production.json"
    secrets-path: ""
```

- [x] **Step 4: Create the three workflow configs**

`deskAddress` is a placeholder burn address (no code) until plan 01 deploys a desk. Task 10 overwrites it with `scripts/sync-config.ts`.

`cre/risk-desk/config.staging.json`:

```json
{
  "schedule": "*/30 * * * * *",
  "deskAddress": "0x000000000000000000000000000000000000dEaD",
  "chainSelectorName": "ethereum-testnet-sepolia",
  "gasLimit": "500000",
  "venues": [
    "coinbase",
    "kraken",
    "binance",
    "hyperliquid"
  ],
  "dvolUrl": "https://www.deribit.com/api/v2/public/get_volatility_index_data",
  "usdtUsdUrl": "https://api.kraken.com/0/public/Ticker?pair=USDTUSD",
  "mode": "live",
  "replayUrl": "",
  "token0IsEth": true,
  "httpAuthorizedKeys": []
}
```

`cre/risk-desk/config.replay.json`:

```json
{
  "schedule": "*/30 * * * * *",
  "deskAddress": "0x000000000000000000000000000000000000dEaD",
  "chainSelectorName": "ethereum-testnet-sepolia",
  "gasLimit": "500000",
  "venues": [
    "coinbase",
    "kraken",
    "binance",
    "hyperliquid"
  ],
  "dvolUrl": "https://www.deribit.com/api/v2/public/get_volatility_index_data",
  "usdtUsdUrl": "https://api.kraken.com/0/public/Ticker?pair=USDTUSD",
  "mode": "replay",
  "replayUrl": "http://127.0.0.1:8787",
  "token0IsEth": true,
  "httpAuthorizedKeys": []
}
```

`cre/risk-desk/config.production.json`:

```json
{
  "schedule": "*/30 * * * * *",
  "deskAddress": "0x000000000000000000000000000000000000dEaD",
  "chainSelectorName": "ethereum-testnet-sepolia",
  "gasLimit": "500000",
  "venues": [
    "coinbase",
    "kraken",
    "binance",
    "hyperliquid"
  ],
  "dvolUrl": "https://www.deribit.com/api/v2/public/get_volatility_index_data",
  "usdtUsdUrl": "https://api.kraken.com/0/public/Ticker?pair=USDTUSD",
  "mode": "live",
  "replayUrl": "",
  "token0IsEth": true,
  "httpAuthorizedKeys": []
}
```

- [x] **Step 5: Ignore WASM builds and simulation logs**

In `.gitignore`, replace the line `cre/**/.cre_build_tmp.js` with these four lines:

```gitignore
cre/**/.cre_build_tmp.*
cre/**/binary.wasm
cre/**/*.wasm.br.b64
cre/logs/
```

- [x] **Step 6: Install the dependencies**

```bash
(cd cre/risk-desk && bun install)
```

Expected (last lines; bun may append `(vX available)` to a line, and the timing varies):

```text
+ typescript@5.9.3
+ @chainlink/cre-sdk@1.23.0
+ viem@2.57.3
+ zod@3.25.76

39 packages installed [<time>]
```

- [x] **Step 7: Commit**

```bash
git add .gitignore cre/project.yaml cre/secrets.example.yaml cre/.env.example cre/risk-desk/package.json cre/risk-desk/bun.lock cre/risk-desk/tsconfig.json cre/risk-desk/workflow.yaml cre/risk-desk/config.staging.json cre/risk-desk/config.replay.json cre/risk-desk/config.production.json
git commit -m "chore(cre): scaffold the risk-desk CRE project (targets, configs, pinned deps)"
```

---

### Task 3: Estimator (pure, test-first)

**Delegable:** yes
**Depends on:** Task 2

The estimator is the scientific core: the numbers it produces go on chain and into the deck. It has no I/O and no clock, so every rule is tested with exact values.

**Files:**
- Create: `cre/risk-desk/estimator.ts`
- Test: `cre/risk-desk/estimator.test.ts`

- [x] **Step 1: Write the failing test** at `cre/risk-desk/estimator.test.ts`

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
	isFresh,
	median,
	perMinuteMedians,
	priceToTick,
	QuorumError,
	realizedVolPerSqrtSec,
	toUsd,
	type VenueSeries,
} from './estimator'

// Synthetic market: 20 one-minute candles, every log return exactly +0.001.
const T0 = 1_799_998_800 // multiple of 60
const NOW = T0 + 20 * 60 + 10 // 10 s after the 20th candle closed
const p = (i: number): number => 2000 * Math.exp(0.001 * i)
const candles = (f: (i: number) => number, n = 20): Candle[] =>
	Array.from({ length: n }, (_, i) => ({ t: T0 + 60 * i, close: f(i) }))

const venueA: VenueSeries = { venue: 'a', quote: 'USD', candles: candles(p) }
const venueB: VenueSeries = { venue: 'b', quote: 'USD', candles: candles((i) => p(i) * 1.0002) }
const venueC: VenueSeries = { venue: 'c', quote: 'USDT', candles: candles((i) => 2 * p(i) * 0.9999) } // usdtUsd 0.5
const venueStale: VenueSeries = { venue: 'd', quote: 'USD', candles: candles(p, 17) } // last close 190 s ago

describe('median', () => {
	test('odd, even, empty', () => {
		expect(median([3, 1, 2])).toBe(2)
		expect(median([4, 1, 3, 2])).toBe(2.5)
		expect(() => median([])).toThrow('median of an empty list')
	})
})

describe('closedCandles', () => {
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
})

describe('toUsd', () => {
	test('USD passes through, USDT is multiplied, USDT without rate is dropped', () => {
		expect(toUsd(venueA, null)).toBe(venueA)
		expect(toUsd({ venue: 'x', quote: 'USDT', candles: [{ t: 0, close: 10 }] }, 0.5)?.candles).toEqual([{ t: 0, close: 5 }])
		expect(toUsd(venueC, null)).toBeNull()
	})
})

describe('isFresh', () => {
	test(`last close at most ${DESK.MAX_AGE_SEC} s old`, () => {
		expect(isFresh([{ t: 820, close: 1 }], 1000)).toBe(true) // closed at 880, age 120
		expect(isFresh([{ t: 819, close: 1 }], 1000)).toBe(false) // age 121
		expect(isFresh([], 1000)).toBe(false)
	})
})

describe('commonEnd', () => {
	test('latest minute closed by at least `quorum` venues', () => {
		const late: VenueSeries = { venue: 'b', quote: 'USD', candles: candles(p, 19) }
		expect(commonEnd([venueA, late, venueC], 3)).toBe(T0 + 60 * 18)
		expect(commonEnd([venueA, late, venueC], 2)).toBe(T0 + 60 * 19)
		expect(commonEnd([venueA], 3)).toBeNull()
	})
})

describe('perMinuteMedians', () => {
	test('one median per minute over the window, oldest first', () => {
		const out = perMinuteMedians([venueA, venueB], T0 + 60 * 19, 2)
		expect(out).toHaveLength(3)
		expect(out[2]).toBeCloseTo(p(19) * 1.0001, 9)
	})
	test('throws when a minute has no venue', () => {
		expect(() => perMinuteMedians([venueA], T0 + 60 * 25, 15)).toThrow(QuorumError)
	})
})

describe('realizedVolPerSqrtSec', () => {
	test('15 returns of exactly 0.001 give sqrt(15e-6/900)', () => {
		const prices = Array.from({ length: 16 }, (_, i) => p(i))
		expect(realizedVolPerSqrtSec(prices)).toBeCloseTo(1.2909944487358055e-4, 15)
	})
	test('48%/yr is sigmaE9 85,475 (unit check from the spec)', () => {
		expect(annualPctFromE9(85_475)).toBeCloseTo(48.0, 2)
	})
})

describe('dispersionBp', () => {
	test('farthest venue from the median, rounded up', () => {
		expect(dispersionBp([100, 100.02, 99.97], 100)).toBe(3)
		expect(dispersionBp([100, 100, 100], 100)).toBe(0)
	})
})

describe('priceToTick', () => {
	test('token order decides the sign', () => {
		expect(priceToTick(4500, true)).toBe(84122)
		expect(priceToTick(4500, false)).toBe(-84123)
		expect(priceToTick(1, true)).toBe(0)
	})
})

describe('estimate', () => {
	test('3 fresh venues out of 4: RV15 of the per-minute median, dispersion, tick', () => {
		const est = estimate({ nowSec: NOW, usdtUsd: 0.5, token0IsEth: true, series: [venueA, venueB, venueC, venueStale] })
		expect(est.sources).toEqual(['a', 'b', 'c'])
		expect(est.nSources).toBe(3)
		expect(est.tEnd).toBe(T0 + 60 * 19)
		expect(est.sigmaE9).toBe(129_099)
		expect(est.rv15E9).toBe(129_099)
		expect(est.dispBp).toBe(2)
		expect(est.priceE6).toBe(2_038_363_297)
		expect(est.refTick).toBe(76202)
	})
	test('USDT venue without a USDT/USD rate is dropped and quorum fails', () => {
		expect(() =>
			estimate({ nowSec: NOW, usdtUsd: null, token0IsEth: true, series: [venueA, venueB, venueC, venueStale] }),
		).toThrow('quorum 2/4 < 3')
	})
})
```

- [x] **Step 2: Run it, expected FAIL**

```bash
(cd cre/risk-desk && bun test estimator.test.ts)
```

Expected: `error: Cannot find module './estimator' from '.../cre/risk-desk/estimator.test.ts'`, then `0 pass`, `1 fail`, `1 error`.

- [x] **Step 3: Minimal implementation** at `cre/risk-desk/estimator.ts`

```ts
// Pure risk-desk estimator: no SDK imports, no I/O, no clock. Every input is passed in.
// Units: times in unix seconds, prices in quote currency per ETH, sigma per sqrt(second).

export const DESK = {
	QUORUM: 3, // fewer fresh venues than this: no report
	MAX_AGE_SEC: 120, // a venue whose last closed 1m candle closed longer ago than this is dropped
	CLOSE_GRACE_SEC: 0, // a candle counts as closed once its minute has ended (the lab's convention: replay reports match it exactly)
	CANDLE_SEC: 60,
	WINDOW_MIN: 15, // RV15: 15 one-minute log returns (16 closes)
} as const

export const SECONDS_PER_YEAR = 31_536_000
export const MAX_TICK = 887_272
const LN_TICK_BASE = Math.log(1.0001)

export type Quote = 'USD' | 'USDT'

export interface Candle {
	t: number // candle open time, unix seconds
	close: number // close price in the venue's quote currency
}

export interface VenueSeries {
	venue: string
	quote: Quote
	candles: Candle[]
}

export interface EstimatorInput {
	nowSec: number
	usdtUsd: number | null // null: USDT-quoted venues cannot be normalized and are dropped
	token0IsEth: boolean
	series: VenueSeries[]
}

export interface Estimate {
	sigmaE9: number // sigma used by the hook, per sqrt(second) * 1e9 (this version: sigma = RV15)
	rv15E9: number // raw RV15, per sqrt(second) * 1e9
	refTick: number // Uniswap tick of the median USD price at tEnd, for the pool's token order
	dispBp: number // farthest venue from the median at tEnd, in bp, rounded up
	nSources: number // fresh, USD-normalized venues
	priceE6: number // median USD price at tEnd * 1e6 (logs only)
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
	return candles
		.filter((c) => c.t + DESK.CANDLE_SEC + DESK.CLOSE_GRACE_SEC <= nowSec)
		.sort((a, b) => a.t - b.t)
}

export function toUsd(series: VenueSeries, usdtUsd: number | null): VenueSeries | null {
	if (series.quote === 'USD') return series
	if (usdtUsd === null || !(usdtUsd > 0)) return null
	return {
		venue: series.venue,
		quote: 'USD',
		candles: series.candles.map((c) => ({ t: c.t, close: c.close * usdtUsd })),
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

export function dispersionBp(closes: number[], mid: number): number {
	let worst = 0
	for (const p of closes) worst = Math.max(worst, Math.abs(p / mid - 1))
	return Math.max(0, Math.ceil(worst * 1e4 - 1e-9))
}

export function priceToTick(priceUsdPerEth: number, token0IsEth: boolean): number {
	const lnP = Math.log(priceUsdPerEth)
	const tick = Math.floor((token0IsEth ? lnP : -lnP) / LN_TICK_BASE)
	return Math.max(-MAX_TICK, Math.min(MAX_TICK, tick))
}

export function annualPctFromE9(sigmaE9: number): number {
	return (sigmaE9 / 1e9) * Math.sqrt(SECONDS_PER_YEAR) * 100
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

	const prices = perMinuteMedians(fresh, tEnd, DESK.WINDOW_MIN)
	const rv = realizedVolPerSqrtSec(prices)
	const endCloses: number[] = []
	for (const s of fresh) {
		const c = s.candles.find((x) => x.t === tEnd)
		if (c !== undefined) endCloses.push(c.close)
	}
	const mid = median(endCloses)
	const rvE9 = Math.round(rv * 1e9)
	return {
		sigmaE9: rvE9,
		rv15E9: rvE9,
		refTick: priceToTick(mid, input.token0IsEth),
		dispBp: dispersionBp(endCloses, mid),
		nSources: fresh.length,
		priceE6: Math.round(mid * 1e6),
		tEnd,
		sources: fresh.map((s) => s.venue),
	}
}
```

- [x] **Step 4: Run it, expected PASS**

```bash
(cd cre/risk-desk && bun test estimator.test.ts)
```

Expected: `13 pass`, `0 fail`, `32 expect() calls`.

- [x] **Step 5: Commit**

```bash
git add cre/risk-desk/estimator.ts cre/risk-desk/estimator.test.ts
git commit -m "feat(cre): pure RV15 estimator with venue quorum, staleness, dispersion and tick"
```

---

### Task 4: Real-endpoint fixtures

**Delegable:** yes
**Depends on:** Task 2

The fixtures below were captured from the six live endpoints at `1791282309` (2026-10-06 10:25:09 UTC). The expected numbers of Tasks 5, 6 and 7 come from them, and an independent Python implementation reproduced the same estimate (sigmaE9 59,492, dispersion 2 bp, median 2,713.815, tick 79,065). Commit them verbatim and never overwrite them with a new capture: capture elsewhere to explore.

**Files:**
- Create: `cre/risk-desk/scripts/capture-fixtures.sh`
- Create: `cre/risk-desk/fixtures/now.txt`, `coinbase.json`, `kraken.json`, `binance.json`, `hyperliquid.json`, `deribit.json`, `kraken_usdt.json`

- [x] **Step 1: Create the capture script** at `cre/risk-desk/scripts/capture-fixtures.sh`

```bash
#!/usr/bin/env bash
# Captures one consistent snapshot of the six risk-desk sources (fails loudly if one is down).
# Usage (from cre/risk-desk): bash scripts/capture-fixtures.sh [outdir]   (default: fixtures)
# The committed fixtures/ are the unit-test inputs: capture into another directory to explore.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-fixtures}"
mkdir -p "$OUT"
NOW=$(date +%s)
NOWMS=$((NOW * 1000))
echo "$NOW" > "$OUT/now.txt"
curl -sf -m 10 "https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD/candles?granularity=ONE_MINUTE&limit=20" -o "$OUT"/coinbase.json
curl -sf -m 10 "https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=$((NOW - 1200))" -o "$OUT"/kraken.json
curl -sf -m 10 "https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20" -o "$OUT"/binance.json
curl -sf -m 10 -X POST "https://api.hyperliquid.xyz/info" -H 'Content-Type: application/json' \
  -d "{\"type\":\"candleSnapshot\",\"req\":{\"coin\":\"ETH\",\"interval\":\"1m\",\"startTime\":$((NOWMS - 1200000)),\"endTime\":$NOWMS}}" -o "$OUT"/hyperliquid.json
curl -sf -m 10 "https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=ETH&start_timestamp=$((NOWMS - 600000))&end_timestamp=$NOWMS&resolution=60" -o "$OUT"/deribit.json
curl -sf -m 10 "https://api.kraken.com/0/public/Ticker?pair=USDTUSD" -o "$OUT"/kraken_usdt.json
echo "captured at $NOW into $OUT"; wc -c "$OUT"/*.json
```

- [x] **Step 2: Run it into a temporary directory (health check of the six endpoints from this machine)**

```bash
(cd cre/risk-desk && chmod +x scripts/capture-fixtures.sh && bash scripts/capture-fixtures.sh "$(mktemp -d)")
```

Expected: `captured at <unix time> into /var/folders/.../tmp.XXXX`, then six JSON files of roughly 300 B to 3.4 KB and a total of about 10.7 KB.

The script exits non-zero on the first failing endpoint. If one fails (for example Binance HTTP 451), note which one in the session log. The workflow still works with 3 venues.

- [x] **Step 3: Write the committed fixtures exactly as below**

```bash
mkdir -p cre/risk-desk/fixtures
```

`cre/risk-desk/fixtures/now.txt`:

```text
1791282309
```

`cre/risk-desk/fixtures/coinbase.json` (Coinbase Advanced public candles: newest first, string fields, the in-progress minute is missing at capture time):

```json
{"candles":[{"start":"1791282240","low":"2713.75","high":"2715.08","open":"2714.33","close":"2713.76","volume":"52.746994"},{"start":"1791282180","low":"2713.98","high":"2714.72","open":"2714.16","close":"2714.4","volume":"14.15313503"},{"start":"1791282120","low":"2714.11","high":"2715","open":"2714.66","close":"2714.16","volume":"45.12995402"},{"start":"1791282060","low":"2712.56","high":"2714.43","open":"2712.56","close":"2713.82","volume":"17.73817404"},{"start":"1791282000","low":"2711.61","high":"2712.57","open":"2712.57","close":"2712.52","volume":"24.35440392"},{"start":"1791281940","low":"2712.32","high":"2712.65","open":"2712.65","close":"2712.56","volume":"1.91553911"},{"start":"1791281880","low":"2711.81","high":"2712.88","open":"2712.68","close":"2712.65","volume":"80.99530192"},{"start":"1791281820","low":"2712.66","high":"2713.33","open":"2712.96","close":"2712.68","volume":"5.5932283"},{"start":"1791281760","low":"2712.28","high":"2713.04","open":"2712.28","close":"2712.94","volume":"18.28686586"},{"start":"1791281700","low":"2711.76","high":"2713.9","open":"2713.9","close":"2712.14","volume":"17.58752417"},{"start":"1791281640","low":"2713.89","high":"2714.27","open":"2714.27","close":"2713.9","volume":"12.39278595"},{"start":"1791281580","low":"2712.95","high":"2714.34","open":"2713.04","close":"2714.34","volume":"2.14580065"},{"start":"1791281520","low":"2712.94","high":"2714.86","open":"2714.2","close":"2713.08","volume":"50.36925611"},{"start":"1791281460","low":"2713.58","high":"2714.9","open":"2713.58","close":"2714.21","volume":"69.9746773"},{"start":"1791281400","low":"2710.27","high":"2713.99","open":"2710.27","close":"2713.61","volume":"108.83341736"},{"start":"1791281340","low":"2709.79","high":"2710.58","open":"2709.79","close":"2710.27","volume":"3.1520688"},{"start":"1791281280","low":"2709.46","high":"2710.5","open":"2709.46","close":"2709.6","volume":"48.97209829"},{"start":"1791281220","low":"2708.4","high":"2709.52","open":"2708.41","close":"2709.26","volume":"11.01965587"},{"start":"1791281160","low":"2708.41","high":"2709.79","open":"2709.12","close":"2708.41","volume":"29.4153615"}]}
```

`cre/risk-desk/fixtures/kraken.json` (Kraken OHLC: `[time, open, high, low, close, vwap, volume, count]`; the last row is the open minute):

```json
{"error":[],"result":{"XETHZUSD":[[1791281160,"2709.12","2709.98","2708.58","2708.58","2709.38","17.83486617",50],[1791281220,"2708.57","2709.42","2708.41","2709.23","2709.31","0.60071907",16],[1791281280,"2709.38","2710.57","2709.38","2709.81","2709.79","4.63490657",26],[1791281340,"2709.97","2710.45","2709.97","2710.26","2710.03","0.74370776",7],[1791281400,"2710.32","2713.91","2710.31","2713.91","2711.86","22.31714670",100],[1791281460,"2713.94","2715.03","2713.94","2714.35","2714.75","9.37491643",36],[1791281520,"2714.29","2714.36","2713.09","2713.21","2713.41","3.29880965",23],[1791281580,"2713.15","2714.42","2713.14","2714.42","2714.01","0.55312328",13],[1791281640,"2714.42","2714.42","2713.70","2713.90","2713.76","10.17506785",17],[1791281700,"2713.89","2713.89","2711.99","2712.04","2713.20","1.58902924",25],[1791281760,"2712.70","2713.04","2712.60","2713.01","2712.89","10.47725461",24],[1791281820,"2713.01","2713.29","2712.64","2712.71","2712.70","4.55864366",18],[1791281880,"2712.81","2712.94","2711.92","2712.48","2712.52","5.80410053",31],[1791281940,"2712.42","2712.42","2712.41","2712.42","2712.41","3.58235668",18],[1791282000,"2712.42","2712.42","2711.61","2712.19","2712.07","6.24782425",23],[1791282060,"2712.66","2714.53","2712.65","2714.53","2713.83","1.99034712",20],[1791282120,"2714.52","2715.10","2714.22","2714.22","2714.57","5.51410480",29],[1791282180,"2714.22","2714.51","2714.17","2714.51","2714.29","6.35791310",33],[1791282240,"2714.39","2715.11","2713.87","2713.87","2714.51","17.88682576",33],[1791282300,"2713.87","2714.83","2713.87","2714.65","2713.95","12.20382771",16]],"last":1791282240}}
```

`cre/risk-desk/fixtures/binance.json` (data-api.binance.vision klines: open time in ms, close at index 4, quoted in USDT):

```json
[[1791281160000,"2709.88000000","2710.59000000","2709.21000000","2709.21000000","55.66140000",1791281219999,"150823.68956100",1733,"27.84040000","75438.24176500","0"],[1791281220000,"2709.22000000","2710.28000000","2709.21000000","2710.28000000","26.23910000",1791281279999,"71099.04004300",710,"14.64010000","39669.01676200","0"],[1791281280000,"2710.27000000","2711.26000000","2710.27000000","2710.55000000","69.14830000",1791281339999,"187429.16272400",1134,"51.56400000","139760.20018200","0"],[1791281340000,"2710.55000000","2711.25000000","2710.54000000","2711.12000000","30.14610000",1791281399999,"81725.99852900",1122,"14.00400000","37962.14526000","0"],[1791281400000,"2711.12000000","2714.90000000","2711.11000000","2714.69000000","293.86670000",1791281459999,"797323.14850100",3679,"255.52030000","693270.05924700","0"],[1791281460000,"2714.69000000","2715.82000000","2714.69000000","2715.10000000","227.10580000",1791281519999,"616641.70724900",2535,"179.37990000","487048.08356900","0"],[1791281520000,"2715.10000000","2715.78000000","2713.91000000","2713.92000000","69.33810000",1791281579999,"188237.11989200",2270,"23.54400000","63921.59951500","0"],[1791281580000,"2713.91000000","2715.00000000","2713.91000000","2715.00000000","73.29170000",1791281639999,"198942.55164100",651,"37.09480000","100694.05727300","0"],[1791281640000,"2714.99000000","2715.00000000","2714.78000000","2714.78000000","30.27210000",1791281699999,"82185.18842600",679,"4.05960000","11021.28545300","0"],[1791281700000,"2714.78000000","2714.78000000","2712.70000000","2712.97000000","54.13100000",1791281759999,"146876.38295200",2132,"22.37040000","60692.62478900","0"],[1791281760000,"2712.96000000","2713.92000000","2712.96000000","2713.81000000","126.19440000",1791281819999,"342431.62142500",1162,"114.23920000","309989.51736400","0"],[1791281820000,"2713.80000000","2713.97000000","2713.62000000","2713.63000000","24.14520000",1791281879999,"65524.53120900",541,"10.67150000","28959.99406600","0"],[1791281880000,"2713.62000000","2713.63000000","2712.43000000","2713.21000000","55.46460000",1791281939999,"150485.94378400",832,"11.79380000","31998.47244400","0"],[1791281940000,"2713.20000000","2713.21000000","2713.20000000","2713.20000000","4.87010000",1791281999999,"13213.56996300",64,"1.46430000","3972.95340300","0"],[1791282000000,"2713.21000000","2713.21000000","2712.49000000","2713.00000000","36.55220000",1791282059999,"99159.56366500",1080,"19.06750000","51726.29862400","0"],[1791282060000,"2712.99000000","2715.26000000","2712.99000000","2715.25000000","130.91300000",1791282119999,"355353.71034000",1258,"111.06780000","301491.10442100","0"],[1791282120000,"2715.25000000","2716.00000000","2715.19000000","2715.19000000","91.41470000",1791282179999,"248227.55306600",1331,"52.72590000","143169.29947100","0"],[1791282180000,"2715.20000000","2715.21000000","2715.05000000","2715.08000000","104.82060000",1791282239999,"284603.89572000",345,"95.35380000","258899.96009700","0"],[1791282240000,"2715.08000000","2715.77000000","2714.57000000","2714.57000000","132.87150000",1791282299999,"360791.09646500",1235,"80.02430000","217284.94232900","0"],[1791282300000,"2714.58000000","2715.33000000","2714.58000000","2715.18000000","46.33670000",1791282359999,"125793.84549700",140,"45.28480000","122937.74765500","0"]]
```

`cre/risk-desk/fixtures/hyperliquid.json` (Hyperliquid `candleSnapshot`: `t` open time in ms, `c` close):

```json
[{"t":1791281100000,"T":1791281159999,"s":"ETH","i":"1m","o":"2708.0","c":"2708.3","h":"2708.3","l":"2708.0","v":"3.6322","n":23},{"t":1791281160000,"T":1791281219999,"s":"ETH","i":"1m","o":"2708.7","c":"2708.3","h":"2709.7","l":"2708.3","v":"6.0361","n":45},{"t":1791281220000,"T":1791281279999,"s":"ETH","i":"1m","o":"2708.2","c":"2709.0","h":"2709.1","l":"2708.1","v":"7.8246","n":23},{"t":1791281280000,"T":1791281339999,"s":"ETH","i":"1m","o":"2709.0","c":"2709.5","h":"2710.1","l":"2709.0","v":"7.227","n":32},{"t":1791281340000,"T":1791281399999,"s":"ETH","i":"1m","o":"2709.5","c":"2710.2","h":"2710.2","l":"2709.5","v":"2.1208","n":17},{"t":1791281400000,"T":1791281459999,"s":"ETH","i":"1m","o":"2710.1","c":"2713.2","h":"2713.2","l":"2710.1","v":"50.1348","n":125},{"t":1791281460000,"T":1791281519999,"s":"ETH","i":"1m","o":"2713.3","c":"2714.0","h":"2714.9","l":"2713.3","v":"142.8557","n":113},{"t":1791281520000,"T":1791281579999,"s":"ETH","i":"1m","o":"2714.0","c":"2712.9","h":"2714.3","l":"2712.9","v":"37.6798","n":78},{"t":1791281580000,"T":1791281639999,"s":"ETH","i":"1m","o":"2712.9","c":"2714.0","h":"2714.0","l":"2712.9","v":"22.2763","n":41},{"t":1791281640000,"T":1791281699999,"s":"ETH","i":"1m","o":"2713.9","c":"2713.7","h":"2714.0","l":"2713.7","v":"87.8586","n":32},{"t":1791281700000,"T":1791281759999,"s":"ETH","i":"1m","o":"2713.7","c":"2712.2","h":"2713.7","l":"2711.6","v":"16.5854","n":62},{"t":1791281760000,"T":1791281819999,"s":"ETH","i":"1m","o":"2712.1","c":"2712.6","h":"2712.9","l":"2712.1","v":"3.6264","n":22},{"t":1791281820000,"T":1791281879999,"s":"ETH","i":"1m","o":"2712.6","c":"2712.5","h":"2713.0","l":"2712.5","v":"9.2071","n":36},{"t":1791281880000,"T":1791281939999,"s":"ETH","i":"1m","o":"2712.5","c":"2711.7","h":"2712.5","l":"2711.6","v":"5.141","n":30},{"t":1791281940000,"T":1791281999999,"s":"ETH","i":"1m","o":"2711.7","c":"2712.1","h":"2712.1","l":"2711.7","v":"11.8577","n":28},{"t":1791282000000,"T":1791282059999,"s":"ETH","i":"1m","o":"2712.0","c":"2711.7","h":"2712.0","l":"2711.3","v":"13.4916","n":41},{"t":1791282060000,"T":1791282119999,"s":"ETH","i":"1m","o":"2711.8","c":"2714.0","h":"2714.0","l":"2711.8","v":"35.5683","n":55},{"t":1791282120000,"T":1791282179999,"s":"ETH","i":"1m","o":"2714.0","c":"2713.9","h":"2714.4","l":"2713.9","v":"93.0641","n":68},{"t":1791282180000,"T":1791282239999,"s":"ETH","i":"1m","o":"2713.9","c":"2713.9","h":"2714.0","l":"2713.9","v":"4.9798","n":29},{"t":1791282240000,"T":1791282299999,"s":"ETH","i":"1m","o":"2713.9","c":"2714.1","h":"2714.6","l":"2713.9","v":"26.2686","n":31},{"t":1791282300000,"T":1791282359999,"s":"ETH","i":"1m","o":"2713.5","c":"2714.4","h":"2714.8","l":"2713.5","v":"50.4982","n":22}]
```

`cre/risk-desk/fixtures/deribit.json` (Deribit `get_volatility_index_data`, resolution 60: `[tsMs, open, high, low, close]`):

```json
{"jsonrpc":"2.0","result":{"data":[[1791281700000,47.52,47.53,47.52,47.53],[1791281760000,47.53,47.54,47.53,47.54],[1791281820000,47.54,47.54,47.54,47.54],[1791281880000,47.54,47.55,47.54,47.55],[1791281940000,47.55,47.55,47.55,47.55],[1791282000000,47.55,47.55,47.55,47.55],[1791282060000,47.55,47.56,47.55,47.55],[1791282120000,47.55,47.55,47.55,47.55],[1791282180000,47.55,47.56,47.55,47.56],[1791282240000,47.56,47.56,47.55,47.55],[1791282300000,47.55,47.55,47.55,47.55]],"continuation":null},"usIn":1791282313698452,"usOut":1791282313699629,"usDiff":1177,"testnet":false}
```

`cre/risk-desk/fixtures/kraken_usdt.json` (Kraken Ticker USDTUSD: `c[0]` is the last trade price):

```json
{"error":[],"result":{"USDTZUSD":{"a":["0.99967000","1923929","1923929.000"],"b":["0.99966000","322231","322231.000"],"c":["0.99967000","584.25689800"],"v":["85221528.19729484","255050800.45003680"],"p":["0.99971343","0.99978489"],"t":[11698,34958],"l":["0.99959000","0.99944000"],"h":["0.99992000","1.00010000"],"o":"0.99987000"}}}
```

- [x] **Step 4: Check that every fixture parses**

```bash
(cd cre/risk-desk && for f in fixtures/*.json; do python3 -m json.tool "$f" > /dev/null && echo "ok $f"; done)
```

Expected: six `ok fixtures/<name>.json` lines.

- [x] **Step 5: Commit**

```bash
git add cre/risk-desk/scripts/capture-fixtures.sh cre/risk-desk/fixtures
git commit -m "test(cre): capture script and real responses of the six risk-desk sources"
```

---

### Task 5: Venue requests and response parsers (pure, test-first on fixtures)

**Delegable:** yes
**Depends on:** Tasks 3 and 4

**Files:**
- Create: `cre/risk-desk/venues.ts` (pure part; Task 7 adds the node-mode fetch)
- Test: `cre/risk-desk/venues.test.ts`

- [x] **Step 1: Write the failing test** at `cre/risk-desk/venues.test.ts`

```ts
import { describe, expect, test } from 'bun:test'
import { estimate } from './estimator'
import binance from './fixtures/binance.json'
import coinbase from './fixtures/coinbase.json'
import deribit from './fixtures/deribit.json'
import hyperliquid from './fixtures/hyperliquid.json'
import kraken from './fixtures/kraken.json'
import krakenUsdt from './fixtures/kraken_usdt.json'
import {
	dvolRequest,
	parseBinance,
	parseCoinbase,
	parseDvol,
	parseHyperliquid,
	parseKraken,
	parseUsdtUsd,
	parseVenue,
	replayVenueRequest,
	VENUE_QUOTE,
	VENUES,
	venueRequest,
} from './venues'

// Real responses captured by scripts/capture-fixtures.sh at this instant (fixtures/now.txt).
const NOW = 1_791_282_309

describe('venueRequest', () => {
	test('URLs and the Hyperliquid POST body', () => {
		expect(venueRequest('coinbase', NOW).url).toBe(
			'https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD/candles?granularity=ONE_MINUTE&limit=20',
		)
		expect(venueRequest('kraken', NOW).url).toBe(
			`https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=${NOW - 1200}`,
		)
		expect(venueRequest('binance', NOW).url).toBe(
			'https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20',
		)
		const hl = venueRequest('hyperliquid', NOW)
		expect(hl.method).toBe('POST')
		expect(JSON.parse(hl.body ?? '')).toEqual({
			type: 'candleSnapshot',
			req: { coin: 'ETH', interval: '1m', startTime: (NOW - 1200) * 1000, endTime: NOW * 1000 },
		})
		expect(dvolRequest('https://www.deribit.com/api/v2/public/get_volatility_index_data', NOW).url).toBe(
			`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=ETH&start_timestamp=${(NOW - 600) * 1000}&end_timestamp=${NOW * 1000}&resolution=60`,
		)
	})
})

describe('parsers on captured fixtures', () => {
	test('coinbase: newest-first strings, sorted ascending', () => {
		const c = parseCoinbase(coinbase)
		expect(c).toHaveLength(19)
		expect(c[0]).toEqual({ t: 1_791_281_160, close: 2708.41 })
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_240, close: 2713.76 })
	})
	test('kraken: rows under XETHZUSD, last row still open', () => {
		const c = parseKraken(kraken)
		expect(c).toHaveLength(20)
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_300, close: 2714.65 })
	})
	test('binance: open time in ms, close in USDT', () => {
		const c = parseBinance(binance)
		expect(c).toHaveLength(20)
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_300, close: 2715.18 })
	})
	test('hyperliquid: t in ms, c as string', () => {
		const c = parseHyperliquid(hyperliquid)
		expect(c).toHaveLength(21)
		expect(c[0]).toEqual({ t: 1_791_281_100, close: 2708.3 })
	})
	test('deribit DVOL and kraken USDT/USD', () => {
		expect(parseDvol(deribit)).toBe(47.55)
		expect(parseUsdtUsd(krakenUsdt)).toBe(0.99967)
	})
	test('malformed responses throw', () => {
		expect(() => parseKraken({ error: ['EQuery:Unknown asset pair'], result: {} })).toThrow('kraken: EQuery:Unknown asset pair')
		expect(() => parseCoinbase({ message: 'rate limited' })).toThrow('coinbase.candles: not an array')
		expect(() => parseDvol({ result: { data: [] } })).toThrow('deribit: empty data')
	})
})

describe('estimate on the captured snapshot', () => {
	test('4 venues, sigma 33.4%/yr, 2 bp dispersion', () => {
		const series = VENUES.map((v) => ({
			venue: v,
			quote: VENUE_QUOTE[v],
			candles: parseVenue(v, { coinbase, kraken, binance, hyperliquid }[v]),
		}))
		const est = estimate({ nowSec: NOW, usdtUsd: parseUsdtUsd(krakenUsdt), token0IsEth: true, series })
		expect(est).toEqual({
			sigmaE9: 59_492,
			rv15E9: 59_492,
			refTick: 79_065,
			dispBp: 2,
			nSources: 4,
			priceE6: 2_713_815_000,
			tEnd: 1_791_282_240,
			sources: ['coinbase', 'kraken', 'binance', 'hyperliquid'],
		})
	})
})

describe('replayVenueRequest', () => {
	test('one Binance-format path per venue on the plan 04 replay server', () => {
		expect(replayVenueRequest('http://127.0.0.1:8787', 'kraken')).toEqual({
			url: 'http://127.0.0.1:8787/venue/kraken/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20',
			method: 'GET',
		})
	})
})
```

- [x] **Step 2: Run it, expected FAIL**

```bash
(cd cre/risk-desk && bun test venues.test.ts)
```

Expected: `error: Cannot find module './venues' from '.../cre/risk-desk/venues.test.ts'`, then `0 pass`, `1 fail`, `1 error`.

- [x] **Step 3: Minimal implementation** at `cre/risk-desk/venues.ts`

```ts
// Venue requests and response parsers (pure), tested on fixtures captured from the real
// endpoints (fixtures/, see scripts/capture-fixtures.sh). The node-mode fetch is added in Task 7.
import type { Candle, Quote, VenueSeries } from './estimator'

export const VENUES = ['coinbase', 'kraken', 'binance', 'hyperliquid'] as const
export type VenueName = (typeof VENUES)[number]

export const VENUE_QUOTE: Record<VenueName, Quote> = {
	coinbase: 'USD',
	kraken: 'USD',
	binance: 'USDT',
	hyperliquid: 'USD', // USDC-margined perp, treated as USD
}

const LOOKBACK_SEC = 1200 // 20 minutes: covers the 16 closes of RV15 plus the staleness margin

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
			return {
				url: `https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=${nowSec - LOOKBACK_SEC}`,
				method: 'GET',
			}
		case 'binance':
			return {
				url: 'https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20',
				method: 'GET',
			}
		case 'hyperliquid':
			return {
				url: 'https://api.hyperliquid.xyz/info',
				method: 'POST',
				body: JSON.stringify({
					type: 'candleSnapshot',
					req: {
						coin: 'ETH',
						interval: '1m',
						startTime: (nowSec - LOOKBACK_SEC) * 1000,
						endTime: nowSec * 1000,
					},
				}),
			}
	}
}

export function dvolRequest(dvolUrl: string, nowSec: number): HttpReq {
	const end = nowSec * 1000
	const start = end - 600_000
	return {
		url: `${dvolUrl}?currency=ETH&start_timestamp=${start}&end_timestamp=${end}&resolution=60`,
		method: 'GET',
	}
}

// ---------- parsing helpers ----------

function num(x: unknown, what: string): number {
	const n = typeof x === 'string' ? Number(x) : x
	if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${what}: not a number: ${String(x)}`)
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

// ---------- venue parsers (all return candles ascending by open time, seconds) ----------

// {"candles":[{"start":"1791282180","close":"2713.98",...}, ...]} newest first
export function parseCoinbase(json: unknown): Candle[] {
	const rows = arr(obj(json, 'coinbase').candles, 'coinbase.candles')
	return ascending(
		rows.map((r) => {
			const o = obj(r, 'coinbase.candle')
			return { t: num(o.start, 'coinbase.start'), close: num(o.close, 'coinbase.close') }
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
			return { t: num(row[0], 'kraken.time'), close: num(row[4], 'kraken.close') }
		}),
	)
}

// [[openTimeMs,"open","high","low","close","volume",closeTimeMs,...], ...]
export function parseBinance(json: unknown): Candle[] {
	return ascending(
		arr(json, 'binance').map((r) => {
			const row = arr(r, 'binance.row')
			return { t: num(row[0], 'binance.openTime') / 1000, close: num(row[4], 'binance.close') }
		}),
	)
}

// [{"t":openMs,"T":closeMs,"s":"ETH","i":"1m","o":"..","c":"..",...}, ...]
export function parseHyperliquid(json: unknown): Candle[] {
	return ascending(
		arr(json, 'hyperliquid').map((r) => {
			const o = obj(r, 'hyperliquid.candle')
			return { t: num(o.t, 'hyperliquid.t') / 1000, close: num(o.c, 'hyperliquid.c') }
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

// {"result":{"data":[[tsMs,open,high,low,close],...]}} -> last close (DVOL in vol points, e.g. 47.55)
export function parseDvol(json: unknown): number {
	const data = arr(obj(obj(json, 'deribit').result, 'deribit.result').data, 'deribit.data')
	if (data.length === 0) throw new Error('deribit: empty data')
	const last = arr(data[data.length - 1], 'deribit.row')
	return num(last[4], 'deribit.close')
}

// {"error":[],"result":{"USDTZUSD":{"c":["0.99966000","5.19"],...}}} -> last trade price
export function parseUsdtUsd(json: unknown): number {
	const result = obj(obj(json, 'kraken-usdt').result, 'kraken-usdt.result')
	const key = Object.keys(result)[0]
	if (key === undefined) throw new Error('kraken-usdt: empty result')
	const c = arr(obj(result[key], 'kraken-usdt.pair').c, 'kraken-usdt.c')
	return num(c[0], 'kraken-usdt.last')
}

// ---------- replay (plan 04 replay server) ----------

// The plan 04 replay server replays one historical Binance ETHUSDT series in Binance kline format,
// timestamps shifted to the wall clock, under one path per venue name (so the per-venue logic and the
// desk's quorum are exercised; the REPLAY flag of the replay desk discloses that it is one series).
export function replayVenueRequest(replayUrl: string, venue: VenueName): HttpReq {
	return { url: `${replayUrl}/venue/${venue}/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20`, method: 'GET' }
}

export interface DeskInput {
	nowSec: number
	usdtUsd: number | null
	dvol: number | null
	series: VenueSeries[]
	notes: string[] // per-source fetch/parse problems, for logs
}
```

- [x] **Step 4: Run it, expected PASS**

```bash
(cd cre/risk-desk && bun test venues.test.ts)
```

Expected: `9 pass`, `0 fail`, `22 expect() calls`.

- [x] **Step 5: Commit**

```bash
git add cre/risk-desk/venues.ts cre/risk-desk/venues.test.ts
git commit -m "feat(cre): venue requests and parsers for Coinbase, Kraken, Binance, Hyperliquid, Deribit DVOL, USDT/USD"
```

---

### Task 6: Report encoding (test-first, with a golden value from Foundry)

**Delegable:** yes
**Depends on:** Task 2

The golden hex is what `cast abi-encode` (Foundry, an encoder independent of viem) produces, so it is also what `abi.decode` in `RiskDesk._processReport` expects.

**Files:**
- Create: `cre/risk-desk/report.ts`
- Test: `cre/risk-desk/report.test.ts`

- [x] **Step 1: Write the failing test** at `cre/risk-desk/report.test.ts`

```ts
import { describe, expect, test } from 'bun:test'
import { buildReport, decodeRiskReport, encodeRiskReport, K_E4_NEUTRAL, type RiskReport, ZONE } from './report'

const REPORT: RiskReport = {
	tObs: 1_791_282_309,
	sigmaE9: 59_492,
	rv15E9: 59_492,
	dvolE2: 4_755,
	refTick: 79_065,
	dispBp: 2,
	nSources: 4,
	kE4: 10_000,
	zone: 0,
}

// Golden value from Foundry (independent encoder), i.e. what RiskDesk's abi.decode expects:
// cast abi-encode "f(uint40,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)" 1791282309 59492 59492 4755 79065 2 4 10000 0
const GOLDEN =
	'0x' +
	'000000000000000000000000000000000000000000000000000000006ac4cc85' +
	'000000000000000000000000000000000000000000000000000000000000e864' +
	'000000000000000000000000000000000000000000000000000000000000e864' +
	'0000000000000000000000000000000000000000000000000000000000001293' +
	'00000000000000000000000000000000000000000000000000000000000134d9' +
	'0000000000000000000000000000000000000000000000000000000000000002' +
	'0000000000000000000000000000000000000000000000000000000000000004' +
	'0000000000000000000000000000000000000000000000000000000000002710' +
	'0000000000000000000000000000000000000000000000000000000000000000'

describe('encodeRiskReport', () => {
	test('matches the Foundry encoding word for word', () => {
		expect(encodeRiskReport(REPORT)).toBe(GOLDEN)
	})
	test('negative tick is sign-extended (two-complement int24 in a 32-byte word)', () => {
		const hex = encodeRiskReport({ ...REPORT, refTick: -79_066 })
		expect(hex.slice(2 + 64 * 4, 2 + 64 * 5)).toBe('fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffecb26')
	})
	test('round trip', () => {
		expect(decodeRiskReport(encodeRiskReport({ ...REPORT, refTick: -79_066 }))).toEqual({ ...REPORT, refTick: -79_066 })
	})
	test('rejects out-of-range or fractional fields', () => {
		expect(() => encodeRiskReport({ ...REPORT, sigmaE9: -1 })).toThrow(RangeError)
		expect(() => encodeRiskReport({ ...REPORT, dispBp: 1.5 })).toThrow('dispBp=1.5 outside [0, 65535]')
		expect(() => encodeRiskReport({ ...REPORT, refTick: 8_388_608 })).toThrow(RangeError)
	})
})

describe('buildReport', () => {
	test('rounds consensus medians and clamps to the field ranges', () => {
		const r = buildReport(
			{ sigmaE9: 59_492.5, rv15E9: 59_492.4, dvolE2: 4_755, refTick: -79_066.4, dispBp: 70_000, nSources: 3.5, priceE6: 2_713_815_000 },
			1_791_282_309.9,
		)
		expect(r).toEqual({
			tObs: 1_791_282_309,
			sigmaE9: 59_493,
			rv15E9: 59_492,
			dvolE2: 4_755,
			refTick: -79_066,
			dispBp: 65_535,
			nSources: 4,
			kE4: K_E4_NEUTRAL,
			zone: ZONE.UNVALIDATED,
		})
	})
})
```

- [x] **Step 2: Run it, expected FAIL**

```bash
(cd cre/risk-desk && bun test report.test.ts)
```

Expected: `error: Cannot find module './report' from '.../cre/risk-desk/report.test.ts'`, then `0 pass`, `1 fail`, `1 error`.

- [x] **Step 3: Minimal implementation** at `cre/risk-desk/report.ts`

```ts
// Canonical CRE report (the contract between this workflow and RiskDesk._processReport) and the
// RiskDesk read ABI. Must match contracts/src/RiskDesk.sol and shared/abis/RiskDesk.json.
import { decodeAbiParameters, encodeAbiParameters, type Hex, parseAbi, parseAbiParameters } from 'viem'

export const REPORT_ABI = parseAbiParameters(
	'uint40 tObs, uint32 sigmaE9, uint32 rv15E9, uint16 dvolE2, int24 refTick, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 zone',
)

export const RISK_DESK_ABI = parseAbi([
	'function state() view returns (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags, uint32 seq)',
])

export const K_E4_NEUTRAL = 10_000 // k = 1: no model-risk multiplier in this version
export const ZONE = { UNVALIDATED: 0, GREEN: 1, YELLOW: 2, RED: 3 } as const
export const MIN_GAP_SEC = 20 // RiskDesk rejects tObs < last tObs + 20 s

export interface RiskReport {
	tObs: number
	sigmaE9: number
	rv15E9: number
	dvolE2: number
	refTick: number
	dispBp: number
	nSources: number
	kE4: number
	zone: number
}

export interface Observation {
	sigmaE9: number
	rv15E9: number
	dvolE2: number
	refTick: number
	dispBp: number
	nSources: number
	priceE6: number
}

const UINT16_MAX = 65_535
const UINT32_MAX = 4_294_967_295
const INT24_MIN = -8_388_608
const INT24_MAX = 8_388_607

const clampInt = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(x)))

// Rounds and clamps the consensus observation into the report's integer ranges.
export function buildReport(obs: Observation, tObs: number, kE4 = K_E4_NEUTRAL, zone: number = ZONE.UNVALIDATED): RiskReport {
	return {
		tObs: Math.floor(tObs),
		sigmaE9: clampInt(obs.sigmaE9, 0, UINT32_MAX),
		rv15E9: clampInt(obs.rv15E9, 0, UINT32_MAX),
		dvolE2: clampInt(obs.dvolE2, 0, UINT16_MAX),
		refTick: clampInt(obs.refTick, INT24_MIN, INT24_MAX),
		dispBp: clampInt(obs.dispBp, 0, UINT16_MAX),
		nSources: clampInt(obs.nSources, 0, 255),
		kE4: clampInt(kE4, 0, UINT16_MAX),
		zone: clampInt(zone, 0, 255),
	}
}

function assertInt(name: string, x: number, lo: number, hi: number): void {
	if (!Number.isInteger(x) || x < lo || x > hi) throw new RangeError(`${name}=${x} outside [${lo}, ${hi}]`)
}

export function encodeRiskReport(r: RiskReport): Hex {
	assertInt('tObs', r.tObs, 0, 2 ** 40 - 1)
	assertInt('sigmaE9', r.sigmaE9, 0, UINT32_MAX)
	assertInt('rv15E9', r.rv15E9, 0, UINT32_MAX)
	assertInt('dvolE2', r.dvolE2, 0, UINT16_MAX)
	assertInt('refTick', r.refTick, INT24_MIN, INT24_MAX)
	assertInt('dispBp', r.dispBp, 0, UINT16_MAX)
	assertInt('nSources', r.nSources, 0, 255)
	assertInt('kE4', r.kE4, 0, UINT16_MAX)
	assertInt('zone', r.zone, 0, 255)
	return encodeAbiParameters(REPORT_ABI, [
		r.tObs,
		r.sigmaE9,
		r.rv15E9,
		r.dvolE2,
		r.refTick,
		r.dispBp,
		r.nSources,
		r.kE4,
		r.zone,
	])
}

export function decodeRiskReport(data: Hex): RiskReport {
	const [tObs, sigmaE9, rv15E9, dvolE2, refTick, dispBp, nSources, kE4, zone] = decodeAbiParameters(REPORT_ABI, data)
	return { tObs, sigmaE9, rv15E9, dvolE2, refTick, dispBp, nSources, kE4, zone }
}
```

- [x] **Step 4: Run it, expected PASS, and re-derive the golden value with Foundry**

```bash
(cd cre/risk-desk && bun test report.test.ts)
cast abi-encode "f(uint40,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)" 1791282309 59492 59492 4755 79065 2 4 10000 0
```

Expected: `5 pass`, `0 fail`, `7 expect() calls`. The `cast` output equals `GOLDEN` in the test: `0x...6ac4cc85`, `...e864`, `...e864`, `...1293`, `...134d9`, `...02`, `...04`, `...2710`, `...00`, nine 32-byte words.

- [x] **Step 5: Commit**

```bash
git add cre/risk-desk/report.ts cre/risk-desk/report.test.ts
git commit -m "feat(cre): canonical risk report encoder/decoder checked against Foundry"
```

---

### Task 7: Workflow wiring (node-mode fetch, consensus, report, write, confirmation)

**Delegable:** yes
**Depends on:** Tasks 3, 4, 5 and 6

How the SDK pieces are used, as read in the SDK source and `cre-templates` (`custom-data-feed-ts`, `circuit-breaker-ts`):
- `runtime.runInNodeMode(fn, ConsensusAggregationByFields<T>({field: median, ...}))(args).result()`. A node that throws becomes an error observation. With no default value, `.result()` throws in DON mode, and that is how "no quorum" becomes "no report".
- `new HTTPClient().sendRequest(nodeRuntime, {url, method, headers, body (base64), timeout})` starts the call at once, and `.result()` waits for it. Sending all six first and then reading them makes the calls concurrent.
- `runtime.report(prepareReportRequest(hex))` signs the raw payload (no selector). `new EVMClient(selector).writeReport(runtime, {receiver, report, gasConfig: {gasLimit}})` delivers it through the forwarder.
- `evm.callContract(runtime, {call: encodeCallMsg({from, to, data}), blockNumber: LATEST_BLOCK_NUMBER})` reads the latest block. The finalized block lags about 13 minutes on Sepolia, which is useless for the 20 s gap check.
- `runtime.now()` is DON time. It is read once in DON mode and passed to node mode, so every node builds the same URLs and staleness windows.
- Replay mode follows plan 04's replay server: one Binance-format kline call per venue path, prices used as USD, the same estimator. The replay test pins it with the Binance fixture: sigmaE9 61,531, tick 79,067, dispersion 0.
- The log lines `Write report transaction succeeded: 0x...` and `clim: no report (...)` are parsed by plan 04's loop. The tests pin them, so do not reword them.

**Files:**
- Modify: `cre/risk-desk/venues.ts` (full replacement: adds the SDK import and the node-mode fetch)
- Create: `cre/risk-desk/workflow.ts`, `cre/risk-desk/main.ts`
- Test: `cre/risk-desk/workflow.test.ts`

- [x] **Step 1: Write the failing test** at `cre/risk-desk/workflow.test.ts`

```ts
import { describe, expect } from 'bun:test'
import { EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from '@chainlink/cre-sdk/test'
import { bytesToHex, encodeFunctionResult, type Hex, hexToBytes } from 'viem'
import binance from './fixtures/binance.json'
import coinbase from './fixtures/coinbase.json'
import deribit from './fixtures/deribit.json'
import hyperliquid from './fixtures/hyperliquid.json'
import kraken from './fixtures/kraken.json'
import krakenUsdt from './fixtures/kraken_usdt.json'
import { decodeRiskReport, RISK_DESK_ABI, type RiskReport } from './report'
import { type Config, initWorkflow, onHttp, onTick } from './workflow'

const NOW = 1_791_282_309 // fixtures/now.txt
const SEPOLIA = 16_015_286_601_757_825_753n // ethereum-testnet-sepolia chain selector
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex

const CONFIG: Config = {
	schedule: '*/30 * * * * *',
	deskAddress: '0x000000000000000000000000000000000000dEaD',
	chainSelectorName: 'ethereum-testnet-sepolia',
	gasLimit: '500000',
	venues: ['coinbase', 'kraken', 'binance', 'hyperliquid'],
	dvolUrl: 'https://www.deribit.com/api/v2/public/get_volatility_index_data',
	usdtUsdUrl: 'https://api.kraken.com/0/public/Ticker?pair=USDTUSD',
	mode: 'live',
	replayUrl: '',
	token0IsEth: true,
	httpAuthorizedKeys: [],
}

const EXPECTED: RiskReport = {
	tObs: NOW,
	sigmaE9: 59_492,
	rv15E9: 59_492,
	dvolE2: 4_755,
	refTick: 79_065,
	dispBp: 2,
	nSources: 4,
	kE4: 10_000,
	zone: 0,
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
const jsonBody = (x: unknown): string => b64(new TextEncoder().encode(JSON.stringify(x)))

function mockHttp(failing: string[] = []): string[] {
	const seen: string[] = []
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		seen.push(`${req.method} ${req.url}`)
		const routes: Array<[string, unknown]> = [
			['https://api.coinbase.com/', coinbase],
			['https://api.kraken.com/0/public/OHLC', kraken],
			['https://data-api.binance.vision/', binance],
			['https://api.hyperliquid.xyz/info', hyperliquid],
			['https://www.deribit.com/', deribit],
			['https://api.kraken.com/0/public/Ticker', krakenUsdt],
		]
		const hit = routes.find(([prefix]) => req.url.startsWith(prefix))
		if (hit === undefined || failing.some((f) => req.url.startsWith(f))) {
			return { statusCode: 503, headers: {}, body: jsonBody({ error: 'unavailable' }) }
		}
		return { statusCode: 200, headers: {}, body: jsonBody(hit[1]) }
	}
	return seen
}

type State = [tObs: number, sigmaE9: number, kE4: number, flags: number, seq: number]

interface EvmOpts {
	states: State[] // returned by successive state() reads; the last one repeats
	receiver?: 'SUCCESS' | 'REVERTED'
	txHash?: Hex | null // null: dry run (no hash)
}

function mockEvm({ states, receiver = 'SUCCESS', txHash = TX_HASH }: EvmOpts): RiskReport[] {
	const written: RiskReport[] = []
	let reads = 0
	const evm = EvmMock.testInstance(SEPOLIA)
	evm.callContract = () => {
		const s = states[Math.min(reads++, states.length - 1)]
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
	return written
}

const BEFORE: State = [NOW - 30, 50_000, 10_000, 0, 7]
const AFTER: State = [NOW, 59_492, 10_000, 0, 8]

function runtimeAt(nowSec: number, config: Config = CONFIG) {
	const runtime = newTestRuntime(null, { timeProvider: () => nowSec * 1000 })
	;(runtime as unknown as { config: Config }).config = config
	return runtime
}

describe('onTick (live)', () => {
	test('fetches 6 sources, reaches consensus, writes the canonical report, confirms it on-chain', () => {
		const seen = mockHttp()
		const written = mockEvm({ states: [BEFORE, AFTER] })
		const runtime = runtimeAt(NOW)

		expect(onTick(runtime as never)).toBe(`OK ${TX_HASH}`)
		expect(seen).toHaveLength(6)
		expect(seen).toContain('POST https://api.hyperliquid.xyz/info')
		expect(written).toEqual([EXPECTED])
		const logs = runtime.getLogs().join('\n')
		expect(logs).toContain('consensus: sigma=33.4%/yr sigmaE9=59492 n=4 disp=2bp tick=79065 dvol=47.55')
		expect(logs).toContain('desk before: seq=7')
		expect(logs).toContain(`Write report transaction succeeded: ${TX_HASH}`) // parsed by plan 04's sim-loop
		expect(logs).toContain('REPORT applied seq=8 sigmaReported=33.4% sigmaApplied=33.4%')
	})

	test('dry run: no tx hash, nothing to confirm', () => {
		mockHttp()
		mockEvm({ states: [BEFORE], txHash: null })
		expect(onTick(runtimeAt(NOW) as never)).toBe('DRY RUN')
	})

	test('state unchanged after a successful forwarder tx means RiskDesk rejected the report', () => {
		mockHttp()
		mockEvm({ states: [BEFORE, BEFORE] })
		expect(onTick(runtimeAt(NOW) as never)).toBe(`NOT_APPLIED ${TX_HASH}`)
	})

	test('unreadable desk state: writes anyway (RiskDesk enforces the gap) and reports SENT', () => {
		mockHttp()
		const written = mockEvm({ states: [] })
		EvmMock.testInstance(SEPOLIA).callContract = () => {
			throw new Error('rpc down')
		}
		const runtime = runtimeAt(NOW)
		expect(onTick(runtime as never)).toBe(`SENT ${TX_HASH}`)
		expect(written).toEqual([EXPECTED])
		expect(runtime.getLogs().join('\n')).toContain('desk state unreadable: rpc down')
	})

	test('receiver REVERTED status (DON forwarder) is reported as REJECTED', () => {
		mockHttp()
		mockEvm({ states: [BEFORE], receiver: 'REVERTED' })
		expect(onTick(runtimeAt(NOW) as never)).toBe(`REJECTED ${TX_HASH}`)
	})

	test('skips when the last report is younger than MIN_GAP (20 s)', () => {
		mockHttp()
		const written = mockEvm({ states: [[NOW - 10, 50_000, 10_000, 0, 7]] })
		expect(onTick(runtimeAt(NOW) as never)).toBe('SKIP: min gap')
		expect(written).toHaveLength(0)
	})

	test('no report when fewer than 3 venues answer', () => {
		mockHttp(['https://api.coinbase.com/', 'https://api.kraken.com/0/public/OHLC'])
		const written = mockEvm({ states: [BEFORE] })
		const runtime = runtimeAt(NOW)
		expect(onTick(runtime as never)).toBe('SKIP: quorum 2/4 < 3')
		expect(written).toHaveLength(0)
		const logs = runtime.getLogs().join('\n')
		expect(logs).toContain('source dropped: coinbase: HTTP 503')
		expect(logs).toContain('clim: no report (quorum 2/4 < 3)') // parsed by plan 04's sim-loop
	})
})

describe('onTick (replay)', () => {
	test('one Binance-format call per venue on replayUrl; prices used as USD; dispersion 0', () => {
		const seen: string[] = []
		const http = HttpActionsMock.testInstance()
		http.sendRequest = (req) => {
			seen.push(req.url)
			return { statusCode: 200, headers: {}, body: jsonBody(binance) } // the server replays one series
		}
		const written = mockEvm({ states: [BEFORE, [NOW, 61_531, 10_000, 2, 8]] })
		const replay: Config = { ...CONFIG, mode: 'replay', replayUrl: 'http://127.0.0.1:8787' }

		expect(onTick(runtimeAt(NOW, replay) as never)).toBe(`OK ${TX_HASH}`)
		expect(seen).toEqual(
			CONFIG.venues.map((v) => `http://127.0.0.1:8787/venue/${v}/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20`),
		)
		expect(written).toEqual([
			{ ...EXPECTED, sigmaE9: 61_531, rv15E9: 61_531, dvolE2: 0, refTick: 79_067, dispBp: 0, nSources: 4 },
		])
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

- [x] **Step 2: Run it, expected FAIL**

```bash
(cd cre/risk-desk && bun test workflow.test.ts)
```

Expected: `error: Cannot find module './workflow' from '.../cre/risk-desk/workflow.test.ts'`, then `0 pass`, `1 fail`, `1 error`.

- [x] **Step 3: Replace `cre/risk-desk/venues.ts` entirely** (the pure part is unchanged; the SDK import and the node-mode fetch are added)

```ts
// Venue requests, response parsers and the node-mode fetch. Parsers are pure and tested on
// fixtures captured from the real endpoints (fixtures/, see scripts/capture-fixtures.sh).
import { HTTPClient, type NodeRuntime, ok, text } from '@chainlink/cre-sdk'
import type { Candle, Quote, VenueSeries } from './estimator'

export const VENUES = ['coinbase', 'kraken', 'binance', 'hyperliquid'] as const
export type VenueName = (typeof VENUES)[number]

export const VENUE_QUOTE: Record<VenueName, Quote> = {
	coinbase: 'USD',
	kraken: 'USD',
	binance: 'USDT',
	hyperliquid: 'USD', // USDC-margined perp, treated as USD
}

const LOOKBACK_SEC = 1200 // 20 minutes: covers the 16 closes of RV15 plus the staleness margin

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
			return {
				url: `https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=${nowSec - LOOKBACK_SEC}`,
				method: 'GET',
			}
		case 'binance':
			return {
				url: 'https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20',
				method: 'GET',
			}
		case 'hyperliquid':
			return {
				url: 'https://api.hyperliquid.xyz/info',
				method: 'POST',
				body: JSON.stringify({
					type: 'candleSnapshot',
					req: {
						coin: 'ETH',
						interval: '1m',
						startTime: (nowSec - LOOKBACK_SEC) * 1000,
						endTime: nowSec * 1000,
					},
				}),
			}
	}
}

export function dvolRequest(dvolUrl: string, nowSec: number): HttpReq {
	const end = nowSec * 1000
	const start = end - 600_000
	return {
		url: `${dvolUrl}?currency=ETH&start_timestamp=${start}&end_timestamp=${end}&resolution=60`,
		method: 'GET',
	}
}

// ---------- parsing helpers ----------

function num(x: unknown, what: string): number {
	const n = typeof x === 'string' ? Number(x) : x
	if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${what}: not a number: ${String(x)}`)
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

// ---------- venue parsers (all return candles ascending by open time, seconds) ----------

// {"candles":[{"start":"1791282180","close":"2713.98",...}, ...]} newest first
export function parseCoinbase(json: unknown): Candle[] {
	const rows = arr(obj(json, 'coinbase').candles, 'coinbase.candles')
	return ascending(
		rows.map((r) => {
			const o = obj(r, 'coinbase.candle')
			return { t: num(o.start, 'coinbase.start'), close: num(o.close, 'coinbase.close') }
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
			return { t: num(row[0], 'kraken.time'), close: num(row[4], 'kraken.close') }
		}),
	)
}

// [[openTimeMs,"open","high","low","close","volume",closeTimeMs,...], ...]
export function parseBinance(json: unknown): Candle[] {
	return ascending(
		arr(json, 'binance').map((r) => {
			const row = arr(r, 'binance.row')
			return { t: num(row[0], 'binance.openTime') / 1000, close: num(row[4], 'binance.close') }
		}),
	)
}

// [{"t":openMs,"T":closeMs,"s":"ETH","i":"1m","o":"..","c":"..",...}, ...]
export function parseHyperliquid(json: unknown): Candle[] {
	return ascending(
		arr(json, 'hyperliquid').map((r) => {
			const o = obj(r, 'hyperliquid.candle')
			return { t: num(o.t, 'hyperliquid.t') / 1000, close: num(o.c, 'hyperliquid.c') }
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

// {"result":{"data":[[tsMs,open,high,low,close],...]}} -> last close (DVOL in vol points, e.g. 47.55)
export function parseDvol(json: unknown): number {
	const data = arr(obj(obj(json, 'deribit').result, 'deribit.result').data, 'deribit.data')
	if (data.length === 0) throw new Error('deribit: empty data')
	const last = arr(data[data.length - 1], 'deribit.row')
	return num(last[4], 'deribit.close')
}

// {"error":[],"result":{"USDTZUSD":{"c":["0.99966000","5.19"],...}}} -> last trade price
export function parseUsdtUsd(json: unknown): number {
	const result = obj(obj(json, 'kraken-usdt').result, 'kraken-usdt.result')
	const key = Object.keys(result)[0]
	if (key === undefined) throw new Error('kraken-usdt: empty result')
	const c = arr(obj(result[key], 'kraken-usdt.pair').c, 'kraken-usdt.c')
	return num(c[0], 'kraken-usdt.last')
}

// ---------- replay (plan 04 replay server) ----------

// The plan 04 replay server replays one historical Binance ETHUSDT series in Binance kline format,
// timestamps shifted to the wall clock, under one path per venue name (so the per-venue logic and the
// desk's quorum are exercised; the REPLAY flag of the replay desk discloses that it is one series).
export function replayVenueRequest(replayUrl: string, venue: VenueName): HttpReq {
	return { url: `${replayUrl}/venue/${venue}/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20`, method: 'GET' }
}

export interface DeskInput {
	nowSec: number
	usdtUsd: number | null
	dvol: number | null
	series: VenueSeries[]
	notes: string[] // per-source fetch/parse problems, for logs
}

// ---------- node-mode fetch ----------

type Fetched = { json: unknown } | { error: string }

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

function settle<T>(f: Fetched, parse: (json: unknown) => T): { value: T } | { error: string } {
	if ('error' in f) return { error: f.error }
	try {
		return { value: parse(f.json) }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}

export function fetchLive(
	nodeRuntime: NodeRuntime<unknown>,
	venues: VenueName[],
	dvolUrl: string,
	usdtUsdUrl: string,
	nowSec: number,
): DeskInput {
	const reqs = [
		...venues.map((v) => venueRequest(v, nowSec)),
		dvolRequest(dvolUrl, nowSec),
		{ url: usdtUsdUrl, method: 'GET' as const },
	]
	const res = sendAll(nodeRuntime, reqs)
	const notes: string[] = []
	const series: VenueSeries[] = []
	venues.forEach((v, i) => {
		const r = settle(res[i], (j) => parseVenue(v, j))
		if ('error' in r) notes.push(`${v}: ${r.error}`)
		// a failed venue stays in the list with no candles, so the quorum message counts it
		series.push({ venue: v, quote: VENUE_QUOTE[v], candles: 'error' in r ? [] : r.value })
	})
	const dv = settle(res[venues.length], parseDvol)
	if ('error' in dv) notes.push(`dvol: ${dv.error}`)
	const ut = settle(res[venues.length + 1], parseUsdtUsd)
	if ('error' in ut) notes.push(`usdtusd: ${ut.error}`)
	return {
		nowSec,
		usdtUsd: 'error' in ut ? null : ut.value,
		dvol: 'error' in dv ? null : dv.value,
		series,
		notes,
	}
}

export function fetchReplay(
	nodeRuntime: NodeRuntime<unknown>,
	replayUrl: string,
	venues: VenueName[],
	nowSec: number,
): DeskInput {
	const res = sendAll(
		nodeRuntime,
		venues.map((v) => replayVenueRequest(replayUrl, v)),
	)
	const notes: string[] = []
	const series: VenueSeries[] = venues.map((v, i) => {
		const r = settle(res[i], parseBinance)
		if ('error' in r) notes.push(`replay ${v}: ${r.error}`)
		// replay prices are the historical USDT closes, used as USD (no USDT/USD rate in the replay)
		return { venue: v, quote: 'USD', candles: 'error' in r ? [] : r.value }
	})
	return { nowSec, usdtUsd: null, dvol: null, series, notes }
}
```

- [x] **Step 4: Create `cre/risk-desk/workflow.ts` and `cre/risk-desk/main.ts`**

`cre/risk-desk/workflow.ts`:

```ts
// clim risk desk: every 30 s, measure multi-venue ETH realized volatility, reach DON consensus
// field by field (median), and write the signed report to RiskDesk.onReport on Sepolia.
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
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import { z } from 'zod'
import { annualPctFromE9, estimate } from './estimator'
import {
	buildReport,
	encodeRiskReport,
	MIN_GAP_SEC,
	type Observation,
	RISK_DESK_ABI,
} from './report'
import { fetchLive, fetchReplay, VENUES } from './venues'

export const configSchema = z.object({
	schedule: z.string(),
	deskAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	chainSelectorName: z.string(),
	gasLimit: z.string(),
	venues: z.array(z.enum(VENUES)).min(3),
	dvolUrl: z.string(),
	usdtUsdUrl: z.string(),
	mode: z.enum(['live', 'replay']),
	replayUrl: z.string(),
	token0IsEth: z.boolean(),
	httpAuthorizedKeys: z.array(z.string()),
})

export type Config = z.infer<typeof configSchema>

export interface DeskState {
	tObs: number
	sigmaE9: number
	kE4: number
	flags: number
	seq: number
}

const pct = (sigmaE9: number): string => annualPctFromE9(sigmaE9).toFixed(1)

// Runs on every node: fetch the sources, estimate, return one observation for consensus.
export const observe = (nodeRuntime: NodeRuntime<Config>, nowSec: number): Observation => {
	const cfg = nodeRuntime.config
	const input =
		cfg.mode === 'replay'
			? fetchReplay(nodeRuntime, cfg.replayUrl, cfg.venues, nowSec)
			: fetchLive(nodeRuntime, cfg.venues, cfg.dvolUrl, cfg.usdtUsdUrl, nowSec)
	for (const note of input.notes) nodeRuntime.log(`source dropped: ${note}`)
	const est = estimate({
		nowSec: input.nowSec,
		usdtUsd: input.usdtUsd,
		token0IsEth: cfg.token0IsEth,
		series: input.series,
	})
	const dvolE2 = input.dvol === null ? 0 : Math.round(input.dvol * 100)
	nodeRuntime.log(
		`node: sources=${est.sources.join(',')} n=${est.nSources} tEnd=${est.tEnd} price=${(est.priceE6 / 1e6).toFixed(2)} rv15=${pct(est.rv15E9)}% disp=${est.dispBp}bp tick=${est.refTick} dvol=${(dvolE2 / 100).toFixed(2)}`,
	)
	return {
		sigmaE9: est.sigmaE9,
		rv15E9: est.rv15E9,
		dvolE2,
		refTick: est.refTick,
		dispBp: est.dispBp,
		nSources: est.nSources,
		priceE6: est.priceE6,
	}
}

export const observationAggregation = ConsensusAggregationByFields<Observation>({
	sigmaE9: median,
	rv15E9: median,
	dvolE2: median,
	refTick: median,
	dispBp: median,
	nSources: median,
	priceE6: median,
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
		const [tObs, sigmaE9, kE4, flags, seq] = decodeFunctionResult({
			abi: RISK_DESK_ABI,
			functionName: 'state',
			data: bytesToHex(reply.data),
		})
		return { tObs, sigmaE9, kE4, flags, seq }
	} catch (e) {
		runtime.log(`desk state unreadable: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
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
		const msg = e instanceof Error ? e.message : String(e)
		runtime.log(`clim: no report (${msg})`)
		return `SKIP: ${msg}`
	}

	const report = buildReport(obs, tObs)
	runtime.log(
		`consensus: sigma=${pct(report.sigmaE9)}%/yr sigmaE9=${report.sigmaE9} n=${report.nSources} disp=${report.dispBp}bp tick=${report.refTick} dvol=${(report.dvolE2 / 100).toFixed(2)} price=${(obs.priceE6 / 1e6).toFixed(2)} tObs=${report.tObs}`,
	)
	if (report.nSources < 3) {
		runtime.log(`clim: no report (consensus nSources=${report.nSources} < 3)`)
		return 'SKIP: quorum'
	}

	const evm = evmClientFor(cfg)
	const prev = readDeskState(runtime, evm)
	if (prev !== null) {
		runtime.log(`desk before: seq=${prev.seq} tObs=${prev.tObs} sigma=${pct(prev.sigmaE9)}%/yr flags=${prev.flags}`)
		if (prev.tObs > 0 && report.tObs < prev.tObs + MIN_GAP_SEC) {
			runtime.log(`clim: no report (${report.tObs - prev.tObs} s since the last report < ${MIN_GAP_SEC} s)`)
			return 'SKIP: min gap'
		}
	}

	const signed = runtime.report(prepareReportRequest(encodeRiskReport(report))).result()
	const reply = evm
		.writeReport(runtime, {
			receiver: cfg.deskAddress,
			report: signed,
			gasConfig: { gasLimit: cfg.gasLimit },
		})
		.result()
	const txHash = bytesToHex(reply.txHash ?? new Uint8Array(32))
	if (reply.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: status=${reply.txStatus} ${reply.errorMessage ?? ''} tx=${txHash}`)
	}
	// Exact line parsed by plan 04's bots/src/sim-loop.ts (the CRE docs and templates format).
	runtime.log(`Write report transaction succeeded: ${txHash}`)
	if (reply.receiverContractExecutionStatus === EVM_PB.ReceiverContractExecutionStatus.REVERTED) {
		runtime.log(`REJECTED by RiskDesk (onReport reverted) tx=${txHash}`)
		return `REJECTED ${txHash}`
	}
	if (/^0x0+$/.test(txHash)) {
		runtime.log(`DRY RUN: report encoded and simulated, not broadcast (sigmaE9=${report.sigmaE9})`)
		return 'DRY RUN'
	}
	// The forwarders never revert when the receiver reverts (they emit ReportProcessed(result=false)),
	// and the simulator then still reports receiver SUCCESS: re-read the desk to know if it applied.
	const after = readDeskState(runtime, evm)
	if (after === null) {
		runtime.log(`REPORT sent, desk state unreadable after tx=${txHash}`)
		return `SENT ${txHash}`
	}
	if (after.tObs === report.tObs) {
		runtime.log(
			`REPORT applied seq=${after.seq} sigmaReported=${pct(report.sigmaE9)}% sigmaApplied=${pct(after.sigmaE9)}% flags=${after.flags} tx=${txHash}`,
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
				authorizedKeys: config.httpAuthorizedKeys.map((publicKey) => ({
					type: 'KEY_TYPE_ECDSA_EVM' as const,
					publicKey,
				})),
			}),
			onHttp,
		),
	]
}
```

`cre/risk-desk/main.ts`:

```ts
import { Runner } from '@chainlink/cre-sdk'
import { configSchema, initWorkflow } from './workflow'

export async function main() {
	const runner = await Runner.newRunner({ configSchema })
	await runner.run(initWorkflow)
}

main()
```

- [x] **Step 5: Run every test, expected PASS**

```bash
(cd cre/risk-desk && bun test)
```

Expected: `36 pass`, `0 fail`, `Ran 36 tests across 4 files.`

- [x] **Step 6: Typecheck and compile to WASM (no login needed)**

```bash
(cd cre/risk-desk && bun run typecheck)
(cd cre && cre workflow build ./risk-desk -o ./risk-desk/binary.wasm)
```

Expected: `$ tsc --noEmit` with no error lines. Then:

```text
  Compiling workflow...
✓ Workflow compiled successfully
  Binary hash: <64 hex characters>
✓ Build output written to ./risk-desk/binary.wasm
```

`cre-compile` also rejects APIs that are unavailable in the WASM runtime (`fetch`, `setTimeout`, `node:*`). If it reports one, replace it with a CRE capability rather than skipping the checks.

- [x] **Step 7: Commit**

```bash
git add cre/risk-desk/venues.ts cre/risk-desk/workflow.ts cre/risk-desk/main.ts cre/risk-desk/workflow.test.ts
git commit -m "feat(cre): risk-desk workflow: node-mode venues, median consensus, signed report, write and confirm"
```

---

### Task 8: First simulation: dry run against the live endpoints

**Delegable:** yes, to anyone logged in with an account in the CRE organization
**Depends on:** Task 7 and Task 1 Step 4

**Files:**
- Modify: today's session log (and the friction log if anything differs from this plan)

- [x] **Step 1: Dry run through the cron handler**

```bash
(cd cre && cre workflow simulate risk-desk --non-interactive --trigger-index 0 --target staging-settings)
```

Expected shape (the numbers move with the market). Without `cre/.env`, a warning `Using default private key for chain write simulation...` appears first, which is fine for a dry run:

```text
✓ Workflow compiled
✓ Simulation limits enabled
  HTTP: req=120kb resp=250kb timeout=10s | ConfHTTP: ... | Consensus obs=25kb | ChainWrite evm_report=50kb evm_gas=10000000 ...
  Binary hash: <hex>
  Config hash: <hex>
<time> [SIMULATION] Simulator Initialized

<time> [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
<time> [USER LOG] node: sources=coinbase,kraken,binance,hyperliquid n=4 tEnd=<unix minute> price=<ETH price> rv15=<x.x>% disp=<d>bp tick=<tick> dvol=<DVOL>
<time> [USER LOG] consensus: sigma=<x.x>%/yr sigmaE9=<int> n=4 disp=<d>bp tick=<tick> dvol=<DVOL> price=<ETH price> tObs=<unix now>
<time> [USER LOG] desk state unreadable: Cannot decode zero data ("0x") with ABI parameters.
<time> [USER LOG] Write report transaction succeeded: 0x0000000000000000000000000000000000000000000000000000000000000000
<time> [USER LOG] DRY RUN: report encoded and simulated, not broadcast (sigmaE9=<int>)

✓ Workflow Simulation Result:
"DRY RUN"

<time> [SIMULATION] Execution finished signal received
<time> [SIMULATION] Skipping WorkflowEngineV2
```

A box "Simulation complete! Ready to deploy your workflow? Run cre account access to request deployment access." closes the output (seen while deploy access is not enabled). `<time>` is the machine's local time with a `Z` suffix (cre v1.37.0, friction row 19): on a Mac set to Singapore it reads 8 h ahead of UTC; prefix the command with `TZ=UTC` for true UTC times.

- [x] **Step 2: Check the numbers are sane**
  - sigma between 5 and 200 %/yr;
  - n = 4, or 3 with a `source dropped: <venue>: <reason>` line naming the missing venue;
  - disp at most 10 bp;
  - tick between 76,000 and 81,000 while ETH trades between 2,000 and 3,300 USD;
  - dvol between 30 and 120;
  - `tObs` within a few seconds of `date +%s`.

  If n < 4, write the venue and the reason in the session log. If the reason is on the CRE side (for example egress or a timeout), also add a friction row.

- [x] **Step 3: Run the HTTP handler once (tested here and in listen mode, Task 9 Step 4; the loops use the cron handler)**

```bash
(cd cre && cre workflow simulate risk-desk --non-interactive --trigger-index 1 --http-payload '{}' --target staging-settings)
```

Expected: `✓ Parsed JSON input successfully` and `✓ Created HTTP trigger payload with 0 fields` before the simulator starts, then `Running trigger trigger=http-trigger@1.0.0-alpha`, the same five `[USER LOG]` lines and `"DRY RUN"`.

- [x] **Step 4: Log it** (with the values you observed)

```markdown
- (CRE) First dry run OK (cron and HTTP handlers): n=4, sigma <x.x> %/yr, dispersion <d> bp, DVOL <v>, one run takes <s> s end to end.
```

- [x] **Step 5: Commit**

```bash
git add docs/sessions/ docs/feedback/cre-friction-log.md
git commit -m "docs(cre): first risk-desk dry-run simulation"
```

---

### Task 9: Simulation loop

**Delegable:** yes, to anyone logged in to CRE
**Depends on:** Task 8

**Files:**
- Create: `cre/scripts/sim-loop.sh`
- Modify: `docs/feedback/cre-friction-log.md` (status of rows 11 and 12), today's session log

This loop needs nothing outside `cre/`. Plan 04's `bun run cre-loop` (`bots/src/sim-loop.ts`) runs this same script for the demo and records receipts and transcripts.

- [x] **Step 1: Create `cre/scripts/sim-loop.sh`**

```bash
#!/usr/bin/env bash
# Runs the clim risk desk in local CRE simulation every INTERVAL seconds (default 30).
# Builds the WASM once, then reuses it with --wasm, so runs do not recompile.
# Usage (from cre/): [ENV_FILE=.env.replay] scripts/sim-loop.sh <staging-settings|replay-settings> [--broadcast]
# ENV_FILE: the .env file holding CRE_ETH_PRIVATE_KEY, passed to the CLI as -e (unset: the CLI's own cre/.env).
# The replay desk has its own operator key in cre/.env.replay (plan 01 Task 18).
# Output: full log in cre/logs/, USER LOG lines echoed to the terminal. Stop with Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/.."
# The CLI prints local time labeled "Z" (friction row 19): run it in UTC so transcripts match block times.
export TZ=UTC
TARGET="${1:?usage: scripts/sim-loop.sh <staging-settings|replay-settings> [--broadcast]}"
BROADCAST="${2:-}"
INTERVAL="${INTERVAL:-30}"
ENV_FILE="${ENV_FILE:-}"
# Absolute path: simulate resolves a relative --wasm from the workflow folder (risk-desk/), build -o from here.
WASM="$PWD/risk-desk/binary.wasm"
mkdir -p logs
LOG="logs/sim-$(date -u +%Y%m%dT%H%M%SZ)-${TARGET}${BROADCAST:+-broadcast}.log"
cre workflow build ./risk-desk -o "$WASM"
echo "target=${TARGET} broadcast=${BROADCAST:-no} env=${ENV_FILE:-.env} interval=${INTERVAL}s log=${LOG}"
while true; do
  START=$(date +%s)
  echo "=== $(date -u +%FT%TZ)" | tee -a "$LOG"
  cre workflow simulate risk-desk --wasm "$WASM" --non-interactive --trigger-index 0 \
    --target "$TARGET" ${BROADCAST} ${ENV_FILE:+-e "$ENV_FILE"} 2>&1 | tee -a "$LOG" | grep -E "USER LOG|rror|✗" || true
  ELAPSED=$(( $(date +%s) - START ))
  if (( ELAPSED < INTERVAL )); then sleep $(( INTERVAL - ELAPSED )); fi
done
```

- [x] **Step 2: Check the syntax**

```bash
chmod +x cre/scripts/sim-loop.sh && bash -n cre/scripts/sim-loop.sh && echo "syntax ok"
```

Expected: `syntax ok`

- [x] **Step 3: Run three dry-run iterations**

In Claude Code, start it with `run_in_background`. In a terminal, use a second tab.

```bash
(cd cre && scripts/sim-loop.sh staging-settings)
```

After about 100 seconds, check the log, then stop the loop:

```bash
(cd cre && grep -c '"DRY RUN"' "$(ls -t logs/sim-*-staging-settings.log | head -1)")
pkill -f sim-loop.sh
```

Expected: `3` or more. The `===` timestamps in the log are about 30 s apart: each run takes well under 30 s because `--wasm` skips compilation.

- [x] **Step 4: Try listen mode once (it answers friction rows 11 and 12)**

Terminal A (or a background task):

```bash
(cd cre && cre workflow simulate risk-desk --wasm "$PWD/risk-desk/binary.wasm" --listen --non-interactive --trigger-index 1 --http-payload '{}' --target staging-settings)
```

Expected: one run, then `Listen: ready for next request (run #2)` and `Waiting for HTTP request to start execution (listening on http://localhost:2000/trigger)...`

Terminal B, at least 30 s after that first run:

```bash
curl -s -X POST http://localhost:2000/trigger -H 'Content-Type: application/json' -d '{"input":{}}' -w '%{http_code}\n'
curl -s -X POST http://localhost:2000/trigger -H 'Content-Type: application/json' -d '{"input":{}}' -w '%{http_code}\n'
```

Expected: `200` twice (empty body). Terminal A runs once for the first POST and logs `Trigger rate limited, skipping execution trigger=http-trigger@1.0.0-alpha limit=HTTP trigger rate limited: every30s:1` for the second one, which came less than 30 s later. Stop terminal A with Ctrl+C (or `pkill -f "cre workflow simulate"`); it can take about 17 s to exit after `Received interrupt signal, stopping execution` (port 2000 is released at once).

- [x] **Step 5: Record what you saw**

In the friction log, set the Status cell of rows 11 and 12 to `confirmed <date>`, or correct the text if the CLI behaved differently.

Session log:

```markdown
- (CRE) Loop: `cre/scripts/sim-loop.sh` (build once, `simulate --wasm` every 30 s, cron handler); one run takes <s> s. Listen mode works with POST /trigger {"input":{}} at most once per 30 s. Plan 04's `bun run cre-loop` runs this script for the demo.
```

If listen mode proved clearly better (for example much faster runs), write that instead in the session log; changing the demo loop then means changing `loopCommand` in plan 04's `bots/src/lib/simParse.ts` and its test.

- [x] **Step 6: Commit**

```bash
git add cre/scripts/sim-loop.sh docs/feedback/cre-friction-log.md docs/sessions/
git commit -m "feat(cre): local simulation loop for the risk desk"
```

---

### Task 10: Broadcast to the live RiskDesk on Sepolia

**Delegable:** no (it uses the `simOperator` testnet key)
**Depends on:** Task 9; plan 01 has deployed the live RiskDesk with `simOperator` = the address of the key you put in `cre/.env`, and has written `riskDesks.live`, `tokens.tETH` and `tokens.tUSD` in `shared/deployments/sepolia.json`.

**Files:**
- Create: `cre/risk-desk/scripts/sync-config.ts`, `cre/risk-desk/scripts/latency.ts`
- Create (not committed): `cre/.env`
- Modify: `cre/risk-desk/config.staging.json` (through the script), today's session log, `docs/feedback/cre-friction-log.md`

- [x] **Step 1: Create `cre/risk-desk/scripts/sync-config.ts` and run it**

```ts
// Copies the RiskDesk addresses and the pool token order from shared/deployments/sepolia.json
// (written by plan 01) into the workflow configs. Usage (from cre/risk-desk): bun scripts/sync-config.ts
import { readFileSync, writeFileSync } from 'node:fs'

const DEPLOYMENTS = process.env.DEPLOYMENTS ?? '../../shared/deployments/sepolia.json'
// Key paths inside DEPLOYMENTS. If plan 01 named them differently, change them here and log it in docs/sessions.
// Shape agreed with plan 04 (shared/src/config.ts): tokens.<sym> = { address, symbol, decimals }, riskDesks.<pair> = address.
const KEYS = {
	tEth: 'tokens.tETH.address',
	tUsd: 'tokens.tUSD.address',
	desks: [
		['config.staging.json', 'riskDesks.live'],
		['config.replay.json', 'riskDesks.replay'],
		['config.production.json', 'riskDesks.don'],
	],
} as const

const dep: unknown = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'))
const get = (path: string): unknown =>
	path.split('.').reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), dep)
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)

const tEth = get(KEYS.tEth)
const tUsd = get(KEYS.tUsd)
if (!isAddr(tEth) || !isAddr(tUsd)) throw new Error(`${DEPLOYMENTS}: missing ${KEYS.tEth} or ${KEYS.tUsd}`)
const token0IsEth = BigInt(tEth) < BigInt(tUsd)

for (const [file, key] of KEYS.desks) {
	const desk = get(key)
	if (!isAddr(desk)) {
		console.log(`${file}: ${key} not in deployments yet, unchanged`)
		continue
	}
	const cfg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
	cfg.deskAddress = desk
	cfg.token0IsEth = token0IsEth
	writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`)
	console.log(`${file}: deskAddress=${desk} token0IsEth=${token0IsEth}`)
}
```

```bash
(cd cre/risk-desk && bun scripts/sync-config.ts)
```

Expected: `config.staging.json: deskAddress=0x<live desk> token0IsEth=<true|false>`. The replay and DON lines say `not in deployments yet, unchanged` until those desks exist.

If it throws `missing tokens.tETH.address or tokens.tUSD.address`, the deployments file has another shape: edit `KEYS` in the script and add a session-log bullet that names the keys.

- [x] **Step 2: Check the desk on chain**

Shell variables do not persist between tool calls, so every block below starts by defining the ones it uses.

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com; DESK=$(jq -r .deskAddress cre/risk-desk/config.staging.json)
cast call $DESK "state()(uint40,uint32,uint16,uint8,uint32)" --rpc-url $RPC
cast call $DESK "getForwarderAddress()(address)" --rpc-url $RPC
cast call $DESK "simOperator()(address)" --rpc-url $RPC
```

Expected:
- `state()` returns five zeros before the first report (the `flags` value is 0 for the live desk);
- the forwarder is `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`;
- `simOperator()` returns the operator address.

- [x] **Step 3: Create `cre/.env` with the simOperator key and check it**

```bash
cp cre/.env.example cre/.env
```

Edit `cre/.env` and set `CRE_ETH_PRIVATE_KEY=<the 64 hex characters of the simOperator testnet key, without 0x>` (the cre-templates convention; `cast` accepts the key with or without `0x`). It is the same key as `PRIVATE_KEY` in `contracts/.env` (plan 01) and `DEPLOYER_PRIVATE_KEY` in `bots/.env` (plan 04, with `0x`). Then:

```bash
KEY=$(grep '^CRE_ETH_PRIVATE_KEY=' cre/.env | cut -d= -f2)
cast wallet address --private-key "$KEY"
cast balance "$(cast wallet address --private-key "$KEY")" --ether --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

Expected:
- the address equals `simOperator()` from Step 2;
- the balance is at least 0.05 ETH (one hour of reports costs about 0.02 ETH at 1 gwei; Step 5 measures the real cost). If it is lower, top it up from https://faucets.chain.link.

- [x] **Step 4: One broadcast run**

```bash
(cd cre && cre workflow simulate risk-desk --non-interactive --trigger-index 0 --target staging-settings --broadcast)
```

Expected (`0x<tx>` is a real hash):

```text
[USER LOG] node: sources=coinbase,kraken,binance,hyperliquid n=4 ...
[USER LOG] consensus: sigma=<x.x>%/yr sigmaE9=<int> n=4 ...
[USER LOG] desk before: seq=0 tObs=0 sigma=0.0%/yr flags=0
[USER LOG] Write report transaction succeeded: 0x<tx>
[USER LOG] REPORT applied seq=1 sigmaReported=<x.x>% sigmaApplied=<y.y>% flags=0 tx=0x<tx>

Workflow Simulation Result:
 "OK 0x<tx>"
```

On a first report, `sigmaApplied` equals `sigmaReported` unless sigma is below 10 %/yr (the floor). If `disp` is above 25 bp, flags is 1 (DEGRADED). `SENT 0x<tx>` means the transaction went out but the desk state could not be read back: check `state()` by hand in Step 5.

- [x] **Step 5: Verify on chain and measure the gas**

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com; DESK=$(jq -r .deskAddress cre/risk-desk/config.staging.json); KEY=$(grep '^CRE_ETH_PRIVATE_KEY=' cre/.env | cut -d= -f2)
cast call $DESK "state()(uint40,uint32,uint16,uint8,uint32)" --rpc-url $RPC
cast receipt 0x<tx> gasUsed --rpc-url $RPC
```

Expected: the first value equals the logged `tObs` and the last value is `1`. Write the gas in the session log:

```markdown
- (CRE) First broadcast report: tx https://sepolia.etherscan.io/tx/0x<tx>, gasUsed <g>, applied sigma <y.y> %/yr. Budget at 1 gwei: <g × 120 / 1e9> ETH per hour of loop.
```

If the result is `NOT_APPLIED 0x<tx>` instead, RiskDesk rejected the report inside the forwarder:
1. Check the event: `cast receipt 0x<tx> --json --rpc-url https://ethereum-sepolia-rpc.publicnode.com | jq -r '.logs[] | select(.address == "0x15fc6ae953e024d975e77382eeec56a9101f9f88") | .data'` ends in `...0000` (false).
2. The usual causes are a `simOperator` that is not the `.env` key (Step 3) or a `tObs` gap under 20 s.
3. Set friction row 9 to `confirmed <date> with tx 0x<tx>`, fix the cause and re-run Step 4.

- [x] **Step 6: Prove that a forged report is not applied (SIM guard + friction row 9)**

The mock forwarder is permissionless, so anyone can call it. RiskDesk must ignore reports whose `tx.origin` is not `simOperator`.

First see the reason without spending gas. This simulates the forwarder calling `onReport`; the origin is then the forwarder, not the operator:

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com; DESK=$(jq -r .deskAddress cre/risk-desk/config.staging.json); KEY=$(grep '^CRE_ETH_PRIVATE_KEY=' cre/.env | cut -d= -f2)
PAYLOAD=$(cast abi-encode "f(uint40,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)" $(date +%s) 17807 17807 0 0 0 4 10000 0)
cast call $DESK "onReport(bytes,bytes)" 0x$(printf '%0128d' 0) $PAYLOAD --from 0x15fC6ae953E024d975e77382eEeC56A9101f9F88 --rpc-url $RPC
```

Expected: `Error: ... execution reverted` with RiskDesk's sim-guard custom error `NotSimOperator(address)` (selector `0x3d7f8f2e`, argument = the forwarder address, which is the `tx.origin` of this `eth_call`).

Then send a real forged report from a throwaway key:

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com; DESK=$(jq -r .deskAddress cre/risk-desk/config.staging.json); KEY=$(grep '^CRE_ETH_PRIVATE_KEY=' cre/.env | cut -d= -f2)
PAYLOAD=$(cast abi-encode "f(uint40,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)" $(date +%s) 17807 17807 0 0 0 4 10000 0)
ATTACKER=$(cast wallet new --json | jq -r '.[0].private_key')
cast send "$(cast wallet address --private-key $ATTACKER)" --value 0.005ether --private-key "$KEY" --rpc-url $RPC
RAW=0x$(printf '%0218d' 0)${PAYLOAD#0x}
cast send 0x15fC6ae953E024d975e77382eEeC56A9101f9F88 "report(address,bytes,bytes,bytes[])" $DESK $RAW 0x "[]" --private-key $ATTACKER --rpc-url $RPC
cast call $DESK "state()(uint40,uint32,uint16,uint8,uint32)" --rpc-url $RPC
```

Expected:
- the `cast send` receipt shows `status 1 (success)`;
- the forwarder's `ReportProcessed` log has data `0x...00` (false);
- `state()` is unchanged (same `seq`).

`RAW` is the 109-byte metadata header (zeros) followed by the payload, which is what `report()` slices.

Write the forged tx hash in the session log (demo evidence). Set friction row 9 to `confirmed <date>: forged tx 0x<hash> mined with status 1, ReportProcessed false, desk unchanged`.

- [x] **Step 7: Start the broadcast loop**

Use the bare script until plan 04's `bun run cre-loop --pair live` is ready. Then stop this one (`pkill -f sim-loop.sh`) and start `cre-loop`, which runs the same script and records every run: two loops on one desk collide on the 20 s MIN_GAP.

Binance fallback (spec Appendix B, question 5): after an hour of the loop, count the runs where Binance was dropped, `(cd cre && grep -c "source dropped: binance" "$(ls -t logs/*-broadcast.log | head -1)")`, against the `===` count of the same log. If Binance is dropped in more than 10 % of runs, add OKX as a fifth USDT venue (`https://www.okx.com/api/v5/market/candles?instId=ETH-USDT&bar=1m`, test-first like the other parsers in Task 5) and record it in friction row 8. Otherwise append `- (CRE) OKX fallback not needed: Binance dropped in <k> of <n> runs (spec Appendix B Q5).` under `## Build notes`.

```bash
(cd cre && scripts/sim-loop.sh staging-settings --broadcast)
```

Run it in the background. After at least 5 minutes:

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com; DESK=$(jq -r .deskAddress cre/risk-desk/config.staging.json); KEY=$(grep '^CRE_ETH_PRIVATE_KEY=' cre/.env | cut -d= -f2)
cast call $DESK "state()(uint40,uint32,uint16,uint8,uint32)" --rpc-url $RPC
(cd cre && grep -c "REPORT applied" "$(ls -t logs/*-broadcast.log | head -1)")
```

Expected: `seq` and the count have both grown by about 2 per minute.

- [x] **Step 8: Create `cre/risk-desk/scripts/latency.ts` and measure the end-to-end latency**

```ts
// End-to-end latency of the risk desk: for each RiskReported event, block.timestamp - tObs
// (DON observation time -> on-chain inclusion). Usage (from cre/risk-desk):
//   bun scripts/latency.ts <deskAddress> [blocks=600]
// RPC: SEPOLIA_RPC_URL, else the public Sepolia RPC. Bun loads .env from the working directory only, so
// to use the RPC in cre/.env add --env-file=../.env (or run bun risk-desk/scripts/latency.ts from cre/).
import { createPublicClient, http, parseAbiItem } from 'viem'
import { sepolia } from 'viem/chains'

const [desk, blocksArg] = process.argv.slice(2)
if (!desk || !/^0x[0-9a-fA-F]{40}$/.test(desk)) throw new Error('usage: bun scripts/latency.ts <deskAddress> [blocks]')
const client = createPublicClient({
	chain: sepolia,
	transport: http(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
})
const event = parseAbiItem(
	'event RiskReported(uint32 indexed seq, uint40 tObs, uint32 sigmaApplied, uint32 sigmaReported, uint32 rv15E9, uint16 dvolE2, int24 refTick, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 zone)',
)
const latest = await client.getBlockNumber()
const fromBlock = latest - BigInt(blocksArg ?? 600)
const logs = await client.getLogs({ address: desk as `0x${string}`, event, fromBlock, toBlock: latest })
const blockTime = new Map<bigint, number>()
const lat: number[] = []
for (const log of logs) {
	if (!blockTime.has(log.blockNumber)) {
		const b = await client.getBlock({ blockNumber: log.blockNumber })
		blockTime.set(log.blockNumber, Number(b.timestamp))
	}
	lat.push((blockTime.get(log.blockNumber) ?? 0) - Number(log.args.tObs))
}
lat.sort((a, b) => a - b)
const q = (p: number) => (lat.length === 0 ? Number.NaN : lat[Math.min(lat.length - 1, Math.floor(p * lat.length))])
console.log(`desk ${desk}: ${lat.length} reports in the last ${blocksArg ?? 600} blocks`)
console.log(`latency tObs -> block (s): min ${lat[0] ?? 'n/a'} median ${q(0.5)} p90 ${q(0.9)} max ${lat[lat.length - 1] ?? 'n/a'}`)
```

After at least 10 minutes of the loop:

```bash
DESK=$(jq -r .deskAddress cre/risk-desk/config.staging.json); (cd cre/risk-desk && bun scripts/latency.ts $DESK 100)
```

Expected:

```text
desk 0x<desk>: <N> reports in the last 100 blocks
latency tObs -> block (s): min <a> median <b> p90 <c> max <d>
```

`N` is about 40 for 100 blocks (20 minutes). Expect a median of roughly 20 to 60 s: the simulation run, then inclusion in a 12 s block.

Session log:

```markdown
- (CRE) Simulation broadcast loop: median end-to-end latency <b> s (p90 <c> s) from DON observation time to Sepolia block, over <N> reports.
```

In friction row 5, set the Status to `quotas confirmed; measured in simulation: median <b> s, p90 <c> s (tObs → block)`.

- [x] **Step 9: Commit** (never `cre/.env`)

```bash
git add cre/risk-desk/scripts/sync-config.ts cre/risk-desk/scripts/latency.ts cre/risk-desk/config.staging.json docs/sessions/ docs/feedback/cre-friction-log.md
git status --short cre/.env
git commit -m "feat(cre): broadcast risk reports to the live RiskDesk on Sepolia; config sync and latency tools"
```

Expected from `git status --short cre/.env`: no output (the file is ignored).

---

### Task 11: ABI contract check against plan 01's export

**Delegable:** yes
**Depends on:** Task 6; plan 01 exports `shared/abis/RiskDesk.json` (a raw ABI array or a forge artifact with an `abi` field)

This test is a cross-plan contract, not new behaviour. The three tests are skipped while the ABI file does not exist, and must pass once it does.

**Files:**
- Test: `cre/risk-desk/abi-sync.test.ts`

- [x] **Step 1: Write the test** at `cre/risk-desk/abi-sync.test.ts`

```ts
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { type Abi, type AbiEvent, type AbiFunction, toEventSignature, toFunctionSignature } from 'viem'
import { REPORT_ABI, RISK_DESK_ABI } from './report'

// shared/abis/RiskDesk.json is exported from contracts/out by plan 01 (raw ABI array or a forge artifact).
const PATH = process.env.RISK_DESK_ABI ?? '../../shared/abis/RiskDesk.json'
const exported = existsSync(PATH) ? (JSON.parse(readFileSync(PATH, 'utf8')) as Abi | { abi: Abi }) : null
const abi: Abi = exported === null ? [] : Array.isArray(exported) ? exported : exported.abi

const fn = (name: string) => abi.find((x): x is AbiFunction => x.type === 'function' && x.name === name)
const ev = (name: string) => abi.find((x): x is AbiEvent => x.type === 'event' && x.name === name)

describe.skipIf(exported === null)('RiskDesk ABI matches the workflow', () => {
	test('state() has the outputs the workflow decodes', () => {
		const ours = RISK_DESK_ABI[0]
		expect(fn('state')?.outputs.map((o) => o.type)).toEqual(ours.outputs.map((o) => o.type))
	})
	test('onReport(bytes,bytes) exists', () => {
		const f = fn('onReport')
		expect(f === undefined ? '' : toFunctionSignature(f)).toBe('onReport(bytes,bytes)')
	})
	test('RiskReported carries every report field, in report order, after seq and sigmaApplied', () => {
		const e = ev('RiskReported')
		expect(e === undefined ? '' : toEventSignature(e)).toBe(
			'RiskReported(uint32,uint40,uint32,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)',
		)
		expect(e?.inputs[0].indexed).toBe(true)
		// report fields minus tObs/sigmaE9 must line up with the event tail
		expect(e?.inputs.slice(4).map((i) => i.type)).toEqual(REPORT_ABI.slice(2).map((p) => p.type))
	})
})
```

- [x] **Step 2: Run it**

```bash
(cd cre/risk-desk && bun test abi-sync.test.ts)
```

Expected: `3 skip` before plan 01's export, and `3 pass`, `0 fail` after it.

A failure is an interface bug between plans. Compare both sides with the canonical interfaces (`state()`, `onReport(bytes,bytes)`, `RiskReported(uint32 indexed seq, uint40 tObs, uint32 sigmaApplied, uint32 sigmaReported, uint32 rv15E9, uint16 dvolE2, int24 refTick, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 zone)`), fix the side that deviates, and add a session-log bullet.

- [x] **Step 3: Commit**

```bash
git add cre/risk-desk/abi-sync.test.ts
git commit -m "test(cre): check the workflow's RiskDesk ABI against the contracts export"
```

---

### Task 12: Replay desk fed through CRE from the plan 04 replay server

**Delegable:** no (it uses the replay operator key)
**Depends on:** Task 10; plan 01 Task 18 (the replay desk, REPLAY flag, written as `riskDesks.replay`, whose `simOperator` is the key in `cre/.env.replay`); plan 04's replay server (`bots/src/replay-server.ts`) running on port 8787.

This task answers an open question from the design: can the simulator reach a server on localhost? Plan 04's run-book does the same check from its side.

**Files:**
- Modify: `cre/risk-desk/config.replay.json` (desk address through the script; `replayUrl` only if a tunnel is needed), today's session log, `docs/feedback/cre-friction-log.md` (if a tunnel is needed)

- [x] **Step 1: Point the replay config at the replay desk**

```bash
(cd cre/risk-desk && bun scripts/sync-config.ts)
jq -r '.deskAddress, .replayUrl' cre/risk-desk/config.replay.json
```

Expected: `config.replay.json: deskAddress=0x<replay desk> token0IsEth=<...>`, then the desk address and `http://127.0.0.1:8787`.

- [x] **Step 2: Check the replay server answers in Binance format**

```bash
curl -s http://127.0.0.1:8787/status; echo
curl -s "http://127.0.0.1:8787/venue/kraken/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=2"; echo
```

Expected:
- `/status` shows `"done":false` and a growing `progress`;
- the klines are two Binance-format rows `[openTimeMs,"open","high","low","close","0",closeTimeMs,...]` whose `openTimeMs` is within the last two minutes of wall-clock time.

- [x] **Step 3: Dry run in replay mode**

```bash
(cd cre && cre workflow simulate risk-desk --non-interactive --trigger-index 0 --target replay-settings)
```

Expected:

```text
[USER LOG] node: sources=coinbase,kraken,binance,hyperliquid n=4 tEnd=<unix minute> price=<replay price> rv15=<x.x>% disp=0bp tick=<tick> dvol=0.00
[USER LOG] consensus: sigma=<x.x>%/yr sigmaE9=<int> n=4 disp=0bp tick=<tick> dvol=0.00 price=<replay price> tObs=<unix now>
```

Then the desk lines, and `"DRY RUN"`. The replay price is about 2,255 at the start of the window, and the sigma follows the replayed day: the lab's replay of the same window gives RV15 between `replay.sigmaMinPct` and `replay.sigmaMaxPct` of `lab/out/summary.json` (34 % and 296 %/yr in the validation run), about 60 %/yr at 12:00 UTC.

If the run logs `source dropped: replay <venue>: ...` connection errors for all four venues, the simulator cannot reach 127.0.0.1:
1. Expose the server with a tunnel: `brew install cloudflared && cloudflared tunnel --url http://127.0.0.1:8787` (prints `https://<random>.trycloudflare.com`; without Homebrew use `bunx localtunnel --port 8787`).
2. Set `"replayUrl"` in `cre/risk-desk/config.replay.json` to that base URL, with no path, and run again.
3. Append the friction row `| <n> | Simulation networking | The simulator cannot reach a server on 127.0.0.1; we tunnel the replay server. | Allow loopback in simulation, or document it. | observed <date> |`.

- [x] **Step 4: Broadcast**

Plan 04's demo loop (`cd bots && ENV_FILE=.env.replay bun run cre-loop --pair replay`) drives the replay desk with the replay operator key. To check the CRE side alone first, run one broadcast with that key:

```bash
(cd cre && cast wallet address --private-key "0x$(grep '^CRE_ETH_PRIVATE_KEY=' .env.replay | cut -d= -f2)" && cast call "$(jq -r .deskAddress risk-desk/config.replay.json)" "simOperator()(address)" --rpc-url https://ethereum-sepolia-rpc.publicnode.com)
(cd cre && cre workflow simulate risk-desk --non-interactive --trigger-index 0 --target replay-settings --broadcast -e .env.replay)
```

Expected: the same address twice (the replay operator is the replay desk's `simOperator`), then `Write report transaction succeeded: 0x<tx>`, then `REPORT applied seq=<n> ... flags=2 tx=0x<tx>` (bit 1 is REPLAY; `flags=3` if DEGRADED too) and `"OK 0x<tx>"`. Without `-e .env.replay` the report is sent from the live operator and the desk rejects it (`NOT APPLIED`).

- [x] **Step 5: Log and commit**

```markdown
- (CRE) Replay desk fed by CRE simulation from the plan 04 replay server (localhost reachable: yes|no, tunnel used: yes|no): first tx https://sepolia.etherscan.io/tx/0x<tx>. Replay reports carry nSources=4 venue paths over one Binance series and dispBp=0, disclosed by the REPLAY flag.
```

```bash
git add cre/risk-desk/config.replay.json docs/sessions/ docs/feedback/cre-friction-log.md
git commit -m "feat(cre): feed the replay RiskDesk from the plan 04 replay server"
```

---

### Task 13: Deploy to a CRE DON (only if deploy access is granted)

**Status (2026-10-07): cut.** Deploy access was never enabled (Step 1), so this task did not run (master cut list item 1).

**Delegable:** no (organization access, deployer key)
**Depends on:** Task 10; `cre whoami` shows `Deploy Access: Enabled`; plan 01's desk deployment script

A DON deployment brings real multi-node consensus and real forwarder signatures, which simulation cannot show (friction row 1). The deployed workflow writes to a dedicated "don" desk, so the live demo desk keeps working with the simulation loop.

**Files:**
- Modify: `cre/risk-desk/config.production.json`, `shared/deployments/sepolia.json` (one new key), today's session log, `docs/feedback/cre-friction-log.md`

- [ ] **Step 1: Check access and the registry** **Cut (2026-10-07):** `cre whoami` printed `Deploy Access: Not enabled` for organization `org_5FPbh9KQQJLGWcEh` at about 05:35 SGT and again at 07:14 SGT (23:14 UTC on 2026-10-06), over 8 h after the request of 2026-10-06 22:56 SGT; DON deployment cut (master cut list item 1), clim stays on `simulate --broadcast` through `MockKeystoneForwarder`, friction row 6.

```bash
cre whoami
(cd cre && cre registry list)
```

Expected: `Deploy Access:   Enabled`, and a registry with `ID:   private` and `Type: off-chain`.

If there is no private registry, stop here: the onchain registry needs a linked key and mainnet ETH. Log it as a friction row.

- [ ] **Step 2: Deploy the DON desk and record it** **Cut (2026-10-07):** no deploy access (Step 1); no DON desk was deployed, `riskDesks.don` stays `null` in `shared/deployments/sepolia.json` and `config.production.json` keeps the `0x…dEaD` placeholder.

Run plan 01 Task 19 (the `don` suite of `01_DeployDesk`: production forwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, `disableSim()` in the same broadcast, then `05_WriteDeployments`, which records it as `riskDesks.don`):

```bash
(cd contracts && ok(){ out=$("$@" 2>&1); echo "$out" | grep -E "ONCHAIN EXECUTION COMPLETE|Error" || echo "$out" | grep -E "Script ran successfully"; ! echo "$out" | grep -q "Error"; } && SUITE=don ok forge script script/01_DeployDesk.s.sol --rpc-url sepolia --broadcast --slow --skip-simulation && ok forge script script/05_WriteDeployments.s.sol --rpc-url sepolia)
DESK=$(jq -r .riskDesks.don shared/deployments/sepolia.json)
cast call $DESK "getForwarderAddress()(address)" --rpc-url https://ethereum-sepolia-rpc.publicnode.com
cast call $DESK "simMode()(bool)" --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

Expected: `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.`, `Script ran successfully.`, then `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` and `false`. Then copy the address into the production config:

```bash
(cd cre/risk-desk && bun scripts/sync-config.ts)
```

Expected: `config.production.json: deskAddress=0x<don desk> token0IsEth=<...>`

- [ ] **Step 3: Authorize the operator address for the HTTP trigger** (the CLI rejects deploying an HTTP trigger without keys) **Cut (2026-10-07):** no deploy access (Step 1); `httpAuthorizedKeys` stays `[]`.

```bash
ADDR=$(cast wallet address --private-key "$(grep '^CRE_ETH_PRIVATE_KEY=' cre/.env | cut -d= -f2)")
jq --arg a "$ADDR" '.httpAuthorizedKeys = [$a]' cre/risk-desk/config.production.json > cre/risk-desk/config.production.tmp && mv cre/risk-desk/config.production.tmp cre/risk-desk/config.production.json
jq .httpAuthorizedKeys cre/risk-desk/config.production.json
```

Expected: a one-element array holding the operator address.

- [ ] **Step 4: Deploy** **Cut (2026-10-07):** no deploy access (Step 1), so `cre workflow deploy` was never run.

```bash
(cd cre && cre workflow deploy risk-desk --target production-settings --yes)
```

Expected (abridged):

```text
Deploying Workflow: clim-risk-desk
  Registry:      private
...
✓ Workflow compiled successfully
...
✓ Workflow registered in private registry
Details:
   Workflow Name:    clim-risk-desk
   Workflow ID:      <64 hex>
   Status:           Active
```

- [ ] **Step 5: Lock the DON desk to this workflow** (every redeploy changes the ID: redo this step after each one) **Cut (2026-10-07):** no DON desk and no workflow ID (Steps 2 and 4 cut).

```bash
DESK=$(jq -r .riskDesks.don shared/deployments/sepolia.json); KEY=$(grep '^PRIVATE_KEY=' contracts/.env | cut -d= -f2)
cast send $DESK "setExpectedWorkflowId(bytes32)" 0x<workflow id printed by Step 4> --private-key $KEY --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

- [ ] **Step 6: Watch it run** **Cut (2026-10-07):** nothing deployed on a DON (Step 4 cut); friction row 8 (DON egress) stays `not hit`.

```bash
(cd cre && cre workflow get ./risk-desk --target production-settings)
(cd cre && cre execution list clim-risk-desk --limit 5)
(cd cre && cre execution logs <execution uuid from the list>)
DESK=$(jq -r .riskDesks.don shared/deployments/sepolia.json)
cast call $DESK "state()(uint40,uint32,uint16,uint8,uint32)" --rpc-url https://ethereum-sepolia-rpc.publicnode.com
(cd cre/risk-desk && bun scripts/latency.ts $DESK 100)
```

Expected:
- executions arrive every 30 s with status SUCCESS;
- the logs show the same `node:` / `consensus:` / `REPORT applied` lines;
- `seq` grows by about 2 per minute;
- the transactions come from the KeystoneForwarder `0xF8344CFd...` (check one on Etherscan).

If executions fail, read `cre execution logs`. A `source dropped: binance: ...` line answers friction row 8 (DON egress).

- [ ] **Step 7: Log the evidence** **Cut (2026-10-07):** no DON evidence to log; the access status is in friction row 6 and the cut in the 2026-10-07 session log.

Session log:

```markdown
- (CRE) Deployed on a CRE DON (private registry): workflow ID 0x<id>, DON desk 0x<desk>, first DON tx https://sepolia.etherscan.io/tx/0x<tx>; DON latency median <b> s; access granted <hours> h after the request.
```

Friction log: in row 6, set the Status to `access granted after <hours> h`. In row 8, write `Binance reachable from the DON: yes|no`. Add a row for anything that surprised you during the deploy.

Cutting the live desk over to the DON (`setForwarderAddress(0xF8344CFd...)`, `setExpectedWorkflowId`, `disableSim()` on the live desk, then redeploying with the live desk's address in `config.production.json`) is irreversible for simulation. Do it only if the maintainer decides so after at least one clean hour on the DON desk, and log the decision.

- [ ] **Step 8: Commit** **Cut (2026-10-07):** no DON deployment files to commit (Steps 2 to 7 cut).

```bash
git add cre/risk-desk/config.production.json shared/deployments/sepolia.json contracts/deployments/11155111/desk-don.json contracts/broadcast docs/sessions/ docs/feedback/cre-friction-log.md
git commit -m "feat(cre): deploy the risk desk to a CRE DON writing to a dedicated RiskDesk"
```

---

### Task 14: README, evidence and wrap-up

**Delegable:** yes (Steps 2 and 3 need the logs and numbers from Task 10 or Task 13)
**Depends on:** Task 10 (Task 13 if it happened)

**Files:**
- Create: `cre/README.md`
- Modify: today's session log, `docs/feedback/cre-friction-log.md`

- [x] **Step 1: Create `cre/README.md`**

````markdown
# clim risk desk (Chainlink CRE workflow)

The risk desk is the CRE half of clim. Every 30 seconds it measures ETH realized volatility on four venues, needs fresh prices from at least three of them (otherwise no report is written), takes the median of each field with the CRE consensus API and writes a report to `RiskDesk.onReport` on Ethereum Sepolia. If a venue is more than 25 bp from the median, the report is still written but flagged DEGRADED, and the hook charges at least its 30 bp safe fee. On a DON that report is the median of the nodes' observations, signed by the DON. Today it runs with `cre workflow simulate --broadcast`: one node, and the operator key sends the report through `MockKeystoneForwarder`, which checks no signature (see [Trust model](#trust-model)); DON deploy access was not granted during the hackathon, so it has not run on a DON ([Evidence](#evidence)). The clim Uniswap v4 hook reads `RiskDesk.state()` on every swap and turns sigma into the LP fee. The desk never quotes a price and cannot change the fee formula: it only publishes the volatility the formula uses.

## What one execution does

1. **Trigger.** Cron `*/30 * * * * *` (handler 0) or an HTTP trigger (handler 1, tested in listen mode). Both run the same `onTick`. The 30 s simulation loops use the cron handler: each `simulate` run fires it once (`--trigger-index 0` in `scripts/sim-loop.sh`, which `bun run cre-loop` in `bots/` wraps).
2. **Observe, on every node** (`runInNodeMode`, 6 HTTP calls, sent concurrently):
   - 1-minute ETH candles from Coinbase Advanced (ETH-USD), Kraken (ETHUSD), Binance via `data-api.binance.vision` (ETHUSDT) and Hyperliquid (`candleSnapshot`, ETH perp);
   - Deribit ETH DVOL (diagnostic only);
   - Kraken USDT/USD, to convert Binance's USDT closes to USD.
3. **Estimate, on every node** (`estimator.ts`, pure and unit-tested):
   - a candle counts once its minute has ended (the lab's convention, so a replayed report reproduces the lab's RV15 at the same `tObs`); a venue counts if its last closed candle is at most 120 s old;
   - quorum: at least 3 fresh venues, otherwise the node reports an error and no report is written;
   - `tEnd` is the latest minute closed by at least 3 venues; `p_t` is the cross-venue median close of each minute;
   - `sigma = RV15 = sqrt(sum of the 15 squared one-minute log returns ending at tEnd / 900 s)`, published per square-root second times 1e9 (`sigmaE9`; 48 %/yr is 85,475);
   - `dispBp` is the distance of the farthest venue from the median at `tEnd`, in basis points, rounded up (RiskDesk flags DEGRADED above 25 bp);
   - `refTick = floor(ln(price) / ln(1.0001))`, negated when ETH is the pool's token1 (both test tokens have 18 decimals).
4. **Consensus.** `ConsensusAggregationByFields` with `median` on every field.
5. **Write.** `tObs` is DON time at the start of the execution. The workflow reads `RiskDesk.state()`, skips if the last report is less than 20 s old, then `runtime.report` and `EVMClient.writeReport` deliver the ABI-encoded report:

```solidity
(uint40 tObs, uint32 sigmaE9, uint32 rv15E9, uint16 dvolE2, int24 refTick, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 zone)
```

In this version `sigmaE9 == rv15E9`, `kE4 = 10000` (no model-risk multiplier) and `zone = 0` (the backtest validation runs in the lab, not in CRE). `dvolE2 = 0` means DVOL was unavailable.

6. **Confirm.** Forwarders never revert when the receiver rejects a report, and local simulation then still reports success, so the workflow re-reads `RiskDesk.state()` after the transaction and returns `OK <tx>` (applied), `NOT_APPLIED <tx>` (state unchanged), `SENT <tx>` (state unreadable), `REJECTED <tx>` (receiver reverted, reported by a DON forwarder), `DRY RUN` or `SKIP: <reason>`.

## Trust model

| | Local simulation (`--broadcast`) | Deployed on a CRE DON |
|---|---|---|
| Nodes | one (your machine) | the DON; each node fetches the venues itself |
| Forwarder | `MockKeystoneForwarder` `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`, no signature check | `KeystoneForwarder` `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, verifies DON signatures |
| What protects RiskDesk | `tx.origin == simOperator` (the key in `cre/.env`; `cre/.env.replay` for the replay desk), plus the sigma envelope | forwarder address and expected workflow ID |

## Run it

Prerequisites: bun 1.3.9, CRE CLI v1.37.0 or newer, `cre login`.

```bash
cd cre/risk-desk && bun install && bun test && bun run typecheck && cd ..
cre workflow build ./risk-desk -o ./risk-desk/binary.wasm         # compile to WASM, no login needed
cre workflow simulate risk-desk --non-interactive --trigger-index 0 --target staging-settings              # dry run
cre workflow simulate risk-desk --non-interactive --trigger-index 0 --target staging-settings --broadcast  # one real report
scripts/sim-loop.sh staging-settings --broadcast                   # the loop: one report every 30 s, logs in cre/logs/ (bun run cre-loop runs it and records each run)
ENV_FILE=.env.replay scripts/sim-loop.sh replay-settings --broadcast   # replay desk, with its own operator key
```

Replay mode (`--target replay-settings`, `mode: "replay"`) fetches, for each configured venue, `GET <replayUrl>/venue/<venue>/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20` from the replay server (`bots/src/replay-server.ts`). The server replays one historical Binance ETHUSDT series (2026-02-04) in Binance kline format, with timestamps shifted to the wall clock. Every venue path returns the same series, so `dispBp = 0`, `dvolE2 = 0` and the reported `nSources` counts venue paths, not independent sources; the replay desk's REPLAY flag discloses this. The report goes to the replay desk.

## Files

| Path | Role |
|---|---|
| `project.yaml` | Targets `staging-settings` (live simulation) and `replay-settings`, Sepolia RPC. A third target, `production-settings`, is a DON target whose `config.production.json` keeps a placeholder desk address (`0x…dEaD`); it was never used, because DON deploy access was not granted |
| `risk-desk/workflow.yaml` | Workflow name, entry point and config file per target |
| `risk-desk/main.ts` | Runner entry point |
| `risk-desk/workflow.ts` | Triggers, node-mode observation, consensus, report, write and confirmation |
| `risk-desk/venues.ts` | Venue requests, response parsers, concurrent fetch, replay snapshot parser |
| `risk-desk/estimator.ts` | Pure estimator: normalization, staleness, quorum, per-minute median, RV15, dispersion, tick |
| `risk-desk/report.ts` | Report ABI, encoder and decoder, RiskDesk read ABI |
| `risk-desk/fixtures/` | Real responses of the six sources captured on 2026-10-06 (unit-test inputs) |
| `risk-desk/scripts/` | Fixture capture, config sync from `shared/deployments`, latency measurement |
| `scripts/sim-loop.sh` | The 30 s simulation loop: builds the WASM once, then runs `cre workflow simulate --wasm` every 30 s (`--broadcast` writes on-chain). `bun run cre-loop` (`bots/src/sim-loop.ts`) runs it with `--broadcast` and records each run's receipt and `RiskReported` in `bots/out/cre-runs.jsonl`. |
````

- [x] **Step 2: Append a real sample run** (from the latest broadcast log, colour codes stripped)

```bash
(cd cre && LOG=$(ls -t logs/*-broadcast.log | head -1) && { echo; echo "## Sample run (Sepolia, $(date -u +%F))"; echo; echo '```text'; grep "USER LOG" "$LOG" | tail -5 | sed -E 's/\x1b\[[0-9;]*m//g'; echo '```'; } >> README.md)
tail -9 cre/README.md
```

Expected: a `## Sample run` section with five `[USER LOG]` lines ending in `REPORT applied ...`.

- [x] **Step 3: Append the evidence links** (use the real values from the session log)

Append to `cre/README.md`:

```markdown
## Evidence

- Live RiskDesk: https://sepolia.etherscan.io/address/0x<live desk> (reports every 30 s from the simulation loop).
- First simulated report: https://sepolia.etherscan.io/tx/0x<tx>; forged report that the desk ignored: https://sepolia.etherscan.io/tx/0x<forged tx>.
- End-to-end latency, observation time (tObs) to block: median <b> s, p90 <c> s over <N> reports (`risk-desk/scripts/latency.ts`).
- DON deployment (if done): workflow ID 0x<id>, DON desk https://sepolia.etherscan.io/address/0x<don desk>.
```

- [x] **Step 4: Final checks**

```bash
(cd cre/risk-desk && bun test && bun run typecheck)
(cd cre && cre workflow build ./risk-desk -o ./risk-desk/binary.wasm)
git status --short cre
```

Expected:
- `36 pass`, `0 fail` across 4 files without Task 11; with Task 11, `36 pass` and `3 skip` before plan 01's ABI export, or `39 pass` after it (5 files);
- a clean typecheck and `✓ Workflow compiled successfully`;
- `git status` lists only the files you are about to commit, with no `.env`, `binary.wasm` or `logs/`.

- [x] **Step 5: Commit**

```bash
git add cre/README.md docs/sessions/ docs/feedback/cre-friction-log.md
git commit -m "docs(cre): risk desk README with sample run and on-chain evidence"
```

---

## Self-review (performed while writing this plan)

**1. Spec coverage**

| Requirement (task brief / design) | Where |
|---|---|
| Install the CLI on macOS, `cre login`, early `cre account access` | Task 1 |
| `cre init` layout: `project.yaml`, `workflow.yaml`, configs, `secrets.yaml`, targets | Task 2 (written by hand, explained why) |
| SDK version, cron with a 6-field schedule, HTTP trigger for simulation | Tasks 2, 7 (`initWorkflow`, `*/30 * * * * *`, handlers [0] cron and [1] HTTP) |
| `HTTPClient.sendRequest` in node mode, `ConsensusAggregationByFields` + `median` | Task 7 (`observe`, `observationAggregation`) |
| `EVMClient.callContract`, `runtime.report`, `writeReport`, `runtime.now()`, `getNetwork("ethereum-testnet-sepolia")` | Task 7 (`readDeskState`, `onTick`, `evmClientFor`) |
| ABI encoding with viem `encodeAbiParameters` | Task 6 |
| Unit tests with bun and the SDK test utilities | Tasks 3, 5, 6, 7, 11 |
| `simulate` flags `--broadcast`, `--non-interactive`, `--trigger-index`, `--target`, `--listen`; quotas (30 s, 15 HTTP calls) | Facts table, Tasks 8, 9, 10 |
| Venue endpoints verified with real response shapes | Task 4 (fixtures), Task 5 (parsers) |
| Estimator: USD normalization, staleness 120 s, quorum ≥ 3, per-minute median, RV15 per sqrt-second, `dispBp`, `refTick` from token order | Task 3 |
| Canonical report ABI and config fields | Tasks 2, 6, 7 |
| Dry-run simulation with expected log lines | Task 8 |
| `--broadcast` to RiskDesk on Sepolia after plan 01 deploys | Task 10 |
| Replay mode against the replay server (plan 04) | Tasks 5 and 7 (code and tests), Task 12 (live run) |
| Friction log entries in the exact row format | Tasks 1, 8, 9, 10, 12, 13 |
| CRE as the core orchestration layer, proven by simulate or deployment | Tasks 10 and 13 |
| "Never cut": CRE → onReport → RiskDesk, CRE tx hashes | Tasks 10 and 14 |

Gaps that were found and closed while writing:
- Plan 04 was written in parallel. Its contracts with this plan were adopted here: the exact log lines its loop parses, the replay server's per-venue Binance-format paths, and the `tokens.<sym>.address` / `riskDesks.<pair>` shape of the deployments file. Plan 04's `cre-loop` (`bots/src/sim-loop.ts`) runs `cre/scripts/sim-loop.sh <target> --broadcast` and records each run: the script is the loop that writes every report, and plan 04 adds the record.
- The simulator reports success for rejected reports, so a post-write `state()` check was added (Task 7) with a test for it.
- The HTTP trigger needs authorized keys to deploy, so `httpAuthorizedKeys` was added to the config.
- Latency was undocumented (friction row 5), so `latency.ts` was added.

**2. Placeholder scan.** Every code step contains complete code, the exact code that was run in validation. The angle-bracket values that remain (`<tx>`, `<x.x>`, `<don desk>`, `<deployer key>`) are runtime observations, secrets or addresses that only exist after a deployment. They appear only in log lines and commands for the executor to fill in, never in source files.

The two steps that depended on plan 01's choices are now explicit (plan 00 integration pass): Task 13 Step 2 runs plan 01 Task 19's commands, and Task 10 Step 6 names the sim-guard error `NotSimOperator(address)`.

**3. Type and name consistency** (checked across tasks):
- `Observation` and `RiskReport` are defined in `report.ts` and used in `workflow.ts` and the tests.
- `DeskInput`, `VenueName`, `VENUES` and `VENUE_QUOTE` come from `venues.ts`; `estimate`, `EstimatorInput` and `annualPctFromE9` from `estimator.ts`.
- The `Config` fields are the same in the zod schema, the three config files and the tests.
- `MIN_GAP_SEC = 20`, `K_E4_NEUTRAL = 10000` and `ZONE.UNVALIDATED = 0` match the canonical interface.
- Test counts: 13 (estimator) + 9 (venues) + 5 (report) + 9 (workflow: 7 live, 1 replay, 1 init) = 36 after Task 7, and `abi-sync` adds 3 (skipped until plan 01's ABI exists).
