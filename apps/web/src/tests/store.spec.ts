import "fake-indexeddb/auto";

import { OUTBOX_RETENTION_MS, ShoppingDb } from "../store";
import type { Item, List, Membership, Payment } from "@shopping-list/api/domain";

let dbNumber = 0;

const now = () => new Date().toISOString();

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: now(),
  updatedAt: now(),
};

function item(id: string, name: string): Item {
  return {
    id,
    listId: list.id,
    name,
    checked: false,
    createdAt: now(),
    updatedAt: now(),
  };
}

function payment(id: string, memberId: string, amountInCents: number): Payment {
  return {
    id,
    listId: list.id,
    memberId,
    amountInCents,
    paidAt: now(),
    createdAt: now(),
    updatedAt: now(),
  };
}

const milk = item("item-1", "Milk");
const bread = item("item-2", "Bread");
const pay1 = payment("pay-1", "user-1", 1250);

let db: ShoppingDb;

beforeEach(() => {
  dbNumber += 1;
  db = new ShoppingDb(`test-db-${dbNumber}`);
});

describe("ShoppingDb", () => {
  it("round-trips Lists, Items, and Payments through the local database with no network", async () => {
    await db.putList(list);
    await db.putItem(milk);
    await db.putItem(bread);
    await db.putPayment(pay1);

    expect(await db.getLists()).toEqual([list]);
    expect(await db.getItems(list.id)).toEqual([milk, bread]);
    expect(await db.getPayments(list.id)).toEqual([pay1]);
  });

  it("round-trips Memberships through the local database with no network", async () => {
    const membership: Membership = { listId: list.id, memberId: "user-2", joinedAt: now() };
    await db.syncMembership(membership);

    expect(await db.getMemberships(list.id)).toEqual([membership]);
  });

  it("syncs a List into the local Store without queuing an outbox write", async () => {
    await db.syncList(list);

    expect(await db.getLists()).toEqual([list]);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("captures a write made with no connection into the outbox, tagged for the next Sync", async () => {
    await db.putItem(item("item-1", "Milk"));

    const pending = await db.pendingOutboxEntries();

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      targetType: "item",
      targetId: "item-1",
      listId: list.id,
      operation: "update",
      syncedAt: null,
    });
  });

  it("captures an Item delete in the outbox with the List id, even though the row is gone", async () => {
    await db.putItem(milk);
    await db.deleteItem(milk.id, list.id);

    const pending = await db.pendingOutboxEntries();

    expect(pending).toHaveLength(2);
    expect(pending[1]).toMatchObject({
      targetType: "item",
      targetId: milk.id,
      listId: list.id,
      operation: "delete",
    });
  });

  it("syncs an Item from the server into the local Store without queuing an outbox write", async () => {
    const serverItem = { ...milk, checked: true, checkedAt: now() };
    await db.syncItem(serverItem);

    expect(await db.getItems(list.id)).toEqual([serverItem]);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("reads a single Item by id", async () => {
    await db.putItem(milk);

    expect(await db.getItem(milk.id)).toEqual(milk);
    expect(await db.getItem("item-nope")).toBeUndefined();
  });

  it("drains captured outbox entries through a transport and clears them", async () => {
    await db.putItem(item("item-1", "Milk"));
    const transport = vi.fn<() => Promise<void>>(async () => {});

    const drained = await db.drainOutbox(transport);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(drained).toHaveLength(1);
    expect(await db.pendingOutboxEntries()).toEqual([]);
  });

  it("leaves an entry pending when the transport fails so the next Sync retries it", async () => {
    await db.putItem(item("item-1", "Milk"));
    const transport = vi.fn<() => Promise<void>>(async () => {
      throw new Error("no connection");
    });

    await expect(db.drainOutbox(transport)).rejects.toThrow("no connection");

    expect(await db.pendingOutboxEntries()).toHaveLength(1);
    expect((await db.pendingOutboxEntries())[0]?.syncedAt).toBeNull();
  });

  it("prunes synced outbox rows past the retention window, keeping pending and fresh synced rows", async () => {
    const ms = (n: number) => new Date(Date.now() - n).toISOString();
    const stale = ms(OUTBOX_RETENTION_MS + 60_000);
    const fresh = ms(60_000);
    await db.outbox.bulkAdd([
      {
        targetType: "item",
        targetId: "old-1",
        operation: "update",
        queuedAt: stale,
        syncedAt: stale,
      },
      {
        targetType: "item",
        targetId: "fresh-1",
        operation: "update",
        queuedAt: fresh,
        syncedAt: fresh,
      },
      {
        targetType: "item",
        targetId: "pending-1",
        operation: "update",
        queuedAt: fresh,
        syncedAt: null,
      },
    ]);

    await db.pruneSyncedOutbox();

    const remaining = await db.outbox.toArray();
    expect(remaining.map((entry) => entry.targetId).sort()).toEqual(["fresh-1", "pending-1"]);
  });

  it("does not resurrect an Item the local outbox still owes a delete for", async () => {
    await db.putItem(milk);
    await db.deleteItem(milk.id, list.id);

    // A pull that was in flight when the Item was removed comes back with the
    // server's copy — it must not undo the local delete.
    await db.syncItem(milk);

    expect(await db.getItem(milk.id)).toBeUndefined();
    expect(await db.pendingOutboxEntries()).toHaveLength(2);
  });

  it("does not clobber a newer local edit with an older server copy of the same Item", async () => {
    const stale = "2026-09-01T00:00:00.000Z";
    const olderServerCopy: Item = { ...milk, name: "Milk", checked: false, updatedAt: stale };
    const newerLocalEdit: Item = {
      ...milk,
      checked: true,
      checkedAt: now(),
      updatedAt: "2026-09-02T00:00:00.000Z",
    };
    await db.putItem({ ...newerLocalEdit });

    // A pull issued before the tick (and still holding the old server state)
    // must not overwrite the newer local edit that is queued for Sync.
    await db.syncItem(olderServerCopy);

    expect(await db.getItem(milk.id)).toMatchObject({
      checked: true,
      updatedAt: newerLocalEdit.updatedAt,
    });
  });

  it("applies a server copy that is newer than the local Item", async () => {
    await db.putItem({ ...milk, updatedAt: "2026-09-01T00:00:00.000Z" });
    const newerServerCopy: Item = {
      ...milk,
      name: "Oat milk",
      updatedAt: "2026-09-02T00:00:00.000Z",
    };

    await db.syncItem(newerServerCopy);

    expect(await db.getItem(milk.id)).toMatchObject({ name: "Oat milk" });
  });

  it("applies a pulled Payment as its own row — a second Payment is never merged into it", async () => {
    const ms = (n: number) => new Date(Date.now() - n).toISOString();
    await db.putPayment({ ...pay1, updatedAt: ms(120_000) });
    const newerServerCopy: Payment = {
      ...pay1,
      amountInCents: 990,
      updatedAt: ms(60_000),
    };
    const otherPayment = payment("pay-2", "user-2", 700);

    await db.syncPayment(newerServerCopy);
    await db.syncPayment(otherPayment);

    const stored = await db.getPayments(list.id);
    expect(stored).toHaveLength(2);
    expect(stored.find((p) => p.id === pay1.id)).toMatchObject({ amountInCents: 990 });
    expect(stored.find((p) => p.id === otherPayment.id)).toMatchObject({ amountInCents: 700 });
  });

  it("does not resurrect a Payment the local outbox still owes a delete for", async () => {
    await db.putPayment(pay1);
    await db.deletePayment(pay1.id, list.id);

    // A pull that was in flight when the Payment was removed comes back with
    // the server's copy — it must not undo the local delete.
    await db.syncPayment(pay1);

    expect(await db.getPayments(list.id)).toHaveLength(0);
  });

  it("does not clobber a newer local edit with an older server copy of a Payment", async () => {
    const ms = (n: number) => new Date(Date.now() - n).toISOString();
    const newerLocalUpdatedAt = ms(60_000);
    await db.putPayment({ ...pay1, amountInCents: 990, updatedAt: newerLocalUpdatedAt });

    await db.syncPayment({ ...pay1, amountInCents: 1250, updatedAt: ms(120_000) });

    expect(await db.getPayments(list.id)).toHaveLength(1);
    expect((await db.getPayments(list.id))[0]).toMatchObject({
      amountInCents: 990,
      updatedAt: newerLocalUpdatedAt,
    });
  });

  it("queues a Payment delete with the List id so Sync can address the server", async () => {
    await db.putPayment(pay1);
    await db.deletePayment(pay1.id, list.id);

    const pending = await db.pendingOutboxEntries();
    expect(pending[1]).toMatchObject({
      targetType: "payment",
      targetId: pay1.id,
      listId: list.id,
      operation: "delete",
    });
  });
});
