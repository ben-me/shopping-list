import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import { db } from "../db";
import type { SessionUser } from "../session";
import { mountApp, resetStore, serverDown, stubApi } from "./support/app";

const user: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "[EMAIL]",
};

/** A signed-in session; the Lists index itself is out of reach in these tests. */
function stubSignedInSession() {
  stubApi({}, { user, fallback: serverDown });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await resetStore();
});

describe("App", () => {
  it("redirects an unauthenticated visit to the sign-in view", async () => {
    stubApi();

    const { wrapper } = await mountApp("/");
    await flushPromises();

    expect(wrapper.text()).toContain("Sign in");
    expect(wrapper.text()).not.toContain("Shopping Lists");
  });

  it("renders the lists index for a signed-in session", async () => {
    stubSignedInSession();

    const { wrapper } = await mountApp("/");
    await flushPromises();

    expect(wrapper.text()).toContain("Shopping Lists");
    expect(wrapper.text()).toContain("Sign out");
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

    const { wrapper } = await mountApp("/list/list-1");
    await flushPromises();

    expect(wrapper.text()).toContain("Household");
    expect(wrapper.text()).toContain("Nothing here yet.");
  });

  it("shows the offline banner while the device has no connection", async () => {
    stubSignedInSession();

    const { wrapper } = await mountApp("/");
    await flushPromises();
    const offlineBanner = () => wrapper.find('[role="status"]');
    expect(offlineBanner().exists()).toBe(false);

    window.dispatchEvent(new Event("offline"));
    await flushPromises();
    expect(offlineBanner().exists()).toBe(true);
    expect(wrapper.text()).toContain("Offline");

    window.dispatchEvent(new Event("online"));
    await flushPromises();
    expect(offlineBanner().exists()).toBe(false);
  });
});
