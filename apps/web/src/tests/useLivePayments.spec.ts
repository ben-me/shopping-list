import "fake-indexeddb/auto";

import { effectScope, ref } from "vue";
import type { Payment } from "@shopping-list/api/domain";
import { useLivePayments } from "../composables/useLivePayments";
import { db } from "../db";
import { settle } from "./support/app";

function payment(id: string, listId: string, paidAt: string, amountInCents = 100): Payment {
  return {
    id,
    listId,
    memberId: "user-1",
    amountInCents,
    paidAt,
    createdAt: paidAt,
    updatedAt: paidAt,
  };
}

/** Mount the hook in its own scope, the way a screen's setup does. */
function mountLivePayments(listId = ref("list-1")) {
  const scope = effectScope();
  const payments = scope.run(() => useLivePayments(listId))!;
  return { payments, listId, stop: () => scope.stop() };
}

beforeEach(async () => {
  await db.payments.clear();
  await db.outbox.clear();
});

describe("useLivePayments", () => {
  it("fills in from the local database, newest first", async () => {
    await db.putPayment(payment("pay-old", "list-1", "2026-01-01T10:00:00.000Z"));
    await db.putPayment(payment("pay-new", "list-1", "2026-02-01T10:00:00.000Z"));
    const { payments, stop } = mountLivePayments();

    await settle();

    expect(payments.value.map((row) => row.id)).toEqual(["pay-new", "pay-old"]);
    stop();
  });

  it("redraws on a local write, with no read of the List afterwards", async () => {
    await db.putPayment(payment("pay-old", "list-1", "2026-01-01T10:00:00.000Z"));
    const { payments, stop } = mountLivePayments();
    await settle();

    await db.putPayment(payment("pay-new", "list-1", "2026-02-01T10:00:00.000Z"));
    await settle();

    expect(payments.value.map((row) => row.id)).toEqual(["pay-new", "pay-old"]);
    stop();
  });

  it("redraws on a write the app did not make, such as a Payment arriving from the server", async () => {
    await db.putPayment(payment("pay-1", "list-1", "2026-01-01T10:00:00.000Z", 1250));
    const { payments, stop } = mountLivePayments();
    await settle();

    await db.syncPayment(payment("pay-1", "list-1", "2026-01-01T10:00:00.000Z", 990));
    await settle();

    expect(payments.value[0]?.amountInCents).toBe(990);
    stop();
  });

  it("drops a Payment the database no longer holds", async () => {
    await db.putPayment(payment("pay-1", "list-1", "2026-01-01T10:00:00.000Z"));
    const { payments, stop } = mountLivePayments();
    await settle();

    await db.deletePayment("pay-1", "list-1");
    await settle();

    expect(payments.value).toHaveLength(0);
    stop();
  });

  it("switches to another List's Payments, never showing the old List's", async () => {
    await db.putPayment(payment("pay-1", "list-1", "2026-01-01T10:00:00.000Z"));
    await db.putPayment(payment("pay-2", "list-2", "2026-01-02T10:00:00.000Z"));
    const { payments, listId, stop } = mountLivePayments();
    await settle();
    expect(payments.value).toHaveLength(1);

    listId.value = "list-2";
    await settle();

    expect(payments.value.map((row) => row.id)).toEqual(["pay-2"]);
    stop();
  });

  it("stops following the database once the screen is gone", async () => {
    await db.putPayment(payment("pay-1", "list-1", "2026-01-01T10:00:00.000Z"));
    const { payments, stop } = mountLivePayments();
    await settle();
    stop();

    await db.putPayment(payment("pay-2", "list-1", "2026-01-02T10:00:00.000Z"));
    await settle();

    expect(payments.value).toHaveLength(1);
  });
});
