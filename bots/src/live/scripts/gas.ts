// Gas per transaction type on Robinhood Chain testnet, from the receipts of the live logs: desk report (through the
// MockKeystoneForwarder), ClimPoker.poke(), keeper poke, arbitrage swap, retail swap. Reads each raw receipt
// (gasUsed, gasUsedForL1, effectiveGasPrice) and writes docs/evidence/gas-robinhood-testnet.json for the CTO
// checklist (spec §5.8). Usage: bun src/live/scripts/gas.ts [--last 200]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { argValue } from "../../lib/env";
import { OUT_DIR } from "../../lib/jsonl";
import { liveClient } from "../lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "../lib/deployments";
import { hashesFromJsonl, summarizeGas, type GasRow } from "../lib/gas";

const last = Number(argValue("--last") ?? "200");
const d = loadLiveDeployments();
const client = liveClient();
const CATEGORIES: Array<[string, string, (o: Record<string, unknown>) => boolean]> = [
  ["deskReport", "desk-runs.jsonl", (o) => o.status === "applied"],
  ["poke", "runner-rh.jsonl", (o) => o.action === "poke" && o.status === "success"],
  ["keeperPoke", "keeper-rh.jsonl", (o) => o.status === "success"],
  ["arbSwap", "arb-rh.jsonl", (o) => o.action === "buyEth" || o.action === "sellEth"],
  ["retailSwap", "noise-rh.jsonl", (o) => o.error === undefined],
];

async function receipt(hash: Hex): Promise<GasRow | null> {
  const r = (await client.request({ method: "eth_getTransactionReceipt", params: [hash] })) as Record<string, unknown> | null;
  if (!r || r.status !== "0x1") return null;
  const big = (x: unknown): bigint => (typeof x === "string" ? BigInt(x) : 0n);
  return { gasUsed: big(r.gasUsed), gasUsedForL1: big(r.gasUsedForL1), effectiveGasPrice: big(r.effectiveGasPrice) };
}

const out: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  chainId: d.chainId,
  note: "Robinhood Chain testnet receipts of the live stack (plan 03); gasUsed includes the L1 component (gasUsedForL1)",
};
for (const [name, file, pick] of CATEGORIES) {
  const path = join(OUT_DIR, file);
  if (!existsSync(path)) {
    out[name] = null;
    continue;
  }
  const hashes = hashesFromJsonl(readFileSync(path, "utf8"), pick, last);
  const rows = (await Promise.all(hashes.map(receipt))).filter((r): r is GasRow => r !== null);
  out[name] = rows.length > 0 ? summarizeGas(rows) : null;
  console.log(`${name}: ${rows.length} receipts`, out[name]);
}
const dir = join(REPO_ROOT, "docs", "evidence");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "gas-robinhood-testnet.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote docs/evidence/gas-robinhood-testnet.json`);
