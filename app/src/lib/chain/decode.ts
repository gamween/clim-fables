import { ethUsdFromSqrtPriceX96, type PairOrientation } from "@clim/shared";
import type { Hex } from "viem";
import type { ClimPoint, PokeEvent } from "@/lib/fees";

/** What every decoded log carries. Its time comes from its block header (lib/chain/blockTimes.ts) or, for clim's own
 *  events, from the observation time they carry (tObs). */
type Meta = { blockNumber: bigint | null; logIndex: number | null; transactionHash: Hex | null };

function meta(l: Meta) {
  if (l.blockNumber === null || l.logIndex === null || l.transactionHash === null) throw new Error("pending log");
  return { block: l.blockNumber, logIndex: l.logIndex, tx: l.transactionHash };
}

export function pokeFromSingle(l: Meta & { args: { fee?: number; expiry?: number } }, t: number): PokeEvent {
  const m = meta(l);
  if (l.args.fee === undefined || l.args.expiry === undefined) throw new Error("FeePoked without its fields");
  return { kind: "poke", t, block: m.block, logIndex: m.logIndex, tx: m.tx, fee0For1: l.args.fee, fee1For0: l.args.fee, expiry: l.args.expiry };
}

export function pokeFromDirectional(l: Meta & { args: { fee0For1?: number; fee1For0?: number; expiry?: number } }, t: number): PokeEvent {
  const m = meta(l);
  const { fee0For1, fee1For0, expiry } = l.args;
  if (fee0For1 === undefined || fee1For0 === undefined || expiry === undefined) throw new Error("FeePoked without its fields");
  return { kind: "poke", t, block: m.block, logIndex: m.logIndex, tx: m.tx, fee0For1, fee1For0, expiry };
}

export function clearFrom(l: Meta, t: number): PokeEvent {
  const m = meta(l);
  return { kind: "clear", t, block: m.block, logIndex: m.logIndex, tx: m.tx };
}

/** ClimPoker's Poked log: clim's fee per side at report `seq`, placed at the report's observation time. */
export function climPointFrom(l: Meta & { args: { seq?: number; tObs?: number; fee0For1?: number; fee1For0?: number; mode?: number; eventApplied?: boolean; expiry?: number } }): ClimPoint {
  const m = meta(l);
  const { seq, tObs, fee0For1, fee1For0, mode, eventApplied, expiry } = l.args;
  if (seq === undefined || tObs === undefined || fee0For1 === undefined || fee1For0 === undefined || mode === undefined || eventApplied === undefined || expiry === undefined) {
    throw new Error("Poked without its fields");
  }
  return { t: tObs, block: m.block, logIndex: m.logIndex, seq, fee0For1, fee1For0, mode, eventApplied, expiry, tx: m.tx };
}

export type DeskReport = { t: number; tx: Hex; block: bigint; seq: number; tObs: number; sigma15E9: number; sigma5E9: number; devPips: number; nSources: number; flags: number };

/** A desk report, placed at its observation time. */
export function reportFrom(l: Meta & { args: { seq?: number; tObs?: number; sigma15Applied?: number; sigma5Applied?: number; devPips?: number; nSources?: number; flags?: number } }): DeskReport {
  const m = meta(l);
  const a = l.args;
  if (a.seq === undefined || a.tObs === undefined || a.sigma15Applied === undefined || a.sigma5Applied === undefined || a.devPips === undefined || a.nSources === undefined || a.flags === undefined) {
    throw new Error("RiskReportedV2 without its fields");
  }
  return { t: a.tObs, tx: m.tx, block: m.block, seq: a.seq, tObs: a.tObs, sigma15E9: a.sigma15Applied, sigma5E9: a.sigma5Applied, devPips: a.devPips, nSources: a.nSources, flags: a.flags };
}

/** A swap from the swapper's side: Uniswap v4's Swap amounts are the swapper's deltas (negative = paid into the pool).
 *  `t` is read later, only for the rows a table shows. */
export type SwapRow = { tx: Hex; block: bigint; logIndex: number; side: "buy" | "sell"; eth: number; usdg: number; feePips: number; price: number };

export function swapFrom(l: Meta & { args: { amount0?: bigint; amount1?: bigint; fee?: number; sqrtPriceX96?: bigint } }, o: PairOrientation): SwapRow {
  const m = meta(l);
  const { amount0, amount1, fee, sqrtPriceX96 } = l.args;
  if (amount0 === undefined || amount1 === undefined || fee === undefined || sqrtPriceX96 === undefined) throw new Error("Swap without its fields");
  if (!o.token0IsEth) throw new Error("the app's pools all have ETH as currency0");
  const abs = (x: bigint) => (x < 0n ? -x : x);
  return {
    tx: m.tx,
    block: m.block,
    logIndex: m.logIndex,
    side: amount0 > 0n ? "buy" : "sell",
    eth: Number(abs(amount0)) / 10 ** o.decimals0,
    usdg: Number(abs(amount1)) / 10 ** o.decimals1,
    feePips: fee,
    price: ethUsdFromSqrtPriceX96(sqrtPriceX96, o),
  };
}

/** Pool D's overrides as ClimPoker posted them: the Poked log is emitted in the same transaction as the hook's
 *  FeePoked, with the same fees and expiry, and carries the report's observation time. */
export function pokeFromClimPoint(p: ClimPoint): PokeEvent {
  return { kind: "poke", t: p.t, block: p.block, logIndex: p.logIndex, tx: p.tx, fee0For1: p.fee0For1, fee1For0: p.fee1For0, expiry: p.expiry };
}
