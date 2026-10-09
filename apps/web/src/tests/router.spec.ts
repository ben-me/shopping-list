import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { SessionUser } from "../session";
import { mountApp, resetStore, stubApi } from "./support/app";

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

describe("router session guard", () => {
  it("boots the session once, then resolves every navigation without the network", async () => {
    // The boot fetch hangs until released; no other get-session is ever made.
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubApi({
      "GET /api/auth/get-session": async () => {
        calls += 1;
        await gate;
        return { user };
      },
    });

    let booted = false;
    const app = mountApp("/").then((mounted) => {
      booted = true;
      return mounted;
    });
    await flushPromises();
    expect(booted).toBe(false);
    expect(calls).toBe(1);

    release();
    const { router } = await app;
    expect(router.currentRoute.value.name).toBe("lists");

    let navigated = false;
    const nav = router.push("/settings").then(() => {
      navigated = true;
    });
    await flushPromises();
    expect(navigated).toBe(true);
    expect(router.currentRoute.value.name).toBe("settings");

    await nav;
    expect(calls).toBe(1);
  });
});
