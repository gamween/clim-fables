import { describe, expect, test } from "bun:test";
import { climPokerAbi, FeeMode } from "@clim/shared";
import { ContractFunctionExecutionError, ContractFunctionRevertedError } from "viem";
import {
  lastPokedSeqFrom,
  POKE_GAS_MARGIN_PCT,
  POKE_LAG_DELAY_MS,
  POKE_LAG_RETRIES,
  POKED_LOOKBACK_BLOCKS,
  pokeDecision,
  readLastPokedSeq,
  simulatePoke,
  withGasMargin,
} from "../../src/live/lib/runner";

describe("when the runner pokes", () => {
  test("once per new desk report", () => {
    expect(pokeDecision(0, 0, FeeMode.Normal)).toBe("wait"); // no report yet
    expect(pokeDecision(5, 4, FeeMode.Normal)).toBe("poke");
    expect(pokeDecision(5, 5, FeeMode.Normal)).toBe("wait");
    expect(pokeDecision(9, 5, FeeMode.Degraded)).toBe("poke"); // degraded still pokes (at least the safe fee)
  });
  test("never on a blind desk (ClimPoker would revert DeskBlind)", () => {
    expect(pokeDecision(6, 5, FeeMode.Blind)).toBe("blind");
  });
});

describe("a fresh report the simulating RPC node has not seen yet", () => {
  // the revert viem throws when eth_call of poke() lands on a node still at the previous seq
  const deskBlind = () =>
    new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: climPokerAbi, functionName: "poke", data: "0x5caf72fd" }), {
      abi: climPokerAbi,
      functionName: "poke",
    });
  /** A client whose simulateContract answers from `script`, one entry per call (the last one repeats). */
  const mockClient = (script: Array<"blind" | "ok" | "nonce">) => {
    let calls = 0;
    return {
      calls: () => calls,
      simulateContract: async () => {
        const step = script[Math.min(calls, script.length - 1)];
        calls += 1;
        if (step === "blind") throw deskBlind();
        if (step === "nonce") throw new Error("nonce too low");
        return { request: { functionName: "poke" as const } };
      },
    };
  };
  const recorder = () => {
    const sleeps: number[] = [];
    const retries: number[] = [];
    return { sleeps, retries, sleep: async (ms: number) => void sleeps.push(ms), onRetry: (_e: unknown, n: number) => void retries.push(n) };
  };

  test("waits 2 s and simulates again until the node catches up", async () => {
    const client = mockClient(["blind", "blind", "ok"]);
    const r = recorder();
    const out = await simulatePoke(() => client.simulateContract(), r);
    expect(out.request.functionName).toBe("poke");
    expect(client.calls()).toBe(3);
    expect(r.sleeps).toEqual([2_000, 2_000]);
    expect(r.retries).toEqual([1, 2]);
    expect(POKE_LAG_DELAY_MS).toBe(2_000);
  });
  test("still DeskBlind after 3 retries: the DeskBlind error comes back (the runner logs a skip)", async () => {
    const client = mockClient(["blind"]);
    const r = recorder();
    await expect(simulatePoke(() => client.simulateContract(), r)).rejects.toThrow(/DeskBlind/);
    expect(client.calls()).toBe(1 + POKE_LAG_RETRIES);
    expect(POKE_LAG_RETRIES).toBe(3);
    expect(r.sleeps).toEqual([2_000, 2_000, 2_000]);
  });
  test("any other error is not retried here (the supervisor backs off)", async () => {
    const client = mockClient(["nonce", "ok"]);
    const r = recorder();
    await expect(simulatePoke(() => client.simulateContract(), r)).rejects.toThrow("nonce too low");
    expect(client.calls()).toBe(1);
    expect(r.sleeps).toEqual([]);
  });
});

describe("a restarted runner", () => {
  const poked = (seq: number) => ({ args: { seq } });
  test("takes the highest seq of ClimPoker's Poked events as its last poked seq", () => {
    expect(lastPokedSeqFrom([poked(99), poked(100), poked(98)])).toBe(100);
    expect(lastPokedSeqFrom([])).toBe(0);
    expect(lastPokedSeqFrom([{ args: {} }])).toBe(0);
  });
  test("does not poke again the seq it poked before the restart (2026-10-14 09:33 UTC: seq 100 poked twice)", () => {
    const last = lastPokedSeqFrom([poked(99), poked(100)]);
    expect(pokeDecision(100, last, FeeMode.Normal)).toBe("wait");
    expect(pokeDecision(101, last, FeeMode.Normal)).toBe("poke");
  });
  test("reads the Poked events of the last POKED_LOOKBACK_BLOCKS blocks, in getLogs ranges of at most 2,000 blocks", async () => {
    const ranges: Array<[bigint, bigint]> = [];
    const client = {
      getBlockNumber: async () => 10_000n,
      getLogs: async (a: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([a.fromBlock, a.toBlock]);
        return a.toBlock === 10_000n ? [poked(140), poked(141)] : [poked(139)];
      },
    };
    expect(await readLastPokedSeq(client, "0x99d6c4F74A2ad09471b1B4fd1F0aC68B099cbE07")).toBe(141);
    expect(ranges[0]?.[0]).toBe(10_000n - POKED_LOOKBACK_BLOCKS + 1n);
    expect(ranges.at(-1)?.[1]).toBe(10_000n);
    expect(ranges.every(([a, b]) => b - a < 2_000n)).toBe(true);
    // ten minutes at about 10 blocks a second: more than tauKill (180 s), after which the desk is blind and nothing is poked
    expect(POKED_LOOKBACK_BLOCKS).toBe(6_000n);
  });
});

describe("the gas limit of a poke", () => {
  test("is the estimate plus 20 %, rounded up", () => {
    expect(POKE_GAS_MARGIN_PCT).toBe(20);
    expect(withGasMargin(100_000n)).toBe(120_000n);
    expect(withGasMargin(77_837n)).toBe(93_405n);
  });
  test("covers a poke that rewrites changed fees after an estimate made on unchanged ones", () => {
    // 2026-10-14 09:33 UTC: estimated (and limited) at 77,837 gas against seq 100's unchanged fees, mined after seq 101
    // changed the quote: out of gas. Pokes with changed fees used 79,749 (median) to 79,817 (p90) gas that day.
    expect(withGasMargin(77_837n) > 79_817n).toBe(true);
  });
});
