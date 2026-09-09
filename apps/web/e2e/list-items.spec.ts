import { expect, test } from "@playwright/test";
import { addItem, createList, input, itemRow, itemSettled, signUp } from "./support";

/**
 * The real user flow, in a real browser against the dev stack: sign up,
 * create a List, then add, tick, un-tick, and remove Items — proving the
 * List is correct across reloads (the server is the source of truth).
 */
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
