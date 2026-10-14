// The server's read-only clients for the history cache (app/api/history/[series]): the same public endpoints as the
// browser, with a longer back-off. Mainnet's public RPC answers HTTP 429 after about 175 header reads in a burst
// ("limit will reset in 60 seconds", measured 2026-10-14), and a cold 24-hour read of the keeper's overrides needs
// about 215 calls, so a read waits out the limit (2 + 4 + 8 + 16 + 32 s) instead of failing.
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { RPC_URLS } from "@/lib/rpc";

const transport = (urls: readonly string[]) => fallback(urls.map((u) => http(u, { batch: { batchSize: 50, wait: 16 }, retryCount: 5, retryDelay: 2_000, timeout: 20_000 })));

let mainnet: PublicClient | undefined;
let testnet: PublicClient | undefined;

export function serverClient(chain: "mainnet" | "testnet"): PublicClient {
  if (chain === "mainnet") return (mainnet ??= createPublicClient({ chain: robinhood, transport: transport(RPC_URLS.mainnet) }) as PublicClient);
  return (testnet ??= createPublicClient({ chain: robinhoodTestnet, transport: transport(RPC_URLS.testnet) }) as PublicClient);
}
