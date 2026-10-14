// Uniswap v4 price math: sqrtPriceX96 <-> ETH price in USD, for either token order and any decimals.
// Raw pool price = (sqrtPriceX96 / 2^96)^2 = token1 base units per token0 base unit.
// Runtime-agnostic (imported by the bots; plan 05 ports it to the app).

export const Q96 = 2n ** 96n;
/** TickMath.MIN_SQRT_PRICE / MAX_SQRT_PRICE (v4-core src/libraries/TickMath.sol). */
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

const TWO_POW_96 = 2 ** 96;

/** How a pool's token0/token1 map to ETH/USD. token0IsEth is fixed by address sort order at deployment. */
export type PairOrientation = { token0IsEth: boolean; decimals0: number; decimals1: number };

/** ETH price in USD (human units) from a pool sqrtPriceX96. */
export function ethUsdFromSqrtPriceX96(sqrtPriceX96: bigint, o: PairOrientation): number {
  if (sqrtPriceX96 <= 0n) throw new RangeError("sqrtPriceX96 must be > 0");
  const r = Number(sqrtPriceX96) / TWO_POW_96;
  // human price of token0 in token1 units
  const p01 = r * r * 10 ** (o.decimals0 - o.decimals1);
  return o.token0IsEth ? p01 : 1 / p01;
}

/** sqrtPriceX96 (floored) for a target ETH price in USD (human units). */
export function sqrtPriceX96FromEthUsd(ethUsd: number, o: PairOrientation): bigint {
  if (!Number.isFinite(ethUsd) || ethUsd <= 0) throw new RangeError(`ethUsd must be > 0, got ${ethUsd}`);
  const p01 = o.token0IsEth ? ethUsd : 1 / ethUsd;
  const raw = p01 * 10 ** (o.decimals1 - o.decimals0);
  return BigInt(Math.floor(Math.sqrt(raw) * TWO_POW_96));
}

/** v4 rejects limits outside (MIN_SQRT_PRICE, MAX_SQRT_PRICE); keep any computed limit strictly inside. */
export function clampSqrtPriceLimit(x: bigint): bigint {
  if (x <= MIN_SQRT_PRICE) return MIN_SQRT_PRICE + 1n;
  if (x >= MAX_SQRT_PRICE) return MAX_SQRT_PRICE - 1n;
  return x;
}
