import { liveQuery } from "dexie";
import { ref, watch, type Ref, type WatchSource } from "vue";

/**
 * Reads the Store live: Dexie hands back the current rows on every write,
 * whether the app made it or a Sync pulled it in. The read reruns when a source
 * changes — a new List, say — and the data is emptied first, so rows of the old
 * List are never shown. With no sources it reads once and keeps following.
 */
export function useDexieLiveData<T>(
  sources: WatchSource<unknown>[],
  read: () => Promise<T>,
  empty: T,
): Ref<T> {
  const data = ref(empty) as Ref<T>;

  watch(
    sources,
    (_values, _prev, onCleanup) => {
      data.value = empty;
      const subscription = liveQuery(read).subscribe({
        next: (loaded) => {
          data.value = loaded;
        },
        error: (err: unknown) => {
          console.error("Reading the store failed", err);
        },
      });
      onCleanup(() => subscription.unsubscribe());
    },
    { immediate: true },
  );

  return data;
}
