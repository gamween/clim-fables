// The headless live check: each route at 1470 px, every number marked [data-live] re-read from the chain at the block
// the page read it (or over the same blocks for a window statistic), compared raw and as shown. Run against the local
// build (`npm run check:live`) or a deployment (`BASE_URL=https://clim-fables.vercel.app npm run check:live`).
import { expect, test } from "@playwright/test";
import { liveText } from "../src/lib/liveKeys";
import { resolve, type LiveElement } from "./resolvers";

const fee = (p: string) => [`${p}:fee0For1`, `${p}:fee1For0`];
const window = (p: string) => [`${p}:avg`, `${p}:peak`, `${p}:low`, `${p}:changes`];
const pool = (n: string) => [...fee(`pool:${n}`), `pool:${n}:price`, ...window(`pool:${n}`), `pool:${n}:swaps`];

/** Keys each route must show once its reads have landed. */
const EXPECTED: Record<string, string[]> = {
  "/": ["fables:fee0For1", "clim:quote", "clim:seq"],
  "/markets": [...fee("fables"), "fables:price", "fables:changes", "clim:seq", ...["D", "K", "F"].flatMap((n) => [...fee(`pool:${n}`), `pool:${n}:price`])],
  "/markets/eth": [...fee("fables"), "fables:price", ...window("fables"), "clim:quote", ...fee("clim"), "clim:mode", "clim:seq", "clim:tObs", "desk:sigma5", "desk:dev"],
  "/markets/d": [...pool("D"), "pool:D:meanSwapFee"],
  "/markets/k": [...pool("K"), "pool:K:meanSwapFee"],
  "/markets/f": [...pool("F"), "pool:F:meanSwapFee"],
  "/integrate": ["fables:fee0For1", "clim:quote", "roles:poker", "roles:runner"],
};

async function liveElements(page: import("@playwright/test").Page): Promise<LiveElement[]> {
  return page.$$eval("[data-live]", (els) =>
    els.map((el) => {
      const d = (el as HTMLElement).dataset;
      return { key: d.live ?? "", chain: d.chain ?? "", block: d.block ?? "", raw: d.raw ?? "", text: (el.textContent ?? "").trim(), fromBlock: d.fromBlock, toBlock: d.toBlock, fromTs: d.fromTs, toTs: d.toTs };
    }),
  );
}

for (const [route, keys] of Object.entries(EXPECTED)) {
  test(`live numbers on ${route} match the chain`, async ({ page }) => {
    await page.goto(route);
    const missing = async () => {
      const shown = new Set((await liveElements(page)).map((e) => e.key));
      return keys.filter((k) => !shown.has(k));
    };
    await expect.poll(missing, { timeout: 150_000, intervals: [2_000] }).toEqual([]);
    const elements = await liveElements(page);
    const seen = new Set<string>();
    for (const e of elements) {
      const id = `${e.key}@${e.block}:${e.fromBlock ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const chainRaw = await resolve(e);
      expect.soft(e.raw, `${e.key} at block ${e.block}`).toBe(chainRaw);
      expect.soft(e.text, `${e.key} as shown`).toBe(liveText(e.key, chainRaw));
    }
    test.info().annotations.push({ type: "checked", description: `${seen.size} live values on ${route}` });
  });
}
