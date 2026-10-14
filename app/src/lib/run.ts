// The recorded fork run of 2026-10-07 (docs/evidence/fork-run-2026-10-07.json): clim's desk reports replayed on a fork
// of Robinhood Chain mainnet against Fables' real ETH/USDG hook, with Fables' own keeper fee over the same window
// (lab/out/fables-storm-2026-10-07.json, rebuilt from its mainnet logs) next to it.
import { sigmaE9ToAnnual } from "@clim/shared";
import type { Point } from "@/components/charts/scale";
import { valueAt } from "@/components/charts/scale";

export type ForkRun = {
  forkBlock: number;
  hook: string;
  poolId: string;
  etaE4: number;
  sigmaEstimator: string;
  note: string;
  t: number[];
  pokedPips: number[];
  currentFee0For1Pips: number[];
  currentFee1For0Pips: number[];
  swapT: number[];
  swapFeePips: number[];
  swapZeroForOne: boolean[];
  swapReverts: number;
};
export type ForkReports = { window: { start: number; end: number }; tObs: number[]; sigma5E9: number[]; sigma15E9: number[]; devPips: number[] };
export type Storm = { window: { start: number; end: number }; steps: Array<{ t: number; feePips: number }>; pokes: Array<{ t: number; feePips: number; tx: string }> };

export type Swap = { t: number; feePips: number; zeroForOne: boolean };
export type Run = {
  from: number;
  to: number;
  clim: Point[];
  current: Point[];
  keeper: Point[];
  sigma5: Point[];
  dev: Point[];
  swaps: Swap[];
  summary: { pokes: number; minPokedPips: number; maxPokedPips: number; swaps: number; swapReverts: number; forkBlock: number; keeperPokes: number };
};

export function buildRun(run: ForkRun, reports: ForkReports, storm: Storm): Run {
  if (run.t.length !== run.pokedPips.length || run.swapT.length !== run.swapFeePips.length) throw new Error("fork run arrays differ in length");
  if (storm.window.start !== reports.window.start || storm.window.end !== reports.window.end) throw new Error("the keeper's window and the run's differ");
  return {
    from: reports.window.start,
    to: reports.window.end,
    clim: run.t.map((t, i) => ({ t, v: run.pokedPips[i] as number })),
    current: run.t.map((t, i) => ({ t, v: run.currentFee0For1Pips[i] as number })),
    keeper: storm.steps.map((s) => ({ t: s.t, v: s.feePips })),
    sigma5: reports.tObs.map((t, i) => ({ t, v: sigmaE9ToAnnual(reports.sigma5E9[i] as number) })),
    dev: reports.tObs.map((t, i) => ({ t, v: reports.devPips[i] as number })),
    swaps: run.swapT.map((t, i) => ({ t, feePips: run.swapFeePips[i] as number, zeroForOne: run.swapZeroForOne[i] as boolean })),
    summary: {
      pokes: run.pokedPips.length,
      minPokedPips: Math.min(...run.pokedPips),
      maxPokedPips: Math.max(...run.pokedPips),
      swaps: run.swapT.length,
      swapReverts: run.swapReverts,
      forkBlock: run.forkBlock,
      keeperPokes: storm.pokes.length,
    },
  };
}

/** Each series cut at `t`, for the replay's moving cursor. */
export function upTo(points: readonly Point[], t: number): Point[] {
  return points.filter((p) => p.t <= t);
}

export function atCursor(run: Run, t: number) {
  return {
    clim: valueAt(run.clim, t),
    keeper: valueAt(run.keeper, t),
    sigma5: valueAt(run.sigma5, t),
    dev: valueAt(run.dev, t),
    swaps: run.swaps.filter((s) => s.t <= t).length,
  };
}
