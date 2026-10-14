import { describe, expect, test } from "bun:test";
import { sqrtPriceX96FromEthUsd, type PairOrientation } from "@clim/shared";
import { decideArb } from "../../src/lib/arb";
import { decideArbDirectional } from "../../src/live/lib/arb";

const ETH0: PairOrientation = { token0IsEth: true, decimals0: 18, decimals1: 6 };
const USD0: PairOrientation = { token0IsEth: false, decimals0: 6, decimals1: 18 };
const M = 2_000;
const at = (pool: number, o: PairOrientation, fee0For1: number, fee1For0: number) =>
  decideArbDirectional({ sqrtPriceX96: sqrtPriceX96FromEthUsd(pool, o), marketEthUsd: M, fee0For1, fee1For0, orientation: o });

describe("arbitrage on a per-direction hook", () => {
  test("symmetric fees: the same decision as v1's decideArb", () => {
    const s = sqrtPriceX96FromEthUsd(2_002, ETH0);
    const { feePips, ...dec } = decideArbDirectional({ sqrtPriceX96: s, marketEthUsd: M, fee0For1: 500, fee1For0: 500, orientation: ETH0 });
    expect(dec).toEqual(decideArb({ sqrtPriceX96: s, marketEthUsd: M, feePips: 500, orientation: ETH0 }));
    expect(feePips).toBe(500);
  });
  test("pool ETH too dear (+10 bp), ETH token0: selling ETH is zeroForOne, so fee0For1 sets the band", () => {
    expect(at(2_002, ETH0, 500, 1_500).action).toBe("swap");
    const none = at(2_002, ETH0, 1_500, 500);
    expect(none.action).toBe("none");
    expect(none.feePips).toBe(1_500);
  });
  test("pool ETH too cheap (-10 bp), ETH token0: buying ETH is oneForZero, so fee1For0 sets the band", () => {
    expect(at(1_998, ETH0, 1_500, 500).action).toBe("swap");
    expect(at(1_998, ETH0, 500, 1_500).action).toBe("none");
  });
  test("USD token0 flips which fee applies", () => {
    expect(at(2_002, USD0, 1_500, 500).action).toBe("swap"); // selling ETH is oneForZero here
    expect(at(2_002, USD0, 500, 1_500).action).toBe("none");
  });
});
