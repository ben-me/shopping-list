import { defineConfig } from "drizzle-kit";

/**
 * Drizzle kit configuration for the domain schema.
 *
 * `generate` produces versioned SQL migrations into `./drizzle` from
 * `src/schema.ts`. Migrations are applied against a D1 database at runtime via
 * the drizzle d1 migrator (`src/migrate.ts` — used by the `db:migrate` script
 * and the unit tests), which tracks applied migrations in the
 * `__drizzle_migrations` table and is therefore re-runnable.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
