import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { List, PendingInvitation } from "@shopping-list/api/domain";
import { pendingInvitationCount } from "../pending-invitations";
import type { SessionUser } from "../session";
import { mountApp, resetStore, settle, stubApi } from "./support/app";

const user: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "[EMAIL]",
};

interface SettingsStub {
  /** The Admin role is what opens the Add-a-user section. */
  role?: string;
  invitations?: PendingInvitation[];
  lists?: List[];
}

/** The routes the screen reads on its own, over a signed-in session. */
function stubSettingsApi(stub: SettingsStub = {}) {
  stubApi(
    {
      "GET /api/lists": { lists: stub.lists ?? [] },
      "GET /api/invitations": () => ({ invitations: stub.invitations ?? [] }),
    },
    { user: { ...user, role: stub.role } },
  );
}

beforeEach(async () => {
  await resetStore();
  pendingInvitationCount.value = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsView", () => {
  it("shows the Add-a-user form to the Admin and posts it on submit", async () => {
    let created: { method?: string; body?: string } | null = null;
    stubApi(
      {
        "GET /api/lists": { lists: [] },
        "GET /api/invitations": { invitations: [] },
        "POST /api/auth/admin/create-user": (init) => {
          created = { method: init?.method, body: String(init?.body) };
          return { user: { id: "user-2" } };
        },
      },
      { user: { ...user, role: "admin" } },
    );

    const { wrapper } = await mountApp("/settings");
    await flushPromises();
    await settle();

    expect(wrapper.find('section[aria-label="Add a user"]').exists()).toBe(true);

    await wrapper.find('input[name="add-user-name"]').setValue("Partner");
    await wrapper.find('input[name="add-user-email"]').setValue("partner@example.com");
    await wrapper.find('input[name="add-user-password"]').setValue("password-123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    expect(created).toEqual({
      method: "POST",
      body: JSON.stringify({
        name: "Partner",
        email: "partner@example.com",
        password: "password-123",
        role: "user",
        data: { emailVerified: true },
      }),
    });
    expect(wrapper.text()).toContain("Partner can now sign in.");
  });

  it("lets a Member open Settings and hides the Add-a-user section", async () => {
    stubSettingsApi({ role: "user" });

    const { wrapper, router } = await mountApp("/settings");
    await flushPromises();
    await settle();

    expect(router.currentRoute.value.name).toBe("settings");
    expect(wrapper.find('section[aria-label="Add a user"]').exists()).toBe(false);
    expect(wrapper.find('section[aria-label="Invitations for you"]').exists()).toBe(false);
  });

  it("lets the invitee accept a pending invitation and clears the inbox", async () => {
    const invitation: PendingInvitation = {
      id: "inv-1",
      listId: "list-9",
      listName: "Weekend shop",
      invitedById: "user-9",
      invitedByName: "Ada",
      createdAt: new Date().toISOString(),
    };
    let pending: PendingInvitation[] = [invitation];
    let accepted = false;
    stubApi(
      {
        "GET /api/lists": { lists: [] },
        "GET /api/invitations": () => ({ invitations: pending }),
        "POST /api/invitations/inv-1/accept": () => {
          accepted = true;
          pending = [];
          return { ok: true };
        },
      },
      { user },
    );

    const { wrapper } = await mountApp("/settings");
    await flushPromises();
    await settle();

    // The inbox shows the inviting Owner's name, the List name, and both controls.
    expect(wrapper.text()).toContain("Ada invited you to Weekend shop");
    expect(wrapper.find('button[name="accept-invitation"]').exists()).toBe(true);
    expect(wrapper.find('button[name="decline-invitation"]').exists()).toBe(true);
    // The Settings badge reads the same count as the inbox.
    expect(pendingInvitationCount.value).toBe(1);

    // Accepting clears the inbox; Sync pulls the List in for the Lists home.
    await wrapper.find('button[name="accept-invitation"]').trigger("click");
    await flushPromises();
    await settle();

    expect(accepted).toBe(true);
    expect(wrapper.text()).not.toContain("Ada invited you");
    expect(pendingInvitationCount.value).toBe(0);
  });

  it("lets the invitee decline a pending invitation", async () => {
    const invitation: PendingInvitation = {
      id: "inv-2",
      listId: "list-9",
      listName: "Holiday shop",
      invitedById: "user-9",
      invitedByName: "Ada",
      createdAt: new Date().toISOString(),
    };
    let pending: PendingInvitation[] = [invitation];
    let declined = false;
    stubApi(
      {
        "GET /api/lists": { lists: [] },
        "GET /api/invitations": () => ({ invitations: pending }),
        "POST /api/invitations/inv-2/decline": () => {
          declined = true;
          pending = [];
          return { ok: true };
        },
      },
      { user },
    );

    const { wrapper } = await mountApp("/settings");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("Ada invited you to Holiday shop");

    await wrapper.find('button[name="decline-invitation"]').trigger("click");
    await flushPromises();
    await settle();

    expect(declined).toBe(true);
    expect(wrapper.text()).not.toContain("Ada invited you");
  });
});
