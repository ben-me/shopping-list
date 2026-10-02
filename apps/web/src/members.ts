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

/** A screen labels a Member it has no name for with this, never with their raw id. */
export const UNKNOWN_MEMBER_NAME = "Member";

/**
 * Everyone with access to a List as the local Store knows them, with the names
 * the last Sync pulled — the same rows the server sends, Owner first, so both
 * the Payments ledger and the Members sheet read one place. A Member the device
 * has no name for yet reads as {@link UNKNOWN_MEMBER_NAME}.
 */
export async function localMembers(db: ShoppingDb, list: List): Promise<MemberDetails[]> {
  const [memberIds, names, memberships] = await Promise.all([
    memberIdsOf(db, list),
    db.getMemberNames(),
    db.getMemberships(list.id),
  ]);
  const joinedAt = new Map(memberships.map((row) => [row.memberId, row.joinedAt]));
  return memberIds.map((memberId) => ({
    memberId,
    name: names[memberId] ?? UNKNOWN_MEMBER_NAME,
    // The Owner holds no Membership row; they joined by creating the List.
    joinedAt: joinedAt.get(memberId) ?? list.createdAt,
  }));
}

/**
 * Pull the server's Member set for a List and mirror it locally, replacing the
 * List's whole local set: rows the server no longer returns are dropped, and
 * every server row is stored (the Owner is implied, so their pseudo-row is
 * filtered out). Their names go in beside those rows, keyed by Member, so both
 * name-labelling screens keep reading them offline. After an Invitation is
 * accepted server-side, this is how every device learns who the Members are —
 * both the invitee's and the Owner's — so the Split/standing re-divides for the
 * real group, and picks up the new Member's name with them.
 *
 * Returns the named rows the server sent. An unexpected payload mirrors nothing
 * and returns an empty set.
 */
export async function syncMembershipsFromServer(
  db: ShoppingDb,
  listId: string,
): Promise<MemberDetails[]> {
  const [body, list] = await Promise.all([
    apiFetch<{ members?: MemberDetails[] }>(`/api/lists/${listId}/members`),
    db.getList(listId),
  ]);
  if (!body?.members || !list) {
    return [];
  }
  await db.replaceMemberships(
    listId,
    body.members
      .filter((member) => member.memberId !== list.ownerId)
      .map((member) => ({ listId, memberId: member.memberId, joinedAt: member.joinedAt })),
  );
  await db.putMemberNames(body.members.map(({ memberId, name }) => ({ memberId, name })));
  return body.members;
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
