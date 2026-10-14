// Every route keeps the showcase guardrails (CLAUDE.md, spec §5.5): the permanent banner, "clim × Fables" in the nav,
// the inert wallet pill and no "Connect", and pages that only ever read the chain.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BANNER_TEXT, NO_WALLET_TEXT, ROUTES, SITE_NAME, SITE_TITLE } from "../src/lib/site";

/** JSON-RPC methods the app may send: reads only. */
const READ_METHODS = new Set(["eth_call", "eth_getLogs", "eth_blockNumber", "eth_getBlockByNumber", "eth_chainId"]);
const RPC_HOSTS = ["rpc.mainnet.chain.robinhood.com", "rpc.testnet.chain.robinhood.com", "rpc.ordofi.network"];

for (const route of [...ROUTES, "/no-such-page"]) {
  test(`guardrails on ${route}`, async ({ page, baseURL }) => {
    const site = new URL(baseURL ?? "http://localhost").host;
    const methods = new Set<string>();
    const hosts = new Set<string>();
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.protocol.startsWith("http") && url.host !== site) hosts.add(url.host);
      if (!RPC_HOSTS.includes(url.host) || req.method() !== "POST") return;
      const body = req.postDataJSON() as { method: string } | Array<{ method: string }>;
      for (const call of Array.isArray(body) ? body : [body]) methods.add(call.method);
    });
    await page.goto(route);
    await expect(page).toHaveTitle(SITE_TITLE);
    expect((await page.title()).startsWith(SITE_NAME)).toBe(true);
    // Every robots meta says noindex (Next adds its own on the 404 next to the site's).
    const robots = await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((e) => e.getAttribute("content") ?? ""));
    expect(robots.length).toBeGreaterThan(0);
    for (const r of robots) expect(r).toMatch(/noindex/);
    for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[property="og:site_name"]']) {
      expect((await page.locator(sel).getAttribute("content"))?.startsWith(SITE_NAME), sel).toBe(true);
    }

    const banner = page.locator('[data-guard="banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(BANNER_TEXT);
    await expect(banner.locator("button, a")).toHaveCount(0);

    await expect(page.locator('[data-guard="identity"]')).toHaveText("clim×Fables");
    const pill = page.locator('[data-guard="no-wallet"]');
    await expect(pill).toHaveText(NO_WALLET_TEXT);
    await expect(pill).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: /connect|wallet/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /connect wallet|deposit|swap/i })).toHaveCount(0);

    // The banner stays on screen after a scroll.
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(500);
    expect((await banner.boundingBox())?.y).toBe(0);

    // Let the live reads run, then check that every RPC call was a read and that no other host was contacted.
    await page.waitForTimeout(8_000);
    expect([...methods].filter((m) => !READ_METHODS.has(m))).toEqual([]);
    expect([...hosts].filter((h) => !RPC_HOSTS.includes(h))).toEqual([]);
  });
}

test("pool pages label their network", async ({ page }) => {
  for (const [route, network] of [["/markets/eth", "mainnet"], ["/markets/d", "testnet"], ["/markets/k", "testnet"], ["/markets/f", "testnet"]] as const) {
    await page.goto(route);
    await expect(page.locator(`[data-qa="pool-head"] [data-network="${network}"]`)).toBeVisible();
  }
});

test("robots.txt and Fables' favicon files are served", async ({ request }) => {
  // Fables' brand files are not in git (CI builds without them); a local build after `npm run fables-assets` and the
  // deployment have them.
  test.skip(!process.env.BASE_URL && !existsSync(join(__dirname, "../public/fables/favicon.ico")), "Fables' brand files are not in git");
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
  for (const path of ["/favicon.ico", "/apple-touch-icon.png"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toMatch(/image\//);
  }
});
