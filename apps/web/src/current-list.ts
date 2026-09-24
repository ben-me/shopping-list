import type { List } from "@shopping-list/api/domain";
import type { ShoppingDb } from "./store";

/**
 * The last List read for each id on this device. Switching between a List's
 * Items and Payments remounts the screen, and a screen that can only learn its
 * name from the Store would flash an empty app bar in between — so the List
 * paints from here at once.
 *
 * This is a first paint, never a source of truth: every screen still reads the
 * Store on mount, and a List the Store no longer holds is dropped.
 */
const known = new Map<string, List>();

export function currentList(listId: string): List | null {
  return known.get(listId) ?? null;
}

export function rememberLists(lists: List[]): void {
  for (const list of lists) {
    known.set(list.id, list);
  }
}

export function forgetLists(): void {
  known.clear();
}

/** Read the List from the Store, keeping the first-paint cache in step. */
export async function loadList(db: ShoppingDb, listId: string): Promise<List | null> {
  const list = (await db.getList(listId)) ?? null;
  if (list) {
    rememberLists([list]);
  } else {
    known.delete(listId);
  }
  return list;
}
