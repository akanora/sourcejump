// Screenshots of the style guide. An intended design change updates them with `npm run test:ui -- --update-snapshots`.
import { expect, test } from "@playwright/test";

test("style guide on a wide screen", async ({ page }) => {
  await page.goto("/dev/ui");
  await expect(page).toHaveScreenshot("desktop.png", { fullPage: true });
});

test("style guide on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/ui");
  await expect(page).toHaveScreenshot("phone.png", { fullPage: true });
});

test("dialog and menu", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeFocused();
  await expect(page).toHaveScreenshot("menu.png");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open dialog" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveScreenshot("dialog.png");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
