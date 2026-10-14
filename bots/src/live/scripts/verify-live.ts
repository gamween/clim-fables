// Final on-chain checks of the live stack (plan 03 Task 26) over the last WINDOW_BLOCKS blocks (default 18,000, about
// 30 minutes): the desk reports regularly and seq rises by one; pool D's fee is the policy's quote, poke by poke, and
// what the hook recorded; the keeper pokes K about every 180 s with a 7,200 s TTL from its own key; F is never poked and
// charges its flat 700 pips; arbitrage and retail swaps land on D, K and F. Writes docs/evidence/live-check-<date>.json;
// exits 1 if a check fails. Usage: bun src/live/scripts/verify-live.ts
import { climFeePolicyAbi, climPokerAbi, LIVE_POOLS, pokeFeeHookAbi, poolManagerSwapEventAbi, riskDeskV2Abi } from "@clim/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envNum } from "../../lib/env";
import { liveClient, readLiveState } from "../lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "../lib/deployments";
import { median } from "../../lib/market";
import { chunkedRanges } from "../lib/tail";

const d = loadLiveDeployments();
const client = liveClient();
const head = await client.getBlockNumber();
const window = BigInt(envNum("WINDOW_BLOCKS", 18_000));
const from = head > window ? head - window : 0n;
const ranges = chunkedRanges(from, head);

async function collect<T>(get: (a: bigint, b: bigint) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const [a, b] of ranges) out.push(...(await get(a, b)));
  return out;
}

const checks: Record<string, { pass: boolean; detail: Record<string, unknown> }> = {};

// 1. desk: regular reports, seq + 1 each time
const reports = await collect((a, b) => client.getLogs({ address: d.riskDesk, event: riskDeskV2Abi[1], fromBlock: a, toBlock: b }));
const seqs = reports.map((r) => r.args.seq ?? 0);
const tObs = reports.map((r) => Number(r.args.tObs ?? 0));
const gaps = tObs.slice(1).map((t, i) => t - (tObs[i] ?? t));
const seqStep = seqs.slice(1).every((s, i) => s === (seqs[i] ?? 0) + 1);
checks.deskReports = {
  pass: reports.length >= 40 && seqStep && (gaps.length === 0 || Math.max(...gaps) <= 90),
  detail: { reports: reports.length, firstSeq: seqs[0] ?? null, lastSeq: seqs[seqs.length - 1] ?? null, seqStepsByOne: seqStep, maxGapSec: gaps.length ? Math.max(...gaps) : null, medianGapSec: gaps.length ? median(gaps) : null },
};

// 2. D follows the policy: every Poked matches the hook's directional FeePoked in the same tx; the last ten match the
//    policy's quote at their block
const pokes = await collect((a, b) => client.getLogs({ address: d.poker, event: climPokerAbi[1], fromBlock: a, toBlock: b }));
const hookD = await collect((a, b) => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[4], args: { poolId: d.pools.D.poolId }, fromBlock: a, toBlock: b }));
const byTx = new Map(hookD.map((l) => [l.transactionHash, l.args]));
const hookMatches = pokes.filter((p) => {
  const h = byTx.get(p.transactionHash);
  return h !== undefined && h.fee0For1 === p.args.fee0For1 && h.fee1For0 === p.args.fee1For0;
}).length;
let quoteMatches = 0;
const lastTen = pokes.slice(-10);
for (const p of lastTen) {
  const [q01, q10] = await client.readContract({ address: d.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional", blockNumber: p.blockNumber });
  if (p.args.eventApplied || (q01 === p.args.fee0For1 && q10 === p.args.fee1For0)) quoteMatches++;
}
checks.poolDFollowsPolicy = {
  pass: pokes.length >= 40 && hookMatches === pokes.length && quoteMatches >= Math.min(9, lastTen.length) && lastTen.length > 0,
  detail: { pokes: pokes.length, hookFeePokedMatches: hookMatches, lastTenMatchingQuote: quoteMatches, lastPoke: lastTen[lastTen.length - 1]?.args ?? null },
};

// 3. K: keeper pokes from the keeper's key, about every 180 s, TTL 7,200 s
const kPokes = await collect((a, b) => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[3], args: { poolId: d.pools.K.poolId }, fromBlock: a, toBlock: b }));
const kTimes: number[] = [];
let kFromKeeper = 0;
let kTtlOk = 0;
for (const l of kPokes) {
  const [tx, blk] = await Promise.all([client.getTransaction({ hash: l.transactionHash }), client.getBlock({ blockNumber: l.blockNumber })]);
  const t = Number(blk.timestamp);
  kTimes.push(t);
  if (tx.from.toLowerCase() === d.roles.keeper.toLowerCase()) kFromKeeper++;
  if (Number(l.args.expiry ?? 0) - t === 7_200) kTtlOk++;
}
const kGaps = kTimes.slice(1).map((t, i) => t - (kTimes[i] ?? t));
checks.poolKKeeperPattern = {
  pass: kPokes.length >= 5 && kFromKeeper === kPokes.length && kTtlOk === kPokes.length && (kGaps.length === 0 || (median(kGaps) >= 150 && median(kGaps) <= 210)),
  detail: { pokes: kPokes.length, fromKeeper: kFromKeeper, ttl7200: kTtlOk, medianGapSec: kGaps.length ? median(kGaps) : null, fees: kPokes.map((l) => l.args.fee) },
};

// 4. F: never poked in the window, flat fee both ways now
const fSym = await collect((a, b) => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[3], args: { poolId: d.pools.F.poolId }, fromBlock: a, toBlock: b }));
const fDir = await collect((a, b) => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[4], args: { poolId: d.pools.F.poolId }, fromBlock: a, toBlock: b }));
const state = await readLiveState(client, d, head);
checks.poolFFlat = {
  pass: fSym.length + fDir.length === 0 && state.pools.F.fee0For1 === d.hookConfig.flatPips && state.pools.F.fee1For0 === d.hookConfig.flatPips,
  detail: { pokes: fSym.length + fDir.length, fee0For1: state.pools.F.fee0For1, fee1For0: state.pools.F.fee1For0 },
};

// 5. swaps land: arbitrage (routers.arb) and retail (poolSwapTest) on each pool, with the fee each paid
const ids = LIVE_POOLS.map((n) => d.pools[n].poolId);
const swaps = await collect((a, b) =>
  client.getLogs({ address: d.uniswap.poolManager, event: poolManagerSwapEventAbi[0], args: { id: ids }, fromBlock: a, toBlock: b }),
);
const perPool: Record<string, { arb: number; retail: number; meanFeePips: number | null }> = {};
for (const n of LIVE_POOLS) {
  const mine = swaps.filter((s) => s.args.id === d.pools[n].poolId);
  const fees = mine.map((s) => s.args.fee ?? 0);
  perPool[n] = {
    arb: mine.filter((s) => s.args.sender?.toLowerCase() === d.routers.arb.toLowerCase()).length,
    retail: mine.filter((s) => s.args.sender?.toLowerCase() === d.uniswap.poolSwapTest.toLowerCase()).length,
    meanFeePips: fees.length ? fees.reduce((x, y) => x + y, 0) / fees.length : null,
  };
}
checks.swapsLand = {
  pass: LIVE_POOLS.every((n) => (perPool[n]?.retail ?? 0) > 0) && LIVE_POOLS.some((n) => (perPool[n]?.arb ?? 0) > 0),
  detail: perPool,
};

const date = new Date().toISOString().slice(0, 10);
const report = { generatedAt: new Date().toISOString(), chainId: d.chainId, fromBlock: from, toBlock: head, checks };
const dir = join(REPO_ROOT, "docs", "evidence");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `live-check-${date}.json`), `${JSON.stringify(report, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
for (const [name, c] of Object.entries(checks)) console.log(`${c.pass ? "PASS" : "FAIL"} ${name} ${JSON.stringify(c.detail, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`);
console.log(`wrote docs/evidence/live-check-${date}.json`);
process.exit(Object.values(checks).every((c) => c.pass) ? 0 : 1);
