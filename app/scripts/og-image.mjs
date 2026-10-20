// The social card (Open Graph and X): 1200 x 630 at 2x, drawn as the landing hero with Fables' landscape, Louize and
// Inter, and saved to public/fables/og.jpg. It is built from Fables' brand files, so it lives next to them in the
// gitignored public/fables/ and is uploaded with them on deploy (`npm run fables-assets` first, then this script).
// Usage: node scripts/og-image.mjs [--check]
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OG_FILE = "public/fables/og.jpg";
export const OG_SIZE = { width: 1200, height: 630, scale: 2 };

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const asset = (p) => pathToFileURL(join(appRoot, "public/fables", p)).href;

const GITHUB_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z";

export function ogHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Louize; src: url("${asset("fonts/louize-display-medium.woff2")}") format("woff2"); font-weight: 400 700; }
@font-face { font-family: Inter; src: url("${asset("fonts/inter.woff2")}") format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; background: #100f0f; color: #fff; font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.frame { position: absolute; inset: 24px; border-radius: 24px; background: #1a1919; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.06); }
.art { position: absolute; inset: 0; background: url("${asset("hero-bg.webp")}") center bottom / 100% auto no-repeat; opacity: .46; }
.grid { position: absolute; inset: 0; background-image: radial-gradient(circle, rgba(255,255,255,.06) 1px, transparent 1px); background-size: 20px 20px; }
.inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; padding: 34px 56px; text-align: center; }
.brand { display: flex; align-items: center; gap: 14px; font-family: Louize, serif; font-size: 44px; line-height: 44px; font-weight: 500; }
.logo { height: 40px; width: auto; display: block; }
.times { color: #8f8e8e; padding: 0 .12em; }
.chip { margin-top: 24px; display: inline-flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 12px; background: #2a2828; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); font-size: 18px; line-height: 24px; font-weight: 500; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #66c399; box-shadow: 0 0 0 4px rgba(102,195,153,.18); }
h1 { margin-top: 18px; font-family: Louize, serif; font-size: 66px; line-height: 74px; font-weight: 500; letter-spacing: .3px; }
.lime { color: #ccff00; }
.foot { position: absolute; left: 32px; right: 32px; bottom: 28px; display: flex; justify-content: space-between; align-items: center; font-size: 18px; line-height: 24px; }
.pill { display: inline-flex; align-items: center; gap: 10px; padding: 9px 14px; border-radius: 12px; background: rgba(16,15,15,.82); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
.pill svg { width: 20px; height: 20px; }
.muted { color: #bcbbbb; }
</style></head><body>
<div class="frame"><div class="art"></div><div class="grid"></div>
  <div class="inner">
    <div class="brand"><img class="logo" src="${asset("logo.svg")}" alt=""><span>clim<span class="times">×</span>Fables</span></div>
    <span class="chip"><span class="dot"></span>Live on Robinhood Chain</span>
    <h1>Fables' keeper sets the fee.<br><span class="lime">clim checks it in public.</span></h1>
  </div>
  <div class="foot">
    <span class="pill muted">Showcase by clim, not affiliated with Fables</span>
    <span class="pill"><svg viewBox="0 0 16 16" fill="#fff"><path d="${GITHUB_PATH}"/></svg>Open source · github.com/gamween/clim-fables</span>
  </div>
</div>
</body></html>`;
}

async function main() {
  const out = join(appRoot, OG_FILE);
  if (process.argv.includes("--check")) {
    if (!existsSync(out)) {
      console.error(`og-image: ${OG_FILE} is missing (npm run og)`);
      process.exit(1);
    }
    console.log(`og-image: ${OG_FILE} in place`);
    return;
  }
  for (const f of ["hero-bg.webp", "logo.svg", "fonts/louize-display-medium.woff2", "fonts/inter.woff2"]) {
    if (!existsSync(join(appRoot, "public/fables", f))) throw new Error(`public/fables/${f} is missing: run npm run fables-assets first`);
  }
  const { chromium } = await import("@playwright/test");
  const dir = mkdtempSync(join(tmpdir(), "clim-og-"));
  const html = join(dir, "og.html");
  writeFileSync(html, ogHtml());
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: OG_SIZE.width, height: OG_SIZE.height }, deviceScaleFactor: OG_SIZE.scale });
    await page.goto(pathToFileURL(html).href);
    await page.evaluate(() => document.fonts.ready);
    const missing = await page.evaluate(() => ["Louize", "Inter"].filter((f) => !document.fonts.check(`500 24px ${f}`)));
    if (missing.length) throw new Error(`fonts not loaded: ${missing.join(", ")}`);
    await page.screenshot({ path: out, type: "jpeg", quality: 90 });
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`og-image: wrote ${OG_FILE} (${OG_SIZE.width * OG_SIZE.scale} x ${OG_SIZE.height * OG_SIZE.scale})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
