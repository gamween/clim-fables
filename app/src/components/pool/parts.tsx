// Pieces shared by the pool pages: the fee value (one or two directions), the Dynamic Fee rail, the params card and the
// transactions table, each in Fables' layout.
import Link from "next/link";
import type { ReactNode } from "react";
import { AddressLink, LiveValue, NetworkTag, PairLogo, RailRows, Rule, Skeleton, Stat } from "@/components/ui/kit";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { CopyButton } from "@/components/ui/CopyButton";
import type { SwapRow } from "@/lib/chain/decode";
import { formatAge, formatAmount, formatAvgFeePct, formatFeePct, formatInt, shortAddress } from "@/lib/format";
import type { FeeWindow } from "@/lib/windowStats";
import p from "../pages.module.css";

type Chain = "mainnet" | "testnet";

/** One fee when both directions pay the same, "Sell / Buy" otherwise (ETH is currency0: zero-for-one sells ETH). */
export function FeeValue({ prefix, chain, block, fee0For1, fee1For0 }: { prefix: string; chain: Chain; block: bigint; fee0For1: number; fee1For0: number }) {
  if (fee0For1 === fee1For0) {
    return (
      <span>
        <LiveValue k={`${prefix}:fee0For1`} chain={chain} block={block} raw={fee0For1} text={formatFeePct(fee0For1)} />
        <span hidden>
          <LiveValue k={`${prefix}:fee1For0`} chain={chain} block={block} raw={fee1For0} text={formatFeePct(fee1For0)} />
        </span>
      </span>
    );
  }
  return (
    <span className={p.split}>
      <span className={p.splitLabel}>Buy</span>
      <LiveValue k={`${prefix}:fee1For0`} chain={chain} block={block} raw={fee1For0} text={formatFeePct(fee1For0)} />
      <span className={p.splitLabel}>Sell</span>
      <LiveValue k={`${prefix}:fee0For1`} chain={chain} block={block} raw={fee0For1} text={formatFeePct(fee0For1)} />
    </span>
  );
}

export function PoolHeader({ title, network, sub, actions }: { title: string; network: Chain; sub: ReactNode; actions?: ReactNode }) {
  return (
    <div className={p.poolHead} data-qa="pool-head">
      <Link href="/markets" className={p.back}>
        <ArrowLeftIcon /> Back
      </Link>
      <div className={p.identity}>
        <div className={p.identityLeft}>
          <PairLogo size={61} />
          <div>
            <h1 className={p.pairTitle}>{title}</h1>
            <div className={p.pairSub}>
              {sub}
              <NetworkTag network={network} />
            </div>
          </div>
        </div>
        {actions ? <div className={p.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}

/** Fables' Dynamic Fee rail: the current fee, its average over the window, then peak, low and changes. */
export function FeeRail({ prefix, chain, current, win, history, label, extra }: {
  prefix: string;
  chain: Chain;
  current: ReactNode;
  win: FeeWindow | null;
  history: { fromBlock: bigint; toBlock: bigint } | null;
  label: string;
  extra?: Array<{ label: string; tip?: string; value: ReactNode }>;
}) {
  const range = win && history ? { fromBlock: history.fromBlock, toBlock: history.toBlock, fromTs: win.fromTs, toTs: win.toTs } : undefined;
  const v = (k: string, raw: number | null, text: string) =>
    range && raw !== null && history ? <LiveValue k={`${prefix}:${k}`} chain={chain} block={history.toBlock} raw={raw} text={text} range={range} /> : <Skeleton />;
  return (
    <>
      <Stat
        label="Current fee"
        tip="The fee a swap pays now, read from the hook's currentFee"
        value={current}
        secondary={win && range ? <span>{v("avg", win.avg, formatAvgFeePct(win.avg))} average over {label}</span> : <Skeleton width={160} />}
      />
      <Rule />
      <RailRows
        rows={[
          { label: "Peak", tip: `The dearest this market's fee has been in the last ${label}`, value: v("peak", win?.peak ?? null, formatFeePct(win?.peak)) },
          { label: "Low", tip: `The cheapest this market's fee has been in the last ${label}`, value: v("low", win?.low ?? null, formatFeePct(win?.low)) },
          { label: "Changes", tip: "How many overrides were posted in the window (FeePoked logs)", value: v("changes", win?.changes ?? null, formatInt(win?.changes)) },
          ...(extra ?? []),
        ]}
      />
    </>
  );
}

export function ParamsCard({ rows }: { rows: Array<{ label: string; tip?: string; value: ReactNode; copy?: string }> }) {
  return (
    <div className={p.params}>
      {rows.map((r) => (
        <div key={r.label} className={p.param}>
          <span className={p.paramLabel} title={r.tip}>
            {r.label}
          </span>
          <span className={p.paramValue}>
            {r.value}
            {r.copy ? <CopyButton value={r.copy} label={r.label} /> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Fables' "Recent transactions" table, for swaps: newest first. Times are read for the rows shown only. */
export function SwapsTable({ swaps, times, nowTs, txUrl }: { swaps: readonly SwapRow[]; times: ReadonlyMap<bigint, number> | null; nowTs: number; txUrl: (tx: string) => string }) {
  return (
    <div className={p.txCard}>
      <div className={p.tableWrap}>
        <table className={p.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th className={p.num}>ETH</th>
              <th className={p.num}>USDG</th>
              <th className={p.num}>Fee paid</th>
              <th className={p.num}>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {swaps.length === 0 ? (
              <tr>
                <td colSpan={6} className={p.muted}>
                  No swap in this window
                </td>
              </tr>
            ) : (
              swaps.map((s) => {
                const t = times?.get(s.block);
                return (
                  <tr key={`${s.tx}-${s.logIndex}`}>
                    <td title={t === undefined ? undefined : new Date(t * 1000).toISOString()}>{t === undefined ? "-" : formatAge(nowTs - t)}</td>
                    <td>
                      <span className={p.typeDot} style={{ ["--dot" as string]: s.side === "buy" ? "var(--positive)" : "var(--negative)" }}>
                        {s.side === "buy" ? "Buy ETH" : "Sell ETH"}
                      </span>
                    </td>
                    <td className={p.num}>{formatAmount(s.eth)}</td>
                    <td className={p.num}>{formatAmount(s.usdg, 2)}</td>
                    <td className={p.num}>{formatFeePct(s.feePips)}</td>
                    <td className={p.num}>
                      <AddressLink href={txUrl(s.tx)}>{shortAddress(s.tx)}</AddressLink>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
