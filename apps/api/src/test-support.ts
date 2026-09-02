import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import type { AuthEnv } from "./auth";

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
