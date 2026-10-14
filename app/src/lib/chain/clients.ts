import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { RPC_URLS } from "@/lib/rpc";

// Read-only clients: createPublicClient has no account and no wallet action. Requests to one endpoint are batched
// (JSON-RPC batch, at most 50 calls: 200 got HTTP 429, 100 went through); a failing endpoint falls back to the next one.
const transport = (urls: readonly string[]) => fallback(urls.map((u) => http(u, { batch: { batchSize: 50, wait: 16 }, retryCount: 2, retryDelay: 2_000, timeout: 20_000 })));

let mainnet: PublicClient | undefined;
let testnet: PublicClient | undefined;

/** Robinhood Chain mainnet (4663): Fables, read only. */
export function mainnetClient(): PublicClient {
  mainnet ??= createPublicClient({ chain: robinhood, transport: transport(RPC_URLS.mainnet) }) as PublicClient;
  return mainnet;
}

/** Robinhood Chain testnet (46630): clim's desk, policy, poker and pools D, K, F. */
export function testnetClient(): PublicClient {
  testnet ??= createPublicClient({ chain: robinhoodTestnet, transport: transport(RPC_URLS.testnet) }) as PublicClient;
  return testnet;
}
