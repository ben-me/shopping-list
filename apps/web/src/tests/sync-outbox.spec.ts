import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { List } from "@shopping-list/api/domain";
import { db } from "../db";
import { addItem, removeItem } from "../items";
import { syncOutbox } from "../lists";
import { addPayment, removePayment, updatePayment } from "../payments";
import { jsonResponse, resetStore, stubApi, type RouteTable } from "./support/app";

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Each kind of row Sync sends: how the app queues one the way a user does,
 * and what the server should be told. Items and Payments travel the same
 * outbox drain, so they are the same test twice rather than two tests.
 */
const kinds = [
  {
    kind: "item",
    path: "items",
    queueWrite: async () => {
      const item = await addItem(db, list.id, "Milk");
      await db.setItemChecked(item.id, list.id, true);
      return { id: item.id, sent: { name: "Milk", checked: true } };
    },
    queueDelete: async () => {
      const item = await addItem(db, list.id, "Milk");
      await removeItem(db, item);
      return { id: item.id };
    },
  },
  {
    kind: "payment",
    path: "payments",
    queueWrite: async () => {
      const payment = await addPayment(db, list.id, "user-1", "12.5", "2026-02-01T10:00:00.000Z");
      // Create-then-edit queues two writes on the same Payment, sent as one.
      await updatePayment(db, payment.id, list.id, { amountInEur: "9.9" });
      return { id: payment.id, sent: { amountInCents: 990, paidAt: "2026-02-01T10:00:00.000Z" } };
    },
    queueDelete: async () => {
      const payment = await addPayment(db, list.id, "user-1", "12.5", "2026-02-01T10:00:00.000Z");
      await removePayment(db, payment);
      return { id: payment.id };
    },
  },
];

/** Answers the server's echo of a queued write, and acks the delete. */
function routesFor({ kind, path }: { kind: string; path: string }): RouteTable {
  const url = `/api/lists/${list.id}/${path}`;
  return {
    [`PUT ${url}/*`]: (init) => {
      const written = JSON.parse(String(init?.body));
      return jsonResponse({ [kind]: { ...written, updatedAt: "server" } });
    },
    [`DELETE ${url}/*`]: { ok: true },
  };
}

beforeEach(async () => {
  await resetStore([list]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(kinds)("Sync drains a queued $kind", (kind) => {
  it("sends a queued write to the server and clears it", async () => {
    const { requests } = stubApi(routesFor(kind));
    const { id, sent } = await kind.queueWrite();

    await syncOutbox(db);
    await flushPromises();

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `PUT /api/lists/${list.id}/${kind.path}/${id}`,
    ]);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject(sent);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("sends a queued delete to the server and clears it", async () => {
    const { requests } = stubApi(routesFor(kind));
    const { id } = await kind.queueDelete();

    await syncOutbox(db);
    await flushPromises();

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `DELETE /api/lists/${list.id}/${kind.path}/${id}`,
    ]);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });
});
