import { and, asc, eq } from "drizzle-orm";
import type { List, MemberDetails, Membership } from "../domain";
import { now, type Db } from "../db";
import * as schema from "../schema";

export async function getMembership(db: Db, key: MembershipKey): Promise<Membership | undefined> {
  const row = await db
    .select()
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.listId, key.listId), eq(schema.memberships.memberId, key.memberId)),
    )
    .get();
  return row ? toMembership(row) : undefined;
}

export async function getMembershipsByList(db: Db, listId: string): Promise<Membership[]> {
  const rows = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.listId, listId))
    .orderBy(asc(schema.memberships.joinedAt));
  return rows.map(toMembership);
}

/**
 * Everyone with access to a List, named: the Owner first (creation time as
 * joinedAt), then joined Members in joined order — the same order
 * `memberIdsOf` reproduces client-side from stored Memberships.
 */
export async function getMembersWithNames(db: Db, list: List): Promise<MemberDetails[]> {
  const ownerRow = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, list.ownerId))
    .get();
  const memberRows = await db
    .select({
      memberId: schema.memberships.memberId,
      name: schema.user.name,
      joinedAt: schema.memberships.joinedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.memberships.memberId, schema.user.id))
    .where(eq(schema.memberships.listId, list.id))
    .orderBy(asc(schema.memberships.joinedAt));
  const owner = ownerRow
    ? { memberId: list.ownerId, name: ownerRow.name, joinedAt: list.createdAt }
    : undefined;
  return owner ? [owner, ...memberRows] : memberRows;
}

export async function createMembership(db: Db, key: MembershipKey): Promise<Membership> {
  const [row] = await db
    .insert(schema.memberships)
    .values({ listId: key.listId, memberId: key.memberId, joinedAt: now() })
    .returning();
  return toMembership(row);
}

export async function deleteMembership(db: Db, key: MembershipKey): Promise<boolean> {
  const rows = await db
    .delete(schema.memberships)
    .where(
      and(eq(schema.memberships.listId, key.listId), eq(schema.memberships.memberId, key.memberId)),
    )
    .returning({ listId: schema.memberships.listId });
  return rows.length > 0;
}

/**
 * A user can act on a List when they are its Owner or hold a Membership row.
 * The Owner is always treated as a Member even before any Membership exists.
 */
export async function isMember(db: Db, list: List, memberId: string): Promise<boolean> {
  if (list.ownerId === memberId) {
    return true;
  }
  const row = await db
    .select({ listId: schema.memberships.listId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.listId, list.id), eq(schema.memberships.memberId, memberId)))
    .get();
  return row !== undefined;
}

export interface MembershipKey {
  listId: string;
  memberId: string;
}

function toMembership(row: typeof schema.memberships.$inferSelect): Membership {
  return { ...row };
}
