// Gas statistics for the CTO checklist (spec §5.8: cost per report and per poke on Robinhood Chain), pure helpers.
import type { Hex } from "viem";

export type GasRow = { gasUsed: bigint; gasUsedForL1: bigint; effectiveGasPrice: bigint };
export type GasSummary = {
  n: number;
  gasUsedMedian: number;
  gasUsedP90: number;
  gasUsedForL1Median: number;
  effectiveGasPriceMedianWei: number;
  costMedianEth: number;
};

/** Nearest-rank percentile. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) throw new RangeError("percentile of an empty list");
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[rank - 1] as number;
}

export function summarizeGas(rows: readonly GasRow[]): GasSummary {
  const gas = rows.map((r) => Number(r.gasUsed));
  const price = rows.map((r) => Number(r.effectiveGasPrice));
  const cost = rows.map((r) => Number(r.gasUsed * r.effectiveGasPrice) / 1e18);
  return {
    n: rows.length,
    gasUsedMedian: percentile(gas, 50),
    gasUsedP90: percentile(gas, 90),
    gasUsedForL1Median: percentile(rows.map((r) => Number(r.gasUsedForL1)), 50),
    effectiveGasPriceMedianWei: percentile(price, 50),
    costMedianEth: percentile(cost, 50),
  };
}

/** The last `last` transaction hashes of a JSON-lines log whose record matches `pick` (malformed lines skipped). */
export function hashesFromJsonl(text: string, pick: (o: Record<string, unknown>) => boolean, last: number): Hex[] {
  const out: Hex[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof o.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(o.txHash) && pick(o)) out.push(o.txHash as Hex);
  }
  return out.slice(-last);
}

export type Cadence = { n: number; spanSec: number; medianGapSec: number; p90GapSec: number; perDay: number };

/** Cadence of a series of times (unix seconds, ascending): the gaps' median and p90, and the measured daily rate
 *  ((n - 1) events over the span, scaled to 86,400 s), which stays right when the gaps alternate. */
export function cadence(times: readonly number[]): Cadence {
  if (times.length < 2) throw new RangeError("cadence needs at least two times");
  const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
  if (gaps.some((g) => g < 0)) throw new RangeError("times must be ascending");
  const spanSec = (times[times.length - 1] as number) - (times[0] as number);
  if (spanSec === 0) throw new RangeError("cadence needs a span longer than 0 s");
  return {
    n: times.length,
    spanSec,
    medianGapSec: percentile(gaps, 50),
    p90GapSec: percentile(gaps, 90),
    perDay: Math.round(((times.length - 1) * 86_400) / spanSec),
  };
}
