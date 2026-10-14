import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkedRanges, lastLine, lastTs } from "../../src/live/lib/tail";

describe("log tail", () => {
  test("last non-empty line, read from the end", () => {
    const dir = mkdtempSync(join(tmpdir(), "clim-tail-"));
    const f = join(dir, "x.jsonl");
    writeFileSync(f, `${"x".repeat(100_000)}\n{"ts":"2026-10-14T00:00:00Z"}\n{"ts":"2026-10-14T00:00:30Z","a":1}\n\n`);
    expect(lastLine(f, 1_000)).toBe('{"ts":"2026-10-14T00:00:30Z","a":1}');
    expect(lastTs(f)).toBe("2026-10-14T00:00:30Z");
    expect(lastLine(join(dir, "missing.jsonl"))).toBeNull();
  });
});

describe("block ranges for getLogs", () => {
  test("inclusive chunks covering [from, to]", () => {
    expect(chunkedRanges(100n, 104n, 2n)).toEqual([
      [100n, 101n],
      [102n, 103n],
      [104n, 104n],
    ]);
    expect(chunkedRanges(5n, 4n, 2n)).toEqual([]);
  });
});
