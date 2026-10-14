// Minimal .env editing for keys.ts: read KEY=VALUE pairs and add missing keys without touching anything else.

/** KEY=VALUE lines (comments, blanks and malformed lines ignored; surrounding quotes stripped; the last one wins). */
export function parseEnvText(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^["']|["']$/g, ""));
  }
  return out;
}

/** Sets each key that is absent or empty (an empty line is filled in place); keeps every other line as is. */
export function setMissing(text: string, entries: ReadonlyArray<readonly [string, string]>): { text: string; added: string[] } {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const added: string[] = [];
  for (const [k, v] of entries) {
    const i = lines.findIndex((l) => l.trim().startsWith(`${k}=`));
    if (i >= 0) {
      const current = (lines[i] ?? "").trim().slice(k.length + 1).trim();
      if (current !== "") continue;
      lines[i] = `${k}=${v}`;
    } else {
      lines.push(`${k}=${v}`);
    }
    added.push(k);
  }
  return { text: lines.length > 0 ? `${lines.join("\n")}\n` : "", added };
}
