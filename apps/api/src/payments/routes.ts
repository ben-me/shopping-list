import type { PaymentUpdate } from "../domain";
import { BadRequestError, ForbiddenError, NotFoundError } from "../errors";
import { requireMember, requireUser } from "../guards";
import type { App } from "../http";
import { getRequestContext, readJsonBody } from "../http";
import {
  createPayment,
  deletePayment,
  getPayment,
  getPaymentsByList,
  updatePayment,
} from "./queries";
import type { Db } from "../db";

export function registerPaymentRoutes(app: App) {
  app.get("/api/lists/:listId/payments", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    const payments = await getPaymentsByList(db, listId);
    return c.json({ payments });
  });

  // Partial update so concurrent edits of one Payment reconcile per field (ADR 0001).
  app.put("/api/lists/:listId/payments/:paymentId", requireUser, requireMember, async (c) => {
    const { db, listId, paymentId } = getRequestContext(c);
    const paymentUpdate = readPaymentUpdateFromBody(await readJsonBody(c));
    const existingPayment = await getPaymentBelongingToList(db, listId, paymentId);
    if (existingPayment) {
      if (existingPayment.memberId !== c.get("user").id) {
        throw new ForbiddenError("You can only edit your own payments");
      }
      const payment = await updatePayment(db, paymentId, paymentUpdate);
      if (!payment) {
        throw new NotFoundError("Payment not found");
      }
      return c.json({ payment }, 200);
    }
    if (paymentUpdate.amountInCents === undefined || paymentUpdate.paidAt === undefined) {
      throw new BadRequestError("A Payment needs an amount in cents and a date");
    }
    const payment = await createPayment(db, {
      id: paymentId,
      listId,
      memberId: c.get("user").id,
      amountInCents: paymentUpdate.amountInCents,
      paidAt: paymentUpdate.paidAt,
    });
    return c.json({ payment }, 201);
  });

  // Idempotent: an offline delete can be replayed.
  app.delete("/api/lists/:listId/payments/:paymentId", requireUser, requireMember, async (c) => {
    const { db, listId, paymentId } = getRequestContext(c);
    const existingPayment = await getPaymentBelongingToList(db, listId, paymentId);
    if (existingPayment && existingPayment.memberId !== c.get("user").id) {
      throw new ForbiddenError("You can only delete your own payments");
    }
    await deletePayment(db, paymentId);
    return c.json({ ok: true });
  });
}

// A cross-List id is a 404, never a cross-List read.
async function getPaymentBelongingToList(db: Db, listId: string, paymentId: string) {
  const existingPayment = await getPayment(db, paymentId);
  if (existingPayment && existingPayment.listId !== listId) {
    throw new NotFoundError("Payment not found");
  }
  return existingPayment;
}

function isPaymentUpdateBody(value: unknown): value is PaymentUpdate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { amountInCents, paidAt } = value as Record<string, unknown>;
  if (
    amountInCents !== undefined &&
    (typeof amountInCents !== "number" || !Number.isInteger(amountInCents) || amountInCents <= 0)
  ) {
    return false;
  }
  if (paidAt !== undefined && (typeof paidAt !== "string" || paidAt.trim() === "")) {
    return false;
  }
  return amountInCents !== undefined || paidAt !== undefined;
}

function readPaymentUpdateFromBody(body: unknown) {
  if (!isPaymentUpdateBody(body)) {
    throw new BadRequestError("A Payment needs an amount in cents and a date");
  }
  const update: PaymentUpdate = {};
  if (body.amountInCents !== undefined) {
    update.amountInCents = body.amountInCents;
  }
  if (body.paidAt !== undefined) {
    update.paidAt = body.paidAt.trim();
  }
  return update;
}
