// Unit conventions shared by contracts (ClimFeeMath / ClimHook), the CRE risk desk, the bots and the app.
// Runtime-agnostic: no Bun or Node APIs here (the CRE workflow may import this file; plan 05 ports it to the app).

export const SECONDS_PER_YEAR = 31_536_000;
export const PIPS_PER_BP = 100;
/** Uniswap v4 LP fee unit: 1_000_000 pips = 100 %. */
export const PIPS_DENOMINATOR = 1_000_000;
/** |zeta(1/2)| / sqrt(pi), rounded as in the design: P_trade = 1 / (eta + 0.824) for fixed-interval blocks. */
export const NT_FIXED_BLOCK_CONST = 0.824;
/** sigmaE9 (1e9) * etaE4 (1e4) * sqrtHalfDtE6 (1e6) * kE4 (1e4) = 1e23 scale; pips are 1e-6, so divide by 1e17. */
export const FEE_SCALE = 10n ** 17n;

export const FLAG_DEGRADED = 1;
export const FLAG_REPLAY = 2;

export const FeeMode = { Normal: 0, Degraded: 1, Blind: 2 } as const;
export type FeeModeValue = (typeof FeeMode)[keyof typeof FeeMode];

/** On-chain RiskDesk.state() as read by viem (all fields fit in a JS number). */
export type DeskState = { tObs: number; sigmaE9: number; kE4: number; flags: number; seq: number };

/** Immutable ClimHook constructor parameters (the subset of shared/params.json the hook uses). */
export type HookParams = {
  etaE4: number;
  sqrtHalfDtE6: number;
  feeMinPips: number;
  feeMaxPips: number;
  feeSafePips: number;
  tauKillSec: number;
};

function assertUint(name: string, v: number, max: number): void {
  if (!Number.isInteger(v) || v < 0 || v > max) {
    throw new RangeError(`${name} must be an integer in [0, ${max}], got ${v}`);
  }
}

/** Annual volatility (0.48 = 48 %/yr) -> sigmaE9 = per-sqrt-second volatility * 1e9, rounded to nearest. */
export function annualSigmaToSigmaE9(sigmaAnnual: number): number {
  if (!Number.isFinite(sigmaAnnual) || sigmaAnnual < 0) {
    throw new RangeError(`sigmaAnnual must be finite and >= 0, got ${sigmaAnnual}`);
  }
  return Math.round((sigmaAnnual / Math.sqrt(SECONDS_PER_YEAR)) * 1e9);
}

/** sigmaE9 -> annual volatility (fraction, 0.48 = 48 %/yr). */
export function sigmaE9ToAnnual(sigmaE9: number): number {
  return (sigmaE9 / 1e9) * Math.sqrt(SECONDS_PER_YEAR);
}

export function pipsToBp(pips: number): number {
  return pips / PIPS_PER_BP;
}

export function bpToPips(bp: number): number {
  return Math.round(bp * PIPS_PER_BP);
}

/** Fee in pips -> fraction of the input amount (500 pips -> 0.0005). */
export function pipsToFraction(pips: number): number {
  return pips / PIPS_DENOMINATOR;
}

/** eta = 1/P* - 0.824 (Nezlobin-Tassy 2025 fixed-block correction of MMR 2023). */
export function etaFromPStar(pStar: number): number {
  if (!(pStar > 0 && pStar < 1)) throw new RangeError(`pStar must be in (0, 1), got ${pStar}`);
  return 1 / pStar - NT_FIXED_BLOCK_CONST;
}

export function etaE4FromPStar(pStar: number): number {
  return Math.round(etaFromPStar(pStar) * 1e4);
}

/** Predicted share of arbitraged blocks for a given etaE4 (above the floor, below the cap). */
export function pTradeFromEtaE4(etaE4: number): number {
  return 1 / (etaE4 / 1e4 + NT_FIXED_BLOCK_CONST);
}

export function sqrtHalfDtE6FromBlockTime(blockTimeSec: number): number {
  return Math.round(Math.sqrt(blockTimeSec / 2) * 1e6);
}

/**
 * Mirror of ClimFeeMath.feePips:
 * clamp(ceil(sigmaE9 * etaE4 * sqrtHalfDtE6 * kE4 / 1e17), feeMinPips, feeMaxPips).
 * Same integer semantics as Solidity (bigint, round up once, then clamp).
 */
export function feePips(
  sigmaE9: number,
  etaE4: number,
  sqrtHalfDtE6: number,
  kE4: number,
  feeMinPips: number,
  feeMaxPips: number,
): number {
  assertUint("sigmaE9", sigmaE9, 0xffffffff);
  assertUint("etaE4", etaE4, 0xffffffff);
  assertUint("sqrtHalfDtE6", sqrtHalfDtE6, 0xffffffff);
  assertUint("kE4", kE4, 0xffff);
  assertUint("feeMinPips", feeMinPips, PIPS_DENOMINATOR);
  assertUint("feeMaxPips", feeMaxPips, PIPS_DENOMINATOR);
  if (feeMinPips > feeMaxPips) throw new RangeError(`feeMinPips ${feeMinPips} > feeMaxPips ${feeMaxPips}`);
  const num = BigInt(sigmaE9) * BigInt(etaE4) * BigInt(sqrtHalfDtE6) * BigInt(kE4);
  const raw = (num + FEE_SCALE - 1n) / FEE_SCALE;
  if (raw < BigInt(feeMinPips)) return feeMinPips;
  if (raw > BigInt(feeMaxPips)) return feeMaxPips;
  return Number(raw);
}

/**
 * Mirror of ClimHook.quoteFee() at time nowSec (block.timestamp), spec section 3.6:
 * age = max(nowSec - tObs, 0); blind (mode 2) if seq == 0 or age > tauKillSec; else degraded (mode 1) if flag bit 0;
 * blind and degraded both quote max(fee, feeSafePips). Blind wins over degraded.
 */
export function quoteFeeMirror(state: DeskState, p: HookParams, nowSec: number): { fee: number; mode: FeeModeValue } {
  const base = feePips(state.sigmaE9, p.etaE4, p.sqrtHalfDtE6, state.kE4, p.feeMinPips, p.feeMaxPips);
  const age = nowSec > state.tObs ? nowSec - state.tObs : 0;
  if (state.seq === 0 || age > p.tauKillSec) {
    return { fee: Math.max(base, p.feeSafePips), mode: FeeMode.Blind };
  }
  if ((state.flags & FLAG_DEGRADED) !== 0) {
    return { fee: Math.max(base, p.feeSafePips), mode: FeeMode.Degraded };
  }
  return { fee: base, mode: FeeMode.Normal };
}
