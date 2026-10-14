import { describe, expect, test } from "bun:test";
import { cadence, hashesFromJsonl, percentile, summarizeGas } from "../../src/live/lib/gas";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

describe("gas summary", () => {
  test("percentiles (nearest rank)", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 90)).toBe(5);
    expect(() => percentile([], 50)).toThrow();
  });
  test("median gas, L1 share, price and cost per transaction", () => {
    const s = summarizeGas([
      { gasUsed: 100_000n, gasUsedForL1: 2_000n, effectiveGasPrice: 10_000_000n },
      { gasUsed: 120_000n, gasUsedForL1: 2_500n, effectiveGasPrice: 10_000_000n },
      { gasUsed: 110_000n, gasUsedForL1: 2_200n, effectiveGasPrice: 12_000_000n },
    ]);
    expect(s).toEqual({ n: 3, gasUsedMedian: 110_000, gasUsedP90: 120_000, gasUsedForL1Median: 2_200, effectiveGasPriceMedianWei: 10_000_000, costMedianEth: 0.0000012 });
  });
  test("transaction hashes from a JSON-lines log, last N matching", () => {
    const text = [
      JSON.stringify({ action: "poke", txHash: H(1) }),
      JSON.stringify({ action: "error" }),
      "not json",
      JSON.stringify({ action: "poke", txHash: H(2) }),
      JSON.stringify({ action: "poke", txHash: H(3) }),
    ].join("\n");
    expect(hashesFromJsonl(text, (o) => o.action === "poke", 2)).toEqual([H(2), H(3)]);
  });
});

describe("cadence", () => {
  test("a report every 30 s: 2,880 a day", () => {
    expect(cadence([0, 30, 60, 90, 120])).toEqual({ n: 5, spanSec: 120, medianGapSec: 30, p90GapSec: 30, perDay: 2_880 });
  });
  test("gaps alternating 30 and 60 s: the rate comes from the span, not the median gap", () => {
    const c = cadence([0, 30, 90, 120, 180, 210, 270]);
    expect(c.perDay).toBe(1_920); // 6 gaps over 270 s
    expect(c.p90GapSec).toBe(60);
  });
  test("fewer than two times, a zero span or times out of order throw", () => {
    expect(() => cadence([10])).toThrow("at least two times");
    expect(() => cadence([10, 10])).toThrow("longer than 0 s");
    expect(() => cadence([10, 5])).toThrow("ascending");
  });
});
