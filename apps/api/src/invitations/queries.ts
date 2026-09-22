import { and, asc, eq } from "drizzle-orm";
import type { Invitation, InvitationStatus, ListInvitation, PendingInvitation } from "../domain";
import { newId, now, type Db, touch } from "../db";
import * as schema from "../schema";
import { normalizeEmail } from "../users/queries";

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

export async function getInvitationsByListWithContext(
  db: Db,
  listId: string,
): Promise<ListInvitation[]> {
  const rows = await db
    .select({
      invitation: schema.invitations,
      invitedByName: schema.user.name,
    })
    .from(schema.invitations)
    .innerJoin(schema.user, eq(schema.invitations.invitedById, schema.user.id))
    .where(eq(schema.invitations.listId, listId))
    .orderBy(asc(schema.invitations.createdAt));
  return rows.map((row) => toListInvitation(row.invitation, row.invitedByName));
}

/**
 * The invitee's in-app inbox (ADR 0003): pending Invitations for one email,
 * each carrying the List name and the inviting Owner's name.
 */
export async function getPendingInvitationsForEmail(
  db: Db,
  email: string,
): Promise<PendingInvitation[]> {
  const rows = await db
    .select({
      invitation: schema.invitations,
      listName: schema.lists.name,
      invitedByName: schema.user.name,
    })
    .from(schema.invitations)
    .innerJoin(schema.lists, eq(schema.invitations.listId, schema.lists.id))
    .innerJoin(schema.user, eq(schema.invitations.invitedById, schema.user.id))
    .where(
      and(
        eq(schema.invitations.email, normalizeEmail(email)),
        eq(schema.invitations.status, "pending"),
      ),
    )
    .orderBy(asc(schema.invitations.createdAt));
  return rows.map(
    (row) =>
      ({
        id: row.invitation.id,
        listId: row.invitation.listId,
        listName: row.listName,
        invitedById: row.invitation.invitedById,
        invitedByName: row.invitedByName,
        createdAt: row.invitation.createdAt,
      }) satisfies PendingInvitation,
  );
}

/** True while a pending Invitation for that List and email already exists. */
export async function hasPendingInvitationForListAndEmail(
  db: Db,
  listId: string,
  email: string,
): Promise<boolean> {
  const row = await db
    .select({ id: schema.invitations.id })
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.listId, listId),
        eq(schema.invitations.email, normalizeEmail(email)),
        eq(schema.invitations.status, "pending"),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
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

function toInvitation(row: typeof schema.invitations.$inferSelect): Invitation {
  return { ...row, status: row.status as InvitationStatus };
}

function toListInvitation(
  row: typeof schema.invitations.$inferSelect,
  invitedByName: string,
): ListInvitation {
  return {
    id: row.id,
    listId: row.listId,
    email: row.email,
    invitedById: row.invitedById,
    invitedByName,
    status: row.status as InvitationStatus,
    createdAt: row.createdAt,
  };
}
