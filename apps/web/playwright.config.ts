import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 5173;
const API_HEALTH = "http://localhost:8787/health";

/**
 * E2E specs for the real user flow: a browser is driven against the dev stack
 * — vite on :5173 proxying /api to the wrangler dev worker on :8787, so the
 * browser only ever talks to :5173. Locally an already-running dev stack is
 * reused (`reuseExistingServer`); in CI both servers are started here, with
 * the API's local D1 migrations applied first so a fresh checkout gets a
 * usable database.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* One worker: the shared dev database keeps the run deterministic. */
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    /* Collect trace when retrying the failed test. */
    trace: "on-first-retry",
  },
  /* More browsers can be added here (and installed in CI) when needed. */
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "pnpm --filter @shopping-list/api run db:migrate && pnpm --filter @shopping-list/api run dev",
      url: API_HEALTH,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: "pnpm dev",
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
});
