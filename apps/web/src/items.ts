import type { Item } from "@shopping-list/api/domain";
import { apiFetch } from "./api";
import type { ShoppingDb } from "./store";

export async function addItem(db: ShoppingDb, listId: string, name: string): Promise<Item> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Give the item a name");
  }
  const timestamp = now();
  const item: Item = {
    id: crypto.randomUUID(),
    listId,
    name: trimmed,
    checked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.putItem(item);
  return item;
}

/**
 * Tick or un-tick an Item. Checking off is an act of its own — no Payment is
 * ever recorded or touched here. Ticking stamps `checkedAt`; un-ticking clears it.
 */
export async function setItemChecked(db: ShoppingDb, item: Item, checked: boolean): Promise<Item> {
  const timestamp = now();
  const updated: Item = {
    ...item,
    checked,
    checkedAt: checked ? timestamp : undefined,
    updatedAt: timestamp,
  };
  await db.putItem(updated);
  return updated;
}

export async function removeItem(db: ShoppingDb, item: Item): Promise<void> {
  await db.deleteItem(item.id, item.listId);
}

/** Pull the server's Items for a List into the Store (server is authoritative). */
export async function syncItemsFromServer(db: ShoppingDb, listId: string): Promise<void> {
  const { items } = await apiFetch<{ items: Item[] }>(`/api/lists/${listId}/items`);
  for (const item of items) {
    await db.syncItem(item);
  }
}

const now = () => new Date().toISOString();
