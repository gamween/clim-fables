<div align="center">

# ⛈️ clim × Fables

**A verifiable volatility desk for Fables' dynamic fees on Robinhood Chain: a Chainlink CRE workflow measures ETH volatility and the venue-versus-pool price gap on four exchanges, and `ClimPoker` turns it into Fables' `pokeFee` calls, inside Fables' own bounds and under Fables' own AccessManager.**

[![CI](https://github.com/gamween/clim-fables/actions/workflows/ci.yml/badge.svg)](https://github.com/gamween/clim-fables/actions/workflows/ci.yml)
[![Robinhood Chain testnet](https://img.shields.io/badge/Robinhood%20Chain-testnet%20(46630)-0b8a5f?style=flat-square)](https://explorer.testnet.chain.robinhood.com/address/0x63f543430982685387C83e4ec55E5a26fd1371Ef)
[![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE%20workflow-375bd2?style=flat-square)](cre/)
[![Uniswap v4](https://img.shields.io/badge/Uniswap%20v4-hook-ff007a?style=flat-square)](contracts/src/v2/PokeFeeHook.sol)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.26%20%C2%B7%20Foundry-363636?style=flat-square)](contracts/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

**Showcase by clim, not affiliated with Fables · Continued from TOKEN2049 Origins, Singapore, October 2026**

**[Verify in 10 minutes](#verify-in-10-minutes)** · **[Integrate](docs/integrate/README.md)** · **[Security](docs/security.md)** · **[Runbook](docs/runbook.md)** · **[Evidence](docs/evidence/)** · **[Lab](lab/README.md)**

</div>

## What it is

Fables' ETH/USDG pool on Robinhood Chain charges a flat fee, and Fables' keeper replaces it with an override posted
through the hook's `pokeFee`. The keeper is good: at equal average fee the lab finds clim's rule and the keeper
comparable, and the results below say where the keeper does better. clim does not offer better fees. It offers:

1. **Verifiability.** A public baseline recomputed every 30 s from four exchanges (Coinbase, Kraken, Binance,
   Hyperliquid), written by a Chainlink CRE workflow, with a fee formula anyone can recompute from the chain.
2. **Redundancy.** Fables' event overrides stay on top: `ClimPoker` sends `max(clim's fee, Fables' event fee)`. clim
   is a floor and a fallback, never a replacement, and a silent desk means no poke at all.
3. **The external mid.** The gap between the venues' price and the pool's, per swap direction: the input Fables'
   per-direction hooks need, which is not visible on-chain.
4. **Transparency for LPs.** A live desk anyone can read.

```
Coinbase · Kraken · Binance · Hyperliquid
              │
  Chainlink CRE risk desk, every 30 s, Robinhood Chain testnet (46630)
              │ report (KeystoneForwarder on a DON; the mock forwarder in simulation today)
              ▼
  RiskDeskV2: sigma over 5 and 15 min, venue mid against pool mid, guards
              │
  ClimFeePolicy: quote() / quoteDirectional(), immutable parameters from the lab
              │
   ┌──────────┼──────────────────────────────┐
   ▼          ▼                              ▼
 Level 0    Level 1                        Level 2
 Shadow     Fables' keeper reads           ClimPoker, governed by Fables' AccessManager:
            ClimFeePolicy over RPC         fee = max(policy, keeper's event override)
            and composes                   -> pokeFee(poolId, fee, ttl) on Fables' hook
```

## The integration ladder

| Level | Fables' work | Risk to Fables |
|---|---|---|
| 0. Shadow | None: clim reads Fables' live pool and publishes its recommendation next to the keeper's overrides | None |
| 1. Keeper input | A few lines in the off-chain keeper: [`docs/integrate/keeper-read.ts`](docs/integrate/keeper-read.ts) reads `ClimFeePolicy.quote()` / `quoteDirectional()` and composes with `max` | No contract touched |
| 2. On-chain adapter | One AccessManager batch, revocable in one call: [`docs/integrate/level2-batch.fork.json`](docs/integrate/level2-batch.fork.json) | Bounded by the hook's own floor, cap and TTL; only the roles Fables grants can call `ClimPoker`; clim holds no admin power |

The exact keeper diff, the batch calldata, its revocation, the path to mainnet and the measured gas and cost are in
[`docs/integrate/README.md`](docs/integrate/README.md).

## Verify in 10 minutes

1. **The code is verified.** Every contract clim deployed on Robinhood Chain testnet is verified on Sourcify and
   Blockscout (`contracts/script/v2/verify-live.sh`):

   | Contract | Address | Blockscout | Sourcify |
   |---|---|---|---|
   | `RiskDeskV2` | `0x63f543430982685387C83e4ec55E5a26fd1371Ef` | [code](https://explorer.testnet.chain.robinhood.com/address/0x63f543430982685387C83e4ec55E5a26fd1371Ef?tab=contract) | [match](https://repo.sourcify.dev/46630/0x63f543430982685387C83e4ec55E5a26fd1371Ef) |
   | `ClimFeePolicy` | `0x5f140A5e17826CFcEeeD7cD3FcAe4D56c9e0C519` | [code](https://explorer.testnet.chain.robinhood.com/address/0x5f140A5e17826CFcEeeD7cD3FcAe4D56c9e0C519?tab=contract) | [match](https://repo.sourcify.dev/46630/0x5f140A5e17826CFcEeeD7cD3FcAe4D56c9e0C519) |
   | `ClimPoker` | `0x99d6c4F74A2ad09471b1B4fd1F0aC68B099cbE07` | [code](https://explorer.testnet.chain.robinhood.com/address/0x99d6c4F74A2ad09471b1B4fd1F0aC68B099cbE07?tab=contract) | [match](https://repo.sourcify.dev/46630/0x99d6c4F74A2ad09471b1B4fd1F0aC68B099cbE07) |
   | `PokeFeeHook` (pools D, K, F) | `0xBb4afdfd08921e0731199e565eC11724B09b9080` | [code](https://explorer.testnet.chain.robinhood.com/address/0xBb4afdfd08921e0731199e565eC11724B09b9080?tab=contract) | [match](https://repo.sourcify.dev/46630/0xBb4afdfd08921e0731199e565eC11724B09b9080) |
   | `AccessManager` (OpenZeppelin) | `0x61859758b20441995FCDb8b8BC144B1eBEeC2e3E` | [code](https://explorer.testnet.chain.robinhood.com/address/0x61859758b20441995FCDb8b8BC144B1eBEeC2e3E?tab=contract) | [match](https://repo.sourcify.dev/46630/0x61859758b20441995FCDb8b8BC144B1eBEeC2e3E) |
   | tETH, tUSDG (test tokens) | `0x0Ffb9c4d2feCc89750b68B961d6eb05F953d864b`, `0xcB2498949AC0c2473a06199e24f2c5062b665A19` | [tETH](https://explorer.testnet.chain.robinhood.com/address/0x0Ffb9c4d2feCc89750b68B961d6eb05F953d864b?tab=contract), [tUSDG](https://explorer.testnet.chain.robinhood.com/address/0xcB2498949AC0c2473a06199e24f2c5062b665A19?tab=contract) | [tETH](https://repo.sourcify.dev/46630/0x0Ffb9c4d2feCc89750b68B961d6eb05F953d864b), [tUSDG](https://repo.sourcify.dev/46630/0xcB2498949AC0c2473a06199e24f2c5062b665A19) |
   | Uniswap v4 test routers (swap, arbitrage, liquidity) | `0xF111FB02b35e9201576D6AFaAa29d67A620E1628`, `0x70856584d9d8ADDB653aBb1786E37C505665ce51`, `0xCDbfd6b9C0b97A8eE31706c6CDE5E54B4954334F` | [swap](https://explorer.testnet.chain.robinhood.com/address/0xF111FB02b35e9201576D6AFaAa29d67A620E1628?tab=contract), [arbitrage](https://explorer.testnet.chain.robinhood.com/address/0x70856584d9d8ADDB653aBb1786E37C505665ce51?tab=contract), [liquidity](https://explorer.testnet.chain.robinhood.com/address/0xCDbfd6b9C0b97A8eE31706c6CDE5E54B4954334F?tab=contract) | [swap](https://repo.sourcify.dev/46630/0xF111FB02b35e9201576D6AFaAa29d67A620E1628), [arbitrage](https://repo.sourcify.dev/46630/0x70856584d9d8ADDB653aBb1786E37C505665ce51), [liquidity](https://repo.sourcify.dev/46630/0xCDbfd6b9C0b97A8eE31706c6CDE5E54B4954334F) |

   All ten in one command: `jq -r '.verify[].address' shared/deployments/robinhood-testnet.json | while read a; do echo "$a $(curl -s https://sourcify.dev/server/v2/contract/46630/$a | jq -r .match)"; done` prints `match` for each.

2. **The live desk, one read.** The desk's state (observation time, sigma over 15 and 5 minutes per sqrt-second x
   1e9, venue-minus-pool gap in pips, multiplier, flags, report counter):

   ```bash
   cast call 0x63f543430982685387C83e4ec55E5a26fd1371Ef "state()(uint40,uint32,uint32,int32,uint16,uint8,uint32)" --rpc-url https://rpc.testnet.chain.robinhood.com
   ```

   The fee it implies, per direction, and the mode (0 normal, 1 degraded, 2 blind):
   `cast call 0x5f140A5e17826CFcEeeD7cD3FcAe4D56c9e0C519 "quoteDirectional()(uint24,uint24,uint8)" --rpc-url https://rpc.testnet.chain.robinhood.com`.
   The level 1 reader does both at one block: `bun install && bun docs/integrate/keeper-read.ts`.

3. **Against Fables' real hook.** The fork suites run on a fork of Robinhood Chain mainnet pinned to block
   87,780,000, against Fables' deployed ETH/USDG hook and AccessManager, with Fables' admin impersonated (nothing is
   sent to mainnet):

   ```bash
   git submodule update --init --recursive
   cd contracts && RH_MAINNET_RPC_URL=<an archive RPC for chain 4663> forge test --match-contract 'FablesForkTest|Level2BatchForkTest'
   ```

   Expected: `20 tests passed, 0 failed, 0 skipped`. They cover the poke within the hook's bounds, the TTL falling
   back to Fables' flat fee, the blind desk, the composition with an event override, who may poke, a swap paying the
   poked fee, a lowered hook cap, and the level 2 batch's exact calldata and its revocation.

4. **The recorded fork run.** [`docs/evidence/fork-run-2026-10-07.json`](docs/evidence/fork-run-2026-10-07.json):
   the 7 October 2026 storm replayed on a mainnet fork against Fables' real hook, every poke, `currentFee` and swap
   fee recorded (`npm run demo:fork` reruns it). Its summary:
   `jq -c '{sigmaEstimator, etaE4, forkBlock, pokes: (.pokedPips | length), minPokedPips: (.pokedPips | min), maxPokedPips: (.pokedPips | max), swaps: (.swapFeePips | length), swapReverts}' docs/evidence/fork-run-2026-10-07.json`.

5. **The live loop.** Pools D (driven by `ClimPoker`), K (a keeper-style bot imitating the pattern observed on
   Fables' pool, not Fables' code) and F (flat 7 bp) trade against real venue prices on testnet;
   [`docs/evidence/live-check-2026-10-14.json`](docs/evidence/live-check-2026-10-14.json) is the on-chain check of
   the loop (`cd bots && bun run live:verify` reruns it over the last 18,000 blocks).

6. **The results, as measured.** [Below](#results-as-measured), verbatim from the lab's outputs.

7. **The threat model.** [`docs/security.md`](docs/security.md): every failure mode with the fee that results and the
   test that proves it.

8. **How it runs.** [`docs/runbook.md`](docs/runbook.md), section 8: the live stack, its supervision and its outages.

## What is live and what is simulated

| Piece | Status |
|---|---|
| `RiskDeskV2`, `ClimFeePolicy`, `ClimPoker`, `PokeFeeHook`, pools D, K, F | Live on Robinhood Chain testnet (46630), verified |
| The CRE desk | The CRE simulator (`cre workflow simulate --broadcast`), one node, on the maintainer's Mac under launchd; reports go through the `MockKeystoneForwarder` with clim's operator key, and the desk accepts them only from that key while `simMode` is on. DON deploy access is pending |
| Arbitrage, retail and keeper-style bots | Live on testnet, with test tokens (tETH, tUSDG) and no value at stake |
| Fables' mainnet pool | Read only. Actions against Fables' contracts happen on a mainnet fork |
| A desk on Robinhood Chain mainnet | Not yet: CRE writes to `robinhood-testnet` only today; moving the desk is a configuration change ([`docs/integrate/README.md`](docs/integrate/README.md#honest-status-and-the-path-to-mainnet)) |

## Results, as measured

Lab studies on Fables' ETH/USDG pool, 2026-09-07 to 2026-10-12, quoted from the `framing` field of each output:

- Effective arbitrage interval ([`lab/out/fables-dt-eff.json`](lab/out/fables-dt-eff.json)): "dt_eff is of order 1 to 3 s; the per-hour estimate is very sensitive to the band (a 1 bp shift in the reference price moves weeks 4-5 from ~13 s to ~3-4.5 s). clim's posted fee does not depend on dt: eta is calibrated at equal average fee, so only eta*sqrt(dt/2) matters."
- Volatility window ([`lab/out/fables-window.json`](lab/out/fables-window.json)): "At equal time-average fee, clim's 5-minute rule and the keeper are comparable: -4.4 % arbitrage loss with arbitrage every second, +4.6 % every 15 s; clim charges 11.96 bp per dollar traded vs the keeper's 10.77 bp. Not a claim of better fees."
- Volatility estimator ([`lab/out/fables-estimator.json`](lab/out/fables-estimator.json)): "binance-1s scored best in-sample by 1.09 points on a simulator driven by the same Binance path; it is excluded because the desk must not depend on one venue (spec §3); venue-range is the best multi-venue estimator."
- Per-direction signal ([`lab/out/fables-direction.json`](lab/out/fables-direction.json)): "Trades toward the venue capture the stale pool's gap (signal correlates 0.93 with the pre-trade gap and 0.04 with the later move); the premium rule clears its gate on the five weeks pooled but in only 3 of 5 weeks; measured, experimental, not deployed on ETH/USDG (its hook is symmetric)."

The decided parameters are in [`shared/params-fables.json`](shared/params-fables.json). The studies rerun from
[`lab/README.md`](lab/README.md) (the raw data is re-downloadable with the fetch scripts; the swap history comes
from a separate download the README names).

## Repository

| Path | What it is |
|---|---|
| [`contracts/`](contracts/) | Foundry. clim × Fables in `src/v2/` (`RiskDeskV2`, `ClimFeePolicy`, `ClimPoker`, `PokeFeeHook`); tests in `test/v2/` and `test/fork/`; deployment scripts in `script/v2/` |
| [`cre/`](cre/) | The Chainlink CRE workflow (TypeScript SDK), targets `rh-testnet-settings`, `rh-shadow-settings`, `rh-production-settings` |
| [`bots/`](bots/) | The live stack: desk loop recorder, runner, keeper-style bot, arbitrage and retail bots, status, gas and checks |
| [`shared/`](shared/) | Deployments, parameters, ABIs and typed loaders used by every package |
| [`lab/`](lab/) | Python (uv): the studies on Fables' pool and their outputs in `lab/out/` |
| [`docs/`](docs/) | [`integrate/`](docs/integrate/README.md), [`security.md`](docs/security.md), [`runbook.md`](docs/runbook.md), [`evidence/`](docs/evidence/), the design spec and plans in `superpowers/`, session logs in `sessions/` |

Run every test (no secret needed; the fork suites skip without an RPC):

```bash
git submodule update --init --recursive
(cd contracts && forge test && forge fmt --check)
(cd lab && uv run --frozen pytest -q)
bun install --frozen-lockfile && bun run test && bun run typecheck
(cd cre/risk-desk && bun install --frozen-lockfile && bun test && bun run typecheck)
```

CI runs the same commands on every push ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Origin

clim was built solo in 36 hours at [TOKEN2049 Origins](https://www.token2049.com/singapore/2049-origins)
(Singapore, 6 to 8 October 2026) by Sofiane Ben Taleb, a member of DeVinci Blockchain (Paris): a Chainlink CRE risk
desk and a Uniswap v4 hook on Ethereum Sepolia. The submitted state is frozen at
[DVB-ANS/clim @ token2049-submission](https://github.com/DVB-ANS/clim/tree/token2049-submission). This repository
continues it for Fables' pools on Robinhood Chain, as a showcase not affiliated with Fables.

## License

[MIT](LICENSE) © 2026 Sofiane Ben Taleb, for clim's own code. Third-party code keeps its own license:

- `contracts/src/receiver/` and `contracts/test/fixtures/sports-resolution/`: copied from
  [smartcontractkit/cre-templates](https://github.com/smartcontractkit/cre-templates) `d0223f3`, MIT © 2025
  SmartContract (one word changed in `ReceiverTemplate.sol`, commented in place); each folder has its `LICENSE`.
- The `contracts/lib/` submodules keep their own licenses: forge-std is MIT or Apache-2.0, OpenZeppelin's code is
  MIT, Uniswap v4-core is MIT for the interfaces and libraries clim imports, BUSL-1.1 for `PoolManager` and some
  internal libraries, and UNLICENSED for its `src/test` routers. clim's testnet routers are v4-core's unmodified
  `PoolSwapTest` and `PoolModifyLiquidityTest`, compiled from the submodule, used on testnet only.
- Fables' contracts are not in this repository: clim uses only their published ABI.
- `app/` (the TOKEN2049 dashboard) lists its third-party components in
  [`app/THIRD_PARTY_NOTICES.md`](app/THIRD_PARTY_NOTICES.md).
- npm dependencies keep their own licenses, including `@chainlink/cre-sdk` (BUSL-1.1).
