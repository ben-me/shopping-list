import type { List } from "@shopping-list/api/domain";
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
    if (entry.targetType !== "list") {
      throw new Error(`Unsupported outbox target ${entry.targetType}`);
    }
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
  });
}

export async function syncFromServer(db: ShoppingDb): Promise<void> {
  const { lists } = await apiFetch<{ lists: List[] }>("/api/lists");
  for (const list of lists) {
    await db.syncList(list);
  }
}

const now = () => new Date().toISOString();
