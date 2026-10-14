import { FeeMode } from "@clim/shared";
import { shortError } from "../../lib/jsonl";
import { withRetry, type RetryOptions } from "./retry";
import { isDeskBlindError } from "./supervise";

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
