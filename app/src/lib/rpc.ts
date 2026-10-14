// Public RPC endpoints the browser reads. No key: these are the chains' public endpoints. An optional override (for
// a private endpoint during development) comes first; it is a NEXT_PUBLIC_ variable, so never put a key in it.
// Observed limits (2026-10-14): eth_getLogs spans at most 10,000,000 blocks on both chains; rpc.ordofi.network
// answers eth_call but refused eth_getLogs with -32005 "the network is busy". No published rate limit.
export const RPC_URLS = {
  mainnet: [process.env.NEXT_PUBLIC_RH_MAINNET_RPC_URL, "https://rpc.mainnet.chain.robinhood.com", "https://rpc.ordofi.network"].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  ),
  testnet: [process.env.NEXT_PUBLIC_RH_TESTNET_RPC_URL, "https://rpc.testnet.chain.robinhood.com"].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  ),
} as const;

/** eth_getLogs block span the public RPCs accept is 10,000,000; the app asks for half. */
export const LOG_CHUNK_BLOCKS = 5_000_000n;
