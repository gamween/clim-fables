// Fables' transactions table, used for fee updates: the keeper's overrides on mainnet and clim's reports on testnet,
// newest first, each linked to its transaction (inventory §8: "rows of pokeFee calls with type dots").
import { AddressLink, NetworkTag } from "@/components/ui/kit";
import type { DeskReport } from "@/lib/chain/decode";
import { testnetTx } from "@/lib/chain/deployments";
import { fablesTx } from "@/lib/chain/fables";
import type { ClimPoint, PokeEvent } from "@/lib/fees";
import { formatAge, formatFeePct, formatUtcClock, shortAddress } from "@/lib/format";
import { MODE_LABEL } from "@/lib/tiers";
import p from "../pages.module.css";

type Row = { t: number; key: string; source: "keeper" | "clim"; fee0For1: number; fee1For0: number; detail: string; tx: string; txUrl: string; reportTx?: string };

export function feeUpdateRows(pokes: readonly PokeEvent[], points: readonly ClimPoint[], reports: readonly DeskReport[], limit: number): Row[] {
  const reportBySeq = new Map(reports.map((r) => [r.seq, r.tx]));
  const keeper: Row[] = pokes.flatMap((e) =>
    e.kind === "poke" ? [{ t: e.t, key: `${e.tx}-${e.logIndex}`, source: "keeper" as const, fee0For1: e.fee0For1, fee1For0: e.fee1For0, detail: `until ${formatUtcClock(e.expiry)}`, tx: e.tx, txUrl: fablesTx(e.tx) }] : [],
  );
  const clim: Row[] = points.map((c) => ({
    t: c.t,
    key: `${c.tx}-${c.seq}`,
    source: "clim" as const,
    fee0For1: c.fee0For1,
    fee1For0: c.fee1For0,
    detail: `report ${c.seq} · ${MODE_LABEL[c.mode] ?? c.mode}${c.eventApplied ? " · event" : ""}`,
    tx: c.tx,
    txUrl: testnetTx(c.tx),
    reportTx: reportBySeq.get(c.seq),
  }));
  return [...keeper, ...clim].sort((a, b) => b.t - a.t).slice(0, limit);
}

export function FeeUpdates({ rows, nowTs }: { rows: Row[]; nowTs: number }) {
  return (
    <div className={p.txCard}>
      <div className={p.tableWrap}>
        <table className={p.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Network</th>
              <th className={p.num}>Buy ETH</th>
              <th className={p.num}>Sell ETH</th>
              <th>Detail</th>
              <th className={p.num}>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td title={new Date(r.t * 1000).toISOString()}>{formatAge(nowTs - r.t)}</td>
                <td>
                  <span className={p.typeDot} style={{ ["--dot" as string]: r.source === "keeper" ? "var(--accent)" : "var(--brand)" }}>
                    {r.source === "keeper" ? "Fables keeper" : "clim"}
                  </span>
                </td>
                <td>
                  <NetworkTag network={r.source === "keeper" ? "mainnet" : "testnet"} />
                </td>
                <td className={p.num}>{formatFeePct(r.fee1For0)}</td>
                <td className={p.num}>{formatFeePct(r.fee0For1)}</td>
                <td className={p.muted}>{r.detail}</td>
                <td className={p.num}>
                  {r.reportTx ? (
                    <>
                      <AddressLink href={testnetTx(r.reportTx)} title="the desk report">
                        report
                      </AddressLink>{" "}
                      ·{" "}
                    </>
                  ) : null}
                  <AddressLink href={r.txUrl} title={r.source === "keeper" ? "the keeper's pokeFee" : "ClimPoker.poke on pool D"}>
                    {shortAddress(r.tx)}
                  </AddressLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
