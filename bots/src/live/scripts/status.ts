// Health of the live stack on Robinhood Chain testnet: desk seq and age, the policy's quote and mode, each pool's fee
// both ways and price against the venues, the last pokes on D (ClimPoker) and K (keeper), every key's balances, the
// age of each bot's last log line, the launchd jobs (plan 03 Task 23) and the outage record. Exits 1 on a problem;
// --watch prints a snapshot every 15 s instead. The snapshot is read 3 blocks behind the head (balances at the latest
// block) and a failed read is retried up to 3 times, 1 s apart (lib/retry.ts: some nodes of the public RPC lag the head).
// Usage: bun src/live/scripts/status.ts [--watch]
import { climPokerAbi, FeeMode, LIVE_POOLS, pipsToBp, pokeFeeHookAbi, sigmaE9ToAnnual, stateViewAbi } from "@clim/shared";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, formatUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hasFlag } from "../../lib/env";
import { OUT_DIR, shortError } from "../../lib/jsonl";
import { aggregate, fetchVenueQuotes } from "../../lib/market";
import { liveClient, readLiveBalances, readLiveState } from "../lib/chain";
import { loadLiveDeployments } from "../lib/deployments";
import { liveKey, type LiveRole } from "../lib/env";
import { jobLabel, jobState, LIVE_JOB_NAMES } from "../lib/launchd";
import { laggedHead, withRetry } from "../lib/retry";
import { lastTs } from "../lib/tail";

const d = loadLiveDeployments();
const client = liveClient();
const LOOKBACK_BLOCKS = 9_000n; // about 15 minutes at 0.1 s blocks
const MODE: Record<number, string> = { [FeeMode.Normal]: "normal", [FeeMode.Degraded]: "degraded", [FeeMode.Blind]: "blind" };
const LOGS: Array<[string, string, number]> = [
  ["desk", "desk-runs.jsonl", 90],
  ["runner", "runner-rh.jsonl", 120],
  ["keeper", "keeper-rh.jsonl", 400],
  ["arb", "arb-rh.jsonl", 60],
  ["noise", "noise-rh.jsonl", 600],
];

async function snapshot(): Promise<string[]> {
  const problems: string[] = [];
  const head = laggedHead(await withRetry(() => client.getBlockNumber()));
  const [s, block, quotes] = await Promise.all([
    withRetry(() => readLiveState(client, d, head)),
    withRetry(() => client.getBlock({ blockNumber: head })),
    fetchVenueQuotes().catch(() => []),
  ]);
  const now = Number(block.timestamp);
  const m = aggregate(quotes);
  const age = s.desk.seq === 0 ? Number.POSITIVE_INFINITY : now - s.desk.tObs;
  console.log(
    `${new Date().toISOString()} block ${head} | desk seq ${s.desk.seq} age ${age}s sigma5 ${(sigmaE9ToAnnual(s.desk.sigma5E9) * 100).toFixed(1)}%/yr sigma15 ${(sigmaE9ToAnnual(s.desk.sigma15E9) * 100).toFixed(1)}%/yr dev ${s.desk.devPips} pips flags ${s.desk.flags} | policy ${s.policy.fee0For1}/${s.policy.fee1For0} (${MODE[s.policy.mode] ?? s.policy.mode}) | market ${m ? `${m.price.toFixed(2)} (${m.n} venues)` : "n/a"}`,
  );
  if (age > 90) problems.push(`desk report age ${age} s > 90 s`);
  if (s.policy.mode === FeeMode.Blind) problems.push("policy mode blind");

  const from = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  const [poked, kPokes] = await Promise.all([
    withRetry(() => client.getLogs({ address: d.poker, event: climPokerAbi[1], fromBlock: from, toBlock: head })),
    withRetry(() => client.getLogs({ address: d.hook, event: pokeFeeHookAbi[3], args: { poolId: d.pools.K.poolId }, fromBlock: from, toBlock: head })),
  ]);
  const lastPoke = poked[poked.length - 1]?.args;
  const lastK = kPokes[kPokes.length - 1];
  for (const name of LIVE_POOLS) {
    const ps = s.pools[name];
    const liq = await withRetry(() =>
      client.readContract({ address: d.uniswap.stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [d.pools[name].poolId], blockNumber: head }),
    );
    console.log(
      `  ${name}: fee ${ps.fee0For1}/${ps.fee1For0} pips (${pipsToBp(ps.fee0For1).toFixed(2)}/${pipsToBp(ps.fee1For0).toFixed(2)} bp) price ${ps.ethUsd.toFixed(2)}${m ? ` gap ${((ps.ethUsd / m.price - 1) * 1e4).toFixed(1)} bp` : ""} L ${Number(liq).toExponential(3)}`,
    );
    if (liq * 2n < d.liquidity) problems.push(`${name} liquidity ${liq} below half the seed ${d.liquidity}`);
  }
  const flat = d.hookConfig.flatPips;
  if (s.pools.F.fee0For1 !== flat || s.pools.F.fee1For0 !== flat) problems.push(`F fee ${s.pools.F.fee0For1}/${s.pools.F.fee1For0} != flat ${flat}`);
  if (lastPoke && lastPoke.expiry !== undefined && lastPoke.expiry > now) {
    if (s.pools.D.fee0For1 !== lastPoke.fee0For1 || s.pools.D.fee1For0 !== lastPoke.fee1For0) {
      problems.push(`D fee ${s.pools.D.fee0For1}/${s.pools.D.fee1For0} != last poke ${lastPoke.fee0For1}/${lastPoke.fee1For0}`);
    }
  }
  console.log(`  last D poke: ${lastPoke ? `seq ${lastPoke.seq} ${lastPoke.fee0For1}/${lastPoke.fee1For0} pips, ${poked.length} in ${LOOKBACK_BLOCKS} blocks` : "none in the lookback"}`);
  console.log(`  last K poke: ${lastK ? `${lastK.args.fee} pips at block ${lastK.blockNumber}, ${kPokes.length} in ${LOOKBACK_BLOCKS} blocks` : "none in the lookback"}`);
  if (poked.length === 0) problems.push("no ClimPoker poke in the lookback");
  if (kPokes.length === 0) problems.push("no keeper poke on K in the lookback");

  const keys: Array<[string, Address, Address | null]> = [["CRE operator", d.cre.simOperator, null]];
  for (const [name, role, router] of [
    ["runner", "runner", null],
    ["keeper", "keeper", null],
    ["arbitrage", "arb", d.routers.arb],
    ["retail", "noise", d.uniswap.poolSwapTest],
  ] as Array<[string, LiveRole, Address | null]>) {
    try {
      keys.push([name, privateKeyToAccount(liveKey(role)).address, router]);
    } catch {
      problems.push(`${name}: key not set in bots/.env`);
    }
  }
  for (const [name, addr, router] of keys) {
    const b = await withRetry(() => readLiveBalances(client, d, addr, router ?? addr));
    const tokens = router ? `, ${formatUnits(b.tETH, 18)} tETH, ${formatUnits(b.tUSDG, 6)} tUSDG` : "";
    console.log(`  ${name} ${addr}: ${formatEther(b.native)} ETH${tokens}`);
    if (b.native < 10n ** 16n) problems.push(`${name} has under 0.01 ETH (bun run live:fund)`);
  }
  for (const [name, file, maxAge] of LOGS) {
    const ts = lastTs(join(OUT_DIR, file));
    const a = ts === null ? null : Math.round((Date.now() - Date.parse(ts)) / 1000);
    console.log(`  bot ${name}: last log ${a === null ? "never" : `${a} s ago`}`);
    if (a === null || a > maxAge) problems.push(`bot ${name} silent (${a === null ? "no log" : `${a} s`} > ${maxAge} s)`);
  }
  const jobs = LIVE_JOB_NAMES.map((name) => ({ name, st: jobState(name) }));
  if (jobs.every((j) => j.st === null)) {
    console.log("  launchd: no fi.clim-fables.* job loaded (bun run live:install starts them)");
  } else {
    for (const { name, st } of jobs) {
      console.log(`  job ${jobLabel(name)}: ${st === null ? "not loaded" : `${st.state ?? "?"}${st.pid ? ` pid ${st.pid}` : ""}, last exit ${st.lastExitCode ?? "?"}`}`);
      if (st === null) problems.push(`job ${name} not loaded (bun run live:install ${name})`);
      else if (st.state !== "running") problems.push(`job ${name} ${st.state ?? "in an unknown state"} (last exit ${st.lastExitCode ?? "?"}; bun run live:logs ${name})`);
    }
  }
  const outagesFile = join(OUT_DIR, "outages.json");
  if (existsSync(outagesFile)) {
    try {
      const o = JSON.parse(readFileSync(outagesFile, "utf8")) as { generatedAt: string; windows: Array<{ from: number; durationSec: number; ongoing: boolean; reason: string }> };
      const last = o.windows[o.windows.length - 1];
      const at = (t: number) => new Date(t * 1000).toISOString().slice(0, 19);
      console.log(
        `  outages: ${o.windows.length} recorded (as of ${o.generatedAt})${last ? `, last from ${at(last.from)} UTC, ${last.durationSec} s${last.ongoing ? " and ongoing" : ""}: ${last.reason}` : ""}`,
      );
    } catch {
      console.log("  outages: bots/out/outages.json unreadable");
    }
  } else {
    console.log("  outages: no record yet (bun run live:outages)");
  }
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  return problems;
}

if (hasFlag("--watch")) {
  const loop = (): void => {
    snapshot().catch((e: unknown) => console.error(shortError(e)));
  };
  loop();
  setInterval(loop, 15_000);
} else {
  const problems = await snapshot();
  process.exit(problems.length === 0 ? 0 : 1);
}
