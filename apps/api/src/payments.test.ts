import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./index";
import { createD1Connection, type Db } from "./db";
import { createMembership } from "./queries";
import { runMigrations, startMiniflare, testEnvFor } from "./test-support";
import type { AuthEnv } from "./auth";
import type { ApiErrorEnvelope } from "./errors";
import type { Payment } from "./domain";
import * as schema from "./schema";

function uniq(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

let signupCounter = 0;
function uniqueEmail() {
  signupCounter += 1;
  return `paymentuser${signupCounter}@example.com`;
}

describe("payment endpoints", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: ReturnType<typeof createApp>;
  let db: Db;

  async function getUserId(cookie: string) {
    const res = await app.request("/api/me", { headers: { cookie } }, env);
    const body = (await res.json()) as { user: { id: string } };
    expect(res.status).toBe(200);
    return body.user.id;
  }

  async function signUp() {
    const email = uniqueEmail();
    const res = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Test User", email, password: "password123" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    return { cookie: res.headers.getSetCookie().join("; "), email };
  }

  function putList(cookie: string, listId: string, name: string) {
    return app.request(
      `/api/lists/${listId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name }),
      },
      env,
    );
  }

  function putPayment(cookie: string, listId: string, paymentId: string, body: unknown) {
    return app.request(
      `/api/lists/${listId}/payments/${paymentId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      },
      env,
    );
  }

  function getPayments(cookie: string, listId: string) {
    return app.request(`/api/lists/${listId}/payments`, { headers: { cookie } }, env);
  }

  function deletePayment(cookie: string, listId: string, paymentId: string) {
    return app.request(
      `/api/lists/${listId}/payments/${paymentId}`,
      { method: "DELETE", headers: { cookie } },
      env,
    );
  }

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-payments-db");
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    env = testEnvFor(binding);
    app = createApp();
    db = createD1Connection(binding);
    // Local D1 persists between runs; wipe the domain tables so fixed test ids
    // always start from a clean state. Auth users may remain.
    await db.delete(schema.items);
    await db.delete(schema.payments);
    await db.delete(schema.memberships);
    await db.delete(schema.invitations);
    await db.delete(schema.lists);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("rejects Payment writes without a valid session", async () => {
    const put = await putPayment("", "list-x", "pay-x", { amountInCents: 1250, paidAt: "2026-01-01" });
    expect(put.status).toBe(401);

    const del = await deletePayment("", "list-x", "pay-x");
    expect(del.status).toBe(401);

    const get = await getPayments("", "list-x");
    expect(get.status).toBe(401);
  });

  it("rejects Payment writes from a user who is not a Member of that List", async () => {
    const owner = await signUp();
    const outsider = await signUp();
    const listId = uniq("list");
    await putList(owner.cookie, listId, "Household");

    const put = await putPayment(outsider.cookie, listId, "pay-hijack", {
      amountInCents: 1250,
      paidAt: "2026-01-01",
    });
    expect(put.status).toBe(403);
    const putBody = (await put.json()) as ApiErrorEnvelope;
    expect(putBody.error).toMatchObject({ status: 403, code: "forbidden" });

    const get = await getPayments(outsider.cookie, listId);
    expect(get.status).toBe(403);
  });

  it("records a Payment with an amount and a date; it appears on the List", async () => {
    const { cookie } = await signUp();
    const memberId = await getUserId(cookie);
    const listId = uniq("list");
    const paymentId = uniq("pay");
    await putList(cookie, listId, "Household");

    const res = await putPayment(cookie, listId, paymentId, {
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { payment: Payment };
    expect(body.payment).toMatchObject({
      id: paymentId,
      listId,
      memberId,
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    expect(body.payment.createdAt).toBeTruthy();

    const list = await getPayments(cookie, listId);
    const listBody = (await list.json()) as { payments: Payment[] };
    expect(listBody.payments).toHaveLength(1);
    expect(listBody.payments[0]).toMatchObject({ id: paymentId, amountInCents: 1250 });
  });

  it("edits the amount and date of a Payment and the changes reach the server", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    const paymentId = uniq("pay");
    await putList(cookie, listId, "Household");
    await putPayment(cookie, listId, paymentId, {
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });

    const res = await putPayment(cookie, listId, paymentId, {
      amountInCents: 990,
      paidAt: "2026-02-03T18:30:00.000Z",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payment: Payment };
    expect(body.payment).toMatchObject({ amountInCents: 990, paidAt: "2026-02-03T18:30:00.000Z" });

    // A fresh read is what a reload would see.
    const reread = await getPayments(cookie, listId);
    const rereadBody = (await reread.json()) as { payments: Payment[] };
    expect(rereadBody.payments[0]).toMatchObject({
      id: paymentId,
      amountInCents: 990,
      paidAt: "2026-02-03T18:30:00.000Z",
    });
  });

  it("rejects editing or deleting another Member's Payment", async () => {
    const owner = await signUp();
    const member = await signUp();
    const memberId = await getUserId(member.cookie);
    const listId = uniq("list");
    const paymentId = uniq("pay");
    await putList(owner.cookie, listId, "Household");
    await createMembership(db, { listId, memberId });

    const recorded = await putPayment(member.cookie, listId, paymentId, {
      amountInCents: 500,
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    expect(recorded.status).toBe(201);

    const edit = await putPayment(owner.cookie, listId, paymentId, {
      amountInCents: 9999,
      paidAt: "2026-02-02T10:00:00.000Z",
    });
    expect(edit.status).toBe(403);
    const editBody = (await edit.json()) as ApiErrorEnvelope;
    expect(editBody.error).toMatchObject({ status: 403, code: "forbidden" });

    const del = await deletePayment(owner.cookie, listId, paymentId);
    expect(del.status).toBe(403);

    // The Member's Payment is untouched.
    const payments = ((await (await getPayments(member.cookie, listId)).json()) as {
      payments: Payment[];
    }).payments;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ id: paymentId, amountInCents: 500 });
  });

  it("deletes a Payment and stays idempotent for offline replay", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    const paymentId = uniq("pay");
    await putList(cookie, listId, "Household");
    await putPayment(cookie, listId, paymentId, {
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });

    const del = await deletePayment(cookie, listId, paymentId);
    expect(del.status).toBe(200);
    const replay = await deletePayment(cookie, listId, paymentId);
    expect(replay.status).toBe(200);

    const list = await getPayments(cookie, listId);
    const listBody = (await list.json()) as { payments: Payment[] };
    expect(listBody.payments).toHaveLength(0);
  });

  it("rejects a Payment write through another List's id", async () => {
    const { cookie } = await signUp();
    const listA = uniq("list");
    const listB = uniq("list");
    const paymentId = uniq("pay");
    await putList(cookie, listA, "A");
    await putList(cookie, listB, "B");
    await putPayment(cookie, listA, paymentId, {
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });

    const res = await putPayment(cookie, listB, paymentId, {
      amountInCents: 9999,
      paidAt: "2026-02-02T10:00:00.000Z",
    });
    expect(res.status).toBe(404);
  });

  it("rejects a Payment without an amount or a date", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    await putList(cookie, listId, "Household");

    const noAmount = await putPayment(cookie, listId, uniq("pay"), {
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    expect(noAmount.status).toBe(400);

    const fractional = await putPayment(cookie, listId, uniq("pay"), {
      amountInCents: 12.5,
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    expect(fractional.status).toBe(400);

    const noDate = await putPayment(cookie, listId, uniq("pay"), { amountInCents: 100 });
    expect(noDate.status).toBe(400);
  });

  it("persists two Payments of the same amount on the same day as two rows — no dedupe", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    await putList(cookie, listId, "Household");

    // Two devices each generate their own id for "the same" Payment while
    // offline; both are real events and both must survive the Sync.
    await putPayment(cookie, listId, uniq("pay"), {
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    await putPayment(cookie, listId, uniq("pay"), {
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });

    const res = await getPayments(cookie, listId);
    expect(res.status).toBe(200);
    const { payments } = (await res.json()) as { payments: Payment[] };
    expect(payments).toHaveLength(2);
  });

  it("rejects a Payment write for an unknown List", async () => {
    const { cookie } = await signUp();

    const res = await putPayment(cookie, "list-nowhere", uniq("pay"), {
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    expect(res.status).toBe(404);
  });
});
