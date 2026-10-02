import { onMounted, onUnmounted, ref } from "vue";
import { syncFromServer, syncOutbox } from "./lists";
import type { ShoppingDb } from "./store";
import { ignoreRejection } from "./utils/fireAndForget";
import { createSingleFlight } from "./utils/singleFlight";

export const online = ref(true);

/**
 * What a Sync pass refreshes. `global` (the default) reconciles the whole
 * device — the Lists index and the pending-invitation inbox — then fans out
 * to every per-view sync. `list` is the lighter pull a List screen needs: it
 * still drains the outbox first (the ordering invariant) and fans out, but
 * skips the app-wide Lists and invitation state the screen does not render,
 * so opening or switching a List never drags the global endpoints along.
 */
export type SyncScope = "global" | "list";

/** A per-view sync that runs after the shared part of every pass. */
type ViewSync = (db: ShoppingDb) => Promise<void>;
interface ViewSyncEntry {
  handler: ViewSync;
  /** Read app-wide state (Lists index, invitation inbox): skipped by list-scoped passes. */
  globalOnly: boolean;
}
const viewSyncs = new Set<ViewSyncEntry>();
/**
 * Subscribe a per-view sync to every pass. Mark `globalOnly` for syncs that
 * read app-wide state — the Lists index, the invitation inbox — so they run
 * in global passes only and not in the lighter passes List screens start.
 */
export function onSyncPass(viewSync: ViewSync, opts?: { globalOnly?: boolean }): () => void {
  const entry: ViewSyncEntry = { handler: viewSync, globalOnly: opts?.globalOnly ?? false };
  viewSyncs.add(entry);
  return () => {
    viewSyncs.delete(entry);
  };
}

/**
 * Subscribe a view to Sync for exactly as long as it is mounted: the
 * subscription goes in on mount and comes out on unmount, so a screen never
 * outlives its own subscription. Every view wants this shape, and it keeps
 * the stop handle out of the screens that only care about their own sync.
 */
export function useSyncPass(handler: ViewSync): void {
  let stop: (() => void) | null = null;
  onMounted(() => {
    stop = onSyncPass(handler);
  });
  onUnmounted(() => {
    stop?.();
    stop = null;
  });
}

/** Global is the wider pass: a global request widens a queued rerun, a list request never narrows it. */
const widerScope = (queued: SyncScope, requested: SyncScope): SyncScope =>
  requested === "global" || queued === "global" ? "global" : "list";

/**
 * A pass already in flight wins: concurrent triggers (the browser firing
 * `online` twice, a reconnect racing a visibility change) collapse into the
 * running pass instead of double-draining the same outbox entries. A call
 * arriving mid-pass queues one rerun — the pass is allowed to finish, then runs
 * once more so a user-triggered action is never lost to the collapse guard, the
 * classic "accept an invitation just as the mount sync starts" race — and the
 * caller awaits the running pass *and* that rerun, so it observes the
 * post-action state.
 */
const syncPass = createSingleFlight<SyncScope>(widerScope);

/**
 * Run one Sync pass at a time — the single place that owns the ordering
 * invariant: the outbox drains BEFORE anything is pulled, so a pull can never
 * overwrite the local state that queued writes describe. A successful drain is
 * followed by pruning synced outbox rows past the retention window, bounding the
 * table. Then the Lists index is pulled (global passes only — see
 * {@link SyncScope}) and every registered per-view sync runs in turn.
 *
 * Fails (and is silently ignored by callers) while offline — the outbox simply
 * keeps the queued writes for the next attempt.
 */
export function runSyncPass(db: ShoppingDb, scope: SyncScope = "global"): Promise<void> {
  return syncPass.run(scope, (passScope) => runPass(db, passScope));
}

/** What one pass does. The flight owns when this runs and how often it repeats. */
async function runPass(db: ShoppingDb, scope: SyncScope): Promise<void> {
  await syncOutbox(db);
  await ignoreRejection(db.pruneSyncedOutbox());
  if (scope === "global") {
    await syncFromServer(db);
  }
  for (const entry of viewSyncs) {
    if (entry.globalOnly && scope !== "global") {
      continue;
    }
    await ignoreRejection(entry.handler(db));
  }
}

/**
 * How often the open app re-syncs without any user action: changes that
 * happened elsewhere while this device stayed online — a new Invitation, a
 * List renamed, a Membership revoked — arrive within this window even when
 * the user sits on a List screen the whole time. Visibility-gated below, so
 * a hidden tab never polls.
 */
export const SYNC_POLL_MS = 60_000;

/**
 * Keep the device in sync without user action. Installs listeners that:
 *
 * - mirror the browser's connection state into {@link online};
 * - run one {@link runSyncPass} when the connection returns or the app
 *   becomes visible again while online (the classic mobile "walked back
 *   into signal" moment — mobile browsers do not always fire `online`
 *   reliably, and the event can fire while the app is hidden); and
 * - poll once per {@link SYNC_POLL_MS} while online and visible, so unseen
 *   changes arrive without waiting for a reconnect or a navigation.
 *
 * This watcher is the only reconnect trigger in the app; views subscribe
 * with {@link onSyncPass} rather than listening for `online` themselves, so
 * a reconnect drains the outbox exactly once. Every sync failure is
 * swallowed — being offline is normal, and the outbox retries on the next
 * trigger. The poll collapses into any pass already in flight (the shared
 * guard), so it can never stack with a reconnect or a view's own pass.
 * Returns a cleanup that removes the listeners and the poll.
 */
export function startSyncWatcher(db: ShoppingDb): () => void {
  const markOffline = () => {
    online.value = false;
  };
  // A hidden tab never syncs, so the visibility gate is shared by the tab
  // switch and the poll rather than written twice.
  const syncIfVisible = () => {
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
  document.addEventListener("visibilitychange", syncIfVisible);
  const pollTimer = setInterval(syncIfVisible, SYNC_POLL_MS);

  return () => {
    window.removeEventListener("online", markOnlineAndSync);
    window.removeEventListener("offline", markOffline);
    document.removeEventListener("visibilitychange", syncIfVisible);
    clearInterval(pollTimer);
  };
}
