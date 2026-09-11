import { expect, test } from "@playwright/test";
import { createList, signUp } from "./support";

// Regression guard for #42: a new account never sees the previous account's Lists.
test("a new user on the same browser never sees the previous user's Lists", async ({ page }) => {
  await signUp(page, "First User");
  await createList(page, "test");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "test" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await signUp(page, "Second User");

  // No leftovers from the previous account.
  await expect(page.getByText("Your lists will appear here.")).toBeVisible();
  await expect(page.getByRole("link", { name: "test" })).toHaveCount(0);
});
