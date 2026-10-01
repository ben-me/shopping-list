import type { Item, ItemUpdate, List, Payment, PaymentUpdate } from "@shopping-list/api/domain";
import { apiFetch } from "./api";
import type { ShoppingDb } from "./store";
import now from "./utils/now";

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

/**
 * Send everything queued, one send at a time. A caller arriving mid-send asks
 * for one more round rather than starting a second send, which would race the
 * first to the server with the same row and could leave the server behind the
 * device. The returned promise settles after that extra round.
 */
let currentSend: Promise<void> | null = null;
let roundRequested = false;
export function syncOutbox(db: ShoppingDb): Promise<void> {
  if (currentSend) {
    roundRequested = true;
    return currentSend;
  }
  currentSend = sendInRounds(db).finally(() => {
    currentSend = null;
  });
  return currentSend;
}

/* One repeat is enough however many callers queued up behind it. */
async function sendInRounds(db: ShoppingDb): Promise<void> {
  do {
    roundRequested = false;
    await db.drainOutbox(async (entry) => {
      if (entry.targetType === "list") {
        const list = await db.getList(entry.targetId);
        if (!list) {
          return;
        }
        const { list: serverList } = await apiFetch<{ list: List }>(`/api/lists/${list.id}`, {
          method: "PUT",
          body: { name: list.name },
        });
        if (!serverList?.id) {
          return;
        }
        await db.syncList(serverList);
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
        if (!item) {
          return;
        }
        const itemUpdate: ItemUpdate = {
          name: item.name,
          checked: item.checked,
          checkedAt: item.checkedAt,
        };
        const { item: serverItem } = await apiFetch<{ item: Item }>(
          `/api/lists/${item.listId}/items/${item.id}`,
          {
            method: "PUT",
            body: itemUpdate,
          },
        );
        if (!serverItem?.id) {
          return;
        }
        await db.syncItem(serverItem);
        return;
      }
      if (entry.targetType === "payment") {
        if (entry.operation === "delete") {
          await apiFetch(`/api/lists/${entry.listId}/payments/${entry.targetId}`, {
            method: "DELETE",
          });
          return;
        }
        const payment = await db.getPayment(entry.targetId);
        if (!payment) {
          return;
        }
        const paymentUpdate: PaymentUpdate = {
          amountInCents: payment.amountInCents,
          paidAt: payment.paidAt,
        };
        const { payment: serverPayment } = await apiFetch<{ payment: Payment }>(
          `/api/lists/${payment.listId}/payments/${payment.id}`,
          {
            method: "PUT",
            body: paymentUpdate,
          },
        );
        if (!serverPayment?.id) {
          return;
        }
        await db.syncPayment(serverPayment);
        return;
      }
      throw new Error(`Unsupported outbox target ${entry.targetType}`);
    });
  } while (roundRequested);
}

/* Drops local Lists the server no longer returns (revoked membership, another
   user's leftovers). The outbox drains first, so just-pushed Lists survive. */
export async function syncFromServer(db: ShoppingDb): Promise<void> {
  const { lists } = await apiFetch<{ lists: List[] }>("/api/lists");
  if (!lists) {
    return;
  }
  const serverListIds = new Set(lists.map((list) => list.id));
  const localLists = await db.getLists();
  for (const localList of localLists) {
    if (!serverListIds.has(localList.id)) {
      await db.removeList(localList.id);
    }
  }
  for (const list of lists) {
    if (!list?.id) {
      continue;
    }
    await db.syncList(list);
  }
}
