import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { scanBundle } from "./check-bundle.mjs";

it("finds a wallet request in a built chunk and passes a clean one", () => {
  const dir = mkdtempSync(join(tmpdir(), "static-"));
  mkdirSync(join(dir, "chunks"));
  writeFileSync(join(dir, "chunks/a.js"), 'e.request({method:"eth_call"})');
  expect(scanBundle(dir)).toEqual([]);
  writeFileSync(join(dir, "chunks/b.js"), 'e.request({method:"eth_requestAccounts"})');
  expect(scanBundle(dir)).toEqual(["chunks/b.js: eth_requestAccounts"]);
});
