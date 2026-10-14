import { describe, expect, test } from "bun:test";
import { FeeMode } from "@clim/shared";
import { pokeDecision } from "../../src/live/lib/runner";

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
