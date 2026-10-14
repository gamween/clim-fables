import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOutputs, fenceAfter, firstTable, outageSnapshot, sectionLines, syncData } from "./sync-data.mjs";

const MD = ["# T", "", "## 7. Failure modes", "", "\"Flat\" is the flat fee.", "", "| A | B |", "|---|---|", "| `x` | [l](u) |", "", "## 8. Next", "| C |", "|---|"].join("\n");

describe("markdown extraction", () => {
  it("cuts a section at the next heading of the same level", () => {
    const lines = sectionLines(MD, "## 7.");
    expect(lines).toContain("| `x` | [l](u) |");
    expect(lines.join("\n")).not.toContain("## 8.");
  });
  it("reads the first table with inline markdown kept", () => {
    expect(firstTable(sectionLines(MD, "## 7."))).toEqual({ header: ["A", "B"], rows: [["`x`", "[l](u)"]] });
  });
  it("finds the fenced block after a line", () => {
    const md = "intro\nThe keeper diff, here:\n\n```ts\nconst a = 1;\n```\n";
    expect(fenceAfter(md, "The keeper diff", "ts")).toBe("const a = 1;\n");
  });
  it("throws on a missing heading", () => {
    expect(() => sectionLines(MD, "## 9.")).toThrow("heading not found");
  });
});

describe("outage snapshot", () => {
  it("keeps the windows and their reason, drops the local records", () => {
    const raw = {
      generatedAt: "g", chainId: 46630, riskDesk: "0xd", gapSec: 90, deployBlock: 1, scannedToBlock: 9, chainTimeSec: 100, reportCount: 3,
      lastReport: { seq: 3, tObs: 90 },
      windows: [{ from: 10, to: 200, durationSec: 190, seqBefore: 1, seqAfter: 2, ongoing: false, reason: "restart", local: [{ ts: "x" }] }],
    };
    const s = outageSnapshot(raw);
    expect(s.windows[0]).toEqual({ from: 10, to: 200, durationSec: 190, seqBefore: 1, seqAfter: 2, ongoing: false, reason: "restart" });
    expect(JSON.stringify(s)).not.toContain("local");
  });
});

type Output = { path: string; content: string };
const contentOf = (outs: Output[], path: string): string => {
  const o = outs.find((x) => x.path === path);
  if (!o) throw new Error(`no output ${path}`);
  return o.content;
};

describe("against the repository", () => {
  const appRoot = dirname(dirname(new URL(import.meta.url).pathname));
  const repoRoot = process.env.CLIM_ROOT ?? dirname(appRoot);

  it("builds every output from the real sources", () => {
    const paths = buildOutputs({ repoRoot, appRoot }).map((o: { path: string }) => o.path);
    expect(paths).toEqual(expect.arrayContaining([
      "src/vendor/shared/src/live.ts",
      "src/vendor/shared/deployments/robinhood-testnet.json",
      "src/vendor/integrate/keeper-read.ts",
      "src/generated/fork-run-2026-10-07.json",
      "src/generated/lab-framing.json",
      "src/generated/integrate.json",
      "src/generated/security.json",
      "src/generated/live-check.json",
      "src/generated/notices.ts",
    ]));
  });

  it("quotes the lab framing strings verbatim", () => {
    const framing = JSON.parse(contentOf(buildOutputs({ repoRoot, appRoot }), "src/generated/lab-framing.json"));
    for (const f of framing) expect(JSON.parse(readFileSync(join(repoRoot, f.file), "utf8")).framing).toBe(f.framing);
    expect(framing.map((f: { title: string }) => f.title)).toEqual(["Effective arbitrage interval", "Volatility window", "Volatility estimator", "Per-direction signal"]);
  });

  it("extracts the ladder, the keeper diff and the failure modes", () => {
    const outs = buildOutputs({ repoRoot, appRoot });
    const integrate = JSON.parse(contentOf(outs, "src/generated/integrate.json"));
    expect(integrate.ladder.header[0]).toBe("Level");
    expect(integrate.ladder.rows).toHaveLength(3);
    expect(integrate.keeperDiff).toContain("composeFee(myFeePips, clim)");
    expect(integrate.keeperRead).toBe(readFileSync(join(repoRoot, "docs/integrate/keeper-read.ts"), "utf8"));
    expect(integrate.batchCalls.rows).toHaveLength(6);
    const security = JSON.parse(contentOf(outs, "src/generated/security.json"));
    expect(security.failureModes.header).toEqual(["Failure", "What happens", "Fee on a pool driven by `ClimPoker`", "Proof"]);
    expect(security.intro).toMatch(/^"Flat" is the hook's flat fee/);
  });

  it("writes into an empty app and then finds nothing stale", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sync-"));
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "THIRD_PARTY_NOTICES.md"), "# Notices\n");
    const first = syncData({ repoRoot, appRoot: tmp });
    expect(first.stale.length).toBe(first.outputs.length);
    expect(syncData({ repoRoot, appRoot: tmp, check: true }).stale).toEqual([]);
    writeFileSync(join(tmp, "src/generated/lab-framing.json"), "[]\n");
    expect(syncData({ repoRoot, appRoot: tmp, check: true }).stale).toEqual(["src/generated/lab-framing.json"]);
  });
});
