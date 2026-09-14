import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, signUp, TEST_PASSWORD, type TestApp } from "./test-support";
import type { AuthEnv } from "./auth";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import * as schema from "./schema";

const PROVISIONED_EMAIL = "provisioned@example.com";

/** The error envelope better-auth itself returns (our domain errors wrap in `error`). */
interface AuthErrorEnvelope {
  message?: string;
  code?: string;
}

describe("bootstrap admin and provisioning (ADR 0003)", () => {
  let mf: Miniflare;
  let env: AuthEnv;
  let app: TestApp;
  let db: Db;
  /** The Admin account created by the bootstrap sign-up in the first test. */
  let adminEmail = "";

  beforeAll(async () => {
    ({ mf, env, app, db } = await startTestApp("local-d1-provisioning-db"));
  });

  afterAll(async () => {
    await mf.dispose();
  });

  async function signupStatus() {
    const res = await app.request("/api/signup-status", {}, env);
    expect(res.status).toBe(200);
    return (await res.json()) as { signUpOpen: boolean };
  }

  async function me(cookie: string) {
    const res = await app.request("/api/me", { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    return (await res.json()) as { user: { id: string; email: string; role?: string } };
  }

  function createUserCall(cookie: string, email: string, password = TEST_PASSWORD) {
    return app.request(
      "/api/auth/admin/create-user",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "Provisioned User",
          email,
          password,
          role: "user",
          data: { emailVerified: true },
        }),
      },
      env,
    );
  }

  function signIn(email: string, password = TEST_PASSWORD) {
    return app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
      env,
    );
  }

  it("opens sign-up on an empty database and the first account is the Admin", async () => {
    expect((await signupStatus()).signUpOpen).toBe(true);

    const { cookie, email } = await signUp(app, env, "bootstrap");
    const { user } = await me(cookie);

    adminEmail = email;
    expect(user.email).toBe(email);
    expect(user.role).toBe("admin");
  });

  it("closes sign-up server-side once any account exists", async () => {
    // The bootstrap above created the only account; a direct sign-up attempt
    // must be rejected even though the caller would otherwise be eligible.
    const res = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Latecomer",
          email: "late@example.com",
          password: TEST_PASSWORD,
        }),
      },
      env,
    );
    expect(res.status).toBe(400);

    expect((await signupStatus()).signUpOpen).toBe(false);
  });

  it("provisions a user who is email-verified and can sign in immediately", async () => {
    const adminSession = await signIn(adminEmail);
    expect(adminSession.status).toBe(200);
    const adminCookie = adminSession.headers.getSetCookie().join("; ");

    const created = await createUserCall(adminCookie, PROVISIONED_EMAIL);
    expect(created.status).toBe(200);
    const { user } = (await created.json()) as {
      user: { email: string; role: string; emailVerified: boolean };
    };
    expect(user.email).toBe(PROVISIONED_EMAIL);
    expect(user.role).toBe("user");

    const stored = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, PROVISIONED_EMAIL))
      .get();
    expect(stored?.emailVerified).toBe(true);

    // The provisioned user signs in straight away with the deployed password.
    const signInRes = await signIn(PROVISIONED_EMAIL);
    expect(signInRes.status).toBe(200);
  });

  it("rejects a non-admin call to the admin route", async () => {
    // signUp now provisions through the admin route, so this user is a plain
    // `user`-role account — the admin route must turn them away.
    const { cookie } = await signUp(app, env, "plainuser");
    const res = await createUserCall(cookie, "other@example.com");
    const body = (await res.json()) as AuthErrorEnvelope;

    expect(res.status).toBe(403);
    expect(body.message).toContain("not allowed");
  });

  it("rejects a duplicate email from the admin route with an actionable error", async () => {
    const adminSession = await signIn(adminEmail);
    const adminCookie = adminSession.headers.getSetCookie().join("; ");
    const res = await createUserCall(adminCookie, PROVISIONED_EMAIL);
    const body = (await res.json()) as AuthErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.message).toContain("already exists");
  });

  it("requires a session to call the admin route", async () => {
    const res = await app.request(
      "/api/auth/admin/create-user",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ghost",
          email: "ghost@example.com",
          password: TEST_PASSWORD,
        }),
      },
      env,
    );

    expect(res.status).toBe(401);
  });
});
