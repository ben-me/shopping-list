import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import type { List, PendingInvitation } from "@shopping-list/api/domain";
import App from "../App.vue";
import { db } from "../db";
import { createAppRouter } from "../router";
import { _resetSession, type SessionUser } from "../session";

const user: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "[EMAIL]",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubSignedIn(role: string | undefined) {
  const signedIn = { ...user, role };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/auth/get-session") {
        return jsonResponse({ session: { token: "tok" }, user: signedIn });
      }
      if (url === "/api/lists" && !init?.method) {
        return jsonResponse({ lists: [] });
      }
      if (url === "/api/invitations" && !init?.method) {
        return jsonResponse({ invitations: [] });
      }
      throw new Error(`No stub for ${url}`);
    }),
  );
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

beforeEach(async () => {
  await db.lists.clear();
  await db.outbox.clear();
  _resetSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsView", () => {
  it("shows the Add-a-user form to the Admin and posts it on submit", async () => {
    let created: { method?: string; body?: string } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url === "/api/auth/get-session") {
          return jsonResponse({ session: { token: "tok" }, user: { ...user, role: "admin" } });
        }
        if (url === "/api/lists" && !init?.method) {
          return jsonResponse({ lists: [] });
        }
        if (url === "/api/auth/admin/create-user") {
          created = { method: init?.method, body: init?.body as string };
          return jsonResponse({ user: { id: "user-2" } });
        }
        if (url === "/api/invitations" && !init?.method) {
          return jsonResponse({ invitations: [] });
        }
        throw new Error(`No stub for ${url}`);
      }),
    );
    const router = createAppRouter(createMemoryHistory());
    await router.push("/settings");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await settle();

    expect(wrapper.find("section.add-user").exists()).toBe(true);

    await wrapper.find('input[name="add-user-name"]').setValue("Partner");
    await wrapper.find('input[name="add-user-email"]').setValue("partner@example.com");
    await wrapper.find('input[name="add-user-password"]').setValue("password-123");
    await wrapper.find("form.add-user-form").trigger("submit");
    await flushPromises();
    await settle();

    expect(created).toEqual({
      method: "POST",
      body: JSON.stringify({
        name: "Partner",
        email: "partner@example.com",
        password: "password-123",
        role: "user",
        data: { emailVerified: true },
      }),
    });
    expect(wrapper.text()).toContain("Partner can now sign in.");
  });

  it("lets a Member open Settings and hides the Add-a-user section", async () => {
    stubSignedIn("user");
    const router = createAppRouter(createMemoryHistory());
    await router.push("/settings");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await settle();

    expect(router.currentRoute.value.name).toBe("settings");
    expect(wrapper.find("section.add-user").exists()).toBe(false);
    expect(wrapper.find("section.invitations").exists()).toBe(false);
  });

  it("shows the Lists the user joined on the home; leaving lives in the List", async () => {
    const joinedList: List = {
      id: "list-2",
      ownerId: "user-2",
      name: "Holiday shop",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.syncList(joinedList);
    await db.syncMembership({
      listId: joinedList.id,
      memberId: user.id,
      joinedAt: new Date().toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url === "/api/auth/get-session") {
          return jsonResponse({ session: { token: "tok" }, user });
        }
        if (url === "/api/invitations" && !init?.method) {
          return jsonResponse({ invitations: [] });
        }
        if (url === "/api/lists" && !init?.method) {
          return jsonResponse({ lists: [joinedList] });
        }
        throw new Error(`No stub for ${url}`);
      }),
    );
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await settle();

    // Joined Lists are Lists first: they belong on the home, not in Settings.
    expect(wrapper.text()).toContain("Holiday shop");

    await router.push("/settings");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Lists you joined");
  });

  it("lets the invitee accept a pending invitation and clears the inbox", async () => {
    const invitation: PendingInvitation = {
      id: "inv-1",
      listId: "list-9",
      listName: "Weekend shop",
      invitedById: "user-9",
      invitedByName: "Ada",
      createdAt: new Date().toISOString(),
    };
    let pending: PendingInvitation[] = [invitation];
    const apiCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        apiCalls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/auth/get-session") {
          return jsonResponse({ session: { token: "tok" }, user });
        }
        if (url === "/api/invitations" && !init?.method) {
          return jsonResponse({ invitations: pending });
        }
        if (url === "/api/invitations/inv-1/accept") {
          pending = [];
          return jsonResponse({ ok: true });
        }
        if (url === "/api/lists" && !init?.method) {
          return jsonResponse({ lists: [] });
        }
        throw new Error(`No stub for ${url}`);
      }),
    );
    const router = createAppRouter(createMemoryHistory());
    await router.push("/settings");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await settle();

    // The inbox shows the inviting Owner's name, the List name, and both controls.
    expect(wrapper.text()).toContain("Ada invited you to Weekend shop");
    expect(wrapper.find('button[name="accept-invitation"]').exists()).toBe(true);
    expect(wrapper.find('button[name="decline-invitation"]').exists()).toBe(true);

    // Accepting clears the inbox; Sync pulls the List in for the Lists home.
    await wrapper.find('button[name="accept-invitation"]').trigger("click");
    await flushPromises();
    await settle();

    expect(apiCalls).toContain("POST /api/invitations/inv-1/accept");
    expect(wrapper.text()).not.toContain("Ada invited you");
  });

  it("lets the invitee decline a pending invitation", async () => {
    const invitation: PendingInvitation = {
      id: "inv-2",
      listId: "list-9",
      listName: "Holiday shop",
      invitedById: "user-9",
      invitedByName: "Ada",
      createdAt: new Date().toISOString(),
    };
    const apiCalls: string[] = [];
    let invitations: PendingInvitation[] = [invitation];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        apiCalls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/auth/get-session") {
          return jsonResponse({ session: { token: "tok" }, user });
        }
        if (url === "/api/invitations" && !init?.method) {
          return jsonResponse({ invitations });
        }
        if (url === "/api/invitations/inv-2/decline") {
          invitations = [];
          return jsonResponse({ ok: true });
        }
        if (url === "/api/lists" && !init?.method) {
          return jsonResponse({ lists: [] });
        }
        throw new Error(`No stub for ${url}`);
      }),
    );
    const router = createAppRouter(createMemoryHistory());
    await router.push("/settings");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("Ada invited you to Holiday shop");

    await wrapper.find('button[name="decline-invitation"]').trigger("click");
    await flushPromises();
    await settle();

    expect(apiCalls).toContain("POST /api/invitations/inv-2/decline");
    expect(wrapper.text()).not.toContain("Ada invited you");
  });
});
