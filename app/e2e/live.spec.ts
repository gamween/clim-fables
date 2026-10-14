// The headless live check: each route at 1470 px, every number marked [data-live] re-read from the chain at the block
// the page read it (or over the same blocks for a window statistic), compared raw and as shown. Window statistics
// first come from the server's cached history (app/api/history, data-source="cache", built at data-cache-block), then
// from that history topped up by the browser ("cache+chain"): both states are checked. The cached histories themselves
// are read back against the chain at the block they were built at. Run against the local build (`npm run check:live`)
// or a deployment (`BASE_URL=https://clim-fables.vercel.app npm run check:live`).
import { expect, test, type Page } from "@playwright/test";
import { blockTime } from "../src/lib/chain/blockTimes";
import { decodeHistory } from "../src/lib/chain/historyJson";
import { SERIES, type SeriesDef } from "../src/lib/chain/series";
import { liveText } from "../src/lib/liveKeys";
import { EXPECTED } from "./expected";
import { mainnet, resolve, testnet, type LiveElement } from "./resolvers";
import { CACHED_SERIES, warmCache } from "./warm";

test.beforeAll(async ({ request }) => {
  test.setTimeout(900_000);
  await warmCache(request);
});

async function liveElements(page: Page): Promise<LiveElement[]> {
  return page.$$eval("[data-live]", (els) =>
    els.map((el) => {
      const d = (el as HTMLElement).dataset;
      return { key: d.live ?? "", chain: d.chain ?? "", block: d.block ?? "", raw: d.raw ?? "", text: (el.textContent ?? "").trim(), fromBlock: d.fromBlock, toBlock: d.toBlock, fromTs: d.fromTs, toTs: d.toTs, source: d.source, cacheBlock: d.cacheBlock };
    }),
  );
}

async function verify(elements: LiveElement[], label: string): Promise<number> {
  const seen = new Set<string>();
  for (const e of elements) {
    const id = `${e.key}@${e.block}:${e.fromBlock ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const chainRaw = await resolve(e);
    const where = e.source ? ` (${e.source}${e.cacheBlock ? `, cache built at block ${e.cacheBlock}` : ""})` : "";
    expect.soft(e.raw, `${label}: ${e.key} at block ${e.block}${where}`).toBe(chainRaw);
    expect.soft(e.text, `${label}: ${e.key} as shown`).toBe(liveText(e.key, chainRaw));
  }
  return seen.size;
}

for (const [route, keys] of Object.entries(EXPECTED)) {
  test(`live numbers on ${route} match the chain`, async ({ page }) => {
    await page.goto(route);
    // The first complete set of numbers, as a visitor first sees it (window statistics from the cache).
    let first: LiveElement[] = [];
    await expect
      .poll(
        async () => {
          first = await liveElements(page);
          const shown = new Set(first.map((e) => e.key));
          return keys.filter((k) => !shown.has(k));
        },
        { timeout: 150_000, intervals: [100] },
      )
      .toEqual([]);
    const ranged = first.filter((e) => e.fromBlock !== undefined);
    // Every window statistic started from the server's cache: it names the block that cache was built at.
    for (const e of ranged) expect.soft(e.cacheBlock, `${e.key} came from the cached history`).toBeDefined();
    const n1 = await verify(first, "first paint");
    let n2 = 0;
    if (ranged.length > 0) {
      // Then the same statistics once the browser has topped the cached history up from the chain.
      let later: LiveElement[] = [];
      await expect
        .poll(
          async () => {
            later = (await liveElements(page)).filter((e) => e.fromBlock !== undefined);
            return later.length > 0 && later.every((e) => e.source === "cache+chain");
          },
          { timeout: 90_000, intervals: [1_000] },
        )
        .toBe(true);
      n2 = await verify(later, "after the top-up");
    }
    const sources = [...new Set(ranged.map((e) => `${e.key.split(":").at(-1)} ${e.source} at ${e.cacheBlock}`))];
    test.info().annotations.push({ type: "checked", description: `${n1} live values at first paint, ${n2} after the top-up on ${route}${sources.length ? `; first paint: ${sources.join(", ")}` : ""}` });
  });
}

test("cached histories match the chain at the block they were built at", async ({ request }) => {
  for (const key of CACHED_SERIES) {
    const res = await request.get(`/api/history/${key}`);
    expect(res.status(), key).toBe(200);
    const { history: h, builtAt } = decodeHistory<{ block: bigint }>(await res.json());
    const def = SERIES[key] as unknown as SeriesDef<{ block: bigint }>;
    const client = def.chain === "mainnet" ? mainnet : testnet;
    expect(h.cacheBlock, key).toBe(h.toBlock);
    expect(h.windowSec, key).toBe(def.windowSec);
    // The window's end is the header of the block the cache was built at, its start the first block at or after
    // end - window - lookback.
    const target = h.toTs - def.windowSec - def.lookbackSec;
    expect(await blockTime(client, h.toBlock), `${key} toTs`).toBe(h.toTs);
    expect(await blockTime(client, h.fromBlock), `${key} first block`).toBeGreaterThanOrEqual(target);
    expect(await blockTime(client, h.fromBlock - 1n), `${key} block before the first`).toBeLessThan(target);
    // Every log of [fromBlock, toBlock], read again from the chain.
    const fresh = await def.read(client, h.fromBlock, h.toBlock);
    expect.soft(JSON.stringify(h.items, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), `${key} items`).toBe(JSON.stringify(fresh, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    test.info().annotations.push({ type: "cache", description: `${key}: ${h.items.length} logs, blocks ${h.fromBlock} to ${h.toBlock} (built at block ${h.cacheBlock}, ${Math.round((Date.now() - builtAt) / 1000)} s ago)` });
  }
});
