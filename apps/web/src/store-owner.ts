import type { ShoppingDb } from "./store";

const STORE_ACCOUNT_KEY = "shopping-list:store-account";

/**
 * Wipe the Store when a *different* User takes over the device. Sign-out
 * already empties the Store (session.ts); this is the backstop for device
 * hand-overs without a sign-out. A Store with no recorded user is kept
 * as-is: wiping it could destroy a pre-fix install's offline copy, and the
 * server reconcile (syncFromServer) drops foreign rows once online.
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
    // Losing the marker keeps the Store, never wipes it.
  }
}
