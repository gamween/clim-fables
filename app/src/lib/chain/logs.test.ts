import { describe, expect, it } from "vitest";
import { blockAtOrBefore, blockRanges, getLogsChunked } from "./logs";

describe("blockRanges", () => {
  it("splits a span into chunks", () => {
    expect(blockRanges(0n, 25n, 10n)).toEqual([[0n, 9n], [10n, 19n], [20n, 25n]]);
  });
  it("returns one range when the span fits", () => expect(blockRanges(5n, 7n, 10n)).toEqual([[5n, 7n]]));
  it("returns nothing for an empty span", () => expect(blockRanges(8n, 7n, 10n)).toEqual([]));
  it("stays under the RPCs' 10,000,000-block cap by default", () => {
    for (const [a, b] of blockRanges(0n, 23_000_000n)) expect(b - a + 1n <= 10_000_000n).toBe(true);
  });
});

it("concatenates the ranges in order", async () => {
  const calls: Array<[bigint, bigint]> = [];
  const logs = await getLogsChunked(async (a, b) => { calls.push([a, b]); return [Number(a)]; }, 0n, 25n, 10n);
  expect(calls).toEqual([[0n, 9n], [10n, 19n], [20n, 25n]]);
  expect(logs).toEqual([0, 10, 20]);
});

it("steps back far enough in time", () => {
  // 600 s at no less than 0.09 s a block is at most 6,667 blocks.
  expect(blockAtOrBefore(10_000n, 1_000, 400, 0.09)).toBe(3_333n);
  expect(blockAtOrBefore(100n, 1_000, 0, 0.09)).toBe(0n);
});
