// Copies the repository's single sources of truth into the app, so the app builds on its own (Vercel uploads app/
// only). Two kinds of output, both committed:
// - src/vendor/: byte-identical copies of shared/ (sources, deployments, parameters) and docs/integrate/keeper-read.ts,
//   imported as `@clim/shared` and `@/vendor/integrate/keeper-read`;
// - src/generated/: evidence, lab and docs data, copied or extracted verbatim.
// A missing required source fails the sync (the app ships real data only). bots/out/outages.json is gitignored and
// exists only on the machine that runs the live stack: without it the committed snapshot is kept as it is.
// Run: npm run sync. Check that every committed output matches its source: npm run sync -- --check.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The lab studies quoted on /evidence, in the README's order, with the README's titles. */
export const LAB_FRAMING = [
  { title: "Effective arbitrage interval", file: "lab/out/fables-dt-eff.json" },
  { title: "Volatility window", file: "lab/out/fables-window.json" },
  { title: "Volatility estimator", file: "lab/out/fables-estimator.json" },
  { title: "Per-direction signal", file: "lab/out/fables-direction.json" },
];

export const EVIDENCE_COPIES = [
  ["docs/evidence/fork-run-2026-10-07.json", "src/generated/fork-run-2026-10-07.json"],
  ["docs/evidence/fork-reports-2026-10-07.json", "src/generated/fork-reports-2026-10-07.json"],
  ["docs/evidence/gas-robinhood-testnet.json", "src/generated/gas-robinhood-testnet.json"],
  ["lab/out/fables-storm-2026-10-07.json", "src/generated/fables-storm-2026-10-07.json"],
];

const SHARED_DATA = ["deployments/sepolia.json", "deployments/robinhood-testnet.json", "params.json", "params-fables.json", "keeper-map-fables.json"];

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** Lines of the section that starts with `heading` (a whole line, e.g. "## 7. Failure modes ...") up to the next
 *  heading of the same or a higher level. */
export function sectionLines(md, headingPrefix) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(headingPrefix));
  if (start < 0) throw new Error(`heading not found: ${headingPrefix}`);
  const level = /^#+/.exec(lines[start])[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i]);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out;
}

/** The first Markdown table in `lines`: its header cells and rows of cells, as written (inline Markdown kept). */
export function firstTable(lines) {
  const start = lines.findIndex((l) => l.startsWith("|"));
  if (start < 0) throw new Error("no table");
  const rows = [];
  for (let i = start; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i]);
  const cells = (row) => row.slice(1, row.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
  const [header, separator, ...body] = rows;
  if (!separator || !/^\|[\s|:-]+\|?$/.test(separator)) throw new Error("table without a separator row");
  return { header: cells(header), rows: body.map(cells) };
}

/** The first fenced block of `lang` after the line that starts with `after`. */
export function fenceAfter(md, after, lang) {
  const lines = md.split("\n");
  const from = lines.findIndex((l) => l.startsWith(after));
  if (from < 0) throw new Error(`line not found: ${after}`);
  const open = lines.findIndex((l, i) => i > from && l.trim() === "```" + lang);
  if (open < 0) throw new Error(`no ${lang} block after: ${after}`);
  const close = lines.findIndex((l, i) => i > open && l.trim() === "```");
  return `${lines.slice(open + 1, close).join("\n")}\n`;
}

/** The newest docs/evidence/live-check-YYYY-MM-DD.json. */
export function latestLiveCheck(repoRoot) {
  const files = readdirSync(join(repoRoot, "docs/evidence"))
    .filter((f) => /^live-check-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) throw new Error("no docs/evidence/live-check-*.json");
  return `docs/evidence/${files[files.length - 1]}`;
}

/** The outage record without the Mac's local process records (the reason sentence keeps what they say). */
export function outageSnapshot(raw) {
  const { generatedAt, chainId, riskDesk, gapSec, deployBlock, scannedToBlock, chainTimeSec, reportCount, lastReport, windows } = raw;
  return {
    source: "bots/out/outages.json",
    generatedAt,
    chainId,
    riskDesk,
    gapSec,
    deployBlock,
    scannedToBlock,
    chainTimeSec,
    reportCount,
    lastReport,
    windows: windows.map(({ from, to, durationSec, seqBefore, seqAfter, ongoing, reason }) => ({ from, to, durationSec, seqBefore, seqAfter, ongoing, reason })),
  };
}

/** Every output as { path (relative to the app), content (string), optional? }. The outage snapshot is optional: its
 *  source is local to the live stack's machine and changes every pass, so it is synced when present and never
 *  checked. */
export function buildOutputs({ repoRoot, appRoot }) {
  const read = (rel) => {
    const p = join(repoRoot, rel);
    if (!existsSync(p)) throw new Error(`missing ${rel}: the app ships real data only`);
    return readFileSync(p, "utf8");
  };
  const out = [];
  for (const f of readdirSync(join(repoRoot, "shared/src")).filter((n) => n.endsWith(".ts")).sort()) {
    out.push({ path: `src/vendor/shared/src/${f}`, content: read(`shared/src/${f}`) });
  }
  for (const f of SHARED_DATA) out.push({ path: `src/vendor/shared/${f}`, content: read(`shared/${f}`) });
  out.push({ path: "src/vendor/integrate/keeper-read.ts", content: read("docs/integrate/keeper-read.ts") });

  for (const [from, to] of EVIDENCE_COPIES) out.push({ path: to, content: read(from) });

  const liveCheckFile = latestLiveCheck(repoRoot);
  out.push({ path: "src/generated/live-check.json", content: json({ file: liveCheckFile, data: JSON.parse(read(liveCheckFile)) }) });

  out.push({
    path: "src/generated/lab-framing.json",
    content: json(
      LAB_FRAMING.map(({ title, file }) => {
        const framing = JSON.parse(read(file)).framing;
        if (typeof framing !== "string") throw new Error(`${file}: no framing string`);
        return { title, file, framing };
      }),
    ),
  });

  const integrateMd = read("docs/integrate/README.md");
  out.push({
    path: "src/generated/integrate.json",
    content: json({
      ladder: firstTable(integrateMd.split("\n")),
      keeperDiff: fenceAfter(integrateMd, "The keeper diff", "ts"),
      keeperRead: read("docs/integrate/keeper-read.ts"),
      batchCalls: firstTable(sectionLines(integrateMd, "## Level 2")),
      batchFork: JSON.parse(read("docs/integrate/level2-batch.fork.json")),
      batchTestnet: JSON.parse(read("docs/integrate/level2-batch.testnet.json")),
    }),
  });

  const securityMd = read("docs/security.md");
  const failure = sectionLines(securityMd, "## 7.");
  out.push({
    path: "src/generated/security.json",
    content: json({ intro: failure.find((l) => l.trim().length > 0 && !l.startsWith("|")), failureModes: firstTable(failure) }),
  });

  out.push({
    path: "src/generated/notices.ts",
    content: `// Generated by scripts/sync-data.mjs from THIRD_PARTY_NOTICES.md. Do not edit.\nexport const NOTICES_MD = ${JSON.stringify(readFileSync(join(appRoot, "THIRD_PARTY_NOTICES.md"), "utf8"))};\n`,
  });

  const outages = join(repoRoot, "bots/out/outages.json");
  if (existsSync(outages)) {
    out.push({ path: "src/generated/outages.json", content: json(outageSnapshot(JSON.parse(readFileSync(outages, "utf8")))), optional: true });
  }
  return out;
}

export function syncData({ repoRoot, appRoot, check = false }) {
  const outputs = buildOutputs({ repoRoot, appRoot });
  const stale = [];
  for (const { path, content, optional } of outputs) {
    if (check && optional) continue;
    const dest = join(appRoot, path);
    const current = existsSync(dest) ? readFileSync(dest, "utf8") : null;
    if (current === content) continue;
    stale.push(path);
    if (!check) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
  }
  return { outputs: outputs.map((o) => o.path), stale };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  // The repo root is the parent of app/; CLIM_ROOT overrides it.
  const repoRoot = process.env.CLIM_ROOT ? resolve(process.env.CLIM_ROOT) : dirname(appRoot);
  const check = process.argv.includes("--check");
  const { outputs, stale } = syncData({ repoRoot, appRoot, check });
  if (check && stale.length > 0) {
    console.error(`out of date (run npm run sync): ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(`${outputs.length} files ${check ? "checked" : "synced"}, ${stale.length} ${check ? "stale" : "written"}`);
}
