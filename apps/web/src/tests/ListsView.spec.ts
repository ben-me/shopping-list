import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { List } from "@shopping-list/api/domain";
import { db } from "../db";
import type { SessionUser } from "../session";
import { mountApp, resetStore, serverDown, settle, stubApi } from "./support/app";

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

beforeEach(async () => {
  await resetStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ListsView", () => {
  it("renders the signed-in user's lists from the local Store", async () => {
    await db.putList(list);
    stubApi({}, { user });

    const { wrapper } = await mountApp("/");
    await flushPromises();

    expect(wrapper.text()).toContain("Shopping Lists");
    expect(wrapper.text()).toContain("Household");
    // The account controls only render for a signed-in session.
    expect(wrapper.text()).toContain("Sign out");
  });

  it("creates a List locally and shows it immediately, even when the server is unreachable", async () => {
    stubApi({}, { user, fallback: serverDown });

    const { wrapper } = await mountApp("/");
    await flushPromises();
    await wrapper.find('input[name="name"]').setValue("Weekend shop");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("Weekend shop");
    expect((await db.getLists()).map((l) => l.name)).toContain("Weekend shop");
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("signs out and lands on the sign-in view", async () => {
    let signedOut = false;
    stubApi(
      {
        // The router re-checks the session on every navigation, and sign-out
        // invalidates the (stubbed) session cookie on the server.
        "GET /api/auth/get-session": () => (signedOut ? {} : { user }),
        "POST /api/auth/sign-out": () => {
          signedOut = true;
          return { success: true };
        },
      },
      { user },
    );

    const { wrapper, router } = await mountApp("/");
    await flushPromises();
    const signOutButton = wrapper.findAll("button").find((b) => b.text() === "Sign out");
    expect(signOutButton).toBeDefined();
    await signOutButton?.trigger("click");
    await flushPromises();
    await settle(); // the Store wipe in the sign-out path settles a tick later
    expect(router.currentRoute.value.name).toBe("sign-in");
    expect(wrapper.text()).toContain("Sign in");
  });
});

describe("switching between Lists", () => {
  it("paints the second List's chrome, not the first one's", async () => {
    const other: List = { ...list, id: "list-2", name: "Hardware store" };
    await db.putList(list);
    await db.putList(other);
    stubApi({}, { user, fallback: serverDown });

    const { wrapper, router } = await mountApp(`/list/${list.id}`);
    await flushPromises();
    expect(wrapper.find("h1").text()).toBe("Household");

    // The layout route record is reused: only its params change.
    await router.push(`/list/${other.id}`);
    await flushPromises();

    expect(wrapper.find("h1").text()).toBe("Hardware store");
  });
});
