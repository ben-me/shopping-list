import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the e2e specs: the real user flow against the dev
 * stack — sign up, create a List, add, tick, and remove Items.
 *
 * Every run signs up a fresh user with a unique email, so reruns against a
 * persistent local dev database never collide.
 */

export const PASSWORD = "e2e-secret-123";

export function input(page: Page, formName: string) {
  return page.locator(`input[name="${formName}"]`);
}

export async function signUp(page: Page, name: string) {
  const email = `e2e-${randomUUID()}@example.com`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await input(page, "name").fill(name);
  await input(page, "email").fill(email);
  await input(page, "password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Signed in as")).toContainText(name);
}

export async function createList(page: Page, name: string) {
  await input(page, "name").fill(name);
  await page.getByRole("button", { name: "Create a List" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

export function itemRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

export async function addItem(page: Page, name: string) {
  await input(page, "item").fill(name);
  await page.getByRole("button", { name: "Add an Item" }).click();
  await expect(itemRow(page, name)).toBeVisible();
}

/**
 * Waits until the app's local Store reflects the expected Item state and its
 * outbox has fully drained — i.e. the action is durably committed locally and
 * nothing is left to sync. Only then is a reload guaranteed to show the same
 * state, whatever order the app syncs in. `checked: null` waits for the Item
 * to be gone (removal).
 */
export function itemSettled(page: Page, name: string, checked: boolean | null) {
  const listId = new URL(page.url()).pathname.split("/").pop() ?? "";
  // The predicate runs in the page (string form, so it is not type-checked
  // against the test's modules): it imports the app's own Store module — the
  // same instance the app uses — and inspects its real state.
  return page.waitForFunction(
    `async ({ listId, name, checked }) => {
      const { db } = await import("/src/db.ts");
      const items = await db.getItems(listId);
      const item = items.find((i) => i.name === name);
      if (checked === null) {
        if (item) return false;
      } else if (!item || item.checked !== checked) {
        return false;
      }
      const pending = await db.pendingOutboxEntries();
      return pending.length === 0;
    }`,
    { listId, name, checked },
  );
}
