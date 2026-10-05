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
  // The List opens on Items; Payments is behind the List's navigation.
  await page.getByRole("link", { name: "Payments" }).click();

  await input(page, "payment-amount").fill("12.50");
  await input(page, "payment-date").fill("2026-02-01");
  await page.getByRole("button", { name: "Record" }).click();

  await expect(paymentRow(page, "12,50")).toBeVisible();
  // The ledger names who paid, not just the amount.
  await expect(paymentRow(page, "12,50")).toContainText("You");

  await page.reload();

  await expect(paymentRow(page, "12,50")).toBeVisible();
  await expect(page.locator(".total-paid")).toContainText("12,50");
});
