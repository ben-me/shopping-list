import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./index";
import { createList, createMembership } from "./repository";
import { runMigrations, startMiniflare, testEnvFor } from "./test-support";
import type { AuthEnv } from "./auth";
import type { ApiErrorEnvelope } from "./errors";

const origin = "http://localhost:8787";

let signupCounter = 0;
function uniqueEmail() {
  signupCounter += 1;
  return `user${signupCounter}@example.com`;
}

async function signUp(app: ReturnType<typeof createApp>, env: AuthEnv) {
  const email = uniqueEmail();
  const res = await app.fetch(
    new Request(new URL("/api/auth/sign-up/email", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password: "password123" }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  return { cookie: res.headers.getSetCookie().join("; "), email };
}

async function getBody<T = Record<string, unknown>>(res: Response) {
  return (await res.json()) as T;
}

async function getAuthedUser(app: ReturnType<typeof createApp>, env: AuthEnv, cookie: string) {
  const res = await app.fetch(
    new Request(new URL("/api/me", origin), { headers: { cookie } }),
    env,
  );
  const body = await getBody<{ user: { id: string; email: string } }>(res);
  expect(res.status).toBe(200);
  return body.user;
}

describe("guards over HTTP", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: ReturnType<typeof createApp>;
  let devDb: D1Database;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-guards-db");
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    env = testEnvFor(binding);
    app = createApp();
    devDb = binding;
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("rejects a request without a valid session", async () => {
    const res = await app.fetch(new Request(new URL("/api/me", origin)), env);
    const body = await getBody<ApiErrorEnvelope>(res);

    expect(res.status).toBe(401);
    expect(body).toEqual({
      error: { status: 401, code: "unauthorized", message: "Sign in to continue" },
    });
  });

  it("resolves the signed-in user from the session cookie", async () => {
    const { cookie, email } = await signUp(app, env);

    const user = await getAuthedUser(app, env, cookie);

    expect(user.email).toBe(email);
    expect(user.id).toBeTruthy();
  });

  it("admits the Owner of a List through the list guard", async () => {
    const { cookie } = await signUp(app, env);
    const user = await getAuthedUser(app, env, cookie);
    const list = await createList(devDb, { ownerId: user.id, name: "Weekend shop" });

    const res = await app.fetch(
      new Request(new URL(`/api/lists/${list.id}`, origin), { headers: { cookie } }),
      env,
    );
    const body = await getBody<{ list: { id: string; ownerId: string; name: string } }>(res);

    expect(res.status).toBe(200);
    expect(body.list).toMatchObject({ id: list.id, ownerId: user.id, name: "Weekend shop" });
  });

  it("admits a Member (the Owner invited them), not an outsider", async () => {
    const { cookie: ownerCookie } = await signUp(app, env);
    const { cookie: memberCookie } = await signUp(app, env);
    const { cookie: outsiderCookie } = await signUp(app, env);
    const owner = await getAuthedUser(app, env, ownerCookie);
    const member = await getAuthedUser(app, env, memberCookie);
    const list = await createList(devDb, { ownerId: owner.id, name: "Weekend shop" });
    await createMembership(devDb, { listId: list.id, memberId: member.id });

    const memberRes = await app.fetch(
      new Request(new URL(`/api/lists/${list.id}`, origin), { headers: { cookie: memberCookie } }),
      env,
    );
    expect(memberRes.status).toBe(200);

    const outsiderRes = await app.fetch(
      new Request(new URL(`/api/lists/${list.id}`, origin), {
        headers: { cookie: outsiderCookie },
      }),
      env,
    );
    const outsiderBody = await getBody<ApiErrorEnvelope>(outsiderRes);

    expect(outsiderRes.status).toBe(403);
    expect(outsiderBody).toEqual({
      error: {
        status: 403,
        code: "forbidden",
        message: "You are not a member of this list",
      },
    });
  });

  it("rejects an unknown List id", async () => {
    const { cookie } = await signUp(app, env);

    const res = await app.fetch(
      new Request(new URL("/api/lists/missing-list", origin), { headers: { cookie } }),
      env,
    );
    const body = await getBody<ApiErrorEnvelope>(res);

    expect(res.status).toBe(404);
    expect(body).toEqual({
      error: { status: 404, code: "not_found", message: "List not found" },
    });
  });
});
