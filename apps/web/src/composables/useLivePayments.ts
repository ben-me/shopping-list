import type { Ref } from "vue";
import type { Payment } from "@shopping-list/api/domain";
import { db } from "../db";
import { useDexieLiveData } from "./useDexieLiveData";

/** The Payments of a List, live from the Store, newest first. */
export function useLivePayments(listId: Ref<string>): Ref<Payment[]> {
  return useDexieLiveData([listId], async () => (await db.getPayments(listId.value)).reverse(), []);
}
