import "fake-indexeddb/auto";

import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import App from "../App.vue";
import { db } from "../db";
import { createAppRouter } from "../router";
import { session, type SessionUser } from "../session";

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
  Object.assign(session, { user: null, restoring: true });
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
    const router = createAppRouter(createMemoryHistory());
    await router.push("/list/list-1");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("List");
    expect(wrapper.text()).toContain("list-1");
  });
});
