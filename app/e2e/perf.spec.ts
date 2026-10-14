// Load timing: each route on a cold browser context, the time from navigation to every expected live number (and, on
// the pool pages, the Dynamic Fee chart) on screen. Prints one line per route and fails a route over its budget.
// Run: `npm run perf` (local production build) or `BASE_URL=https://clim-fables.vercel.app npm run perf`.
import { expect, test } from "@playwright/test";
import { EXPECTED, EXPECTED_SERIES } from "./expected";
import { warmCache } from "./warm";

/** Budgets in ms: 2.5 s for the ETH/USDG pool page (the chart and its statistics), 3 s for every other route. */
const BUDGET_MS: Record<string, number> = { "/markets/eth": 2_500 };
const DEFAULT_BUDGET_MS = 3_000;
const STRICT = process.env.PERF_STRICT !== "0";

test.beforeAll(async ({ request }) => {
  test.setTimeout(900_000);
  for (const line of await warmCache(request)) console.log(line);
});

for (const [route, keys] of Object.entries(EXPECTED)) {
  test(`load time of ${route}`, async ({ page }) => {
    const series = EXPECTED_SERIES[route];
    const t0 = Date.now();
    await page.goto(route, { waitUntil: "commit" });
    await page.waitForFunction(
      ({ keys, series }) => {
        const shown = new Set([...document.querySelectorAll<HTMLElement>("[data-live]")].map((e) => e.dataset.live));
        if (!keys.every((k) => shown.has(k))) return false;
        if (series === undefined) return true;
        const drawn = [...document.querySelectorAll<SVGPathElement>('[data-qa="chart-panel"] path[data-series]')].map((p) => p.dataset.series);
        return series.length === 0 ? drawn.length > 0 : series.every((s) => drawn.includes(s));
      },
      { keys, series },
      { timeout: 150_000, polling: 50 },
    );
    const ms = Date.now() - t0;
    const budget = BUDGET_MS[route] ?? DEFAULT_BUDGET_MS;
    console.log(`perf ${route}: ${ms} ms (budget ${budget} ms)`);
    test.info().annotations.push({ type: "load", description: `${route} ${ms} ms` });
    if (STRICT) expect(ms, `${route} loaded in ${ms} ms`).toBeLessThanOrEqual(budget);
  });
}
