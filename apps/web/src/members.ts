import type { List, Membership } from "@shopping-list/api/domain";
import { apiFetch } from "./api";
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

/**
 * Pull a List's Membership rows from the server and mirror them locally (the
 * inbound half of a Sync, like items and payments). After an Invitation is
 * accepted server-side, this is how every device learns who the Members are
 * — both the invitee's and the Owner's — so the Split/standing re-divides for
 * the real group.
 */
export async function syncMembershipsFromServer(db: ShoppingDb, listId: string): Promise<void> {
  const body = await apiFetch<{ memberships?: Membership[] }>(`/api/lists/${listId}/members`);
  if (!body?.memberships) {
    return;
  }
  await db.replaceMemberships(listId, body.memberships);
}
