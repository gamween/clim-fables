// The entry notice: on a first visit it covers the page, says what the site is not, and stays closed once acknowledged.
import { expect, test } from "@playwright/test";
import { NOTICE_KEY, NOTICE_POINTS } from "../src/lib/notice";

test.use({ storageState: { cookies: [], origins: [] } });

test("the entry notice opens on a first visit and stays closed once acknowledged", async ({ page }) => {
  await page.goto("/markets");
  const dialog = page.locator('[data-qa="notice"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog.getByRole("heading", { name: "Before you look around" })).toBeVisible();
  for (const p of NOTICE_POINTS) await expect(dialog).toContainText(p.title);
  await expect(dialog.getByRole("link", { name: /source on github/i })).toHaveAttribute("href", "https://github.com/gamween/clim-fables");
  // Modal: the page behind does not take clicks until the notice is acknowledged.
  expect(await page.evaluate(() => document.querySelector("dialog")?.matches(":modal"))).toBe(true);

  await page.locator('[data-qa="notice-accept"]').click();
  await expect(dialog).toBeHidden();
  expect(Number(await page.evaluate((k) => localStorage.getItem(k), NOTICE_KEY))).toBeGreaterThan(0);

  await page.goto("/markets/eth");
  await page.waitForTimeout(500);
  await expect(dialog).toBeHidden();
});

test("Escape acknowledges the notice", async ({ page }) => {
  await page.goto("/");
  const dialog = page.locator('[data-qa="notice"]');
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.waitForTimeout(500);
  await expect(dialog).toBeHidden();
});
