import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShoppingStore } from "../store";
import type { Item, List, Payment } from "@shopping-list/api/domain";

let dbNumber = 0;

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  splitRule: "equal",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

function item(id: string, name: string): Item {
  return {
    id,
    listId: list.id,
    name,
    checked: false,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function payment(id: string, memberId: string, amountInCents: number): Payment {
  return {
    id,
    listId: list.id,
    memberId,
    amountInCents,
    paidAt: "2026-08-26T00:00:00.000Z",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

let store: ShoppingStore;

beforeEach(() => {
  dbNumber += 1;
  store = new ShoppingStore(`test-db-${dbNumber}`);
});

describe("ShoppingStore", () => {
  it("round-trips Lists, Items, and Payments through the local database with no network", async () => {
    await store.putList(list);
    await store.putItem(item("item-1", "Milk"));
    await store.putItem(item("item-2", "Bread"));
    await store.putPayment(payment("pay-1", "user-1", 1250));

    expect(await store.lists()).toEqual([list]);
    expect(await store.items(list.id)).toEqual([item("item-1", "Milk"), item("item-2", "Bread")]);
    expect(await store.payments(list.id)).toEqual([payment("pay-1", "user-1", 1250)]);
  });

  it("captures a write made with no connection into the outbox, tagged for the next Sync", async () => {
    await store.putItem(item("item-1", "Milk"));

    const pending = await store.pendingOutbox();

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      targetType: "item",
      targetId: "item-1",
      operation: "update",
      syncedAt: null,
    });
  });

  it("drains captured outbox entries through a transport and clears them", async () => {
    await store.putItem(item("item-1", "Milk"));
    const transport = vi.fn<() => Promise<void>>(async () => {});

    const drained = await store.drainOutbox(transport);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(drained).toHaveLength(1);
    expect(await store.pendingOutbox()).toEqual([]);
  });

  it("leaves an entry pending when the transport fails so the next Sync retries it", async () => {
    await store.putItem(item("item-1", "Milk"));
    const transport = vi.fn<() => Promise<void>>(async () => {
      throw new Error("no connection");
    });

    await expect(store.drainOutbox(transport)).rejects.toThrow("no connection");

    expect(await store.pendingOutbox()).toHaveLength(1);
    expect((await store.pendingOutbox())[0]?.syncedAt).toBeNull();
  });
});
