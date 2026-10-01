import { liveQuery } from "dexie";
import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { List } from "@shopping-list/api/domain";
import { db } from "../db";

/**
 * One List, straight from the database: the same read the Items screen makes,
 * so the app bar's name and the List's pen colour can only ever be the row the
 * Store holds. A rename pulled from the server, a List removed because the
 * membership went, and switching to another List all arrive through this one
 * subscription — there is no second copy of a List anywhere to fall behind.
 *
 * `null` until the first read lands and whenever the Store does not hold the
 * List at all.
 */
export function useLiveList(listId: Ref<string>): Ref<List | null> {
  const list = ref<List | null>(null) as Ref<List | null>;
  let subscription: { unsubscribe(): void } | null = null;

  const stop = watch(
    listId,
    (id) => {
      subscription?.unsubscribe();
      list.value = null;
      subscription = liveQuery(() => db.getList(id)).subscribe({
        next: (loaded: List | undefined) => {
          list.value = loaded ?? null;
        },
        error: (err: unknown) => {
          console.error("Reading the list failed", err);
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

  return list;
}
