// Fables' components, rebuilt for the showcase (docs/research/fables-ui-inventory.md §3). Presentational only.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { TONE_COLOR, type Badge } from "@/lib/tiers";
import { EthMark, ExternalIcon, InfoIcon } from "./icons";
import s from "./ui.module.css";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

export function Card({ children, dotted, className, style }: { children: ReactNode; dotted?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx(s.card, dotted && s.dotted, className)} style={style}>
      {children}
    </div>
  );
}

export function Section({ id, title, description, children, aside }: { id?: string; title: ReactNode; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className={s.section}>
      <div className={s.sectionHead} style={{ flexDirection: aside ? "row" : "column", justifyContent: "space-between", alignItems: aside ? "flex-end" : undefined }}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle} data-qa="section-title">{title}</h2>
          {description ? <p className={s.sectionDesc}>{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const Rule = () => <hr className={s.rule} />;

export function AsideGrid({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className={s.aside}>
      <div className={s.asideGrid}>
        <div className={s.rail}>{rail}</div>
        {children}
      </div>
    </div>
  );
}

export function RailRows({ rows }: { rows: Array<{ label: string; tip?: string; value: ReactNode }> }) {
  return (
    <div className={s.railRows}>
      {rows.map((r) => (
        <div key={r.label} className={s.railRow}>
          <span className={s.railLabel} title={r.tip}>
            {r.label}
          </span>
          <span className={s.railValue}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className={s.tip} tabIndex={0} aria-label={text}>
      <InfoIcon size={18} />
      <span className={s.tipBubble} role="tooltip">
        {text}
      </span>
    </span>
  );
}

/** Fables' stat: label, value, then a secondary line; `secondaryAside` puts the secondary (a tier badge) beside the
 *  value instead, as Fables does next to an asymmetric fee. */
export function Stat({ label, tip, value, secondary, secondaryAside }: { label: string; tip?: string; value: ReactNode; secondary?: ReactNode; secondaryAside?: boolean }) {
  const v = (
    <span className={s.statValue} data-qa="stat-value">
      {value}
    </span>
  );
  const sec = secondary !== undefined ? <span className={s.statSecondary}>{secondary}</span> : null;
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>
        {label}
        {tip ? <InfoTip text={tip} /> : null}
      </span>
      {secondaryAside ? (
        <span className={s.statAside}>
          {v}
          {sec}
        </span>
      ) : (
        <>
          {v}
          {sec}
        </>
      )}
    </div>
  );
}

export function TierBadge({ badge, title }: { badge: Badge; title?: string }) {
  return (
    <span className={s.badge} title={title} data-badge={badge.label}>
      <span className={s.badgeDot} style={{ background: TONE_COLOR[badge.tone] }} />
      {badge.label}
    </span>
  );
}

/** "Robinhood | Mainnet" or "Robinhood | Testnet", in Fables' asset badge style. Every live block carries one. */
export function NetworkTag({ network }: { network: "mainnet" | "testnet" }) {
  return (
    <span className={s.assetBadge} data-network={network}>
      <span>Robinhood</span>
      <span className={s.assetDivider} />
      <span className={network === "testnet" ? s.testnet : undefined}>{network === "mainnet" ? "Mainnet" : "Testnet"}</span>
    </span>
  );
}

export function AssetBadge({ name, kind, test = false }: { name: string; kind: string; test?: boolean }) {
  return (
    <span className={s.assetBadge}>
      <EthMark size={12} test={test} bare />
      <span>{name}</span>
      <span className={s.assetDivider} />
      <span>{kind}</span>
    </span>
  );
}

export function LiveDot({ label = "Live", green }: { label?: string; green?: boolean }) {
  return (
    <span className={s.live}>
      <span className={cx(s.liveDot, green && s.liveDotGreen)} />
      {label}
    </span>
  );
}

export const Skeleton = ({ width }: { width?: number }) => <span className={s.skeleton} style={width ? { width } : undefined} aria-label="loading" />;

export function ButtonLink({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "cta" }) {
  const cls = variant === "primary" ? s.primary : variant === "cta" ? s.cta : s.secondary;
  return href.startsWith("http") ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link className={cls} href={href}>
      {children}
    </Link>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={s.extLink} href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalIcon size={14} />
    </a>
  );
}

export function AddressLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return (
    <a className={s.address} href={href} target="_blank" rel="noreferrer" title={title}>
      {children}
    </a>
  );
}

/** ETH and USDG as two halves of one circle (Fables' pair logo); USDG's mark is Fables' file, ETH's is clim's. */
export function PairLogo({ size = 40, test = false }: { size?: number; test?: boolean }) {
  const half = size / 2 - 1;
  return (
    <span className={s.pair} style={{ width: size, height: size }} aria-hidden>
      <span className={s.pairHalf} style={{ left: 0, width: half }}>
        <EthMark size={size} test={test} />
      </span>
      <span className={s.pairHalf} style={{ right: 0, width: half }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 2-colour SVG at a fixed size, nothing to optimise */}
        <img src="/fables/tokens_USDG.svg" alt="" width={size} height={size} style={{ marginLeft: -(size - half) }} />
      </span>
    </span>
  );
}

export function ChartPanel({ top, children, legend, style }: { top?: ReactNode; children: ReactNode; legend?: ReactNode; style?: CSSProperties }) {
  return (
    <div className={s.panel} style={style} data-qa="chart-panel">
      {top ? <div className={s.panelTop}>{top}</div> : null}
      {children}
      {legend ? <div className={s.panelLegend}>{legend}</div> : null}
    </div>
  );
}

export function Swatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className={s.swatch}>
      <span className={s.swatchLine} style={dashed ? { background: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 5px)` } : { background: color }} />
      {label}
    </span>
  );
}

export const ReadError = ({ error }: { error: unknown }) => (
  <p className={s.readError} role="alert">
    Read failed: {error instanceof Error ? error.message.split("\n")[0] : String(error)}. Retrying.
  </p>
);

export type LiveKind = "fee" | "avgfee" | "price" | "int" | "count" | "sigma" | "gap" | "mode" | "clock" | "bool";

export type LiveRange = { fromBlock: bigint; toBlock: bigint; fromTs: number; toTs: number; cacheBlock?: bigint };

/** Where a window statistic's logs came from: the server's cache (built at `cacheBlock`), that cache topped up from the
 *  chain by this browser, or the chain alone. */
export const liveSource = (r: LiveRange) => (r.cacheBlock === undefined ? "chain" : r.cacheBlock === r.toBlock ? "cache" : "cache+chain");

/** A number read from a chain. The live check (e2e/live.spec.ts) re-reads every [data-live] element's key at its
 *  block and compares both the raw value and the text. */
export function LiveValue({ k, chain, block, raw, text, range }: { k: string; chain: "mainnet" | "testnet"; block: bigint; raw: string | number | bigint | boolean; text: string; range?: LiveRange }) {
  return (
    <span
      data-live={k}
      data-chain={chain}
      data-block={block.toString()}
      data-raw={String(raw)}
      data-from-block={range?.fromBlock.toString()}
      data-to-block={range?.toBlock.toString()}
      data-from-ts={range?.fromTs}
      data-to-ts={range?.toTs}
      data-source={range ? liveSource(range) : undefined}
      data-cache-block={range?.cacheBlock?.toString()}
      className="tabular"
    >
      {text}
    </span>
  );
}
