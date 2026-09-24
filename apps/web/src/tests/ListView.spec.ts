import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import type { List, ListInvitation } from "@shopping-list/api/domain";
import App from "../App.vue";
import { forgetLists } from "../current-list";
import { db } from "../db";
import { createAppRouter } from "../router";
import { _resetSession, type SessionUser } from "../session";

const user: SessionUser = { id: "user-1", name: "Test User", email: "[EMAIL]" };

const list: List = {
  id: "list-1",
  ownerId: user.id,
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

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

/** The Members panel reads the server only once it is open. */
async function openMembers(wrapper: VueWrapper) {
  await wrapper.find("button.members-toggle").trigger("click");
  await flushPromises();
}

async function mountList() {
  const router = createAppRouter(createMemoryHistory());
  await router.push(`/list/${list.id}`);
  await router.isReady();
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
});

describe("ListView", () => {
  it("renders the List's Items from the local Store", async () => {
    await db.putItem({
      id: "item-1",
      listId: list.id,
      name: "Milk",
      checked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();

    expect(wrapper.text()).toContain("Household");
    expect(wrapper.find(".name").text()).toContain("Milk");
  });

  it("adds an Item and it appears immediately, even when the server is unreachable", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Bread");
    await wrapper.find("form.add-item-form").trigger("submit");
    await flushPromises();
    await settle();
    await settle();

    const names = wrapper.findAll(".name").map((n) => n.text());
    expect(names).toContain("Bread");
    expect((await db.getItems(list.id)).map((i) => i.name)).toEqual(["Bread"]);
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("ticks an Item off and the tick is still there after a reload", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form.add-item-form").trigger("submit");
    await flushPromises();
    await settle();

    await wrapper.find('input[type="checkbox"]').setValue();
    await flushPromises();
    await settle();

    // Simulate a reload: a fresh mount reads the same local Store.
    const remounted = await mountList();
    await flushPromises();
    await settle();

    expect((remounted.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
      true,
    );
    const stored = (await db.getItems(list.id))[0];
    expect(stored).toBeDefined();
    expect(stored).toMatchObject({ name: "Milk", checked: true });
    expect(stored?.checkedAt).toBeTruthy();
  });

  it("un-ticks a ticked Item back to unchecked", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form.add-item-form").trigger("submit");
    await flushPromises();
    await settle();

    const checkbox = () => wrapper.find('input[type="checkbox"]');
    await checkbox().setValue();
    await flushPromises();
    await settle();
    await checkbox().setValue(false);
    await flushPromises();
    await settle();

    expect((checkbox().element as HTMLInputElement).checked).toBe(false);
    const stored = (await db.getItems(list.id))[0];
    expect(stored).toBeDefined();
    expect(stored?.checked).toBe(false);
    expect(stored?.checkedAt).toBeUndefined();
  });

  it("removes an Item from the List", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form.add-item-form").trigger("submit");
    await flushPromises();
    await settle();

    await wrapper.find("li button").trigger("click");
    await flushPromises();
    await settle();

    expect(wrapper.findAll(".name")).toHaveLength(0);
    expect(await db.getItems(list.id)).toHaveLength(0);
  });

  it("queues a tick for Sync without creating anything money-related", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form.add-item-form").trigger("submit");
    await flushPromises();
    await settle();
    await wrapper.find('input[type="checkbox"]').setValue();
    await flushPromises();
    await settle();

    const pending = await db.pendingOutboxEntries();
    expect(pending.map((e) => e.targetType)).toEqual(["item", "item"]);
    expect(await db.getPayments(list.id)).toHaveLength(0);
  });

  it("lets the Owner invite by email and revoke a pending invitation", async () => {
    let invitations: ListInvitation[] = [];
    stubRoutes((url, init) => {
      if (url === `/api/lists/${list.id}/members`) {
        return jsonResponse({
          members: [{ memberId: user.id, name: "Test User", joinedAt: list.createdAt }],
        });
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
          return jsonResponse(
            {
              invitation: {
                id: "inv-1",
                listId: list.id,
                email,
                invitedById: user.id,
                status: "pending",
                token: "tok",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
            201,
          );
        }
        return jsonResponse({ invitations });
      }
      if (url === `/api/lists/${list.id}/invitations/inv-1` && init?.method === "DELETE") {
        invitations = invitations.map((inv) =>
          inv.id === "inv-1" ? { ...inv, status: "revoked" } : inv,
        );
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/items")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/payments")) {
        return jsonResponse({ payments: [] });
      }
      return new Response(null, { status: 503 });
    });

    const wrapper = await mountList();
    await flushPromises();
    await openMembers(wrapper);
    await settle();

    // A fresh List has no invitations, and the Owner sees the invite form.
    expect(wrapper.text()).toContain("Nobody invited yet.");

    await wrapper.find('input[name="invite-email"]').setValue("[EMAIL]");
    await wrapper.find("form.invite-form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("[EMAIL]");
    expect(wrapper.text()).toContain("invited");

    // Revoking closes the invitation; a Member does not get the controls.
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
      return new Response(null, { status: 503 });
    });

    const wrapper = await mountList();
    await flushPromises();
    await openMembers(wrapper);
    await settle();

    expect(wrapper.text()).toContain("Other Owner");
    expect(wrapper.find('input[name="invite-email"]').exists()).toBe(false);
    expect(wrapper.findAll('button[name="revoke-invitation"]')).toHaveLength(0);
  });
});
