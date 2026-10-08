import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { CurrentStack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

/**
 * Production D1 database; adoptable from a prior wrangler/drizzle-kit setup.
 */
export const Db = Cloudflare.D1.Database("db", {
  name: "db-shopping-list",
  migrations: "./apps/api/drizzle",
});

/**
 * Live stages: one Worker — SPA (apps/web) + hono API (apps/api) on the same
 * origin, /api/* and /health worker-first, everything else assets with an SPA
 * fallback.
 *
 * Dev stages (dev_*, e2e): the two default dev servers — vite :5173 (:5174
 * for e2e) proxying /api/* to the hono Worker in workerd on :8787 (:8788) —
 * with data in the local D1 simulator, never the deployed database. Data is
 * keyed per stage inside .alchemy/local, so e2e never touches dev's.
 */
export default Alchemy.Stack(
  "ShoppingList",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const db = yield* Db;
    const stack = yield* CurrentStack;
    const isDevStage = stack.stage === "e2e" || stack.stage.startsWith("dev");
    const isE2E = stack.stage === "e2e";
    // Devcontainer publishes appPort via docker, which can only reach the
    // container interface — loopback binding (the default) is not.
    const devHost = "0.0.0.0";

    let appOutput;
    if (isDevStage) {
      yield* Cloudflare.Worker("Api", {
        main: "./apps/api/src/index.ts",
        compatibility: { date: "2026-08-26", flags: ["nodejs_compat"] },
        env: {
          db: Db,
          BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
          BETTER_AUTH_URL: `http://localhost:${isE2E ? 8788 : 8787}`,
          BETTER_AUTH_TRUSTED_ORIGINS: `http://localhost:${isE2E ? 5174 : 5173}`,
        },
        dev: {
          host: devHost,
          port: isE2E ? 8788 : 8787,
          strictPort: true,
        },
      });

      appOutput = yield* Cloudflare.Website.Vite("App", {
        rootDir: "./apps/web",
        compatibility: { date: "2026-08-26", flags: ["nodejs_compat"] },
        dev: {
          host: devHost,
          port: isE2E ? 5174 : 5173,
          strictPort: true,
        },
      });
    } else {
      appOutput = yield* Cloudflare.Website.Vite("App", {
        rootDir: "./apps/web",
        // Resolves relative to rootDir (apps/web): the hono entry becomes the
        // Vite plugin's worker entry, so one `vite build` emits client assets
        // and the API bundle.
        main: "../api/src/index.ts",
        compatibility: { date: "2026-08-26", flags: ["nodejs_compat"] },
        assets: {
          runWorkerFirst: ["/api/*", "/health"],
          notFoundHandling: "single-page-application",
        },
        env: {
          db: Db,
          BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
          BETTER_AUTH_URL: Cloudflare.Worker.URL,
          BETTER_AUTH_TRUSTED_ORIGINS: Cloudflare.Worker.URL,
        },
      });
    }

    return {
      url: appOutput.url,
      databaseName: db.databaseName,
    };
  }),
);
