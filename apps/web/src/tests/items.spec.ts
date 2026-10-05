import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import type { Item, List } from "@shopping-list/api/domain";
import { db } from "../db";
import { addItem, removeItem, syncItemsFromServer } from "../items";
import { syncOutbox } from "../lists";
import { resetStore, serverDown, stubApi } from "./support/app";

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(async () => {
  await resetStore([list]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Items on a List", () => {
  it("adds an Item offline: it appears immediately and is queued for Sync", async () => {
    stubApi({});

    const item = await addItem(db, list.id, "  Milk  ");

    expect(item).toMatchObject({ listId: list.id, name: "Milk", checked: false });
    expect((await db.getItems(list.id)).map((i) => i.name)).toEqual(["Milk"]);
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("rejects adding a blank Item name", async () => {
    await expect(addItem(db, list.id, "   ")).rejects.toThrow("Give the item a name");
    expect(await db.getItems(list.id)).toHaveLength(0);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("removes an Item offline and queues the delete for Sync", async () => {
    stubApi({});
    const item = await addItem(db, list.id, "Milk");

    await removeItem(db, item);

    expect(await db.getItems(list.id)).toHaveLength(0);
    const pending = await db.pendingOutboxEntries();
    expect(pending.map((e) => e.operation)).toEqual(["update", "delete"]);
    expect(pending[1]).toMatchObject({ targetType: "item", targetId: item.id, listId: list.id });
  });

  it("keeps an entry pending when the server is unreachable so Sync retries later", async () => {
    stubApi({}, { fallback: serverDown });
    await addItem(db, list.id, "Milk");

    await expect(syncOutbox(db)).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
    });

    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("pulls the server's Items for a List into the Store without queueing anything", async () => {
    const serverItem: Item = {
      id: "item-server",
      listId: list.id,
      name: "Bread",
      checked: true,
      checkedAt: "2026-02-01T10:00:00.000Z",
      createdAt: "2026-02-01T09:00:00.000Z",
      updatedAt: "2026-02-01T10:00:00.000Z",
    };
    stubApi({ [`GET /api/lists/${list.id}/items`]: { items: [serverItem] } });

    await syncItemsFromServer(db, list.id);

    expect(await db.getItems(list.id)).toEqual([serverItem]);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });
});
