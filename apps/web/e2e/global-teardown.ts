import { rm } from "node:fs/promises";
import { E2E_STATE_DIR } from "./env";

/**
 * Drop the isolated e2e D1 store once the run ends so nothing is left behind
 * and the next run always starts clean. This only ever touches
 * `apps/api/.wrangler/e2e`; the developer's dev DB (`apps/api/.wrangler/state`)
 * is never read or removed.
 */
export default async function globalTeardown() {
  await rm(E2E_STATE_DIR, { recursive: true, force: true });
}
