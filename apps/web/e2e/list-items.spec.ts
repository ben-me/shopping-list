import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * The real user flow, in a real browser against the dev stack: sign up,
 * create a List, then add, tick, un-tick, and remove Items — proving the
 * List is correct across reloads (the server is the source of truth).
 *
 * Every run signs up a fresh user with a unique email, so reruns against a
 * persistent local dev database never collide.
 */

const PASSWORD = "e2e-secret-123";

async function signUp(page: Page, name: string) {
  const email = `e2e-${randomUUID()}@example.com`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByTestId("name").fill(name);
  await page.getByTestId("email").fill(email);
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByTestId("signed-in-as")).toContainText(name);
}

async function createList(page: Page, name: string) {
  await page.getByTestId("list-name").fill(name);
  await page.getByRole("button", { name: "Create a List" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

function itemRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

async function addItem(page: Page, name: string) {
  await page.getByTestId("item-name-input").fill(name);
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
function itemSettled(page: Page, name: string, checked: boolean | null) {
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

test("a member can add, tick, un-tick, and remove Items, and the List survives reloads", async ({
  page,
}) => {
  await signUp(page, "E2E Tester");
  await createList(page, "Groceries");

  await test.step("add two Items", async () => {
    await addItem(page, "Milk");
    await addItem(page, "Eggs");
  });

  await test.step("tick an Item off and reload — it stays ticked", async () => {
    await itemRow(page, "Milk").getByTestId("item-checkbox").check();
    await itemSettled(page, "Milk", true);
    await page.reload();
    await expect(itemRow(page, "Milk").getByTestId("item-checkbox")).toBeChecked();
    await expect(itemRow(page, "Eggs").getByTestId("item-checkbox")).not.toBeChecked();
  });

  await test.step("un-tick and reload — it stays un-ticked", async () => {
    await itemRow(page, "Milk").getByTestId("item-checkbox").uncheck();
    await itemSettled(page, "Milk", false);
    await page.reload();
    await expect(itemRow(page, "Milk").getByTestId("item-checkbox")).not.toBeChecked();
  });

  await test.step("remove an Item and reload — it stays removed", async () => {
    await itemRow(page, "Milk").getByTestId("remove-item").click();
    await itemSettled(page, "Milk", null);
    await expect(itemRow(page, "Milk")).toHaveCount(0);
    await page.reload();
    await expect(itemRow(page, "Milk")).toHaveCount(0);
    await expect(itemRow(page, "Eggs")).toBeVisible();
  });
});
