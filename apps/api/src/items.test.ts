import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./index";
import type { Db } from "./db";
import { createMembership, createPayment } from "./queries";
import {
  getUserId as getUserIdViaApi,
  putList as putListViaApi,
  signUp as signUpViaApi,
  startTestApp,
  uniq,
  wipeDomainTables,
} from "./test-support";
import type { AuthEnv } from "./auth";
import type { ApiErrorEnvelope } from "./errors";
import type { Item } from "./domain";
import * as schema from "./schema";

describe("item endpoints", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: ReturnType<typeof createApp>;
  let db: Db;

  function signUp() {
    return signUpViaApi(app, env, "itemuser");
  }

  function getUserId(cookie: string) {
    return getUserIdViaApi(app, env, cookie);
  }

  function putList(cookie: string, listId: string, name: string) {
    return putListViaApi(app, env, cookie, listId, name);
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

  function getItems(cookie: string, listId: string) {
    return app.request(`/api/lists/${listId}/items`, { headers: { cookie } }, env);
  }

  function deleteItem(cookie: string, listId: string, itemId: string) {
    return app.request(
      `/api/lists/${listId}/items/${itemId}`,
      { method: "DELETE", headers: { cookie } },
      env,
    );
  }

  beforeAll(async () => {
    ({ mf, env, app, db } = await startTestApp("local-d1-items-db"));
    await wipeDomainTables(db);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("rejects Item writes without a valid session", async () => {
    const put = await putItem("", "list-x", "item-x", { name: "Milk" });
    expect(put.status).toBe(401);

    const del = await deleteItem("", "list-x", "item-x");
    expect(del.status).toBe(401);
  });

  it("rejects Item writes from a user who is not a Member of that List", async () => {
    const owner = await signUp();
    const outsider = await signUp();
    const listId = "list-membership";
    await putList(owner.cookie, listId, "Household");

    const put = await putItem(outsider.cookie, listId, "item-hijack", { name: "Milk" });
    expect(put.status).toBe(403);
    const putBody = (await put.json()) as ApiErrorEnvelope;
    expect(putBody.error).toMatchObject({ status: 403, code: "forbidden" });

    const del = await deleteItem(outsider.cookie, listId, "item-hijack");
    expect(del.status).toBe(403);

    const get = await getItems(outsider.cookie, listId);
    expect(get.status).toBe(403);
  });

  it("adds an Item through an upsert and it appears on the List", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(cookie, listId, "Household");

    const res = await putItem(cookie, listId, itemId, { name: "Milk" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: Item };
    expect(body.item).toMatchObject({
      id: itemId,
      listId,
      name: "Milk",
      checked: false,
    });
    expect(body.item.createdAt).toBeTruthy();

    const list = await getItems(cookie, listId);
    const listBody = (await list.json()) as { items: Item[] };
    expect(listBody.items.map((i) => i.name)).toEqual(["Milk"]);
  });

  it("ticks an Item off and the tick survives a reload of the List", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(cookie, listId, "Household");
    await putItem(cookie, listId, itemId, { name: "Bread" });

    const tick = await putItem(cookie, listId, itemId, { checked: true });
    expect(tick.status).toBe(200);
    const tickBody = (await tick.json()) as { item: Item };
    expect(tickBody.item.checked).toBe(true);
    expect(tickBody.item.checkedAt).toBeTruthy();

    // A fresh read is what a reload would see.
    const reread = await getItems(cookie, listId);
    const rereadBody = (await reread.json()) as { items: Item[] };
    expect(rereadBody.items[0]).toMatchObject({ id: itemId, checked: true });
  });

  it("un-ticks an Item and clears the checked time", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(cookie, listId, "Household");
    await putItem(cookie, listId, itemId, { name: "Eggs" });
    await putItem(cookie, listId, itemId, { checked: true });

    const untick = await putItem(cookie, listId, itemId, { checked: false });
    expect(untick.status).toBe(200);
    const body = (await untick.json()) as { item: Item };
    expect(body.item.checked).toBe(false);
    expect(body.item.checkedAt).toBeUndefined();
  });

  it("removes an Item and leaves every Payment untouched", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(cookie, listId, "Household");
    await putItem(cookie, listId, itemId, { name: "Milk" });
    const payment = await createPayment(db, {
      listId,
      memberId: "someone",
      amountInCents: 1250,
      paidAt: "2026-01-01T00:00:00.000Z",
    });

    const del = await deleteItem(cookie, listId, itemId);
    expect(del.status).toBe(200);

    const list = await getItems(cookie, listId);
    const listBody = (await list.json()) as { items: Item[] };
    expect(listBody.items).toHaveLength(0);

    const rows = await db.select().from(schema.payments).all();
    expect(rows.find((p) => p.id === payment.id)?.amountInCents).toBe(1250);
  });

  it("rejects removing an Item through another List's id", async () => {
    const { cookie } = await signUp();
    await putList(cookie, "list-a", "A");
    await putList(cookie, "list-b", "B");
    await putItem(cookie, "list-a", "item-keep", { name: "Milk" });

    const res = await deleteItem(cookie, "list-b", "item-keep");
    expect(res.status).toBe(404);

    const listA = await getItems(cookie, "list-a");
    const listABody = (await listA.json()) as { items: Item[] };
    expect(listABody.items.map((i) => i.id)).toEqual(["item-keep"]);
  });

  it("rejects an Item with a blank name", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    await putList(cookie, listId, "Household");

    const res = await putItem(cookie, listId, uniq("item"), { name: "   " });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorEnvelope;
    expect(body.error).toMatchObject({ status: 400, code: "bad_request" });
  });

  it("rejects an Item write for an unknown List", async () => {
    const { cookie } = await signUp();

    const res = await putItem(cookie, "list-nowhere", "item-nowhere", { name: "Milk" });
    expect(res.status).toBe(404);
  });

  it("rejects writing an Item onto a List the caller is a Member of from another List's id", async () => {
    const { cookie } = await signUp();
    const listA = uniq("list");
    const listB = uniq("list");
    const itemId = uniq("item");
    await putList(cookie, listA, "A");
    await putList(cookie, listB, "B");
    await putItem(cookie, listA, itemId, { name: "Milk" });

    const res = await putItem(cookie, listB, itemId, { name: "Hijack" });
    expect(res.status).toBe(404);
  });

  it("accepts an invite: a Member who is not the Owner can add, tick, and remove Items", async () => {
    const owner = await signUp();
    const member = await signUp();
    const memberId = await getUserId(member.cookie);
    const listId = "list-invited";
    await putList(owner.cookie, listId, "Household");
    await createMembership(db, { listId, memberId });

    const add = await putItem(member.cookie, listId, "item-soap", { name: "Soap" });
    expect(add.status).toBe(201);

    const tick = await putItem(member.cookie, listId, "item-soap", { checked: true });
    expect(tick.status).toBe(200);

    const del = await deleteItem(member.cookie, listId, "item-soap");
    expect(del.status).toBe(200);
  });

  it("persists two offline adds of 'the same' Item as two Items — no dedupe", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    await putList(cookie, listId, "Household");

    // Two devices each generate their own id for "the same" Item while
    // offline; both are real events and both must survive the Sync.
    await putItem(cookie, listId, uniq("item"), { name: "Milk" });
    await putItem(cookie, listId, uniq("item"), { name: "Milk" });

    const res = await getItems(cookie, listId);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: Item[] };
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.name)).toEqual(["Milk", "Milk"]);
  });

  it("converges on last-write-wins per field when two devices edit one Item", async () => {
    const { cookie } = await signUp();
    const listId = uniq("list");
    const itemId = uniq("item");
    await putList(cookie, listId, "Household");
    await putItem(cookie, listId, itemId, { name: "Milk" });

    // Device A ticks the Item off.
    await putItem(cookie, listId, itemId, { checked: true });

    // Device B renames it, sending only the field it changed.
    const rename = await putItem(cookie, listId, itemId, { name: "Oat milk" });
    expect(rename.status).toBe(200);

    // B's write wins for `name`; A's write survives for `checked` — fields
    // reconcile independently, never record-wide.
    let items = ((await (await getItems(cookie, listId)).json()) as { items: Item[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Oat milk", checked: true });
    expect(items[0]?.checkedAt).toBeTruthy();

    // Device A un-ticks: `checked` flips back while `name` keeps B's value.
    await putItem(cookie, listId, itemId, { checked: false });
    items = ((await (await getItems(cookie, listId)).json()) as { items: Item[] }).items;
    expect(items[0]).toMatchObject({ name: "Oat milk", checked: false });
    expect(items[0]?.checkedAt).toBeUndefined();
  });
});
