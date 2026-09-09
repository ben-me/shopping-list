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

/** Inputs are located by their real `name` attributes — no test-only attributes. */
function input(page: Page, formName: string) {
  return page.locator(`input[name="${formName}"]`);
}

async function signUp(page: Page, name: string) {
  const email = `e2e-${randomUUID()}@example.com`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await input(page, "name").fill(name);
  await input(page, "email").fill(email);
  await input(page, "password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Signed in as")).toContainText(name);
}

async function createList(page: Page, name: string) {
  await input(page, "name").fill(name);
  await page.getByRole("button", { name: "Create a List" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

function itemRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

async function addItem(page: Page, name: string) {
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
    await itemRow(page, "Milk").getByRole("checkbox").check();
    await itemSettled(page, "Milk", true);
    await page.reload();
    await expect(itemRow(page, "Milk").getByRole("checkbox")).toBeChecked();
    await expect(itemRow(page, "Eggs").getByRole("checkbox")).not.toBeChecked();
  });

  await test.step("un-tick and reload — it stays un-ticked", async () => {
    await itemRow(page, "Milk").getByRole("checkbox").uncheck();
    await itemSettled(page, "Milk", false);
    await page.reload();
    await expect(itemRow(page, "Milk").getByRole("checkbox")).not.toBeChecked();
  });

  await test.step("remove an Item and reload — it stays removed", async () => {
    await itemRow(page, "Milk").getByRole("button", { name: "Remove" }).click();
    await itemSettled(page, "Milk", null);
    await expect(itemRow(page, "Milk")).toHaveCount(0);
    await page.reload();
    await expect(itemRow(page, "Milk")).toHaveCount(0);
    await expect(itemRow(page, "Eggs")).toBeVisible();
  });
});

test("an offline write is queued locally and syncs when the connection returns", async ({
  page,
}) => {
  await signUp(page, "E2E Offline");
  await createList(page, "Camping");
  await addItem(page, "Torch");

  // Warm the Store module so the outbox can be inspected while the network
  // is down (a cold dynamic import would need the dev server). String form:
  // the path is a dev-server URL, not a module the test imports.
  await page.evaluate("import('/src/db.ts')");

  await test.step("go offline and add an Item — the edit is never blocked", async () => {
    await page.context().setOffline(true);
    await input(page, "item").fill("Matches");
    await page.getByRole("button", { name: "Add an Item" }).click();
    await expect(itemRow(page, "Matches")).toBeVisible();

    // The write sits in the local outbox, waiting for a connection.
    const listId = new URL(page.url()).pathname.split("/").pop() ?? "";
    await page.waitForFunction(
      `async ({ listId, itemId }) => {
        const { db } = await import("/src/db.ts");
        const items = await db.getItems(listId);
        if (!items.some((i) => i.name === itemId)) return false;
        return (await db.pendingOutboxEntries()).length > 0;
      }`,
      { listId, itemId: "Matches" },
    );
  });

  await test.step("reconnect — the queue drains with no user action", async () => {
    await page.context().setOffline(false);
    // Deterministic trigger for the app's reconnect watcher (offline
    // emulation does not reliably fire the browser's `online` event).
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await itemSettled(page, "Matches", false);

    // The Item reached the server: it survives a full reload, which reads
    // back through the server as the source of truth.
    await page.reload();
    await expect(itemRow(page, "Matches")).toBeVisible();
  });
});
