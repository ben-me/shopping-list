import type { List } from "@shopping-list/api/domain";
import type { ShoppingDb } from "./store";

/**
 * The Members of a List, as the local Store knows them. The Owner always
 * counts as a Member even before a Membership row exists (the server's
 * `isMember` semantics); everyone holding a Membership row joins after them.
 * A departed Member holds no Membership and never appears, even though their
 * Payments stay in the pot.
 *
 * Order is deterministic — Owner first, then Members in joined order — and it
 * matters to the Split: `computeOwed` spreads the cent remainder across
 * Members in the order they appear, so the order must be stable across
 * reloads for the figures to be reproducible.
 */
export async function memberIdsOf(db: ShoppingDb, list: List): Promise<string[]> {
  const memberships = await db.getMemberships(list.id);
  return [...new Set([list.ownerId, ...memberships.map((membership) => membership.memberId)])];
}
