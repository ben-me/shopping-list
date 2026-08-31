# @shopping-list/api

The Shopping List API. A [hono](https://hono.dev) application that runs as a
**Cloudflare Worker** and is the source of truth for the domain (Lists, Items,
Payments). Backed by **Cloudflare D1** (sqlite). The same `wrangler` target is
used for local development and deployment.

## Commands

```sh
pnpm dev            # run the Worker locally with wrangler dev
pnpm deploy         # deploy to Cloudflare Workers
pnpm build          # wrangler deploy --dry-run (proves the Worker bundles and the D1 binding resolves without a live deploy)
pnpm type-check     # type-check (tsc --noEmit)
pnpm lint           # lint (oxlint)
pnpm fmt            # format (oxfmt)
pnpm cf-typegen     # regenerate CloudflareBindings types from wrangler config
pnpm db:generate    # generate a versioned D1 migration from src/schema.ts
pnpm db:migrate     # apply pending migrations to the local (dev) D1
```

## Authentication (better-auth)

[better-auth](https://better-auth.com) is mounted at `/api/auth/*` and sign-in,
sign-up, and session endpoints are exposed. Auth is backed by the same D1
store, so sessions persist across requests.

- The auth instance is built per request in [`src/auth.ts`](src/auth.ts) from
  the request's `env` — the D1 `devDb` binding and the better-auth settings
  (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`).
  Non-secret config lives in `wrangler.jsonc` `vars`; the **secret** is
  documented in [`.env.example`](.env.example) locally and is set with
  `wrangler secret put BETTER_AUTH_SECRET` for the deployed worker.
- The auth tables (user, session, account, verification) and the domain tables
  all live in a single file, [`src/schema.ts`](src/schema.ts), plus their
  drizzle relations. Keeping them in one file lets `db:generate` create
  migrations for both from a single source.
- Auth types stay inside the `api` package — they are **not** part of the shared
  data contract re-exported to the web app. The shared data contract (the
  `List` / `Item` / `Payment` / `Owed` shapes) is exposed through the
  `@shopping-list/api/domain` subpath export (see [`src/domain.ts`](src/domain.ts)),
  which the web app consumes so it never has to pull in Worker-only code —
  `src/index.ts` imports `auth.ts` / `db.ts`, which use Cloudflare `D1Database`
  types the browser does not have.

To regenerate the auth tables against an updated better-auth, use the current
`auth` CLI (not the older `@better-auth/cli`) and merge its output into
`src/schema.ts`:

```sh
pnpm dlx auth@latest generate --adapter drizzle --dialect sqlite -y
```

## Database schema and migrations

The schema lives in [`src/schema.ts`](src/schema.ts) — the better-auth tables
(user, session, account, verification) and the Shopping List domain tables
(Lists, Memberships, Invitations, Items, Payments), plus their drizzle
relations. All are written with drizzle.

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
`migrate.test.ts` / `auth.test.ts` suite additionally proves the generated SQL
executes against D1 (a local D1 from `miniflare`), round-trips all domain tables,
and lets better-auth sign up / sign in / read sessions against the same store.

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
pnpm cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```
