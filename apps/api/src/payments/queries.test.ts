import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createD1Connection, type Db } from "../db";
import { createList } from "../lists/queries";
import { runMigrations, startMiniflare } from "../test-support";
import * as paymentsQueries from "./queries";

describe("payments query helpers", () => {
  let mf: Miniflare;
  let db: Db;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-payments-queries-db");
    const devDb = await mf.getD1Database("devDb");
    await runMigrations(devDb);
    db = createD1Connection(devDb);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates, reads, updates, and deletes Payment rows", async () => {
    const list = await createList(db, { ownerId: "u-owner", name: "Shop" });
    const payment = await paymentsQueries.createPayment(db, {
      listId: list.id,
      memberId: "u-buyer",
      amountInCents: 1275,
      paidAt: "2026-08-27T09:00:00.000Z",
    });

    expect(payment.amountInCents).toBe(1275);
    await expect(paymentsQueries.getPayment(db, payment.id)).resolves.toEqual(payment);

    const updated = await paymentsQueries.updatePayment(db, payment.id, { amountInCents: 1500 });
    expect(updated?.amountInCents).toBe(1500);

    const payments = await paymentsQueries.getPaymentsByList(db, list.id);
    expect(payments.map((p) => p.id)).toContain(payment.id);

    await expect(paymentsQueries.deletePayment(db, payment.id)).resolves.toBe(true);
  });
});
