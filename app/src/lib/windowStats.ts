// The statistics of one fee window, computed the same way by the pages and by the live check (e2e/live.spec.ts), so
// the check compares like with like: the page's numbers against a fresh read of the same blocks.
import { overrideSteps, peakAndLow, pokeCount, timeWeightedAverage, type Direction, type FeeStep, type HookConfig, type PokeEvent } from "./fees";
import type { SwapRow } from "./chain/decode";

export type FeeWindow = { fromTs: number; toTs: number; steps: FeeStep[]; avg: number | null; peak: number | null; low: number | null; changes: number };

export function feeWindow(events: readonly PokeEvent[], cfg: HookConfig, toTs: number, windowSec: number, d: Direction = "0For1"): FeeWindow {
  const fromTs = toTs - windowSec;
  const steps = overrideSteps(events, cfg, fromTs, toTs);
  const pl = peakAndLow(steps, d);
  return { fromTs, toTs, steps, avg: timeWeightedAverage(steps, toTs, d), peak: pl?.peak ?? null, low: pl?.low ?? null, changes: pokeCount(events, fromTs, toTs) };
}

export type SwapWindow = { count: number; meanFeePips: number | null };

/** Swaps of a window whose blocks were chosen from timestamps (useLogHistory): every swap read is in the window. */
export function swapWindow(swaps: readonly SwapRow[]): SwapWindow {
  return { count: swaps.length, meanFeePips: swaps.length ? swaps.reduce((a, x) => a + x.feePips, 0) / swaps.length : null };
}
