import type { Item, List } from "@shopping-list/api/domain";
import { apiFetch } from "./api";
import type { ShoppingDb } from "./store";

export async function createList(db: ShoppingDb, ownerId: string, name: string): Promise<List> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Give the list a name");
  }
  const list: List = {
    id: crypto.randomUUID(),
    ownerId,
    name: trimmed,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.putList(list);
  await syncOutbox(db).catch(() => undefined);
  return list;
}

export async function syncOutbox(db: ShoppingDb): Promise<void> {
  await db.drainOutbox(async (entry) => {
    if (entry.targetType === "list") {
      const list = await db.getList(entry.targetId);
      if (list) {
        const { list: serverList } = await apiFetch<{ list: List }>(`/api/lists/${list.id}`, {
          method: "PUT",
          body: { name: list.name },
        });
        if (serverList?.id) {
          await db.syncList(serverList);
        }
      }
      return;
    }
    if (entry.targetType === "item") {
      if (entry.operation === "delete") {
        await apiFetch(`/api/lists/${entry.listId}/items/${entry.targetId}`, {
          method: "DELETE",
        });
        return;
      }
      const item = await db.getItem(entry.targetId);
      if (item) {
        const { item: serverItem } = await apiFetch<{ item: Item }>(
          `/api/lists/${item.listId}/items/${item.id}`,
          {
            method: "PUT",
            body: { name: item.name, checked: item.checked, checkedAt: item.checkedAt },
          },
        );
        if (serverItem?.id) {
          await db.syncItem(serverItem);
        }
      }
      return;
    }
    throw new Error(`Unsupported outbox target ${entry.targetType}`);
  });
}

export async function syncFromServer(db: ShoppingDb): Promise<void> {
  const { lists } = await apiFetch<{ lists: List[] }>("/api/lists");
  for (const list of lists) {
    await db.syncList(list);
  }
}

const now = () => new Date().toISOString();
