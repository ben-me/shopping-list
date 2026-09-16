import "fake-indexeddb/auto";

import type { List } from "@shopping-list/api/domain";
import { leaveList, listMembers, memberIdsOf, syncMembershipsFromServer } from "../members";
import { ShoppingDb } from "../store";
import now from "@/utils/now";

let dbNumber = 0;

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: now(),
  updatedAt: now(),
};

let db: ShoppingDb;

beforeEach(async () => {
  dbNumber += 1;
  db = new ShoppingDb(`test-db-${dbNumber}`);
  await db.syncList(list);
});

async function joined(memberId: string, joinedAt: string): Promise<void> {
  await db.syncMembership({ listId: list.id, memberId, joinedAt });
}

describe("memberIdsOf", () => {
  it("counts the Owner as a Member even before any Membership exists", async () => {
    expect(await memberIdsOf(db, list)).toEqual(["user-1"]);
  });

  it("lists joined Members after the Owner, deduplicated and in joined order", async () => {
    await joined("user-3", "2026-01-01T00:00:00.000Z");
    await joined("user-2", "2026-01-02T00:00:00.000Z");
    await joined("user-1", "2026-01-03T00:00:00.000Z"); // the Owner's own Membership row

    expect(await memberIdsOf(db, list)).toEqual(["user-1", "user-3", "user-2"]);
  });

  it("keeps a departed Member out of the Split while their Payments stay in the pot", async () => {
    await joined("user-2", "2026-01-01T00:00:00.000Z");
    await joined("user-3", "2026-01-02T00:00:00.000Z");
    await db.memberships.where("memberId").equals("user-2").delete();

    expect(await memberIdsOf(db, list)).toEqual(["user-1", "user-3"]);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("syncMembershipsFromServer", () => {
  it("replaces the local Membership set with the server's truth", async () => {
    await joined("user-2", "2026-01-01T00:00:00.000Z"); // stale local row
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          members: [
            { memberId: list.ownerId, name: "Test User", joinedAt: list.createdAt },
            { memberId: "user-2", name: "Two", joinedAt: "2026-01-01T00:00:00.000Z" },
            { memberId: "user-3", name: "Three", joinedAt: "2026-01-02T00:00:00.000Z" },
          ],
        }),
      ),
    );

    await syncMembershipsFromServer(db, list.id);

    expect(await memberIdsOf(db, list)).toEqual(["user-1", "user-2", "user-3"]);

    // The server dropping a Member removes their local Membership row; the
    // Owner's pseudo-row is never stored.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          members: [
            { memberId: list.ownerId, name: "Test User", joinedAt: list.createdAt },
            { memberId: "user-3", name: "Three", joinedAt: "2026-01-02T00:00:00.000Z" },
          ],
        }),
      ),
    );
    await syncMembershipsFromServer(db, list.id);
    expect(await memberIdsOf(db, list)).toEqual(["user-1", "user-3"]);
  });

  it("leaves the local set untouched when the server response is unexpected", async () => {
    await joined("user-2", "2026-01-01T00:00:00.000Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );

    await syncMembershipsFromServer(db, list.id);

    expect(await memberIdsOf(db, list)).toEqual(["user-1", "user-2"]);
  });
});

describe("listMembers", () => {
  it("returns everyone with access, Owner first, with names", async () => {
    const members = [
      { memberId: list.ownerId, name: "Test User", joinedAt: list.createdAt },
      { memberId: "user-2", name: "Two", joinedAt: "2026-01-01T00:00:00.000Z" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ members })),
    );

    await expect(listMembers(list.id)).resolves.toEqual(members);
  });

  it("defaults to an empty list when the payload is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );

    await expect(listMembers(list.id)).resolves.toEqual([]);
  });
});

describe("leaveList", () => {
  it("drops the Membership on the server, then removes the local List", async () => {
    await joined("user-2", "2026-01-01T00:00:00.000Z");
    let deleted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        expect(url).toBe(`/api/lists/${list.id}/membership`);
        expect(init?.method).toBe("DELETE");
        deleted = true;
        return jsonResponse({ ok: true });
      }),
    );

    await leaveList(db, list.id);

    expect(deleted).toBe(true);
    expect(await db.getList(list.id)).toBeUndefined();
    expect(await db.getMemberships(list.id)).toEqual([]);
  });

  it("keeps the local List when the server refuses the leave", async () => {
    await joined("user-2", "2026-01-01T00:00:00.000Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { message: "Owner cannot leave" } }, 403)),
    );

    await expect(leaveList(db, list.id)).rejects.toThrow();
    expect(await db.getList(list.id)).toBeDefined();
    expect((await db.getMemberships(list.id)).map((m) => m.memberId)).toEqual(["user-2"]);
  });
});
