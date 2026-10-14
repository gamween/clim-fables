import Link from "next/link";
import type { ReactNode } from "react";
import { inlineMd } from "@/lib/inlineMd";
import s from "./docs.module.css";

export const SIDEBAR = [
  {
    label: "Integrate",
    href: "/integrate",
    items: [
      ["The ladder", "#ladder"],
      ["Level 1: keeper input", "#level-1"],
      ["Level 2: the batch", "#level-2"],
      ["Verify the contracts", "#verify"],
      ["Path to mainnet", "#mainnet"],
    ],
  },
  {
    label: "Evidence",
    href: "/evidence",
    items: [
      ["Results, as measured", "#results"],
      ["The fork run", "#fork-run"],
      ["Gas and cadence", "#gas"],
      ["The live loop", "#live-loop"],
      ["Desk outages", "#outages"],
      ["Failure modes", "#security"],
    ],
  },
] as const;

export function DocsLayout({ current, children }: { current: "/integrate" | "/evidence"; children: ReactNode }) {
  return (
    <div className={s.docs}>
      <aside className={s.sidebar} aria-label="On this page">
        {SIDEBAR.map((g) => (
          <div key={g.href} className={s.group}>
            <Link href={g.href} className={s.groupLabel}>
              {g.label}
            </Link>
            {g.items.map(([label, hash]) => (
              <Link key={hash} href={`${g.href}${hash}`} className={g.href === current ? `${s.leaf} ${s.leafActive}` : s.leaf}>
                {label}
              </Link>
            ))}
          </div>
        ))}
        <Link href="/run" className={s.leaf}>
          Replay the run
        </Link>
      </aside>
      <article className={s.main}>{children}</article>
    </div>
  );
}

export const Rule = () => <hr className={s.ruleBig} />;
export const Caption = ({ children }: { children: ReactNode }) => <p className={s.caption}>{children}</p>;
export const Callout = ({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "good" | "warn" }) => (
  <div className={`${s.callout} ${tone === "good" ? s.calloutGood : tone === "warn" ? s.calloutWarn : ""}`}>{children}</div>
);
export const Code = ({ children }: { children: string }) => <pre className={s.code}>{children}</pre>;

/** A Markdown table from the repository's docs, cells rendered with their inline code and links. */
export function MdTable({ table, docDir }: { table: { header: string[]; rows: string[][] }; docDir: string }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {table.header.map((h) => (
              <th key={h}>{inlineMd(h, docDir)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{inlineMd(c, docDir)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Table({ header, rows }: { header: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const docsStyles = s;
