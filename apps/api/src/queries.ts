import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "./db";
import * as schema from "./schema";
import type { Invitation, InvitationStatus, Item, List, Membership, Payment } from "./domain";

/**
 * Typed query helpers over the domain tables. Endpoint handlers never touch raw
 * SQL or the drizzle schema directly — they build one `Db` connection per
 * request with `createD1Connection(c.env.devDb)` and call these functions with
 * it. Results come back as the domain shapes from `./domain`.
 */

// ─── Lists ────────────────────────────────────────────────────────────────

export async function getList(db: Db, id: string): Promise<List | undefined> {
  const row = await db.select().from(schema.lists).where(eq(schema.lists.id, id)).get();
  return row ? toList(row) : undefined;
}

export async function getListsForMember(db: Db, memberId: string): Promise<List[]> {
  const rows = await db
    .select()
    .from(schema.lists)
    .where(
      or(
        eq(schema.lists.ownerId, memberId),
        inArray(
          schema.lists.id,
          db
            .select({ id: schema.memberships.listId })
            .from(schema.memberships)
            .where(eq(schema.memberships.memberId, memberId)),
        ),
      ),
    );
  const unique = new Map<string, List>();
  for (const row of rows) {
    unique.set(row.id, toList(row));
  }
  return [...unique.values()];
}

export async function createList(db: Db, input: CreateListInput): Promise<List> {
  const timestamp = now();
  const [row] = await db
    .insert(schema.lists)
    .values({
      id: newId(),
      ownerId: input.ownerId,
      name: input.name,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return toList(row);
}

export async function updateList(
  db: Db,
  id: string,
  input: UpdateListInput,
): Promise<List | undefined> {
  const rows = await db
    .update(schema.lists)
    .set(touch(input))
    .where(eq(schema.lists.id, id))
    .returning();
  return rows[0] ? toList(rows[0]) : undefined;
}

export async function deleteList(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.lists)
    .where(eq(schema.lists.id, id))
    .returning({ id: schema.lists.id });
  return rows.length > 0;
}

// ─── Items ────────────────────────────────────────────────────────────────

export async function getItem(db: Db, id: string): Promise<Item | undefined> {
  const row = await db.select().from(schema.items).where(eq(schema.items.id, id)).get();
  return row ? toItem(row) : undefined;
}

export async function getItemsByList(db: Db, listId: string): Promise<Item[]> {
  const rows = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.listId, listId))
    .orderBy(asc(schema.items.createdAt));
  return rows.map(toItem);
}

export async function createItem(db: Db, input: CreateItemInput): Promise<Item> {
  const timestamp = now();
  const [row] = await db
    .insert(schema.items)
    .values({
      id: newId(),
      listId: input.listId,
      name: input.name,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return toItem(row);
}

export async function updateItem(
  db: Db,
  id: string,
  input: UpdateItemInput,
): Promise<Item | undefined> {
  type ItemPatch = Omit<UpdateItemInput, "checkedAt"> & { checkedAt?: string | null };
  const set: ItemPatch = { ...input };
  if (input.checked === false) {
    set.checkedAt = null;
  }
  if (input.checked === true && input.checkedAt === undefined) {
    set.checkedAt = now();
  }
  const rows = await db
    .update(schema.items)
    .set(touch(set))
    .where(eq(schema.items.id, id))
    .returning();
  return rows[0] ? toItem(rows[0]) : undefined;
}

export async function deleteItem(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.items)
    .where(eq(schema.items.id, id))
    .returning({ id: schema.items.id });
  return rows.length > 0;
}

// ─── Payments ─────────────────────────────────────────────────────────────

export async function getPayment(db: Db, id: string): Promise<Payment | undefined> {
  const row = await db.select().from(schema.payments).where(eq(schema.payments.id, id)).get();
  return row ? toPayment(row) : undefined;
}

export async function getPaymentsByList(db: Db, listId: string): Promise<Payment[]> {
  const rows = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.listId, listId))
    .orderBy(desc(schema.payments.paidAt));
  return rows.map(toPayment);
}

export async function createPayment(db: Db, input: CreatePaymentInput): Promise<Payment> {
  const timestamp = now();
  const [row] = await db
    .insert(schema.payments)
    .values({
      id: newId(),
      listId: input.listId,
      memberId: input.memberId,
      amountInCents: input.amountInCents,
      paidAt: input.paidAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return toPayment(row);
}

export async function updatePayment(
  db: Db,
  id: string,
  input: UpdatePaymentInput,
): Promise<Payment | undefined> {
  const rows = await db
    .update(schema.payments)
    .set(touch(input))
    .where(eq(schema.payments.id, id))
    .returning();
  return rows[0] ? toPayment(rows[0]) : undefined;
}

export async function deletePayment(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.payments)
    .where(eq(schema.payments.id, id))
    .returning({ id: schema.payments.id });
  return rows.length > 0;
}

// ─── Invitations ──────────────────────────────────────────────────────────

export async function getInvitation(db: Db, id: string): Promise<Invitation | undefined> {
  const row = await db.select().from(schema.invitations).where(eq(schema.invitations.id, id)).get();
  return row ? toInvitation(row) : undefined;
}

export async function getInvitationsByList(db: Db, listId: string): Promise<Invitation[]> {
  const rows = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.listId, listId))
    .orderBy(asc(schema.invitations.createdAt));
  return rows.map(toInvitation);
}

export async function createInvitation(db: Db, input: CreateInvitationInput): Promise<Invitation> {
  const timestamp = now();
  const [row] = await db
    .insert(schema.invitations)
    .values({
      id: newId(),
      listId: input.listId,
      email: input.email,
      invitedById: input.invitedById,
      status: "pending",
      token: input.token,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return toInvitation(row);
}

export async function updateInvitation(
  db: Db,
  id: string,
  input: UpdateInvitationInput,
): Promise<Invitation | undefined> {
  const rows = await db
    .update(schema.invitations)
    .set(touch(input))
    .where(eq(schema.invitations.id, id))
    .returning();
  return rows[0] ? toInvitation(rows[0]) : undefined;
}

export async function deleteInvitation(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.invitations)
    .where(eq(schema.invitations.id, id))
    .returning({ id: schema.invitations.id });
  return rows.length > 0;
}

// ─── Memberships ──────────────────────────────────────────────────────────

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

export interface CreateListInput {
  ownerId: string;
  name: string;
}

export interface UpdateListInput {
  name?: string;
}

export interface CreateItemInput {
  listId: string;
  name: string;
}

export interface UpdateItemInput {
  name?: string;
  checked?: boolean;
  checkedAt?: string;
}

export interface CreatePaymentInput {
  listId: string;
  memberId: string;
  amountInCents: number;
  paidAt: string;
}

export interface UpdatePaymentInput {
  amountInCents?: number;
  paidAt?: string;
}

export interface CreateInvitationInput {
  listId: string;
  email: string;
  invitedById: string;
  token: string;
}

export interface UpdateInvitationInput {
  email?: string;
  status?: InvitationStatus;
}

export interface MembershipKey {
  listId: string;
  memberId: string;
}

const now = () => new Date().toISOString();

const newId = () => crypto.randomUUID();

/** Apply an update patch and bump `updatedAt`. */
function touch<T extends object>(patch: T): T & { updatedAt: string } {
  return { ...patch, updatedAt: now() };
}

function toList(row: typeof schema.lists.$inferSelect): List {
  return { ...row };
}

function toItem(row: typeof schema.items.$inferSelect): Item {
  return { ...row, checkedAt: row.checkedAt ?? undefined };
}

function toPayment(row: typeof schema.payments.$inferSelect): Payment {
  return { ...row };
}

function toInvitation(row: typeof schema.invitations.$inferSelect): Invitation {
  return { ...row, status: row.status as InvitationStatus };
}

function toMembership(row: typeof schema.memberships.$inferSelect): Membership {
  return { ...row };
}
