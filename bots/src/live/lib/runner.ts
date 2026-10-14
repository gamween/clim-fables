import { FeeMode } from "@clim/shared";

export type PokeDecision = "wait" | "poke" | "blind";

/** Poke once per new desk report; never on a blind desk (ClimPoker reverts DeskBlind and the pool keeps its last
 *  override until it expires, then its flat fee). A degraded desk still pokes: the policy quotes at least the safe fee. */
export function pokeDecision(seq: number, lastPokedSeq: number, mode: number): PokeDecision {
  if (seq === 0 || seq <= lastPokedSeq) return "wait";
  return mode === FeeMode.Blind ? "blind" : "poke";
}
