import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./index";
import { createD1Connection, type Db } from "./db";
import { createMembership } from "./queries";
import { runMigrations, startMiniflare, testEnvFor } from "./test-support";
import type { AuthEnv } from "./auth";
import type { List } from "./domain";
import type { ApiErrorEnvelope } from "./errors";

let signupCounter = 0;
function uniqueEmail() {
  signupCounter += 1;
  return `listuser${signupCounter}@example.com`;
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

async function getUserId(app: ReturnType<typeof createApp>, env: AuthEnv, cookie: string) {
  const res = await app.request("/api/me", { headers: { cookie } }, env);
  const body = (await res.json()) as { user: { id: string } };
  expect(res.status).toBe(200);
  return body.user.id;
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

describe("lists endpoints", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: ReturnType<typeof createApp>;
  let db: Db;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-lists-db");
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    env = testEnvFor(binding);
    app = createApp();
    db = createD1Connection(binding);
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
    const { cookie } = await signUp(app, env);
    const ownerId = await getUserId(app, env, cookie);
    const listId = "list-" + crypto.randomUUID();

    const res = await putList(app, env, cookie, listId, "Household");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { list: List };
    expect(body.list).toMatchObject({ id: listId, ownerId, name: "Household" });
    expect(body.list.createdAt).toBeTruthy();
    expect(body.list.updatedAt).toBeTruthy();
  });

  it("updates a List the caller is a Member of and rejects an outsider", async () => {
    const owner = await signUp(app, env);
    const ownerId = await getUserId(app, env, owner.cookie);
    const outsider = await signUp(app, env);
    const listId = "list-" + crypto.randomUUID();
    await putList(app, env, owner.cookie, listId, "Before");

    const outsiderRes = await putList(app, env, outsider.cookie, listId, "Hijacked");
    const outsiderBody = (await outsiderRes.json()) as ApiErrorEnvelope;
    expect(outsiderRes.status).toBe(403);
    expect(outsiderBody).toEqual({
      error: {
        status: 403,
        code: "forbidden",
        message: "You are not a member of this list",
      },
    });

    const res = await putList(app, env, owner.cookie, listId, "After");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { list: List };
    expect(body.list).toMatchObject({ id: listId, ownerId, name: "After" });
  });

  it("rejects an empty or whitespace-only List name", async () => {
    const { cookie } = await signUp(app, env);

    const res = await putList(app, env, cookie, "list-emptyname", "   ");
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body).toEqual({
      error: { status: 400, code: "bad_request", message: "List name is required" },
    });
  });

  it("lists the Lists the user owns or has joined", async () => {
    const alice = await signUp(app, env);
    const bob = await signUp(app, env);
    const aliceId = await getUserId(app, env, alice.cookie);
    const bobId = await getUserId(app, env, bob.cookie);

    await putList(app, env, alice.cookie, "list-alice", "Household");
    const bobsListId = "list-bob";
    await putList(app, env, bob.cookie, bobsListId, "Bobs shop");
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
