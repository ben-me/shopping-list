import { asc, eq } from "drizzle-orm";
import type { Item } from "../domain";
import { newId, now, type Db, touch } from "../db";
import * as schema from "../schema";

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
      id: input.id ?? newId(),
      listId: input.listId,
      name: input.name,
      checked: input.checked ?? false,
      checkedAt: input.checked === true ? (input.checkedAt ?? timestamp) : undefined,
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

export interface CreateItemInput {
  /** The client picks the id when creating offline-first so Sync can upsert. */
  id?: string;
  listId: string;
  name: string;
  checked?: boolean;
  checkedAt?: string;
}

export interface UpdateItemInput {
  name?: string;
  checked?: boolean;
  checkedAt?: string;
}

function toItem(row: typeof schema.items.$inferSelect): Item {
  return { ...row, checkedAt: row.checkedAt ?? undefined };
}
