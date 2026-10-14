# clim run-book

Sections 0 to 7: clim v1 on Ethereum Sepolia (the TOKEN2049 Origins stack; its processes ran from the hackathon checkout and were stopped by plan 03 Task 26). Section 8: clim × Fables' live stack on Robinhood Chain testnet. Commands run from the repository root unless a `cd` is shown. Expected output follows each command; addresses, prices and hashes will differ.

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
| `fi.clim-fables.desk` | `bun src/live/desk-loop.ts --target rh-testnet-settings --cre-bin <cre>` (CRE loop + recorder) | `desk.log` | the loop's `=== <time>` and `[USER LOG]` lines, `pace: tObs <t>, start-up <s> s (median <m> s), next run <time>`, then `[desk] run <time>: applied tx 0x... seq <n> sigma5 <x> dev <y> gas <g>` every 30 s |
| `fi.clim-fables.runner` | `bun src/live/runner.ts` | `runner.log` | at start `[runner] last poked seq on chain: <n> (...)`, then `[runner] seq <n> poked <f01>/<f10> pips, tx 0x..., gas <g>` after each report |
| `fi.clim-fables.keeper` | `bun src/live/keeper.ts` | `keeper.log` | `[keeper] sigma5 <x>%/yr -> K fee <f> pips (TTL 7200 s), tx 0x...` about every 180 s |
| `fi.clim-fables.arb` | `bun src/live/arb.ts` | `arb.log` | `[arb] <pool> pool <p> vs <m> (fee <f>) -> buyEth tx 0x...` when a pool leaves its band |
| `fi.clim-fables.noise` | `bun src/live/noise.ts` | `noise.log` | `[noise] buyEth $<usd> on D (fee <f> pips) tx 0x...`, the same order on K and F |
| `fi.clim-fables.outages` | `bun src/live/scripts/outages.ts --watch` | `outages.log` | `[outages] block <n>: <k> new reports (<total> in all), <w> windows -> bots/out/outages.json` every 5 minutes |

```bash
cd bots && bun run live:install            # writes ~/Library/LaunchAgents/fi.clim-fables.*.plist and starts the six jobs
cd bots && bun run live:logs desk          # follow one job's log (Ctrl+C, a kill or an alarm stops the tail, never the job); no name: all six
cd bots && bun run live:status --watch     # a snapshot every 15 s, with each job's launchd state; PROBLEM lines name anything wrong
```

`live:install` resolves `bun` and `cre` on PATH and writes their absolute paths into the plists; rerun it after moving the repository or reinstalling either tool (it reloads the jobs). `bun run live:install <name>` (re)installs one job. The plists carry only `HOME` and `PATH`: the keys stay in `bots/.env` and `cre/.env`, read by the processes as when started by hand. The desk job runs the CRE CLI as this user, so `cre whoami` must show a logged-in account.

Nothing in this stack keeps the Mac awake: sleep is the maintainer's (his Pauline app owns `pmset disablesleep`). While the Mac sleeps the stack pauses and the pools fall back as 8.6 describes; the outage is recorded, and every job resumes on wake.

### 8.4 Check and stop

```bash
cd bots && bun run live:status          # exit 0: healthy; exit 1 lists each PROBLEM (a job not running included)
cd bots && bun run live:gas             # docs/evidence/gas-robinhood-testnet.json (gas per transaction and the desk's cadence)
cd bots && bun run live:cost-doc        # docs/integrate/README.md "Gas and cost", from that file (--check: compare only)
cd bots && bun run live:verify          # docs/evidence/live-check-<date>.json, PASS/FAIL per check
cd bots && bun run live:outages         # one pass of the outage record now (the outages job runs one every 5 minutes)
launchctl kickstart -k gui/$(id -u)/fi.clim-fables.runner   # restart one job now
cd bots && bun run live:uninstall       # stop every job and remove the plists (nothing comes back at login)
```

`pkill` does not stop a job: launchd starts it again 30 s later (`KeepAlive`). Stop with `bun run live:uninstall` (every job) or `bun run live:uninstall <name>` (one). The jobs' command lines contain `src/live/` (and the desk's child `sim-loop.sh rh-testnet-settings`); none of them matches the Sepolia v1 processes (`--pair live`, `staging-settings`), and the v1 shutdown patterns of section 3 match none of them.

### 8.5 Troubleshooting

- `desk report age > 90 s`: the CRE loop is down or failing; `bun run live:logs desk` and `bots/out/desk-sim/*.log` show why. Credential checks against the CRE API fail now and then (friction log row 24); the loop recovers by itself. After `tauKillSec` (180 s) without a report the policy is blind: the runner stops poking and pool D returns to its flat 7 bp when its last 600 s override ends (8.6).
- `desk report age` around 60 s, or `clim: no report (<n> s since the last report < 20 s)` in `desk.log`: two reports less than 20 s apart (the desk's `MIN_GAP`). The loop paces each run on the last report's `tObs` (the `pace:` line after each run), so this happens only on the first run after the desk job starts, which has no `tObs` to pace on yet (it reads the last one and the next run starts about 30 s after it). A slow CLI start-up (the `start-up <s> s` of the `pace:` line; 1 s on an idle Mac, up to 39 s measured under load) delays that run's report and never makes the next one fail.
- `D fee != last poke`: another FEE_POKER key poked D, or a poke reverted; `bots/out/runner-rh.jsonl` has the error (and, since 2026-10-14, each poke's `gasLimit`: its estimate plus 20 %). A restarted runner reads its last poked seq from ClimPoker's `Poked` events (the last 6,000 blocks) and never pokes that report again.
- `job <name> not running` or `bot <name> silent`: `bun run live:logs <name>` shows the last error; launchd restarts an exited job 30 s after its last start; `launchctl kickstart -k gui/$(id -u)/fi.clim-fables.<name>` restarts it now. `job <name> not loaded`: `bun run live:install <name>`.
- A job exits again at once (`last exit 1` in `live:status`): a key missing from `bots/.env`, the CRE CLI logged out (`cre login`), or a moved repository or tool (`bun run live:install`).
- RPC endpoint: every process and script of `bots/` (the runner, keeper, arbitrage and retail bots, the desk job's receipt reads, `live:status`, `live:verify`, `live:gas`, `live:outages`, `live:fund`) uses `RH_TESTNET_RPC_URL` from `bots/.env` when it is set, else the public `https://rpc.testnet.chain.robinhood.com`. The CRE workflow itself reads and writes through the URL in `cre/project.yaml`, which this variable does not change.
- The public RPC answers 429, or lags too often: set `RH_TESTNET_RPC_URL` in `bots/.env` to a keyed endpoint (an Alchemy Robinhood Chain testnet URL, for instance; never commit it), then restart the jobs so they read it: `for j in desk runner keeper arb noise outages; do launchctl kickstart -k gui/$(id -u)/fi.clim-fables.$j; done`.
- The public RPC is load-balanced and some of its nodes lag the head by a few blocks. `live:status` and `live:verify` read 3 blocks behind the head and retry a failed read up to 3 times, 1 s apart; if one still fails (`BlockNotFoundError`, `Missing or invalid parameters`, `historical state not available`), run it again. The runner retries a `DeskBlind` revert of its `poke()` simulation that follows a fresh desk read 3 times, 2 s apart (`[runner] seq <n>: DeskBlind after a fresh read (a lagging RPC node), retry <k>/3 in 2 s` in `runner.log`), and logs a skip only if the revert persists.
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
