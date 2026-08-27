# @shopping-list/api

The Shopping List API. A [hono](https://hono.dev) application that runs as a
**Cloudflare Worker** and is the source of truth for the domain (Lists, Items,
Payments). Backed by **Cloudflare D1** (sqlite). The same `wrangler` target is
used for local development and deployment.

## Commands

```sh
pnpm dev            # run the Worker locally with wrangler dev
pnpm deploy         # deploy to Cloudflare Workers
pnpm type-check     # type-check (tsc --noEmit)
pnpm lint           # lint (oxlint)
pnpm fmt            # format (oxfmt)
pnpm cf-typegen     # regenerate CloudflareBindings types from wrangler config
pnpm db:generate    # generate a versioned D1 migration from src/schema.ts
pnpm db:migrate     # apply pending migrations to the local (dev) D1
```

## Database schema and migrations

The domain schema lives in [`src/schema.ts`](src/schema.ts) — the
source-of-truth tables for the domain model (Lists, Memberships, Invitations,
Items, Payments), written with drizzle. Users are owned by better-auth and are
wired to D1 in the next slice, so this schema references user IDs as plain text
rather than its own `users` table.

Migrations are **versioned SQL** generated with `drizzle-kit` into the
[`drizzle/`](drizzle) folder (`drizzle.config.ts`),

```sh
pnpm db:generate
```

and are **applied to D1** with wrangler's native migration runner, pointed at
the `drizzle/` folder via `migrations_dir` in `wrangler.jsonc`.

```sh
pnpm db:migrate           # local D1 (what `pnpm dev` serves)
pnpm db:migrate:remote    # the remote D1 database
```

`wrangler` tracks applied migrations in the D1 `d1_migrations` table, so
applying is re-runnable and only pending migrations run. The `db.test.ts` /
`migrate.test.ts` suite additionally proves the generated SQL executes against
D1 (a local D1 from `miniflare`) and round-trips all domain tables.

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
pnpm cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```
