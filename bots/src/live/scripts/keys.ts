// Creates the testnet keys plan 03 needs, once, and never prints a secret.
//   bots/.env: DEPLOYER_PRIVATE_KEY (copied from contracts/.env PRIVATE_KEY), RUNNER_, KEEPER_, ARB_RH_ and
//              NOISE_RH_PRIVATE_KEY (new);
//   cre/.env:  CRE_ETH_PRIVATE_KEY (new; 64 hex without 0x, the CRE CLI's format): the testnet desk's simOperator.
// Existing values are kept. Prints addresses only; --exports prints `export NAME=0x...` lines for deploy-live.sh.
// Usage (from bots/): bun run live:keys [--exports]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hasFlag } from "../../lib/env";
import { parseEnvText, setMissing } from "../lib/envfile";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const BOTS_ENV = join(ROOT, "bots", ".env");
const CRE_ENV = join(ROOT, "cre", ".env");
const CONTRACTS_ENV = join(ROOT, "contracts", ".env");
const read = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");
const hex = (k: string): Hex => (k.startsWith("0x") ? k : `0x${k}`) as Hex;
const addressOf = (k: string | undefined, name: string): Address => {
  if (!k) throw new Error(`${name} is not set`);
  return privateKeyToAccount(hex(k)).address;
};

const deployer = parseEnvText(read(CONTRACTS_ENV)).get("PRIVATE_KEY");
if (!deployer) throw new Error("contracts/.env has no PRIVATE_KEY");

const bots = setMissing(read(BOTS_ENV), [
  ["DEPLOYER_PRIVATE_KEY", hex(deployer)],
  ["RUNNER_PRIVATE_KEY", generatePrivateKey()],
  ["KEEPER_PRIVATE_KEY", generatePrivateKey()],
  ["ARB_RH_PRIVATE_KEY", generatePrivateKey()],
  ["NOISE_RH_PRIVATE_KEY", generatePrivateKey()],
]);
writeFileSync(BOTS_ENV, bots.text, { mode: 0o600 });
const cre = setMissing(read(CRE_ENV), [["CRE_ETH_PRIVATE_KEY", generatePrivateKey().slice(2)]]);
writeFileSync(CRE_ENV, cre.text, { mode: 0o600 });

const b = parseEnvText(bots.text);
const addresses: Record<string, Address> = {
  DEPLOYER_ADDRESS: addressOf(b.get("DEPLOYER_PRIVATE_KEY"), "DEPLOYER_PRIVATE_KEY"),
  SIM_OPERATOR: addressOf(parseEnvText(cre.text).get("CRE_ETH_PRIVATE_KEY"), "CRE_ETH_PRIVATE_KEY"),
  RUNNER_ADDRESS: addressOf(b.get("RUNNER_PRIVATE_KEY"), "RUNNER_PRIVATE_KEY"),
  KEEPER_ADDRESS: addressOf(b.get("KEEPER_PRIVATE_KEY"), "KEEPER_PRIVATE_KEY"),
  ARB_ADDRESS: addressOf(b.get("ARB_RH_PRIVATE_KEY"), "ARB_RH_PRIVATE_KEY"),
  NOISE_ADDRESS: addressOf(b.get("NOISE_RH_PRIVATE_KEY"), "NOISE_RH_PRIVATE_KEY"),
};
if (hasFlag("--exports")) {
  for (const [k, v] of Object.entries(addresses)) console.log(`export ${k}=${v}`);
} else {
  const added = [...bots.added.map((k) => `bots/.env ${k}`), ...cre.added.map((k) => `cre/.env ${k}`)];
  console.log(added.length > 0 ? `created: ${added.join(", ")}` : "no new key (all present)");
  for (const [k, v] of Object.entries(addresses)) console.log(`${k.padEnd(16)} ${v}`);
}
