# clim 01 · Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test and deploy to Ethereum Sepolia the on-chain half of clim: `RiskDesk` (receives the CRE report), `ClimHook` (Uniswap v4 dynamic-fee hook), the test tokens and the twin pools V/S, then publish addresses and ABIs to `shared/`.

**Architecture:** A Foundry project in `contracts/` inside the clim monorepo. `RiskDesk` extends Chainlink's `ReceiverTemplate` (copied from `smartcontractkit/cre-templates`) and keeps one packed slot `(tObs, sigmaE9, kE4, flags, seq)` behind freshness, quorum, envelope and `tx.origin` checks. `ClimHook` extends OpenZeppelin `BaseOverrideFee` and returns `ClimFeeMath.feePips(...) | OVERRIDE_FEE_FLAG` on every swap, raised to `feeSafePips` when the desk is blind or degraded. Deploy scripts write one JSON fragment per step to `contracts/deployments/<chainId>/`; `05_WriteDeployments` checks everything on-chain and merges the fragments into `shared/deployments/sepolia.json`, in the schema plan 04 validates.

**Tech Stack:** Foundry 1.4.2 (forge, cast, anvil), Solidity 0.8.26 with `evm_version = cancun`, OpenZeppelin uniswap-hooks v1.2.1 (which pins Uniswap v4-core `d153b04`, v4-periphery `7ebd04b`, OpenZeppelin Contracts 5.5.0), forge-std v1.17.0, Chainlink cre-templates `ReceiverTemplate` at commit `d0223f3`, jq, python3.

---

## Read this first

Every code block below was compiled and run before this plan was written (scratch project, same pins, same files). Results: 69 unit and integration tests pass, plus 2 fork tests against the real Sepolia `MockKeystoneForwarder` (76 on 2026-10-07: 73 offline plus 3 Sepolia fork tests, after `contracts/test/ReceiverTemplateMetadata.t.sol` was added in `57933bc`). The deploy scripts 00 to 05 ran end to end on an anvil fork of Sepolia for the live, replay and DON suites (re-run in the fixer pass with the `TestToken` faucet, the `SIM_OPERATOR` option, 100,000 tETH per pool and the `ok` error guard below). A report delivered through the real mock forwarder moved `quoteFee()` from `(3000, 2)` to `(526, 0)`, and the swaps then paid 526 pips on V and the static fee on S. If reality differs, change this plan and log the difference in `docs/sessions/2026-10-06.md` (repo rule: living docs).

### Units and the fee (canonical, do not change)
- `sigmaE9` = volatility per square-root second × 1e9 = annual σ / √31,536,000 × 1e9, rounded to the nearest integer. Examples: 10 %/yr = 17,807; 48 % = 85,475; 100 % = 178,072; 225 % = 400,663; 300 % = 534,217.
- Pips: 1 pip = 1e-6, 1 bp = 100 pips, `MAX_LP_FEE` = 1,000,000.
- `fee_pips = clamp(ceil(sigmaE9 · etaE4 · sqrtHalfDtE6 · kE4 / 1e17), feeMinPips, feeMaxPips)`. The product is at most 2^112, so it cannot overflow.
- `etaE4 = round((1/P* − 0.824) × 1e4)` (spec §2.3: the constant |ζ(1/2)|/√π = 0.8239168 rounded to 0.824). This gives **41,760 at 20 % and 25,093 at 30 %**, the values the lab writes to `shared/params.json` and the values every test of this plan uses. The old P\* = 10 % vector keeps 91,761 (exact constant), as in spec §2.4. The hook takes whatever the lab writes to `shared/params.json`; plan 04's `parseParams` accepts ±1.
- `sqrtHalfDtE6` = √(12 s / 2) × 1e6 = 2,449,490 on Sepolia.
- **Rounding fix:** the design note's "48 %/yr → 1,921 pips" used floor. The canonical formula uses ceil, which gives **1,922**. The 25 %/yr check (1,001) is consistent with ceil.
- Modes returned by `quoteFee()`:
  - 0 normal;
  - 1 degraded: `flags & 1`, venue dispersion above 25 bp, fee = `max(fee, feeSafePips)`;
  - 2 blind: `tObs == 0`, or `block.timestamp > tObs + tauKillSec`, fee = `max(fee, feeSafePips)`.
  - Blind takes precedence over degraded. The comparison is written so that a `tObs` up to 30 s in the future cannot underflow.

### How a fee changes on a live pool (the mentor's question, answered by this code)
- A v4 pool's fee mode and hook are part of its `PoolKey`, hashed into the `PoolId` at `initialize`. A static-fee pool can never become dynamic.
- On a dynamic-fee pool (`fee = 0x800000`), only `key.hooks` can act on the fee: `PoolManager.updateDynamicLPFee` reverts with `UnauthorizedDynamicLPFeeUpdate` for anyone else, and `beforeSwap` can return a per-swap override flagged with `0x400000`.
- `ClimHook` uses the override. No transaction ever "sets" the fee: each swap recomputes it from `RiskDesk.state()`. The `fee` field of PoolManager's `Swap` event shows the fee charged; the Sepolia `protocolFeeController` is `0x0`, so this field is the LP fee.

### What the Sepolia mock forwarder really does (verified on a fork in Task 6)
- `MockKeystoneForwarder.report()` is permissionless and skips signature checks.
- It calls `onReport` through `this.route(...)`, so the receiver sees `msg.sender` = the mock and `tx.origin` = the EOA that sent the transaction. The `simOperator` guard therefore works.
- When `onReport` reverts, `report()` does **not** revert. It emits `ReportProcessed(receiver, executionId, reportId, false)`.
  - A successful broadcast tx does not mean the desk accepted the report.
  - The evidence of acceptance is a `RiskReported` event, or `state().seq` increasing.
- The metadata passed to `onReport` is `rawReport[45:109]` = 64 bytes. The `ReceiverTemplate` variant in `starter-templates/sports-resolution` checks for 62 bytes, so it rejects every report as soon as an identity check is set. clim copies the `circuit-breaker` variant, which has no length check (friction log row added in Task 6).

### Pinned dependencies

| What | Pin | Why |
|---|---|---|
| `OpenZeppelin/uniswap-hooks` | tag `v1.2.1` = `acbd604c409a827f7f98c9517236da860c4fca1a` | Latest release. Import `@openzeppelin/uniswap-hooks/fee/BaseOverrideFee.sol`. Override `function _getFee(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData) internal virtual returns (uint24)`. It sets permissions `afterInitialize` (which reverts `NotDynamicFee()` on a static-fee key) and `beforeSwap`. |
| Uniswap v4-core (nested in uniswap-hooks) | `d153b048868a60c2403a3ef5b2301bb247884d46` | The only source difference from v4.0.0, the version deployed on Sepolia, is that `SwapParams` and `ModifyLiquidityParams` moved into `types/PoolOperation.sol`. The ABI is identical. |
| Uniswap v4-periphery (nested) | `7ebd04b161745b75ed0c24ba2df3bc7c25f65606` | Provides `HookMiner` at `src/utils/HookMiner.sol`, plus `LiquidityAmounts` and `IStateView`. |
| OpenZeppelin Contracts (nested) | `fcbae5394ae8ad52d8e580a3477db99814b9d565` (5.5.0) | `Ownable(initialOwner)`, `ERC20` and `Math`. |
| `foundry-rs/forge-std` | tag `v1.17.0` = `f3dae6e6ee381f25eb6a246f7da9b85c91a68219` | Latest tag. |
| `smartcontractkit/cre-templates` | commit `d0223f31182c76bc36b1cc9d47b13b18efcf2bf6`, path `starter-templates/circuit-breaker/circuit-breaker-ts/contracts/evm/src/{ReceiverTemplate,IReceiver,IERC165}.sol` (MIT) | This variant is used by five templates. Its `setForwarderAddress(0)` is allowed and emits `SecurityWarning`; the spec's trust section relies on this. |
| solc | 0.8.26, optimizer 200 runs, `evm_version = cancun`, `bytecode_hash = none` | Matches v4-core, and gives transient storage. No `via_ir`: the two places that hit "stack too deep" are split into helper functions. |

### Deviations from the canonical layout (explicit)
- `contracts/deployments/<chainId>/*.json` holds the per-step script outputs. The Sepolia files (`11155111/`) are committed; the anvil ones (`31337/`) are gitignored. `05_WriteDeployments` merges them into `shared/deployments/sepolia.json`.
- The ABI exporter lives at `contracts/script/export-abis.sh`, not `scripts/export-abis.sh`, so that `contracts/` keeps a single script folder. `contracts/script/smoke.sh` is an extra on-chain smoke test, used on the fork and on Sepolia.
- Tests use the subfolders `contracts/test/utils/` (fixtures), `contracts/test/fork/` (Sepolia fork test) and `contracts/test/fixtures/` (a params file for dry runs). Added on 2026-10-07 in `57933bc` for the CRE DevEx report: `contracts/test/ReceiverTemplateMetadata.t.sol`, which tests the unmodified sports-resolution `ReceiverTemplate` copied to `contracts/test/fixtures/sports-resolution/` (MIT) and holds a third Sepolia fork test outside `test/fork/`.
- `shared/params.json` gets two extra fields, written by the lab (plan 03): `staticFeePips` and `replayStaticFeePips`, the fees of the static pools S. Plan 04's `parseParams` ignores extra fields.
- The `SUITE` variable also accepts `don`: a desk alone, with the production KeystoneForwarder and simulation mode off, which plan 02 Task 13 asks for. It is recorded as `riskDesks.don`.
- The live and replay suites share **one** token pair (tETH/tUSD), as plan 04's deployments schema assumes. Spec §3.7 said rETH/rUSD; the integration pass of plan 00 already updated the spec, and Task 12 checks it. The PoolKeys stay distinct because `03_CreatePools` refuses `replayStaticFeePips == staticFeePips`.
- `00_Tokens` also deploys a second `PoolSwapTest`, used only by the arbitrage bot and recorded as `routers.arb` (plan 05 identifies arbitrage swaps by `Swap.sender == routers.arb`; plan 04's `fund` and `arb` approve and swap through it).
- `TestToken` has a public `faucet()` (10 tETH or 25,000 tUSD per address per hour) next to the owner-only `mint`, so judges can try the dashboard's `/swap` and `/lp` pages with their own wallet (Frontend scope upgrade, session log 2026-10-06). It is a testnet convenience: the bots and the pools are funded by the owner's `mint`.
- The replay desk has its own operator key (`cre/.env.replay`, Task 18), passed to `01_DeployDesk` as `SIM_OPERATOR`, so the live and replay CRE loops never send from the same key (nonces). The live and DON desks keep the deployer as `simOperator`.

### Environment
- `contracts/.env` (gitignored; forge loads it automatically) holds:
  - `PRIVATE_KEY`, the deployer and `simOperator` of every desk; plan 02 uses the same key as `CRE_ETH_PRIVATE_KEY`;
  - `SEPOLIA_RPC_URL`;
  - optionally `ETHERSCAN_API_KEY`.
- A variable set on the command line overrides `.env`. Dry runs use this to switch to the anvil key.
- Script variables:
  - `SUITE` = `live` | `replay` | `don` (default `live`);
  - `PARAMS_PATH` (default `../shared/params.json`); it must lie under `../shared/` or `./test/fixtures/`, the only read paths `foundry.toml`'s `fs_permissions` allow (any other path fails with `vm.readFile: the path ... is not allowed to be accessed for read operations`);
  - `INIT_ETH_USD` (whole dollars);
  - `LIQ_TETH` (whole tETH per pool, default 100,000: L ≈ 5.2e24 at $2,713, so a $2,000 order moves the price about 0.15 bp, measured 0.147 bp on a fork);
  - `MINT_TETH` (default 1,000,000) and `MINT_TUSD` (default 10,000,000,000);
  - `FORWARDER` (defaults: the mock forwarder, or KeystoneForwarder for `don`);
  - `SIM_OPERATOR` (`01_DeployDesk` only, default the deployer): the address allowed to send simulated reports to the new desk; Task 18 sets it to the replay operator.
- **Error guard for chained deploy scripts.** `forge script ... | grep ...` exits 0 even when the script fails (grep matches the `Error` line), so a plain `&&` chain would go on to the next script. Every chained deploy command below defines and uses:
  ```bash
  ok(){ out=$("$@" 2>&1); echo "$out" | grep -E "ONCHAIN EXECUTION COMPLETE|Error" || echo "$out" | grep -E "Script ran successfully"; ! echo "$out" | grep -q "Error"; }
  ```
  `ok forge script ...` prints the same lines as before (`ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.` for a broadcast, `Script ran successfully.` otherwise, or the `Error` lines) and fails as soon as the output contains `Error`, which stops the chain.
- Commands in this plan start with `cd ~/Development/hackathons/clim/...` because the shell's working directory resets between calls. Where a command uses `$PRIVATE_KEY` or `$SEPOLIA_RPC_URL` in the shell (cast, curl), it first runs `set -a && source .env && set +a`.

---

## File structure

| File | Responsibility |
|---|---|
| `contracts/foundry.toml` | Compiler and EVM settings, file-system permissions for `../shared` and `./deployments`, RPC aliases `sepolia` and `anvil` |
| `contracts/remappings.txt` | Import prefixes that all go through the uniswap-hooks submodule, so v4-core is compiled once |
| `contracts/.env.example` | Template for `contracts/.env` |
| `contracts/src/receiver/{ReceiverTemplate,IReceiver,IERC165}.sol` | Vendored Chainlink receiver (MIT, unmodified) |
| `contracts/src/interfaces/IRiskDesk.sol` | `state()`, the `RiskReported` event, and the `FLAG_DEGRADED` / `FLAG_REPLAY` constants |
| `contracts/src/libraries/ClimFeeMath.sol` | The pure fee formula (ceil, then clamp) |
| `contracts/src/RiskDesk.sol` | CRE consumer: decodes, rejects, applies the envelope, stores one slot, emits |
| `contracts/src/ClimHook.sol` | v4 hook: `quoteFee()` and the `_getFee` override |
| `contracts/src/test-tokens/TestToken.sol` | 18-decimal ERC-20; the owner mints; a public `faucet()` with a per-address cooldown |
| `contracts/test/utils/DeskHelpers.sol` | Report encoding, and delivery the way the forwarder does it (`vm.prank(forwarder, origin)`) |
| `contracts/test/utils/HookHelpers.sol` | Real PoolManager (v4-core `Deployers`), hook at a flags address, full-range liquidity, fee read from the `Swap` event |
| `contracts/test/ClimFeeMath.t.sol` | Unit checks, rounding, clamps, overflow, fuzz (monotone, bounded, exact ceil) |
| `contracts/test/RiskDesk.t.sol` | Every rejection rule, envelope, k, flags, events, admin |
| `contracts/test/fork/MockForwarder.fork.t.sol` | The real Sepolia `MockKeystoneForwarder` delivers operator reports and swallows rejected ones |
| `contracts/test/TestToken.t.sol` | Metadata, owner-only mint, faucet amount and cooldown |
| `contracts/test/ClimHook.t.sol` | Permissions, constructor checks, static-fee rejection, every mode, swaps pay exactly `quoteFee`, split swaps |
| `contracts/test/Integration.t.sol` | One storm end to end, from reports through RiskDesk and ClimHook to pool V, next to the static pool S |
| `contracts/test/CreatePools.t.sol` | Price to `sqrtPriceX96` (tick check in both token orders) |
| `contracts/test/fixtures/params.p30.json` | Hook parameters for dry runs only (`decidedBy` starts with `FIXTURE`) |
| `contracts/script/base/ClimScript.sol` | Sepolia addresses, suites, fragment I/O, params loading and guards |
| `contracts/script/00_Tokens.s.sol` | tETH and tUSD, minted to the deployer, and the arbitrage-only PoolSwapTest (`routers.arb`) |
| `contracts/script/01_DeployDesk.s.sol` | `RiskDesk` per suite (`don`: production forwarder, simulation mode off) |
| `contracts/script/02_DeployHook.s.sol` | `HookMiner` salt, then CREATE2 deployment of `ClimHook` from `params.json` |
| `contracts/script/03_CreatePools.s.sol` | Initialize V (dynamic, with the hook) and S (static) at the same price |
| `contracts/script/04_AddLiquidity.s.sol` | The same full-range L in V and S, through Sepolia's `PoolModifyLiquidityTest` |
| `contracts/script/05_WriteDeployments.s.sol` | On-chain checks, then write `shared/deployments/{sepolia,anvil}.json` |
| `contracts/script/export-abis.sh` | `out/*.json` → `shared/abis/*.json` |
| `contracts/script/smoke.sh` | `quoteFee`, an optional report through the mock, and one swap on V and on S with the fee each paid |
| `contracts/deployments/11155111/*.json` | Per-step outputs on Sepolia (committed) |
| `shared/deployments/sepolia.json` | Merged addresses (schema in "Interfaces for other plans" below) |
| `shared/abis/*.json` | ABIs consumed by `cre/`, `bots/` and `app/` |

## Interfaces for other plans (produced here)

`shared/deployments/sepolia.json`. This is plan 04's schema; `parseDeployments` ignores the extra keys, which are `deployer`, `riskDesks.don` and `liquidity`:
```json
{
  "chainId": 11155111,
  "deployBlock": 11855528,
  "deployer": "0x… (= simOperator of the live and DON desks = address of CRE_ETH_PRIVATE_KEY in cre/.env)",
  "uniswap": { "poolManager": "0x…", "stateView": "0x…", "poolSwapTest": "0x…", "poolModifyLiquidityTest": "0x…" },
  "cre": { "mockForwarder": "0x…", "keystoneForwarder": "0x…" },
  "tokens": { "tETH": { "address": "0x…", "symbol": "tETH", "decimals": 18 }, "tUSD": { "address": "0x…", "symbol": "tUSD", "decimals": 18 } },
  "routers": { "arb": "0x… (second PoolSwapTest, arbitrage bot only)" },
  "riskDesks": { "live": "0x…", "replay": "0x… or null", "don": "0x… or null" },
  "hooks": { "live": "0x…", "replay": "0x… or null" },
  "pools": {
    "liveV": { "key": { "currency0": "0x…", "currency1": "0x…", "hooks": "0x…", "fee": 8388608, "tickSpacing": 60 }, "poolId": "0x…", "token0IsEth": false },
    "liveS": { "key": { "…": "…", "hooks": "0x0000000000000000000000000000000000000000", "fee": 600 }, "poolId": "0x…", "token0IsEth": false },
    "replayV": null,
    "replayS": null
  },
  "liquidity": { "live": "5208646657242166984120997", "replay": null }
}
```
`deployBlock` is the block number read when `00_Tokens` ran, just before the token deployment; use it as the `fromBlock` of log queries. `routers.arb` is `null` only if `tokens.json` was written by an older `00_Tokens` without the router. `liquidity` values are decimal strings, because L exceeds 2^53. The values shown are examples from the fork dry run.

---

### Task 1: Verify the Sepolia infrastructure and prepare the deployer key

**Delegable:** no (it creates the operator key, which is also the TestToken owner and the live desk's `simOperator`; a helper can run Step 3, the read-only `cast` checks)
**Depends on:** nothing

**Files:**
- Create: `contracts/.env.example`, `contracts/.env` (never committed)
- Modify: `docs/sessions/2026-10-06.md`

- [x] **Step 1: Create the env template**

```bash
mkdir -p ~/Development/hackathons/clim/contracts
```

Then write `contracts/.env.example`:
```bash
# Copy to contracts/.env (gitignored). Testnet keys only. Forge loads this file automatically.
# PRIVATE_KEY deploys everything and is the RiskDesk simOperator: plan 02 must put the same key in cre/.env
# as CRE_ETH_PRIVATE_KEY, otherwise every simulated report is rejected.
PRIVATE_KEY=
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
# Optional, only for Task 17 (contract verification on Etherscan).
ETHERSCAN_API_KEY=
```

- [x] **Step 2: Create `contracts/.env` with a fresh testnet key**

```bash
cast wallet new
```
Expected: `Successfully created new keypair.`, then an `Address:` line and a `Private key:` line. Copy `contracts/.env.example` to `contracts/.env`, then paste the private key after `PRIVATE_KEY=`. Use this key only on testnets. Plan 02 puts the same key in `cre/.env` as `CRE_ETH_PRIVATE_KEY`.

- [x] **Step 3: Verify every Sepolia address on-chain**

```bash
cd ~/Development/hackathons/clim/contracts && set -a && source .env && set +a && R=$SEPOLIA_RPC_URL && \
cast chain-id --rpc-url $R && \
for a in 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A 0x15fC6ae953E024d975e77382eEeC56A9101f9F88 0xF8344CFd5c43616a4366C34E3EEE75af79a74482 0x4e59b44847b379578588920cA78FbF26c0B4956C; do echo "$a $(cast codesize $a --rpc-url $R)"; done && \
cast call 0x15fC6ae953E024d975e77382eEeC56A9101f9F88 "typeAndVersion()(string)" --rpc-url $R && \
cast call 0xF8344CFd5c43616a4366C34E3EEE75af79a74482 "typeAndVersion()(string)" --rpc-url $R && \
cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C "poolManager()(address)" --rpc-url $R && \
cast call 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe "manager()(address)" --rpc-url $R && \
cast call 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A "manager()(address)" --rpc-url $R && \
cast call 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 "protocolFeeController()(address)" --rpc-url $R
```
Expected (verified on 2026-10-06):
```
11155111
0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 24009
0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 3531
0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe 6950
0x0C478023803a644c94c4CE1C1e7b9A087e411B0A 6050
0x15fC6ae953E024d975e77382eEeC56A9101f9F88 4579
0xF8344CFd5c43616a4366C34E3EEE75af79a74482 8591
0x4e59b44847b379578588920cA78FbF26c0B4956C 69
"MockKeystoneForwarder 1.0.0"
"KeystoneForwarder 1.0.0"
0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
0x0000000000000000000000000000000000000000
```
If any code size is 0, or any view call returns something else, stop. Update the address in `contracts/script/base/ClimScript.sol` (Task 10) and in the spec, and log the change.

- [x] **Step 4: Check the deployer's balance**

```bash
cd ~/Development/hackathons/clim/contracts && set -a && source .env && set +a && cast balance $(cast wallet address --private-key $PRIVATE_KEY) --rpc-url $SEPOLIA_RPC_URL --ether
```
Expected: at least `0.05`. The whole live suite uses under 7M gas: about 0.007 ETH at Sepolia's 1 gwei on 2026-10-06. If the balance is lower, fund the address from a Sepolia faucet and run the command again.

- [x] **Step 5: Log the verification**

Append to `docs/sessions/2026-10-06.md`. If the section `## Contracts (plan 01)` does not exist, create it at the end of the file first.
```markdown
## Contracts (plan 01)
- **Sepolia infra verified on-chain** (code size and view calls):
  - PoolManager `0xE03A…3543` (24,009 B, `protocolFeeController` = 0x0, so the `Swap` event's `fee` is the LP fee).
  - StateView `0xE1Dd…7E4C`, PoolSwapTest `0x9B6b…6eEe` and PoolModifyLiquidityTest `0x0C47…1B0A`: each points at that PoolManager.
  - MockKeystoneForwarder `0x15fC…9F88` ("MockKeystoneForwarder 1.0.0") and KeystoneForwarder `0xF834…4482` ("KeystoneForwarder 1.0.0").
  - CREATE2 deployer `0x4e59…956C` (69 B).
```

- [x] **Step 6: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/.env.example docs/sessions/2026-10-06.md && git status --short && git commit -m "chore(contracts): env template and verified Sepolia infrastructure"
```
Expected: `contracts/.env` does not appear in the `git status --short` output (it is gitignored), and the commit succeeds.

### Task 2: Foundry bootstrap: dependencies, config, vendored receiver, build check

**Delegable:** yes
**Depends on:** Task 1. The repository must have at least one commit (plan 00's first commit, or Task 1's).

**Files:**
- Create: `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/src/receiver/ReceiverTemplate.sol`, `contracts/src/receiver/IReceiver.sol`, `contracts/src/receiver/IERC165.sol`
- Generated: `.gitmodules`, `contracts/foundry.lock`, `contracts/lib/forge-std`, `contracts/lib/uniswap-hooks`
- Modify: `.gitignore`, `docs/sessions/2026-10-06.md`

- [x] **Step 1: Write the Foundry config**

Do **not** run `forge init`: inside a monorepo it creates a nested `.git` in `contracts/`.

`contracts/foundry.toml`:
```toml
[profile.default]
src = "src"
test = "test"
script = "script"
out = "out"
libs = ["lib"]
solc_version = "0.8.26"
evm_version = "cancun"
optimizer = true
optimizer_runs = 200
bytecode_hash = "none"
fs_permissions = [
  { access = "read", path = "../shared" },
  { access = "write", path = "../shared/deployments" },
  { access = "read-write", path = "./deployments" },
  { access = "read", path = "./test/fixtures" },
]

[fuzz]
runs = 1000

[rpc_endpoints]
sepolia = "${SEPOLIA_RPC_URL}"
anvil = "http://127.0.0.1:8545"

[lint]
lint_on_build = false
```

`contracts/remappings.txt`:
```text
forge-std/=lib/forge-std/src/
@openzeppelin/uniswap-hooks/=lib/uniswap-hooks/src/
@openzeppelin/contracts/=lib/uniswap-hooks/lib/openzeppelin-contracts/contracts/
@uniswap/v4-core/=lib/uniswap-hooks/lib/v4-core/
@uniswap/v4-periphery/=lib/uniswap-hooks/lib/v4-periphery/
solmate/=lib/uniswap-hooks/lib/v4-core/lib/solmate/
permit2/=lib/uniswap-hooks/lib/v4-periphery/lib/permit2/
```

```bash
mkdir -p ~/Development/hackathons/clim/contracts/{src/receiver,src/interfaces,src/libraries,src/test-tokens,test/utils,test/fork,test/fixtures,script/base} ~/Development/hackathons/clim/shared/{deployments,abis}
```

- [x] **Step 2: Install the dependencies**

The install is slow: it clones about 25 nested submodules and took 12 to 15 minutes on 2026-10-06. Run it with `run_in_background: true` and wait for it to finish. Do not add `--shallow`: in forge 1.4.2, `--shallow` cannot check out a tag (`Error: Tag: "v1.17.0" not found`).
```bash
cd ~/Development/hackathons/clim/contracts && forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/uniswap-hooks@v1.2.1
```
Expected (last lines):
```
    Installed forge-std tag=v1.17.0@f3dae6e6ee381f25eb6a246f7da9b85c91a68219
    Installed uniswap-hooks tag=v1.2.1@acbd604c409a827f7f98c9517236da860c4fca1a
```

- [x] **Step 3: Stage the submodules at the tags and verify the pins**

`forge install` stages each submodule at the default-branch HEAD and checks the tag out only in the working tree. `git add` records the tag commits.
```bash
cd ~/Development/hackathons/clim && git add .gitmodules contracts/lib/forge-std contracts/lib/uniswap-hooks contracts/foundry.lock && git submodule status contracts/lib/forge-std contracts/lib/uniswap-hooks && git -C contracts/lib/uniswap-hooks submodule status lib/v4-core lib/v4-periphery lib/openzeppelin-contracts
```
Expected: no line starts with `+` or `-`, and the commits are exactly:
```
 f3dae6e6ee381f25eb6a246f7da9b85c91a68219 contracts/lib/forge-std (v1.17.0)
 acbd604c409a827f7f98c9517236da860c4fca1a contracts/lib/uniswap-hooks (…)
 d153b048868a60c2403a3ef5b2301bb247884d46 lib/v4-core (…)
 7ebd04b161745b75ed0c24ba2df3bc7c25f65606 lib/v4-periphery (…)
 fcbae5394ae8ad52d8e580a3477db99814b9d565 lib/openzeppelin-contracts (…)
```

- [x] **Step 4: Vendor the Chainlink receiver at the pinned commit and check the hashes**

```bash
cd ~/Development/hackathons/clim/contracts/src/receiver && C=d0223f31182c76bc36b1cc9d47b13b18efcf2bf6 && for f in ReceiverTemplate.sol IReceiver.sol IERC165.sol; do curl -fsSL -o $f "https://raw.githubusercontent.com/smartcontractkit/cre-templates/$C/starter-templates/circuit-breaker/circuit-breaker-ts/contracts/evm/src/$f"; done && shasum -a 256 ReceiverTemplate.sol IReceiver.sol IERC165.sol
```
Expected:
```
cebb2e698a20ca6ba41e8bff1777a537df0715c923d9e263f2b5b3f8fe06677d  ReceiverTemplate.sol
dae0906d7de2e634f14d3b6794194d5bae38803e76e8029710611c7348c5a5e0  IReceiver.sol
c6a3b82a876e50eba9cd4673a712f861eca2a476cd2ad28fc0f26e66ae5f2dda  IERC165.sol
```
Do not edit these files. Their MIT headers stay as they are.

- [x] **Step 5: Ignore the local dry-run outputs**

Append to `~/Development/hackathons/clim/.gitignore`:
```gitignore

# Foundry dry runs on a local anvil fork
contracts/deployments/31337/
shared/deployments/anvil.json
```

- [x] **Step 6: Build check**

```bash
cd ~/Development/hackathons/clim/contracts && forge build
```
Expected: `Compiler run successful!`. The first run downloads solc 0.8.26. This compiles the vendored receiver against OpenZeppelin 5.5.0's `Ownable`, which validates the remappings.

- [x] **Step 7: Log the pins**

Append under `## Contracts (plan 01)` in `docs/sessions/2026-10-06.md`:
```markdown
- **Contract dependencies pinned:**
  - OpenZeppelin uniswap-hooks v1.2.1 (`acbd604`), which brings v4-core `d153b04`, v4-periphery `7ebd04b` and OZ Contracts 5.5.0; forge-std v1.17.0; solc 0.8.26, evm cancun.
  - v4-core `d153b04` differs from the v4.0.0 PoolManager on Sepolia only by moving `SwapParams`/`ModifyLiquidityParams` into `types/PoolOperation.sol`. The ABI is unchanged.
  - Foundry: `forge install --shallow` cannot check out tags (forge 1.4.2), and the full recursive install takes 12 to 15 min. Never `forge init` inside the monorepo: it creates a nested `.git`.
- **ReceiverTemplate source:** cre-templates `d0223f3`, `starter-templates/circuit-breaker/circuit-breaker-ts/contracts/evm/src/` (MIT).
  - Not the `sports-resolution` variant: its 62-byte metadata check rejects the forwarder's 64-byte metadata (friction log).
```

- [x] **Step 8: Commit**

```bash
cd ~/Development/hackathons/clim && git add .gitignore .gitmodules contracts/foundry.toml contracts/remappings.txt contracts/foundry.lock contracts/lib/forge-std contracts/lib/uniswap-hooks contracts/src/receiver docs/sessions/2026-10-06.md && git commit -m "build(contracts): Foundry project, pinned v4 and OZ hooks deps, vendored CRE receiver"
```

### Task 3: ClimFeeMath

**Delegable:** no (the core formula)
**Depends on:** Task 2

**Files:**
- Create: `contracts/src/libraries/ClimFeeMath.sol`
- Test: `contracts/test/ClimFeeMath.t.sol`

- [x] **Step 1: Write the failing test**

`contracts/test/ClimFeeMath.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ClimFeeMath} from "../src/libraries/ClimFeeMath.sol";

contract ClimFeeMathTest is Test {
    uint32 internal constant SQRT_HALF_DT_12S = 2_449_490; // sqrt(12 s / 2) * 1e6
    uint32 internal constant ETA_P10 = 91_761; // P* = 10 %: 1/0.10 - 0.8239168 = 9.1761
    uint32 internal constant ETA_P30 = 25_093; // P* = 30 %: round(1e4 * (1/0.30 - 0.824)) = 25_093 (spec 2.3)
    uint16 internal constant K1 = 10_000;
    uint24 internal constant MIN = 500; // 5 bp
    uint24 internal constant MAX = 15_000; // 150 bp

    function _fee(uint32 sigmaE9, uint32 etaE4, uint16 kE4) internal pure returns (uint24) {
        return ClimFeeMath.feePips(sigmaE9, etaE4, SQRT_HALF_DT_12S, kE4, 0, 1_000_000);
    }

    /// Unit checks from the design note (P* = 10 %), with ceil rounding.
    function test_UnitChecks_PStar10() public pure {
        // 48 %/yr -> sigmaE9 85_475: 1921.20 -> ceil 1922 pips (19.2 bp)
        assertEq(_fee(85_475, ETA_P10, K1), 1922);
        // 25 %/yr -> sigmaE9 44_518: 1000.62 -> ceil 1001 pips (10.0 bp)
        assertEq(_fee(44_518, ETA_P10, K1), 1001);
    }

    /// Post-audit calibration P* = 30 %: 5 bp up to ~46 %, 11 bp at 100 %, 25 bp at 225 %.
    function test_UnitChecks_PStar30() public pure {
        assertEq(ClimFeeMath.feePips(48_080, ETA_P30, SQRT_HALF_DT_12S, K1, MIN, MAX), 500); // 27 %: raw 296 -> floor 500
        assertEq(_fee(81_913, ETA_P30, K1), 504); // 46 %
        assertEq(_fee(178_072, ETA_P30, K1), 1095); // 100 %
        assertEq(_fee(400_663, ETA_P30, K1), 2463); // 225 %
    }

    /// Same vectors as shared/src/units.ts (plan 04), which mirrors this library off-chain.
    function test_SharedVectorsWithTheOffchainMirror() public pure {
        assertEq(_fee(178_072, 41_760, K1), 1822); // 100 %/yr, P* = 20 %
        assertEq(_fee(178_072, 25_093, K1), 1095); // 100 %/yr, P* = 30 %
        assertEq(_fee(400_663, 41_760, K1), 4099); // 225 %/yr, P* = 20 %
        assertEq(_fee(400_663, 25_093, K1), 2463); // 225 %/yr, P* = 30 %
        assertEq(_fee(1_780_730, 41_760, K1), 18_216); // SIGMA_MAX, P* = 20 %: raw, before the cap
        assertEq(ClimFeeMath.feePips(1_780_730, 41_760, SQRT_HALF_DT_12S, K1, MIN, MAX), MAX);
        assertEq(_fee(178_072, 25_093, 20_000), 2190); // k = 2
    }

    function test_KDoublesTheFee() public pure {
        // 3842.40 -> ceil 3843
        assertEq(_fee(85_475, ETA_P10, 20_000), 3843);
    }

    function test_CeilOnlyWhenThereIsARemainder() public pure {
        // 1_000 * 10_000 * 1_000_000 * 10_000 = 1e17 exactly -> 1 pip
        assertEq(ClimFeeMath.feePips(1_000, 10_000, 1_000_000, 10_000, 0, 1_000_000), 1);
        // 1.001e17 -> ceil 2 pips
        assertEq(ClimFeeMath.feePips(1_001, 10_000, 1_000_000, 10_000, 0, 1_000_000), 2);
    }

    function test_ClampsToFloorAndCap() public pure {
        assertEq(ClimFeeMath.feePips(0, ETA_P30, SQRT_HALF_DT_12S, K1, MIN, MAX), MIN);
        assertEq(ClimFeeMath.feePips(1_780_730, ETA_P10, SQRT_HALF_DT_12S, 20_000, MIN, MAX), MAX);
    }

    function test_NoOverflowAtTypeMaxima() public pure {
        uint24 fee =
            ClimFeeMath.feePips(type(uint32).max, type(uint32).max, type(uint32).max, type(uint16).max, MIN, MAX);
        assertEq(fee, MAX);
    }

    function testFuzz_WithinBounds(uint32 sigmaE9, uint32 etaE4, uint32 sqrtHalfDtE6, uint16 kE4) public pure {
        uint24 fee = ClimFeeMath.feePips(sigmaE9, etaE4, sqrtHalfDtE6, kE4, MIN, MAX);
        assertGe(fee, MIN);
        assertLe(fee, MAX);
    }

    function testFuzz_MonotoneInSigma(uint32 a, uint32 b, uint16 kE4) public pure {
        vm.assume(a <= b);
        assertLe(
            ClimFeeMath.feePips(a, ETA_P30, SQRT_HALF_DT_12S, kE4, MIN, MAX),
            ClimFeeMath.feePips(b, ETA_P30, SQRT_HALF_DT_12S, kE4, MIN, MAX)
        );
    }

    function testFuzz_MonotoneInK(uint32 sigmaE9, uint16 ka, uint16 kb) public pure {
        vm.assume(ka <= kb);
        assertLe(
            ClimFeeMath.feePips(sigmaE9, ETA_P30, SQRT_HALF_DT_12S, ka, MIN, MAX),
            ClimFeeMath.feePips(sigmaE9, ETA_P30, SQRT_HALF_DT_12S, kb, MIN, MAX)
        );
    }

    /// Matches the exact rational formula: fee * 1e17 >= product > (fee - 1) * 1e17 when not clamped.
    function testFuzz_IsCeilOfProduct(uint32 sigmaE9, uint16 kE4) public pure {
        sigmaE9 = uint32(bound(sigmaE9, 0, 1_780_730)); // RiskDesk.SIGMA_MAX_E9
        kE4 = uint16(bound(kE4, 0, 20_000)); // RiskDesk.K_MAX_E4
        uint256 num = uint256(sigmaE9) * ETA_P30 * SQRT_HALF_DT_12S * kE4;
        uint24 fee = ClimFeeMath.feePips(sigmaE9, ETA_P30, SQRT_HALF_DT_12S, kE4, 0, type(uint24).max);
        assertGe(uint256(fee) * 1e17, num);
        if (fee > 0) assertLt((uint256(fee) - 1) * 1e17, num);
    }
}
```

- [x] **Step 2: Run it, expected FAIL**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/ClimFeeMath.t.sol
```
Expected: `Error (6275): Source "src/libraries/ClimFeeMath.sol" not found`.

- [x] **Step 3: Minimal implementation**

`contracts/src/libraries/ClimFeeMath.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ClimFeeMath
/// @notice fee_pips = clamp(ceil(sigmaE9 * etaE4 * sqrtHalfDtE6 * kE4 / 1e17), feeMinPips, feeMaxPips).
/// @dev The fee is eta standard deviations of the price move over half a block:
///      sigma (per sqrt-second, 1e9) * eta (1e4) * sqrt(blockTime / 2) (1e6) * k (1e4) = fee * 1e23,
///      and 1 pip = 1e-6, so dividing by 1e17 yields pips. The largest possible product is
///      (2^32)^3 * 2^16 = 2^112, far below 2^256: no overflow for any input.
///      Precondition: feeMinPips <= feeMaxPips (checked by ClimHook's constructor).
library ClimFeeMath {
    uint256 internal constant SCALE = 1e17;

    function feePips(
        uint32 sigmaE9,
        uint32 etaE4,
        uint32 sqrtHalfDtE6,
        uint16 kE4,
        uint24 feeMinPips,
        uint24 feeMaxPips
    ) internal pure returns (uint24) {
        uint256 num = uint256(sigmaE9) * etaE4 * sqrtHalfDtE6 * kE4;
        uint256 raw = (num + SCALE - 1) / SCALE; // ceil: round in favor of LPs
        if (raw < feeMinPips) return feeMinPips;
        if (raw > feeMaxPips) return feeMaxPips;
        return uint24(raw);
    }
}
```

- [x] **Step 4: Run, expected PASS**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/ClimFeeMath.t.sol
```
Expected: `Suite result: ok. 11 passed; 0 failed; 0 skipped`.

- [x] **Step 5: Log the rounding fix**

Append under `## Contracts (plan 01)` in `docs/sessions/2026-10-06.md`:
```markdown
- **Spec fix (rounding):** the design's "48 %/yr → 1,921 pips" used floor. The canonical formula rounds up, so the hook charges **1,922** pips (25 %/yr → 1,001 is consistent).
  - etaE4 uses the rounded constant 0.824 everywhere (spec §2.3): 41,760 at P* = 20 % and 25,093 at 30 % (the exact 0.8239168 would give 41,761 and 25,094; immaterial, and plan 04 accepts ±1).
  - The hook takes the lab's `etaE4` verbatim. The test vectors are shared with `shared/src/units.ts` (plan 04) and `lab/tests/test_fee.py` (plan 03).
```

- [x] **Step 6: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/src/libraries/ClimFeeMath.sol contracts/test/ClimFeeMath.t.sol docs/sessions/2026-10-06.md && git commit -m "feat(contracts): ClimFeeMath fee formula with ceil rounding and clamps"
```

### Task 4: IRiskDesk

**Delegable:** no
**Depends on:** Task 2

**Files:**
- Create: `contracts/src/interfaces/IRiskDesk.sol`

- [x] **Step 1: Write the interface**

This is an interface plus constants and holds no logic: there is nothing to test until Task 5. `contracts/src/interfaces/IRiskDesk.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev Bit 0 of `flags`: venue dispersion above DISP_MAX_BP in the last report.
uint8 constant FLAG_DEGRADED = 1;
/// @dev Bit 1 of `flags`: set at construction on a desk fed by historical replay, never on a live desk.
uint8 constant FLAG_REPLAY = 2;

/// @title IRiskDesk
/// @notice Read side of the clim risk desk: the latest volatility published by the Chainlink CRE workflow.
interface IRiskDesk {
    /// @notice One accepted report. Every field of the CRE report is logged so the P&L explain can be rebuilt from logs.
    /// @param seq Report counter, starts at 1.
    /// @param tObs DON observation time (unix seconds).
    /// @param sigmaApplied Volatility stored after the envelope, per sqrt-second, times 1e9.
    /// @param sigmaReported Volatility as reported, per sqrt-second, times 1e9.
    /// @param rv15E9 15-minute realized volatility, per sqrt-second, times 1e9.
    /// @param dvolE2 Deribit DVOL index times 100.
    /// @param refTick Median venue price as a Uniswap tick of the clim pools.
    /// @param dispBp Venue dispersion in basis points.
    /// @param nSources Venues that passed the freshness filter.
    /// @param kE4 Model-risk multiplier applied, times 1e4 (clamped to [10_000, 20_000]).
    /// @param zone Backtest zone published by the workflow (0 not validated, 1 green, 2 yellow, 3 red). Logged only.
    event RiskReported(
        uint32 indexed seq,
        uint40 tObs,
        uint32 sigmaApplied,
        uint32 sigmaReported,
        uint32 rv15E9,
        uint16 dvolE2,
        int24 refTick,
        uint16 dispBp,
        uint8 nSources,
        uint16 kE4,
        uint8 zone
    );

    /// @notice Latest accepted state, packed in one storage slot.
    /// @return tObs Observation time of the last accepted report (0 = never reported).
    /// @return sigmaE9 Applied volatility, per sqrt-second, times 1e9.
    /// @return kE4 Applied model-risk multiplier, times 1e4.
    /// @return flags FLAG_DEGRADED | FLAG_REPLAY.
    /// @return seq Number of accepted reports.
    function state() external view returns (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags, uint32 seq);
}
```

- [x] **Step 2: Build**

```bash
cd ~/Development/hackathons/clim/contracts && forge build
```
Expected: `Compiler run successful!`

- [x] **Step 3: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/src/interfaces/IRiskDesk.sol && git commit -m "feat(contracts): IRiskDesk interface, RiskReported event and flags"
```

### Task 5: RiskDesk

**Delegable:** no
**Depends on:** Task 4

**Files:**
- Create: `contracts/src/RiskDesk.sol`
- Test: `contracts/test/utils/DeskHelpers.sol`, `contracts/test/RiskDesk.t.sol`

- [x] **Step 1: Write the test fixtures and the failing test**

`contracts/test/utils/DeskHelpers.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RiskDesk} from "../../src/RiskDesk.sol";

/// @notice Shared fixtures for tests that feed reports to a RiskDesk the way MockKeystoneForwarder does.
abstract contract DeskHelpers is Test {
    uint40 internal constant T0 = 1_760_000_000;

    // Volatility per sqrt-second times 1e9 (annual / sqrt(31_536_000)).
    uint32 internal constant SIGMA_10 = 17_807; // 10 %/yr
    uint32 internal constant SIGMA_48 = 85_475; // 48 %/yr
    uint32 internal constant SIGMA_100 = 178_072; // 100 %/yr
    uint32 internal constant SIGMA_300 = 534_217; // 300 %/yr

    address internal forwarder = makeAddr("forwarder");
    address internal operator = makeAddr("simOperator");
    address internal attacker = makeAddr("attacker");

    /// @dev Report with sensible defaults for the fields the contracts do not act on.
    function _report(uint40 tObs, uint32 sigmaE9, uint16 dispBp, uint8 nSources, uint16 kE4)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(tObs, sigmaE9, sigmaE9, uint16(4_800), int24(82_944), dispBp, nSources, kE4, uint8(0));
    }

    /// @dev Calm, healthy report: 4 venues, 3 bp dispersion, k = 1.
    function _report(uint40 tObs, uint32 sigmaE9) internal pure returns (bytes memory) {
        return _report(tObs, sigmaE9, 3, 4, 10_000);
    }

    /// @dev Delivers a report as the forwarder, inside a transaction signed by `origin`.
    function _deliver(RiskDesk desk, bytes memory report, address origin) internal {
        vm.prank(forwarder, origin);
        desk.onReport("", report);
    }

    function _deliver(RiskDesk desk, bytes memory report) internal {
        _deliver(desk, report, operator);
    }
}
```

`contracts/test/RiskDesk.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RiskDesk} from "../src/RiskDesk.sol";
import {IRiskDesk, FLAG_DEGRADED, FLAG_REPLAY} from "../src/interfaces/IRiskDesk.sol";
import {ReceiverTemplate} from "../src/receiver/ReceiverTemplate.sol";
import {IReceiver} from "../src/receiver/IReceiver.sol";
import {IERC165} from "../src/receiver/IERC165.sol";
import {DeskHelpers} from "./utils/DeskHelpers.sol";

contract RiskDeskTest is DeskHelpers {
    RiskDesk internal desk;

    function setUp() public {
        vm.warp(T0);
        desk = new RiskDesk(forwarder, operator, false);
    }

    function _state() internal view returns (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags, uint32 seq) {
        return desk.state();
    }

    // ---------------------------------------------------------------- construction

    function test_Constructor() public view {
        assertEq(desk.owner(), address(this));
        assertEq(desk.getForwarderAddress(), forwarder);
        assertEq(desk.simOperator(), operator);
        assertTrue(desk.simMode());
        (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags, uint32 seq) = _state();
        assertEq(tObs, 0);
        assertEq(sigmaE9, 0);
        assertEq(kE4, 0);
        assertEq(flags, 0);
        assertEq(seq, 0);
    }

    function test_ReplayDeskStartsWithReplayFlag() public {
        RiskDesk replay = new RiskDesk(forwarder, operator, true);
        (,,, uint8 flags,) = replay.state();
        assertEq(flags, FLAG_REPLAY);
    }

    function test_RevertWhen_ZeroSimOperator() public {
        vm.expectRevert(RiskDesk.ZeroSimOperator.selector);
        new RiskDesk(forwarder, address(0), false);
    }

    function test_RevertWhen_ZeroForwarder() public {
        vm.expectRevert(ReceiverTemplate.InvalidForwarderAddress.selector);
        new RiskDesk(address(0), operator, false);
    }

    function test_SupportsIReceiverViaERC165() public view {
        assertTrue(desk.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(desk.supportsInterface(type(IERC165).interfaceId));
    }

    // ---------------------------------------------------------------- acceptance

    function test_FirstReport_StoresStateAndEmits() public {
        bytes memory report = abi.encode(
            T0, SIGMA_48, uint32(90_000), uint16(4_812), int24(82_944), uint16(3), uint8(4), uint16(10_000), uint8(0)
        );
        vm.expectEmit(true, false, false, true, address(desk));
        emit IRiskDesk.RiskReported(1, T0, SIGMA_48, SIGMA_48, 90_000, 4_812, 82_944, 3, 4, 10_000, 0);
        _deliver(desk, report);

        (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags, uint32 seq) = _state();
        assertEq(tObs, T0);
        assertEq(sigmaE9, SIGMA_48);
        assertEq(kE4, 10_000);
        assertEq(flags, 0);
        assertEq(seq, 1);
    }

    function test_SeqIncrementsPerAcceptedReport() public {
        _deliver(desk, _report(T0, SIGMA_48));
        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, SIGMA_48));
        (,,,, uint32 seq) = _state();
        assertEq(seq, 2);
    }

    // ---------------------------------------------------------------- envelope

    function test_FirstReport_ClampedToAbsoluteFloor() public {
        _deliver(desk, _report(T0, 0));
        (, uint32 sigmaE9,,,) = _state();
        assertEq(sigmaE9, desk.SIGMA_MIN_E9());
    }

    function test_FirstReport_ClampedToAbsoluteCap() public {
        _deliver(desk, _report(T0, 5_000_000));
        (, uint32 sigmaE9,,,) = _state();
        assertEq(sigmaE9, desk.SIGMA_MAX_E9());
    }

    function test_Envelope_RiseCappedAtTwiceThePrevious() public {
        _deliver(desk, _report(T0, SIGMA_48));
        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, 1_000_000));
        (, uint32 sigmaE9,,,) = _state();
        assertEq(sigmaE9, 170_950); // 2 * 85_475
    }

    function test_Envelope_FallCappedAtEightyPercentOfThePrevious() public {
        _deliver(desk, _report(T0, SIGMA_48));
        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, 20_000));
        (, uint32 sigmaE9,,,) = _state();
        assertEq(sigmaE9, 68_380); // 85_475 * 8 / 10
    }

    function test_Envelope_NeverBelowSigmaMin() public {
        _deliver(desk, _report(T0, 20_000));
        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, 0));
        (, uint32 sigmaE9,,,) = _state();
        assertEq(sigmaE9, 17_807); // max(17_807, 16_000)
    }

    function test_Envelope_NeverAboveSigmaMax() public {
        _deliver(desk, _report(T0, 1_500_000));
        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, 3_000_000));
        (, uint32 sigmaE9,,,) = _state();
        assertEq(sigmaE9, 1_780_730); // min(1_780_730, 3_000_000)
    }

    function test_Envelope_PassesThroughInsideTheBand() public {
        _deliver(desk, _report(T0, SIGMA_48));
        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, 100_000));
        (, uint32 sigmaE9,,,) = _state();
        assertEq(sigmaE9, 100_000);
    }

    function testFuzz_EnvelopeBounds(uint32 first, uint32 second) public {
        _deliver(desk, _report(T0, first));
        (, uint32 prev,,,) = _state();
        assertGe(prev, desk.SIGMA_MIN_E9());
        assertLe(prev, desk.SIGMA_MAX_E9());

        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, second));
        (, uint32 applied,,,) = _state();
        uint256 lo = uint256(prev) * 8 / 10;
        if (lo < desk.SIGMA_MIN_E9()) lo = desk.SIGMA_MIN_E9();
        uint256 hi = uint256(prev) * 2;
        if (hi > desk.SIGMA_MAX_E9()) hi = desk.SIGMA_MAX_E9();
        assertGe(applied, lo);
        assertLe(applied, hi);
        if (second >= lo && second <= hi) assertEq(applied, second);
    }

    // ---------------------------------------------------------------- k and flags

    function test_KClampedToOneAndTwo() public {
        _deliver(desk, _report(T0, SIGMA_48, 3, 4, 0));
        (,, uint16 kE4,,) = _state();
        assertEq(kE4, 10_000);

        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, SIGMA_48, 3, 4, 50_000));
        (,, kE4,,) = _state();
        assertEq(kE4, 20_000);

        vm.warp(T0 + 60);
        _deliver(desk, _report(T0 + 60, SIGMA_48, 3, 4, 15_000));
        (,, kE4,,) = _state();
        assertEq(kE4, 15_000);
    }

    function test_DegradedFlagFollowsDispersion() public {
        _deliver(desk, _report(T0, SIGMA_48, 25, 4, 10_000)); // 25 bp: not degraded
        (,,, uint8 flags,) = _state();
        assertEq(flags, 0);

        vm.warp(T0 + 30);
        _deliver(desk, _report(T0 + 30, SIGMA_48, 26, 4, 10_000)); // 26 bp: degraded
        (,,, flags,) = _state();
        assertEq(flags, FLAG_DEGRADED);

        vm.warp(T0 + 60);
        _deliver(desk, _report(T0 + 60, SIGMA_48, 3, 4, 10_000)); // back to normal
        (,,, flags,) = _state();
        assertEq(flags, 0);
    }

    function test_ReplayFlagSurvivesEveryReport() public {
        RiskDesk replay = new RiskDesk(forwarder, operator, true);
        _deliver(replay, _report(T0, SIGMA_48, 40, 4, 10_000));
        (,,, uint8 flags,) = replay.state();
        assertEq(flags, FLAG_REPLAY | FLAG_DEGRADED);

        vm.warp(T0 + 30);
        _deliver(replay, _report(T0 + 30, SIGMA_48, 3, 4, 10_000));
        (,,, flags,) = replay.state();
        assertEq(flags, FLAG_REPLAY);
    }

    // ---------------------------------------------------------------- rejections

    function test_RevertWhen_CallerIsNotTheForwarder() public {
        vm.prank(attacker, operator);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, attacker, forwarder));
        desk.onReport("", _report(T0, SIGMA_48));
    }

    function test_RevertWhen_SimModeAndOriginIsNotTheOperator() public {
        vm.prank(forwarder, attacker);
        vm.expectRevert(abi.encodeWithSelector(RiskDesk.NotSimOperator.selector, attacker));
        desk.onReport("", _report(T0, 0));
    }

    function test_AnyOriginAcceptedAfterDisableSim() public {
        desk.disableSim();
        assertFalse(desk.simMode());
        _deliver(desk, _report(T0, SIGMA_48), attacker);
        (,,,, uint32 seq) = _state();
        assertEq(seq, 1);
    }

    function test_RevertWhen_DisableSimByNonOwner() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        desk.disableSim();
    }

    function test_RevertWhen_GapUnderTwentySeconds() public {
        _deliver(desk, _report(T0, SIGMA_48));
        vm.warp(T0 + 19);
        vm.prank(forwarder, operator);
        vm.expectRevert(abi.encodeWithSelector(RiskDesk.StaleReport.selector, T0 + 19, T0));
        desk.onReport("", _report(T0 + 19, SIGMA_48));
    }

    function test_AcceptsAtExactlyTwentySeconds() public {
        _deliver(desk, _report(T0, SIGMA_48));
        vm.warp(T0 + 20);
        _deliver(desk, _report(T0 + 20, SIGMA_48));
        (uint40 tObs,,,,) = _state();
        assertEq(tObs, T0 + 20);
    }

    function test_RevertWhen_ReplayingAnOlderReport() public {
        _deliver(desk, _report(T0, SIGMA_48));
        vm.prank(forwarder, operator);
        vm.expectRevert(abi.encodeWithSelector(RiskDesk.StaleReport.selector, T0 - 60, T0));
        desk.onReport("", _report(T0 - 60, SIGMA_48));
    }

    function test_RevertWhen_MoreThanThirtySecondsInTheFuture() public {
        vm.prank(forwarder, operator);
        vm.expectRevert(abi.encodeWithSelector(RiskDesk.FutureReport.selector, T0 + 31, uint256(T0)));
        desk.onReport("", _report(T0 + 31, SIGMA_48));
    }

    function test_AcceptsThirtySecondsInTheFuture() public {
        _deliver(desk, _report(T0 + 30, SIGMA_48));
        (uint40 tObs,,,,) = _state();
        assertEq(tObs, T0 + 30);
    }

    function test_RevertWhen_FewerThanThreeSources() public {
        vm.prank(forwarder, operator);
        vm.expectRevert(abi.encodeWithSelector(RiskDesk.TooFewSources.selector, uint8(2)));
        desk.onReport("", _report(T0, SIGMA_48, 3, 2, 10_000));
    }

    function test_RevertWhen_ReportIsTruncated() public {
        vm.prank(forwarder, operator);
        vm.expectRevert();
        desk.onReport("", abi.encode(T0, SIGMA_48));
    }

    // ---------------------------------------------------------------- admin

    function test_OwnerCanRotateTheForwarder() public {
        address prod = makeAddr("keystoneForwarder");
        desk.setForwarderAddress(prod);
        assertEq(desk.getForwarderAddress(), prod);

        vm.prank(forwarder, operator);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, forwarder, prod));
        desk.onReport("", _report(T0, SIGMA_48));
    }
}
```

- [x] **Step 2: Run it, expected FAIL**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/RiskDesk.t.sol
```
Expected: `Error (6275): Source "src/RiskDesk.sol" not found`.

- [x] **Step 3: Minimal implementation**

`contracts/src/RiskDesk.sol`. The event is emitted from a separate private function because the 11-field emit inside `_processReport` hits "stack too deep" without `via_ir`.
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "./receiver/ReceiverTemplate.sol";
import {IRiskDesk, FLAG_DEGRADED, FLAG_REPLAY} from "./interfaces/IRiskDesk.sol";

/// @title RiskDesk
/// @notice Stores the volatility published by the clim CRE workflow ("risk desk").
///         The owner can only rotate the forwarder / workflow id (ReceiverTemplate) and switch off
///         simulation mode for good. The owner has no direct power over the volatility or the fee: it only
///         chooses which forwarder and workflow to trust (spec 6.7), and every report stays inside the envelope.
contract RiskDesk is ReceiverTemplate, IRiskDesk {
    /// @notice ABI layout of the CRE report: abi.encode(uint40,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8).
    struct Report {
        uint40 tObs;
        uint32 sigmaE9;
        uint32 rv15E9;
        uint16 dvolE2;
        int24 refTick;
        uint16 dispBp;
        uint8 nSources;
        uint16 kE4;
        uint8 zone;
    }

    struct State {
        uint40 tObs;
        uint32 sigmaE9;
        uint16 kE4;
        uint8 flags;
        uint32 seq;
    }

    uint32 public constant SIGMA_MIN_E9 = 17_807; // 10 %/yr
    uint32 public constant SIGMA_MAX_E9 = 1_780_730; // 1000 %/yr
    uint16 public constant K_MIN_E4 = 10_000;
    uint16 public constant K_MAX_E4 = 20_000;
    uint16 public constant DISP_MAX_BP = 25;
    uint40 public constant MIN_GAP = 20;
    uint40 public constant MAX_SKEW = 30;
    uint8 public constant MIN_SOURCES = 3;

    /// @notice EOA allowed to originate reports while simulation mode is on (the `cre workflow simulate --broadcast` key).
    address public immutable simOperator;
    /// @notice True until disableSim() is called. MockKeystoneForwarder checks no signature, so tx.origin is the guard.
    bool public simMode;

    State private s_state;

    event SimDisabled();

    error ZeroSimOperator();
    error NotSimOperator(address origin);
    error StaleReport(uint40 tObs, uint40 lastTObs);
    error FutureReport(uint40 tObs, uint256 blockTimestamp);
    error TooFewSources(uint8 nSources);

    constructor(address forwarder, address simOperator_, bool replay) ReceiverTemplate(forwarder) {
        if (simOperator_ == address(0)) revert ZeroSimOperator();
        simOperator = simOperator_;
        simMode = true;
        if (replay) s_state.flags = FLAG_REPLAY;
    }

    /// @inheritdoc IRiskDesk
    function state() external view returns (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags, uint32 seq) {
        State memory s = s_state;
        return (s.tObs, s.sigmaE9, s.kE4, s.flags, s.seq);
    }

    /// @notice Irreversibly stops accepting reports on the sole basis of tx.origin (switch to the production forwarder first).
    function disableSim() external onlyOwner {
        simMode = false;
        emit SimDisabled();
    }

    function _processReport(bytes calldata report) internal override {
        Report memory r = abi.decode(report, (Report));
        State memory s = s_state;

        // solhint-disable-next-line avoid-tx-origin
        if (simMode && tx.origin != simOperator) revert NotSimOperator(tx.origin);
        if (s.seq != 0 && r.tObs < s.tObs + MIN_GAP) revert StaleReport(r.tObs, s.tObs);
        if (r.tObs > block.timestamp + MAX_SKEW) revert FutureReport(r.tObs, block.timestamp);
        if (r.nSources < MIN_SOURCES) revert TooFewSources(r.nSources);

        uint32 applied = _envelope(r.sigmaE9, s.sigmaE9, s.seq == 0);
        r.kE4 = r.kE4 < K_MIN_E4 ? K_MIN_E4 : (r.kE4 > K_MAX_E4 ? K_MAX_E4 : r.kE4);
        uint8 flags = (s.flags & FLAG_REPLAY) | (r.dispBp > DISP_MAX_BP ? FLAG_DEGRADED : 0);
        uint32 seq = s.seq + 1;

        s_state = State({tObs: r.tObs, sigmaE9: applied, kE4: r.kE4, flags: flags, seq: seq});
        _emitReported(seq, applied, r);
    }

    /// @dev Separate frame to keep the 11-field event under the stack limit without via-IR. `r.kE4` is already clamped.
    function _emitReported(uint32 seq, uint32 applied, Report memory r) private {
        emit RiskReported(
            seq, r.tObs, applied, r.sigmaE9, r.rv15E9, r.dvolE2, r.refTick, r.dispBp, r.nSources, r.kE4, r.zone
        );
    }

    /// @dev Volatility rises fast (x2 per report) and decays slowly (x0.8 per report); first report only gets the absolute bounds.
    function _envelope(uint32 reported, uint32 prev, bool first) internal pure returns (uint32) {
        uint256 lo = SIGMA_MIN_E9;
        uint256 hi = SIGMA_MAX_E9;
        if (!first) {
            uint256 down = (uint256(prev) * 8) / 10;
            uint256 up = uint256(prev) * 2;
            if (down > lo) lo = down;
            if (up < hi) hi = up;
        }
        if (reported < lo) return uint32(lo);
        if (reported > hi) return uint32(hi);
        return reported;
    }
}
```

- [x] **Step 4: Run, expected PASS**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/RiskDesk.t.sol
```
Expected: `Suite result: ok. 30 passed; 0 failed; 0 skipped`.

- [x] **Step 5: Log the desk constants**

Append under `## Contracts (plan 01)` in `docs/sessions/2026-10-06.md`:
```markdown
- **RiskDesk:**
  - `SIGMA_MAX_E9` = 1,780,730 is 1000.003 %/yr (exact 1000 % = 1,780,724). Kept as specified, harmless.
  - `RiskReported.kE4` logs the applied (clamped) k, and sigma is logged both applied and reported.
  - The first report gets only the absolute bounds [17,807, 1,780,730], with no gap check.
  - `zone` is logged only (0 not validated, 1 green, 2 yellow, 3 red, as in spec §3.4 and plan 02).
```

- [x] **Step 6: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/src/RiskDesk.sol contracts/test/utils/DeskHelpers.sol contracts/test/RiskDesk.t.sol docs/sessions/2026-10-06.md && git commit -m "feat(contracts): RiskDesk CRE consumer with sim guard, freshness, quorum, envelope and flags"
```

### Task 6: Fork test against the real Sepolia MockKeystoneForwarder

**Delegable:** yes
**Depends on:** Task 5, and `SEPOLIA_RPC_URL` in `contracts/.env`

**Files:**
- Test: `contracts/test/fork/MockForwarder.fork.t.sol`
- Modify: `docs/feedback/cre-friction-log.md`, `docs/sessions/2026-10-06.md`

- [x] **Step 1: Write the test**

This is a characterization test of external code, and the code under test already exists, so it passes at once. Without `SEPOLIA_RPC_URL` it skips itself. `contracts/test/fork/MockForwarder.fork.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {RiskDesk} from "../../src/RiskDesk.sol";
import {DeskHelpers} from "../utils/DeskHelpers.sol";

interface IMockKeystoneForwarder {
    function report(
        address receiver,
        bytes calldata rawReport,
        bytes calldata reportContext,
        bytes[] calldata signatures
    ) external;
}

/// @notice Runs against the real MockKeystoneForwarder on Sepolia (the one `cre workflow simulate --broadcast` calls).
///         Proves: (1) the mock calls onReport with msg.sender = mock and tx.origin = the EOA that sent the tx,
///         (2) a rejected report does NOT revert the transaction: the mock swallows it and emits ReportProcessed(false).
contract MockForwarderForkTest is DeskHelpers {
    address internal constant MOCK_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    bytes32 internal constant REPORT_PROCESSED = keccak256("ReportProcessed(address,bytes32,bytes2,bool)");

    RiskDesk internal desk;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        desk = new RiskDesk(MOCK_FORWARDER, operator, false);
    }

    /// @dev Forwarder raw report: 109 bytes of metadata, then the workflow's report.
    function _raw(bytes memory report, bytes32 executionId) internal pure returns (bytes memory) {
        return abi.encodePacked(
            uint8(1),
            executionId,
            uint32(0),
            uint32(0),
            uint32(0),
            bytes32(0),
            bytes10(0),
            address(0),
            bytes2(0),
            report
        );
    }

    function _send(address origin, bytes memory report, bytes32 executionId) internal returns (bool result) {
        vm.recordLogs();
        vm.prank(origin, origin);
        IMockKeystoneForwarder(MOCK_FORWARDER).report(address(desk), _raw(report, executionId), "", new bytes[](0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == MOCK_FORWARDER && logs[i].topics[0] == REPORT_PROCESSED) {
                return abi.decode(logs[i].data, (bool));
            }
        }
        revert("no ReportProcessed");
    }

    function test_OperatorReportIsDelivered() public {
        uint40 t = uint40(block.timestamp);
        assertTrue(_send(operator, _report(t, SIGMA_48), bytes32(uint256(1))));
        (uint40 tObs, uint32 sigmaE9,,, uint32 seq) = desk.state();
        assertEq(tObs, t);
        assertEq(sigmaE9, SIGMA_48);
        assertEq(seq, 1);
    }

    function test_ThirdPartyReportIsSwallowedNotReverted() public {
        uint40 t = uint40(block.timestamp);
        assertFalse(_send(attacker, _report(t, 0), bytes32(uint256(2))));
        (,,,, uint32 seq) = desk.state();
        assertEq(seq, 0);
    }
}
```

- [x] **Step 2: Run, expected PASS**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path 'test/fork/*' -vv
```
Expected (`.env` holds `SEPOLIA_RPC_URL`): `[PASS] test_OperatorReportIsDelivered()`, `[PASS] test_ThirdPartyReportIsSwallowedNotReverted()`, `Suite result: ok. 2 passed`. Without the variable: `[SKIP: skipped] setUp()`. From now on, `forge test` includes these fork tests whenever `.env` sets `SEPOLIA_RPC_URL`. A third Sepolia fork test, `test_Fork_MockForwarder_WorkflowIdCheck_ReportRejected` in `contracts/test/ReceiverTemplateMetadata.t.sol` (added on 2026-10-07 in `57933bc`), lives outside `test/fork/`, so `--no-match-path 'test/fork/*'` no longer keeps the run fully offline. Measured on 2026-10-07: `forge test` with `.env` gives `76 tests passed, 0 failed, 0 skipped (76 total tests)` (73 offline plus 3 fork tests); `SEPOLIA_RPC_URL= forge test` stays offline and gives `73 tests passed, 0 failed, 2 skipped (75 total tests)` (the skipped `setUp()` of this suite counts as one).

- [x] **Step 3: Update the CRE friction log**

In `docs/feedback/cre-friction-log.md`:
- Row 1 (Simulation trust model): set its Status cell to `confirmed on a Sepolia fork (contracts/test/fork/MockForwarder.fork.t.sol): report() is permissionless; clim's tx.origin guard rejects third parties`.
- Row 2 (Docs): set its Status cell to `code side confirmed on a Sepolia fork: the deployed mock ("MockKeystoneForwarder 1.0.0") calls onReport with msg.sender = mock and tx.origin = sender; docs page still to re-find`.
- The row about a rejected report that still looks successful (`ReportProcessed(..., false)`; plan 02 adds it as "Simulation write status"): if it exists, set its Status to `confirmed with clim's RiskDesk on a Sepolia fork (test_ThirdPartyReportIsSwallowedNotReverted): tx succeeds, ReportProcessed result = false, desk unchanged`. If it does not exist, append it with the next free number:
```markdown
| <next> | Simulation write status | `MockKeystoneForwarder.report` never reverts when the consumer's `onReport` reverts: it emits `ReportProcessed(receiver, executionId, reportId, false)` and the transaction succeeds. A rejected report looks like a success. | Decode `ReportProcessed` in `cre workflow simulate --broadcast` and report the consumer's revert. | confirmed with clim's RiskDesk on a Sepolia fork (contracts/test/fork/MockForwarder.fork.t.sol) |
```
- Append the next row (replace `<next>` with the next free number):
```markdown
| <next> | Receiver template | `starter-templates/sports-resolution/.../ReceiverTemplate.sol` (cre-templates `d0223f3`) requires `metadata.length == 62`, but KeystoneForwarder and MockKeystoneForwarder pass `rawReport[45:109]` = 64 bytes (workflow id 32, name 10, owner 20, report id 2). As soon as `setExpectedWorkflowId` / `Author` / `Name` is set, every report reverts `InvalidMetadataLength(64, 62)`. Reproduced with a forge test feeding real forwarder metadata. The other templates (circuit-breaker, event-reactor, …) have no length check. | Set `METADATA_LENGTH` to 64 and add a test with real forwarder metadata. Candidate upstream PR. | verified (forge test) |
```

- [x] **Step 4: Log it**

Append under `## Contracts (plan 01)` in `docs/sessions/2026-10-06.md`:
```markdown
- **Mock forwarder behaviour verified on a Sepolia fork:** `onReport` gets `msg.sender` = mock and `tx.origin` = the sending EOA, so the SIM guard works.
  - A rejected report does not revert the transaction (`ReportProcessed(result = false)`).
  - Bots and the CRE loop must check `RiskReported` or `state().seq`, not the tx status.
```

- [x] **Step 5: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/test/fork/MockForwarder.fork.t.sol docs/feedback/cre-friction-log.md docs/sessions/2026-10-06.md && git commit -m "test(contracts): fork test of the Sepolia MockKeystoneForwarder against RiskDesk"
```

### Task 7: TestToken

**Delegable:** yes
**Depends on:** Task 2

The owner mints the pools' and the bots' tokens. `faucet()` lets any visitor of the dashboard get 10 tETH or 25,000 tUSD once per hour per address (amount fixed at construction), for the `/swap` and `/lp` pages (Frontend scope upgrade; plan 05's app calls `faucet()` with no argument). The custom error `FaucetCooldown(uint256 nextAt)` has selector `0x12272bab`.

**Files:**
- Create: `contracts/src/test-tokens/TestToken.sol`
- Test: `contracts/test/TestToken.t.sol`

- [x] **Step 1: Write the failing test**

`contracts/test/TestToken.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TestToken} from "../src/test-tokens/TestToken.sol";

contract TestTokenTest is Test {
    TestToken internal token;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

    function setUp() public {
        token = new TestToken("clim test ETH", "tETH", owner, 10e18);
    }

    function test_Metadata() public view {
        assertEq(token.name(), "clim test ETH");
        assertEq(token.symbol(), "tETH");
        assertEq(token.decimals(), 18);
        assertEq(token.owner(), owner);
        assertEq(token.faucetAmount(), 10e18);
        assertEq(token.FAUCET_COOLDOWN(), 1 hours);
    }

    function test_OwnerMints() public {
        vm.prank(owner);
        token.mint(alice, 5e18);
        assertEq(token.balanceOf(alice), 5e18);
        assertEq(token.totalSupply(), 5e18);
    }

    function test_RevertWhen_NonOwnerMints() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.mint(alice, 1);
    }

    function test_FaucetMintsFixedAmount() public {
        vm.prank(alice);
        token.faucet();
        assertEq(token.balanceOf(alice), 10e18);
        assertEq(token.lastFaucetAt(alice), block.timestamp);
    }

    function test_RevertWhen_FaucetInCooldown() public {
        vm.prank(alice);
        token.faucet();
        uint256 nextAt = block.timestamp + 1 hours;
        vm.warp(nextAt - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestToken.FaucetCooldown.selector, nextAt));
        token.faucet();
    }

    function test_FaucetWorksAgainAfterCooldown() public {
        vm.prank(alice);
        token.faucet();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        token.faucet();
        assertEq(token.balanceOf(alice), 20e18);
    }
}
```

- [x] **Step 2: Run it, expected FAIL**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/TestToken.t.sol
```
Expected: `Error (6275): Source "src/test-tokens/TestToken.sol" not found`.

- [x] **Step 3: Minimal implementation**

`contracts/src/test-tokens/TestToken.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestToken
/// @notice 18-decimal testnet token (tETH, tUSD) for the clim twin pools. The owner mints for the pools and the bots;
///         anyone can call faucet() once per FAUCET_COOLDOWN to try the dashboard's /swap and /lp pages.
contract TestToken is ERC20, Ownable {
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    uint256 public immutable faucetAmount;
    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 nextAt);

    constructor(string memory name_, string memory symbol_, address owner_, uint256 faucetAmount_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        faucetAmount = faucetAmount_;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Sends faucetAmount to the caller, at most once per FAUCET_COOLDOWN per address. Testnet only.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
    }
}
```

- [x] **Step 4: Run, expected PASS**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/TestToken.t.sol
```
Expected: `Suite result: ok. 6 passed; 0 failed; 0 skipped`.

- [x] **Step 5: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/src/test-tokens/TestToken.sol contracts/test/TestToken.t.sol && git commit -m "feat(contracts): 18-decimal TestToken with owner mint and a public faucet"
```

### Task 8: ClimHook

**Delegable:** no
**Depends on:** Tasks 3, 5

**Files:**
- Create: `contracts/src/ClimHook.sol`
- Test: `contracts/test/utils/HookHelpers.sol`, `contracts/test/ClimHook.t.sol`

- [x] **Step 1: Write the v4 fixtures and the failing test**

`HookHelpers` uses v4-core's `Deployers`, which provides a real `PoolManager`, routers and sorted, minted, approved currencies. It deploys the hook with `deployCodeTo` at an address whose low bits are `AFTER_INITIALIZE_FLAG | BEFORE_SWAP_FLAG`, and reads the fee actually charged from the `Swap` event.

`contracts/test/utils/HookHelpers.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {ClimHook} from "../../src/ClimHook.sol";
import {RiskDesk} from "../../src/RiskDesk.sol";
import {IRiskDesk} from "../../src/interfaces/IRiskDesk.sol";
import {DeskHelpers} from "./DeskHelpers.sol";

/// @notice v4 fixtures shared by the hook and integration tests: a real PoolManager, a desk, a hook at a flag address.
abstract contract HookHelpers is Deployers, DeskHelpers {
    // Post-audit calibration used in tests: P* = 30 %, Sepolia 12 s blocks.
    uint32 internal constant ETA_E4 = 25_093;
    uint32 internal constant SQRT_HALF_DT_E6 = 2_449_490;
    uint24 internal constant FEE_MIN = 500;
    uint24 internal constant FEE_MAX = 15_000;
    uint24 internal constant FEE_SAFE = 3_000;
    uint32 internal constant TAU_KILL = 180;
    int24 internal constant TICK_SPACING = 60;
    uint128 internal constant LIQ = 1e21;

    /// @dev afterInitialize | beforeSwap, xor-ed high bits so the address is not a precompile.
    address internal constant HOOK_ADDRESS =
        address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) ^ (0x4444 << 144));

    function _hookArgs(IRiskDesk desk_) internal view returns (bytes memory) {
        return abi.encode(manager, desk_, ETA_E4, SQRT_HALF_DT_E6, FEE_MIN, FEE_MAX, FEE_SAFE, TAU_KILL);
    }

    function _deployHook(IRiskDesk desk_) internal returns (ClimHook) {
        deployCodeTo("ClimHook.sol:ClimHook", _hookArgs(desk_), HOOK_ADDRESS);
        return ClimHook(HOOK_ADDRESS);
    }

    function _addFullRange(PoolKey memory k, uint128 liquidity) internal {
        modifyLiquidityRouter.modifyLiquidity(
            k,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(TICK_SPACING),
                tickUpper: TickMath.maxUsableTick(TICK_SPACING),
                liquidityDelta: int256(uint256(liquidity)),
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    /// @dev Swaps through PoolSwapTest and returns the `fee` field of PoolManager's Swap event: the fee actually charged.
    function _swapFee(PoolKey memory k, bool zeroForOne, int256 amountSpecified) internal returns (uint24 fee) {
        vm.recordLogs();
        swap(k, zeroForOne, amountSpecified, ZERO_BYTES);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == IPoolManager.Swap.selector) {
                (,,,,, fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return fee;
            }
        }
        revert("no Swap event");
    }
}
```

`contracts/test/ClimHook.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {BaseOverrideFee} from "@openzeppelin/uniswap-hooks/fee/BaseOverrideFee.sol";

import {ClimHook} from "../src/ClimHook.sol";
import {RiskDesk} from "../src/RiskDesk.sol";
import {ClimFeeMath} from "../src/libraries/ClimFeeMath.sol";
import {HookHelpers} from "./utils/HookHelpers.sol";

contract ClimHookTest is HookHelpers {
    RiskDesk internal desk;
    ClimHook internal hook;

    function setUp() public {
        vm.warp(T0);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        desk = new RiskDesk(forwarder, operator, false);
        hook = _deployHook(desk);
        (key,) = initPool(
            currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, TICK_SPACING, SQRT_PRICE_1_1
        );
        _addFullRange(key, LIQ);
    }

    function _expected(uint32 sigmaE9, uint16 kE4) internal pure returns (uint24) {
        return ClimFeeMath.feePips(sigmaE9, ETA_E4, SQRT_HALF_DT_E6, kE4, FEE_MIN, FEE_MAX);
    }

    // ---------------------------------------------------------------- configuration

    function test_PermissionsAreAfterInitializeAndBeforeSwapOnly() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.afterInitialize);
        assertTrue(p.beforeSwap);
        assertFalse(p.beforeInitialize);
        assertFalse(p.afterSwap);
        assertFalse(p.beforeAddLiquidity);
        assertFalse(p.beforeSwapReturnDelta);
    }

    function test_ImmutablesMatchConstructorArgs() public view {
        assertEq(address(hook.poolManager()), address(manager));
        assertEq(address(hook.desk()), address(desk));
        assertEq(hook.etaE4(), ETA_E4);
        assertEq(hook.sqrtHalfDtE6(), SQRT_HALF_DT_E6);
        assertEq(hook.feeMinPips(), FEE_MIN);
        assertEq(hook.feeMaxPips(), FEE_MAX);
        assertEq(hook.feeSafePips(), FEE_SAFE);
        assertEq(hook.tauKillSec(), TAU_KILL);
    }

    function test_RevertWhen_FeeBoundsAreInconsistent() public {
        address target = address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) ^ (0x5555 << 144));
        bytes memory badArgs =
            abi.encode(manager, desk, ETA_E4, SQRT_HALF_DT_E6, uint24(4_000), FEE_MAX, FEE_SAFE, TAU_KILL); // min > safe
        vm.expectRevert(ClimHook.InvalidParams.selector);
        deployCodeTo("ClimHook.sol:ClimHook", badArgs, target);

        bytes memory zeroFloor =
            abi.encode(manager, desk, ETA_E4, SQRT_HALF_DT_E6, uint24(0), FEE_MAX, FEE_SAFE, TAU_KILL); // floor 0
        vm.expectRevert(ClimHook.InvalidParams.selector);
        deployCodeTo("ClimHook.sol:ClimHook", zeroFloor, target);
    }

    function test_RevertWhen_PoolHasAStaticFee() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.afterInitialize.selector,
                abi.encodeWithSelector(BaseOverrideFee.NotDynamicFee.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        initPool(currency0, currency1, IHooks(address(hook)), 3000, TICK_SPACING, SQRT_PRICE_1_1);
    }

    // ---------------------------------------------------------------- quoteFee modes

    function test_BlindBeforeTheFirstReport() public view {
        (uint24 fee, uint8 mode) = hook.quoteFee();
        assertEq(fee, FEE_SAFE);
        assertEq(mode, hook.MODE_BLIND());
    }

    function test_NormalQuoteFollowsTheDesk() public {
        _deliver(desk, _report(T0, SIGMA_100));
        (uint24 fee, uint8 mode) = hook.quoteFee();
        assertEq(fee, 1095); // 100 %/yr at P* = 30 %: 10.95 bp
        assertEq(fee, _expected(SIGMA_100, 10_000));
        assertEq(mode, hook.MODE_NORMAL());
    }

    function test_CalmMarketPaysTheFloor() public {
        _deliver(desk, _report(T0, SIGMA_10));
        (uint24 fee, uint8 mode) = hook.quoteFee();
        assertEq(fee, FEE_MIN);
        assertEq(mode, hook.MODE_NORMAL());
    }

    function test_DegradedRaisesToTheSafeFee() public {
        _deliver(desk, _report(T0, SIGMA_100, 26, 4, 10_000));
        (uint24 fee, uint8 mode) = hook.quoteFee();
        assertEq(fee, FEE_SAFE);
        assertEq(mode, hook.MODE_DEGRADED());
    }

    function test_BlindStartsStrictlyAfterTauKill() public {
        _deliver(desk, _report(T0, SIGMA_100));
        vm.warp(T0 + TAU_KILL);
        (uint24 fee, uint8 mode) = hook.quoteFee();
        assertEq(fee, 1095);
        assertEq(mode, hook.MODE_NORMAL());

        vm.warp(T0 + TAU_KILL + 1);
        (fee, mode) = hook.quoteFee();
        assertEq(fee, FEE_SAFE);
        assertEq(mode, hook.MODE_BLIND());
    }

    function test_BlindKeepsAStormFeeAboveTheSafeFee() public {
        _deliver(desk, _report(T0, SIGMA_300));
        uint24 storm = _expected(SIGMA_300, 10_000);
        assertEq(storm, 3284);
        vm.warp(T0 + TAU_KILL + 1);
        (uint24 fee, uint8 mode) = hook.quoteFee();
        assertEq(fee, storm);
        assertEq(mode, hook.MODE_BLIND());
    }

    function test_RecoversWhenTheDeskResumes() public {
        _deliver(desk, _report(T0, SIGMA_100));
        vm.warp(T0 + 600);
        (, uint8 mode) = hook.quoteFee();
        assertEq(mode, hook.MODE_BLIND());
        _deliver(desk, _report(T0 + 600, SIGMA_100));
        (uint24 fee, uint8 mode2) = hook.quoteFee();
        assertEq(fee, 1095);
        assertEq(mode2, hook.MODE_NORMAL());
    }

    function test_CappedAtTheMaxFee() public {
        _deliver(desk, _report(T0, 1_780_730, 3, 4, 20_000));
        (uint24 fee,) = hook.quoteFee();
        assertEq(fee, FEE_MAX);
    }

    // ---------------------------------------------------------------- swaps pay exactly quoteFee

    function test_SwapPaysExactlyQuoteFee_BothDirections() public {
        _deliver(desk, _report(T0, SIGMA_100));
        (uint24 quoted,) = hook.quoteFee();
        assertEq(_swapFee(key, true, -1e18), quoted);
        assertEq(_swapFee(key, false, -1e18), quoted);
        assertEq(_swapFee(key, true, 1e17), quoted); // exact output
    }

    function test_SwapPaysTheSafeFeeWhenBlind() public {
        assertEq(_swapFee(key, true, -1e18), FEE_SAFE);
    }

    function test_SwapPaysTheSafeFeeWhenDegraded() public {
        _deliver(desk, _report(T0, SIGMA_100, 40, 4, 10_000));
        assertEq(_swapFee(key, false, -1e18), FEE_SAFE);
    }

    /// The fee depends only on the desk, never on pool state or trade size: splitting a trade cannot lower it.
    function test_SplittingASwapDoesNotChangeItsFee() public {
        _deliver(desk, _report(T0, SIGMA_100));
        uint24 whole = _swapFee(key, true, -10e18);
        for (uint256 i; i < 10; i++) {
            assertEq(_swapFee(key, true, -1e18), whole);
        }
        assertEq(_swapFee(key, false, -25e18), whole); // price moved a lot, fee did not
    }

    function testFuzz_SwapFeeEqualsQuoteFee(uint32 sigmaE9, uint16 kE4, uint16 dispBp, uint32 elapsed, bool zeroForOne)
        public
    {
        sigmaE9 = uint32(bound(sigmaE9, 0, 2_000_000));
        elapsed = uint32(bound(elapsed, 0, 1_000));
        _deliver(desk, _report(T0, sigmaE9, dispBp, 4, kE4));
        vm.warp(T0 + elapsed);

        (uint24 quoted, uint8 mode) = hook.quoteFee();
        assertEq(_swapFee(key, zeroForOne, -1e17), quoted);
        assertGe(quoted, FEE_MIN);
        assertLe(quoted, FEE_MAX);
        if (mode != hook.MODE_NORMAL()) assertGe(quoted, FEE_SAFE);
    }
}
```

- [x] **Step 2: Run it, expected FAIL**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/ClimHook.t.sol
```
Expected: `Error (6275): Source "src/ClimHook.sol" not found`.

- [x] **Step 3: Minimal implementation**

`contracts/src/ClimHook.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {BaseOverrideFee} from "@openzeppelin/uniswap-hooks/fee/BaseOverrideFee.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {IRiskDesk, FLAG_DEGRADED} from "./interfaces/IRiskDesk.sol";
import {ClimFeeMath} from "./libraries/ClimFeeMath.sol";

/// @title ClimHook
/// @notice Uniswap v4 hook that quotes a symmetric LP fee from the clim risk desk on every swap:
///         fee = clamp(ceil(eta * k * sigma * sqrt(blockTime / 2)), feeMin, feeMax),
///         raised to at least feeSafe when the desk is blind (silent > tauKillSec, or never reported)
///         or degraded (venues disagree). All parameters are immutable: one hook = one risk profile.
contract ClimHook is BaseOverrideFee {
    uint8 public constant MODE_NORMAL = 0;
    uint8 public constant MODE_DEGRADED = 1;
    uint8 public constant MODE_BLIND = 2;

    IRiskDesk public immutable desk;
    uint32 public immutable etaE4;
    uint32 public immutable sqrtHalfDtE6;
    uint24 public immutable feeMinPips;
    uint24 public immutable feeMaxPips;
    uint24 public immutable feeSafePips;
    uint32 public immutable tauKillSec;

    error InvalidParams();

    constructor(
        IPoolManager poolManager_,
        IRiskDesk desk_,
        uint32 etaE4_,
        uint32 sqrtHalfDtE6_,
        uint24 feeMinPips_,
        uint24 feeMaxPips_,
        uint24 feeSafePips_,
        uint32 tauKillSec_
    ) BaseHook(poolManager_) {
        if (
            address(desk_) == address(0) || etaE4_ == 0 || sqrtHalfDtE6_ == 0 || tauKillSec_ == 0 || feeMinPips_ == 0
                || feeMinPips_ > feeSafePips_ || feeSafePips_ > feeMaxPips_ || feeMaxPips_ > LPFeeLibrary.MAX_LP_FEE
        ) revert InvalidParams();
        desk = desk_;
        etaE4 = etaE4_;
        sqrtHalfDtE6 = sqrtHalfDtE6_;
        feeMinPips = feeMinPips_;
        feeMaxPips = feeMaxPips_;
        feeSafePips = feeSafePips_;
        tauKillSec = tauKillSec_;
    }

    /// @notice The fee the next swap will pay, in pips (1 bp = 100 pips), and why.
    /// @return fee LP fee in pips.
    /// @return mode MODE_NORMAL, MODE_DEGRADED or MODE_BLIND.
    function quoteFee() public view returns (uint24 fee, uint8 mode) {
        (uint40 tObs, uint32 sigmaE9, uint16 kE4, uint8 flags,) = desk.state();
        fee = ClimFeeMath.feePips(sigmaE9, etaE4, sqrtHalfDtE6, kE4, feeMinPips, feeMaxPips);
        if (tObs == 0 || block.timestamp > uint256(tObs) + tauKillSec) {
            return (fee > feeSafePips ? fee : feeSafePips, MODE_BLIND);
        }
        if (flags & FLAG_DEGRADED != 0) {
            return (fee > feeSafePips ? fee : feeSafePips, MODE_DEGRADED);
        }
        return (fee, MODE_NORMAL);
    }

    function _getFee(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (uint24 fee)
    {
        (fee,) = quoteFee();
    }
}
```

- [x] **Step 4: Run, expected PASS**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/ClimHook.t.sol
```
Expected: `Suite result: ok. 17 passed; 0 failed; 0 skipped`. The fuzz test swaps through the real PoolManager 1,000 times, which takes about one second.

- [x] **Step 5: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/src/ClimHook.sol contracts/test/utils/HookHelpers.sol contracts/test/ClimHook.t.sol && git commit -m "feat(contracts): ClimHook dynamic LP fee from RiskDesk with blind and degraded floors"
```

### Task 9: Integration test (twin pools, one storm)

**Delegable:** yes
**Depends on:** Task 8

**Files:**
- Test: `contracts/test/Integration.t.sol`

- [x] **Step 1: Write the test**

The story it tells:
- blind before the first report;
- calm at 48 %/yr, 526 pips;
- a storm capped by the envelope: 1,051, then 2,102, then 4,203;
- a spoofed report rejected;
- blind with the storm fee kept;
- recovery, with σ decaying 20 % per report.

V and S get identical swaps; S always charges 1,000.

`contracts/test/Integration.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {ClimHook} from "../src/ClimHook.sol";
import {RiskDesk} from "../src/RiskDesk.sol";
import {HookHelpers} from "./utils/HookHelpers.sol";

/// @notice One storm, end to end: CRE reports -> RiskDesk -> ClimHook -> pool V, next to static pool S.
contract IntegrationTest is HookHelpers {
    using StateLibrary for IPoolManager;

    uint24 internal constant STATIC_FEE = 1_000; // S charges the time-average fee of V (10 bp here)

    RiskDesk internal desk;
    ClimHook internal hook;
    PoolKey internal keyV;
    PoolKey internal keyS;

    function setUp() public {
        vm.warp(T0);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        desk = new RiskDesk(forwarder, operator, false);
        hook = _deployHook(desk);
        (keyV,) = initPool(
            currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, TICK_SPACING, SQRT_PRICE_1_1
        );
        (keyS,) = initPool(currency0, currency1, IHooks(address(0)), STATIC_FEE, TICK_SPACING, SQRT_PRICE_1_1);
        _addFullRange(keyV, LIQ);
        _addFullRange(keyS, LIQ);
    }

    function _assertTwinFees(uint24 expectedV, uint8 expectedMode) internal {
        (uint24 quoted, uint8 mode) = hook.quoteFee();
        assertEq(quoted, expectedV, "V quote");
        assertEq(mode, expectedMode, "V mode");
        assertEq(_swapFee(keyV, true, -1e18), expectedV, "V swap fee");
        assertEq(_swapFee(keyS, true, -1e18), STATIC_FEE, "S swap fee");
        // round trip so both pools stay near the same price
        _swapFee(keyV, false, -1e18);
        _swapFee(keyS, false, -1e18);
    }

    function test_TwinPoolsHaveTheSameLiquidity() public view {
        assertEq(manager.getLiquidity(keyV.toId()), manager.getLiquidity(keyS.toId()));
        assertEq(manager.getLiquidity(keyV.toId()), LIQ);
    }

    function test_StormLifecycle() public {
        // 1. Desk never reported: V quotes the safe fee.
        _assertTwinFees(FEE_SAFE, hook.MODE_BLIND());

        // 2. Calm market (48 %/yr): V quotes 5.26 bp, next to the 5 bp market tier.
        _deliver(desk, _report(T0, SIGMA_48));
        _assertTwinFees(526, hook.MODE_NORMAL());

        // 3. Storm: volatility doubles each report (envelope cap), the fee follows 30 s later.
        uint24[3] memory expected = [uint24(1051), 2102, 4203]; // 96 %, 192 %, 384 %/yr at P* = 30 %
        for (uint256 i; i < 3; i++) {
            uint40 t = T0 + uint40(30 * (i + 1));
            vm.warp(t);
            _deliver(desk, _report(t, 2_000_000)); // venues report far more than the envelope allows
            _assertTwinFees(expected[i], hook.MODE_NORMAL());
        }

        // 4. A third party pushes sigma = 0 through the mock forwarder: rejected, fee unchanged.
        vm.warp(T0 + 120);
        vm.prank(forwarder, attacker);
        vm.expectRevert(abi.encodeWithSelector(RiskDesk.NotSimOperator.selector, attacker));
        desk.onReport("", _report(T0 + 120, 0));
        _assertTwinFees(4203, hook.MODE_NORMAL());

        // 5. The desk goes silent for longer than tauKill: blind, the storm fee stays (above the safe fee).
        vm.warp(T0 + 90 + TAU_KILL + 1);
        _assertTwinFees(4203, hook.MODE_BLIND());

        // 6. The desk comes back after the storm: volatility can only decay 20 % per report.
        uint40 back = T0 + 90 + TAU_KILL + 1;
        _deliver(desk, _report(back, SIGMA_48));
        (, uint32 sigmaE9,,,) = desk.state();
        assertEq(sigmaE9, 547_040); // 683_800 * 0.8
        _assertTwinFees(3363, hook.MODE_NORMAL());
    }
}
```

- [x] **Step 2: Run, expected PASS**

This task adds no production code, so the test passes at once. If it fails, the bug is in Tasks 3 to 8: use superpowers:systematic-debugging, and do not edit the expected numbers without recomputing them by hand.
```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/Integration.t.sol && forge test --no-match-path 'test/fork/*'
```
Expected: `Suite result: ok. 2 passed`, then `66 tests passed, 0 failed, 0 skipped (66 total tests)`.

- [x] **Step 3: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/test/Integration.t.sol && git commit -m "test(contracts): end-to-end storm on twin pools V and S"
```

### Task 10: Script base, tokens, arbitrage router and desk scripts

**Delegable:** no
**Depends on:** Tasks 5, 7

**Files:**
- Create: `contracts/script/base/ClimScript.sol`, `contracts/script/00_Tokens.s.sol`, `contracts/script/01_DeployDesk.s.sol`, `contracts/test/fixtures/params.p30.json`

- [x] **Step 1: Write the shared script base**

`contracts/script/base/ClimScript.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";

/// @notice Shared plumbing for the clim deploy scripts.
///         Each step writes a JSON fragment to deployments/<chainId>/; 05_WriteDeployments merges them into shared/.
///         Env: PRIVATE_KEY (deployer = simOperator), SUITE = live | replay | don (default live),
///         PARAMS_PATH (default ../shared/params.json).
abstract contract ClimScript is Script {
    // Sepolia infrastructure, verified on-chain in Task 1 of plan 01.
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant STATE_VIEW = 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C;
    address internal constant POOL_SWAP_TEST = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;
    address internal constant POOL_MODIFY_LIQUIDITY_TEST = 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A;
    address internal constant MOCK_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    address internal constant KEYSTONE_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;
    uint256 internal constant SEPOLIA = 11155111;

    int24 internal constant TICK_SPACING = 60;

    struct HookParams {
        uint32 etaE4;
        uint32 sqrtHalfDtE6;
        uint24 feeMinPips;
        uint24 feeMaxPips;
        uint24 feeSafePips;
        uint32 tauKillSec;
    }

    function _pk() internal view returns (uint256) {
        return vm.envUint("PRIVATE_KEY");
    }

    function _suite() internal view returns (string memory suite) {
        suite = vm.envOr("SUITE", string("live"));
        bytes32 h = keccak256(bytes(suite));
        require(
            h == keccak256("live") || h == keccak256("replay") || h == keccak256("don"),
            "SUITE must be live, replay or don"
        );
    }

    function _isReplay() internal view returns (bool) {
        return keccak256(bytes(_suite())) == keccak256("replay");
    }

    function _isDon() internal view returns (bool) {
        return keccak256(bytes(_suite())) == keccak256("don");
    }

    /// @dev Hooks and pools exist only for the live and replay suites; the DON desk is a desk alone.
    function _requirePoolSuite() internal view {
        require(!_isDon(), "SUITE=don has no hook and no pools");
    }

    function _dir() internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), "/");
    }

    function _path(string memory name) internal view returns (string memory) {
        return string.concat(_dir(), name, ".json");
    }

    /// @dev Suite-scoped fragment, e.g. deployments/11155111/desk-live.json.
    function _suitePath(string memory name) internal view returns (string memory) {
        return _path(string.concat(name, "-", _suite()));
    }

    function _write(string memory path, string memory json) internal {
        vm.createDir(_dir(), true);
        vm.writeJson(json, path);
    }

    function _readAddress(string memory path, string memory key) internal view returns (address) {
        return vm.parseJsonAddress(vm.readFile(path), key);
    }

    function _paramsJson() internal view returns (string memory) {
        return vm.readFile(vm.envOr("PARAMS_PATH", string("../shared/params.json")));
    }

    /// @dev The immutable ClimHook parameters, as decided by the lab (plan 03).
    function _hookParams() internal view returns (HookParams memory p) {
        string memory json = _paramsJson();
        p.etaE4 = uint32(_u(json, ".etaE4", type(uint32).max));
        p.sqrtHalfDtE6 = uint32(_u(json, ".sqrtHalfDtE6", type(uint32).max));
        p.feeMinPips = uint24(_u(json, ".feeMinPips", 1_000_000));
        p.feeMaxPips = uint24(_u(json, ".feeMaxPips", 1_000_000));
        p.feeSafePips = uint24(_u(json, ".feeSafePips", 1_000_000));
        p.tauKillSec = uint32(_u(json, ".tauKillSec", type(uint32).max));
    }

    /// @dev Static fee of pool S: the lab's estimate of V's time-average fee (staticFeePips / replayStaticFeePips).
    function _staticFee(bool replay) internal view returns (uint24) {
        string memory json = _paramsJson();
        string memory key = replay ? ".replayStaticFeePips" : ".staticFeePips";
        require(
            vm.keyExistsJson(json, key), string.concat("params.json has no ", key, ": the lab decision must add it")
        );
        return uint24(_u(json, key, 1_000_000));
    }

    /// @dev Refuses bootstrap or fixture parameters on Sepolia: hook parameters are immutable.
    function _requireDecidedParams() internal view {
        if (block.chainid != SEPOLIA) return;
        bytes memory by = bytes(vm.parseJsonString(_paramsJson(), ".decidedBy"));
        require(!_startsWith(by, "PROVISIONAL") && !_startsWith(by, "FIXTURE"), "params.json is not a lab decision");
    }

    function _startsWith(bytes memory s, bytes memory prefix) private pure returns (bool) {
        if (s.length < prefix.length) return false;
        for (uint256 i; i < prefix.length; i++) {
            if (s[i] != prefix[i]) return false;
        }
        return true;
    }

    function _u(string memory json, string memory key, uint256 max) private pure returns (uint256 v) {
        v = vm.parseJsonUint(json, key);
        require(v <= max, string.concat("params out of range: ", key));
    }
}
```

- [x] **Step 2: Write 00_Tokens and 01_DeployDesk**

`contracts/script/00_Tokens.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {ClimScript} from "./base/ClimScript.sol";
import {TestToken} from "../src/test-tokens/TestToken.sol";

/// @notice Deploys tETH and tUSD (18 decimals), mints them to the deployer, and deploys the arbitrage router:
///         a second PoolSwapTest that only the arbitrage bot uses, so the dashboard can tell arbitrage swaps
///         from retail swaps by `Swap.sender` (plan 05). One token pair and one arbitrage router serve every suite.
///         Public faucet: 10 tETH and 25,000 tUSD per address per hour (TestToken.faucet, for the dashboard's /swap and /lp).
/// Env: MINT_TETH (whole tokens, default 1_000_000), MINT_TUSD (whole tokens, default 10_000_000_000).
contract DeployTokens is ClimScript {
    function run() external {
        uint256 pk = _pk();
        address deployer = vm.addr(pk);
        uint256 mintEth = vm.envOr("MINT_TETH", uint256(1_000_000)) * 1e18;
        uint256 mintUsd = vm.envOr("MINT_TUSD", uint256(10_000_000_000)) * 1e18;
        uint256 deployBlock = block.number;

        vm.startBroadcast(pk);
        TestToken teth = new TestToken("clim test ETH", "tETH", deployer, 10e18);
        TestToken tusd = new TestToken("clim test USD", "tUSD", deployer, 25_000e18);
        teth.mint(deployer, mintEth);
        tusd.mint(deployer, mintUsd);
        PoolSwapTest arbRouter = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        vm.stopBroadcast();

        string memory o = "tokens";
        vm.serializeAddress(o, "tETH", address(teth));
        vm.serializeAddress(o, "tUSD", address(tusd));
        vm.serializeAddress(o, "arbRouter", address(arbRouter));
        string memory json = vm.serializeUint(o, "deployBlock", deployBlock);
        _write(_path("tokens"), json);
    }
}
```

`contracts/script/01_DeployDesk.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ClimScript} from "./base/ClimScript.sol";
import {RiskDesk} from "../src/RiskDesk.sol";

/// @notice Deploys the RiskDesk of a suite. simOperator = the key `cre workflow simulate --broadcast` uses: the deployer,
///         or SIM_OPERATOR (Task 18 gives the replay desk its own operator key, so the two CRE loops never share a nonce).
///         SUITE=don deploys the desk for a real DON deployment: production KeystoneForwarder, simulation mode off.
/// Env: SUITE (live | replay | don), FORWARDER (default: MockKeystoneForwarder, KeystoneForwarder for don),
///      SIM_OPERATOR (default: the deployer).
contract DeployDesk is ClimScript {
    function run() external {
        uint256 pk = _pk();
        address deployer = vm.addr(pk);
        address simOp = vm.envOr("SIM_OPERATOR", deployer);
        bool don = _isDon();
        address forwarder = vm.envOr("FORWARDER", don ? KEYSTONE_FORWARDER : MOCK_FORWARDER);
        uint256 deployBlock = block.number;

        vm.startBroadcast(pk);
        RiskDesk desk = new RiskDesk(forwarder, simOp, _isReplay());
        if (don) desk.disableSim();
        vm.stopBroadcast();

        string memory o = "desk";
        vm.serializeAddress(o, "riskDesk", address(desk));
        vm.serializeAddress(o, "forwarder", forwarder);
        vm.serializeAddress(o, "simOperator", simOp);
        vm.serializeBool(o, "simMode", desk.simMode());
        string memory json = vm.serializeUint(o, "deployBlock", deployBlock);
        _write(_suitePath("desk"), json);
    }
}
```

- [x] **Step 3: Write the dry-run params fixture**

`contracts/test/fixtures/params.p30.json`. Its `decidedBy` starts with `FIXTURE`, so `02_DeployHook` refuses it on Sepolia.
```json
{
  "pStar": 0.3,
  "etaE4": 25093,
  "sqrtHalfDtE6": 2449490,
  "feeMinPips": 500,
  "feeMaxPips": 15000,
  "feeSafePips": 3000,
  "tauKillSec": 180,
  "staticFeePips": 600,
  "replayStaticFeePips": 2500,
  "decidedBy": "FIXTURE (dry runs only, not a lab decision)"
}
```

- [x] **Step 4: Build**

```bash
cd ~/Development/hackathons/clim/contracts && forge build
```
Expected: `Compiler run successful!`. These scripts run for real in Task 15, on a fork.

- [x] **Step 5: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/script/base/ClimScript.sol contracts/script/00_Tokens.s.sol contracts/script/01_DeployDesk.s.sol contracts/test/fixtures/params.p30.json && git commit -m "feat(contracts): deploy script base, test tokens, arbitrage router and RiskDesk scripts"
```

### Task 11: 02_DeployHook

**Delegable:** no
**Depends on:** Tasks 8, 10

**Files:**
- Create: `contracts/script/02_DeployHook.s.sol`

- [x] **Step 1: Write the script**

The hook is deployed by a raw call to the CREATE2 deployer (`salt ‖ initCode`), not `new ClimHook{salt: …}(8 args)`. That expression hits "stack too deep" without `via_ir`.
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {ClimScript} from "./base/ClimScript.sol";
import {ClimHook} from "../src/ClimHook.sol";

/// @notice Mines a CREATE2 salt for the afterInitialize|beforeSwap flags and deploys the suite's ClimHook
///         through the deterministic deployment proxy, with the immutable parameters decided by the lab.
///         On Sepolia it refuses params.json files whose decidedBy starts with PROVISIONAL or FIXTURE.
/// Env: SUITE (live | replay), PARAMS_PATH.
contract DeployHook is ClimScript {
    function run() external {
        _requirePoolSuite();
        _requireDecidedParams();
        uint256 pk = _pk();
        address desk = _readAddress(_suitePath("desk"), ".riskDesk");
        bytes memory args = _args(_hookParams(), desk);

        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        (address predicted, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(ClimHook).creationCode, args);
        uint256 deployBlock = block.number;

        vm.startBroadcast(pk);
        (bool ok,) = CREATE2_FACTORY.call(abi.encodePacked(salt, type(ClimHook).creationCode, args));
        vm.stopBroadcast();
        require(ok && predicted.code.length > 0, "DeployHook: CREATE2 deployment failed");
        require(address(ClimHook(predicted).desk()) == desk, "DeployHook: wrong desk");

        string memory o = "hook";
        vm.serializeAddress(o, "hook", predicted);
        vm.serializeBytes32(o, "salt", salt);
        string memory json = vm.serializeUint(o, "deployBlock", deployBlock);
        _write(_suitePath("hook"), json);
    }

    /// @dev Constructor args in ClimHook order: (poolManager, desk, etaE4, sqrtHalfDtE6, feeMin, feeMax, feeSafe, tauKill).
    function _args(HookParams memory p, address desk) internal pure returns (bytes memory) {
        return abi.encode(
            POOL_MANAGER, desk, p.etaE4, p.sqrtHalfDtE6, p.feeMinPips, p.feeMaxPips, p.feeSafePips, p.tauKillSec
        );
    }
}
```

- [x] **Step 2: Build**

```bash
cd ~/Development/hackathons/clim/contracts && forge build
```
Expected: `Compiler run successful!`

- [x] **Step 3: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/script/02_DeployHook.s.sol && git commit -m "feat(contracts): mined CREATE2 deployment of ClimHook from params.json"
```

### Task 12: 03_CreatePools

**Delegable:** no
**Depends on:** Task 11

**Files:**
- Create: `contracts/script/03_CreatePools.s.sol`
- Test: `contracts/test/CreatePools.t.sol`
- Modify: `docs/superpowers/specs/2026-10-06-clim-design.md`, `docs/sessions/2026-10-06.md`

- [x] **Step 1: Write the failing test**

`contracts/test/CreatePools.t.sol`. The pool tick for ETH = $4,000 is ⌊ln 4000 / ln 1.0001⌋ = 82,944 when tETH is token0, and −82,945 otherwise. This is also the `refTick` convention of the CRE report.
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CreatePools} from "../script/03_CreatePools.s.sol";

contract CreatePoolsTest is Test {
    CreatePools internal script = new CreatePools();

    /// ln(4000) / ln(1.0001) = 82_944.6: the pool tick is the refTick the CRE workflow must publish.
    function test_TickWhenEthIsToken0() public view {
        uint160 sqrtP = script.sqrtPriceX96FromEthUsd(4000, true);
        assertEq(TickMath.getTickAtSqrtPrice(sqrtP), 82_944);
    }

    function test_TickWhenEthIsToken1() public view {
        uint160 sqrtP = script.sqrtPriceX96FromEthUsd(4000, false);
        assertEq(TickMath.getTickAtSqrtPrice(sqrtP), -82_945);
    }

    function test_RevertWhen_PriceIsZero() public {
        vm.expectRevert(bytes("CreatePools: INIT_ETH_USD out of range"));
        script.sqrtPriceX96FromEthUsd(0, true);
    }
}
```

- [x] **Step 2: Run it, expected FAIL**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/CreatePools.t.sol
```
Expected: `Error (6275): Source "script/03_CreatePools.s.sol" not found`.

- [x] **Step 3: Minimal implementation**

`contracts/script/03_CreatePools.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {ClimScript} from "./base/ClimScript.sol";

/// @notice Initializes the twin pools of a suite at the same price:
///         V = dynamic fee + ClimHook, S = static fee equal to V's expected time-average fee (params.json).
///         The live and replay S pools must have different static fees, or their PoolKeys collide.
/// Env: SUITE (live | replay), PARAMS_PATH, INIT_ETH_USD (whole dollars, e.g. 2713).
contract CreatePools is ClimScript {
    function run() external {
        _requirePoolSuite();
        uint256 pk = _pk();
        uint24 staticFee = _staticFee(_isReplay());
        require(staticFee > 0 && staticFee <= LPFeeLibrary.MAX_LP_FEE, "CreatePools: static fee out of range");
        // One token pair serves both suites: the replay S PoolKey differs from the live S one only by its fee.
        if (_isReplay()) {
            require(staticFee != _staticFee(false), "CreatePools: replay S fee must differ from live S fee");
        }

        address teth = _readAddress(_path("tokens"), ".tETH");
        address tusd = _readAddress(_path("tokens"), ".tUSD");
        address hook = _readAddress(_suitePath("hook"), ".hook");
        bool token0IsEth = teth < tusd;
        (Currency c0, Currency c1) =
            token0IsEth ? (Currency.wrap(teth), Currency.wrap(tusd)) : (Currency.wrap(tusd), Currency.wrap(teth));

        uint256 ethUsd = vm.envUint("INIT_ETH_USD");
        uint160 sqrtPriceX96 = sqrtPriceX96FromEthUsd(ethUsd, token0IsEth);

        PoolKey memory keyV = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, TICK_SPACING, IHooks(hook));
        PoolKey memory keyS = PoolKey(c0, c1, staticFee, TICK_SPACING, IHooks(address(0)));

        vm.startBroadcast(pk);
        IPoolManager(POOL_MANAGER).initialize(keyV, sqrtPriceX96);
        IPoolManager(POOL_MANAGER).initialize(keyS, sqrtPriceX96);
        vm.stopBroadcast();

        string memory o = "pools";
        vm.serializeString(o, "V", _keyJson("V", keyV));
        vm.serializeString(o, "S", _keyJson("S", keyS));
        vm.serializeUint(o, "initEthUsd", ethUsd);
        string memory json = vm.serializeUint(o, "sqrtPriceX96", sqrtPriceX96);
        _write(_suitePath("pools"), json);
    }

    /// @dev Both tokens have 18 decimals, so the raw price is the human price: token1 per token0.
    function sqrtPriceX96FromEthUsd(uint256 ethUsd, bool token0IsEth) public pure returns (uint160) {
        require(ethUsd > 0 && ethUsd < 1e9, "CreatePools: INIT_ETH_USD out of range");
        uint256 ratioX192 = token0IsEth ? ethUsd << 192 : (uint256(1) << 192) / ethUsd;
        return uint160(Math.sqrt(ratioX192));
    }

    function _keyJson(string memory o, PoolKey memory k) internal returns (string memory) {
        vm.serializeAddress(o, "currency0", Currency.unwrap(k.currency0));
        vm.serializeAddress(o, "currency1", Currency.unwrap(k.currency1));
        vm.serializeUint(o, "fee", k.fee);
        vm.serializeInt(o, "tickSpacing", k.tickSpacing);
        vm.serializeAddress(o, "hooks", address(k.hooks));
        return vm.serializeBytes32(o, "poolId", PoolId.unwrap(k.toId()));
    }
}
```

- [x] **Step 4: Run, expected PASS**

```bash
cd ~/Development/hackathons/clim/contracts && forge test --match-path test/CreatePools.t.sol
```
Expected: `Suite result: ok. 3 passed; 0 failed; 0 skipped`.

- [x] **Step 5: Check the spec (one token pair, static fees in params.json)**

The plan 00 integration pass already wrote both changes into the spec (§3.7 "Replay pair" and the §2.6 `shared/params.json` table). Check they are there:
```bash
cd ~/Development/hackathons/clim && grep -c "shares the tETH/tUSD pair with the live pair" docs/superpowers/specs/2026-10-06-clim-design.md && grep -c "replayStaticFeePips" docs/superpowers/specs/2026-10-06-clim-design.md
```
Expected: `1`, then a count of at least `1`. If either is `0`, replace the spec's §3.7 "Replay pair" paragraph with
```markdown
**Replay pair.** It shares the tETH/tUSD pair with the live pair, as in plan 04's deployments schema, but has its own `RiskDesk` (REPLAY flag set) and its own `ClimHook` bound to that desk. The PoolKeys stay distinct: replay V differs by its hook, and replay S by its fee, because `03_CreatePools` refuses a `replayStaticFeePips` equal to `staticFeePips`. The two pairs have independent prices; only token balances are shared.
```
and add to the §2.6 `shared/params.json` fields table the rows
```markdown
| `staticFeePips` | integer | Fee of the live S pool: the lab's forecast of V's time-average fee over the demo window |
| `replayStaticFeePips` | integer | Fee of the replay S pool: V's exact time-average fee over the replay window; must differ from `staticFeePips` |
```

- [x] **Step 6: Log it**

Append under `## Contracts (plan 01)` in `docs/sessions/2026-10-06.md`:
```markdown
- **Decision: one token pair for the live and replay suites** (matches plan 04's deployments schema). Spec §3.7 is updated.
  - `03_CreatePools` refuses `replayStaticFeePips == staticFeePips`, the only way the two S keys could collide.
  - The S fees come from `shared/params.json` (`staticFeePips`, `replayStaticFeePips`), written by the lab.
```

- [x] **Step 7: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/script/03_CreatePools.s.sol contracts/test/CreatePools.t.sol docs/superpowers/specs/2026-10-06-clim-design.md docs/sessions/2026-10-06.md && git commit -m "feat(contracts): twin pool initialization script, spec update for the shared token pair"
```

### Task 13: 04_AddLiquidity and 05_WriteDeployments

**Delegable:** no
**Depends on:** Task 12

**Files:**
- Create: `contracts/script/04_AddLiquidity.s.sol`, `contracts/script/05_WriteDeployments.s.sol`

- [x] **Step 1: Write 04_AddLiquidity**

L is sized so that each pool holds `LIQ_TETH` tETH at the initial price. The default of 100,000 tETH gives L ≈ 5.2e24 at $2,713, the depth plan 04 asks for: a $2,000 retail order then moves the price about 0.15 bp (measured 0.147 bp on a Sepolia fork), far below the per-block volatility (about 3 bp at 50 %/yr), so retail flow does not distort the arbitrage-frequency check. With 10,000 tETH a $2,000 order moved it about 1.5 bp (measured 1.25 bp for $1,696). Both suites use 400,000 of the 1,000,000 minted tETH and about 1 billion of the 10 billion tUSD. V and S get the same L, and the script asserts it.
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {ClimScript} from "./base/ClimScript.sol";

/// @notice Adds the same full-range liquidity L to V and S through Sepolia's PoolModifyLiquidityTest.
///         L is sized so that each pool holds LIQ_TETH tETH at the initial price.
/// Env: SUITE (live | replay), LIQ_TETH (whole tokens per pool, default 100_000).
contract AddLiquidity is ClimScript {
    using StateLibrary for IPoolManager;

    function run() external {
        _requirePoolSuite();
        uint256 pk = _pk();
        string memory pools = vm.readFile(_suitePath("pools"));
        PoolKey memory keyV = _key(pools, ".V");
        PoolKey memory keyS = _key(pools, ".S");
        bool token0IsEth = _readAddress(_path("tokens"), ".tETH") < _readAddress(_path("tokens"), ".tUSD");

        int24 lower = TickMath.minUsableTick(TICK_SPACING);
        int24 upper = TickMath.maxUsableTick(TICK_SPACING);
        uint128 liquidity =
            _liquidityFor(keyV, token0IsEth, vm.envOr("LIQ_TETH", uint256(100_000)) * 1e18, lower, upper);
        ModifyLiquidityParams memory mlp = ModifyLiquidityParams({
            tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liquidity)), salt: 0
        });

        vm.startBroadcast(pk);
        IERC20(Currency.unwrap(keyV.currency0)).approve(POOL_MODIFY_LIQUIDITY_TEST, type(uint256).max);
        IERC20(Currency.unwrap(keyV.currency1)).approve(POOL_MODIFY_LIQUIDITY_TEST, type(uint256).max);
        PoolModifyLiquidityTest(POOL_MODIFY_LIQUIDITY_TEST).modifyLiquidity(keyV, mlp, "");
        PoolModifyLiquidityTest(POOL_MODIFY_LIQUIDITY_TEST).modifyLiquidity(keyS, mlp, "");
        vm.stopBroadcast();

        require(IPoolManager(POOL_MANAGER).getLiquidity(keyV.toId()) == liquidity, "AddLiquidity: V");
        require(IPoolManager(POOL_MANAGER).getLiquidity(keyS.toId()) == liquidity, "AddLiquidity: S");

        string memory o = "liquidity";
        vm.serializeUint(o, "liquidity", liquidity);
        vm.serializeInt(o, "tickLower", lower);
        string memory json = vm.serializeInt(o, "tickUpper", upper);
        _write(_suitePath("liquidity"), json);
    }

    /// @dev Full range: the tETH side of the position is [price, max] if tETH is token0, [min, price] otherwise.
    function _liquidityFor(PoolKey memory k, bool token0IsEth, uint256 ethAmount, int24 lower, int24 upper)
        internal
        view
        returns (uint128)
    {
        (uint160 sqrtP,,,) = IPoolManager(POOL_MANAGER).getSlot0(k.toId());
        require(sqrtP != 0, "AddLiquidity: pool not initialized");
        return token0IsEth
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtP, TickMath.getSqrtPriceAtTick(upper), ethAmount)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(lower), sqrtP, ethAmount);
    }

    function _key(string memory json, string memory base) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(vm.parseJsonAddress(json, string.concat(base, ".currency0"))),
            currency1: Currency.wrap(vm.parseJsonAddress(json, string.concat(base, ".currency1"))),
            fee: uint24(vm.parseJsonUint(json, string.concat(base, ".fee"))),
            tickSpacing: int24(vm.parseJsonInt(json, string.concat(base, ".tickSpacing"))),
            hooks: IHooks(vm.parseJsonAddress(json, string.concat(base, ".hooks")))
        });
    }
}
```

- [x] **Step 2: Write 05_WriteDeployments**

The JSON is built by hand with `string.concat`, because forge's `serialize*` cannot write `null`, which plan 04's schema uses for suites not yet deployed.
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {ClimScript} from "./base/ClimScript.sol";
import {ClimHook} from "../src/ClimHook.sol";

/// @notice Read-only. Checks every deployed suite on-chain, then merges the step fragments of deployments/<chainId>/
///         into ../shared/deployments/sepolia.json (chain 11155111) or ../shared/deployments/anvil.json (other chains).
///         Output schema = the one plan 04's parseDeployments validates (including `routers.arb`), plus `deployer`,
///         `riskDesks.don` and `liquidity`.
contract WriteDeployments is ClimScript {
    function run() external {
        require(
            address(IStateView(STATE_VIEW).poolManager()) == POOL_MANAGER, "StateView does not point at PoolManager"
        );
        string memory tokens = vm.readFile(_path("tokens"));
        address teth = vm.parseJsonAddress(tokens, ".tETH");
        address tusd = vm.parseJsonAddress(tokens, ".tUSD");

        string memory head = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"deployBlock":',
            vm.toString(vm.parseJsonUint(tokens, ".deployBlock")),
            ',"deployer":',
            _q(vm.toString(vm.addr(_pk()))),
            ',"uniswap":{"poolManager":',
            _q(vm.toString(POOL_MANAGER)),
            ',"stateView":',
            _q(vm.toString(STATE_VIEW)),
            ',"poolSwapTest":',
            _q(vm.toString(POOL_SWAP_TEST)),
            ',"poolModifyLiquidityTest":',
            _q(vm.toString(POOL_MODIFY_LIQUIDITY_TEST)),
            "}"
        );
        string memory tokensJson = string.concat(
            ',"cre":{"mockForwarder":',
            _q(vm.toString(MOCK_FORWARDER)),
            ',"keystoneForwarder":',
            _q(vm.toString(KEYSTONE_FORWARDER)),
            '},"tokens":{"tETH":',
            _token(teth, "tETH"),
            ',"tUSD":',
            _token(tusd, "tUSD"),
            '},"routers":{"arb":',
            _arbRouterOrNull(tokens),
            "}"
        );
        string memory contractsJson = string.concat(
            ',"riskDesks":{"live":',
            _addrOrNull("desk-live", ".riskDesk"),
            ',"replay":',
            _addrOrNull("desk-replay", ".riskDesk"),
            ',"don":',
            _addrOrNull("desk-don", ".riskDesk"),
            '},"hooks":{"live":',
            _hookOrNull("live"),
            ',"replay":',
            _hookOrNull("replay"),
            "}"
        );
        bool token0IsEth = teth < tusd;
        string memory poolsJson = string.concat(
            ',"pools":{"liveV":',
            _poolOrNull("live", ".V", token0IsEth),
            ',"liveS":',
            _poolOrNull("live", ".S", token0IsEth),
            ',"replayV":',
            _poolOrNull("replay", ".V", token0IsEth),
            ',"replayS":',
            _poolOrNull("replay", ".S", token0IsEth),
            '},"liquidity":{"live":',
            _liquidityOrNull("live"),
            ',"replay":',
            _liquidityOrNull("replay"),
            "}}"
        );

        string memory out =
            block.chainid == SEPOLIA ? "../shared/deployments/sepolia.json" : "../shared/deployments/anvil.json";
        vm.writeJson(string.concat(head, tokensJson, contractsJson, poolsJson), out);
    }

    function _q(string memory s) internal pure returns (string memory) {
        return string.concat('"', s, '"');
    }

    function _token(address token, string memory symbol) internal pure returns (string memory) {
        return string.concat('{"address":', _q(vm.toString(token)), ',"symbol":', _q(symbol), ',"decimals":18}');
    }

    /// @dev The arbitrage-only PoolSwapTest deployed by 00_Tokens; checked to route through the PoolManager.
    function _arbRouterOrNull(string memory tokens) internal view returns (string memory) {
        if (!vm.keyExistsJson(tokens, ".arbRouter")) return "null";
        address router = vm.parseJsonAddress(tokens, ".arbRouter");
        require(address(PoolSwapTest(router).manager()) == POOL_MANAGER, "routers.arb does not point at PoolManager");
        return _q(vm.toString(router));
    }

    function _addrOrNull(string memory fragment, string memory key) internal view returns (string memory) {
        if (!vm.exists(_path(fragment))) return "null";
        return _q(vm.toString(_readAddress(_path(fragment), key)));
    }

    /// @dev Also checks that the hook reads the desk of the same suite.
    function _hookOrNull(string memory suite) internal view returns (string memory) {
        string memory hookPath = _path(string.concat("hook-", suite));
        if (!vm.exists(hookPath)) return "null";
        address hook = _readAddress(hookPath, ".hook");
        address desk = _readAddress(_path(string.concat("desk-", suite)), ".riskDesk");
        require(address(ClimHook(hook).desk()) == desk, string.concat(suite, ": hook reads another desk"));
        return _q(vm.toString(hook));
    }

    /// @dev Also checks that the pool is initialized and holds liquidity.
    function _poolOrNull(string memory suite, string memory which, bool token0IsEth)
        internal
        view
        returns (string memory)
    {
        string memory poolsPath = _path(string.concat("pools-", suite));
        if (!vm.exists(poolsPath)) return "null";
        string memory pools = vm.readFile(poolsPath);
        bytes32 poolId = vm.parseJsonBytes32(pools, string.concat(which, ".poolId"));
        (uint160 sqrtPriceX96,,,) = IStateView(STATE_VIEW).getSlot0(PoolId.wrap(poolId));
        require(sqrtPriceX96 != 0, string.concat(suite, which, ": pool not initialized"));
        require(
            IStateView(STATE_VIEW).getLiquidity(PoolId.wrap(poolId)) > 0, string.concat(suite, which, ": no liquidity")
        );

        return string.concat(
            '{"key":',
            _keyJson(pools, which),
            ',"poolId":',
            _q(vm.toString(poolId)),
            ',"token0IsEth":',
            token0IsEth ? "true" : "false",
            "}"
        );
    }

    function _keyJson(string memory pools, string memory which) internal pure returns (string memory) {
        string memory addrs = string.concat(
            '{"currency0":',
            _addrAt(pools, which, ".currency0"),
            ',"currency1":',
            _addrAt(pools, which, ".currency1"),
            ',"hooks":',
            _addrAt(pools, which, ".hooks")
        );
        return string.concat(
            addrs,
            ',"fee":',
            vm.toString(vm.parseJsonUint(pools, string.concat(which, ".fee"))),
            ',"tickSpacing":',
            vm.toString(vm.parseJsonInt(pools, string.concat(which, ".tickSpacing"))),
            "}"
        );
    }

    function _addrAt(string memory json, string memory which, string memory field)
        internal
        pure
        returns (string memory)
    {
        return _q(vm.toString(vm.parseJsonAddress(json, string.concat(which, field))));
    }

    /// @dev Decimal string: L exceeds 2^53 and would lose precision as a JSON number in JavaScript.
    function _liquidityOrNull(string memory suite) internal view returns (string memory) {
        string memory liqPath = _path(string.concat("liquidity-", suite));
        if (!vm.exists(liqPath)) return "null";
        return _q(vm.toString(vm.parseJsonUint(vm.readFile(liqPath), ".liquidity")));
    }
}
```

- [x] **Step 3: Build and run the whole offline suite**

```bash
cd ~/Development/hackathons/clim/contracts && forge build && forge test --no-match-path 'test/fork/*'
```
Expected: `Compiler run successful!`, then `69 tests passed, 0 failed, 0 skipped (69 total tests)`. On 2026-10-07 the same command gives `74 tests passed, 0 failed, 0 skipped (74 total tests)` with `.env`'s `SEPOLIA_RPC_URL` (the fork test of `ReceiverTemplateMetadata.t.sol` sits outside `test/fork/`), or `73 tests passed, 0 failed, 1 skipped (74 total tests)` with `SEPOLIA_RPC_URL=`.

- [x] **Step 4: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/script/04_AddLiquidity.s.sol contracts/script/05_WriteDeployments.s.sol && git commit -m "feat(contracts): full-range liquidity and deployments writer in plan 04's schema"
```

### Task 14: ABI export and on-chain smoke script

**Delegable:** yes
**Depends on:** Task 13

**Files:**
- Create: `contracts/script/export-abis.sh`, `contracts/script/smoke.sh`, `shared/abis/*.json` (generated)

- [x] **Step 1: Write the exporter**

`contracts/script/export-abis.sh`, the only ABI exporter: it writes the eight `shared/abis/<Name>.json` files. Plan 04's `shared/scripts/export-abis.ts` (`bun run --cwd shared export-abis`, a three-contract subset of the same files) was removed on 2026-10-07 in `5ed36a8`.
```bash
#!/usr/bin/env bash
# Copies the ABIs that cre/, bots/ and app/ consume from Foundry artifacts to shared/abis/.
# Run from anywhere: contracts/script/export-abis.sh
set -euo pipefail
cd "$(dirname "$0")/.."
forge build >/dev/null
OUT=../shared/abis
mkdir -p "$OUT"
for artifact in \
  RiskDesk.sol/RiskDesk \
  IRiskDesk.sol/IRiskDesk \
  ClimHook.sol/ClimHook \
  TestToken.sol/TestToken \
  IPoolManager.sol/IPoolManager \
  IStateView.sol/IStateView \
  PoolSwapTest.sol/PoolSwapTest \
  PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest; do
  name="${artifact##*/}"
  jq '.abi' "out/${artifact}.json" > "${OUT}/${name}.json"
  echo "${OUT}/${name}.json"
done
```

- [x] **Step 2: Write the smoke script**

`contracts/script/smoke.sh`:
```bash
#!/usr/bin/env bash
# On-chain smoke test of a deployed clim suite: quoteFee, optional report through the MockKeystoneForwarder,
# then one tiny swap on V and on S, printing the fee each swap paid (PoolManager Swap event, last field).
# Usage: script/smoke.sh <rpc-url> <deployments.json> [live|replay]
# Env: PRIVATE_KEY (deployer = simOperator). PUSH_REPORT=1 also delivers one 48 %/yr report (use on forks only).
set -euo pipefail
RPC="$1"; DEP="$2"; SUITE="${3:-live}"
HOOK=$(jq -r ".hooks.${SUITE}" "$DEP"); DESK=$(jq -r ".riskDesks.${SUITE}" "$DEP")
PM=$(jq -r .uniswap.poolManager "$DEP"); ROUTER=$(jq -r .uniswap.poolSwapTest "$DEP"); MOCK=$(jq -r .cre.mockForwarder "$DEP")
C0=$(jq -r ".pools.${SUITE}V.key.currency0" "$DEP"); C1=$(jq -r ".pools.${SUITE}V.key.currency1" "$DEP")
SFEE=$(jq -r ".pools.${SUITE}S.key.fee" "$DEP")
SWAP_TOPIC=$(cast sig-event "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")

echo "quoteFee before: $(cast call "$HOOK" 'quoteFee()(uint24,uint8)' --rpc-url "$RPC" | tr '\n' ' ')"
if [ "${PUSH_REPORT:-0}" = "1" ]; then
  NOW=$(cast block latest --field timestamp --rpc-url "$RPC")
  REPORT=$(cast abi-encode -- "f(uint40,uint32,uint32,uint16,int24,uint16,uint8,uint16,uint8)" "$NOW" 85475 85475 4800 -79060 3 4 10000 0)
  RAW=$(cast concat-hex "0x01$(printf '%0216d' 0)" "$REPORT")
  cast send "$MOCK" "report(address,bytes,bytes,bytes[])" "$DESK" "$RAW" 0x "[]" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" >/dev/null
  echo "desk state: $(cast call "$DESK" 'state()(uint40,uint32,uint16,uint8,uint32)' --rpc-url "$RPC" | tr '\n' ' ')"
  echo "quoteFee after report: $(cast call "$HOOK" 'quoteFee()(uint24,uint8)' --rpc-url "$RPC" | tr '\n' ' ')"
fi
for T in "$C0" "$C1"; do
  cast send "$T" "approve(address,uint256)" "$ROUTER" "$(cast max-uint)" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" >/dev/null
done
swap_fee() {
  cast send "$ROUTER" "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)" \
    "$1" "(true,-10000000000000000,4295128740)" "(false,false)" 0x \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --json |
    jq -r --arg pm "$(echo "$PM" | tr 'A-F' 'a-f')" --arg t "$SWAP_TOPIC" \
      '.logs[] | select((.address | ascii_downcase) == $pm and .topics[0] == $t) | .data' |
    python3 -c "import sys; print(int(sys.stdin.read().strip()[-64:], 16))"
}
echo "V swap fee (pips): $(swap_fee "($C0,$C1,8388608,60,$HOOK)")"
echo "S swap fee (pips): $(swap_fee "($C0,$C1,$SFEE,60,0x0000000000000000000000000000000000000000)")"
```

- [x] **Step 3: Run the exporter**

```bash
cd ~/Development/hackathons/clim/contracts && chmod +x script/export-abis.sh script/smoke.sh && ./script/export-abis.sh && jq -r '[.[] | select(.type=="function") | .name] | join(",")' ../shared/abis/ClimHook.json
```
Expected: eight lines `../shared/abis/RiskDesk.json`, `IRiskDesk.json`, `ClimHook.json`, `TestToken.json`, `IPoolManager.json`, `IStateView.json`, `PoolSwapTest.json`, `PoolModifyLiquidityTest.json`, then a list that contains `quoteFee`, `desk`, `etaE4`, `feeMinPips`, `feeMaxPips`, `feeSafePips`, `tauKillSec`, `MODE_BLIND`, `MODE_DEGRADED`, `MODE_NORMAL`.

- [x] **Step 4: Commit**

```bash
cd ~/Development/hackathons/clim && git add contracts/script/export-abis.sh contracts/script/smoke.sh shared/abis && git commit -m "feat(contracts): ABI export to shared/ and on-chain smoke script"
```

### Task 15: Dry run on an anvil fork of Sepolia

**Delegable:** yes
**Depends on:** Task 14

**Files:**
- Modify: `docs/sessions/2026-10-06.md` (outputs go to gitignored paths)

- [x] **Step 1: Start a fork with chain id 31337**

With chain id 31337, outputs go to `deployments/31337/` and `shared/deployments/anvil.json`, and the params guard stays off. Start the fork with `run_in_background: true`:
```bash
cd ~/Development/hackathons/clim/contracts && set -a && source .env && set +a && anvil --fork-url "$SEPOLIA_RPC_URL" --chain-id 31337 --port 8545 --silent
```
Then:
```bash
until cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; do sleep 1; done; cast chain-id --rpc-url http://127.0.0.1:8545
```
Expected: `31337`.

- [x] **Step 2: Deploy the live, replay and DON suites with anvil's first key and the fixture params**

```bash
cd ~/Development/hackathons/clim/contracts && export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 PARAMS_PATH=test/fixtures/params.p30.json && \
ok(){ out=$("$@" 2>&1); echo "$out" | grep -E "ONCHAIN EXECUTION COMPLETE|Error" || echo "$out" | grep -E "Script ran successfully"; ! echo "$out" | grep -q "Error"; } && \
ok forge script script/00_Tokens.s.sol --rpc-url anvil --broadcast && \
F=0; for S in live replay; do P=$([ $S = live ] && echo 2713 || echo 2254); \
  SUITE=$S ok forge script script/01_DeployDesk.s.sol --rpc-url anvil --broadcast && \
  SUITE=$S ok forge script script/02_DeployHook.s.sol --rpc-url anvil --broadcast && \
  SUITE=$S INIT_ETH_USD=$P ok forge script script/03_CreatePools.s.sol --rpc-url anvil --broadcast && \
  SUITE=$S ok forge script script/04_AddLiquidity.s.sol --rpc-url anvil --broadcast || { F=1; break; }; done; [ $F = 0 ] && \
SUITE=don ok forge script script/01_DeployDesk.s.sol --rpc-url anvil --broadcast && \
{ SUITE=don forge script script/02_DeployHook.s.sol --rpc-url anvil 2>&1 | grep -E "Error"; true; } && \
ok forge script script/05_WriteDeployments.s.sol --rpc-url anvil
```
Expected: ten lines `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.`, then `Error: script failed: SUITE=don has no hook and no pools` (the guard working), then `Script ran successfully.` Any other `Error` line stops the chain at that script.

- [x] **Step 3: Check the merged file against plan 04's rules**

```bash
cd ~/Development/hackathons/clim && D=shared/deployments/anvil.json && for p in liveV liveS replayV replayS; do id=$(cast keccak $(cast abi-encode "f(address,address,uint24,int24,address)" $(jq -r ".pools.$p.key.currency0" $D) $(jq -r ".pools.$p.key.currency1" $D) $(jq -r ".pools.$p.key.fee" $D) $(jq -r ".pools.$p.key.tickSpacing" $D) $(jq -r ".pools.$p.key.hooks" $D))); [ "$id" = "$(jq -r .pools.$p.poolId $D)" ] && echo "$p poolId OK" || echo "$p MISMATCH"; done && jq -c '{dyn: [.pools.liveV.key.fee, .pools.replayV.key.fee], hooksMatch: (.pools.liveV.key.hooks == .hooks.live and .pools.replayV.key.hooks == .hooks.replay), sStatic: [.pools.liveS.key.fee, .pools.replayS.key.fee], sorted: (.pools.liveV.key.currency0 < .pools.liveV.key.currency1), liq: .liquidity, arb: (.routers.arb != null)}' $D && cast call $(jq -r .riskDesks.don $D) "simMode()(bool)" --rpc-url http://127.0.0.1:8545 && cast call $(jq -r .routers.arb $D) "manager()(address)" --rpc-url http://127.0.0.1:8545
```
Expected: four `poolId OK` lines, then `{"dyn":[8388608,8388608],"hooksMatch":true,"sStatic":[600,2500],"sorted":true,"liq":{"live":"…","replay":"…"},"arb":true}` (live L ≈ 5.2e24: the fixer pass measured `5208646657242166984120997` at $2,713), then `false`, then `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (the arbitrage router points at the PoolManager).

`sorted` compares checksummed hex strings. It is a quick check; plan 04's parser compares them as numbers.

- [x] **Step 4: Smoke test: a report through the real mock forwarder, then swaps on V and S**

```bash
cd ~/Development/hackathons/clim/contracts && PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 PUSH_REPORT=1 ./script/smoke.sh http://127.0.0.1:8545 ../shared/deployments/anvil.json live
```
Expected:
```
quoteFee before: 3000 2
desk state: <now> [...] 85475 [8.547e4] 10000 [1e4] 0 1
quoteFee after report: 526 0
V swap fee (pips): 526
S swap fee (pips): 600
```

- [x] **Step 5: Stop the fork and remove the dry-run outputs**

```bash
pkill -f "anvil --fork-url"; rm -rf ~/Development/hackathons/clim/contracts/deployments/31337 ~/Development/hackathons/clim/shared/deployments/anvil.json; cd ~/Development/hackathons/clim && git status --short
```
Expected: `git status --short` shows no file under `contracts/deployments/`, `contracts/broadcast/`, or `shared/deployments/anvil.json`. Broadcasts on chain 31337 are gitignored.

- [x] **Step 6: Log and commit**

Append under `## Contracts (plan 01)` in `docs/sessions/2026-10-06.md`:
```markdown
- **Dry run on an anvil fork of Sepolia passed:**
  - Scripts 00 to 05 ran for the live, replay and DON suites.
  - One report went through the real MockKeystoneForwarder.
  - Swap fees: V paid `quoteFee()`, S paid its static fee.
```
```bash
cd ~/Development/hackathons/clim && git add docs/sessions/2026-10-06.md && git commit -m "docs(sessions): contracts dry run on a Sepolia fork"
```

### Task 16: GATE, then deploy the live suite to Sepolia

**Delegable:** no (it uses the deployer key; it is the gate the rest of the demo depends on)
**Depends on:** Task 15, plus the lab decision in plan 03, which writes `shared/params.json` with the final P\*, `staticFeePips`, `replayStaticFeePips` and a `decidedBy` that does not start with `PROVISIONAL` or `FIXTURE`. **Hook parameters are immutable:** never run this task on provisional parameters.

**Files:**
- Create: `contracts/deployments/11155111/*.json`, `contracts/broadcast/*/11155111/*.json`
- Modify: `shared/deployments/sepolia.json`, `shared/abis/*.json`, `docs/sessions/2026-10-06.md`

- [x] **Step 1: Gate checks**

```bash
cd ~/Development/hackathons/clim/contracts && set -a && source .env && set +a && \
jq -e '(.decidedBy | (startswith("PROVISIONAL") or startswith("FIXTURE"))) | not' ../shared/params.json && \
jq -e '.staticFeePips > 0 and .replayStaticFeePips != .staticFeePips and .feeMinPips <= .feeSafePips and .feeSafePips <= .feeMaxPips' ../shared/params.json && \
cast balance $(cast wallet address --private-key $PRIVATE_KEY) --rpc-url $SEPOLIA_RPC_URL --ether && \
forge test 2>&1 | tail -1
```
Expected: `true`, `true`, a balance of at least `0.05`, and `76 tests passed, 0 failed, 0 skipped (76 total tests)`: 73 offline plus 3 Sepolia fork tests, measured on 2026-10-07 (71 when the live suite was deployed on 2026-10-06, before `ReceiverTemplateMetadata.t.sol` was added in `57933bc`). Stop on any other output. `02_DeployHook` also refuses non-decided params on chain 11155111: a second, independent guard.

- [x] **Step 2: Deploy tokens, desk and hook**

Sepolia runs Glamsterdam (its block headers carry `blockAccessListHash` and `slotNumber`), whose gas schedule makes contract creation and new storage several times more expensive than the `cancun` schedule `forge` simulates locally: on 2026-10-06 the first `00_Tokens` transaction ran out of gas (tx `0xe853dba51848b0bd0aa005095ceb474ea56370688429e9d82df8ed00661d6312`, limit 862,119 from the local simulation, where the node estimates 4,350,932). Every Sepolia `forge script --broadcast` therefore passes `--skip-simulation`: forge then asks the node (`eth_estimateGas`, times 1.3) for each transaction's gas right before sending it, one at a time (foundry v1.4.2 `crates/script/src/broadcast.rs`, `estimate_via_rpc`). Measured: `TestToken` about 4.3M gas, `PoolSwapTest` 9.4M, the whole live suite about 0.04 ETH at 0.95 gwei.

```bash
cd ~/Development/hackathons/clim/contracts && \
ok(){ out=$("$@" 2>&1); echo "$out" | grep -E "ONCHAIN EXECUTION COMPLETE|Error" || echo "$out" | grep -E "Script ran successfully"; ! echo "$out" | grep -q "Error"; } && \
ok forge script script/00_Tokens.s.sol --rpc-url sepolia --broadcast --slow --skip-simulation && \
SUITE=live ok forge script script/01_DeployDesk.s.sol --rpc-url sepolia --broadcast --slow --skip-simulation && \
SUITE=live ok forge script script/02_DeployHook.s.sol --rpc-url sepolia --broadcast --slow --skip-simulation && \
cat deployments/11155111/tokens.json deployments/11155111/desk-live.json deployments/11155111/hook-live.json
```
Expected: three `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.` lines and three JSON fragments. `hook` must end in `…1080` or another value whose last 14 bits are `0x1080` (afterInitialize 0x1000 | beforeSwap 0x80).

- [x] **Step 3: Create the pools at the current ETH price and add liquidity**

```bash
cd ~/Development/hackathons/clim/contracts && export INIT_ETH_USD=$(curl -s https://api.coinbase.com/v2/prices/ETH-USD/spot | jq -r '.data.amount | tonumber | floor') && echo "INIT_ETH_USD=$INIT_ETH_USD" && \
ok(){ out=$("$@" 2>&1); echo "$out" | grep -E "ONCHAIN EXECUTION COMPLETE|Error" || echo "$out" | grep -E "Script ran successfully"; ! echo "$out" | grep -q "Error"; } && \
SUITE=live ok forge script script/03_CreatePools.s.sol --rpc-url sepolia --broadcast --slow --skip-simulation && \
SUITE=live ok forge script script/04_AddLiquidity.s.sol --rpc-url sepolia --broadcast --slow --skip-simulation
```
Expected: a plausible price (`INIT_ETH_USD=2713` on 2026-10-06), then two `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.` lines.

- [x] **Step 4: Write shared/deployments/sepolia.json and the ABIs**

```bash
cd ~/Development/hackathons/clim/contracts && ok(){ out=$("$@" 2>&1); echo "$out" | grep -E "ONCHAIN EXECUTION COMPLETE|Error" || echo "$out" | grep -E "Script ran successfully"; ! echo "$out" | grep -q "Error"; } && ok forge script script/05_WriteDeployments.s.sol --rpc-url sepolia && ./script/export-abis.sh >/dev/null && jq -c '{chainId, riskDesks, hooks, routers, liveS: .pools.liveS.key.fee, liq: .liquidity.live}' ../shared/deployments/sepolia.json
```
Expected: `Script ran successfully.`, then one JSON line: `chainId` is 11155111, `riskDesks.live`, `hooks.live` and `routers.arb` are addresses, `replay` and `don` are null, and `liveS` is `staticFeePips`. If plan 04 is set up (`shared/src/config.ts`), also run `cd ~/Development/hackathons/clim/shared && bun test test/config.test.ts`. Expected: ` 0 fail`.

- [x] **Step 5: Smoke on Sepolia (no report pushed: the first report must come from CRE)**

```bash
cd ~/Development/hackathons/clim/contracts && set -a && source .env && set +a && ./script/smoke.sh "$SEPOLIA_RPC_URL" ../shared/deployments/sepolia.json live
```
Expected:
- `quoteFee before: 3000 2` (blind: the desk has never reported);
- `V swap fee (pips): 3000`;
- `S swap fee (pips):` equal to `staticFeePips`.

The two swaps also leave the PoolSwapTest approvals in place for the bots.

- [x] **Step 6: Log, commit, hand over**

Append under `## Contracts (plan 01)` in `docs/sessions/2026-10-06.md`:
```markdown
- **Live suite deployed on Sepolia:** addresses (including the arbitrage router `routers.arb`) in `shared/deployments/sepolia.json`, transactions in `contracts/broadcast/*/11155111/run-latest.json`.
  - Smoke: V quoted the blind fee (3000 pips), and S charged its static fee.
  - Next: plan 02 points the workflow at `riskDesks.live`, with `CRE_ETH_PRIVATE_KEY` = the deployer key.
```
```bash
cd ~/Development/hackathons/clim && git add contracts/deployments/11155111 contracts/broadcast shared/deployments/sepolia.json shared/abis docs/sessions/2026-10-06.md && git commit -m "deploy(contracts): live clim suite on Sepolia (tokens, RiskDesk, ClimHook, twin pools)" && git show --stat --oneline HEAD | cat
```
Expected: the commit lists `contracts/deployments/11155111/{tokens,desk-live,hook-live,pools-live,liquidity-live}.json`, the `contracts/broadcast/*/11155111/` run files, `shared/deployments/sepolia.json`, `shared/abis/*.json` and the session log. Neither `contracts/.env` nor `contracts/cache/` appears.

### Task 17: Verify the contracts on Etherscan

**Delegable:** yes
**Depends on:** Task 16, and `ETHERSCAN_API_KEY` in `contracts/.env` (a free Etherscan account; one v2 key covers Sepolia)

**Files:**
- Modify: `docs/sessions/2026-10-06.md`

- [x] **Step 1: Verify the four contracts**

```bash
cd ~/Development/hackathons/clim/contracts && set -a && source .env && set +a && D=../shared/deployments/sepolia.json && P=../shared/params.json && DEPLOYER=$(jq -r .deployer $D) && \
forge verify-contract $(jq -r .tokens.tETH.address $D) src/test-tokens/TestToken.sol:TestToken --chain sepolia --etherscan-api-key $ETHERSCAN_API_KEY --watch --constructor-args $(cast abi-encode "constructor(string,string,address,uint256)" "clim test ETH" "tETH" $DEPLOYER 10000000000000000000) && \
forge verify-contract $(jq -r .tokens.tUSD.address $D) src/test-tokens/TestToken.sol:TestToken --chain sepolia --etherscan-api-key $ETHERSCAN_API_KEY --watch --constructor-args $(cast abi-encode "constructor(string,string,address,uint256)" "clim test USD" "tUSD" $DEPLOYER 25000000000000000000000) && \
forge verify-contract $(jq -r .riskDesks.live $D) src/RiskDesk.sol:RiskDesk --chain sepolia --etherscan-api-key $ETHERSCAN_API_KEY --watch --constructor-args $(cast abi-encode "constructor(address,address,bool)" $(jq -r .cre.mockForwarder $D) $DEPLOYER false) && \
forge verify-contract $(jq -r .hooks.live $D) src/ClimHook.sol:ClimHook --chain sepolia --etherscan-api-key $ETHERSCAN_API_KEY --watch --constructor-args $(cast abi-encode "constructor(address,address,uint32,uint32,uint24,uint24,uint24,uint32)" $(jq -r .uniswap.poolManager $D) $(jq -r .riskDesks.live $D) $(jq -r .etaE4 $P) $(jq -r .sqrtHalfDtE6 $P) $(jq -r .feeMinPips $P) $(jq -r .feeMaxPips $P) $(jq -r .feeSafePips $P) $(jq -r .tauKillSec $P))
```
Expected: each command ends with `Pass - Verified` (or `Contract source code already verified`). Without an Etherscan key, replace `--etherscan-api-key $ETHERSCAN_API_KEY --watch` with `--verifier sourcify` (forge 1.4.2 rejects `--watch` with Sourcify and prints only its usage). Expected then: `Verification Job ID: ...` for each contract, and `curl -s https://sourcify.dev/server/v2/contract/11155111/<address> | jq -r .match` prints `match` (done this way on 2026-10-06: no Etherscan key). On 2026-10-07 the maintainer provided a key and all seven contracts (both desks, both hooks, tETH, tUSD and the arbitrage `PoolSwapTest`) were verified on Etherscan too: `forge verify-contract <address> <path:Contract> --chain sepolia --guess-constructor-args --rpc-url https://ethereum-sepolia-rpc.publicnode.com --etherscan-api-key $ETHERSCAN_API_KEY --watch` for tETH, the live desk, the live hook and the router; Etherscan already matched tUSD and the replay desk and hook by bytecode.

- [x] **Step 2: Log and commit**

Append under `## Contracts (plan 01)`:
```markdown
- **Sepolia contracts verified** (tETH, tUSD, live RiskDesk, live ClimHook): source readable on Etherscan for the judges.
```
```bash
cd ~/Development/hackathons/clim && git add docs/sessions/2026-10-06.md && git commit -m "docs(sessions): Sepolia contracts verified"
```

### Task 18: Replay suite on Sepolia (P1)

**Delegable:** no
**Depends on:** Task 16; plan 02 Task 2 (the `cre/` folder exists). Its own desk is fed by plan 02's replay mode (`riskDesks.replay`). Run it while no CRE loop is running (Step 1 sends from the deployer key).

**Files:**
- Create: `cre/.env.replay` (never committed: the root `.gitignore` ignores `.env.*`), `contracts/deployments/11155111/{desk,hook,pools,liquidity}-replay.json`
- Modify: `shared/deployments/sepolia.json`, `docs/sessions/2026-10-06.md`

- [x] **Step 1: Create and fund the replay operator key**

The replay desk gets its own `simOperator`, so the live and replay CRE loops (both running for hours) never send from the same key and never race for a nonce. `simOperator` is immutable per desk, which is why this happens before the deployment. The key is written without being printed (only its address is shown) and funded with 0.2 Sepolia ETH from the deployer: one report every 30 s for the 4.5 h of the replay costs about 0.1 ETH at 1 gwei.
```bash
cd ~/Development/hackathons/clim && test -d cre && { test -f cre/.env.replay || { K=$(cast wallet new --json | jq -r '.[0].private_key'); printf '# Replay desk operator (simOperator of riskDesks.replay, plan 01 Task 18). Testnet only, never committed.\nCRE_ETH_PRIVATE_KEY=%s\nSEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com\n' "${K#0x}" > cre/.env.replay; }; } && git check-ignore -q cre/.env.replay && echo IGNORED_OK && \
R=$(cast wallet address --private-key "0x$(grep '^CRE_ETH_PRIVATE_KEY=' cre/.env.replay | cut -d= -f2)") && echo "replay operator $R" && \
cd contracts && set -a && source .env && set +a && cast send "$R" --value 0.2ether --private-key "$PRIVATE_KEY" --rpc-url "$SEPOLIA_RPC_URL" | grep -E "^status" && cast balance "$R" --rpc-url "$SEPOLIA_RPC_URL" --ether
```
Expected: `IGNORED_OK`, `replay operator 0x<address>`, `status               1 (success)`, then `0.200000000000000000` (or more if the address already held ETH).

- [x] **Step 2: Deploy the replay suite at the replay window's first price, with the replay operator as `simOperator`**

The replay window starts at 2026-02-04 12:00 UTC, which is 1770206400000 ms; its first Binance close was $2,254.
```bash
cd ~/Development/hackathons/clim/contracts && export SIM_OPERATOR=$(cast wallet address --private-key "0x$(grep '^CRE_ETH_PRIVATE_KEY=' ../cre/.env.replay | cut -d= -f2)") && echo "SIM_OPERATOR=$SIM_OPERATOR" && \
export INIT_ETH_USD=$(curl -s "https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&startTime=1770206400000&limit=1" | jq -r '.[0][1] | tonumber | floor') && echo "INIT_ETH_USD=$INIT_ETH_USD" && \
ok(){ out=$("$@" 2>&1); echo "$out" | grep -E "ONCHAIN EXECUTION COMPLETE|Error" || echo "$out" | grep -E "Script ran successfully"; ! echo "$out" | grep -q "Error"; } && \
F=0; for s in 01_DeployDesk 02_DeployHook 03_CreatePools 04_AddLiquidity; do SUITE=replay ok forge script script/$s.s.sol --rpc-url sepolia --broadcast --slow --skip-simulation || { F=1; break; }; done; [ $F = 0 ] && \
ok forge script script/05_WriteDeployments.s.sol --rpc-url sepolia && \
cast call $(jq -r .riskDesks.replay ../shared/deployments/sepolia.json) "state()(uint40,uint32,uint16,uint8,uint32)" --rpc-url sepolia && \
cast call $(jq -r .riskDesks.replay ../shared/deployments/sepolia.json) "simOperator()(address)" --rpc-url sepolia
```
Expected: `SIM_OPERATOR=0x<replay operator>`, `INIT_ETH_USD=2254`, four `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.` lines, `Script ran successfully.`, then `0 0 0 2 0` (REPLAY flag), then the replay operator address again. `cast` resolves the `sepolia` alias from `foundry.toml` and reads `.env` itself. Plan 02 Task 12 and plan 04's `cre-loop --pair replay` send the replay reports with `cre/.env.replay` (`ENV_FILE=.env.replay`).

- [x] **Step 3: Log and commit**

Append under `## Contracts (plan 01)`:
```markdown
- **Replay suite deployed on Sepolia:** desk flagged REPLAY with its own operator key (`cre/.env.replay`, simOperator <address>), its own hook, V and S initialized at the replay window's first price (Binance ETHUSDT 2026-02-04 12:00 UTC).
```
```bash
cd ~/Development/hackathons/clim && git add contracts/deployments/11155111 contracts/broadcast shared/deployments/sepolia.json docs/sessions/2026-10-06.md && git commit -m "deploy(contracts): replay suite on Sepolia"
```

### Task 19: DON desk on Sepolia (only when plan 02 Task 13 asks for it)

**Delegable:** no
**Depends on:** Task 16, and plan 02 having deploy access to a CRE DON

**Files:**
- Create: `contracts/deployments/11155111/desk-don.json`
- Modify: `shared/deployments/sepolia.json`

- [ ] **Step 1: Deploy the DON desk (production forwarder; simulation mode is switched off in the same broadcast)** **Cut (2026-10-07):** the DON deployment is cut with plan 02 Task 13 (master cut list item 1): `cre whoami` still printed `Deploy Access: Not enabled` about 6.5 h after the access request of 2026-10-06 22:56 SGT (friction log row 6) and again at 07:17 SGT on 2026-10-07 (23:17 UTC on 2026-10-06), over 8 h after it, so no DON can write to a DON desk and clim stays on `simulate --broadcast` through `MockKeystoneForwarder`; `riskDesks.don` stays null in `shared/deployments/sepolia.json` and no `desk-don.json` exists.

```bash
cd ~/Development/hackathons/clim/contracts && ok(){ out=$("$@" 2>&1); echo "$out" | grep -E "ONCHAIN EXECUTION COMPLETE|Error" || echo "$out" | grep -E "Script ran successfully"; ! echo "$out" | grep -q "Error"; } && SUITE=don ok forge script script/01_DeployDesk.s.sol --rpc-url sepolia --broadcast --slow --skip-simulation && ok forge script script/05_WriteDeployments.s.sol --rpc-url sepolia && cat deployments/11155111/desk-don.json
```
Expected: `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.`, `Script ran successfully.`, and a fragment with `"forwarder": "0xF8344CFd5c43616a4366C34E3EEE75af79a74482"` and `"simMode": false`. `riskDesks.don` is now set in `shared/deployments/sepolia.json`. Plan 02's later `cast send <don desk> "disableSim()"` is then a harmless no-op.

- [ ] **Step 2: Commit** **Cut (2026-10-07):** nothing to commit, Step 1 is cut with plan 02 Task 13 (master cut list item 1, CRE deploy access never enabled).

```bash
cd ~/Development/hackathons/clim && git add contracts/deployments/11155111/desk-don.json contracts/broadcast shared/deployments/sepolia.json && git commit -m "deploy(contracts): DON RiskDesk on the production KeystoneForwarder"
```

---

## Self-review (performed)

**1. Spec coverage.**

| Requirement | Where |
|---|---|
| Pinned deps: v4-core/periphery compatible with Sepolia, OZ `BaseOverrideFee` import path and `_getFee` signature, forge-std, HookMiner location, solc + cancun | "Pinned dependencies", Task 2 |
| ReceiverTemplate/IReceiver/IERC165 copied with path and MIT | Task 2 Step 4 |
| ClimFeeMath | Task 3 |
| Table tests incl. the unit checks (with the ceil fix) | `test_UnitChecks_PStar10/30` |
| Ceil, clamp, overflow bounds, fuzz monotonicity | Remaining tests of `ClimFeeMath.t.sol` |
| IRiskDesk: `state()` 5-tuple, `RiskReported` exact fields | Task 4 |
| RiskDesk rejections: sim `tx.origin`, MIN_GAP 20 s, MAX_SKEW 30 s, nSources < 3 | Task 5 tests `test_RevertWhen_*` |
| RiskDesk: first-report special case, envelope ×0.8/×2 with absolute bounds, k clamp | Task 5 |
| RiskDesk: DEGRADED > 25 bp, REPLAY at construction, event, `disableSim` irreversible and owner-only, onlyForwarder via ReceiverTemplate | Task 5 |
| `vm.prank(forwarder, origin)` tests | `DeskHelpers._deliver` |
| TestToken (owner mint, public faucet with cooldown) | Task 7 |
| ClimHook constructor params and order, permissions, afterInitialize dynamic-fee check | Task 8 |
| `_getFee` normal/blind/degraded, `quoteFee` | Task 8 |
| Real PoolManager via Deployers, fee read from the Swap event, splitting invariance, blind after tauKill (boundary), degraded | Task 8 |
| Integration with RiskDesk + ClimHook + pools V and S in one test | Task 9 |
| Scripts 00 to 05 (HookMiner; params via `vm.readFile`/`parseJson`; V dynamic + S static from params; full range via PoolModifyLiquidityTest; writes `shared/deployments/sepolia.json`) | Tasks 10 to 13 |
| `export-abis.sh` | Task 14 |
| cast verification of Sepolia addresses, and a step that records them | Task 1, Steps 3 and 5 |
| Exact forge commands with expected outputs | Every task |
| Validation | "Read this first" |
| Mentor's live-pool question | "How a fee changes on a live pool", and the FAQ lines handed to the orchestrator |

Not covered here, on purpose: the CRE workflow (plan 02), bots (plan 04), the lab decision (plan 03), the dashboard (plan 05) and `docs/faq.md` and the README (plan 06).

**2. Placeholder scan.**
- No "TBD", "TODO", "implement later" or "similar to Task N".
- Every code step contains the complete file: the generator inserted the exact files that compiled and passed.
- The only angle-bracket tokens are `<next>` in friction-log rows (the next free row number, unknowable in advance), `<now>` in an expected smoke output (the fork's block time), and the `deployer` description inside the example JSON schema. None of them is in a source file.

**3. Type and name consistency.** These names are identical across the contracts, tests, scripts, the deployments JSON and plans 02/04:
- `state()` returns `(tObs, sigmaE9, kE4, flags, seq)`, the same names as plan 04's ABI fragments;
- `quoteFee()` returns `(fee, mode)`;
- `RiskReported` has 11 fields in canonical order;
- `FLAG_DEGRADED` = 1, `FLAG_REPLAY` = 2; `MODE_NORMAL` = 0, `MODE_DEGRADED` = 1, `MODE_BLIND` = 2;
- the constructor `(IPoolManager, IRiskDesk, uint32 etaE4, uint32 sqrtHalfDtE6, uint24 feeMinPips, uint24 feeMaxPips, uint24 feeSafePips, uint32 tauKillSec)` matches `HookHelpers._hookArgs`, `02_DeployHook._args` and Task 17's `cast abi-encode`;
- `mint(address to, uint256 amount)`, `faucet()`, `faucetAmount()`, `lastFaucetAt(address)`, `FaucetCooldown(uint256 nextAt)`;
- the JSON keys `riskDesks.*`, `hooks.*`, `pools.{liveV,liveS,replayV,replayS}.{key,poolId,token0IsEth}` and `tokens.*.address`.

**Known differences that other plans must absorb** (also listed in the orchestrator hand-off):
- Resolved in the plan 00 integration pass: plan 02's `sync-config.ts` reads `riskDesks.*` and `tokens.tETH.address` (this plan's schema); the lab (plan 03) writes `staticFeePips` and `replayStaticFeePips` to `shared/params.json`; `routers.arb` is deployed by `00_Tokens` (plans 04 and 05).
- etaE4 is 25,093 at P\* = 30 % in every test and fixture of this plan (rounded constant 0.824, spec §2.3); the Integration story's third storm step is therefore 4,203 pips (it was 4,204 with 25,094).
