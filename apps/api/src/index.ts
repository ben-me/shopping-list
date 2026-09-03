import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createAuth, getTrustedOrigins, type AuthEnv } from "./auth";
import { createD1Connection, ping } from "./db";
import { toErrorEnvelope } from "./errors";
import { requireMember, requireUser, type AppVariables } from "./guards";

/**
 * The Shopping List API. Runs as a Cloudflare Worker and is the source of truth
 * for the domain (Lists, Items, Payments). The same wrangler target serves both
 * local dev and deployment. `createApp` builds a fresh Hono app so tests can
 * mount it with their own environment and requireUser/requireMember behaviour is
 * exercised over real HTTP as well as through middleware unit tests.
 *
 * The shared domain **data** contract (List, Item, Payment, Owed) lives in
 * `./domain` and is exposed to the web app through the
 * `@shopping-list/api/domain` subpath export, so the web app imports only the
 * data shapes and never pulls in this Worker entry (which drags in
 * `D1Database` types the browser does not have). Only the data shapes are part
 * of that contract — auth types stay in the `api`.
 */
export * from "./domain";

export type Bindings = AuthEnv;

export function createApp() {
  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  /**
   * Allow the web app (a separate origin in dev) to make authenticated requests
   * to the whole API. CORS with `credentials` requires an explicit origin — echo
   * back the request origin only when it is on the trusted list.
   */
  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        if (!origin) {
          return "";
        }
        return getTrustedOrigins(c.env).includes(origin) ? origin : "";
      },
      credentials: true,
    }),
  );

  /**
   * Mount better-auth. The D1 binding is only available inside the request, so
   * the auth instance is built per request from `c.env`. better-auth validates
   * the method and returns a `Response` that hono sends as-is.
   */
  app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

  /**
   * Every endpoint fails through the same error envelope: known {@link ApiError}s
   * keep their status, code, and message; anything else is a generic 500.
   */
  app.onError((error, c) => {
    const { status, envelope } = toErrorEnvelope(error);
    return c.json(envelope, status as ContentfulStatusCode);
  });

  /**
   * Health route: confirms the Worker is alive and serving, and that the D1
   * connection resolves. Runs before any require* middleware so it stays
   * reachable unauthenticated.
   */
  app.get("/health", async (c) => {
    const db = createD1Connection(c.env.devDb);
    const row = await ping(db);
    return c.json({ ok: true, service: "shopping-list-api", db: row?.ok === 1 });
  });

  /**
   * Demonstration routes that exercise the shared plumbing. `/api/me` proves
   * requireUser resolves the signed-in user; `/api/lists/:listId` proves
   * requireMember admits Members and rejects everyone else. Slice endpoints
   * (creating a List, Items, Payments, …) build on these same helpers.
   */
  app.get("/api/me", requireUser, (c) => c.json({ user: c.get("user") }));

  app.get("/api/lists/:listId", requireUser, requireMember, (c) => c.json({ list: c.get("list") }));

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
};
