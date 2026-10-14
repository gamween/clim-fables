import { poolIdFromKey } from "@clim/shared";
import { describe, expect, it } from "vitest";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { FABLES } from "./fables";

describe("Fables' ETH/USDG constants", () => {
  it("match the lab's committed record of the pool", () => {
    expect(FABLES.poolId).toBe(storm.poolId);
    expect(FABLES.hook.toLowerCase()).toBe(storm.hook);
    expect(FABLES.keeper.toLowerCase()).toBe(storm.keepers[0]);
    expect(FABLES.config).toEqual(storm.config);
    expect(FABLES.pokeTtlSec).toBe(storm.pokeTtlSec);
    expect(FABLES.chainId).toBe(storm.chainId);
  });
  it("hash to the pool id (ETH native as currency0, USDG, dynamic fee, tick spacing 10, the hook)", () => {
    expect(poolIdFromKey(FABLES.key)).toBe(FABLES.poolId);
  });
});
