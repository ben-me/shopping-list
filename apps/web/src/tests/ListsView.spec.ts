import "fake-indexeddb/auto";

import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import type { List } from "@shopping-list/api/domain";
import App from "../App.vue";
import { db } from "../db";
import { createAppRouter } from "../router";
import { session, type SessionUser } from "../session";

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
  Object.assign(session, { user: null, restoring: true });
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
    await wrapper.find('[data-testid="list-name"]').setValue("Weekend shop");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("Weekend shop");
    expect((await db.getLists()).map((l) => l.name)).toContain("Weekend shop");
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("signs out and lands on the sign-in view", async () => {
    stubSignedIn((url) => {
      if (url === "/api/auth/sign-out") {
        return jsonResponse({});
      }
      throw new Error(`No stub for ${url}`);
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('[data-testid="sign-out"]').trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("sign-in");
    expect(wrapper.text()).toContain("Sign in");
  });
});
