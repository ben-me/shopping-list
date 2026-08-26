import { Hono } from "hono";

/**
 * The Shopping List API. Runs as a Cloudflare Worker and is the source of truth
 * for the domain (Lists, Items, Payments). The same wrangler target serves both
 * local dev and deployment. For now this is the minimal hono scaffold: a health
 * route that confirms the package compiles and runs. Domain endpoint behaviour
 * lands in later slices.
 */
const app = new Hono();

app.get("/", (c) => c.json({ ok: true, service: "shopping-list-api" }));

export default app;
