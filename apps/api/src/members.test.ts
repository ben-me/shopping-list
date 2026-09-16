import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getUserId, putList, signUp, startTestApp, type TestApp } from "./test-support";
import type { AuthEnv } from "./auth";
import type { ApiErrorEnvelope } from "./errors";
import type { Invitation } from "./domain";

function asError(body: unknown) {
  return body as ApiErrorEnvelope;
}

describe("members (who has access, and leaving — ADR 0003)", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: TestApp;

  beforeAll(async () => {
    ({ mf, env, app } = await startTestApp("local-d1-members-db"));
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

  async function makeMember(
    ownerCookie: string,
    listId: string,
    invitee: { cookie: string; email: string },
  ) {
    const inviteRes = await invite(ownerCookie, listId, invitee.email);
    const { invitation } = (await inviteRes.json()) as { invitation: Invitation };
    const acceptRes = await app.request(
      `/api/invitations/${invitation.id}/accept`,
      { method: "POST", headers: { cookie: invitee.cookie } },
      env,
    );
    expect(acceptRes.status).toBe(200);
  }

  async function listIdsFor(cookie: string) {
    const res = await app.request("/api/lists", { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const { lists } = (await res.json()) as { lists: { id: string }[] };
    return lists.map((list) => list.id);
  }

  async function memberNames(cookie: string, listId: string) {
    const res = await app.request(`/api/lists/${listId}/members`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as { members: { memberId: string; name: string }[] };
    return members;
  }

  it("names every Member, Owner first, for a joined Member too", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const listId = await createListFor(owner.cookie);
    await makeMember(owner.cookie, listId, invitee);

    const members = await memberNames(invitee.cookie, listId);

    expect(members[0]).toMatchObject({ memberId: owner.id, name: "Test User" });
    expect(members[1]).toMatchObject({ memberId: invitee.id, name: "Test User" });
  });

  it("lets a joined Member leave: the List stops appearing and access closes", async () => {
    const owner = await newUser("owner");
    const invitee = await newUser("invitee");
    const listId = await createListFor(owner.cookie);
    await makeMember(owner.cookie, listId, invitee);

    expect(await listIdsFor(invitee.cookie)).toContain(listId);

    const leaveRes = await app.request(
      `/api/lists/${listId}/membership`,
      { method: "DELETE", headers: { cookie: invitee.cookie } },
      env,
    );
    expect(leaveRes.status).toBe(200);

    // The List stops appearing for them, and they no longer count as Members.
    expect(await listIdsFor(invitee.cookie)).not.toContain(listId);
    const membersRes = await app.request(
      `/api/lists/${listId}/members`,
      { headers: { cookie: invitee.cookie } },
      env,
    );
    expect(membersRes.status).toBe(403);

    // The Owner still holds the List, now alone.
    const ownerMembers = await memberNames(owner.cookie, listId);
    expect(ownerMembers.map((m) => m.memberId)).toEqual([owner.id]);
  });

  it("forbids the Owner from leaving their own List", async () => {
    const owner = await newUser("owner");
    const listId = await createListFor(owner.cookie);

    const leaveRes = await app.request(
      `/api/lists/${listId}/membership`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
      env,
    );
    expect(leaveRes.status).toBe(403);
    expect(asError(await leaveRes.json()).error.message).toContain("Owner cannot leave");

    expect(await listIdsFor(owner.cookie)).toContain(listId);
  });
});
