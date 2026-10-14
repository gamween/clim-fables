import { describe, expect, it } from "vitest";
import { FakeRpc } from "@/test/fakeRpc";
import { blockTimes, firstBlockAtOrAfter } from "./blockTimes";

describe("blockTimes", () => {
  it("reads each block once, in batches of 50", async () => {
    const rpc = new FakeRpc();
    const client = rpc.client();
    const blocks = Array.from({ length: 120 }, (_, i) => BigInt(i));
    const m = await blockTimes(client, [...blocks, 5n]);
    expect(m.get(50n)).toBe(5);
    await blockTimes(client, blocks);
    expect(rpc.requests.filter((r) => r.method === "eth_getBlockByNumber")).toHaveLength(120);
  });
});

describe("firstBlockAtOrAfter", () => {
  it("finds the first block at or after a time with regular blocks", async () => {
    const rpc = new FakeRpc();
    rpc.blockTime = (n) => Number(n) * 0.1;
    const b = await firstBlockAtOrAfter(rpc.client(), 5_000, 1_000_000n, 100_000, 0.09);
    expect(b).toBe(50_000n);
    expect(rpc.requests.length).toBeLessThan(40);
  });
  it("finds it with irregular blocks and a too-short first guess", async () => {
    const rpc = new FakeRpc();
    // 0.05 s blocks before block 500,000, 0.2 s after: the first guess (0.09 s) lands after the target.
    rpc.blockTime = (n) => (n < 500_000n ? Number(n) * 0.05 : 25_000 + Number(n - 500_000n) * 0.2);
    const target = 20_000;
    const b = await firstBlockAtOrAfter(rpc.client(), target, 1_000_000n, rpc.blockTime(1_000_000n), 0.09);
    expect(Math.floor(rpc.blockTime(b))).toBeGreaterThanOrEqual(target);
    expect(Math.floor(rpc.blockTime(b - 1n))).toBeLessThan(target);
  });
  it("returns the block after hi when hi is still before the target", async () => {
    const rpc = new FakeRpc();
    expect(await firstBlockAtOrAfter(rpc.client(), 500, 100n, 10, 0.09)).toBe(101n);
  });
});
