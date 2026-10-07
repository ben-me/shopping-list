import type { Ref } from "vue";
import type { Item } from "@shopping-list/api/domain";
import { db } from "../db";
import { useDexieLiveData } from "./useDexieLiveData";

/** The Items of a List, live from the Store. */
export function useLiveItems(listId: Ref<string>): Ref<Item[]> {
  return useDexieLiveData([listId], () => db.getItems(listId.value), []);
}
