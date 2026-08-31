import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import { createAuth } from "./auth";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url).href);

async function runMigrations(dbBinding: D1Database) {
  const db = drizzle(dbBinding);
  await migrate(db, { migrationsFolder });
  return db;
}

function authEnv(dbBinding: D1Database) {
  return {
    devDb: dbBinding,
    BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:8787",
    BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:5173",
  };
}

// a fixed, valid address that is not a secret or environment token
const email = "auth-test@example.com";
const password = "hunter2hunter2";

describe("better-auth wired to D1", () => {
  let mf: Miniflare;

  beforeEach(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "test",
            modules: true,
            script: `
              export default { fetch() { return new Response("ok"); } };
            `,
            d1Databases: { devDb: "local-d1-auth-db" },
          },
        ],
      }),
    );
    await mf.ready;
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("signs up a user and persists the session and user to D1", async () => {
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    const auth = createAuth(authEnv(binding));

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
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    const auth = createAuth(authEnv(binding));

    await auth.api.signUpEmail({ body: { name: "Test User", email, password } });
    const { token } = await auth.api.signInEmail({ body: { email, password } });
    expect(token).toBeTruthy();
  });

  it("reads the session back through the HTTP /get-session endpoint", async () => {
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    const auth = createAuth(authEnv(binding));
    const origin = authEnv(binding).BETTER_AUTH_URL;

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
