import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../../src/lib/rng";
import { planTickOrders, type FlowConfig } from "../../src/live/lib/flow";

const CFG: FlowConfig = { ordersPerTick: 0.2, medianUsd: 2_000, sigmaLn: 1 };

describe("retail flow per tick", () => {
  test("deterministic for a seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) expect(planTickOrders(a, CFG)).toEqual(planTickOrders(b, CFG));
  });
  test("Poisson count, balanced sides, log-normal size", () => {
    const r = mulberry32(3);
    const orders = Array.from({ length: 20_000 }, () => planTickOrders(r, CFG)).flat();
    expect(Math.abs(orders.length / 20_000 - 0.2)).toBeLessThan(0.02);
    expect(Math.abs(orders.filter((o) => o.side === "buyEth").length / orders.length - 0.5)).toBeLessThan(0.04);
    const sizes = orders.map((o) => o.usd).sort((x, y) => x - y);
    expect(Math.abs((sizes[Math.floor(sizes.length / 2)] ?? 0) / 2_000 - 1)).toBeLessThan(0.1);
  });
});
