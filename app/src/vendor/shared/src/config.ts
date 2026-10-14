// Typed, validated loaders for shared/deployments/sepolia.json and shared/params.json.
// Validation catches deploy-script mistakes early (wrong poolId, unsorted currencies, wrong token order flag).
// The deployments layout is the one plan 01's 05_WriteDeployments writes and plan 05's app parses; keys this
// loader does not know (plan 01's `deployer`, `liquidity`) are ignored.
import { encodeAbiParameters, getAddress, isAddress, keccak256, zeroAddress, type Address, type Hex } from "viem";
import deploymentsJson from "../deployments/sepolia.json";
import paramsJson from "../params.json";
import { POOL_KEY_COMPONENTS } from "./abis";
import type { PairOrientation } from "./price";
import { etaE4FromPStar, PIPS_DENOMINATOR, type HookParams } from "./units";

export const SEPOLIA_CHAIN_ID = 11155111;
/** LPFeeLibrary.DYNAMIC_FEE_FLAG: PoolKey.fee of a dynamic-fee pool. */
export const DYNAMIC_FEE_FLAG = 0x800000;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type TokenEntry = { address: Address; symbol: string; decimals: number };
export type PoolEntry = { key: PoolKey; poolId: Hex; token0IsEth: boolean };
export type PairName = "live" | "replay";
export type PoolName = "liveV" | "liveS" | "replayV" | "replayS";

export type Deployments = {
  chainId: number;
  deployBlock: number | null;
  uniswap: { poolManager: Address; stateView: Address; poolSwapTest: Address; poolModifyLiquidityTest: Address };
  cre: { mockForwarder: Address; keystoneForwarder: Address };
  /** One token pair serves the live and the replay pools (their PoolKeys differ by hook and static fee). */
  tokens: { tETH: TokenEntry | null; tUSD: TokenEntry | null };
  /** `don`: the desk wired to the production KeystoneForwarder (plan 02 Task 13), not used by any pool here. */
  riskDesks: { live: Address | null; replay: Address | null; don: Address | null };
  hooks: Record<PairName, Address | null>;
  pools: Record<PoolName, PoolEntry | null>;
  /** `arb`: a second PoolSwapTest used only by the arbitrage bot, so the app can tell arbitrage swaps by Swap.sender (plan 05). */
  routers: { arb: Address | null };
};

export type ClimParams = HookParams & { pStar: number; decidedBy: string };

/** Everything a bot needs for one pair, all non-null. */
export type ResolvedPair = {
  pair: PairName;
  V: PoolEntry;
  S: PoolEntry;
  hook: Address;
  desk: Address;
  tETH: TokenEntry;
  tUSD: TokenEntry;
};

export function poolIdFromKey(key: PoolKey): Hex {
  return keccak256(encodeAbiParameters([{ type: "tuple", components: POOL_KEY_COMPONENTS }], [key]));
}

export function requireValue<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) {
    throw new Error(`${what} is null: deploy it first (plan 01) and record it in shared/deployments/sepolia.json`);
  }
  return v;
}

type Json = Record<string, unknown>;

function obj(v: unknown, path: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${path}: expected an object`);
  return v as Json;
}
function optObj(v: unknown, path: string): Json {
  return v === undefined || v === null ? {} : obj(v, path);
}
function addr(v: unknown, path: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new Error(`${path}: expected an address, got ${String(v)}`);
  return getAddress(v);
}
function addrOrNull(v: unknown, path: string): Address | null {
  return v === null || v === undefined ? null : addr(v, path);
}
function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${path}: expected an integer in [${min}, ${max}], got ${String(v)}`);
  }
  return v;
}
function token(v: unknown, path: string): TokenEntry | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  if (typeof o.symbol !== "string") throw new Error(`${path}.symbol: expected a string`);
  return { address: addr(o.address, `${path}.address`), symbol: o.symbol, decimals: int(o.decimals, `${path}.decimals`, 0, 36) };
}
function poolKey(v: unknown, path: string): PoolKey {
  const o = obj(v, path);
  return {
    currency0: addr(o.currency0, `${path}.currency0`),
    currency1: addr(o.currency1, `${path}.currency1`),
    fee: int(o.fee, `${path}.fee`, 0, DYNAMIC_FEE_FLAG),
    tickSpacing: int(o.tickSpacing, `${path}.tickSpacing`, 1, 32767),
    hooks: addr(o.hooks, `${path}.hooks`),
  };
}

function pool(v: unknown, name: PoolName, tETH: TokenEntry | null, tUSD: TokenEntry | null, hooks: Record<PairName, Address | null>): PoolEntry | null {
  if (v === null || v === undefined) return null;
  const path = `pools.${name}`;
  const o = obj(v, path);
  const key = poolKey(o.key, `${path}.key`);
  if (typeof o.poolId !== "string" || o.poolId.toLowerCase() !== poolIdFromKey(key)) {
    throw new Error(`${path}.poolId does not match keccak256(abi.encode(key)) = ${poolIdFromKey(key)}`);
  }
  if (typeof o.token0IsEth !== "boolean") throw new Error(`${path}.token0IsEth: expected a boolean`);
  if (BigInt(key.currency0) >= BigInt(key.currency1)) throw new Error(`${path}.key: currencies must be sorted (currency0 < currency1)`);
  if (tETH && tUSD) {
    const pairSet = [tETH.address, tUSD.address].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    if (key.currency0 !== pairSet[0] || key.currency1 !== pairSet[1]) throw new Error(`${path}.key: currencies must be tokens.tETH and tokens.tUSD`);
    if (o.token0IsEth !== (key.currency0 === tETH.address)) {
      throw new Error(`${path}.token0IsEth is ${o.token0IsEth} but currency0 ${key.currency0 === tETH.address ? "is" : "is not"} tETH`);
    }
  }
  const pair: PairName = name.startsWith("live") ? "live" : "replay";
  if (name.endsWith("V")) {
    if (key.fee !== DYNAMIC_FEE_FLAG) throw new Error(`${path}.key.fee must be the dynamic fee flag 0x800000`);
    if (key.hooks !== hooks[pair]) throw new Error(`${path}.key.hooks must equal hooks.${pair}`);
  } else {
    if (key.fee >= DYNAMIC_FEE_FLAG) throw new Error(`${path}.key.fee must be a static fee (< 0x800000)`);
    if (key.hooks !== zeroAddress) throw new Error(`${path}.key.hooks must be the zero address`);
  }
  return { key, poolId: poolIdFromKey(key), token0IsEth: o.token0IsEth };
}

export function parseDeployments(raw: unknown): Deployments {
  const o = obj(raw, "deployments");
  const chainId = int(o.chainId, "chainId", 1, Number.MAX_SAFE_INTEGER);
  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`chainId must be ${SEPOLIA_CHAIN_ID}, got ${chainId}`);
  const u = obj(o.uniswap, "uniswap");
  const c = obj(o.cre, "cre");
  const t = obj(o.tokens, "tokens");
  const rd = obj(o.riskDesks, "riskDesks");
  const h = obj(o.hooks, "hooks");
  const p = obj(o.pools, "pools");
  const r = optObj(o.routers, "routers");
  const tETH = token(t.tETH, "tokens.tETH");
  const tUSD = token(t.tUSD, "tokens.tUSD");
  const hooks = { live: addrOrNull(h.live, "hooks.live"), replay: addrOrNull(h.replay, "hooks.replay") };
  return {
    chainId,
    deployBlock: o.deployBlock === null || o.deployBlock === undefined ? null : int(o.deployBlock, "deployBlock", 0, Number.MAX_SAFE_INTEGER),
    uniswap: {
      poolManager: addr(u.poolManager, "uniswap.poolManager"),
      stateView: addr(u.stateView, "uniswap.stateView"),
      poolSwapTest: addr(u.poolSwapTest, "uniswap.poolSwapTest"),
      poolModifyLiquidityTest: addr(u.poolModifyLiquidityTest, "uniswap.poolModifyLiquidityTest"),
    },
    cre: { mockForwarder: addr(c.mockForwarder, "cre.mockForwarder"), keystoneForwarder: addr(c.keystoneForwarder, "cre.keystoneForwarder") },
    tokens: { tETH, tUSD },
    riskDesks: {
      live: addrOrNull(rd.live, "riskDesks.live"),
      replay: addrOrNull(rd.replay, "riskDesks.replay"),
      don: addrOrNull(rd.don, "riskDesks.don"),
    },
    hooks,
    pools: {
      liveV: pool(p.liveV, "liveV", tETH, tUSD, hooks),
      liveS: pool(p.liveS, "liveS", tETH, tUSD, hooks),
      replayV: pool(p.replayV, "replayV", tETH, tUSD, hooks),
      replayS: pool(p.replayS, "replayS", tETH, tUSD, hooks),
    },
    routers: { arb: addrOrNull(r.arb, "routers.arb") },
  };
}

export function parseParams(raw: unknown): ClimParams {
  const o = obj(raw, "params");
  if (typeof o.pStar !== "number" || !(o.pStar > 0 && o.pStar < 1)) throw new Error(`params.pStar must be in (0, 1)`);
  const etaE4 = int(o.etaE4, "params.etaE4", 1, 0xffffffff);
  if (Math.abs(etaE4 - etaE4FromPStar(o.pStar)) > 1) {
    throw new Error(`params.etaE4 ${etaE4} does not match pStar ${o.pStar} (expected ${etaE4FromPStar(o.pStar)})`);
  }
  // Same bounds as the ClimHook constructor (spec 3.6): 0 < feeMin <= feeSafe <= feeMax <= 1e6.
  const feeMinPips = int(o.feeMinPips, "params.feeMinPips", 1, PIPS_DENOMINATOR);
  const feeSafePips = int(o.feeSafePips, "params.feeSafePips", feeMinPips, PIPS_DENOMINATOR);
  const feeMaxPips = int(o.feeMaxPips, "params.feeMaxPips", feeSafePips, PIPS_DENOMINATOR);
  if (typeof o.decidedBy !== "string" || o.decidedBy.length === 0) throw new Error(`params.decidedBy must be a non-empty string`);
  return {
    pStar: o.pStar,
    etaE4,
    sqrtHalfDtE6: int(o.sqrtHalfDtE6, "params.sqrtHalfDtE6", 1, 0xffffffff),
    feeMinPips,
    feeMaxPips,
    feeSafePips,
    tauKillSec: int(o.tauKillSec, "params.tauKillSec", 1, 0xffffffff),
    decidedBy: o.decidedBy,
  };
}

/** True while shared/params.json is not a lab decision (the PROVISIONAL bootstrap or a FIXTURE). Never deploy a hook from it. */
export function isProvisional(p: ClimParams): boolean {
  return p.decidedBy.startsWith("PROVISIONAL") || p.decidedBy.startsWith("FIXTURE");
}

export function loadDeployments(): Deployments {
  return parseDeployments(deploymentsJson);
}

export function loadParams(): ClimParams {
  return parseParams(paramsJson);
}

export function resolvePair(d: Deployments, pair: PairName): ResolvedPair {
  return {
    pair,
    V: requireValue(d.pools[`${pair}V`], `pools.${pair}V`),
    S: requireValue(d.pools[`${pair}S`], `pools.${pair}S`),
    hook: requireValue(d.hooks[pair], `hooks.${pair}`),
    desk: requireValue(d.riskDesks[pair], `riskDesks.${pair}`),
    tETH: requireValue(d.tokens.tETH, "tokens.tETH"),
    tUSD: requireValue(d.tokens.tUSD, "tokens.tUSD"),
  };
}

/** The router the arbitrage bot swaps through: routers.arb when deployed, else the shared PoolSwapTest. */
export function arbRouter(d: Deployments): Address {
  return d.routers.arb ?? d.uniswap.poolSwapTest;
}

export function orientationOf(pool: PoolEntry, d: Deployments): PairOrientation {
  const eth = requireValue(d.tokens.tETH, "tokens.tETH");
  const usd = requireValue(d.tokens.tUSD, "tokens.tUSD");
  return pool.token0IsEth
    ? { token0IsEth: true, decimals0: eth.decimals, decimals1: usd.decimals }
    : { token0IsEth: false, decimals0: usd.decimals, decimals1: eth.decimals };
}
