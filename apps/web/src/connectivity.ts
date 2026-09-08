import { ref } from "vue";
import { syncFromServer, syncOutbox } from "./lists";
import type { ShoppingDb } from "./store";
import { ignoreRejection } from "./utils/fireAndForget";

/**
 * Whether the device currently has a connection, mirrored from the browser's
 * `online`/`offline` events. The UI reads this to show the offline banner;
 * it starts optimistic (`true`) and is corrected by the first install or event.
 */
export const online = ref(true);

/**
 * One full Sync pass: push every pending outbox write up as a patch, then
 * pull the accumulated remote state back over the local copy. Fails (and is
 * silently ignored by callers) while offline — the outbox simply keeps the
 * queued writes for the next attempt.
 */
export async function syncNow(db: ShoppingDb): Promise<void> {
  await syncOutbox(db);
  await syncFromServer(db);
}

/**
 * Keep the device in sync without user action. Installs listeners that:
 *
 * - mirror the browser's connection state into {@link online}; and
 * - run {@link syncNow} when the connection returns or the app becomes
 *   visible again while online (the classic mobile "walked back into
 *   signal" moment).
 *
 * Every sync failure is swallowed — being offline is normal, and the outbox
 * retries on the next trigger. Returns a cleanup that removes the listeners.
 */
export function startSyncWatcher(db: ShoppingDb): () => void {
  const markOffline = () => {
    online.value = false;
  };
  const syncIfOnline = () => {
    if (online.value && document.visibilityState === "visible") {
      void ignoreRejection(syncNow(db));
    }
  };
  const markOnlineAndSync = () => {
    online.value = true;
    void ignoreRejection(syncNow(db));
  };

  online.value = navigator.onLine;
  window.addEventListener("online", markOnlineAndSync);
  window.addEventListener("offline", markOffline);
  document.addEventListener("visibilitychange", syncIfOnline);

  return () => {
    window.removeEventListener("online", markOnlineAndSync);
    window.removeEventListener("offline", markOffline);
    document.removeEventListener("visibilitychange", syncIfOnline);
  };
}
