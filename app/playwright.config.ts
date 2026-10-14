import { defineConfig } from "@playwright/test";

// BASE_URL points the checks at a deployment (for instance https://clim-fables.vercel.app); without it they start the
// production build locally (`npm run build` first). Viewports: the maintainer's MacBook, 1470 x 956 CSS px
// ("desktop"), and a 390 x 844 phone ("mobile", touch, for the guardrail and visual specs only).
const external = process.env.BASE_URL;
const PORT = 3311;

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: external ?? `http://localhost:${PORT}`, browserName: "chromium" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1470, height: 956 } } },
    { name: "mobile", testMatch: /(guardrails|visual)\.spec\.ts$/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  ],
  webServer: external ? undefined : { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}/markets`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
