import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { List, Payment } from "@shopping-list/api/domain";
import { db } from "../db";
import { addPayment, removePayment, syncPaymentsFromServer, updatePayment } from "../payments";
import { syncOutbox } from "../lists";
import { _resetSession } from "../session";

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Record every request the sync makes so tests can assert the exact server
 * contract. The default handler answers any Payment PUT with the server's
 * canonical echo of the write.
 */
function stubServer(
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined,
) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input: string | URL | Request, init?) => {
    const url = typeof input === "string" ? input : String(input);
    requests.push({ url, init });
    const handled = await handler?.(url, init);
    if (handled) {
      return handled;
    }
    if (init?.method === "PUT" && url.includes("/payments/")) {
      return jsonResponse({ payment: { ...JSON.parse(String(init.body)), updatedAt: "server" } });
    }
    if (init?.method === "DELETE" && url.includes("/payments/")) {
      return jsonResponse({ ok: true });
    }
    throw new Error(`No stub for ${url} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { requests, fetchImpl };
}

beforeEach(async () => {
  await db.lists.clear();
  await db.items.clear();
  await db.payments.clear();
  await db.outbox.clear();
  await db.syncList(list);
  _resetSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Payments on a List", () => {
  it("records a Payment offline: it appears immediately and is queued for Sync", async () => {
    stubServer();

    const payment = await addPayment(db, list.id, "user-1", "12.5", "2026-02-01T10:00:00.000Z");

    // The user enters euros ("12.5" = €12.50); the store keeps cents.
    expect(payment).toMatchObject({
      listId: list.id,
      memberId: "user-1",
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    expect((await db.getPayments(list.id)).map((p) => p.amountInCents)).toEqual([1250]);
    const pending = await db.pendingOutboxEntries();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      targetType: "payment",
      targetId: payment.id,
      listId: list.id,
      operation: "update",
    });
  });

  it("rejects a Payment with an invalid euro amount or without a date", async () => {
    stubServer();

    await expect(addPayment(db, list.id, "user-1", "0", "2026-02-01")).rejects.toThrow(
      "Give the payment a positive amount",
    );
    await expect(addPayment(db, list.id, "user-1", "-5", "2026-02-01")).rejects.toThrow(
      "Give the payment a positive amount",
    );
    await expect(addPayment(db, list.id, "user-1", "abc", "2026-02-01")).rejects.toThrow(
      "Give the payment a positive amount",
    );
    await expect(addPayment(db, list.id, "user-1", "12.5", "")).rejects.toThrow(
      "Give the payment a date",
    );

    expect(await db.getPayments(list.id)).toHaveLength(0);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("cuts extra decimals to whole cents instead of rounding", async () => {
    stubServer();

    // The cut happens on the typed digits, before any float exists:
    // "12.999" cuts to €12.99 instead of rounding up to €13.00.
    const cut = await addPayment(db, list.id, "user-1", "12.999", "2026-02-01");
    expect(cut.amountInCents).toBe(1299);

    // "4.35" lands on 435 cents exactly — digits in, cents out, no noise.
    const exact = await addPayment(db, list.id, "user-1", "4.35", "2026-02-01");
    expect(exact.amountInCents).toBe(435);

    // A comma counts as a decimal mark and cuts the same way: "0,999" → €0.99.
    const comma = await addPayment(db, list.id, "user-1", "0,999", "2026-02-01");
    expect(comma.amountInCents).toBe(99);

    expect(
      await db
        .getPayments(list.id)
        .then((ps) => ps.map((p) => p.amountInCents).sort((a, b) => a - b)),
    ).toEqual([99, 435, 1299]);
  });

  it("accepts a comma or a dot as the decimal mark and never the euro sign", async () => {
    stubServer();

    const comma = await addPayment(db, list.id, "user-1", "12,50", "2026-02-01");
    expect(comma.amountInCents).toBe(1250);

    const dot = await addPayment(db, list.id, "user-1", "12.50", "2026-02-01");
    expect(dot.amountInCents).toBe(1250);

    const bare = await addPayment(db, list.id, "user-1", "12", "2026-02-01");
    expect(bare.amountInCents).toBe(1200);

    // The euro sign never arrives as part of the value; a mixed sign is rejected.
    await expect(addPayment(db, list.id, "user-1", "12,50€", "2026-02-01")).rejects.toThrow(
      "Give the payment a positive amount",
    );

    expect(await db.getPayments(list.id)).toHaveLength(3);
  });

  it("edits a Payment's amount and date offline and queues the change for Sync", async () => {
    stubServer();
    const payment = await addPayment(db, list.id, "user-1", "12.5", "2026-02-01T10:00:00.000Z");

    // "20.84" euros must land on exactly 2084 cents.
    const updated = await updatePayment(db, payment, {
      amountInEur: "20.84",
      paidAt: "2026-02-03T18:30:00.000Z",
    });

    expect(updated).toMatchObject({ amountInCents: 2084, paidAt: "2026-02-03T18:30:00.000Z" });
    const stored = (await db.getPayments(list.id))[0];
    expect(stored).toMatchObject({ amountInCents: 2084, paidAt: "2026-02-03T18:30:00.000Z" });
    const pending = await db.pendingOutboxEntries();
    expect(pending).toHaveLength(2);
    expect(pending[1]).toMatchObject({ targetType: "payment", operation: "update" });
  });

  it("removes a Payment offline and queues the delete for Sync", async () => {
    stubServer();
    const payment = await addPayment(db, list.id, "user-1", "12.5", "2026-02-01T10:00:00.000Z");

    await removePayment(db, payment);

    expect(await db.getPayments(list.id)).toHaveLength(0);
    const pending = await db.pendingOutboxEntries();
    expect(pending.map((e) => e.operation)).toEqual(["update", "delete"]);
    expect(pending[1]).toMatchObject({
      targetType: "payment",
      targetId: payment.id,
      listId: list.id,
    });
  });

  it("syncs a queued Payment to the server when the connection returns", async () => {
    const { requests } = stubServer();
    const payment = await addPayment(db, list.id, "user-1", "12.5", "2026-02-01T10:00:00.000Z");
    await updatePayment(db, payment, { amountInEur: "9.9" });

    await syncOutbox(db);
    await flushPromises();

    const puts = requests.filter((r) => r.init?.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[1]?.url).toBe(`/api/lists/${list.id}/payments/${payment.id}`);
    expect(JSON.parse((puts[1]?.init?.body as string) ?? "{}")).toMatchObject({
      amountInCents: 990,
      paidAt: "2026-02-01T10:00:00.000Z",
    });
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("syncs a queued Payment delete to the server when the connection returns", async () => {
    const { requests } = stubServer();
    const payment = await addPayment(db, list.id, "user-1", "12.5", "2026-02-01T10:00:00.000Z");
    await removePayment(db, payment);

    await syncOutbox(db);
    await flushPromises();

    const del = requests.find((r) => r.init?.method === "DELETE");
    expect(del?.url).toBe(`/api/lists/${list.id}/payments/${payment.id}`);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("keeps a Payment entry pending when the server is unreachable so Sync retries later", async () => {
    stubServer(() => new Response(null, { status: 503 }));
    await addPayment(db, list.id, "user-1", "12.5", "2026-02-01T10:00:00.000Z");

    await expect(syncOutbox(db)).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
    });

    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("pulls the server's Payments for a List into the Store without queueing anything", async () => {
    const serverPayments: Payment[] = [
      {
        id: "pay-server-1",
        listId: list.id,
        memberId: "user-2",
        amountInCents: 2500,
        paidAt: "2026-02-01T10:00:00.000Z",
        createdAt: "2026-02-01T09:00:00.000Z",
        updatedAt: "2026-02-01T10:00:00.000Z",
      },
      {
        id: "pay-server-2",
        listId: list.id,
        memberId: "user-1",
        amountInCents: 700,
        paidAt: "2026-02-02T10:00:00.000Z",
        createdAt: "2026-02-02T09:00:00.000Z",
        updatedAt: "2026-02-02T10:00:00.000Z",
      },
    ];
    stubServer((url) => {
      if (url === `/api/lists/${list.id}/payments`) {
        return jsonResponse({ payments: serverPayments });
      }
      return undefined;
    });

    await syncPaymentsFromServer(db, list.id);

    expect(await db.getPayments(list.id)).toEqual(serverPayments);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });
});
