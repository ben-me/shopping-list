import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
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
 *
 * Accounts are provisioned, not self-created (ADR 0003): sign-up is the
 * one-time bootstrap, open only while the user table is empty, and afterwards
 * it is closed server-side (`disableSignUp`). The `admin()` plugin provides
 * better-auth's server-side user creation for the Admin's provisioning route.
 */
export async function createAuth(env: AuthEnv) {
  const db = drizzle(env.devDb, { schema: schema });

  const trustedOrigins = getTrustedOrigins(env);
  const usersExist =
    (await db.select({ id: schema.user.id }).from(schema.user).limit(1).get()) !== undefined;

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
      // The one-time bootstrap: sign-up is accepted only while no account
      // exists; the first account created becomes the Admin, after which this
      // switch closes sign-up for good (ADR 0003).
      disableSignUp: usersExist,
    },
    plugins: [admin()],
    /**
     * The first account ever created is the Admin (ADR 0003). Every later
     * account is provisioned by the Admin with the default `user` role, so
     * only the very first user could ever match this branch.
     */
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (!ctx) {
              return;
            }
            const existingUsers = await ctx.context.internalAdapter.countTotalUsers();
            if (existingUsers === 0) {
              return { data: { role: "admin" } };
            }
          },
        },
      },
    },
  });
}
