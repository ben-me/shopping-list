import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { List, ListInvitation, MemberDetails } from "@shopping-list/api/domain";
import { db } from "../db";
import type { SessionUser } from "../session";
import { jsonResponse, mountApp, resetStore, serverDown, settle, stubApi } from "./support/app";

const user: SessionUser = { id: "user-1", name: "Test User", email: "[EMAIL]" };

const list: List = {
  id: "list-1",
  ownerId: user.id,
  name: "Household",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const members: MemberDetails[] = [
  { memberId: user.id, name: "Test User", joinedAt: "2026-01-01T00:00:00.000Z" },
  { memberId: "user-2", name: "Ada", joinedAt: "2026-01-02T00:00:00.000Z" },
];

/** The Owner first — the server lists them first, and the screen reads that. */
const ownerFirstMembers: MemberDetails[] = [
  { memberId: "user-2", name: "Ada", joinedAt: "2026-01-01T00:00:00.000Z" },
  { memberId: user.id, name: "Test User", joinedAt: "2026-01-02T00:00:00.000Z" },
];

function membersRoute(listMembers: MemberDetails[]) {
  return { [`GET /api/lists/${list.id}/members`]: { members: listMembers } };
}

/** The Owner on their own List, with an empty inbox. */
function memberStub() {
  stubApi(
    { ...membersRoute(members), [`GET /api/lists/${list.id}/invitations`]: { invitations: [] } },
    { user },
  );
}

async function mountMembers() {
  const { wrapper } = await mountApp(`/list/${list.id}/members`);
  return wrapper;
}

beforeEach(async () => {
  await resetStore([list]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MembersView", () => {
  it("is a tab beside Items and Payments, not a popover", async () => {
    memberStub();
    const wrapper = await mountMembers();
    await settle();

    // The tab row carries three links: Items, Payments, Members.
    const tabs = wrapper.findAll("a.tab");
    expect(tabs.map((tab) => tab.text())).toEqual(["Items", "Payments", "Members"]);
    expect(tabs[2]!.attributes("href")).toBe(`/list/${list.id}/members`);
    expect(tabs[2]!.attributes("aria-current")).toBe("page");

    // The Members screen is a page in the sheet, not a dialog in the top layer.
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(wrapper.find("button.members-close").exists()).toBe(false);

    // The selection is marked by one underline line gliding under the tabs:
    // the nav draws it from the two measurements the tabs leave on it.
    const tabBar = wrapper.find('nav[aria-label="Sections"]');
    expect(tabBar.exists()).toBe(true);
    expect(tabBar.attributes("style")).toContain("--line-width");
  });

  it("shows every Member's name, marking the signed-in user", async () => {
    memberStub();
    const wrapper = await mountMembers();
    await settle();

    expect(wrapper.text()).toContain("Test User (you)");
    expect(wrapper.text()).toContain("Ada");
  });

  it("shows the names and the standing offline, from the local Store", async () => {
    memberStub();
    await db.syncMembership({
      listId: list.id,
      memberId: "user-2",
      joinedAt: "2026-01-02T00:00:00.000Z",
    });
    await db.putPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 300,
      paidAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T09:00:00.000Z",
    });
    await db.putMemberNames([
      { memberId: user.id, name: "Test User" },
      { memberId: "user-2", name: "Ada" },
    ]);
    // Whatever the last sync stored is all there is.
    stubApi({}, { user, fallback: serverDown });

    const wrapper = await mountMembers();
    await settle();

    const rows = wrapper.findAll("ul.rows > li");
    expect(rows.map((row) => row.find(".member-name").text())).toEqual(["Test User (you)", "Ada"]);
    expect(rows[1]!.text()).toContain("owes 1,50");
  });

  it("lets the Owner invite by email and revoke a pending invitation", async () => {
    let invitations: ListInvitation[] = [];
    stubApi(
      {
        ...membersRoute(members),
        [`GET /api/lists/${list.id}/invitations`]: () => ({ invitations }),
        [`POST /api/lists/${list.id}/invitations`]: (init) => {
          const { email } = JSON.parse(String(init?.body)) as { email: string };
          invitations = [
            {
              id: "inv-1",
              listId: list.id,
              email,
              invitedById: user.id,
              invitedByName: "Test User",
              status: "pending",
              createdAt: new Date().toISOString(),
            },
          ];
          return jsonResponse({ invitation: { id: "inv-1" } }, 201);
        },
        [`DELETE /api/lists/${list.id}/invitations/inv-1`]: () => {
          invitations = invitations.map((inv) =>
            inv.id === "inv-1" ? { ...inv, status: "revoked" } : inv,
          );
          return { ok: true };
        },
      },
      { user },
    );

    const wrapper = await mountMembers();
    await settle();

    // The Owner sees the invite form and an empty invitation list initially.
    expect(wrapper.find('input[name="invite-email"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Nobody invited yet.");

    await wrapper.find('input[name="invite-email"]').setValue("partner@example.com");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("partner@example.com");
    expect(wrapper.text()).toContain("invited");

    // Revoking closes the invitation.
    await wrapper.find('button[name="revoke-invitation"]').trigger("click");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("closed");
    expect(wrapper.findAll('button[name="revoke-invitation"]')).toHaveLength(0);
  });

  it("shows invitations to a Member without the Owner-only controls", async () => {
    // The signed-in user is a Member; someone else owns the List.
    await db.lists.put({ ...list, ownerId: "user-2" });
    stubApi(
      {
        ...membersRoute([
          { memberId: "user-2", name: "Other Owner", joinedAt: list.createdAt },
          { memberId: user.id, name: "Test User", joinedAt: list.createdAt },
        ]),
        [`GET /api/lists/${list.id}/invitations`]: {
          invitations: [
            {
              id: "inv-2",
              listId: list.id,
              email: "[EMAIL]",
              invitedById: "user-2",
              invitedByName: "Other Owner",
              status: "accepted",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      },
      { user },
    );

    const wrapper = await mountMembers();
    await settle();

    expect(wrapper.text()).toContain("Other Owner");
    expect(wrapper.find('input[name="invite-email"]').exists()).toBe(false);
    expect(wrapper.findAll('button[name="revoke-invitation"]')).toHaveLength(0);
    expect(wrapper.find('button[name="leave-list"]').exists()).toBe(true);
  });

  it("lets a Member leave the List", async () => {
    await db.lists.put({ ...list, ownerId: "user-2" });
    let left = false;
    stubApi(
      {
        ...membersRoute(ownerFirstMembers),
        [`GET /api/lists/${list.id}/invitations`]: { invitations: [] },
        [`DELETE /api/lists/${list.id}/membership`]: () => {
          left = true;
          return { ok: true };
        },
      },
      { user },
    );

    const wrapper = await mountMembers();
    await settle();

    await wrapper.find('button[name="leave-list"]').trigger("click");
    await flushPromises();
    await settle();

    expect(left).toBe(true);
    expect(await db.getList(list.id)).toBeUndefined();
  });

  it("shows each Member's Share and Owed figure beside their name", async () => {
    memberStub();
    await db.putPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 300,
      paidAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    });
    await db.putPayment({
      id: "pay-2",
      listId: list.id,
      memberId: "user-2",
      amountInCents: 100,
      paidAt: "2026-01-02T10:00:00.000Z",
      createdAt: "2026-01-02T09:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z",
    });

    const wrapper = await mountMembers();
    await settle();

    const rows = wrapper.findAll("ul.rows > li");
    expect(rows).toHaveLength(2);

    const you = rows[0]!;
    expect(you.text()).toContain("Test User (you)");
    expect(you.text()).toContain("share 2,00");
    expect(you.text()).toContain("is owed 1,00");
    expect(you.classes()).toContain("owed"); // green: the group owes them

    const other = rows[1]!;
    expect(other.text()).toContain("Ada");
    expect(other.text()).not.toContain("user-2");
    expect(other.text()).toContain("share 2,00");
    expect(other.text()).toContain("owes 1,00");
    expect(other.classes()).toContain("owes"); // red: they owe the group

    // Two Members split the pot, so no bare total line.
    expect(wrapper.find(".member-total").exists()).toBe(false);
  });
});
