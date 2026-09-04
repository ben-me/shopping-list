import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./index";
import { createD1Connection, type Db } from "./db";
import { createMembership, createPayment } from "./queries";
import { runMigrations, startMiniflare, testEnvFor } from "./test-support";
import type { AuthEnv } from "./auth";
import type { ApiErrorEnvelope } from "./errors";
import type { Item } from "./domain";
import * as schema from "./schema";

function uniq(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

let signupCounter = 0;
function uniqueEmail() {
  signupCounter += 1;
  return `itemuser${signupCounter}@example.com`;
}

async function getUserId(app: ReturnType<typeof createApp>, env: AuthEnv, cookie: string) {
  const res = await app.request("/api/me", { headers: { cookie } }, env);
  const body = (await res.json()) as { user: { id: string } };
  expect(res.status).toBe(200);
  return body.user.id;
}

async function signUp(app: ReturnType<typeof createApp>, env: AuthEnv) {
  const email = uniqueEmail();
  const res = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password: "password123" }),
    },
    env,
  );
  expect(res.status).toBe(200);
  return { cookie: res.headers.getSetCookie().join("; "), email };
}

function putList(
  app: ReturnType<typeof createApp>,
  env: AuthEnv,
  cookie: string,
  listId: string,
  name: string,
) {
  return app.request(
    `/api/lists/${listId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name }),
    },
    env,
  );
}

function putItem(
  app: ReturnType<typeof createApp>,
  env: AuthEnv,
  cookie: string,
  listId: string,
  itemId: string,
  body: unknown,
) {
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

function getItems(app: ReturnType<typeof createApp>, env: AuthEnv, cookie: string, listId: string) {
  return app.request(`/api/lists/${listId}/items`, { headers: { cookie } }, env);
}

function deleteItem(
  app: ReturnType<typeof createApp>,
  env: AuthEnv,
  cookie: string,
  listId: string,
  itemId: string,
) {
  return app.request(
    `/api/lists/${listId}/items/${itemId}`,
    { method: "DELETE", headers: { cookie } },
    env,
  );
}

describe("item endpoints", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: ReturnType<typeof createApp>;
  let db: Db;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-items-db");
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    env = testEnvFor(binding);
    app = createApp();
    db = createD1Connection(binding);
    // Local D1 persists between runs; wipe the domain tables so fixed test ids
    // always start from a clean List/Item/Payment state. Auth users may remain.
    await db.delete(schema.items);
    await db.delete(schema.payments);
    await db.delete(schema.memberships);
    await db.delete(schema.invitations);
    await db.delete(schema.lists);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("rejects Item writes without a valid session", async () => {
    const put = await putItem(app, env, "", "list-x", "item-x", { name: "Milk" });
    expect(put.status).toBe(401);

    const del = await deleteItem(app, env, "", "list-x", "item-x");
    expect(del.status).toBe(401);
  });

  it("rejects Item writes from a user who is not a Member of that List", async () => {
    const owner = await signUp(app, env);
    const outsider = await signUp(app, env);
    const listId = "list-membership";
    await putList(app, env, owner.cookie, listId, "Household");

    const put = await putItem(app, env, outsider.cookie, listId, "item-hijack", { name: "Milk" });
    expect(put.status).toBe(403);
    const putBody = (await put.json()) as ApiErrorEnvelope;
    expect(putBody.error).toMatchObject({ status: 403, code: "forbidden" });

    const del = await deleteItem(app, env, outsider.cookie, listId, "item-hijack");
    expect(del.status).toBe(403);

    const get = await getItems(app, env, outsider.cookie, listId);
    expect(get.status).toBe(403);
  });

  it("adds an Item through an upsert and it appears on the List", async () => {
    const { cookie } = await signUp(app, env);
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(app, env, cookie, listId, "Household");

    const res = await putItem(app, env, cookie, listId, itemId, { name: "Milk" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: Item };
    expect(body.item).toMatchObject({
      id: itemId,
      listId,
      name: "Milk",
      checked: false,
    });
    expect(body.item.createdAt).toBeTruthy();

    const list = await getItems(app, env, cookie, listId);
    const listBody = (await list.json()) as { items: Item[] };
    expect(listBody.items.map((i) => i.name)).toEqual(["Milk"]);
  });

  it("ticks an Item off and the tick survives a reload of the List", async () => {
    const { cookie } = await signUp(app, env);
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(app, env, cookie, listId, "Household");
    await putItem(app, env, cookie, listId, itemId, { name: "Bread" });

    const tick = await putItem(app, env, cookie, listId, itemId, { checked: true });
    expect(tick.status).toBe(200);
    const tickBody = (await tick.json()) as { item: Item };
    expect(tickBody.item.checked).toBe(true);
    expect(tickBody.item.checkedAt).toBeTruthy();

    // A fresh read is what a reload would see.
    const reread = await getItems(app, env, cookie, listId);
    const rereadBody = (await reread.json()) as { items: Item[] };
    expect(rereadBody.items[0]).toMatchObject({ id: itemId, checked: true });
  });

  it("un-ticks an Item and clears the checked time", async () => {
    const { cookie } = await signUp(app, env);
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(app, env, cookie, listId, "Household");
    await putItem(app, env, cookie, listId, itemId, { name: "Eggs" });
    await putItem(app, env, cookie, listId, itemId, { checked: true });

    const untick = await putItem(app, env, cookie, listId, itemId, { checked: false });
    expect(untick.status).toBe(200);
    const body = (await untick.json()) as { item: Item };
    expect(body.item.checked).toBe(false);
    expect(body.item.checkedAt).toBeUndefined();
  });

  it("removes an Item and leaves every Payment untouched", async () => {
    const { cookie } = await signUp(app, env);
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(app, env, cookie, listId, "Household");
    await putItem(app, env, cookie, listId, itemId, { name: "Milk" });
    const payment = await createPayment(db, {
      listId,
      memberId: "someone",
      amountInCents: 1250,
      paidAt: "2026-01-01T00:00:00.000Z",
    });

    const del = await deleteItem(app, env, cookie, listId, itemId);
    expect(del.status).toBe(200);

    const list = await getItems(app, env, cookie, listId);
    const listBody = (await list.json()) as { items: Item[] };
    expect(listBody.items).toHaveLength(0);

    const rows = await db.select().from(schema.payments).all();
    expect(rows.find((p) => p.id === payment.id)?.amountInCents).toBe(1250);
  });

  it("rejects removing an Item through another List's id", async () => {
    const { cookie } = await signUp(app, env);
    await putList(app, env, cookie, "list-a", "A");
    await putList(app, env, cookie, "list-b", "B");
    await putItem(app, env, cookie, "list-a", "item-keep", { name: "Milk" });

    const res = await deleteItem(app, env, cookie, "list-b", "item-keep");
    expect(res.status).toBe(404);

    const listA = await getItems(app, env, cookie, "list-a");
    const listABody = (await listA.json()) as { items: Item[] };
    expect(listABody.items.map((i) => i.id)).toEqual(["item-keep"]);
  });

  it("rejects an Item with a blank name", async () => {
    const { cookie } = await signUp(app, env);
    const listId = uniq("list");
    await putList(app, env, cookie, listId, "Household");

    const res = await putItem(app, env, cookie, listId, uniq("item"), { name: "   " });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorEnvelope;
    expect(body.error).toMatchObject({ status: 400, code: "bad_request" });
  });

  it("rejects an Item write for an unknown List", async () => {
    const { cookie } = await signUp(app, env);

    const res = await putItem(app, env, cookie, "list-nowhere", "item-nowhere", { name: "Milk" });
    expect(res.status).toBe(404);
  });

  it("rejects writing an Item onto a List the caller is a Member of from another List's id", async () => {
    const { cookie } = await signUp(app, env);
    const listA = uniq("list");
    const listB = uniq("list");
    const itemId = uniq("item");
    await putList(app, env, cookie, listA, "A");
    await putList(app, env, cookie, listB, "B");
    await putItem(app, env, cookie, listA, itemId, { name: "Milk" });

    const res = await putItem(app, env, cookie, listB, itemId, { name: "Hijack" });
    expect(res.status).toBe(404);
  });

  it("accepts an invite: a Member who is not the Owner can add, tick, and remove Items", async () => {
    const owner = await signUp(app, env);
    const member = await signUp(app, env);
    const memberId = await getUserId(app, env, member.cookie);
    const listId = "list-invited";
    await putList(app, env, owner.cookie, listId, "Household");
    await createMembership(db, { listId, memberId });

    const add = await putItem(app, env, member.cookie, listId, "item-soap", { name: "Soap" });
    expect(add.status).toBe(201);

    const tick = await putItem(app, env, member.cookie, listId, "item-soap", { checked: true });
    expect(tick.status).toBe(200);

    const del = await deleteItem(app, env, member.cookie, listId, "item-soap");
    expect(del.status).toBe(200);
  });
});
