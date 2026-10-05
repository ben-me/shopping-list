import { liveQuery } from "dexie";
import { onScopeDispose, ref, type Ref } from "vue";
import { db } from "../db";

/**
 * Every Member name the device holds, keyed by Member id: names belong to the
 * Member, not to a List, so a name stays readable after its holder has left a
 * List — their Payments do. Dexie hands the current set back whenever
 * `memberNames` is written, so a Sync that refreshes a name reaches the rows
 * already on screen. Empty until the first read.
 */
export function useLiveMemberNames(): Ref<Record<string, string>> {
  const names = ref<Record<string, string>>({}) as Ref<Record<string, string>>;
  const subscription = liveQuery(() => db.getMemberNames()).subscribe({
    next: (loaded: Record<string, string>) => {
      names.value = loaded;
    },
    error: (err: unknown) => {
      console.error("Reading the member names failed", err);
    },
  });

  onScopeDispose(() => {
    subscription.unsubscribe();
  });

  return names;
}
