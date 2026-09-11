import "fake-indexeddb/auto";

import type { List, Membership } from "@shopping-list/api/domain";
import { ensureStoreForUser } from "../store-owner";
import { ShoppingDb } from "../store";
import now from "@/utils/now";

let dbNumber = 0;

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Mine",
  createdAt: now(),
  updatedAt: now(),
};

const membership: Membership = { listId: list.id, memberId: "user-2", joinedAt: now() };

let db: ShoppingDb;

beforeEach(() => {
  dbNumber += 1;
  db = new ShoppingDb(`test-db-${dbNumber}`);
  localStorage.clear();
});

describe("ensureStoreForUser", () => {
  it("records the first user on a device and keeps their existing data", async () => {
    await db.syncList(list);

    await ensureStoreForUser(db, "user-1");

    expect(await db.getLists()).toEqual([list]);
    expect(localStorage.getItem("shopping-list:store-owner")).toBe("user-1");
  });

  it("is a no-op for the same user, so sign-out and back-in keeps the offline copy", async () => {
    await ensureStoreForUser(db, "user-1");
    await db.syncList(list);

    await ensureStoreForUser(db, "user-1");

    expect(await db.getLists()).toEqual([list]);
  });

  it("wipes everything when a different user takes over the device", async () => {
    await ensureStoreForUser(db, "user-1");
    await db.syncList(list);
    await db.putItem({
      id: "item-1",
      listId: list.id,
      name: "Milk",
      checked: false,
      createdAt: now(),
      updatedAt: now(),
    });
    await db.syncMembership(membership);
    expect(await db.pendingOutboxEntries()).toHaveLength(1); // the queued item write

    await ensureStoreForUser(db, "user-2");

    expect(await db.getLists()).toEqual([]);
    expect(await db.getItems(list.id)).toEqual([]);
    expect(await db.getPayments(list.id)).toEqual([]);
    expect(await db.getMemberships(list.id)).toEqual([]);
    expect(await db.pendingOutboxEntries()).toEqual([]);
    expect(localStorage.getItem("shopping-list:store-owner")).toBe("user-2");
  });
});
