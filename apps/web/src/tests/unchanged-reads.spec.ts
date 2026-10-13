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

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: "2026-02-01T09:00:00.000Z",
  updatedAt: "2026-02-01T09:00:00.000Z",
};

const item: Item = {
  id: "item-1",
  listId: list.id,
  name: "Milk",
  checked: false,
  createdAt: "2026-02-01T09:00:00.000Z",
  updatedAt: "2026-02-01T09:00:00.000Z",
};

const payment: Payment = {
  id: "payment-1",
  listId: list.id,
  memberId: "user-1",
  amountInCents: 1250,
  paidAt: "2026-02-01T09:00:00.000Z",
  createdAt: "2026-02-01T09:00:00.000Z",
  updatedAt: "2026-02-01T09:00:00.000Z",
};

const members: MemberDetails[] = [
  { memberId: "user-1", name: "Test User", joinedAt: list.createdAt },
  { memberId: "user-2", name: "Two", joinedAt: "2026-02-02T09:00:00.000Z" },
];

const inbox: PendingInvitation[] = [
  {
    id: "invitation-1",
    listId: list.id,
    listName: "Household",
    invitedById: "user-2",
    invitedByName: "Two",
    createdAt: "2026-02-03T09:00:00.000Z",
  },
];

/**
 * The server's side of the contract: the rows with a tag to start with, a
 * `304` once the caller sends that tag back. Keyed by path.
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

beforeEach(async () => {
  await resetStore([list]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a read the server answers 304 to", () => {
  it("leaves the Lists index alone", async () => {
    const { requests } = stubReads({ "/api/lists": { lists: [list] } });
    await syncFromServer(db);
    const syncList = vi.spyOn(db, "syncList");

    await syncFromServer(db);

    expect(requests[1]?.headers["if-none-match"]).toBe('"/api/lists"');
    expect(syncList).not.toHaveBeenCalled();
  });

  it("leaves a List's Items alone", async () => {
    const { requests } = stubReads({ [`/api/lists/${list.id}/items`]: { items: [item] } });
    await syncItemsFromServer(db, list.id);
    const syncItem = vi.spyOn(db, "syncItem");

    await syncItemsFromServer(db, list.id);

    expect(requests[1]?.headers["if-none-match"]).toBe(`"/api/lists/${list.id}/items"`);
    expect(syncItem).not.toHaveBeenCalled();
  });

  it("leaves a List's Payments alone", async () => {
    const { requests } = stubReads({ [`/api/lists/${list.id}/payments`]: { payments: [payment] } });
    await syncPaymentsFromServer(db, list.id);
    const syncPayment = vi.spyOn(db, "syncPayment");

    await syncPaymentsFromServer(db, list.id);

    expect(requests[1]?.headers["if-none-match"]).toBe(`"/api/lists/${list.id}/payments"`);
    expect(syncPayment).not.toHaveBeenCalled();
  });

  it("leaves a List's Memberships and names alone", async () => {
    const { requests } = stubReads({ [`/api/lists/${list.id}/members`]: { members } });
    await syncMembershipsFromServer(db, list.id);
    const replaceMemberships = vi.spyOn(db, "replaceMemberships");
    const putMemberNames = vi.spyOn(db, "putMemberNames");

    await syncMembershipsFromServer(db, list.id);

    expect(requests[1]?.headers["if-none-match"]).toBe(`"/api/lists/${list.id}/members"`);
    expect(replaceMemberships).not.toHaveBeenCalled();
    expect(putMemberNames).not.toHaveBeenCalled();
  });

  it("still hands the inbox back to the screen that renders it", async () => {
    const { requests } = stubReads({ "/api/invitations": { invitations: inbox } });
    await loadPendingInvitations();

    await expect(loadPendingInvitations()).resolves.toEqual(inbox);

    expect(requests[1]?.headers["if-none-match"]).toBe('"/api/invitations"');
    expect(pendingInvitationCount.value).toBe(1);
  });

  it("still hands a List's invitations back to the screen that renders them", async () => {
    const { requests } = stubReads({
      [`/api/lists/${list.id}/invitations`]: { invitations: [] },
    });
    await listInvitations(list.id);

    await expect(listInvitations(list.id)).resolves.toEqual([]);

    expect(requests[1]?.headers["if-none-match"]).toBe(`"/api/lists/${list.id}/invitations"`);
  });
});
