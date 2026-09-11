import type { Payment } from "@shopping-list/api/domain";
import { apiFetch } from "./api";
import type { ShoppingDb } from "./store";
import now from "./utils/now";

// The value is a plain number as typed (a comma or a dot may separate the
// decimals). The euro sign is a frontend concern only, never part of the
// value, so there is no sign handling here.
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

/**
 * Edit a Payment's amount (the euro string as the user typed it) and/or date.
 * The edit is queued as a whole-row put of the Payment's new state; the server
 * reconciles it last-write-wins against any concurrent edit (ADR 0001).
 */
export async function updatePayment(
  db: ShoppingDb,
  payment: Payment,
  patch: { amountInEur?: string; paidAt?: string },
): Promise<Payment> {
  let amountInCents = payment.amountInCents;
  if (patch.amountInEur !== undefined) {
    amountInCents = eurosToCents(patch.amountInEur);
  }
  if (patch.paidAt !== undefined && !patch.paidAt.trim()) {
    throw new Error("Give the payment a date");
  }
  const updated: Payment = {
    ...payment,
    amountInCents,
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
