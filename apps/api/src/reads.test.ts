import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthEnv } from "./auth";
import type { Invitation, List, PendingInvitation } from "./domain";
import { getUserId, putList, signUp, startTestApp, uniq, type TestApp } from "./test-support";

describe("the reads a device polls while the app is open", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: TestApp;

  beforeAll(async () => {
    ({ mf, env, app } = await startTestApp("local-d1-reads-db"));
  });

  afterAll(async () => {
    await mf.dispose();
  });

  async function newUser(prefix: string) {
    const { cookie, email } = await signUp(app, env, prefix);
    return { cookie, email, id: await getUserId(app, env, cookie) };
  }

  async function listFor(cookie: string) {
    const listId = uniq("list");
    expect((await putList(app, env, cookie, listId, "Household")).status).toBe(201);
    return listId;
  }

  function get(cookie: string, path: string, ifNoneMatch?: string) {
    return app.request(
      path,
      { headers: ifNoneMatch ? { cookie, "if-none-match": ifNoneMatch } : { cookie } },
      env,
    );
  }

  /** The tag the read came back with, as a device would keep it. */
  async function tagOf(cookie: string, path: string): Promise<string> {
    const res = await get(cookie, path);
    expect(res.status).toBe(200);
    return res.headers.get("etag") ?? "";
  }

  /** Whether the server tells the caller it already holds this read. */
  async function unchanged(cookie: string, path: string, tag: string): Promise<boolean> {
    const res = await get(cookie, path, tag);
    expect([200, 304]).toContain(res.status);
    if (res.status !== 304) {
      return false;
    }
    expect(await res.text()).toBe("");
    return true;
  }

  async function addItem(cookie: string, listId: string, name: string) {
    const res = await app.request(
      `/api/lists/${listId}/items/${uniq("item")}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name }),
      },
      env,
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { item: { id: string } }).item.id;
  }

  async function invite(cookie: string, listId: string, email: string) {
    const res = await app.request(
      `/api/lists/${listId}/invitations`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ email }),
      },
      env,
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { invitation: Invitation }).invitation;
  }

  it("sends the rows with a new tag once a read changes, and leaves the other reads alone", async () => {
    const owner = await newUser("readchange");
    const listId = await listFor(owner.cookie);
    const paths = {
      lists: "/api/lists",
      items: `/api/lists/${listId}/items`,
      payments: `/api/lists/${listId}/payments`,
      members: `/api/lists/${listId}/members`,
    };
    const tags = Object.fromEntries(
      await Promise.all(
        Object.entries(paths).map(async ([key, path]) => [key, await tagOf(owner.cookie, path)]),
      ),
    );

    await addItem(owner.cookie, listId, "Bread");

    expect(await unchanged(owner.cookie, paths.items, tags.items)).toBe(false);
    const res = await get(owner.cookie, paths.items, tags.items);
    const { items } = (await res.json()) as { items: { name: string }[] };
    expect(items.map((item) => item.name)).toEqual(["Bread"]);
    for (const key of ["lists", "payments", "members"] as const) {
      expect(await unchanged(owner.cookie, paths[key], tags[key])).toBe(true);
    }
  });

  it("counts a deletion: dropping the row that carried the newest updatedAt still moves the tag", async () => {
    const owner = await newUser("readdelete");
    const listId = await listFor(owner.cookie);
    await addItem(owner.cookie, listId, "Milk");
    const newestItemId = await addItem(owner.cookie, listId, "Bread");
    const itemsPath = `/api/lists/${listId}/items`;
    const itemsTag = await tagOf(owner.cookie, itemsPath);

    const res = await app.request(
      `/api/lists/${listId}/items/${newestItemId}`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
      env,
    );
    expect(res.status).toBe(200);

    expect(await unchanged(owner.cookie, itemsPath, itemsTag)).toBe(false);
  });

  it("moves a Member's Lists tag when a Membership appears or goes, and leaves the Owner's alone", async () => {
    const owner = await newUser("readownerindex");
    const member = await newUser("readmemberindex");
    const listId = await listFor(owner.cookie);
    const ownerTag = await tagOf(owner.cookie, "/api/lists");
    const memberTag = await tagOf(member.cookie, "/api/lists");
    const invitation = await invite(owner.cookie, listId, member.email);
    const accept = () =>
      app.request(
        `/api/invitations/${invitation.id}/accept`,
        { method: "POST", headers: { cookie: member.cookie } },
        env,
      );

    // An Invitation is not yet a Membership: the index has not moved.
    expect(await unchanged(member.cookie, "/api/lists", memberTag)).toBe(true);
    expect((await accept()).status).toBe(200);

    // Memberships carry no updatedAt, so the count is what tells the member.
    expect(await unchanged(member.cookie, "/api/lists", memberTag)).toBe(false);
    const gained = await get(member.cookie, "/api/lists", memberTag);
    expect(((await gained.json()) as { lists: List[] }).lists.map((row) => row.id)).toEqual([
      listId,
    ]);
    expect(await unchanged(owner.cookie, "/api/lists", ownerTag)).toBe(true);

    const memberWithListTag = await tagOf(member.cookie, "/api/lists");
    const left = await app.request(
      `/api/lists/${listId}/membership`,
      { method: "DELETE", headers: { cookie: member.cookie } },
      env,
    );
    expect(left.status).toBe(200);
    expect(await unchanged(member.cookie, "/api/lists", memberWithListTag)).toBe(false);
  });

  it("tags each user's invitation inbox apart from a List's invitations", async () => {
    const owner = await newUser("readinviteowner");
    const member = await newUser("readinvitemember");
    const listId = await listFor(owner.cookie);
    const ownerInbox = await tagOf(owner.cookie, "/api/invitations");
    const memberInbox = await tagOf(member.cookie, "/api/invitations");
    const listInvitations = await tagOf(owner.cookie, `/api/lists/${listId}/invitations`);

    await invite(owner.cookie, listId, member.email);

    expect(await unchanged(owner.cookie, `/api/lists/${listId}/invitations`, listInvitations)).toBe(
      false,
    );
    expect(await unchanged(member.cookie, "/api/invitations", memberInbox)).toBe(false);
    expect(await unchanged(owner.cookie, "/api/invitations", ownerInbox)).toBe(true);
    const inInbox = await get(member.cookie, "/api/invitations", memberInbox);
    const { invitations } = (await inInbox.json()) as { invitations: PendingInvitation[] };
    expect(invitations).toHaveLength(1);
  });
});
