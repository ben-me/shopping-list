import "fake-indexeddb/auto";

import type { List } from "@shopping-list/api/domain";
import { memberIdsOf, syncMembershipsFromServer } from "../members";
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

beforeEach(() => {
  dbNumber += 1;
  db = new ShoppingDb(`test-db-${dbNumber}`);
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
          memberships: [
            { listId: list.id, memberId: "user-2", joinedAt: "2026-01-01T00:00:00.000Z" },
            { listId: list.id, memberId: "user-3", joinedAt: "2026-01-02T00:00:00.000Z" },
          ],
        }),
      ),
    );

    await syncMembershipsFromServer(db, list.id);

    expect(await memberIdsOf(db, list)).toEqual(["user-1", "user-2", "user-3"]);

    // The server dropping a Member removes their local Membership row.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          memberships: [
            { listId: list.id, memberId: "user-3", joinedAt: "2026-01-02T00:00:00.000Z" },
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
