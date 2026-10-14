// Typed, validated loader for shared/deployments/robinhood-testnet.json, written by
// contracts/script/v2/14_LiveWriteDeployments.s.sol: clim's live reference stack on Robinhood Chain testnet.
// Runtime-agnostic (the bots load the file and pass it in; plan 04's app parses it the same way).
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { DYNAMIC_FEE_FLAG, poolIdFromKey, type PoolKey, type TokenEntry } from "./config";
import type { PairOrientation } from "./price";

export const RH_TESTNET_CHAIN_ID = 46630;
export const LIVE_POOLS = ["D", "K", "F"] as const;
export type LivePoolName = (typeof LIVE_POOLS)[number];
export type LivePool = { name: LivePoolName; key: PoolKey; poolId: Hex; token0IsEth: boolean; driver: string };

export type LiveDeployments = {
  chainId: number;
  deployBlock: number;
  deployer: Address;
  uniswap: { poolManager: Address; stateView: Address; poolSwapTest: Address; poolModifyLiquidityTest: Address };
  routers: { arb: Address };
  cre: { mockForwarder: Address; keystoneForwarder: Address; simOperator: Address };
  accessManager: Address;
  roles: { feePoker: number; climRunner: number; runner: Address; keeper: Address };
  tokens: { tETH: TokenEntry; tUSDG: TokenEntry };
  hook: Address;
  hookConfig: { floorPips: number; flatPips: number; capPips: number };
  riskDesk: Address;
  policy: Address;
  poker: Address;
  pools: Record<LivePoolName, LivePool>;
  liquidity: bigint;
  initEthUsd: number;
};

type Json = Record<string, unknown>;

function jobj(v: unknown, path: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${path}: expected an object`);
  return v as Json;
}
function jaddr(v: unknown, path: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new Error(`${path}: expected an address, got ${String(v)}`);
  return getAddress(v);
}
function jint(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${path}: expected an integer in [${min}, ${max}], got ${String(v)}`);
  }
  return v;
}
function jtoken(v: unknown, path: string, decimals: number): TokenEntry {
  const o = jobj(v, path);
  if (typeof o.symbol !== "string") throw new Error(`${path}.symbol: expected a string`);
  return { address: jaddr(o.address, `${path}.address`), symbol: o.symbol, decimals: jint(o.decimals, `${path}.decimals`, decimals, decimals) };
}

function jpool(v: unknown, name: LivePoolName, hook: Address, tETH: TokenEntry, tUSDG: TokenEntry): LivePool {
  const path = `pools.${name}`;
  const o = jobj(v, path);
  const k = jobj(o.key, `${path}.key`);
  const key: PoolKey = {
    currency0: jaddr(k.currency0, `${path}.key.currency0`),
    currency1: jaddr(k.currency1, `${path}.key.currency1`),
    fee: jint(k.fee, `${path}.key.fee`, 0, DYNAMIC_FEE_FLAG),
    tickSpacing: jint(k.tickSpacing, `${path}.key.tickSpacing`, 1, 32767),
    hooks: jaddr(k.hooks, `${path}.key.hooks`),
  };
  if (typeof o.poolId !== "string" || o.poolId.toLowerCase() !== poolIdFromKey(key)) {
    throw new Error(`${path}.poolId does not match keccak256(abi.encode(key)) = ${poolIdFromKey(key)}`);
  }
  if (key.fee !== DYNAMIC_FEE_FLAG) throw new Error(`${path}.key.fee must be the dynamic fee flag 0x800000`);
  if (key.hooks !== hook) throw new Error(`${path}.key.hooks must be the hook ${hook}`);
  const pair = [tETH.address, tUSDG.address].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  if (key.currency0 !== pair[0] || key.currency1 !== pair[1]) throw new Error(`${path}.key: currencies must be tETH and tUSDG, sorted`);
  if (o.token0IsEth !== (key.currency0 === tETH.address)) throw new Error(`${path}.token0IsEth does not match the token order`);
  if (typeof o.driver !== "string") throw new Error(`${path}.driver: expected a string`);
  return { name, key, poolId: poolIdFromKey(key), token0IsEth: o.token0IsEth as boolean, driver: o.driver };
}

export function parseLiveDeployments(raw: unknown, allowedChainIds: readonly number[] = [RH_TESTNET_CHAIN_ID]): LiveDeployments {
  const o = jobj(raw, "deployments");
  const chainId = jint(o.chainId, "chainId", 1, Number.MAX_SAFE_INTEGER);
  if (!allowedChainIds.includes(chainId)) throw new Error(`chainId must be one of ${allowedChainIds.join(", ")}, got ${chainId}`);
  const u = jobj(o.uniswap, "uniswap");
  const c = jobj(o.cre, "cre");
  const r = jobj(o.roles, "roles");
  const t = jobj(o.tokens, "tokens");
  const hc = jobj(o.hookConfig, "hookConfig");
  const tETH = jtoken(t.tETH, "tokens.tETH", 18);
  const tUSDG = jtoken(t.tUSDG, "tokens.tUSDG", 6);
  const hook = jaddr(o.hook, "hook");
  const p = jobj(o.pools, "pools");
  const pools = {
    D: jpool(p.D, "D", hook, tETH, tUSDG),
    K: jpool(p.K, "K", hook, tETH, tUSDG),
    F: jpool(p.F, "F", hook, tETH, tUSDG),
  };
  if (new Set(LIVE_POOLS.map((n) => pools[n].poolId)).size !== 3) throw new Error("pools: D, K and F must be three pools");
  if (typeof o.liquidity !== "string" || !/^[0-9]+$/.test(o.liquidity)) throw new Error("liquidity: expected a decimal string");
  return {
    chainId,
    deployBlock: jint(o.deployBlock, "deployBlock", 0, Number.MAX_SAFE_INTEGER),
    deployer: jaddr(o.deployer, "deployer"),
    uniswap: {
      poolManager: jaddr(u.poolManager, "uniswap.poolManager"),
      stateView: jaddr(u.stateView, "uniswap.stateView"),
      poolSwapTest: jaddr(u.poolSwapTest, "uniswap.poolSwapTest"),
      poolModifyLiquidityTest: jaddr(u.poolModifyLiquidityTest, "uniswap.poolModifyLiquidityTest"),
    },
    routers: { arb: jaddr(jobj(o.routers, "routers").arb, "routers.arb") },
    cre: {
      mockForwarder: jaddr(c.mockForwarder, "cre.mockForwarder"),
      keystoneForwarder: jaddr(c.keystoneForwarder, "cre.keystoneForwarder"),
      simOperator: jaddr(c.simOperator, "cre.simOperator"),
    },
    accessManager: jaddr(o.accessManager, "accessManager"),
    roles: {
      feePoker: jint(r.feePoker, "roles.feePoker", 0, Number.MAX_SAFE_INTEGER),
      climRunner: jint(r.climRunner, "roles.climRunner", 0, Number.MAX_SAFE_INTEGER),
      runner: jaddr(r.runner, "roles.runner"),
      keeper: jaddr(r.keeper, "roles.keeper"),
    },
    tokens: { tETH, tUSDG },
    hook,
    hookConfig: {
      floorPips: jint(hc.floorPips, "hookConfig.floorPips", 1, 1_000_000),
      flatPips: jint(hc.flatPips, "hookConfig.flatPips", 1, 1_000_000),
      capPips: jint(hc.capPips, "hookConfig.capPips", 1, 1_000_000),
    },
    riskDesk: jaddr(o.riskDesk, "riskDesk"),
    policy: jaddr(o.policy, "policy"),
    poker: jaddr(o.poker, "poker"),
    pools,
    liquidity: BigInt(o.liquidity),
    initEthUsd: jint(o.initEthUsd, "initEthUsd", 1, 1_000_000_000),
  };
}

/** How a live pool's token0/token1 map to ETH/USD, for the price helpers in ./price. */
export function liveOrientation(d: LiveDeployments, pool: LivePool): PairOrientation {
  return pool.token0IsEth
    ? { token0IsEth: true, decimals0: d.tokens.tETH.decimals, decimals1: d.tokens.tUSDG.decimals }
    : { token0IsEth: false, decimals0: d.tokens.tUSDG.decimals, decimals1: d.tokens.tETH.decimals };
}
