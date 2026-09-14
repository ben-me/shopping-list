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

function stubRoutes(handler: (url: string, init?: RequestInit) => Response) {
  const fetchImpl = vi.fn<typeof fetch>(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      return handler(url, init);
    },
  );
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function stubSignedIn(handler?: (url: string, init?: RequestInit) => Response) {
  return stubRoutes((url, init) => {
    if (url === "/api/auth/get-session") {
      return jsonResponse({ user });
    }
    if (handler) {
      return handler(url, init);
    }
    throw new Error(`No stub for ${url}`);
  });
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

describe("ListsView", () => {
  it("renders the signed-in user's lists from the local Store", async () => {
    await db.putList(list);
    stubSignedIn();
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Shopping Lists");
    expect(wrapper.text()).toContain("Household");
    expect(wrapper.text()).toContain("Signed in as Test User");
  });

  it("creates a List locally and shows it immediately, even when the server is unreachable", async () => {
    stubSignedIn(() => new Response(null, { status: 503 }));
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('input[name="name"]').setValue("Weekend shop");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("Weekend shop");
    expect((await db.getLists()).map((l) => l.name)).toContain("Weekend shop");
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("signs out and lands on the sign-in view", async () => {
    let signedOut = false;
    stubRoutes((url) => {
      // The router re-checks the session on every navigation, and sign-out
      // invalidates the (stubbed) session cookie on the server.
      if (url === "/api/auth/get-session") {
        return jsonResponse(signedOut ? {} : { session: { token: "tok" }, user });
      }
      if (url === "/api/auth/sign-out") {
        signedOut = true;
        return jsonResponse({ success: true });
      }
      throw new Error(`No stub for ${url}`);
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    const signOutButton = wrapper.findAll("button").find((b) => b.text() === "Sign out");
    expect(signOutButton).toBeDefined();
    await signOutButton?.trigger("click");
    await flushPromises();
    await settle(); // the Store wipe in the sign-out path settles a tick later
    expect(router.currentRoute.value.name).toBe("sign-in");
    expect(wrapper.text()).toContain("Sign in");
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
    stubRoutes((url, init) => {
      apiCalls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/auth/get-session") {
        return jsonResponse({ user });
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
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await settle();

    // The inbox shows the inviting Owner's name, the List name, and both controls.
    expect(wrapper.text()).toContain("Ada invited you to Weekend shop");
    expect(wrapper.find('button[name="accept-invitation"]').exists()).toBe(true);
    expect(wrapper.find('button[name="decline-invitation"]').exists()).toBe(true);

    // Accepting clears the inbox and pulls the List in through Sync.
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
    stubRoutes((url, init) => {
      apiCalls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/auth/get-session") {
        return jsonResponse({ user });
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
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
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

  it("hides the Admin provisioning form from ordinary Members", async () => {
    stubSignedIn();
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find("section.provision").exists()).toBe(false);
    expect(wrapper.find('input[name="provision-email"]').exists()).toBe(false);
  });

  it("lets the Admin provision an account from the home screen", async () => {
    const adminUser: SessionUser = { ...user, role: "admin" };
    let created: { method?: string; body?: string } | null = null;
    stubRoutes((url, init) => {
      if (url === "/api/auth/get-session") {
        return jsonResponse({ session: { token: "tok" }, user: adminUser });
      }
      if (url === "/api/lists" && !init?.method) {
        return jsonResponse({ lists: [] });
      }
      if (url === "/api/invitations" && !init?.method) {
        return jsonResponse({ invitations: [] });
      }
      if (url === "/api/auth/admin/create-user") {
        created = { method: init?.method, body: init?.body as string };
        return jsonResponse({ user: { id: "user-provisioned" } });
      }
      throw new Error(`No stub for ${url}`);
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await settle();

    expect(wrapper.find("section.provision").exists()).toBe(true);

    await wrapper.find('input[name="provision-name"]').setValue("Partner");
    await wrapper.find('input[name="provision-email"]').setValue("partner@example.com");
    await wrapper.find('input[name="provision-password"]').setValue("password-123");
    await wrapper.find("form.provision-form").trigger("submit");
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
});
