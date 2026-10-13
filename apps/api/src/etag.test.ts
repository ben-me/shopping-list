import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthEnv } from "./auth";
import type { Db } from "./db";
import type { Invitation, List, PendingInvitation } from "./domain";
import {
  getUserId,
  putList,
  signUp,
  startTestApp,
  uniq,
  wipeDomainTables,
  type TestApp,
} from "./test-support";

describe("reads answered with 304 while their rows are unchanged", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: TestApp;
  let db: Db;

  beforeAll(async () => {
    ({ mf, env, app, db } = await startTestApp("local-d1-etag-db"));
    await wipeDomainTables(db);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  async function newUser(prefix: string) {
    const { cookie, email } = await signUp(app, env, prefix);
    return { cookie, email, id: await getUserId(app, env, cookie) };
  }

  async function listFor(cookie: string, name = "Household") {
    const listId = uniq("list");
    const res = await putList(app, env, cookie, listId, name);
    expect(res.status).toBe(201);
    return listId;
  }

  function get(cookie: string, path: string, ifNoneMatch?: string) {
    return app.request(
      path,
      { headers: ifNoneMatch ? { cookie, "if-none-match": ifNoneMatch } : { cookie } },
      env,
    );
  }

  /** The tag a read comes back with, as the device would keep it. */
  async function tagOf(cookie: string, path: string): Promise<string> {
    const res = await get(cookie, path);
    expect(res.status).toBe(200);
    const tag = res.headers.get("etag");
    expect(tag).toBeTruthy();
    return tag ?? "";
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

  function putItem(cookie: string, listId: string, itemId: string, body: unknown) {
    return app.request(
      `/api/lists/${listId}/items/${itemId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      },
      env,
    );
  }

  function deleteAt(cookie: string, path: string) {
    return app.request(path, { method: "DELETE", headers: { cookie } }, env);
  }

  async function addItem(cookie: string, listId: string, name: string) {
    const itemId = uniq("item");
    const res = await putItem(cookie, listId, itemId, { name });
    expect(res.status).toBe(201);
    return itemId;
  }

  async function addPayment(cookie: string, listId: string, amountInCents: number) {
    const paymentId = uniq("payment");
    const res = await app.request(
      `/api/lists/${listId}/payments/${paymentId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ amountInCents, paidAt: "2026-02-01T12:00:00.000Z" }),
      },
      env,
    );
    expect(res.status).toBe(201);
    return paymentId;
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

  function accept(cookie: string, invitationId: string) {
    return app.request(
      `/api/invitations/${invitationId}/accept`,
      { method: "POST", headers: { cookie } },
      env,
    );
  }

  it("answers a read the caller already holds with a 304 and no body", async () => {
    const owner = await newUser("etagowner");
    const listId = await listFor(owner.cookie);
    await addItem(owner.cookie, listId, "Milk");

    const paths = ["/api/lists", `/api/lists/${listId}/items`, `/api/lists/${listId}/members`];
    for (const path of paths) {
      const tag = await tagOf(owner.cookie, path);
      expect(await unchanged(owner.cookie, path, tag)).toBe(true);
    }
  });

  it("sends new rows with a new tag once a read changes", async () => {
    const owner = await newUser("etagchange");
    const listId = await listFor(owner.cookie);
    const itemsTag = await tagOf(owner.cookie, `/api/lists/${listId}/items`);

    await addItem(owner.cookie, listId, "Bread");

    expect(await unchanged(owner.cookie, `/api/lists/${listId}/items`, itemsTag)).toBe(false);
    const res = await get(owner.cookie, `/api/lists/${listId}/items`, itemsTag);
    const { items } = (await res.json()) as { items: { name: string }[] };
    expect(items.map((item) => item.name)).toEqual(["Bread"]);
  });

  it("leaves the other reads of a List alone when one of them changes", async () => {
    const owner = await newUser("etagscoped");
    const listId = await listFor(owner.cookie);
    await addItem(owner.cookie, listId, "Milk");
    await addPayment(owner.cookie, listId, 1250);

    const lists = await tagOf(owner.cookie, "/api/lists");
    const items = await tagOf(owner.cookie, `/api/lists/${listId}/items`);
    const payments = await tagOf(owner.cookie, `/api/lists/${listId}/payments`);
    const members = await tagOf(owner.cookie, `/api/lists/${listId}/members`);

    await addItem(owner.cookie, listId, "Bread");

    expect(await unchanged(owner.cookie, `/api/lists/${listId}/items`, items)).toBe(false);
    expect(await unchanged(owner.cookie, "/api/lists", lists)).toBe(true);
    expect(await unchanged(owner.cookie, `/api/lists/${listId}/payments`, payments)).toBe(true);
    expect(await unchanged(owner.cookie, `/api/lists/${listId}/members`, members)).toBe(true);
  });

  it("keeps a List's tag apart from another List's", async () => {
    const owner = await newUser("etagperlist");
    const mineId = await listFor(owner.cookie, "Mine");
    const otherId = await listFor(owner.cookie, "Other");
    await addItem(owner.cookie, otherId, "Milk");
    const mineTag = await tagOf(owner.cookie, `/api/lists/${mineId}/items`);

    await addItem(owner.cookie, otherId, "Bread");

    expect(await unchanged(owner.cookie, `/api/lists/${mineId}/items`, mineTag)).toBe(true);
  });

  it("moves the tag when the row a change drops was the newest one", async () => {
    const owner = await newUser("etagdelete");
    const listId = await listFor(owner.cookie);
    await addItem(owner.cookie, listId, "Milk");
    const newestItemId = await addItem(owner.cookie, listId, "Bread");
    await putItem(owner.cookie, listId, newestItemId, { checked: true });
    const itemsTag = await tagOf(owner.cookie, `/api/lists/${listId}/items`);

    const res = await deleteAt(owner.cookie, `/api/lists/${listId}/items/${newestItemId}`);
    expect(res.status).toBe(200);

    expect(await unchanged(owner.cookie, `/api/lists/${listId}/items`, itemsTag)).toBe(false);
  });

  it("moves a Member's Lists tag when their Membership appears or goes, and leaves the Owner's alone", async () => {
    const owner = await newUser("etagownerindex");
    const member = await newUser("etagmemberindex");
    const listId = await listFor(owner.cookie);
    const ownerTag = await tagOf(owner.cookie, "/api/lists");
    const memberTag = await tagOf(member.cookie, "/api/lists");

    const invitation = await invite(owner.cookie, listId, member.email);

    // An Invitation is not yet a Membership: it is not in the List index.
    expect(await unchanged(member.cookie, "/api/lists", memberTag)).toBe(true);
    expect(await unchanged(owner.cookie, "/api/lists", ownerTag)).toBe(true);

    expect((await accept(member.cookie, invitation.id)).status).toBe(200);

    // Memberships carry no updatedAt, so the count is what tells the member.
    expect(await unchanged(member.cookie, "/api/lists", memberTag)).toBe(false);
    const gained = await get(member.cookie, "/api/lists", memberTag);
    const { lists } = (await gained.json()) as { lists: List[] };
    expect(lists.map((list) => list.id)).toEqual([listId]);
    expect(await unchanged(owner.cookie, "/api/lists", ownerTag)).toBe(true);

    const memberWithListTag = await tagOf(member.cookie, "/api/lists");
    const left = await deleteAt(member.cookie, `/api/lists/${listId}/membership`);
    expect(left.status).toBe(200);

    // Back to no Lists at all, which is a different read from the one with the List.
    expect(await unchanged(member.cookie, "/api/lists", memberWithListTag)).toBe(false);
  });

  it("tags each user's invitation inbox apart from a List's invitations", async () => {
    const owner = await newUser("etaginviteowner");
    const member = await newUser("etaginvitemember");
    const listId = await listFor(owner.cookie);
    const ownerInbox = await tagOf(owner.cookie, "/api/invitations");
    const memberInbox = await tagOf(member.cookie, "/api/invitations");
    const listInvitations = await tagOf(owner.cookie, `/api/lists/${listId}/invitations`);

    const invitation = await invite(owner.cookie, listId, member.email);

    expect(await unchanged(owner.cookie, `/api/lists/${listId}/invitations`, listInvitations)).toBe(
      false,
    );
    expect(await unchanged(member.cookie, "/api/invitations", memberInbox)).toBe(false);
    expect(await unchanged(owner.cookie, "/api/invitations", ownerInbox)).toBe(true);

    const inInbox = await get(member.cookie, "/api/invitations", memberInbox);
    const { invitations } = (await inInbox.json()) as { invitations: PendingInvitation[] };
    expect(invitations.map((row) => row.id)).toEqual([invitation.id]);
    const inboxWithInvitation = await tagOf(member.cookie, "/api/invitations");

    const declined = await app.request(
      `/api/invitations/${invitation.id}/decline`,
      { method: "POST", headers: { cookie: member.cookie } },
      env,
    );
    expect(declined.status).toBe(200);

    // Back to an empty inbox, which is a different read from the one with the Invitation.
    expect(await unchanged(member.cookie, "/api/invitations", inboxWithInvitation)).toBe(false);
    expect(await unchanged(owner.cookie, `/api/lists/${listId}/invitations`, listInvitations)).toBe(
      false,
    );
  });
});
