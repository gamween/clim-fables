// Outage windows of the live desk, from on-chain truth only: consecutive RiskReportedV2 events (seq, tObs). The desk
// reports every 30 s, so a gap of more than OUTAGE_GAP_SEC between two reports' tObs is a window in which the desk was
// silent. Used by the bots' outage recorder (bots/out/outages.json) and by plan 04's app, which shows these windows as
// they are measured.

/** A gap of more than three report intervals (3 x 30 s) between two reports is an outage. */
export const OUTAGE_GAP_SEC = 90;

export type ReportPoint = { seq: number; tObs: number };

/** `from` is the tObs of the last report before the silence, `to` the tObs of the first one after it (null while the
 *  desk is still silent); the desk sent nothing strictly between them. */
export type OutageWindow = {
  from: number;
  to: number | null;
  durationSec: number;
  seqBefore: number;
  seqAfter: number | null;
  ongoing: boolean;
};

/** Windows between consecutive reports more than gapSec apart, plus an ongoing one when the last report is more than
 *  gapSec older than nowSec. Reports must come in seq order with increasing tObs. */
export function outageWindows(
  reports: readonly ReportPoint[],
  opts: { gapSec?: number; nowSec?: number } = {},
): OutageWindow[] {
  const gapSec = opts.gapSec ?? OUTAGE_GAP_SEC;
  const out: OutageWindow[] = [];
  for (let i = 1; i < reports.length; i++) {
    const a = reports[i - 1] as ReportPoint;
    const b = reports[i] as ReportPoint;
    if (b.seq <= a.seq || b.tObs <= a.tObs) throw new Error(`reports out of order at seq ${a.seq} -> ${b.seq}`);
    const gap = b.tObs - a.tObs;
    if (gap > gapSec) out.push({ from: a.tObs, to: b.tObs, durationSec: gap, seqBefore: a.seq, seqAfter: b.seq, ongoing: false });
  }
  const last = reports[reports.length - 1];
  if (last !== undefined && opts.nowSec !== undefined && opts.nowSec - last.tObs > gapSec) {
    out.push({ from: last.tObs, to: null, durationSec: opts.nowSec - last.tObs, seqBefore: last.seq, seqAfter: null, ongoing: true });
  }
  return out;
}
