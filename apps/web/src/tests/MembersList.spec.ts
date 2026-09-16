import "fake-indexeddb/auto";

import { flushPromises, mount } from "@vue/test-utils";
import type { ListInvitation, MemberSummary } from "@shopping-list/api/domain";
import MembersList from "../components/MembersList.vue";
import { _resetSession, session, type SessionUser } from "../session";

const user: SessionUser = { id: "user-1", name: "Test User", email: "[EMAIL]" };
const listId = "list-1";

const members: MemberSummary[] = [
  { memberId: user.id, name: "Test User", joinedAt: "2026-01-01T00:00:00.000Z" },
  { memberId: "user-2", name: "Ada", joinedAt: "2026-01-02T00:00:00.000Z" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubRoutes(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      return handler(url, init);
    }),
  );
}

function memberStub() {
  stubRoutes((url) => {
    if (url === `/api/lists/${listId}/members`) {
      return jsonResponse({ members });
    }
    if (url === `/api/lists/${listId}/invitations`) {
      return jsonResponse({ invitations: [] });
    }
    throw new Error(`No stub for ${url}`);
  });
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

beforeEach(() => {
  _resetSession();
  session.user = user;
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetSession();
});

async function mountList() {
  const wrapper = mount(MembersList, { props: { listId } });
  await flushPromises();
  return wrapper;
}

describe("MembersList", () => {
  it("shows every Member's name, marking the signed-in user", async () => {
    memberStub();
    const wrapper = await mountList();
    await settle();

    expect(wrapper.text()).toContain("Test User (you)");
    expect(wrapper.text()).toContain("Ada");
  });

  it("lets the Owner invite by email and revoke a pending invitation", async () => {
    let invitations: ListInvitation[] = [];
    stubRoutes((url, init) => {
      if (url === `/api/lists/${listId}/members`) {
        return jsonResponse({ members });
      }
      if (url === `/api/lists/${listId}/invitations`) {
        if (init?.method === "POST" && init?.body) {
          const { email } = JSON.parse(init.body as string) as { email: string };
          invitations = [
            {
              id: "inv-1",
              listId,
              email,
              invitedById: user.id,
              invitedByName: "Test User",
              status: "pending",
              createdAt: new Date().toISOString(),
            },
          ];
          return jsonResponse({ invitation: { id: "inv-1" } }, 201);
        }
        return jsonResponse({ invitations });
      }
      if (url === `/api/lists/${listId}/invitations/inv-1` && init?.method === "DELETE") {
        invitations = invitations.map((inv) =>
          inv.id === "inv-1" ? { ...inv, status: "revoked" } : inv,
        );
        return jsonResponse({ ok: true });
      }
      throw new Error(`No stub for ${url}`);
    });

    const wrapper = await mountList();
    await settle();

    // The Owner sees the invite form and an empty invitation list initially.
    expect(wrapper.find('input[name="invite-email"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Nobody invited yet.");

    await wrapper.find('input[name="invite-email"]').setValue("partner@example.com");
    await wrapper.find("form.invite-form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("partner@example.com");
    expect(wrapper.text()).toContain("invited");

    // Revoking closes the invitation.
    await wrapper.find('button[name="revoke-invitation"]').trigger("click");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("closed");
    expect(wrapper.findAll('button[name="revoke-invitation"]')).toHaveLength(0);
  });

  it("hides the invite controls from a Member", async () => {
    stubRoutes((url) => {
      if (url === `/api/lists/${listId}/members`) {
        return jsonResponse({
          members: [
            { memberId: "user-2", name: "Ada", joinedAt: "2026-01-01T00:00:00.000Z" },
            { memberId: user.id, name: "Test User", joinedAt: "2026-01-02T00:00:00.000Z" },
          ],
        });
      }
      if (url === `/api/lists/${listId}/invitations`) {
        return jsonResponse({ invitations: [] });
      }
      throw new Error(`No stub for ${url}`);
    });

    const wrapper = await mountList();
    await settle();

    expect(wrapper.text()).toContain("Ada");
    expect(wrapper.text()).toContain("Test User (you)");
    expect(wrapper.find('input[name="invite-email"]').exists()).toBe(false);
    expect(wrapper.find("form.invite-form").exists()).toBe(false);
  });

  it("opens the panel as a non-modal dialog on mobile and lets it close", async () => {
    memberStub();
    const wrapper = await mountList();

    const dialog = wrapper.find("dialog");
    expect(dialog.element.open).toBe(false);

    await wrapper.find("button.members-toggle").trigger("click");
    expect(dialog.element.open).toBe(true);

    await wrapper.find("button.members-close").trigger("click");
    expect(dialog.element.open).toBe(false);
  });
});
