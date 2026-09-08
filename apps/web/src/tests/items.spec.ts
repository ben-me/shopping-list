import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { Item, List } from "@shopping-list/api/domain";
import { db } from "../db";
import { addItem, removeItem, setItemChecked, syncItemsFromServer } from "../items";
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
 * contract. The default handler answers any Item PUT with the server's
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
    if (init?.method === "PUT" && url.includes("/items/")) {
      return jsonResponse({ item: { ...JSON.parse(String(init.body)), updatedAt: "server" } });
    }
    if (init?.method === "DELETE" && url.includes("/items/")) {
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

describe("Items on a List", () => {
  it("adds an Item offline: it appears immediately and is queued for Sync", async () => {
    stubServer();

    const item = await addItem(db, list.id, "  Milk  ");

    expect(item).toMatchObject({ listId: list.id, name: "Milk", checked: false });
    expect((await db.getItems(list.id)).map((i) => i.name)).toEqual(["Milk"]);
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("rejects adding a blank Item name", async () => {
    await expect(addItem(db, list.id, "   ")).rejects.toThrow("Give the item a name");
    expect(await db.getItems(list.id)).toHaveLength(0);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("ticks and un-ticks an Item offline and nothing money-related happens", async () => {
    stubServer();
    const item = await addItem(db, list.id, "Milk");

    const ticked = await setItemChecked(db, item, true);
    expect(ticked.checked).toBe(true);
    expect(ticked.checkedAt).toBeTruthy();

    const unticked = await setItemChecked(db, ticked, false);
    expect(unticked.checked).toBe(false);
    expect(unticked.checkedAt).toBeUndefined();

    const stored = await db.getItems(list.id);
    expect(stored[0]).toMatchObject({ name: "Milk", checked: false, checkedAt: undefined });
    expect((await db.pendingOutboxEntries()).map((e) => e.targetType)).toEqual([
      "item",
      "item",
      "item",
    ]);
    expect((await db.getPayments(list.id)).length).toBe(0);
  });

  it("removes an Item offline and queues the delete for Sync", async () => {
    stubServer();
    const item = await addItem(db, list.id, "Milk");

    await removeItem(db, item);

    expect(await db.getItems(list.id)).toHaveLength(0);
    const pending = await db.pendingOutboxEntries();
    expect(pending.map((e) => e.operation)).toEqual(["update", "delete"]);
    expect(pending[1]).toMatchObject({ targetType: "item", targetId: item.id, listId: list.id });
  });

  it("syncs a queued Item to the server when the connection returns", async () => {
    const { requests } = stubServer();
    const item = await addItem(db, list.id, "Milk");
    await setItemChecked(db, item, true);

    await syncOutbox(db);
    await flushPromises();

    const put = requests.find((r) => r.init?.method === "PUT");
    expect(put?.url).toBe(`/api/lists/${list.id}/items/${item.id}`);
    expect(JSON.parse((put?.init?.body as string) ?? "{}")).toMatchObject({
      name: "Milk",
      checked: true,
    });
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("syncs a queued Item delete to the server when the connection returns", async () => {
    const { requests } = stubServer();
    const item = await addItem(db, list.id, "Milk");
    await removeItem(db, item);

    await syncOutbox(db);
    await flushPromises();

    const del = requests.find((r) => r.init?.method === "DELETE");
    expect(del?.url).toBe(`/api/lists/${list.id}/items/${item.id}`);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("keeps an entry pending when the server is unreachable so Sync retries later", async () => {
    stubServer(() => new Response(null, { status: 503 }));
    await addItem(db, list.id, "Milk");

    await expect(syncOutbox(db)).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
    });

    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("pulls the server's Items for a List into the Store without queueing anything", async () => {
    const serverItem: Item = {
      id: "item-server",
      listId: list.id,
      name: "Bread",
      checked: true,
      checkedAt: "2026-02-01T10:00:00.000Z",
      createdAt: "2026-02-01T09:00:00.000Z",
      updatedAt: "2026-02-01T10:00:00.000Z",
    };
    stubServer((url) => {
      if (url === `/api/lists/${list.id}/items`) {
        return jsonResponse({ items: [serverItem] });
      }
      return undefined;
    });

    await syncItemsFromServer(db, list.id);

    expect(await db.getItems(list.id)).toEqual([serverItem]);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });
});
