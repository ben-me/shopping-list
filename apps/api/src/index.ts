import { serve } from "@hono/node-server";
import app from "./app.js";

// Local development server (pnpm --filter @shopping-list/api run dev / start).
// The Cloudflare Worker deploy target is wired separately (issue #5).
const port = Number.parseInt(process.env.PORT ?? "8787", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`shopping-list-api listening on http://localhost:${info.port}`);
});
