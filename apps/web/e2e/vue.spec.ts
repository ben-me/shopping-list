import { test, expect } from "@playwright/test";

test("an unauthenticated visitor lands on the sign-in view", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Sign in");
});
