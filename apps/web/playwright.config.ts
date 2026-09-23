import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e stack runs on its own ports — set by `dev:e2e` in each package — and
 * its own D1 store, so a run never touches or collides with the dev stack on
 * :5173 / :8787. Exported for specs that send the better-auth CSRF origin.
 */
export const WEB_ORIGIN = "http://localhost:5174";
const API_ORIGIN = "http://localhost:8788";
const API_HEALTH = `${API_ORIGIN}/health`;

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
      // Fresh isolated D1 each run: the bootstrap spec needs an empty user table.
      command:
        "pnpm --filter @shopping-list/api run db:reset:e2e && pnpm --filter @shopping-list/api run db:migrate:e2e && pnpm --filter @shopping-list/api run dev:e2e",
      url: API_HEALTH,
      timeout: 120 * 1000,
    },
    {
      command: "pnpm --filter @shopping-list/web run dev:e2e",
      url: WEB_ORIGIN,
      env: { API_PROXY_TARGET: API_ORIGIN },
      timeout: 120 * 1000,
    },
  ],
});
