// After `next build`: the browser bundle carries no wallet provider, connector or signing request. viem's public
// client keeps its sendRawTransaction action in the bundle (it ships with publicActions, and the app never calls it:
// src/guardrails.test.tsx scans the sources, e2e/guardrails.spec.ts records every RPC method the pages send), so that
// one string is not in this list, nor is "WalletConnect", which is in the name of one of viem's RPC error classes
// (WalletConnectSessionSettlementError); the lowercase package and relay name "walletconnect" is.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_IN_BUNDLE = [
  "eth_requestAccounts",
  "eth_accounts",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData",
  "wallet_requestPermissions",
  "wallet_switchEthereumChain",
  "walletconnect",
  "rainbowkit",
  "metamask",
  "MetaMask",
  "window.ethereum",
  "coinbaseWallet",
];

function jsFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? jsFiles(p) : n.endsWith(".js") ? [p] : [];
  });
}

export function scanBundle(staticDir) {
  const hits = [];
  for (const f of jsFiles(staticDir)) {
    const text = readFileSync(f, "utf8");
    for (const s of FORBIDDEN_IN_BUNDLE) if (text.includes(s)) hits.push(`${f.slice(staticDir.length + 1)}: ${s}`);
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const staticDir = join(dirname(dirname(fileURLToPath(import.meta.url))), ".next/static");
  const hits = scanBundle(staticDir);
  if (hits.length > 0) {
    console.error(`wallet code in the bundle:\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log(`bundle clean: ${jsFiles(staticDir).length} files, no wallet provider, connector or signing request`);
}
