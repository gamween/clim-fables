import { describe, expect, test } from "bun:test";
import { climPokerAbi, FeeMode } from "@clim/shared";
import { ContractFunctionExecutionError, ContractFunctionRevertedError } from "viem";
import { POKE_LAG_DELAY_MS, POKE_LAG_RETRIES, pokeDecision, simulatePoke } from "../../src/live/lib/runner";

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
