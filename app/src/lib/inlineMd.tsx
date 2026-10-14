// Inline Markdown of the repository's docs (table cells, quoted lines): `code` and [text](href), nothing else. Relative
// links resolve against the document's folder and point at the file on GitHub.
import type { ReactNode } from "react";
import { REPO_URL } from "./site";

export function resolveHref(href: string, docDir: string): string {
  if (/^https?:\/\//.test(href)) return href;
  const [path, hash] = href.split("#");
  const parts = `${docDir}/${path}`.split("/").filter((x) => x !== "" && x !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else out.push(p);
  }
  const joined = out.join("/");
  const kind = joined.endsWith("/") || !/\.[a-z0-9]+$/i.test(joined) ? "tree" : "blob";
  return `${REPO_URL}/${kind}/main/${joined}${hash ? `#${hash}` : ""}`;
}

const TOKEN = /(`[^`]+`)|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inlineMd(text: string, docDir: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<code key={i++}>{m[1].slice(1, -1)}</code>);
    else if (m[2] !== undefined && m[3] !== undefined) {
      out.push(
        <a key={i++} href={resolveHref(m[3], docDir)} target="_blank" rel="noreferrer">
          {inlineMd(m[2], docDir)}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
