import { describe, expect, it } from "vitest";
import { laggedHead, withRetry } from "./retry";

const noSleep = async () => {};

describe("laggedHead", () => {
  it("reads three blocks behind the head", () => expect(laggedHead(100n)).toBe(97n));
  it("never goes below zero", () => expect(laggedHead(2n)).toBe(0n));
});

describe("withRetry", () => {
  it("returns the first success", async () => {
    let n = 0;
    await expect(withRetry(async () => ++n, { sleep: noSleep })).resolves.toBe(1);
  });
  it("retries a failing read, then succeeds", async () => {
    let n = 0;
    const v = await withRetry(async () => {
      if (++n < 3) throw new Error("BlockNotFoundError");
      return "ok";
    }, { sleep: noSleep });
    expect([v, n]).toEqual(["ok", 3]);
  });
  it("throws the last error after every retry", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error(`fail ${n}`); }, { sleep: noSleep })).rejects.toThrow("fail 4");
  });
  it("stops at once when shouldRetry refuses", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error("revert"); }, { sleep: noSleep, shouldRetry: () => false })).rejects.toThrow("revert");
    expect(n).toBe(1);
  });
});
