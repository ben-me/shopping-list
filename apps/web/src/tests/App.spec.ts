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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubSignedInSession() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => jsonResponse({ user })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetSession();
});

beforeEach(async () => {
  await db.lists.clear();
  await db.outbox.clear();
});

describe("App", () => {
  it("redirects an unauthenticated visit to the sign-in view", async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Sign in");
    expect(wrapper.text()).not.toContain("Shopping Lists");
  });

  it("renders the lists index for a signed-in session", async () => {
    stubSignedInSession();
    const router = createAppRouter(createMemoryHistory());
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Shopping Lists");
    expect(wrapper.text()).toContain("Signed in as Test User");
  });

  it("renders the List view for a signed-in session at /list/:listId", async () => {
    stubSignedInSession();
    await db.syncList({
      id: "list-1",
      ownerId: user.id,
      name: "Household",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/list/list-1");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Household");
    expect(wrapper.text()).toContain("Nothing on this list yet.");
  });
});
