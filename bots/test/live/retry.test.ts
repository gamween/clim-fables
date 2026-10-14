import { describe, expect, test } from "bun:test";
import { HEAD_LAG_BLOCKS, laggedHead, READ_RETRIES, READ_RETRY_DELAY_MS, withRetry } from "../../src/live/lib/retry";

describe("reads behind the head", () => {
  test("three blocks behind the head, never below block 0", () => {
    expect(HEAD_LAG_BLOCKS).toBe(3n);
    expect(laggedHead(134_931_100n)).toBe(134_931_097n);
    expect(laggedHead(3n)).toBe(0n);
    expect(laggedHead(1n)).toBe(0n);
  });
});

describe("retry of a failed read", () => {
  const lagging = (failures: number, error = "BlockNotFoundError") => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls <= failures) throw new Error(error);
      return calls;
    };
    return { fn, calls: () => calls };
  };
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  test("up to 3 retries, 1 s apart, then the read's value", async () => {
    sleeps.length = 0;
    const r = lagging(3);
    expect(await withRetry(r.fn, { sleep })).toBe(4);
    expect(r.calls()).toBe(1 + READ_RETRIES);
    expect(sleeps).toEqual([READ_RETRY_DELAY_MS, READ_RETRY_DELAY_MS, READ_RETRY_DELAY_MS]);
    expect(READ_RETRY_DELAY_MS).toBe(1_000);
  });
  test("a read that never succeeds throws its last error after 4 tries", async () => {
    sleeps.length = 0;
    const r = lagging(10, "Missing or invalid parameters");
    await expect(withRetry(r.fn, { sleep })).rejects.toThrow("Missing or invalid parameters");
    expect(r.calls()).toBe(4);
    expect(sleeps.length).toBe(3);
  });
  test("no retry when the first try succeeds", async () => {
    sleeps.length = 0;
    const r = lagging(0);
    expect(await withRetry(r.fn, { sleep })).toBe(1);
    expect(sleeps.length).toBe(0);
  });
  test("an error shouldRetry rejects is thrown at once; onRetry sees each retry", async () => {
    sleeps.length = 0;
    const seen: number[] = [];
    const r = lagging(10, "execution reverted: SomethingElse");
    await expect(withRetry(r.fn, { sleep, shouldRetry: (e) => String(e).includes("historical state"), onRetry: (_e, n) => seen.push(n) })).rejects.toThrow("SomethingElse");
    expect(r.calls()).toBe(1);
    const r2 = lagging(2, "historical state not available");
    expect(await withRetry(r2.fn, { sleep, retries: 3, delayMs: 2_000, onRetry: (_e, n) => seen.push(n) })).toBe(3);
    expect(seen).toEqual([1, 2]);
    expect(sleeps).toEqual([2_000, 2_000]);
  });
});
