import { expect, test } from "@playwright/test";
import { createList, input, paymentRow, signUp } from "./support";

/**
 * The real user flow for payments: sign up, create a List, switch to the
 * Payments screen, record a Payment, then reload — proving the Payment is
 * durably on the List (the server is the source of truth).
 */
test("a member records a Payment and it survives reloads", async ({ page, request }) => {
  await signUp(page, "E2E Payments", request);
  await createList(page, "Groceries");

  await test.step("Payments is its own screen behind the List's navigation", async () => {
    // The Items screen carries no money at all.
    await expect(page.getByRole("button", { name: "Add" })).toBeVisible();
    await expect(input(page, "payment-amount")).toHaveCount(0);

    await page.getByRole("link", { name: "Payments" }).click();
    await expect(input(page, "payment-amount")).toBeVisible();
    // Items are not on this screen.
    await expect(page.getByRole("button", { name: "Add" })).toHaveCount(0);
  });

  await input(page, "payment-amount").fill("12.50");
  await input(page, "payment-date").fill("2026-02-01");
  await page.getByRole("button", { name: "Record" }).click();

  await expect(paymentRow(page, "12,50")).toBeVisible();

  await test.step("the screen shows the running total, and a lone Member gets no Owed figure", async () => {
    await expect(page.locator(".total-paid")).toContainText("12,50");
    await expect(page.locator(".standing-member")).toHaveCount(0);
  });

  await page.reload();

  await expect(paymentRow(page, "12,50")).toBeVisible();
  await expect(page.locator(".total-paid")).toContainText("12,50");

  await test.step("the Items screen is one tap away and back to the List", async () => {
    await page.getByRole("link", { name: "Items" }).click();
    await expect(page.getByRole("button", { name: "Add" })).toBeVisible();
    await expect(input(page, "payment-amount")).toHaveCount(0);
  });
});
