import process from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { API_HEALTH, API_ORIGIN, WEB_ORIGIN, WEB_PORT } from "./e2e/env";

/**
 * E2E specs for the real user flow: a browser is driven against a stack the
 * config starts itself — vite on :5174 proxying /api to its own wrangler dev
 * worker on :8788, backed by an isolated D1 store in `apps/api/.wrangler/e2e`.
 * The developer's dev stack (:5173 / :8787, `apps/api/.wrangler/state`) is
 * never used or modified, and no existing server is reused.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* One worker: the shared e2e database keeps the run deterministic. */
  workers: 1,
  /* Remove the isolated e2e D1 store when the run ends. */
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_ORIGIN,
    /* Collect trace when retrying the failed test. */
    trace: "on-first-retry",
  },
  /* More browsers can be added here (and installed in CI) when needed. */
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // Its own worker and its own D1 store: wipe the e2e store, apply
      // migrations, then serve it. The dev DB is never touched, and the
      // bootstrap spec always sees an empty user table (sign-up is the
      // one-time door that creates the Admin).
      command:
        "pnpm --filter @shopping-list/api run db:reset:e2e && pnpm --filter @shopping-list/api run db:migrate:e2e && pnpm --filter @shopping-list/api run dev:e2e",
      url: API_HEALTH,
      timeout: 120 * 1000,
    },
    {
      command: `pnpm --filter @shopping-list/web run dev -- --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      // Point the vite dev proxy at this run's API, not the dev worker.
      env: { API_PROXY_TARGET: API_ORIGIN },
      timeout: 120 * 1000,
    },
  ],
});
