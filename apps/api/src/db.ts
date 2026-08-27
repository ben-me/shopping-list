import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

/**
 * @param dbBinding the D1 binding from `env.DB`
 * @returns a drizzle client over the D1 driver
 */
export function createD1Connection(dbBinding: D1Database) {
  return drizzle(dbBinding);
}

/**
 * Prove the connection resolves by running a trivial query against the bound
 * D1 database. Returns the first row so callers (health routes, dry-runs, and
 * tests without a live network) can confirm the driver round-trips.
 */
export async function ping(db: DrizzleD1Database) {
  const rows = await db.all("SELECT 1 AS ok");
  return rows[0] as Record<string, unknown> | undefined;
}
