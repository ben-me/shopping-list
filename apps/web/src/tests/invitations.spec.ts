import type { Invitation, ListInvitation, PendingInvitation } from "@shopping-list/api/domain";
import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  isSignUpOpen,
  listInvitations,
  pendingInvitations,
  revokeInvitation,
} from "../invitations";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubApi(handler: (url: string, init?: RequestInit) => Response) {
  const fetchImpl = vi.fn<typeof fetch>(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      return handler(url, init);
    },
  );
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

const invitation: Invitation = {
  id: "inv-1",
  listId: "list-1",
  email: "[EMAIL]",
  invitedById: "user-1",
  status: "pending",
  token: "tok",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const listInvitation: ListInvitation = {
  id: "inv-1",
  listId: "list-1",
  email: "[EMAIL]",
  invitedById: "user-1",
  invitedByName: "Test User",
  status: "pending",
  createdAt: new Date().toISOString(),
};

const pending: PendingInvitation = {
  id: "inv-1",
  listId: "list-1",
  listName: "Household",
  invitedById: "user-1",
  invitedByName: "Test User",
  createdAt: new Date().toISOString(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invitations module", () => {
  it("fetches the invitee's pending invitations", async () => {
    stubApi((url) => {
      expect(url).toBe("/api/invitations");
      return jsonResponse({ invitations: [pending] });
    });

    await expect(pendingInvitations()).resolves.toEqual([pending]);
  });

  it("returns an empty inbox rather than crashing when the server omits the field", async () => {
    stubApi(() => jsonResponse({}));

    await expect(pendingInvitations()).resolves.toEqual([]);
  });

  it("lists the invitations on a List", async () => {
    stubApi((url) => {
      expect(url).toBe("/api/lists/list-1/invitations");
      return jsonResponse({ invitations: [listInvitation] });
    });

    await expect(listInvitations("list-1")).resolves.toEqual([listInvitation]);
  });

  it("creates an invitation for the Owner with the invitee's email in the body", async () => {
    stubApi((url, init) => {
      expect(url).toBe("/api/lists/list-1/invitations");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ email: "[EMAIL]" }));
      return jsonResponse({ invitation }, 201);
    });

    await expect(createInvitation("list-1", "[EMAIL]")).resolves.toEqual(invitation);
  });

  it("surfaces the server's rejection message when the invite is not created", async () => {
    stubApi(() => jsonResponse({ error: { message: "That user has already been invited" } }, 400));

    await expect(createInvitation("list-1", "[EMAIL]")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "That user has already been invited",
    });
  });

  it("accepts and declines by invitation id", async () => {
    const calls: Array<[string, string | undefined]> = [];
    stubApi((url, init) => {
      calls.push([url, init?.method]);
      return jsonResponse({ ok: true });
    });

    await acceptInvitation("inv-1");
    await declineInvitation("inv-1");

    expect(calls).toEqual([
      ["/api/invitations/inv-1/accept", "POST"],
      ["/api/invitations/inv-1/decline", "POST"],
    ]);
  });

  it("revokes by list and invitation id (Owner only)", async () => {
    stubApi((url, init) => {
      expect(url).toBe("/api/lists/list-1/invitations/inv-1");
      expect(init?.method).toBe("DELETE");
      return jsonResponse({ ok: true });
    });

    await revokeInvitation("list-1", "inv-1");
  });

  it("reports the bootstrap gate and defaults to closed when the server is unreachable", async () => {
    stubApi((url) =>
      url === "/api/signup-status" ? jsonResponse({ signUpOpen: true }) : jsonResponse({}),
    );

    await expect(isSignUpOpen()).resolves.toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(isSignUpOpen()).resolves.toBe(false);
  });
});
