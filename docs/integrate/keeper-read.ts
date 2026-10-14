// Level 1 of the clim x Fables integration: your off-chain keeper reads clim's fee and composes it with its own.
// Self-contained (viem only): copy this file into the keeper. Every call is an eth_call; nothing is ever sent.
// Live read of the testnet desk: bun docs/integrate/keeper-read.ts
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { robinhoodTestnet } from "viem/chains";

/** clim on Robinhood Chain testnet (chain 46630), from shared/deployments/robinhood-testnet.json. */
export const CLIM_TESTNET = {
  policy: "0x5f140A5e17826CFcEeeD7cD3FcAe4D56c9e0C519",
  riskDesk: "0x63f543430982685387C83e4ec55E5a26fd1371Ef",
} as const satisfies Record<string, Address>;

/** The four ClimFeePolicy views this file reads (a subset of shared/abis/ClimFeePolicy.json, checked by a test). */
export const climFeePolicyReadAbi = [
  { type: "function", name: "quote", stateMutability: "view", inputs: [], outputs: [{ name: "fee", type: "uint24" }, { name: "mode", type: "uint8" }] },
  {
    type: "function",
    name: "quoteDirectional",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "fee0For1", type: "uint24" }, { name: "fee1For0", type: "uint24" }, { name: "mode", type: "uint8" }],
  },
  { type: "function", name: "lastObservation", stateMutability: "view", inputs: [], outputs: [{ name: "tObs", type: "uint40" }, { name: "seq", type: "uint32" }] },
  { type: "function", name: "tauKillSec", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint32" }] },
] as const;

/** normal: fresh desk; degraded: venues disagree (the fee is at least the policy's safe fee); blind: no report for more
 *  than tauKillSec (ClimPoker refuses to poke, and a keeper should ignore clim). */
export type ClimMode = "normal" | "degraded" | "blind";
const MODES: Readonly<Record<number, ClimMode>> = { 0: "normal", 1: "degraded", 2: "blind" };

export type ClimQuote = {
  /** quote(): one fee for both directions, in pips (1 pip = 0.0001 %, 100 pips = 1 bp). */
  fee: number;
  /** quoteDirectional(): zero-for-one pays currency0 for currency1. */
  fee0For1: number;
  fee1For0: number;
  mode: ClimMode;
  /** The desk's last observation (unix seconds) and report counter. */
  tObs: number;
  seq: number;
  /** blockTimestamp - tObs; negative by up to 30 s when a report carries a future tObs (the desk's skew limit). */
  ageSec: number;
  tauKillSec: number;
  /** Every value above was read at this block. */
  blockNumber: bigint;
  blockTimestamp: number;
};

export type ReadOptions = {
  policy?: Address;
  /** Read this many blocks behind the head, so a load-balanced RPC whose nodes lag a little still serves the block. */
  lagBlocks?: bigint;
};

/** Reads clim's quote, both directions, the observation and the kill delay, all at one block. */
export async function readClimQuote(client: PublicClient, o: ReadOptions = {}): Promise<ClimQuote> {
  const address = o.policy ?? CLIM_TESTNET.policy;
  const lag = o.lagBlocks ?? 3n;
  const head = await client.getBlockNumber();
  const blockNumber = head > lag ? head - lag : head;
  const read = { address, abi: climFeePolicyReadAbi, blockNumber } as const;
  const [block, [fee, mode], [fee0For1, fee1For0], [tObs, seq], tauKillSec] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.readContract({ ...read, functionName: "quote" }),
    client.readContract({ ...read, functionName: "quoteDirectional" }),
    client.readContract({ ...read, functionName: "lastObservation" }),
    client.readContract({ ...read, functionName: "tauKillSec" }),
  ]);
  const named = MODES[mode];
  if (named === undefined) throw new Error(`unknown ClimFeePolicy mode ${mode}`);
  const blockTimestamp = Number(block.timestamp);
  return { fee, fee0For1, fee1For0, mode: named, tObs, seq, ageSec: blockTimestamp - tObs, tauKillSec, blockNumber, blockTimestamp };
}

/** clim counts while its desk is not blind and its observation is at most maxAgeSec old (default: the policy's
 *  tauKillSec, the same rule ClimPoker applies on-chain). */
export function climUsable(clim: ClimQuote, maxAgeSec: number = clim.tauKillSec): boolean {
  return clim.mode !== "blind" && clim.ageSec <= maxAgeSec;
}

export type Composed = { fee: number; source: "keeper" | "clim"; climUsed: boolean };

/** A one-fee hook (ETH/USDG today): max(your fee, clim's quote()) while clim is usable, your fee alone otherwise.
 *  Your event overrides stay on top: clim can raise the fee, never lower yours. */
export function composeFee(keeperFeePips: number, clim: ClimQuote, maxAgeSec?: number): Composed {
  if (!climUsable(clim, maxAgeSec)) return { fee: keeperFeePips, source: "keeper", climUsed: false };
  return clim.fee > keeperFeePips ? { fee: clim.fee, source: "clim", climUsed: true } : { fee: keeperFeePips, source: "keeper", climUsed: true };
}

export type ComposedDirectional = { fee0For1: Composed; fee1For0: Composed };

/** A per-direction hook: the same rule on each side, with quoteDirectional()'s per-side fees. */
export function composeDirectional(keeper0For1: number, keeper1For0: number, clim: ClimQuote, maxAgeSec?: number): ComposedDirectional {
  return {
    fee0For1: composeFee(keeper0For1, { ...clim, fee: clim.fee0For1 }, maxAgeSec),
    fee1For0: composeFee(keeper1For0, { ...clim, fee: clim.fee1For0 }, maxAgeSec),
  };
}

if (import.meta.main) {
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http(process.env.RH_TESTNET_RPC_URL) });
  const q = await readClimQuote(client);
  console.log(JSON.stringify({ ...q, blockNumber: q.blockNumber.toString() }, null, 2));
  console.log("composed with a 700-pip keeper fee:", JSON.stringify(composeFee(700, q)));
}
