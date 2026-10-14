// Writes the "Gas and cost" section of docs/integrate/README.md from docs/evidence/gas-robinhood-testnet.json, or with
// --check exits 1 when the section differs from what the evidence file gives (CI runs the check). Reads local files
// only. Usage: bun src/live/scripts/cost-doc.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasFlag } from "../../lib/env";
import { REPO_ROOT } from "../lib/deployments";
import { renderCostSection, replaceBetween, type GasEvidence } from "../lib/costdoc";

const evidence = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "evidence", "gas-robinhood-testnet.json"), "utf8")) as GasEvidence;
const docPath = join(REPO_ROOT, "docs", "integrate", "README.md");
const doc = readFileSync(docPath, "utf8");
const next = replaceBetween(doc, renderCostSection(evidence));
if (hasFlag("--check")) {
  if (next !== doc) {
    console.error("docs/integrate/README.md: the cost section differs from docs/evidence/gas-robinhood-testnet.json; run `cd bots && bun run live:cost-doc`");
    process.exit(1);
  }
  console.log("docs/integrate/README.md: cost section matches docs/evidence/gas-robinhood-testnet.json");
} else {
  writeFileSync(docPath, next);
  console.log(next === doc ? "docs/integrate/README.md: cost section already up to date" : "docs/integrate/README.md: cost section rewritten from the evidence file");
}
