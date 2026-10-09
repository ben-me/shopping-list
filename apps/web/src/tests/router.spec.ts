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
  it("resolves a navigation without waiting for the background session revalidation", async () => {
    // The first session fetch answers immediately; every later one hangs
    // until released, simulating a slow revalidation.
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubApi(
      {
        "GET /api/auth/get-session": async () => {
          calls += 1;
          if (calls > 1) {
            await gate;
          }
          return { user };
        },
      },
      { user },
    );

    // The first navigation boots the session and may still wait for the network.
    const { router } = await mountApp("/");
    expect(router.currentRoute.value.name).toBe("lists");

    // A later navigation must resolve from the session in hand while the
    // revalidation is still in flight.
    let navigated = false;
    const nav = router.push("/settings").then(() => {
      navigated = true;
    });
    await flushPromises();
    expect(navigated).toBe(true);
    expect(router.currentRoute.value.name).toBe("settings");

    release();
    await nav;
    await flushPromises();
    expect(calls).toBe(2);
  });
});
