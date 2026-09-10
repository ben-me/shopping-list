import type { Payment } from "@shopping-list/api/domain";
import { apiFetch } from "./api";
import type { ShoppingDb } from "./store";
import now from "./utils/now";

/**
 * Record a Payment: a free amount in EUR minor units and a date, standing on
 * its own — never attached to an Item. The Payment is recorded by the Member
 * calling this (`memberId` is the signed-in user's id); no one records on
 * behalf of someone else.
 */
export async function addPayment(
  db: ShoppingDb,
  listId: string,
  memberId: string,
  amountInCents: number,
  paidAt: string,
): Promise<Payment> {
  if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
    throw new Error("Give the payment a positive amount");
  }
  if (!paidAt.trim()) {
    throw new Error("Give the payment a date");
  }
  const timestamp = now();
  const payment: Payment = {
    id: crypto.randomUUID(),
    listId,
    memberId,
    amountInCents,
    paidAt: paidAt.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.putPayment(payment);
  return payment;
}

/**
 * Edit a Payment's amount and/or date. The edit is queued as a whole-row
 * put of the Payment's new state; the server reconciles it last-write-wins
 * against any concurrent edit (ADR 0001).
 */
export async function updatePayment(
  db: ShoppingDb,
  payment: Payment,
  patch: { amountInCents?: number; paidAt?: string },
): Promise<Payment> {
  if (patch.amountInCents !== undefined) {
    if (!Number.isInteger(patch.amountInCents) || patch.amountInCents <= 0) {
      throw new Error("Give the payment a positive amount");
    }
  }
  if (patch.paidAt !== undefined && !patch.paidAt.trim()) {
    throw new Error("Give the payment a date");
  }
  const updated: Payment = {
    ...payment,
    amountInCents: patch.amountInCents ?? payment.amountInCents,
    paidAt: patch.paidAt !== undefined ? patch.paidAt.trim() : payment.paidAt,
    updatedAt: now(),
  };
  await db.putPayment(updated);
  return updated;
}

export async function removePayment(db: ShoppingDb, payment: Payment): Promise<void> {
  await db.deletePayment(payment.id, payment.listId);
}

/** Pull the server's Payments for a List into the Store (server is authoritative). */
export async function syncPaymentsFromServer(db: ShoppingDb, listId: string): Promise<void> {
  const { payments } = await apiFetch<{ payments: Payment[] }>(`/api/lists/${listId}/payments`);
  for (const payment of payments) {
    await db.syncPayment(payment);
  }
}
