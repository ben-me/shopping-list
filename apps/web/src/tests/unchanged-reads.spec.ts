import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import type {
  Item,
  List,
  MemberDetails,
  Payment,
  PendingInvitation,
} from "@shopping-list/api/domain";
import type { ShoppingDb } from "../store";
import { db } from "../db";
import { listInvitations } from "../invitations";
import { syncItemsFromServer } from "../items";
import { syncFromServer } from "../lists";
import { syncMembershipsFromServer } from "../members";
import { syncPaymentsFromServer } from "../payments";
import { loadPendingInvitations, pendingInvitationCount } from "../pending-invitations";
import {
  ifNoneMatch,
  jsonResponse,
  notModified,
  resetStore,
  stubApi,
  type RouteTable,
} from "./support/app";

const at = "2026-02-01T09:00:00.000Z";
const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: at,
  updatedAt: at,
};
const item: Item = {
  id: "item-1",
  listId: list.id,
  name: "Milk",
  checked: false,
  createdAt: at,
  updatedAt: at,
};
const payment: Payment = {
  id: "payment-1",
  listId: list.id,
  memberId: "user-1",
  amountInCents: 1250,
  paidAt: at,
  createdAt: at,
  updatedAt: at,
};
const members: MemberDetails[] = [
  { memberId: "user-1", name: "Test User", joinedAt: at },
  { memberId: "user-2", name: "Two", joinedAt: at },
];
const inbox: PendingInvitation[] = [
  {
    id: "invitation-1",
    listId: list.id,
    listName: "Household",
    invitedById: "user-2",
    invitedByName: "Two",
    createdAt: at,
  },
];

/**
 * A read the server has not moved: the rows with a tag to start with, a `304`
 * once the caller hands that tag back.
 */
function stubReads(bodies: Record<string, unknown>) {
  const table: RouteTable = {};
  for (const [path, body] of Object.entries(bodies)) {
    const tag = `"${path}"`;
    table[`GET ${path}`] = (init) =>
      ifNoneMatch(init) === tag ? notModified() : jsonResponse(body, 200, { etag: tag });
  }
  return stubApi(table);
}

const storeReads = [
  () => syncFromServer(db),
  (db: ShoppingDb) => syncItemsFromServer(db, list.id),
  (db: ShoppingDb) => syncPaymentsFromServer(db, list.id),
  (db: ShoppingDb) => syncMembershipsFromServer(db, list.id),
];

beforeEach(async () => {
  await resetStore([list]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the reads a Sync pass pulls into the Store", () => {
  it("skips every Store write when the server answers them all unchanged", async () => {
    const { requests } = stubReads({
      "/api/lists": { lists: [list] },
      [`/api/lists/${list.id}/items`]: { items: [item] },
      [`/api/lists/${list.id}/payments`]: { payments: [payment] },
      [`/api/lists/${list.id}/members`]: { members },
    });
    await Promise.all(storeReads.map((read) => read(db)));

    const storeWrites = [
      vi.spyOn(db, "syncList"),
      vi.spyOn(db, "removeList"),
      vi.spyOn(db, "syncItem"),
      vi.spyOn(db, "syncPayment"),
      vi.spyOn(db, "replaceMemberships"),
      vi.spyOn(db, "putMemberNames"),
    ];
    await Promise.all(storeReads.map((read) => read(db)));

    // Every read went back out with the tag the server gave it…
    expect(requests.filter((request) => request.headers["if-none-match"])).toHaveLength(4);
    // …and none of them rewrote a row it already had.
    for (const write of storeWrites) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});

describe("a read with no Store copy", () => {
  it("skips the pull but still hands the rows back to the screen that renders them", async () => {
    const { requests } = stubReads({
      "/api/invitations": { invitations: inbox },
      [`/api/lists/${list.id}/invitations`]: { invitations: [] },
    });

    await expect(loadPendingInvitations()).resolves.toEqual(inbox);
    await expect(loadPendingInvitations()).resolves.toEqual(inbox);
    await expect(listInvitations(list.id)).resolves.toEqual([]);

    expect(requests[1]?.headers["if-none-match"]).toBe('"/api/invitations"');
    expect(pendingInvitationCount.value).toBe(1);
  });

  it("reads afresh once the List it describes is dropped from the Store", async () => {
    const { requests } = stubReads({ [`/api/lists/${list.id}/items`]: { items: [item] } });
    await syncItemsFromServer(db, list.id);

    await db.removeList(list.id);
    await syncItemsFromServer(db, list.id);

    expect(requests.at(-1)?.headers["if-none-match"]).toBeUndefined();
  });
});
