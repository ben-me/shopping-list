import type { ShoppingDb } from "./store";

const STORE_OWNER_KEY = "shopping-list:store-owner";

/**
 * Scope the local Store to one User. The device's IndexedDB is shared by
 * everyone who signs in on it, but the offline copy is only ever *this*
 * User's mirror of the server — so when a different User becomes the session,
 * the previous User's rows are wiped and a fresh account can never see (or
 * sync) someone else's Lists, offline or not.
 *
 * The first User on a device (no owner recorded) keeps the Store as-is: that
 * is an existing install whose local copy belongs to them. Signing back in as
 * the same User is a no-op, so the offline copy survives sign-out/back-in;
 * the wipe happens strictly on *identity change*.
 *
 * The owner marker lives in localStorage (same pattern as the session cache).
 * If storage is unavailable the marker is simply lost: the Store is kept
 * rather than wiped, never the reverse.
 */
export async function ensureStoreForUser(db: ShoppingDb, userId: string): Promise<void> {
  const owner = readStoreOwner();
  if (owner === userId) {
    return;
  }
  if (owner !== null) {
    await db.clearAll();
  }
  writeStoreOwner(userId);
}

function readStoreOwner(): string | null {
  try {
    return localStorage.getItem(STORE_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeStoreOwner(userId: string): void {
  try {
    localStorage.setItem(STORE_OWNER_KEY, userId);
  } catch {
    // Storage unavailable (private mode, quota): the marker is an
    // optimisation for deciding whether to wipe, never a correctness gate.
  }
}
