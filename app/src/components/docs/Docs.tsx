import Link from "next/link";
import type { ReactNode } from "react";
import { BatchIcon, ChartIcon, ForkIcon, GaugeIcon, KeyIcon, LadderIcon, LoopIcon, PathIcon, PauseIcon, RunIcon, ShieldIcon, WarningIcon } from "@/components/ui/icons";
import { inlineMd } from "@/lib/inlineMd";
import { REPO_URL, repoFile } from "@/lib/site";
import s from "./docs.module.css";

type Leaf = readonly [label: string, hash: string, icon: (p: { size?: number }) => ReactNode];

export const SIDEBAR: ReadonlyArray<{ label: string; href: "/integrate" | "/evidence"; items: readonly Leaf[] }> = [
  {
    label: "Integrate",
    href: "/integrate",
    items: [
      ["The ladder", "#ladder", LadderIcon],
      ["Level 1: keeper input", "#level-1", KeyIcon],
      ["Level 2: the batch", "#level-2", BatchIcon],
      ["Verify the contracts", "#verify", ShieldIcon],
      ["Path to mainnet", "#mainnet", PathIcon],
    ],
  },
  {
    label: "Evidence",
    href: "/evidence",
    items: [
      ["Results, as measured", "#results", ChartIcon],
      ["The fork run", "#fork-run", ForkIcon],
      ["Gas and cadence", "#gas", GaugeIcon],
      ["The live loop", "#live-loop", LoopIcon],
      ["Desk outages", "#outages", PauseIcon],
      ["Failure modes", "#security", WarningIcon],
    ],
  },
];

/** Fables' docs layout (inventory §2.10): a 220 px rail of groups and indented leaves with icons, a footer row under a
 *  hairline, and a 718 px main column, the grid (986 px) centred. */
export function DocsLayout({ current, children }: { current: "/integrate" | "/evidence"; children: ReactNode }) {
  return (
    <div className={s.docs}>
      <aside className={s.sidebar} aria-label="On this page">
        <div className={s.railScroll}>
          {SIDEBAR.map((g) => (
            <div key={g.href} className={s.group}>
              <Link href={g.href} className={g.href === current ? `${s.groupLabel} ${s.groupActive}` : s.groupLabel}>
                {g.label}
              </Link>
              <ul className={s.leaves}>
                {g.items.map(([label, hash, Icon]) => (
                  <li key={hash}>
                    <Link href={`${g.href}${hash}`} className={s.leaf}>
                      <Icon size={16} />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className={s.group}>
            <Link href="/run" className={s.groupLabel}>
              Run
            </Link>
            <ul className={s.leaves}>
              <li>
                <Link href="/run" className={s.leaf}>
                  <RunIcon size={16} />
                  Replay the run
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className={s.railFooter}>
          <Link href="/credits" className={s.railFootLink}>
            Credits
          </Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={s.railFootLink}>
            Source
          </a>
          <a href={repoFile("docs/security.md")} target="_blank" rel="noreferrer" className={s.railFootLink}>
            Security
          </a>
        </div>
      </aside>
      <nav className={s.mobileNav} aria-label="Docs">
        {[...SIDEBAR.map((g) => [g.href, g.label] as const), ["/run", "Run"] as const].map(([href, label]) => (
          <Link key={href} href={href} className={s.mobileChip} aria-current={href === current ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
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
