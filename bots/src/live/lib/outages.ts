// Outage record of the live stack, pure parts. The windows come from the chain (shared/src/outages.ts: consecutive
// RiskReportedV2 events); the local reasons come from bots/out/outages-local.jsonl, where each process writes what it saw
// (a wall-clock jump on wake, a restart, a streak of RPC errors). A window keeps every local record that overlaps it.
import { OUTAGE_GAP_SEC, outageWindows, type OutageWindow, type ReportPoint } from "@clim/shared";

export type LocalOutageKind = "wake" | "restart" | "rpc-errors";
/** One line of bots/out/outages-local.jsonl: [fromSec, toSec] is when `process` was not acting. */
export type LocalOutage = { ts: string; process: string; kind: LocalOutageKind; fromSec: number; toSec: number; detail: string };
export type ExplainedWindow = OutageWindow & { reason: string; local: LocalOutage[] };

/** Scan state kept in bots/out/outages.json between passes: closed windows only, the last report, the scanned range. */
export type OutageState = { scannedToBlock: number; reportCount: number; lastReport: ReportPoint | null; windows: OutageWindow[] };

const KINDS: readonly LocalOutageKind[] = ["wake", "restart", "rpc-errors"];

export function emptyOutageState(deployBlock: number): OutageState {
  return { scannedToBlock: deployBlock - 1, reportCount: 0, lastReport: null, windows: [] };
}

/** Adds the reports of a new block range. Reports must continue the previous ones seq by seq (a hole means a lost
 *  getLogs page: the pass throws and the next one rescans the same range). Returns the new state and every window,
 *  the ongoing one (if any) last. */
export function advanceOutages(
  prev: OutageState,
  newReports: readonly ReportPoint[],
  scannedToBlock: number,
  nowSec: number,
  gapSec = OUTAGE_GAP_SEC,
): { state: OutageState; windows: OutageWindow[] } {
  const series = prev.lastReport ? [prev.lastReport, ...newReports] : [...newReports];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1] as ReportPoint;
    const b = series[i] as ReportPoint;
    if (b.seq !== a.seq + 1) throw new Error(`missing reports between seq ${a.seq} and ${b.seq}`);
  }
  const found = outageWindows(series, { gapSec, nowSec });
  const closed = [...prev.windows, ...found.filter((w) => !w.ongoing)];
  const state: OutageState = {
    scannedToBlock,
    reportCount: prev.reportCount + newReports.length,
    lastReport: series[series.length - 1] ?? null,
    windows: closed,
  };
  return { state, windows: [...closed, ...found.filter((w) => w.ongoing)] };
}

/** Parses outages-local.jsonl; malformed lines are skipped. */
export function parseLocalOutages(text: string): LocalOutage[] {
  const out: LocalOutage[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const o = JSON.parse(line) as Partial<LocalOutage>;
      if (
        typeof o.ts === "string" &&
        typeof o.process === "string" &&
        KINDS.includes(o.kind as LocalOutageKind) &&
        typeof o.fromSec === "number" &&
        typeof o.toSec === "number"
      ) {
        out.push({ ts: o.ts, process: o.process, kind: o.kind as LocalOutageKind, fromSec: o.fromSec, toSec: o.toSec, detail: typeof o.detail === "string" ? o.detail : "" });
      }
    } catch {
      // not JSON: skip
    }
  }
  return out;
}

/** One sentence for a window from the local records that overlap it; the most telling kind wins. */
export function summarizeReason(local: readonly LocalOutage[]): string {
  const who = (k: LocalOutageKind) => [...new Set(local.filter((r) => r.kind === k).map((r) => r.process))].sort().join(", ");
  if (local.some((r) => r.kind === "wake")) return `wall-clock gap seen by ${who("wake")}: the Mac was asleep or the processes were suspended`;
  if (local.some((r) => r.kind === "restart")) return `processes stopped and restarted: ${who("restart")}`;
  if (local.some((r) => r.kind === "rpc-errors")) return `RPC or network errors in ${who("rpc-errors")}`;
  return "unknown: no local record (the CRE runs failed, or the Mac's records are missing)";
}

/** Attaches to each window the local records overlapping [from - slackSec, to + slackSec] (to = now when ongoing). */
export function attachLocalReasons(windows: readonly OutageWindow[], local: readonly LocalOutage[], nowSec: number, slackSec = 60): ExplainedWindow[] {
  return windows.map((w) => {
    const end = (w.to ?? nowSec) + slackSec;
    const mine = local.filter((r) => r.toSec >= w.from - slackSec && r.fromSec <= end);
    return { ...w, reason: summarizeReason(mine), local: mine };
  });
}
