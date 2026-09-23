import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, type RouteLocationRaw } from "vue-router";
import AppBar from "../components/AppBar.vue";
import { createAppRouter } from "../router";
import { _resetSession, session, type SessionUser } from "../session";

const user: SessionUser = { id: "user-1", name: "Test User", email: "[EMAIL]" };

async function mountBar(
  props: { title: string; back?: RouteLocationRaw; settings?: boolean },
  path = "/",
  signedInAs?: SessionUser,
) {
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();
  // Set after navigation: the route guard's session restore would overwrite it.
  if (signedInAs) {
    session.user = signedInAs;
  }
  return mount(AppBar, { props, global: { plugins: [router] } });
}

afterEach(() => {
  _resetSession();
});

describe("AppBar", () => {
  it("renders the route context as the page heading", async () => {
    const bar = await mountBar({ title: "Shopping Lists" });
    expect(bar.find("h1").text()).toBe("Shopping Lists");
  });

  it("renders a tappable back link when a back target is given", async () => {
    const bar = await mountBar({ title: "Household", back: { name: "lists" } });
    const back = bar.find("a.back");
    expect(back.exists()).toBe(true);
    expect(back.attributes("href")).toBe("/");
  });

  it("offers no back link on the home screen", async () => {
    const bar = await mountBar({ title: "Shopping Lists" });
    expect(bar.find("a.back").exists()).toBe(false);
  });

  it("shows Settings and Sign out on signed-in screens", async () => {
    const bar = await mountBar({ title: "Shopping Lists", settings: true }, "/", user);
    expect(bar.find('a[href="/settings"]').text()).toBe("Settings");
    expect(bar.findAll("button").some((b) => b.text() === "Sign out")).toBe(true);
  });

  it("shows neither account action while signed out", async () => {
    const bar = await mountBar({ title: "Sign in" });
    await flushPromises();
    expect(bar.find("nav").exists()).toBe(false);
  });
});
