import type { Item } from "@shopping-list/api/domain";
import { readIfModified } from "./api";
import type { ShoppingDb } from "./store";
import now from "./utils/now";

export async function addItem(db: ShoppingDb, listId: string, name: string): Promise<Item> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Give the item a name");
  }
  const timestamp = now();
  const position = (await db.getItems(listId)).reduce(
    (max, item) => Math.max(max, item.position),
    -1,
  );
  const item: Item = {
    id: crypto.randomUUID(),
    listId,
    name: trimmed,
    checked: false,
    position: position + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.putItem(item);
  return item;
}

export async function removeItem(db: ShoppingDb, item: Item): Promise<void> {
  await db.deleteItem(item.id, item.listId);
}

/** Pull the server's copy of a List's Items into the Store. */
export async function syncItemsFromServer(db: ShoppingDb, listId: string): Promise<void> {
  const { modified, body } = await readIfModified<{ items?: Item[] }>(`/api/lists/${listId}/items`);
  if (!modified) {
    return;
  }
  for (const item of body?.items ?? []) {
    await db.syncItem(item);
  }
}
