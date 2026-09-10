import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./index";
import type { Db } from "./db";
import { createMembership } from "./queries";
import {
  getUserId as getUserIdViaApi,
  putList as putListViaApi,
  signUp as signUpViaApi,
  startTestApp,
} from "./test-support";
import type { AuthEnv } from "./auth";
import type { List } from "./domain";
import type { ApiErrorEnvelope } from "./errors";

describe("lists endpoints", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: ReturnType<typeof createApp>;
  let db: Db;

  function signUp() {
    return signUpViaApi(app, env, "listuser");
  }

  function getUserId(cookie: string) {
    return getUserIdViaApi(app, env, cookie);
  }

  function putList(cookie: string, listId: string, name: string) {
    return putListViaApi(app, env, cookie, listId, name);
  }

  beforeAll(async () => {
    ({ mf, env, app, db } = await startTestApp("local-d1-lists-db"));
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("rejects lists requests without a valid session", async () => {
    const res = await app.request("/api/lists", {}, env);
    expect(res.status).toBe(401);

    const put = await app.request("/api/lists/any", { method: "PUT" }, env);
    expect(put.status).toBe(401);
  });

  it("creates a List owned by the caller through an upsert", async () => {
    const { cookie } = await signUp();
    const ownerId = await getUserId(cookie);
    const listId = "list-" + crypto.randomUUID();

    const res = await putList(cookie, listId, "Household");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { list: List };
    expect(body.list).toMatchObject({ id: listId, ownerId, name: "Household" });
    expect(body.list.createdAt).toBeTruthy();
    expect(body.list.updatedAt).toBeTruthy();
  });

  it("updates a List the caller is a Member of and rejects an outsider", async () => {
    const owner = await signUp();
    const ownerId = await getUserId(owner.cookie);
    const outsider = await signUp();
    const listId = "list-" + crypto.randomUUID();
    await putList(owner.cookie, listId, "Before");

    const outsiderRes = await putList(outsider.cookie, listId, "Hijacked");
    const outsiderBody = (await outsiderRes.json()) as ApiErrorEnvelope;
    expect(outsiderRes.status).toBe(403);
    expect(outsiderBody).toEqual({
      error: {
        status: 403,
        code: "forbidden",
        message: "You are not a member of this list",
      },
    });

    const res = await putList(owner.cookie, listId, "After");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { list: List };
    expect(body.list).toMatchObject({ id: listId, ownerId, name: "After" });
  });

  it("rejects an empty or whitespace-only List name", async () => {
    const { cookie } = await signUp();

    const res = await putList(cookie, "list-emptyname", "   ");
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body).toEqual({
      error: { status: 400, code: "bad_request", message: "List name is required" },
    });
  });

  it("lists the Lists the user owns or has joined", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const aliceId = await getUserId(alice.cookie);
    const bobId = await getUserId(bob.cookie);

    await putList(alice.cookie, "list-alice", "Household");
    const bobsListId = "list-bob";
    await putList(bob.cookie, bobsListId, "Bobs shop");
    await createMembership(db, { listId: bobsListId, memberId: aliceId });

    const aliceRes = await app.request("/api/lists", { headers: { cookie: alice.cookie } }, env);
    const aliceBody = (await aliceRes.json()) as { lists: List[] };
    expect(aliceBody.lists.map((l) => l.name).sort()).toEqual(["Bobs shop", "Household"]);

    const bobRes = await app.request("/api/lists", { headers: { cookie: bob.cookie } }, env);
    const bobBody = (await bobRes.json()) as { lists: List[] };
    expect(bobBody.lists.map((l) => l.name).sort()).toEqual(["Bobs shop"]);
    expect(bobBody.lists[0]?.ownerId).toBe(bobId);
  });
});
