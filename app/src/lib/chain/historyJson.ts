// A log history as JSON, for the server's cache (app/api/history) and the browser that seeds itself from it. Bigints
// (block numbers, amounts) travel as {"$bigint": "<decimal>"}.
import type { History } from "./history";

export type CachedHistoryJson = { builtAt: number; history: unknown };

const toJson = (v: unknown): unknown => {
  if (typeof v === "bigint") return { $bigint: v.toString() };
  if (Array.isArray(v)) return v.map(toJson);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toJson(x)]));
  return v;
};

const fromJson = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(fromJson);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$bigint === "string" && Object.keys(o).length === 1) return BigInt(o.$bigint);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fromJson(x)]));
  }
  return v;
};

/** The server's history, stamped with the block it was built at (its head, `toBlock`) and the time it was built. */
export function encodeHistory<T>(h: History<T>, o: { builtAt: number }): CachedHistoryJson {
  return { builtAt: o.builtAt, history: toJson({ ...h, cacheBlock: h.toBlock }) };
}

export function decodeHistory<T>(body: unknown): { builtAt: number; history: History<T> } {
  const b = body as Partial<CachedHistoryJson> | null;
  const h = (b && typeof b === "object" ? fromJson(b.history) : null) as History<T> | null;
  if (
    !b ||
    typeof b.builtAt !== "number" ||
    !h ||
    !Array.isArray(h.items) ||
    typeof h.fromBlock !== "bigint" ||
    typeof h.toBlock !== "bigint" ||
    typeof h.cacheBlock !== "bigint" ||
    typeof h.toTs !== "number" ||
    typeof h.windowSec !== "number"
  ) {
    throw new Error("not a cached history");
  }
  return { builtAt: b.builtAt, history: h };
}
