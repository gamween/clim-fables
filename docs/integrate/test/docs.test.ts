// The published documents against their sources: the lab's framing strings quoted verbatim, every deployed address
// present, every cited test real, no em dash, and no claim of better fees.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const README = read("README.md");
const DOCS: Array<[string, string]> = [
  ["README.md", README],
  ["docs/security.md", read("docs", "security.md")],
  ["docs/integrate/README.md", read("docs", "integrate", "README.md")],
];

function solidityTestNames(dir: string): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".t.sol")) continue;
    const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
    for (const m of text.matchAll(/function (test(?:Fuzz)?_\w+)\(/g)) names.add(m[1] as string);
  }
  return names;
}

describe("published documents", () => {
  test("README quotes every lab framing string verbatim", () => {
    const files = readdirSync(join(ROOT, "lab", "out")).filter((f) => /^fables-.*\.json$/.test(f));
    let quoted = 0;
    for (const f of files) {
      const framing = (JSON.parse(read("lab", "out", f)) as { framing?: unknown }).framing;
      if (typeof framing !== "string") continue;
      expect(README).toContain(framing);
      quoted++;
    }
    expect(quoted).toBeGreaterThanOrEqual(4);
  });

  test("README lists every contract deployed on Robinhood Chain testnet", () => {
    const d = JSON.parse(read("shared", "deployments", "robinhood-testnet.json")) as { verify: Record<string, { address: string }> };
    for (const { address } of Object.values(d.verify)) expect(README).toContain(address);
  });

  test("every test the documents cite exists in contracts/test", () => {
    const names = solidityTestNames(join(ROOT, "contracts", "test"));
    for (const [file, text] of DOCS) {
      for (const m of text.matchAll(/`(test(?:Fuzz)?_\w+)`/g)) {
        if (!names.has(m[1] as string)) throw new Error(`${file} cites ${m[1]}, which no contracts/test file defines`);
      }
    }
  });

  test("no em dash", () => {
    for (const [file, text] of DOCS) expect({ file, emDash: text.includes("\u2014") }).toEqual({ file, emDash: false });
  });

  test("better fees are only ever disclaimed", () => {
    for (const [file, text] of DOCS) {
      for (const m of text.matchAll(/better fees?/gi)) {
        const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index).toLowerCase();
        expect({ file, disclaimed: /\b(not|no|nothing|never)\b/.test(before) }).toEqual({ file, disclaimed: true });
      }
    }
  });
});
