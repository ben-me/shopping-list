import type { Ref } from "vue";
import type { MemberDetails } from "@shopping-list/api/domain";
import { db } from "../db";
import { localMembers } from "../members";
import { useDexieLiveData } from "./useDexieLiveData";

/** Everyone with access to a List, live from the Store, Owner first. */
export function useLiveMembers(listId: Ref<string>): Ref<MemberDetails[]> {
  return useDexieLiveData(
    [listId],
    async () => {
      const list = await db.getList(listId.value);
      return list ? await localMembers(db, list) : [];
    },
    [],
  );
}
