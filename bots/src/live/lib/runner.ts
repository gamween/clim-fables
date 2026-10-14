import { climPokerAbi, FeeMode } from "@clim/shared";
import type { Address } from "viem";
import { shortError } from "../../lib/jsonl";
import { withRetry, type RetryOptions } from "./retry";
import { isDeskBlindError } from "./supervise";
import { chunkedRanges } from "./tail";

export type PokeDecision = "wait" | "poke" | "blind";

/** Poke once per new desk report; never on a blind desk (ClimPoker reverts DeskBlind and the pool keeps its last
 *  override until it expires, then its flat fee). A degraded desk still pokes: the policy quotes at least the safe fee. */
export function pokeDecision(seq: number, lastPokedSeq: number, mode: number): PokeDecision {
  if (seq === 0 || seq <= lastPokedSeq) return "wait";
  return mode === FeeMode.Blind ? "blind" : "poke";
}

export const POKE_LAG_RETRIES = 3;
export const POKE_LAG_DELAY_MS = 2_000;

/** The poke() simulation, after a read that found a fresh report. A DeskBlind revert then usually means the simulation
 *  ran on a node of the load-balanced public RPC still at the previous seq: wait 2 s and simulate again, up to 3 times,
 *  before the DeskBlind error is returned to the runner (which logs a skip). Any other error is thrown at once. */
export function simulatePoke<T>(simulate: () => Promise<T>, o: Pick<RetryOptions, "onRetry" | "sleep"> = {}): Promise<T> {
  return withRetry(simulate, { ...o, retries: POKE_LAG_RETRIES, delayMs: POKE_LAG_DELAY_MS, shouldRetry: (e) => isDeskBlindError(shortError(e)) });
}

/** How far back a restarted runner looks for its last poke: ten minutes at about 10 blocks a second. A report is poked
 *  only while the desk is fresh (tauKill 180 s after its tObs), so a poke of the current seq is always this recent. */
export const POKED_LOOKBACK_BLOCKS = 6_000n;

/** The highest seq among ClimPoker's Poked events (0 for none). */
export function lastPokedSeqFrom(logs: ReadonlyArray<{ args: { seq?: number } }>): number {
  return logs.reduce((m, l) => Math.max(m, l.args.seq ?? 0), 0);
}

type PokedLogsClient = {
  getBlockNumber(): Promise<bigint>;
  getLogs(a: { address: Address; event: (typeof climPokerAbi)[1]; fromBlock: bigint; toBlock: bigint }): Promise<ReadonlyArray<{ args: { seq?: number } }>>;
};

/** The last seq poked through `poker`, read from its Poked events (indexed seq) over the last POKED_LOOKBACK_BLOCKS
 *  blocks: a restarted runner keeps no memory, and without this it pokes the current report a second time. */
export async function readLastPokedSeq(client: PokedLogsClient, poker: Address): Promise<number> {
  const head = await client.getBlockNumber();
  const from = head >= POKED_LOOKBACK_BLOCKS ? head - POKED_LOOKBACK_BLOCKS + 1n : 0n;
  let last = 0;
  for (const [fromBlock, toBlock] of chunkedRanges(from, head)) {
    last = Math.max(last, lastPokedSeqFrom(await client.getLogs({ address: poker, event: climPokerAbi[1], fromBlock, toBlock })));
  }
  return last;
}

/** Headroom on a poke's gas estimate. The estimate is made against the policy's quote at that moment; if the next
 *  report changes the quote before the poke is mined, writing the new fees costs more gas than rewriting the same ones. */
export const POKE_GAS_MARGIN_PCT = 20;

/** `estimate` plus `pct` %, rounded up. */
export function withGasMargin(estimate: bigint, pct: number = POKE_GAS_MARGIN_PCT): bigint {
  return (estimate * BigInt(100 + pct) + 99n) / 100n;
}
