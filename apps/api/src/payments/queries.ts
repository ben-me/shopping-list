import { desc, eq } from "drizzle-orm";
import type { Payment } from "../domain";
import { newId, now, type Db, touch } from "../db";
import * as schema from "../schema";

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
      id: input.id ?? newId(),
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

export interface CreatePaymentInput {
  /** The client picks the id when creating offline-first so Sync can upsert. */
  id?: string;
  listId: string;
  memberId: string;
  amountInCents: number;
  paidAt: string;
}

export interface UpdatePaymentInput {
  amountInCents?: number;
  paidAt?: string;
}

function toPayment(row: typeof schema.payments.$inferSelect): Payment {
  return { ...row };
}
