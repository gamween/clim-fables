// Environment of the live bots (Robinhood Chain testnet, plan 03). Bun loads bots/.env when commands run from bots/.
import type { Hex } from "viem";
import { envStr, privateKeyFromEnv } from "../../lib/env";

type Env = Record<string, string | undefined>;

export const DEFAULT_RH_TESTNET_RPC_URL = "https://rpc.testnet.chain.robinhood.com";

/** One key per role so concurrent processes never share a nonce (`bun run live:keys` creates them). */
export const LIVE_KEYS = {
  deployer: "DEPLOYER_PRIVATE_KEY",
  runner: "RUNNER_PRIVATE_KEY",
  keeper: "KEEPER_PRIVATE_KEY",
  arb: "ARB_RH_PRIVATE_KEY",
  noise: "NOISE_RH_PRIVATE_KEY",
} as const;
export type LiveRole = keyof typeof LIVE_KEYS;

export function liveRpcUrl(env: Env = process.env): string {
  return envStr("RH_TESTNET_RPC_URL", DEFAULT_RH_TESTNET_RPC_URL, env);
}

export function liveKey(role: LiveRole, env: Env = process.env): Hex {
  return privateKeyFromEnv(LIVE_KEYS[role], env);
}
