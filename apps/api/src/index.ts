import { Hono } from "hono";

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

const app = new Hono();

/**
 * Health route: confirms the Worker is alive and serving. Used by deployments
 * and dry-run checks to verify the entry resolves. Liveness only — no domain
 * logic yet.
 */
app.get("/health", (c) => c.json({ ok: true, service: "shopping-list-api" }));

export default {
  fetch: app.fetch,
};
