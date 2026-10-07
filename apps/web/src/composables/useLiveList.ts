import type { Ref } from "vue";
import type { List } from "@shopping-list/api/domain";
import { db } from "../db";
import { useDexieLiveData } from "./useDexieLiveData";

/** One List, live from the Store; null while the Store does not hold it. */
export function useLiveList(listId: Ref<string>): Ref<List | null> {
  return useDexieLiveData([listId], async () => (await db.getList(listId.value)) ?? null, null);
}
