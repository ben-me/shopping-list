import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import { expect } from "vitest";
import { createApp } from "./index";
import { createD1Connection, type Db } from "./db";
import * as schema from "./schema";
import type { AuthEnv } from "./auth";

export type TestApp = ReturnType<typeof createApp>;

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url).href);

export function testEnvFor(dbBinding: D1Database): AuthEnv {
  return {
    devDb: dbBinding,
    BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:8787",
    BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:5173",
  };
}

export async function runMigrations(dbBinding: D1Database) {
  const db = drizzle(dbBinding);
  await migrate(db, { migrationsFolder });
}

export function uniq(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

let signupCounter = 0;
export function uniqueEmail(prefix: string) {
  signupCounter += 1;
  return `${prefix}${signupCounter}@example.com`;
}

export async function signUp(app: TestApp, env: AuthEnv, emailPrefix: string) {
  const email = uniqueEmail(emailPrefix);
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

export async function getUserId(app: TestApp, env: AuthEnv, cookie: string) {
  const res = await app.request("/api/me", { headers: { cookie } }, env);
  const body = (await res.json()) as { user: { id: string } };
  expect(res.status).toBe(200);
  return body.user.id;
}

export function putList(app: TestApp, env: AuthEnv, cookie: string, listId: string, name: string) {
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

// Local D1 persists between runs; wipe the domain tables so fixed test ids
// always start from a clean state. Auth users may remain.
export async function wipeDomainTables(db: Db) {
  await db.delete(schema.items);
  await db.delete(schema.payments);
  await db.delete(schema.memberships);
  await db.delete(schema.invitations);
  await db.delete(schema.lists);
}

export async function startTestApp(dbName: string) {
  const mf = await startMiniflare(dbName);
  const binding = await mf.getD1Database("devDb");
  await runMigrations(binding);
  return {
    mf,
    env: testEnvFor(binding),
    app: createApp(),
    db: createD1Connection(binding),
  };
}

export async function startMiniflare(dbName: string) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "test",
          modules: true,
          script: `
            export default { fetch() { return new Response("ok"); } };
          `,
          d1Databases: { devDb: dbName },
        },
      ],
    }),
  );
  await mf.ready;
  return mf;
}
