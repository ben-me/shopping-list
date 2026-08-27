import { Hono } from "hono";
import { createD1Connection, ping } from "./db";

/**
 * The Shopping List API. Runs as a Cloudflare Worker and is the source of truth
 * for the domain (Lists, Items, Payments). The same wrangler target serves both
 * local dev and deployment. For now this is the minimal hono scaffold: a health
 * route that confirms the package compiles, builds, and runs. Domain endpoint
 * behaviour lands in later slices.
 *
 * The shared domain **data** contract (List, Item, Payment, Owed) is re-exported
 * here so the web app imports it straight from the `@shopping-list/api` package.
 * Only the data shapes are part of that contract — auth types stay out.
 */
export * from "./domain";

/**
 * The worker's environment bindings. `devDb` is the D1 database configured in
 * `wrangler.jsonc` (`d1_databases`, database `dev-db-shopping-list`). Typing
 * it in-line with the global `D1Database` type avoids depending on the
 * generated `worker-configuration.d.ts`.
 */
type Bindings = {
  devDb: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

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
