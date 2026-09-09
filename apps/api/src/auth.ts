import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * Environment the auth instance needs to build a D1-backed store.
 *
 * `devDb` is the D1 database binding from `wrangler.jsonc`. The better-auth
 * settings are read from the worker `vars` so they can differ between local
 * dev and deployment without touching code.
 */
export type AuthEnv = {
  devDb: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string | string[];
};

export function getTrustedOrigins(env: AuthEnv): string[] {
  const raw = env.BETTER_AUTH_TRUSTED_ORIGINS;
  const origins = Array.isArray(raw) ? raw : (raw ?? "").split(",");
  return origins.map((origin) => origin.trim());
}

/**
 * Build a better-auth instance backed by the D1 `devDb` binding.
 *
 * In a Cloudflare Worker the D1 binding is only available per request (via
 * `env`), so the instance is constructed per request inside the auth route
 * handler. Auth types and the auth schema stay inside the `api` package; they
 * are not part of the shared data contract re-exported to the web app.
 */
export function createAuth(env: AuthEnv) {
  const db = drizzle(env.devDb, { schema: schema });

  const trustedOrigins = getTrustedOrigins(env);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: schema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins,
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
    },
  });
}
