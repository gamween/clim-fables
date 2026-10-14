import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyAssets, FABLES_ASSETS, KIT, missingAssets } from "./fables-assets.mjs";

function fakeKit() {
  const repo = mkdtempSync(join(tmpdir(), "kit-"));
  for (const [src] of FABLES_ASSETS) {
    const p = join(repo, KIT, src);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, src);
  }
  return repo;
}

describe("fables-assets", () => {
  it("copies every file the app references and then finds nothing missing", () => {
    const repoRoot = fakeKit();
    const appRoot = mkdtempSync(join(tmpdir(), "app-"));
    expect(missingAssets(appRoot)).toHaveLength(FABLES_ASSETS.length);
    expect(copyAssets({ repoRoot, appRoot })).toBe(FABLES_ASSETS.length);
    expect(missingAssets(appRoot)).toEqual([]);
  });
  it("includes Fables' favicon files, as fables.fi serves them", () => {
    const dests = FABLES_ASSETS.map(([, d]) => d);
    expect(dests).toContain("favicon.ico");
    expect(dests).toContain("apple-touch-icon.png");
  });
  it("refuses to run without the brand kit", () => {
    expect(() => copyAssets({ repoRoot: mkdtempSync(join(tmpdir(), "empty-")), appRoot: mkdtempSync(join(tmpdir(), "app-")) })).toThrow("missing in");
  });
});
