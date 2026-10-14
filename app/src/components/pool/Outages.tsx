"use client";
// The desk's outage windows: the recorded snapshot plus what the chain shows since (lib/outages.ts).
import { useDeskOutages } from "@/hooks/useDeskOutages";
import { AddressLink, Skeleton } from "@/components/ui/kit";
import { LIVE, testnetAddress } from "@/lib/chain/deployments";
import { formatDuration, formatUtcDateTime } from "@/lib/format";
import p from "../pages.module.css";

export function OutagesTable() {
  const { data, error } = useDeskOutages();
  if (!data) return error ? <p className={p.note}>The outage record could not be read from the chain; the recorded windows are in the evidence files.</p> : <Skeleton width={300} />;
  return (
    <div className={p.txCard}>
      <div className={p.tableWrap}>
        <table className={p.table}>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th className={p.num}>Silent for</th>
              <th className={p.num}>Reports</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {[...data.windows].reverse().map((w) => (
              <tr key={`${w.seqBefore}-${w.from}`}>
                <td>{formatUtcDateTime(w.from)}</td>
                <td>{w.to === null ? "ongoing" : formatUtcDateTime(w.to)}</td>
                <td className={p.num}>{formatDuration(w.durationSec)}</td>
                <td className={p.num}>
                  {w.seqBefore} to {w.seqAfter ?? "-"}
                </td>
                <td className={p.muted} style={{ whiteSpace: "normal" }}>
                  {w.reason}
                  {w.source === "chain" ? " (chain)" : " (operator's record)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={p.note} style={{ padding: "12px 4px 0" }}>
        A window is a gap of more than {data.gapSec} s between two RiskReportedV2 events of the desk <AddressLink href={testnetAddress(LIVE.riskDesk)}>RiskDeskV2</AddressLink>. While the desk is
        silent, pool D keeps its last override until it expires (600 s after its observation), then charges the flat fee (docs/security.md §7). Recorded up to block{" "}
        {data.scannedToBlock.toLocaleString("en-US")}, read from the chain after it.
      </p>
    </div>
  );
}
