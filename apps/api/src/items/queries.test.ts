import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createD1Connection, type Db } from "../db";
import { createList } from "../lists/queries";
import { runMigrations, startMiniflare } from "../test-support";
import * as itemsQueries from "./queries";

describe("items query helpers", () => {
  let mf: Miniflare;
  let db: Db;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-items-queries-db");
    const devDb = await mf.getD1Database("devDb");
    await runMigrations(devDb);
    db = createD1Connection(devDb);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates, reads, updates, and deletes Item rows scoped to a List", async () => {
    const list = await createList(db, { ownerId: "u-owner", name: "Shop" });
    const item = await itemsQueries.createItem(db, { listId: list.id, name: "Milk" });

    expect(item.checked).toBe(false);
    await expect(itemsQueries.getItem(db, item.id)).resolves.toEqual(item);

    const updated = await itemsQueries.updateItem(db, item.id, {
      checked: true,
      checkedAt: item.updatedAt,
    });
    expect(updated?.checked).toBe(true);
    expect(updated?.checkedAt).toBeTruthy();

    const items = await itemsQueries.getItemsByList(db, list.id);
    expect(items.map((i) => i.id)).toContain(item.id);

    await expect(itemsQueries.deleteItem(db, item.id)).resolves.toBe(true);
    await expect(itemsQueries.getItemsByList(db, list.id)).resolves.toHaveLength(0);
  });

  it("clears checkedAt when an Item is unchecked again", async () => {
    const list = await createList(db, { ownerId: "u-owner", name: "Shop" });
    const item = await itemsQueries.createItem(db, { listId: list.id, name: "Milk" });

    const checked = await itemsQueries.updateItem(db, item.id, { checked: true });
    expect(checked?.checkedAt).toBeTruthy();

    const unchecked = await itemsQueries.updateItem(db, item.id, { checked: false });
    expect(unchecked?.checked).toBe(false);
    expect(unchecked?.checkedAt).toBeUndefined();
  });
});
