# clim lab

The research lab behind clim's parameters and numbers. It decides P\* before the hook is deployed, and it produces every figure the deck, the dashboard (`app/`) and the replay server (`bots/`) use. Everything is reproducible from the raw files in `lab/data/` (gitignored).

## Setup

```bash
cd lab
uv sync          # Python 3.12, numpy 2.5.3, pytest 9.1.1
uv run pytest    # 100 tests; the 7 that read lab/data/ (gitignored) and the figure test (needs matplotlib) skip: 92 passed, 8 skipped on a fresh clone
```

## Reproduce the outputs

```bash
uv run python -u scripts/decide_pstar.py   # out/pstar_decision.json and ../shared/params.json (about 2 min)
uv run python scripts/backtest_summary.py  # out/backtest-summary.json and out/summary.json
uv run python scripts/validate_model.py    # out/validation.json and out/ptrade-band.json
uv run python scripts/export_replay.py     # out/replay-2026-02-04.json and out/replay-window.json
```

The Fables comparison (see [below](#clim-vs-fables-keeper-11-september-2026)) has its own fetch step, which needs an Etherscan V2 key (the free tier is enough). The scripts read it from the `ETHERSCAN_API_KEY` environment variable or the `ETHERSCAN_API_KEY` line of `contracts/.env` (gitignored), never print it, remove `apikey=` from every URL they record, and refuse to finish if the key appears in any file under `data/fables/`.

```bash
uv run python scripts/fables_compare.py fetch   # Robinhood Chain logs (Etherscan V2, chain 4663, and the public RPC), Binance and Coinbase prices into data/fables/; keeps files already there (--refresh re-downloads)
uv run python scripts/fables_windows.py fetch   # Binance ETHUSDT 1 min klines, 2026-07-01 to 2026-10-07 08:38 UTC, for the window scan
uv run python scripts/fables_windows.py run     # out/fables-windows.json (window ranking, keeper shape)
uv run python scripts/fables_compare.py run     # out/fables-compare.json (reads out/fables-windows.json)
uv run --with "matplotlib>=3.9,<3.11" python scripts/fables_figure.py   # ../docs/media/fables-compare.png
```

Both `run` steps are offline. `fetch` only reads public endpoints and never sends a transaction.

`decide_pstar.py` refuses to change the `pStar` of a decided `shared/params.json` without `--force`: the hook's parameters are immutable, so a new P\* means a new hook and new pools. `--seed N --no-write` reruns the decision with another random seed without writing anything. The output schemas are pinned by `tests/test_outputs.py`; `docs/superpowers/plans/2026-10-06-clim-03-lab.md` lists who reads each file.

## What the lab models

- **The desk.** RV15 on closed 1-minute candles, exactly as the CRE workflow computes it, reported every 30 s, passed through the RiskDesk envelope (rise at most 2x, fall at most 20 % per report, bounds 10 % to 1000 %/yr), effective one 12 s block later.
- **The fee.** An integer mirror of `ClimFeeMath.feePips`: `clamp(ceil(sigmaE9 * etaE4 * sqrtHalfDtE6 * kE4 / 1e17), feeMinPips, feeMaxPips)`, with `etaE4 = round((1/P* - 0.824) * 1e4)`.
- **Arbitrage.** Fixed 12 s blocks, a myopic arbitrageur who moves the pool to the edge of the no-trade band `g = -ln(1 - fee)`. LVR, ARB (LP loss net of fees) and arbitrage fees are accounted per block.
- **Competition.** The clim pool against a static 5 bp pool four times deeper. Each block, Poisson retail orders (log-normal sizes) are split by an aggregator to minimise the trader's all-in cost. LP P&L is the sum of trade markouts against the market price (retail markout minus ARB). Retail intensity is calibrated so that a static 5 bp pool breaks even over the year.
- **The year.** One year of 1-minute closes bridged to 12 s blocks (Brownian bridge with Student-t innovations; on the Feb and Oct 1 s windows it reproduces the real ARB within about 10 %).
- **Why Chainlink.** The same fee formula fed by the pool's own RV15 captures most of the gain (`inpool.py`): CRE is there for robustness (venues that must agree, a report signed by the DON once it runs on one, no manipulation through trades against the pool), not for accuracy.
- **Validation.** P_trade predicted (Nezlobin-Tassy 2025: `1/(eta + 0.824)`) against observed, with Basel-style zones whose thresholds are simulated from the model, because arbitraged blocks cluster under the model itself.

## Data

| File | Content | Span (UTC) |
|---|---|---|
| `b1s_feb.csv` | Binance ETHUSDT 1 s closes, `unix_seconds,close` | 2026-02-03 to 2026-02-06 |
| `b1s_3d.csv` | same | 2026-10-03 to 2026-10-06 |
| `eth1m.json` | Binance ETHUSDT 1 min closes, `[[open_time_ms, close], ...]` | 2025-10-06 to 2026-10-06 |
| `dvol_3600_feb.json` | Deribit DVOL hourly candles | 2026-02-02 to 2026-02-07 |
| `dvol_1m_3d.json` | Deribit DVOL 1 min candles | 2026-10-03 to 2026-10-06 |
| `fables/*.json` | Fables ETH/USDG pool on Robinhood Chain: `FeePoked` (to the block at 2026-10-07 08:38 UTC), `PoolConfigured`, `PokeCleared`, `Initialize`, `Swap` in the study windows, poke senders, the keeper's code, block numbers, request log (key removed) | 2026-08-15 to 2026-10-07 |
| `fables/b1s_2026-09-11.csv`, `fables/b1s_2026-09-16.csv` | Binance ETHUSDT 1 s closes | 2026-09-11 11:40 to 16:30, 2026-09-16 16:00 to 20:50 |
| `fables/binance_1m_scan.json` | Binance ETHUSDT 1 min closes, `[[open_unix_seconds, close], ...]` | 2026-07-01 to 2026-10-07 08:37 |
| `fables/coinbase_*.json` | Coinbase ETH-USD and USDT-USD 1 min closes | 2026-09-11 |

Sources: Binance `GET /api/v3/klines` (intervals `1s` and `1m`, symbol `ETHUSDT`) and Deribit `public/get_volatility_index_data` (currency `ETH`). For `fables/`: Etherscan V2 `getLogs` and `getblocknobytime` (chain 4663), the Robinhood Chain RPC (`https://rpc.mainnet.chain.robinhood.com`), Sourcify, and Coinbase `GET /api/v3/brokerage/market/products/{product}/candles`.

## clim vs Fables' keeper (11 September 2026)

![11 September 2026, 12:30 to 16:30 UTC: Fables' keeper fee rebuilt from its on-chain logs, against clim's rule in the lab model, with Binance RV15](../docs/media/fables-compare.png)

**Headline.** On 11 September 2026, 12:30 to 16:30 UTC, Fables' keeper fee on its ETH/USDG pool (Robinhood Chain) averaged 43.7 bp and sat at its 60 bp cap 42 % of the time. That fee is measured on-chain: it matches the fee paid by all 1,820 swaps. At the same average fee, the lab's arbitrage model has clim's rule (12 s blocks) losing 9.8 % more to arbitrage than the keeper's fee path. The keeper's edge is one poke: its 60 bp cap in the same second as the US CPI release (12:30:00 UTC), while clim's desk still read 48 %/yr (5.3 bp). The gap comes entirely from the next 15 minutes. Delay the keeper's pokes by 30 s, or start the window after the 12:30:12 block, and clim's rule loses 5 to 10 % less than the keeper at the same average fee. The keeper is not a flat fee with occasional overrides: over 30 days its fee correlates 0.83 with RV15.

**Method, in three lines.**
1. Fables' fee is rebuilt from the hook's `FeePoked` and `PoolConfigured` logs with its verified rule (`clim_lab/fables.py`) and checked against the fee every `Swap` log paid.
2. clim's fee is the lab's re-implementation of the desk (Binance-only 1 s ETHUSDT, RiskDesk envelope, 30 s reports, 12 s latency) and the shipped rule at Δt = 12 s (Ethereum) or 1 s.
3. LP loss is the lab's myopic-arbitrageur model on the same price path for both fees, as charged and, the only comparison of shapes, with clim's k rescaled (lab-only: k is immutable in a deployed hook) to the keeper's average fee.

**Numbers** (`out/fables-compare.json`, `out/fables-windows.json`). ARB is the LP loss to arbitrage net of fees, a model result in USD per $1M of full-range-equivalent liquidity. "Equal average" is clim's ARB at the keeper's average fee against the keeper's ARB: positive when clim loses more.

| Window (UTC) | Δt | Keeper fee, mean (time at cap) | clim fee, mean | ARB keeper / clim | Equal average | Same, inside Fables' 3.5 to 60 bp |
|---|---|---|---|---|---|---|
| 09-11 12:30-16:30, CPI | 12 s | 43.7 bp (42 %) | 16.1 bp | $35.37 / $56.11 | +9.8 % | +11.6 % |
| 09-11 12:30-16:30, CPI | 1 s | 43.7 bp (42 %) | 6.0 bp | $17.60 / $39.23 | +3.5 % | +6.0 % |
| 09-16 16:50-20:50, FOMC | 12 s | 29.8 bp (28 %) | 10.5 bp | $11.80 / $28.72 | +10.6 % | +11.2 % |
| 09-16 16:50-20:50, FOMC | 1 s | 29.8 bp (28 %) | 5.2 bp | $4.51 / $25.51 | +63.9 % | +62.0 % |

| Sensitivity, equal average (12 s unless stated) | 09-11 CPI | 09-16 FOMC |
|---|---|---|
| As measured | +9.8 % | +10.6 % |
| Keeper pokes 12 s late | +9.8 % | +6.4 % |
| Keeper pokes 30 s late | -10.5 % (1 s: -8.5 %) | -6.3 % (1 s: +51.3 %) |
| Keeper pokes 60 s late | -14.6 % | not run |
| Window starts 12:30:24 / 12:45 / 13:00 | -4.8 / -7.4 / -7.5 % (inside Fables' bounds: +1.2 / +1.5 / +1.8 %) | not applicable |

- **Where the gap sits.** On 09-11 at 12 s, $4.50 of gap falls between 12:29 and 12:45 and -$1.05 over the rest of the window ($3.46 in total). On 09-16 at 1 s, $2.67 of the $2.88 gap falls between 17:59 and 18:15: the keeper poked its cap at 17:59:00, one minute before the FOMC statement, so a 30 s delay does not remove its edge there.
- **Deployed as-is on Robinhood Chain** (0.1023 s blocks, measured), clim's shipped rule would charge its 5 bp floor all window, below Fables' 7 bp flat fee: it leaves the floor only above 495 %/yr, and the window peaked at 446 %/yr.
- **At actual fee levels** the keeper charged 2.7 times clim's modelled fee. In this model a higher fee always lowers ARB, so that row says nothing about which fee is better once traders react.
- **The window scan** (`scripts/fables_windows.py`, Binance 1 min closes from 2026-07-01 through 2026-10-07 08:37 UTC): 09-11 is the highest 4 h mean RV15 (146.9 %/yr) since the keeper's first poke (2026-08-23 18:19 UTC) and rank 2 overall. The higher window predates the ETH/USDG pool. On the next keeper-live windows only the fee levels were compared: keeper vs clim (12 s) 21.8 vs 10.8 bp on 09-04, 27.4 vs 10.1 on 09-15, 30.3 vs 9.9 on 09-18. ARB was not run on them.
- **The keeper's shape** (30 days under its current config): median fee 7 bp below 40 %/yr RV15, 18.5 bp at 60 to 80, 29.4 at 80 to 100, 47.7 at 100 to 150, and the 60 bp cap above 150 %/yr. One externally owned account sends every poke, mostly on minute boundaries, each with a 2 h TTL.

**Caveats.**
- Fables' fee is measured; clim's is a model. clim's desk did not exist on 11 September, so the clim line is the lab's re-implementation of the desk on Binance-only prices, not CRE output. CRE lists Robinhood Chain as Robinhood Testnet only, so neither clim nor CRE runs on Robinhood Chain mainnet today.
- The 12 s and 1 s block times are modelling choices. The right effective Δt for a first-come, first-served L2 is unknown, and at the chain's real block time the shipped rule sits at its floor.
- The arbitrage model is myopic and gas-free, with no retail flow and no volume response to fees. The 1.29 to 1.33 observed-to-model ratio (`out/summary.json`) was measured on 12 s backtests of Binance data and does not transfer to Robinhood Chain's 0.1 s blocks, which are ordered first-come, first-served with no fee priority ([Robinhood Chain docs](https://docs.robinhood.com/chain/#predictable-transaction-ordering)).
- Two 4 h windows, each driven by a scheduled event ([BLS CPI schedule](https://www.bls.gov/schedule/news_release/cpi.htm), [FOMC statement](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm)): not a statistical result.
- The keeper's logic is off-chain and unknown; we see only its pokes.
- The pool is ETH/USDG and the price is ETHUSDT. Coinbase USDT-USD stayed within 0.99949 to 0.99980 over the window; USDG/USD was not checked.
- Fables LPs' realized losses are not measured.

**What it means.** The keeper anticipates scheduled macro events: its cap was in place when the CPI print and the FOMC statement hit, and clim's 15-minute measure, with 30 s reports and 12 s latency, lags the first minutes of a shock. Outside those minutes the two shapes are close: on 09-11 clim's loses 5 to 7.5 % less uncapped but 1 to 2 % more inside Fables' bounds, and on 09-16 the keeper keeps a small edge. So clim's case against a keeper is not a lower loss in this model. It is a public, checkable rule fed by four exchanges through CRE, instead of one private key: anyone can recompute the fee from the formula and the sigma on-chain, while Fables' fee is posted by one externally owned account running logic nobody can see. That holds fully once the desk runs on a DON and ownership is renounced; today clim's desk is also written by a single operator key (root README, "What's live vs. simulated"). The two can combine: the keeper keeps its event overrides on top of the desk's measured baseline. That is the README Roadmap's shadow mode: clim first publishes its fee next to the keeper's, then the keeper reads `RiskDesk.state()`.

## Limits

- One price path per window and a frictionless, gas-free arbitrageur; the model underestimates the severity of arbitrage (ARB/LVR above the closed form), only the frequency holds within about 10 %.
- The LP P&L depends on the retail model: with large orders relative to pool depth, or an equally deep competitor, P\* = 0.2 beats P\* = 0.3 (see `year.sensitivity` in `out/pstar_decision.json`).
- The year sample is bridged from 1-minute data, not observed at 12 s.

`scratch/` holds the exploration scripts written during the hack before this package existed. They are kept for provenance; nothing imports them.

## clim × Fables studies (Robinhood Chain, 2026-09-07 to 2026-10-12)

Raw data (gitignored, re-downloadable, read only):

    uv run python scripts/fables_fetch.py blocks        # block-time samples; then check-clock must PASS
    uv run python scripts/fables_fetch.py check-clock
    uv run python scripts/fables_fetch.py logs          # needs ETHERSCAN_API_KEY (env or contracts/.env)
    uv run python scripts/fables_fetch.py binance
    uv run python scripts/fables_fetch.py usdt

The swap history comes from fables-farming's download (`FABLES_HISTORY_DIR`, default
`~/Development/projects/fables-farming/data/history/0xbac3aa3b`).

Studies (offline), in order:

    uv run python scripts/study_dt.py               # lab/out/fables-dt-eff.json
    uv run python scripts/study_window.py           # lab/out/fables-window.json
    uv run python scripts/study_direction.py        # lab/out/fables-direction.json
    uv run python scripts/decide_fables_params.py   # shared/params-fables.json

What each one answers:

1. **Effective arbitrage interval.** Robinhood Chain makes a block every ~0.1 s; arbitrageurs do not trade every
   block. Δt is solved from the observed arbitrage rate (MMR 2023 with c = 1, Nezlobin-Tassy 2025 with c = 0.824),
   fitted on three weeks and checked on the next two, with the venue-exit-to-arbitrage delays as a second estimate.
2. **Volatility window.** 5 or 15 minutes, at the same average fee as Fables' keeper: correlation with the keeper
   and arbitrage loss on a 1 s grid, published as measured.
3. **Per-direction signal.** Whether the venue-versus-pool gap the desk can publish every 30 s predicts flow that
   beats the fee (markouts at 5, 30 and 300 s). The premium rule is enabled only if it clears a stated gate.
