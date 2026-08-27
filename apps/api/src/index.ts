import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth, getTrustedOrigins, type AuthEnv } from "./auth";
import { createD1Connection, ping } from "./db";

/**
 * The Shopping List API. Runs as a Cloudflare Worker and is the source of truth
 * for the domain (Lists, Items, Payments). The same wrangler target serves both
 * local dev and deployment. For now this is the minimal hono scaffold: a health
 * route that confirms the package compiles, builds, and runs, plus the
 * better-auth routes mounted at `/api/auth/*`. Domain endpoint behaviour lands
 * in later slices.
 *
 * The shared domain **data** contract (List, Item, Payment, Owed) is re-exported
 * here so the web app imports it straight from the `@shopping-list/api` package.
 * Only the data shapes are part of that contract — auth types stay in the `api`.
 */
export * from "./domain";

export type Bindings = AuthEnv;

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Allow the web app (a separate origin in dev) to make authenticated auth
 * requests. CORS with `credentials` requires an explicit origin — echo back the
 * request origin only when it is on the trusted list.
 */
app.use(
  "/api/auth/*",
  cors({
    origin: (origin, c) => {
      if (!origin) return "";
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
 * Health route: confirms the Worker is alive and serving, and that the D1
 * connection resolves. The drizzle D1 client is built from the `devDb` binding
 * (wired in `wrangler.jsonc`) and pinged with a trivial query — this works in
 * local dev and dry-runs without any live network, since the binding is
 * provided by the runtime / environment.
 */
app.get("/health", async (c) => {
  const db = createD1Connection(c.env.devDb);
  const row = await ping(db);
  return c.json({ ok: true, service: "shopping-list-api", db: row?.ok === 1 });
});

export default {
  fetch: app.fetch,
};
