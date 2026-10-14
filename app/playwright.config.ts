import { defineConfig } from "@playwright/test";

// BASE_URL points the checks at a deployment (for instance https://clim-fables.vercel.app); without it they start the
// production build locally (`npm run build` first). Viewport: the maintainer's MacBook, 1470 x 956 CSS px.
const external = process.env.BASE_URL;
const PORT = 3311;

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: external ?? `http://localhost:${PORT}`, browserName: "chromium", viewport: { width: 1470, height: 956 } },
  webServer: external ? undefined : { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}/markets`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
