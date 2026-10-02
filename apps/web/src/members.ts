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

/** How a screen labels a Member it has no synced name for. */
export const UNKNOWN_MEMBER_NAME = "Member";

/**
 * Everyone with access to a List as the Store knows them, Owner first, with the
 * names the last Sync pulled.
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
    joinedAt: joinedAt.get(memberId) ?? list.createdAt,
  }));
}

/**
 * Pull the server's Member set for a List and mirror it locally, replacing the
 * List's whole local set: Membership rows and names, the Owner's pseudo-row
 * filtered out. After an Invitation is accepted server-side, this is how every
 * device learns who the Members are, so the Split/standing re-divides for the
 * real group — with the new Member's name.
 *
 * Returns the named rows the server sent. An unexpected payload mirrors nothing.
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
