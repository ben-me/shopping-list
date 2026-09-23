import { fileURLToPath } from "node:url";

/**
 * The e2e stack runs on its own ports and its own D1 store, separate from the
 * developer's dev stack (:5173 / :8787 and `apps/api/.wrangler/state`), so an
 * e2e run never reads or resets a developer's data and is unaffected by
 * whatever they have running.
 */
export const WEB_PORT = 5174;
export const API_PORT = 8788;

export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const API_HEALTH = `${API_ORIGIN}/health`;

/** Isolated local D1 store for e2e; never the developer's dev DB. */
export const E2E_STATE_DIR = fileURLToPath(new URL("../../api/.wrangler/e2e", import.meta.url));
