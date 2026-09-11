import type { ShoppingDb } from "./store";

const STORE_ACCOUNT_KEY = "shopping-list:store-account";

/**
 * Scope the local Store to one User (the Store's account). The device's
 * IndexedDB is shared by everyone who signs in on it, but the offline copy is
 * only ever *this* User's mirror of the server — so when a different User
 * becomes the session, the previous User's rows are wiped and a fresh account
 * can never see (or sync) someone else's Lists, offline or not.
 *
 * The first User on a device (no account recorded) keeps the Store as-is
 * (an existing install's offline copy). Signing back in as the same User is
 * a no-op; sign-out already empties the Store (session.ts), so this wipe is
 * only the backstop for the device changing hands without a sign-out.
 *
 * Known limitation (why the first-use rule exists): a marker-less Store is
 * treated as a pre-fix install, so if localStorage alone is lost while
 * IndexedDB survives, a later sign-in keeps whatever rows are already there.
 * That is the price of not destroying an existing user's offline copy on
 * upgrade; the Sync reconcile (`syncFromServer`) then drops any Lists the
 * server does not return for the new account the moment the device is online.
 *
 * The account marker lives in localStorage (same pattern as the session
 * cache). If storage is unavailable the marker is simply lost: the Store is
 * kept rather than wiped, never the reverse.
 */
export async function ensureStoreForUser(db: ShoppingDb, userId: string): Promise<void> {
  const account = readStoreAccount();
  if (account === userId) {
    return;
  }
  if (account !== null) {
    await db.clearAll();
  }
  writeStoreAccount(userId);
}

function readStoreAccount(): string | null {
  try {
    return localStorage.getItem(STORE_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function writeStoreAccount(userId: string): void {
  try {
    localStorage.setItem(STORE_ACCOUNT_KEY, userId);
  } catch {
    // Storage unavailable (private mode, quota): the marker is an
    // optimisation for deciding whether to wipe, never a correctness gate.
  }
}
