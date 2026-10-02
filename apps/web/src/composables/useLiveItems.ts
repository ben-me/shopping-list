import { liveQuery } from "dexie";
import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { Item } from "@shopping-list/api/domain";
import { db } from "../db";

/**
 * The Items of a List, straight from the database: Dexie hands back the current
 * rows whenever `items` is written, so a tap, an add, a remove and a copy
 * arriving from the server all reach the screen through this one subscription.
 * Empty until the first read, and emptied on a List change so rows belonging to
 * another List are never shown.
 */
export function useLiveItems(listId: Ref<string>): Ref<Item[]> {
  const items = ref<Item[]>([]) as Ref<Item[]>;
  let subscription: { unsubscribe(): void } | null = null;

  const stop = watch(
    listId,
    (id) => {
      subscription?.unsubscribe();
      items.value = [];
      subscription = liveQuery(() => db.getItems(id)).subscribe({
        next: (rows: Item[]) => {
          items.value = rows;
        },
        error: (err: unknown) => {
          console.error("Reading the items failed", err);
        },
      });
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    stop();
    subscription?.unsubscribe();
    subscription = null;
  });

  return items;
}
