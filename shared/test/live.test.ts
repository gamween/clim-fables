import { describe, expect, test } from "bun:test";
import { DYNAMIC_FEE_FLAG, liveOrientation, parseLiveDeployments, poolIdFromKey, type PoolKey } from "../src/index";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const TETH = A(0xe7);
const TUSDG = A(0xf0); // > tETH: tETH is currency0
const HOOK = "0x0000000000000000000000000000000000001080" as const;

function key(tickSpacing: number): PoolKey {
  return { currency0: TETH, currency1: TUSDG, fee: DYNAMIC_FEE_FLAG, tickSpacing, hooks: HOOK };
}
function pool(tickSpacing: number, driver: string) {
  const k = key(tickSpacing);
  return { key: k, poolId: poolIdFromKey(k), token0IsEth: true, driver };
}
function raw() {
  return {
    chainId: 46630,
    deployBlock: 134_550_720,
    deployer: A(1),
    uniswap: { poolManager: A(2), stateView: A(3), poolSwapTest: A(4), poolModifyLiquidityTest: A(5) },
    routers: { arb: A(6) },
    cre: { mockForwarder: A(7), keystoneForwarder: A(8), simOperator: A(9) },
    accessManager: A(10),
    roles: { feePoker: 1, climRunner: 7, runner: A(11), keeper: A(12) },
    tokens: {
      tETH: { address: TETH, symbol: "tETH", decimals: 18 },
      tUSDG: { address: TUSDG, symbol: "tUSDG", decimals: 6 },
    },
    hook: HOOK,
    hookConfig: { floorPips: 100, flatPips: 700, capPips: 6000 },
    riskDesk: A(13),
    policy: A(14),
    poker: A(15),
    pools: { D: pool(10, "ClimPoker (directional)"), K: pool(11, "keeper-style bot"), F: pool(12, "none (flat 7 bp)") },
    liquidity: "123456789012345678901234",
    initEthUsd: 2500,
    verify: {},
  };
}

describe("parseLiveDeployments", () => {
  test("accepts the file 14_LiveWriteDeployments writes", () => {
    const d = parseLiveDeployments(raw());
    expect(d.chainId).toBe(46630);
    expect(d.pools.D.poolId).toBe(poolIdFromKey(key(10)));
    expect(d.pools.K.key.tickSpacing).toBe(11);
    expect(d.tokens.tUSDG.decimals).toBe(6);
    expect(d.liquidity).toBe(123456789012345678901234n);
    expect(d.roles.climRunner).toBe(7);
  });
  test("orientation of a pool: ETH token0 with 18 and 6 decimals", () => {
    const d = parseLiveDeployments(raw());
    expect(liveOrientation(d, d.pools.D)).toEqual({ token0IsEth: true, decimals0: 18, decimals1: 6 });
  });
  test("rejects another chain unless allowed (a local fork runs as 31337)", () => {
    const r = { ...raw(), chainId: 31337 };
    expect(() => parseLiveDeployments(r)).toThrow(/chainId/);
    expect(parseLiveDeployments(r, [31337]).chainId).toBe(31337);
  });
  test("rejects a poolId that does not match its key", () => {
    const r = raw();
    r.pools.K.poolId = `0x${"00".repeat(32)}` as `0x${string}`;
    expect(() => parseLiveDeployments(r)).toThrow(/pools.K.poolId/);
  });
  test("rejects a pool on another hook or without the dynamic-fee flag", () => {
    const r = raw();
    const k = { ...key(12), fee: 700 };
    r.pools.F = { key: k, poolId: poolIdFromKey(k), token0IsEth: true, driver: "x" };
    expect(() => parseLiveDeployments(r)).toThrow(/dynamic fee flag/);
  });
  test("rejects a wrong token order flag", () => {
    const r = raw();
    r.pools.D.token0IsEth = false;
    expect(() => parseLiveDeployments(r)).toThrow(/token0IsEth/);
  });
});
