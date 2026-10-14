// The fee a Fables-style override hook charges, rebuilt from its FeePoked logs, and the statistics Fables' "Dynamic Fee"
// panel shows. The rule is the one the lab verified against every swap of Fables' ETH/USDG pool
// (lab/out/fables-compare.json, "rule"; it matched 1,820 of 1,820 swaps) and the one clim's PokeFeeHook implements
// (contracts/src/v2/PokeFeeHook.sol, currentFee): with no live override the pool charges its flat fee; while an
// override is live (expiry > block time) it charges max(override, floor, flat x 50 %), capped.

export type HookConfig = { floorPips: number; flatPips: number; capPips: number };

/** One FeePoked log (a single-fee hook sets both directions to the same fee) or a PokeCleared log. */
export type PokeEvent =
  | { kind: "poke"; t: number; block: bigint; logIndex: number; tx: `0x${string}`; fee0For1: number; fee1For0: number; expiry: number }
  | { kind: "clear"; t: number; block: bigint; logIndex: number; tx: `0x${string}` };

/** The fee from `t` until the next step. `tx` is the poke that set it (absent for the flat fee). */
export type FeeStep = { t: number; fee0For1: number; fee1For0: number; overridden: boolean; tx?: `0x${string}` };

export type Direction = "0For1" | "1For0";

/** Fables' and PokeFeeHook's MAX_POKE_DISCOUNT_BPS: an override never goes below half the flat fee. */
export const MAX_POKE_DISCOUNT_BPS = 5_000;

export function effectiveFee(cfg: HookConfig, poked: number | null): number {
  if (poked === null) return Math.min(cfg.flatPips, cfg.capPips);
  const pokeFloor = Math.max(cfg.floorPips, Math.floor((cfg.flatPips * (10_000 - MAX_POKE_DISCOUNT_BPS)) / 10_000));
  return Math.min(Math.max(poked, pokeFloor), cfg.capPips);
}

const byChainOrder = (a: PokeEvent, b: PokeEvent) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1);

/** The step series of the fee over [from, to]: one step at `from`, then one at each poke, clear or expiry that changes
 *  the fee. Events before `from` set the state at `from` (pass the last override that may still be live). */
export function overrideSteps(events: readonly PokeEvent[], cfg: HookConfig, from: number, to: number): FeeStep[] {
  const sorted = [...events].sort(byChainOrder);
  type Live = { fee0For1: number; fee1For0: number; expiry: number; tx: `0x${string}` };
  let live: Live | null = null;
  const steps: FeeStep[] = [];
  const push = (t: number, l: Live | null) => {
    const step: FeeStep = l
      ? { t, fee0For1: effectiveFee(cfg, l.fee0For1), fee1For0: effectiveFee(cfg, l.fee1For0), overridden: true, tx: l.tx }
      : { t, fee0For1: effectiveFee(cfg, null), fee1For0: effectiveFee(cfg, null), overridden: false };
    const last = steps[steps.length - 1];
    if (last && last.t === t) steps[steps.length - 1] = step;
    else if (!last || last.fee0For1 !== step.fee0For1 || last.fee1For0 !== step.fee1For0 || last.overridden !== step.overridden) steps.push(step);
  };
  const apply = (e: PokeEvent) => {
    live = e.kind === "clear" || e.expiry <= e.t ? null : { fee0For1: e.fee0For1, fee1For0: e.fee1For0, expiry: e.expiry, tx: e.tx };
  };
  let i = 0;
  for (; i < sorted.length && (sorted[i] as PokeEvent).t <= from; i++) apply(sorted[i] as PokeEvent);
  const atFrom = live as Live | null;
  push(from, atFrom && atFrom.expiry > from ? atFrom : null);
  if (atFrom && atFrom.expiry <= from) live = null;
  for (; i < sorted.length && (sorted[i] as PokeEvent).t <= to; i++) {
    const e = sorted[i] as PokeEvent;
    const cur = live as Live | null;
    if (cur && cur.expiry <= e.t) {
      push(cur.expiry, null);
      live = null;
    }
    apply(e);
    push(e.t, live);
  }
  const end = live as Live | null;
  if (end && end.expiry <= to) push(end.expiry, null);
  return steps;
}

const pick = (s: FeeStep, d: Direction) => (d === "0For1" ? s.fee0For1 : s.fee1For0);

/** The fee in force at `t` (the last step at or before `t`), or null before the first step. */
export function feeAt(steps: readonly FeeStep[], t: number, d: Direction): number | null {
  let v: number | null = null;
  for (const s of steps) {
    if (s.t > t) break;
    v = pick(s, d);
  }
  return v;
}

/** Time-weighted average fee over [steps[0].t, to], in pips. */
export function timeWeightedAverage(steps: readonly FeeStep[], to: number, d: Direction): number | null {
  const first = steps[0];
  if (!first || to <= first.t) return null;
  let acc = 0;
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k] as FeeStep;
    const end = Math.min(to, (steps[k + 1] as FeeStep | undefined)?.t ?? to);
    if (end > s.t) acc += pick(s, d) * (end - s.t);
  }
  return acc / (to - first.t);
}

/** Highest and lowest fee in force over the steps' span. */
export function peakAndLow(steps: readonly FeeStep[], d: Direction): { peak: number; low: number } | null {
  if (steps.length === 0) return null;
  const v = steps.map((s) => pick(s, d));
  return { peak: Math.max(...v), low: Math.min(...v) };
}

/** Pokes logged in (from, to]: Fables' "Changes" (how many times the keeper moved the fee in the window). */
export function pokeCount(events: readonly PokeEvent[], from: number, to: number): number {
  return events.filter((e) => e.kind === "poke" && e.t > from && e.t <= to).length;
}

/** clim's recommendation at one report: ClimPoker's Poked log carries quoteDirectional() per side (max'ed with a live
 *  event when eventApplied). quote() is the lower side: quoteDirectional() adds its premium to one side only
 *  (contracts/src/v2/ClimFeePolicy.sol). */
export type ClimPoint = {
  /** The report's observation time (tObs). */
  t: number;
  block: bigint;
  logIndex: number;
  seq: number;
  fee0For1: number;
  fee1For0: number;
  mode: number;
  eventApplied: boolean;
  expiry: number;
  tx: `0x${string}`;
};

export function climQuoteOf(p: Pick<ClimPoint, "fee0For1" | "fee1For0">): number {
  return Math.min(p.fee0For1, p.fee1For0);
}

/** clim's points as steps over [from, to] (the last point before `from`, if given, sets the first step). */
export function climSteps(points: readonly ClimPoint[], from: number, to: number): FeeStep[] {
  const sorted = [...points].sort((a, b) => a.t - b.t || a.seq - b.seq);
  const steps: FeeStep[] = [];
  let before: ClimPoint | null = null;
  for (const p of sorted) {
    if (p.t <= from) before = p;
    else if (p.t <= to) steps.push({ t: p.t, fee0For1: p.fee0For1, fee1For0: p.fee1For0, overridden: true, tx: p.tx });
  }
  if (before) steps.unshift({ t: from, fee0For1: before.fee0For1, fee1For0: before.fee1For0, overridden: true, tx: before.tx });
  return steps;
}
