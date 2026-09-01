import "fake-indexeddb/auto";

import { ShoppingDb } from "../store";
import type { Item, List, Payment } from "@shopping-list/api/domain";

let dbNumber = 0;

const now = () => new Date().toISOString();

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  splitRule: "equal",
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

  it("captures a write made with no connection into the outbox, tagged for the next Sync", async () => {
    await db.putItem(item("item-1", "Milk"));

    const pending = await db.pendingOutboxEntries();

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      targetType: "item",
      targetId: "item-1",
      operation: "update",
      syncedAt: null,
    });
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
});
