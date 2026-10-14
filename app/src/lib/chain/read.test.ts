import { stateViewAbi } from "@clim/shared";
import { describe, expect, it } from "vitest";
import { FakeRpc, fakeLog } from "@/test/fakeRpc";
import { FEE_POKED, FEE_POKED_DIRECTIONAL, hookViewAbi, POKE_CLEARED } from "./events";
import { FABLES } from "./fables";
import { LIVE } from "./deployments";
import { readFablesNow, readFablesPokes } from "./readFables";
import { readPoolPokes } from "./readClim";

const SQRT = 3943055827863068952403550n;

describe("readFablesNow", () => {
  it("reads both directions' currentFee and the price three blocks behind the head", async () => {
    const rpc = new FakeRpc();
    rpc.head = 1000n;
    for (const [dir, fee] of [[true, 700], [false, 700]] as const) rpc.onCall(FABLES.hook, hookViewAbi, "currentFee", [FABLES.poolId, dir], fee);
    rpc.onCall(FABLES.stateView, stateViewAbi, "getSlot0", [FABLES.poolId], [SQRT, -198173, 0, 0]);
    const now = await readFablesNow(rpc.client());
    expect(now.blockNumber).toBe(997n);
    expect([now.fee0For1, now.fee1For0, now.t]).toEqual([700, 700, 99]);
    expect(Math.round(now.price)).toBe(2477);
    const calls = rpc.requests.filter((r) => r.method === "eth_call").map((r) => (r.params as [unknown, string])[1]);
    expect(calls.every((b) => b === "0x3e5")).toBe(true);
  });
});

describe("readFablesPokes", () => {
  it("returns this pool's overrides only, decoded, over ranges of at most 5,000,000 blocks", async () => {
    const rpc = new FakeRpc();
    rpc.logs = [
      fakeLog(FEE_POKED, { poolId: FABLES.poolId, fee: 1468, expiry: 8_000 }, { address: FABLES.hook, blockNumber: 10n, t: 800 }),
      fakeLog(FEE_POKED, { poolId: `0x${"cd".repeat(32)}`, fee: 9, expiry: 8_000 }, { address: FABLES.hook, blockNumber: 11n, t: 801 }),
      fakeLog(FEE_POKED, { poolId: FABLES.poolId, fee: 2657, expiry: 8_060 }, { address: FABLES.hook, blockNumber: 6_000_000n, t: 860 }),
    ];
    const pokes = await readFablesPokes(rpc.client(), 0n, 7_000_000n);
    expect(pokes.map((p) => (p.kind === "poke" ? [p.fee0For1, p.t] : 0))).toEqual([[1468, 1], [2657, 600_000]]);
    expect(rpc.getLogsRanges).toEqual([[0n, 4_999_999n], [5_000_000n, 7_000_000n]]);
  });
});

describe("readPoolPokes", () => {
  it("decodes both FeePoked variants and PokeCleared for one testnet pool", async () => {
    const rpc = new FakeRpc();
    const poolId = LIVE.pools.K.poolId;
    rpc.logs = [
      fakeLog(FEE_POKED, { poolId, fee: 1466, expiry: 9_000 }, { address: LIVE.hook, blockNumber: 5n, t: 100 }),
      fakeLog(FEE_POKED_DIRECTIONAL, { poolId, fee0For1: 700, fee1For0: 900, expiry: 9_000 }, { address: LIVE.hook, blockNumber: 6n, t: 130 }),
      fakeLog(POKE_CLEARED, { poolId }, { address: LIVE.hook, blockNumber: 7n, t: 160 }),
      fakeLog(FEE_POKED, { poolId: LIVE.pools.D.poolId, fee: 5000, expiry: 9_000 }, { address: LIVE.hook, blockNumber: 8n, t: 190 }),
    ];
    const events = await readPoolPokes(rpc.client(), "K", 0n, 100n);
    expect(events.map((e) => (e.kind === "poke" ? [e.fee0For1, e.fee1For0] : "clear"))).toEqual([[1466, 1466], [700, 900], "clear"]);
    expect(events.map((e) => e.t)).toEqual([0, 0, 0]);
  });
});
