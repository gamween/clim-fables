import { LIVE_POOLS, liveOrientation, parseLiveDeployments, type LivePoolName } from "@clim/shared";
import raw from "@/vendor/shared/deployments/robinhood-testnet.json";

/** clim's live reference stack on Robinhood Chain testnet (shared/deployments/robinhood-testnet.json, validated). */
export const LIVE = parseLiveDeployments(raw);
export { LIVE_POOLS };
export type { LivePoolName };

export const TESTNET_EXPLORER = "https://explorer.testnet.chain.robinhood.com";
export const testnetTx = (tx: string) => `${TESTNET_EXPLORER}/tx/${tx}`;
export const testnetAddress = (a: string) => `${TESTNET_EXPLORER}/address/${a}`;
export const testnetCode = (a: string) => `${TESTNET_EXPLORER}/address/${a}?tab=contract`;
export const sourcifyTestnet = (a: string) => `https://repo.sourcify.dev/46630/${a}`;

/** Blocks on testnet are at least this far apart (about 0.11 s measured, spec §2). */
export const TESTNET_MIN_BLOCK_SEC = 0.09;

export const orientationOf = (name: LivePoolName) => liveOrientation(LIVE, LIVE.pools[name]);

/** The pool page slug of each testnet pool: /markets/d, /markets/k, /markets/f. */
export const POOL_SLUGS: Record<string, LivePoolName> = { d: "D", k: "K", f: "F" };
