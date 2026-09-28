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

  // The List's own sections are reachable from its navigation, and the open
  // section is marked by one underline line that glides across the tabs.
  const lineBox = async () => {
    const box = await page.locator(".tabs span").boundingBox();
    if (!box) {
      throw new Error("The section underline is missing");
    }
    return box;
  };
  const tabBox = async (name: string) => {
    const box = await page.getByRole("link", { name, exact: true }).boundingBox();
    if (!box) {
      throw new Error(`No ${name} tab`);
    }
    return box;
  };

  // Under Items, the line sits under the Items tab.
  const itemsTab = await tabBox("Items");
  const underItems = await lineBox();
  expect(Math.abs(underItems.x - itemsTab.x)).toBeLessThan(2);
  expect(Math.abs(underItems.width - itemsTab.width)).toBeLessThan(2);

  await page.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByRole("heading", { name: "Errands" })).toBeVisible();
  await expect(await horizontalOverflow(page)).toBe(0);

  // The line glided over to the Payments tab (its x moved past the old one).
  const paymentsTab = await tabBox("Payments");
  await expect.poll(lineBox).toMatchObject({
    x: expect.closeTo(paymentsTab.x, 2),
    width: expect.closeTo(paymentsTab.width, 2),
  });
  expect((await lineBox()).x).toBeGreaterThan(underItems.x);

  await page.getByRole("link", { name: "Items" }).click();
  await expect(page.getByRole("button", { name: "Add" })).toBeVisible();

  // And back under Items again.
  await expect.poll(lineBox).toMatchObject({
    x: expect.closeTo(itemsTab.x, 2),
    width: expect.closeTo(itemsTab.width, 2),
  });

  // List detail → Lists home (the arrow back, named for what it does).
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Shopping Lists" })).toBeVisible();
  await expect(await horizontalOverflow(page)).toBe(0);

  // Lists home → Settings → back to Lists home.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Shopping Lists" })).toBeVisible();
});

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}
