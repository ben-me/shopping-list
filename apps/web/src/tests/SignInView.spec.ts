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
import { _resetSession, session, type SessionUser } from "../session";

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

function stubApi(routes: Record<string, () => Response>) {
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : String(input);
    const make = routes[url];
    if (!make) throw new Error(`No stub for ${url}`);
    return make();
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

beforeEach(async () => {
  await db.lists.clear();
  await db.outbox.clear();
  _resetSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SignInView", () => {
  it("signs an existing user in and lands on the lists index", async () => {
    let signedIn = false;
    stubApi({
      // The router re-checks the session on every navigation: before sign-in
      // there is no session, after it the (stubbed) cookie session exists.
      "/api/auth/get-session": () =>
        jsonResponse(signedIn ? { session: { token: "tok" }, user } : {}),
      "/api/auth/sign-in/email": () => {
        signedIn = true;
        return jsonResponse({ token: "tok", user });
      },
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/sign-in");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await wrapper.find('[data-testid="email"]').setValue("[EMAIL]");
    await wrapper.find('[data-testid="password"]').setValue("password123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("lists");
    expect(wrapper.text()).toContain("Shopping Lists");
    expect(wrapper.text()).toContain("Signed in as Test User");
  });

  it("signs a new user up and lands on the lists index", async () => {
    let signedIn = false;
    stubApi({
      "/api/auth/get-session": () =>
        jsonResponse(signedIn ? { session: { token: "tok" }, user } : {}),
      "/api/auth/sign-up/email": () => {
        signedIn = true;
        return jsonResponse({ token: "tok", user });
      },
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/sign-in");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await wrapper.find("button[type=button]").trigger("click");
    await wrapper.find('[data-testid="name"]').setValue("Test User");
    await wrapper.find('[data-testid="email"]').setValue("[EMAIL]");
    await wrapper.find('[data-testid="password"]').setValue("password123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("lists");
    expect(wrapper.text()).toContain("Signed in as Test User");
  });

  it("shows a form error the user can act on", async () => {
    stubApi({
      "/api/auth/get-session": () => jsonResponse({}),
      "/api/auth/sign-in/email": () => jsonResponse({ message: "Invalid email or password" }, 401),
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/sign-in");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await wrapper.find('[data-testid="email"]').setValue("[EMAIL]");
    await wrapper.find('[data-testid="password"]').setValue("wrong");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Invalid email or password");
    expect(router.currentRoute.value.name).toBe("sign-in");
  });
});
