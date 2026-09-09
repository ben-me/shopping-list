import { ref } from "vue";
import { syncFromServer, syncOutbox } from "./lists";
import type { ShoppingDb } from "./store";
import { ignoreRejection } from "./utils/fireAndForget";

export const online = ref(true);

/** A per-view sync that runs after the shared part of every pass. */
type ViewSync = (db: ShoppingDb) => Promise<void>;
const viewSyncs = new Set<ViewSync>();
export function onSyncPass(viewSync: ViewSync): () => void {
  viewSyncs.add(viewSync);
  return () => {
    viewSyncs.delete(viewSync);
  };
}

/**
 * One Sync pass — the single place that owns the ordering invariant: the
 * outbox drains BEFORE anything is pulled, so a pull can never overwrite the
 * local state that queued writes describe. A successful drain is followed by
 * pruning synced outbox rows past the retention window, bounding the table.
 * After the shared Lists pull, every
 * registered per-view sync runs in turn.
 *
 * A pass already in flight wins: concurrent triggers (the browser firing
 * `online` twice, a reconnect racing a visibility change) collapse into the
 * running pass instead of double-draining the same outbox entries. Fails
 * (and is silently ignored by callers) while offline — the outbox simply
 * keeps the queued writes for the next attempt.
 */
let syncPassInFlight = false;
export async function runSyncPass(db: ShoppingDb): Promise<void> {
  if (syncPassInFlight) {
    return;
  }
  syncPassInFlight = true;
  try {
    await syncOutbox(db);
    await ignoreRejection(db.pruneSyncedOutbox());
    await syncFromServer(db);
    for (const viewSync of viewSyncs) {
      await ignoreRejection(viewSync(db));
    }
  } finally {
    syncPassInFlight = false;
  }
}

/**
 * Keep the device in sync without user action. Installs listeners that:
 *
 * - mirror the browser's connection state into {@link online}; and
 * - run one {@link runSyncPass} when the connection returns or the app
 *   becomes visible again while online (the classic mobile "walked back
 *   into signal" moment — mobile browsers do not always fire `online`
 *   reliably, and the event can fire while the app is hidden).
 *
 * This watcher is the only reconnect trigger in the app; views subscribe
 * with {@link onSyncPass} rather than listening for `online` themselves, so
 * a reconnect drains the outbox exactly once. Every sync failure is
 * swallowed — being offline is normal, and the outbox retries on the next
 * trigger. Returns a cleanup that removes the listeners.
 */
export function startSyncWatcher(db: ShoppingDb): () => void {
  const markOffline = () => {
    online.value = false;
  };
  const syncIfOnline = () => {
    if (online.value && document.visibilityState === "visible") {
      void ignoreRejection(runSyncPass(db));
    }
  };
  const markOnlineAndSync = () => {
    online.value = true;
    void ignoreRejection(runSyncPass(db));
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
