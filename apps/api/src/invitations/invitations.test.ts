import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { getUserId, putList, signUp, startTestApp, type TestApp } from "../test-support";
import type { AuthEnv } from "../auth";
import * as schema from "../schema";
import type { ApiErrorEnvelope } from "../errors";
import type { Invitation, ListInvitation, PendingInvitation } from "../domain";

function asError(body: unknown) {
  return body as ApiErrorEnvelope;
}

describe("invitations (in-app, existing users only — ADR 0003)", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: TestApp;
  let db: Db;

  beforeAll(async () => {
    ({ mf, env, app, db } = await startTestApp("local-d1-invitations-db"));
  });

  afterAll(async () => {
    await mf.dispose();
  });

  async function newUser(prefix: string) {
    const { cookie, email } = await signUp(app, env, prefix);
    return { cookie, email, id: await getUserId(app, env, cookie) };
  }

  const newListId = () => "list-" + crypto.randomUUID();

  async function createListFor(cookie: string) {
    const id = newListId();
    const res = await putList(app, env, cookie, id, "Household");
    expect(res.status).toBe(201);
    return id;
  }

  function invite(cookie: string, listId: string, email: string) {
    return app.request(
      `/api/lists/${listId}/invitations`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ email }),
      },
      env,
    );
  }

  async function listInvitations(cookie: string, listId: string) {
    const res = await app.request(`/api/lists/${listId}/invitations`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    return (await res.json()) as { invitations: ListInvitation[] };
  }

  async function myPending(cookie: string) {
    const res = await app.request("/api/invitations", { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    return (await res.json()) as { invitations: PendingInvitation[] };
  }

  it("lets the Owner invite an existing user; the Invitation appears on the List", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const listId = await createListFor(owner.cookie);

    const res = await invite(owner.cookie, listId, invitee.email);
    expect(res.status).toBe(201);
    const { invitation } = (await res.json()) as { invitation: Invitation };
    expect(invitation).toMatchObject({
      listId: listId,
      email: invitee.email,
      invitedById: owner.id,
      status: "pending",
    });
    expect(invitation.token).toBeTruthy();

    const { invitations } = await listInvitations(owner.cookie, listId);
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({
      email: invitee.email,
      invitedByName: "Test User",
      status: "pending",
    });
  });

  it("rejects inviting a user without an account", async () => {
    const owner = await newUser("owner");
    const listId = await createListFor(owner.cookie);

    const res = await invite(owner.cookie, listId, "nobody@example.com");
    const body = asError(await res.json());

    expect(res.status).toBe(400);
    expect(body.error.message).toContain("no account for that email");
  });

  it("rejects inviting an existing Member", async () => {
    const owner = await newUser("owner");
    const member = await newUser("member");
    const listId = await createListFor(owner.cookie);

    // First the Member gets invited and accepts, becoming a Member...
    const first = await invite(owner.cookie, listId, member.email);
    expect(first.status).toBe(201);
    const { invitation } = (await first.json()) as { invitation: Invitation };
    await app.request(
      `/api/invitations/${invitation.id}/accept`,
      { method: "POST", headers: { cookie: member.cookie } },
      env,
    );

    // ...so a second invite is rejected with an actionable error.
    const res = await invite(owner.cookie, listId, member.email);
    const body = asError(await res.json());
    expect(res.status).toBe(400);
    expect(body.error.message).toContain("already a member");
  });

  it("rejects inviting someone already invited (still pending)", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const listId = await createListFor(owner.cookie);

    await invite(owner.cookie, listId, invitee.email);
    const res = await invite(owner.cookie, listId, invitee.email);
    const body = asError(await res.json());

    expect(res.status).toBe(400);
    expect(body.error.message).toContain("already been invited");
  });

  it("rejects invites from a non-Owner and revokes from a non-Owner", async () => {
    const owner = await newUser("owner");
    const member = await newUser("member");
    const outsider = await newUser("outsider");
    const listId = await createListFor(owner.cookie);

    // Make the member an actual Member, since a plain outsider has no access
    // to the List at all — the AC covers anyone who is not the Owner.
    const inviteRes = await invite(owner.cookie, listId, member.email);
    expect(inviteRes.status).toBe(201);
    const { invitation } = (await inviteRes.json()) as { invitation: Invitation };
    await app.request(
      `/api/invitations/${invitation.id}/accept`,
      { method: "POST", headers: { cookie: member.cookie } },
      env,
    );

    const memberInvite = await invite(member.cookie, listId, outsider.email);
    const memberBody = asError(await memberInvite.json());
    expect(memberInvite.status).toBe(403);
    expect(memberBody.error.message).toContain("Only the Owner can invite");

    const memberRevoke = await app.request(
      `/api/lists/${listId}/invitations/${invitation.id}`,
      { method: "DELETE", headers: { cookie: member.cookie } },
      env,
    );
    const revokeBody = asError(await memberRevoke.json());
    expect(memberRevoke.status).toBe(403);
    expect(revokeBody.error.message).toContain("Only the Owner can revoke");
  });

  it("shows the invitee their pending Invitations with Owner and List names", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const listId = await createListFor(owner.cookie);
    await invite(owner.cookie, listId, invitee.email);

    const { invitations } = await myPending(invitee.cookie);
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({
      listName: "Household",
      invitedByName: "Test User",
    });
    expect(invitations[0]?.listId).toBe(listId);
  });

  it("serves the List's Members with names so every device can mirror them", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const listId = await createListFor(owner.cookie);
    const inviteRes = await invite(owner.cookie, listId, invitee.email);
    const { invitation } = (await inviteRes.json()) as { invitation: Invitation };
    await app.request(
      `/api/invitations/${invitation.id}/accept`,
      { method: "POST", headers: { cookie: invitee.cookie } },
      env,
    );

    // The Owner's device can pull the members the accept created, named.
    const res = await app.request(
      `/api/lists/${listId}/members`,
      { headers: { cookie: owner.cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as { members: { memberId: string; name: string }[] };
    expect(members.map((m) => m.memberId)).toContain(invitee.id);
    expect(members.find((m) => m.memberId === owner.id)?.name).toBe("Test User");
    expect(members[0]?.memberId).toBe(owner.id);

    // An outsider is refused.
    const outsider = await newUser("outsider");
    const outsiderRes = await app.request(
      `/api/lists/${listId}/members`,
      { headers: { cookie: outsider.cookie } },
      env,
    );
    expect(outsiderRes.status).toBe(403);
  });

  it("lets the invitee accept and become a Member with equal rights", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const listId = await createListFor(owner.cookie);
    const inviteRes = await invite(owner.cookie, listId, invitee.email);
    const { invitation } = (await inviteRes.json()) as { invitation: Invitation };

    const acceptRes = await app.request(
      `/api/invitations/${invitation.id}/accept`,
      { method: "POST", headers: { cookie: invitee.cookie } },
      env,
    );
    expect(acceptRes.status).toBe(200);

    // The invitee is now a Member: they can read the List like the Owner.
    const listsRes = await app.request("/api/lists", { headers: { cookie: invitee.cookie } }, env);
    const { lists } = (await listsRes.json()) as { lists: { id: string }[] };
    expect(lists.map((l) => l.id)).toContain(listId);

    const membership = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.memberId, invitee.id))
      .get();
    expect(membership?.listId).toBe(listId);

    // The invitation is no longer pending anywhere.
    expect((await myPending(invitee.cookie)).invitations).toHaveLength(0);
    const { invitations } = await listInvitations(owner.cookie, listId);
    expect(invitations[0]?.status).toBe("accepted");
  });

  it("rejects accept/decline from anyone but the invitee, and on closed invitations", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const interloper = await newUser("interloper");
    const listId = await createListFor(owner.cookie);
    const inviteRes = await invite(owner.cookie, listId, invitee.email);
    const { invitation } = (await inviteRes.json()) as { invitation: Invitation };

    // Not the invitee → 403.
    const wrongUser = await app.request(
      `/api/invitations/${invitation.id}/accept`,
      { method: "POST", headers: { cookie: interloper.cookie } },
      env,
    );
    const wrongBody = asError(await wrongUser.json());
    expect(wrongUser.status).toBe(403);
    expect(wrongBody.error.message).toContain("was not sent to you");

    // A second invitee (the Owner) → 403 too.
    const ownerDeclines = await app.request(
      `/api/invitations/${invitation.id}/decline`,
      { method: "POST", headers: { cookie: owner.cookie } },
      env,
    );
    expect(ownerDeclines.status).toBe(403);

    // Accept, then a second accept is no longer pending → 400.
    await app.request(
      `/api/invitations/${invitation.id}/accept`,
      { method: "POST", headers: { cookie: invitee.cookie } },
      env,
    );
    const again = await app.request(
      `/api/invitations/${invitation.id}/accept`,
      { method: "POST", headers: { cookie: invitee.cookie } },
      env,
    );
    const againBody = asError(await again.json());
    expect(again.status).toBe(400);
    expect(againBody.error.message).toContain("no longer pending");
  });

  it("lets the invitee decline (mapped to revoked) and the Owner revoke a pending invitation", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const another = await newUser("another");
    const listId = await createListFor(owner.cookie);

    // Decline flow.
    const declineTarget = await invite(owner.cookie, listId, invitee.email);
    const { invitation: declineInvitation } = (await declineTarget.json()) as {
      invitation: Invitation;
    };
    const declineRes = await app.request(
      `/api/invitations/${declineInvitation.id}/decline`,
      { method: "POST", headers: { cookie: invitee.cookie } },
      env,
    );
    expect(declineRes.status).toBe(200);

    const { invitations: afterDecline } = await listInvitations(owner.cookie, listId);
    expect(afterDecline.find((i) => i.id === declineInvitation.id)?.status).toBe("revoked");
    expect((await myPending(invitee.cookie)).invitations).toHaveLength(0);

    // Owner revoke flow.
    const revokeTarget = await invite(owner.cookie, listId, another.email);
    const { invitation: revokeInvitation } = (await revokeTarget.json()) as {
      invitation: Invitation;
    };
    const revokeRes = await app.request(
      `/api/lists/${listId}/invitations/${revokeInvitation.id}`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
      env,
    );
    expect(revokeRes.status).toBe(200);

    const { invitations: afterRevoke } = await listInvitations(owner.cookie, listId);
    expect(afterRevoke.find((i) => i.id === revokeInvitation.id)?.status).toBe("revoked");
    expect((await myPending(another.cookie)).invitations).toHaveLength(0);

    // A revoked invite can be sent again (the old one is closed, not blocking).
    const reinvite = await invite(owner.cookie, listId, another.email);
    expect(reinvite.status).toBe(201);
  });

  it("rejects an accept for an unknown invitation", async () => {
    const invitee = await newUser("invitee");
    const res = await app.request(
      "/api/invitations/missing-invitation/accept",
      { method: "POST", headers: { cookie: invitee.cookie } },
      env,
    );
    const body = asError(await res.json());
    expect(res.status).toBe(404);
    expect(body.error.message).toContain("Invitation not found");
  });
});
