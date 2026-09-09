import { expect, test } from "@playwright/test";
import { createList, input, paymentRow, signUp } from "./support";

/**
 * The real user flow for money: sign up, create a List, record a Payment,
 * then reload — proving the Payment is durably on the List (the server is
 * the source of truth).
 */
test("a member records a Payment and it survives reloads", async ({ page }) => {
  await signUp(page, "E2E Payments");
  await createList(page, "Groceries");

  await input(page, "payment-amount").fill("12.50");
  await input(page, "payment-date").fill("2026-02-01");
  await page.getByRole("button", { name: "Record a Payment" }).click();

  await expect(paymentRow(page, "12.50")).toBeVisible();

  await page.reload();

  await expect(paymentRow(page, "12.50")).toBeVisible();
});
