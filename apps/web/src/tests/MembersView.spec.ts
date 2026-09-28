import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import type { List, ListInvitation, MemberDetails } from "@shopping-list/api/domain";
import App from "../App.vue";
import { forgetLists } from "../current-list";
import { db } from "../db";
import { createAppRouter } from "../router";
import { _resetSession, session, type SessionUser } from "../session";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubRoutes(handler?: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/auth/get-session") {
        return jsonResponse({ user });
      }
      if (handler) {
        return handler(url, init);
      }
      throw new Error(`No stub for ${url}`);
    }),
  );
}

function memberStub() {
  stubRoutes((url) => {
    if (url === `/api/lists/${list.id}/members`) {
      return jsonResponse({ members });
    }
    if (url === `/api/lists/${list.id}/invitations`) {
      return jsonResponse({ invitations: [] });
    }
    throw new Error(`No stub for ${url}`);
  });
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

async function mountMembers() {
  const router = createAppRouter(createMemoryHistory());
  await router.push(`/list/${list.id}/members`);
  await router.isReady();
  session.user = user;
  return mount(App, { global: { plugins: [router] } });
}

beforeEach(async () => {
  await db.lists.clear();
  await db.items.clear();
  await db.payments.clear();
  await db.memberships.clear();
  await db.outbox.clear();
  await db.syncList(list);
  forgetLists();
  _resetSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetSession();
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

    // The selection is marked by one underline line gliding under the tabs.
    expect(wrapper.find(".tabs span").exists()).toBe(true);
  });

  it("shows every Member's name, marking the signed-in user", async () => {
    memberStub();
    const wrapper = await mountMembers();
    await settle();

    expect(wrapper.text()).toContain("Test User (you)");
    expect(wrapper.text()).toContain("Ada");
  });

  it("lets the Owner invite by email and revoke a pending invitation", async () => {
    let invitations: ListInvitation[] = [];
    stubRoutes((url, init) => {
      if (url === `/api/lists/${list.id}/members`) {
        return jsonResponse({ members });
      }
      if (url === `/api/lists/${list.id}/invitations`) {
        if (init?.method === "POST" && init?.body) {
          const { email } = JSON.parse(init.body as string) as { email: string };
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
        }
        return jsonResponse({ invitations });
      }
      if (url === `/api/lists/${list.id}/invitations/inv-1` && init?.method === "DELETE") {
        invitations = invitations.map((inv) =>
          inv.id === "inv-1" ? { ...inv, status: "revoked" } : inv,
        );
        return jsonResponse({ ok: true });
      }
      throw new Error(`No stub for ${url}`);
    });

    const wrapper = await mountMembers();
    await settle();

    // The Owner sees the invite form and an empty invitation list initially.
    expect(wrapper.find('input[name="invite-email"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Nobody invited yet.");

    await wrapper.find('input[name="invite-email"]').setValue("partner@example.com");
    await wrapper.find("form.invite-form").trigger("submit");
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
    stubRoutes((url) => {
      if (url === `/api/lists/${list.id}/members`) {
        return jsonResponse({
          members: [
            { memberId: "user-2", name: "Other Owner", joinedAt: list.createdAt },
            { memberId: user.id, name: "Test User", joinedAt: list.createdAt },
          ],
        });
      }
      if (url === `/api/lists/${list.id}/invitations`) {
        return jsonResponse({
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
        });
      }
      throw new Error(`No stub for ${url}`);
    });

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
    stubRoutes((url, init) => {
      if (url === `/api/lists/${list.id}/members`) {
        return jsonResponse({ members: ownerFirstMembers });
      }
      if (url === `/api/lists/${list.id}/invitations`) {
        return jsonResponse({ invitations: [] });
      }
      if (url === `/api/lists/${list.id}/membership` && init?.method === "DELETE") {
        left = true;
        return jsonResponse({ ok: true });
      }
      throw new Error(`No stub for ${url}`);
    });

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

    const rows = wrapper.findAll(".member-standing");
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

  it("shows the running total instead of an Owed figure on a lone-Member List", async () => {
    stubRoutes((url) => {
      if (url === `/api/lists/${list.id}/members`) {
        return jsonResponse({ members: [members[0]!] });
      }
      if (url === `/api/lists/${list.id}/invitations`) {
        return jsonResponse({ invitations: [] });
      }
      throw new Error(`No stub for ${url}`);
    });
    await db.putPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 1400,
      paidAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    });

    const wrapper = await mountMembers();
    await settle();

    const rows = wrapper.findAll(".member-standing");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text()).toContain("Test User (you)");
    expect(wrapper.find(".member-owed").exists()).toBe(false);
    expect(wrapper.find(".member-total").text()).toContain("14,00");
    expect(wrapper.text()).not.toContain("share");
  });
});
