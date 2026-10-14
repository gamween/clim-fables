import { describe, expect, test } from "bun:test";
import { DEFAULT_RH_TESTNET_RPC_URL, liveKey, liveRpcUrl } from "../../src/live/lib/env";

const KEY = `0x${"2".repeat(64)}` as const;

describe("live env", () => {
  test("public testnet RPC unless RH_TESTNET_RPC_URL is set", () => {
    expect(liveRpcUrl({})).toBe(DEFAULT_RH_TESTNET_RPC_URL);
    expect(liveRpcUrl({ RH_TESTNET_RPC_URL: "http://127.0.0.1:8545" })).toBe("http://127.0.0.1:8545");
  });
  test("one key per role, checked", () => {
    expect(liveKey("runner", { RUNNER_PRIVATE_KEY: KEY })).toBe(KEY);
    expect(liveKey("arb", { ARB_RH_PRIVATE_KEY: KEY })).toBe(KEY);
    expect(() => liveKey("keeper", {})).toThrow(/KEEPER_PRIVATE_KEY/);
  });
});
