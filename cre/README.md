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
