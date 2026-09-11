import { expect, test } from "@playwright/test";
import { createList, signUp } from "./support";

/**
 * The reported leak, as a regression guard: the local Store on a browser is
 * shared by everyone who signs in on it. A brand-new account must never see
 * the previous account's Lists — the offline copy is wiped on identity
 * change (and the server never returns them anyway).
 */
test("a new user on the same browser never sees the previous user's Lists", async ({ page }) => {
  await signUp(page, "First User");
  await createList(page, "test");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "test" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await signUp(page, "Second User");

  // The second user's Lists view is empty — no leftover copy of "test".
  await expect(page.getByText("Your lists will appear here.")).toBeVisible();
  await expect(page.getByRole("link", { name: "test" })).toHaveCount(0);
});
