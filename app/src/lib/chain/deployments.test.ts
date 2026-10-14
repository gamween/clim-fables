import { describe, expect, it } from "vitest";
import { FABLES } from "./fables";
import { LIVE, orientationOf } from "./deployments";

describe("the testnet stack", () => {
  it("parses with the addresses the README publishes", () => {
    expect(LIVE.chainId).toBe(46630);
    expect(LIVE.riskDesk).toBe("0x63f543430982685387C83e4ec55E5a26fd1371Ef");
    expect(LIVE.policy).toBe("0x5f140A5e17826CFcEeeD7cD3FcAe4D56c9e0C519");
    expect(LIVE.poker).toBe("0x99d6c4F74A2ad09471b1B4fd1F0aC68B099cbE07");
    expect(LIVE.hook).toBe("0xBb4afdfd08921e0731199e565eC11724B09b9080");
    expect(LIVE.hookConfig).toEqual(FABLES.config);
  });
  it("orients D, K and F like Fables' pool: ETH as token0, 18 and 6 decimals", () => {
    for (const p of ["D", "K", "F"] as const) expect(orientationOf(p)).toEqual({ token0IsEth: true, decimals0: 18, decimals1: 6 });
  });
});
