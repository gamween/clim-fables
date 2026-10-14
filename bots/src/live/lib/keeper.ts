// Keeper-style twin (pool K), pure helpers. The fee map is shared/keeper-map-fables.json (lab/scripts/
// export_keeper_map.py): the median fee Fables' keeper posted by 5-minute volatility bin. An imitation of the observed
// pattern, not Fables' code.
import { SECONDS_PER_YEAR } from "@clim/shared";
import type { Rand } from "../../lib/rng";

export type KeeperMap = {
  edgesPctYr: number[]; // bin i is [edge i, edge i+1); the last bin is open-ended
  feePips: number[];
  clampPips: [number, number];
  postEverySec: number;
  ttlSec: number;
};

function numbers(v: unknown, what: string): number[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    throw new Error(`keeper map: ${what} must be an array of numbers`);
  }
  return v as number[];
}

export function parseKeeperMap(raw: unknown): KeeperMap {
  if (typeof raw !== "object" || raw === null) throw new Error("keeper map: not an object");
  const o = raw as Record<string, unknown>;
  const edges = numbers(o.edgesPctYr, "edgesPctYr");
  const fees = numbers(o.feePips, "feePips");
  const clamp = numbers(o.clampPips, "clampPips");
  if (edges.length === 0 || edges.length !== fees.length) throw new Error("keeper map: edgesPctYr and feePips must have the same, non-zero length");
  for (let i = 1; i < edges.length; i++) {
    if ((edges[i] ?? 0) <= (edges[i - 1] ?? 0)) throw new Error("keeper map: edgesPctYr must increase");
  }
  const [lo, hi] = clamp;
  if (clamp.length !== 2 || lo === undefined || hi === undefined || lo > hi) throw new Error("keeper map: clampPips must be [low, high]");
  const every = o.postEverySec;
  const ttl = o.ttlSec;
  if (typeof every !== "number" || every <= 0 || typeof ttl !== "number" || ttl <= 0) {
    throw new Error("keeper map: postEverySec and ttlSec must be positive numbers");
  }
  return { edgesPctYr: edges, feePips: fees, clampPips: [lo, hi], postEverySec: every, ttlSec: ttl };
}

/** The keeper-style fee (pips) for a volatility per sqrt second: the fee of its bin, clamped. */
export function keeperFeePips(map: KeeperMap, sigmaPerSqrtSec: number): number {
  const pct = sigmaPerSqrtSec * Math.sqrt(SECONDS_PER_YEAR) * 100;
  let fee = map.feePips[0] ?? map.clampPips[0];
  map.edgesPctYr.forEach((edge, i) => {
    if (pct >= edge) fee = map.feePips[i] ?? fee;
  });
  return Math.max(map.clampPips[0], Math.min(map.clampPips[1], Math.round(fee)));
}

/** Realized volatility per sqrt second over windowSec from Binance 1 s klines ([openMs, o, h, l, close, ...] rows):
 *  5 s returns ending at the last closed second, a missing second keeping the previous close (the lab's rv_window). */
export function rv5From1s(rows: unknown, nowSec: number, windowSec = 300, stepSec = 5, maxAgeSec = 10): number {
  if (!Array.isArray(rows)) throw new Error("binance 1s: not an array");
  const closes: Array<{ t: number; close: number }> = [];
  for (const r of rows) {
    if (!Array.isArray(r)) throw new Error("binance 1s: bad row");
    const t = Number(r[0]) / 1000;
    const close = Number(r[4]);
    if (Number.isFinite(t) && close > 0 && t + 1 <= nowSec) closes.push({ t, close });
  }
  closes.sort((a, b) => a.t - b.t);
  const first0 = closes[0];
  const last = closes[closes.length - 1];
  if (first0 === undefined || last === undefined) throw new Error("binance 1s: no closed second");
  if (nowSec - (last.t + 1) > maxAgeSec) throw new Error(`binance 1s: last second closed ${nowSec - last.t - 1} s ago`);
  const first = last.t - windowSec;
  if (first0.t > first) throw new Error("binance 1s: not enough history");
  let j = 0;
  let px = Number.NaN;
  let prev = Number.NaN;
  let ss = 0;
  for (let k = 0; k <= windowSec / stepSec; k++) {
    const target = first + k * stepSec;
    for (let c = closes[j]; c !== undefined && c.t <= target; c = closes[++j]) px = c.close;
    if (k > 0) {
      const r = Math.log(px / prev);
      ss += r * r;
    }
    prev = px;
  }
  return Math.sqrt(ss / windowSec);
}

/** Next post: postEverySec later, +- jitterSec of seeded jitter (Fables' keeper posted every 179 s at the median). */
export function nextPostAt(fromSec: number, everySec: number, rand: Rand, jitterSec = 10): number {
  return fromSec + everySec + Math.round((rand() * 2 - 1) * jitterSec);
}
