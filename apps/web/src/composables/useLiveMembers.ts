import { liveQuery } from "dexie";
import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { MemberDetails } from "@shopping-list/api/domain";
import { db } from "../db";
import { localMembers } from "../members";

/**
 * Everyone with access to a List, straight from the database: the one
 * {@link localMembers} read the Split is built on, so the Owner is first and the
 * order the cent remainder spreads across is the Store's and not the server
 * payload's. A Membership pulled after an Invitation is accepted, a name
 * refreshed by a Sync, and switching to another List all arrive through this one
 * subscription. Empty until the first read, and emptied on a List change so
 * Members of another List are never shown.
 */
export function useLiveMembers(listId: Ref<string>): Ref<MemberDetails[]> {
  const members = ref<MemberDetails[]>([]);

  const stop = watch(
    listId,
    (id, _prev, onCleanup) => {
      members.value = [];
      const subscription = liveQuery(async () => {
        const list = await db.getList(id);
        return list ? await localMembers(db, list) : [];
      }).subscribe({
        next: (rows: MemberDetails[]) => {
          members.value = rows;
        },
        error: (err: unknown) => {
          console.error("Reading the members failed", err);
        },
      });
      onCleanup(() => subscription.unsubscribe());
    },
    { immediate: true },
  );

  onScopeDispose(stop);

  return members;
}
