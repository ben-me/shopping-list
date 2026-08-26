import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

/**
 * Establish the drizzle D1 connection from the worker's `DB` binding.
 *
 * Setting up a drizzle D1 client is purely local construction: it wraps the
 * binding in drizzle's D1 driver and does not touch the network until a query
 * runs. That makes the connection resolvable offline — the binding is injected
 * by the runtime (or, in tests and dry-runs, by the caller / environment).
 *
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
