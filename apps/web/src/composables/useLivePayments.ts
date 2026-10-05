import { liveQuery } from "dexie";
import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { Payment } from "@shopping-list/api/domain";
import { db } from "../db";

/**
 * The Payments of a List, straight from the database, newest first: Dexie hands
 * back the current rows whenever `payments` is written, so a record, an edit, a
 * delete and a Payment pulled from the server all reach the ledger through this
 * one subscription. Empty until the first read, and emptied on a List change so
 * rows belonging to another List are never shown.
 */
export function useLivePayments(listId: Ref<string>): Ref<Payment[]> {
  const payments = ref<Payment[]>([]) as Ref<Payment[]>;
  let subscription: { unsubscribe(): void } | null = null;

  const stop = watch(
    listId,
    (id) => {
      subscription?.unsubscribe();
      payments.value = [];
      subscription = liveQuery(async () => (await db.getPayments(id)).reverse()).subscribe({
        next: (rows: Payment[]) => {
          payments.value = rows;
        },
        error: (err: unknown) => {
          console.error("Reading the payments failed", err);
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

  return payments;
}
