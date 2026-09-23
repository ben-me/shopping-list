import { expect, test } from "@playwright/test";
import { createList, signUp } from "./support";

/**
 * Navigation polish (#47): every signed-in screen carries a visible way back,
 * sign-out stays within reach, and the mobile-first layout never scrolls
 * sideways at the narrowest width the app supports.
 */
test("every signed-in screen shows a way back, and sign-out stays reachable", async ({
  page,
  request,
}) => {
  // The narrowest supported width: a layout bug here is a horizontal scroll.
  await page.setViewportSize({ width: 320, height: 720 });

  await signUp(page, "Nav Tester", request);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await createList(page, "Errands");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(await horizontalOverflow(page)).toBe(0);

  // The List's own sections are reachable from its navigation.
  await page.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByRole("heading", { name: "Errands" })).toBeVisible();
  await expect(await horizontalOverflow(page)).toBe(0);
  await page.getByRole("link", { name: "Items" }).click();
  await expect(page.getByRole("button", { name: "Add" })).toBeVisible();

  // List detail → Lists home.
  await page.getByRole("link", { name: "Lists" }).click();
  await expect(page.getByRole("heading", { name: "Shopping Lists" })).toBeVisible();
  await expect(await horizontalOverflow(page)).toBe(0);

  // Lists home → Settings → back to Lists home.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: "Lists" }).click();
  await expect(page.getByRole("heading", { name: "Shopping Lists" })).toBeVisible();
});

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}
