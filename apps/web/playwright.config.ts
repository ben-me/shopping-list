import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e pins of the dev layout (:5173 / :8787 interactive), started by
 * `dev:e2e` in apps/api. Exported for specs that send the better-auth CSRF
 * origin.
 */
export const WEB_ORIGIN = "http://localhost:5174";
const API_HEALTH = "http://localhost:8788/health";

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
      // `dev:e2e` deletes the e2e stage's own state (not the shared local
      // dir!), so every run starts on a fresh D1 with an empty user table.
      command: "pnpm --filter @shopping-list/api run dev:e2e",
      url: API_HEALTH,
      reuseExistingServer: !process.env.CI,
      timeout: 180 * 1000,
    },
  ],
});