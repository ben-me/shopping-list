import { eq, inArray, or } from "drizzle-orm";
import type { List } from "../domain";
import { newId, now, type Db, touch } from "../db";
import * as schema from "../schema";

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
      id: input.id ?? newId(),
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

export interface CreateListInput {
  /** The client picks the id when creating offline-first so Sync can upsert. */
  id?: string;
  ownerId: string;
  name: string;
}

export interface UpdateListInput {
  name?: string;
}

function toList(row: typeof schema.lists.$inferSelect): List {
  return { ...row };
}
