// The server's cached copy of each log history the pages show (lib/chain/series.ts), read from the same public RPCs
// with the same code as the browser, and served as JSON stamped with the block it was built at. The browser shows it
// at once and tops it up from the chain (lib/chain/seed.ts); the live check reads it back against the chain
// (e2e/live.spec.ts). The CDN keeps a response 30 s and serves a stale one while it fetches the next.
import type { History } from "@/lib/chain/history";
import { encodeHistory } from "@/lib/chain/historyJson";
import { isSeriesKey, pollSeries, SERIES, type SeriesDef, type SeriesKey } from "@/lib/chain/series";
import { serverClient } from "@/lib/server/clients";
import { createHistoryCache } from "@/lib/server/historyCache";
import { after } from "next/server";

export const dynamic = "force-dynamic";
// A cold read can wait out the mainnet RPC's rate limit (lib/server/clients.ts).
export const maxDuration = 300;

/** The server tops its copy up in the background when it is older than this. */
const MAX_AGE_MS = 20_000;
const CACHE_CONTROL = "public, max-age=0, s-maxage=30, stale-while-revalidate=86400";

const caches = new Map<SeriesKey, ReturnType<typeof createHistoryCache<{ block: bigint }>>>();

function cacheOf(key: SeriesKey) {
  let c = caches.get(key);
  if (!c) {
    const def = SERIES[key] as SeriesDef<{ block: bigint }>;
    const client = serverClient(def.chain);
    c = createHistoryCache((prev: History<{ block: bigint }> | null) => pollSeries(def, client, prev), { maxAgeMs: MAX_AGE_MS });
    caches.set(key, c);
  }
  return c;
}

export async function GET(_req: Request, ctx: { params: Promise<{ series: string }> }) {
  const { series } = await ctx.params;
  if (!isSeriesKey(series) || SERIES[series].cached === false) return Response.json({ error: `no cached series ${series}` }, { status: 404 });
  try {
    const cache = cacheOf(series);
    const e = await cache.get();
    const refresh = cache.refreshing();
    if (refresh) after(refresh);
    return Response.json(encodeHistory(e.history, { builtAt: e.builtAt }), { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return Response.json({ error: `chain read failed: ${message}` }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
