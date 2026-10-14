// Reads every cached history once (app/api/history), so a check sees the server's cache as a visitor does in steady
// state (the CDN serves a stale copy while it fetches the next), not the server's first read after a deploy.
import type { APIRequestContext } from "@playwright/test";
import { SERIES, type SeriesKey } from "../src/lib/chain/series";

export const CACHED_SERIES = (Object.keys(SERIES) as SeriesKey[]).filter((k) => SERIES[k].cached !== false);

export async function warmCache(request: APIRequestContext): Promise<string[]> {
  const lines: string[] = [];
  for (const key of CACHED_SERIES) {
    const t0 = Date.now();
    const res = await request.get(`/api/history/${key}`, { timeout: 300_000 });
    const hit = res.headers()["x-vercel-cache"];
    lines.push(`cache ${key}: HTTP ${res.status()} in ${Date.now() - t0} ms${hit ? ` (${hit})` : ""}`);
  }
  return lines;
}
