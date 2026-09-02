import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { createAuth, type AuthEnv } from "./auth";
import { runMigrations, startMiniflare, testEnvFor } from "./test-support";
import * as schema from "./schema";

// a fixed, valid address that is not a secret or environment token
const email = "auth-test@example.com";
const password = "hunter2hunter2";

describe("better-auth wired to D1", () => {
  let mf: Miniflare;
  let binding: D1Database;
  let env: AuthEnv;

  beforeEach(async () => {
    mf = await startMiniflare("local-d1-auth-db");
    binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    env = testEnvFor(binding);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("signs up a user and persists the session and user to D1", async () => {
    const auth = createAuth(env);

    const { token, user } = await auth.api.signUpEmail({
      body: { name: "Test User", email, password },
    });

    expect(user.email).toBe(email);
    expect(token).toBeTruthy();

    const db = drizzle(binding, { schema: schema });
    const users = await db.select().from(schema.user);
    const sessions = await db.select().from(schema.session);
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe(email);
    expect(sessions).toHaveLength(1);
  });

  it("signs an existing user in and returns a session token", async () => {
    const auth = createAuth(env);

    await auth.api.signUpEmail({ body: { name: "Test User", email, password } });
    const { token } = await auth.api.signInEmail({ body: { email, password } });
    expect(token).toBeTruthy();
  });

  it("reads the session back through the HTTP /get-session endpoint", async () => {
    const auth = createAuth(env);
    const origin = env.BETTER_AUTH_URL;

    const signUp = await auth.handler(
      new Request(new URL("/api/auth/sign-up/email", origin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Test User", email, password }),
      }),
    );
    expect(signUp.status).toBe(200);

    const cookie = signUp.headers.getSetCookie().join("; ");
    const sessionRes = await auth.handler(
      new Request(new URL("/api/auth/get-session", origin), {
        headers: { cookie },
      }),
    );
    const session = (await sessionRes.json()) as { user?: { email?: string } };
    expect(session.user?.email).toBe(email);
  });
});
