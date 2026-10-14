import { describe, expect, test } from "bun:test";
import { COST_BEGIN, COST_END, formatEth, renderCostSection, replaceBetween, type GasEvidence } from "../../src/live/lib/costdoc";

const S = (gasUsedMedian: number, n: number) => ({
  n,
  gasUsedMedian,
  gasUsedP90: gasUsedMedian + 300,
  gasUsedForL1Median: 0,
  effectiveGasPriceMedianWei: 10_000_000,
  costMedianEth: (gasUsedMedian * 10_000_000) / 1e18,
});

const E: GasEvidence = {
  generatedAt: "2026-10-14T08:59:53.112Z",
  chainId: 46630,
  deskReport: S(86_297, 65),
  poke: S(79_749, 64),
  keeperPoke: S(46_047, 11),
  arbSwap: S(132_067, 195),
  retailSwap: null,
  cadence: {
    fromBlock: 134_920_769,
    toBlock: 134_956_769,
    deskReport: { n: 121, spanSec: 3_600, medianGapSec: 30, p90GapSec: 31, perDay: 2_880 },
    poke: { n: 121, spanSec: 3_600, medianGapSec: 30, p90GapSec: 31, perDay: 2_880 },
  },
};

describe("cost section", () => {
  test("ETH amounts without exponent or trailing zeros", () => {
    expect(formatEth(8.6297e-7)).toBe("0.00000086297");
    expect(formatEth(0.00000132067)).toBe("0.00000132067");
    expect(formatEth(0)).toBe("0.0");
  });
  test("one row per transaction type, the cadence and the daily cost of the desk and its poker", () => {
    const md = renderCostSection(E);
    expect(md).toContain("| Desk report (CRE simulator, through the mock forwarder) | 65 | 86,297 | 86,597 | 0 | 0.00000086297 ETH |");
    expect(md).toContain("| `ClimPoker.poke()` on pool D | 64 | 79,749 | 80,049 | 0 | 0.00000079749 ETH |");
    expect(md).toContain("| Retail swap | 0 | not measured | | | |");
    expect(md).toContain("Median effective gas price of the desk reports: 0.01 gwei.");
    expect(md).toContain("over blocks 134,920,769 to 134,956,769 (outages included): 121 desk reports, a median gap of 30 s (p90 31 s), 2,880 reports a day; 121 pokes, 2,880 a day.");
    // (86,297 + 79,749) gas x 0.01 gwei x 2,880 = 0.004782 ETH
    expect(md).toContain("the desk and its poker cost 0.0048 ETH a day on Robinhood Chain testnet.");
  });
  test("an evidence file without cadence is refused", () => {
    expect(() => renderCostSection({ ...E, cadence: undefined })).toThrow("run `cd bots && bun run live:gas` first");
  });
  test("the body goes between the markers, the rest of the document is kept", () => {
    const doc = `# Title\n\n${COST_BEGIN}\nold\n${COST_END}\n\nafter\n`;
    expect(replaceBetween(doc, "new")).toBe(`# Title\n\n${COST_BEGIN}\nnew\n${COST_END}\n\nafter\n`);
    expect(() => replaceBetween("# no markers", "x")).toThrow("not found");
  });
});
