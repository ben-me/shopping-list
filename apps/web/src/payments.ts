import type { Payment } from "@shopping-list/api/domain";
import { apiFetch } from "./api";
import type { ShoppingDb } from "./store";
import now from "./utils/now";

// The value is a plain number as typed (a comma or a dot may separate the
// decimals); the euro sign is a frontend concern and never part of the value.
function eurosToCents(amountInEur: string): number {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(amountInEur.trim());
  const cents = match === null ? 0 : Number(match[1] + (match[2] ?? "").slice(0, 2).padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Give the payment a positive amount");
  }
  return cents;
}

export async function addPayment(
  db: ShoppingDb,
  listId: string,
  memberId: string,
  amountInEur: string,
  paidAt: string,
): Promise<Payment> {
  const amountInCents = eurosToCents(amountInEur);
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

/** Edit a Payment's amount (the euro string as typed) and/or date. */
export async function updatePayment(
  db: ShoppingDb,
  id: string,
  listId: string,
  patch: { amountInEur?: string; paidAt?: string },
): Promise<Payment> {
  const edit: { amountInCents?: number; paidAt?: string } = {};
  if (patch.amountInEur !== undefined) {
    edit.amountInCents = eurosToCents(patch.amountInEur);
  }
  if (patch.paidAt !== undefined) {
    if (!patch.paidAt.trim()) {
      throw new Error("Give the payment a date");
    }
    edit.paidAt = patch.paidAt.trim();
  }
  return db.updatePayment(id, listId, edit);
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
