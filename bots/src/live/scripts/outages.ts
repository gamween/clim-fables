// Outage record of the live desk from on-chain truth: scans RiskReportedV2 from the deployment block (then
// incrementally) and writes bots/out/outages.json, one window per gap of more than 90 s between consecutive reports'
// tObs ({from, to, durationSec, seqBefore, seqAfter}), each with the local reason when the Mac's processes recorded one
// (bots/out/outages-local.jsonl). Plan 04's app derives the same windows from the chain with outageWindows() of
// @clim/shared and shows them as measured. Usage: bun src/live/scripts/outages.ts [--watch]
// Env: OUTAGES_EVERY_SEC (pass period with --watch, default 300), OUTAGES_CHUNK_BLOCKS (getLogs range, default 2000)
import { OUTAGE_GAP_SEC, riskDeskV2Abi, type OutageWindow, type ReportPoint } from "@clim/shared";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envNum, hasFlag } from "../../lib/env";
import { appendJsonl, OUT_DIR } from "../../lib/jsonl";
import { liveClient } from "../lib/chain";
import { loadLiveDeployments } from "../lib/deployments";
import { advanceOutages, attachLocalReasons, emptyOutageState, parseLocalOutages, type OutageState } from "../lib/outages";
import { LOCAL_OUTAGES_FILE, runSupervised } from "../lib/supervisor";
import { chunkedRanges } from "../lib/tail";

const CONFIRMATIONS = 20n; // about 2 s of blocks: never read a block that could still change
const OUT_FILE = join(OUT_DIR, "outages.json");
const LOG_FILE = join(OUT_DIR, "outages-rh.jsonl");
const d = loadLiveDeployments();
const client = liveClient();
const chunk = BigInt(envNum("OUTAGES_CHUNK_BLOCKS", 2_000));

type OutagesFile = OutageState & { chainId: number; riskDesk: string };

/** The previous pass's state, or a fresh one when there is none or it belongs to another desk. */
function loadState(): OutageState {
  if (!existsSync(OUT_FILE)) return emptyOutageState(d.deployBlock);
  try {
    const f = JSON.parse(readFileSync(OUT_FILE, "utf8")) as Partial<OutagesFile> & { windows?: OutageWindow[] };
    if (f.chainId !== d.chainId || f.riskDesk?.toLowerCase() !== d.riskDesk.toLowerCase() || typeof f.scannedToBlock !== "number") {
      return emptyOutageState(d.deployBlock);
    }
    return {
      scannedToBlock: f.scannedToBlock,
      reportCount: f.reportCount ?? 0,
      lastReport: f.lastReport ?? null,
      windows: (f.windows ?? []).filter((w) => !w.ongoing).map(({ from, to, durationSec, seqBefore, seqAfter, ongoing }) => ({ from, to, durationSec, seqBefore, seqAfter, ongoing })),
    };
  } catch {
    return emptyOutageState(d.deployBlock);
  }
}

async function pass(): Promise<void> {
  const head = await client.getBlockNumber();
  const safe = head > CONFIRMATIONS ? head - CONFIRMATIONS : head;
  const nowSec = Number((await client.getBlock({ blockNumber: safe })).timestamp);
  const prev = loadState();
  const reports: ReportPoint[] = [];
  for (const [a, b] of chunkedRanges(BigInt(prev.scannedToBlock + 1), safe, chunk)) {
    const logs = await client.getLogs({ address: d.riskDesk, event: riskDeskV2Abi[1], fromBlock: a, toBlock: b });
    for (const l of logs) reports.push({ seq: Number(l.args.seq ?? 0), tObs: Number(l.args.tObs ?? 0) });
  }
  const { state, windows } = advanceOutages(prev, reports, Number(safe), nowSec);
  const local = existsSync(LOCAL_OUTAGES_FILE) ? parseLocalOutages(readFileSync(LOCAL_OUTAGES_FILE, "utf8")) : [];
  const explained = attachLocalReasons(windows, local, nowSec);
  const file = {
    generatedAt: new Date().toISOString(),
    note: `Windows in which clim's desk sent no report for more than ${OUTAGE_GAP_SEC} s, from consecutive RiskReportedV2 events (from = tObs of the last report before, to = tObs of the first after, null while silent). reason and local come from the Mac's own records, when it kept one.`,
    chainId: d.chainId,
    riskDesk: d.riskDesk,
    gapSec: OUTAGE_GAP_SEC,
    deployBlock: d.deployBlock,
    scannedToBlock: state.scannedToBlock,
    chainTimeSec: nowSec,
    reportCount: state.reportCount,
    lastReport: state.lastReport,
    windows: explained,
  };
  // write then rename, so a reader (live:status, a second pass) never sees half a file
  writeFileSync(`${OUT_FILE}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(`${OUT_FILE}.tmp`, OUT_FILE);
  const ongoing = explained.find((w) => w.ongoing);
  appendJsonl(LOG_FILE, { ts: file.generatedAt, scannedToBlock: state.scannedToBlock, newReports: reports.length, windows: explained.length, ongoing: ongoing !== undefined });
  console.log(
    `[outages] block ${safe}: ${reports.length} new reports (${state.reportCount} in all), ${explained.length} windows${ongoing ? `, desk silent for ${ongoing.durationSec} s now` : ""} -> bots/out/outages.json`,
  );
}

if (hasFlag("--watch")) {
  const everyMs = envNum("OUTAGES_EVERY_SEC", 300) * 1_000;
  let nextAt = 0;
  runSupervised({
    name: "outages",
    logFile: LOG_FILE,
    everyMs: 10_000, // the clock is watched every 10 s; a pass runs every OUTAGES_EVERY_SEC
    immediate: true,
    tick: async () => {
      if (Date.now() < nextAt) return;
      await pass();
      nextAt = Date.now() + everyMs;
    },
    onResume: () => {
      nextAt = 0; // a pass right after a wake records the window that just ended
    },
  });
} else {
  await pass();
}
