import "fake-indexeddb/auto";

import { effectScope, ref } from "vue";
import type { Item } from "@shopping-list/api/domain";
import { useDexieLiveData } from "../composables/useDexieLiveData";
import { db } from "../db";
import { settle } from "./support/app";

function item(id: string, name: string): Item {
  return {
    id,
    listId: "list-1",
    name,
    checked: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Mount the read in its own scope, the way a screen's setup does. */
function mountLiveItems(listId = ref("list-1")) {
  const scope = effectScope();
  const items = scope.run(() => useDexieLiveData([listId], () => db.getItems(listId.value), []))!;
  return { items, listId, stop: () => scope.stop() };
}

beforeEach(async () => {
  await db.lists.clear();
  await db.items.clear();
  await db.payments.clear();
  await db.outbox.clear();
});

describe("useLiveItems", () => {
  it("fills in from the local database without being asked", async () => {
    await db.putItem(item("item-1", "Milk"));
    await db.putItem(item("item-2", "Bread"));
    const { items, stop } = mountLiveItems();

    await settle();

    expect(items.value.map((row) => row.name)).toEqual(["Milk", "Bread"]);
    stop();
  });

  it("redraws on a local write, with no read of the list afterwards", async () => {
    await db.putItem(item("item-1", "Milk"));
    const { items, stop } = mountLiveItems();
    await settle();

    await db.putItem({ ...item("item-2", "Bread") });
    await settle();

    expect(items.value.map((row) => row.name)).toEqual(["Milk", "Bread"]);
    stop();
  });

  it("redraws on a write the app did not make, such as a copy arriving from the server", async () => {
    await db.putItem(item("item-1", "Milk"));
    const { items, stop } = mountLiveItems();
    await settle();

    await db.syncItem({ ...item("item-1", "Milk"), checked: true });
    await settle();

    expect(items.value[0]?.checked).toBe(true);
    stop();
  });

  it("switches to another List's Items, never showing the old List's", async () => {
    await db.putItem(item("item-1", "Milk"));
    await db.putItem({ ...item("item-2", "Bread"), listId: "list-2" });
    const { items, listId, stop } = mountLiveItems();
    await settle();
    expect(items.value).toHaveLength(1);

    listId.value = "list-2";
    await settle();

    expect(items.value.map((row) => row.name)).toEqual(["Bread"]);
    stop();
  });

  it("stops following the database once the screen is gone", async () => {
    await db.putItem(item("item-1", "Milk"));
    const { items, stop } = mountLiveItems();
    await settle();
    stop();

    await db.putItem(item("item-2", "Bread"));
    await settle();

    expect(items.value).toHaveLength(1);
  });
});
