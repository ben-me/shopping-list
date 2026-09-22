import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { signUp, startTestApp, type TestApp } from "./test-support";
import { createList } from "./lists/queries";
import { createMembership } from "./members/queries";
import type { AuthEnv } from "./auth";
import type { ApiErrorEnvelope } from "./errors";

async function getAuthedUser(app: TestApp, env: AuthEnv, cookie: string) {
  const res = await app.request("/api/me", { headers: { cookie } }, env);
  const body = (await res.json()) as { user: { id: string; email: string } };
  expect(res.status).toBe(200);
  return body.user;
}

describe("requireUser/requireMember over HTTP", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: TestApp;
  let db: Db;

  beforeAll(async () => {
    ({ mf, env, app, db } = await startTestApp("local-d1-guards-db"));
  });

  afterAll(async () => {
    await mf.dispose();
  });

  function newUser(prefix: string) {
    return signUp(app, env, prefix);
  }

  async function authedUser(prefix: string) {
    const { cookie } = await newUser(prefix);
    return { cookie, user: await getAuthedUser(app, env, cookie) };
  }

  it("rejects a request without a valid session", async () => {
    const res = await app.request("/api/me", {}, env);
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(401);
    expect(body).toEqual({
      error: { status: 401, code: "unauthorized", message: "Sign in to continue" },
    });
  });

  it("resolves the signed-in user from the session cookie", async () => {
    const { cookie, email } = await newUser("guard");

    const user = await getAuthedUser(app, env, cookie);

    expect(user.email).toBe(email);
    expect(user.id).toBeTruthy();
  });

  it("admits the Owner of a List through requireMember", async () => {
    const { cookie, user } = await authedUser("guard");
    const list = await createList(db, { ownerId: user.id, name: "Weekend shop" });

    const res = await app.request(`/api/lists/${list.id}`, { headers: { cookie } }, env);
    const body = (await res.json()) as { list: { id: string; ownerId: string; name: string } };

    expect(res.status).toBe(200);
    expect(body.list).toMatchObject({ id: list.id, ownerId: user.id, name: "Weekend shop" });
  });

  it("admits a Member (the Owner invited them), not an outsider", async () => {
    const owner = await authedUser("guard");
    const member = await authedUser("guard");
    const { cookie: outsiderCookie } = await newUser("guard");
    const ownerUser = owner.user;
    const memberUser = member.user;
    const list = await createList(db, { ownerId: ownerUser.id, name: "Weekend shop" });
    await createMembership(db, { listId: list.id, memberId: memberUser.id });

    const memberRes = await app.request(
      `/api/lists/${list.id}`,
      {
        headers: { cookie: member.cookie },
      },
      env,
    );
    expect(memberRes.status).toBe(200);

    const outsiderRes = await app.request(
      `/api/lists/${list.id}`,
      {
        headers: { cookie: outsiderCookie },
      },
      env,
    );
    const outsiderBody = (await outsiderRes.json()) as ApiErrorEnvelope;

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
    const { cookie } = await newUser("guard");

    const res = await app.request("/api/lists/missing-list", { headers: { cookie } }, env);
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(404);
    expect(body).toEqual({
      error: { status: 404, code: "not_found", message: "List not found" },
    });
  });
});
