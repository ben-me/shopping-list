import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { SessionUser } from "../session";
import { jsonResponse, mountApp, resetStore, stubApi } from "./support/app";

const user: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "[EMAIL]",
};

beforeEach(async () => {
  await resetStore();
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
      "/api/auth/get-session": () => (signedIn ? { user } : {}),
      "/api/auth/sign-in/email": () => {
        signedIn = true;
        return { token: "tok", user };
      },
      "/api/signup-status": () => ({ signUpOpen: false }),
    });

    const { wrapper, router } = await mountApp("/sign-in");
    await wrapper.find('input[name="email"]').setValue("[EMAIL]");
    await wrapper.find('input[name="password"]').setValue("password123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("lists");
    expect(wrapper.text()).toContain("Shopping Lists");
    expect(wrapper.text()).toContain("Sign out");
    expect(wrapper.text()).toContain("No lists yet. Create the first one below.");
  });

  it("does not offer sign-up once the bootstrap Admin exists", async () => {
    stubApi({
      "/api/auth/get-session": () => ({}),
      "/api/signup-status": () => ({ signUpOpen: false }),
    });

    const { wrapper } = await mountApp("/sign-in");
    await flushPromises();

    expect(wrapper.text()).not.toContain("Create an account");
  });

  it("offers sign-up only while the database is empty (bootstrap)", async () => {
    stubApi({
      "/api/auth/get-session": () => ({}),
      "/api/signup-status": () => ({ signUpOpen: true }),
    });

    const { wrapper } = await mountApp("/sign-in");
    await flushPromises();

    expect(wrapper.text()).toContain("Create an account");
  });

  it("signs a new user up (bootstrap) and lands on the lists index", async () => {
    let signedIn = false;
    stubApi({
      "/api/auth/get-session": () => (signedIn ? { user } : {}),
      "/api/auth/sign-up/email": () => {
        signedIn = true;
        return { token: "tok", user };
      },
      "/api/signup-status": () => ({ signUpOpen: true }),
    });

    const { wrapper, router } = await mountApp("/sign-in");
    await flushPromises();
    await wrapper.find("button[type=button]").trigger("click");
    await wrapper.find('input[name="name"]').setValue("Test User");
    await wrapper.find('input[name="email"]').setValue("[EMAIL]");
    await wrapper.find('input[name="password"]').setValue("password123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("lists");
    expect(wrapper.text()).toContain("Sign out");
  });

  it("shows a form error the user can act on", async () => {
    stubApi({
      "/api/auth/get-session": () => ({}),
      "/api/auth/sign-in/email": () => jsonResponse({ message: "Invalid email or password" }, 401),
    });

    const { wrapper, router } = await mountApp("/sign-in");
    await wrapper.find('input[name="email"]').setValue("[EMAIL]");
    await wrapper.find('input[name="password"]').setValue("wrong");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Invalid email or password");
    expect(router.currentRoute.value.name).toBe("sign-in");
  });
});
