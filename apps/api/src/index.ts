import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createAuth, getTrustedOrigins, type AuthEnv } from "./auth";
import { createD1Connection, ping } from "./db";
import { toErrorEnvelope } from "./errors";
import type { AppVariables } from "./guards";
import { requireUser } from "./guards";
import { registerInvitationRoutes } from "./invitations/routes";
import { registerItemRoutes } from "./items/routes";
import { registerListRoutes } from "./lists/routes";
import { registerMemberRoutes } from "./members/routes";
import { registerPaymentRoutes } from "./payments/routes";
import { usersExist } from "./users/queries";

/**
 * Domain data shapes are re-exported so the web app can import them through
 * the `@shopping-list/api/domain` subpath without pulling in this Worker
 * entry (which drags in `D1Database` types the browser does not have).
 */
export * from "./domain";

export type Bindings = AuthEnv;

export function createApp() {
  const app = new Hono<{ Bindings: AuthEnv; Variables: AppVariables }>();

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

  // The D1 binding only exists inside the request, so auth is built per request.
  app.all("/api/auth/*", async (c) => {
    const auth = await createAuth(c.env);
    return auth.handler(c.req.raw);
  });

  app.onError((error, c) => {
    const { status, envelope } = toErrorEnvelope(error);
    return c.json(envelope, status as ContentfulStatusCode);
  });

  app.get("/health", async (c) => {
    const db = createD1Connection(c.env.devDb);
    const pingResult = await ping(db);
    return c.json({ ok: true, service: "shopping-list-api", db: pingResult?.ok === 1 });
  });

  app.get("/api/me", requireUser, (c) => c.json({ user: c.get("user") }));

  // Sign-up is open only while no users exist; afterwards the Admin provisions accounts (ADR 0003).
  app.get("/api/signup-status", async (c) => {
    const db = createD1Connection(c.env.devDb);
    const hasUsers = await usersExist(db);
    return c.json({ signUpOpen: !hasUsers });
  });

  registerListRoutes(app);
  registerItemRoutes(app);
  registerPaymentRoutes(app);
  registerInvitationRoutes(app);
  registerMemberRoutes(app);

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
};
