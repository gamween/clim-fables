// The desk's outage windows: the snapshot the live stack recorded (bots/out/outages.json, synced at build time, with
// the operator's reason for each window) followed by the windows recomputed in the browser from the RiskReportedV2
// logs after the snapshot, with shared/'s outageWindows (the same function the recorder uses).
import { outageWindows, type OutageWindow, type ReportPoint } from "@clim/shared";

export type OutageSnapshot = {
  generatedAt: string;
  gapSec: number;
  deployBlock: number;
  scannedToBlock: number;
  chainTimeSec: number;
  reportCount: number;
  lastReport: ReportPoint | null;
  windows: Array<OutageWindow & { reason: string }>;
};

export type ShownOutage = OutageWindow & { reason: string; source: "record" | "chain" };

export function mergeOutages(snapshot: OutageSnapshot, newReports: readonly ReportPoint[], nowSec: number): ShownOutage[] {
  const recorded: ShownOutage[] = snapshot.windows.map((w) => ({ ...w, source: "record" }));
  const series = [...(snapshot.lastReport ? [snapshot.lastReport] : []), ...[...newReports].sort((a, b) => a.seq - b.seq)];
  const live = outageWindows(series, { gapSec: snapshot.gapSec, nowSec }).map(
    (w): ShownOutage => ({ ...w, source: "chain", reason: w.ongoing ? "ongoing: the desk has not reported since" : "measured on chain after the last recorded snapshot; no operator record" }),
  );
  return [...recorded, ...live];
}
