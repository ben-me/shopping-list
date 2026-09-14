import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
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

  it("hides the Add-a-user form from Members", async () => {
    stubSignedIn("user");
    const router = createAppRouter(createMemoryHistory());
    await router.push("/settings");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find("section.add-user").exists()).toBe(false);
    expect(wrapper.find('input[name="add-user-email"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Only the Admin can manage users.");
  });
});
