import "fake-indexeddb/auto";

import type { List } from "@shopping-list/api/domain";
import { createList, syncFromServer, syncOutbox } from "../lists";
import { ShoppingDb } from "../store";

let dbNumber = 0;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(makeResponse: () => Response) {
  const fetchImpl = vi.fn<typeof fetch>(async () => makeResponse());
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

let db: ShoppingDb;

beforeEach(() => {
  dbNumber += 1;
  db = new ShoppingDb(`lists-test-${dbNumber}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createList", () => {
  it("creates a List locally first, queues it for Sync, and pushes it to the server", async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ list: {} }, 201));
    const list = await createList(db, "user-1", "Household");

    expect(list).toMatchObject({ ownerId: "user-1", name: "Household" });
    expect(await db.getLists()).toEqual([list]);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      targetType: "list",
      targetId: list.id,
      operation: "update",
      syncedAt: expect.any(String),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/lists/${list.id}`,
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({ name: "Household" }),
      }),
    );
  });

  it("keeps the List locallyand leaves it pending when the server is unreachable", async () => {
    stubFetch(() => new Response(null, { status: 503 }));
    const list = await createList(db, "user-1", "Milk run");

    expect(await db.getLists()).toEqual([list]);
    const pending = await db.pendingOutboxEntries();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ targetType: "list", targetId: list.id, syncedAt: null });
  });

  it("rejects a blank name before touching the Store or the network", async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ list: {} }, 201));

    await expect(createList(db, "user-1", "   ")).rejects.toThrow("Give the list a name");

    expect(await db.getLists()).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("syncOutbox", () => {
  it("pushes pending Lists to the server and marks them synced", async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ list: {} }));
    const list = await createList(db, "user-1", "Household");
    await db.outbox.clear();

    expect(await db.pendingOutboxEntries()).toHaveLength(0);
    await syncOutbox(db);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await db.putList({ ...list, name: "Renamed" });
    await syncOutbox(db);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/lists/${list.id}`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ name: "Renamed" }) }),
    );
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });
});

describe("syncFromServer", () => {
  it("pulls the user's Lists from the server into the local Store", async () => {
    const serverList: List = {
      id: "list-server-1",
      ownerId: "user-1",
      name: "From server",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    stubFetch(() => jsonResponse({ lists: [serverList] }));
    await syncFromServer(db);

    expect(await db.getLists()).toEqual([serverList]);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });

  it("adopts the server's authoritative List after an outbox push", async () => {
    const list: List = {
      id: "list-1",
      ownerId: "user-1",
      name: "Household",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const serverList: List = {
      ...list,
      name: "Renamed on server",
      updatedAt: "2026-09-02T00:00:00.000Z",
    };
    await db.putList(list);
    stubFetch(() => jsonResponse({ list: serverList }));
    await syncOutbox(db);

    expect(await db.getList(list.id)).toEqual(serverList);
    expect(await db.pendingOutboxEntries()).toHaveLength(0);
  });
});
