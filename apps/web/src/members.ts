import type { List, MemberDetails } from "@shopping-list/api/domain";
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
 * Everyone with access to a List, Owner first, with names. Online-only, like
 * the Invitation flow it belongs to: names never reach the offline Store —
 * the UI reads them on demand and the Store keeps Membership rows only.
 */
export async function listMembers(listId: string): Promise<MemberDetails[]> {
  const body = await apiFetch<{ members?: MemberDetails[] }>(`/api/lists/${listId}/members`);
  return body?.members ?? [];
}

/**
 * Pull the server's Member set for a List and mirror the Membership rows
 * locally, replacing the List's whole local set: rows the server no longer
 * returns are dropped, and every server row is stored (the Owner is implied,
 * so their pseudo-row is filtered out). After an Invitation is accepted
 * server-side, this is how every device learns who the Members are — both
 * the invitee's and the Owner's — so the Split/standing re-divides for the
 * real group.
 */
export async function syncMembershipsFromServer(db: ShoppingDb, listId: string): Promise<void> {
  const [body, list] = await Promise.all([
    apiFetch<{ members?: MemberDetails[] }>(`/api/lists/${listId}/members`),
    db.getList(listId),
  ]);
  if (!body?.members || !list) {
    return;
  }
  await db.replaceMemberships(
    listId,
    body.members
      .filter((member) => member.memberId !== list.ownerId)
      .map((member) => ({ listId, memberId: member.memberId, joinedAt: member.joinedAt })),
  );
}

/**
 * A Member leaves a List they joined (ADR 0003). Online-only like the rest of
 * the membership flow — it mediates access between accounts, so it never
 * queues in the offline outbox. The server drops the Membership first; only
 * then does the local List (with its Items, Payments and queued writes) go,
 * so a failed leave never leaves the device with a half-removed List.
 */
export async function leaveList(db: ShoppingDb, listId: string): Promise<void> {
  await apiFetch(`/api/lists/${listId}/membership`, { method: "DELETE" });
  await db.removeList(listId);
}
