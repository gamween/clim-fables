// Visual QA: each route at Fables' capture size (1450 x 838 CSS px, the maintainer's window), saved next to the Fables
// screenshot of the same surface, and the measured tokens of docs/research/fables-ui-inventory.md checked on the built
// page. Writes .local/app-qa/ (gitignored): <route>.png, <route>-full.png and index.html. Run: npm run qa:visual.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";

const REPO = join(__dirname, "..", "..");
const OUT = join(REPO, ".local/app-qa");
const UI = join(REPO, ".local/fables-ui");
const KIT = join(REPO, ".local/research-2026-10-13/fables-brand/screenshots");

/** Each route and the Fables capture of the same surface. */
const PAIRS = [
  { route: "/", slug: "landing", fables: [join(KIT, "01-landing-hero.jpg"), join(KIT, "09-landing-features-table.jpg")] },
  { route: "/markets", slug: "markets", fables: [join(UI, "02-markets-desktop.jpg")] },
  { route: "/markets/eth", slug: "pool-eth", fables: [join(UI, "03-pool-eth-top.jpg"), join(UI, "04-pool-eth-dynamic-fee.jpg")] },
  { route: "/markets/d", slug: "pool-d", fables: [join(UI, "03-pool-eth-top.jpg")] },
  { route: "/integrate", slug: "integrate", fables: [join(UI, "10-docs-dynamic-fees.jpg")] },
  { route: "/evidence", slug: "evidence", fables: [join(UI, "10-docs-dynamic-fees.jpg")] },
  { route: "/run", slug: "run", fables: [join(UI, "04-pool-eth-dynamic-fee.jpg")] },
  { route: "/no-such-page", slug: "not-found", fables: [join(KIT, "07-404-mascot.jpg")] },
];

/** Measured on www.fables.fi (inventory §1 to §4, .local/fables-ui/measurements.json). */
const TOKENS = [
  { route: "/markets", what: "canvas", sel: "body", prop: "backgroundColor", want: "rgb(16, 15, 15)" },
  { route: "/markets", what: "body text", sel: "body", prop: "fontSize", want: "14px" },
  { route: "/markets", what: "body family", sel: "body", prop: "fontFamily", want: /^Inter/ },
  { route: "/markets", what: "banner height", sel: '[data-qa="banner"]', prop: "height", want: "40px" },
  { route: "/markets", what: "header height", sel: '[data-qa="header"]', prop: "height", want: "80px" },
  { route: "/markets", what: "nav pill height", sel: '[data-qa="nav"]', prop: "height", want: "46px" },
  { route: "/markets", what: "nav pill surface", sel: '[data-qa="nav"]', prop: "backgroundColor", want: "rgb(31, 30, 30)" },
  { route: "/markets", what: "nav pill radius", sel: '[data-qa="nav"]', prop: "borderRadius", want: "12px" },
  { route: "/markets", what: "wordmark", sel: '[data-qa="brand-text"]', prop: "fontSize", want: "32px" },
  { route: "/markets", what: "wordmark family", sel: '[data-qa="brand-text"]', prop: "fontFamily", want: /^Louize/ },
  { route: "/markets", what: "content column", sel: '[data-qa="page"]', prop: "width", want: "1200px" },
  { route: "/markets", what: "page title", sel: '[data-qa="page-title"]', prop: "fontSize", want: "28px" },
  { route: "/markets", what: "table head height", sel: '[data-qa="markets-table"] th', prop: "height", want: "50px" },
  { route: "/markets", what: "market row height", sel: '[data-qa="markets-table"] td', prop: "height", want: "76px" },
  { route: "/markets/eth", what: "pool column", sel: '[data-qa="pool"]', prop: "width", want: "1040px" },
  { route: "/markets/eth", what: "stat value", sel: '[data-qa="stat-value"]', prop: "fontSize", want: "24px" },
  { route: "/markets/eth", what: "section title", sel: '[data-qa="section-title"]', prop: "fontSize", want: "20px" },
  { route: "/markets/eth", what: "chart panel", sel: '[data-qa="chart-panel"]', prop: "backgroundColor", want: "rgb(26, 25, 25)" },
  { route: "/markets/eth", what: "chart panel radius", sel: '[data-qa="chart-panel"]', prop: "borderRadius", want: "12px" },
  { route: "/", what: "hero card", sel: '[data-qa="hero"]', prop: "backgroundColor", want: "rgb(26, 25, 25)" },
  { route: "/", what: "hero headline", sel: '[data-qa="headline"]', prop: "fontSize", want: "48px" },
  { route: "/", what: "hero leading", sel: '[data-qa="headline"]', prop: "lineHeight", want: "56px" },
] as const;

test.use({ viewport: { width: 1450, height: 838 } });

test("screenshots next to Fables' and the token checklist", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  for (const p of PAIRS) {
    await page.goto(p.route);
    await page.waitForTimeout(12_000);
    await page.screenshot({ path: join(OUT, `${p.slug}.png`) });
    await page.screenshot({ path: join(OUT, `${p.slug}-full.png`), fullPage: true });
  }
  const results: Array<{ route: string; what: string; sel: string; prop: string; want: string; got: string; pass: boolean }> = [];
  for (const t of TOKENS) {
    await page.goto(t.route);
    const el = page.locator(t.sel).first();
    await el.waitFor();
    const got = await el.evaluate((node, prop) => {
      if (prop === "width" || prop === "height") return `${Math.round(node.getBoundingClientRect()[prop])}px`;
      return getComputedStyle(node)[prop as "color"];
    }, t.prop);
    const pass = typeof t.want === "string" ? got === t.want : t.want.test(got);
    results.push({ route: t.route, what: t.what, sel: t.sel, prop: t.prop, want: String(t.want), got, pass });
  }
  const rel = (f: string) => relative(OUT, f);
  const html = `<!doctype html><meta charset="utf-8"><title>clim × Fables visual QA</title>
<style>body{background:#100f0f;color:#fff;font:14px Inter,system-ui;margin:24px}img{width:100%;border:1px solid #333}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}td,th{padding:6px 10px;border-bottom:1px solid #333;text-align:left}.ok{color:#66c399}.ko{color:#ff773d}</style>
<h1>clim × Fables, visual QA at 1450 x 838</h1>
<table><tr><th>Route</th><th>Token</th><th>Selector</th><th>Property</th><th>Fables</th><th>Showcase</th><th></th></tr>
${results.map((r) => `<tr><td>${r.route}</td><td>${r.what}</td><td><code>${r.sel}</code></td><td>${r.prop}</td><td>${r.want}</td><td>${r.got}</td><td class="${r.pass ? "ok" : "ko"}">${r.pass ? "match" : "differs"}</td></tr>`).join("\n")}
</table>
${PAIRS.map((p) => `<h2>${p.route}</h2><div class="pair"><div><p>Showcase</p><img src="${p.slug}.png"></div><div><p>Fables</p>${p.fables.map((f) => `<img src="${rel(f)}">`).join("")}</div></div>`).join("\n")}`;
  writeFileSync(join(OUT, "index.html"), html);
  for (const r of results) expect.soft(r.got, `${r.route} ${r.what} (${r.sel} ${r.prop})`).toBe(r.pass ? r.got : r.want);
});
