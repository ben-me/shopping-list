# @shopping-list/api

The Shopping List API. A [hono](https://hono.dev) application that runs as a
**Cloudflare Worker** and is the source of truth for the domain (Lists, Items,
Payments). Backed by **Cloudflare D1** (sqlite).

Deployment and local dev are driven by [Alchemy](https://alchemy.run) from the
repo root — [`alchemy.run.ts`](../../alchemy.run.ts) declares the D1 database,
its migrations, and the Worker(s):

- **Deploy** (`pnpm deploy` at the root): one Worker hosts the API entrypoint
  (`src/index.ts`) **and** the built SPA (`apps/web`) on one origin — no
  `wrangler.jsonc` here.
- **Dev** (`pnpm dev`): the two default dev servers — this Worker in workerd
  on **:8787** (hono, D1 from the LOCAL simulator) and the vite dev server on
  **:5173** (which proxies `/api/*` to :8787, so the browser stays
  same-origin). `pnpm dev` from `apps/api/` runs the same stack.
- **E2E** (`pnpm test:e2e`): the same layout as its own Alchemy stage on
  **:8788 / :5174** so it never collides with interactive dev; each run gets
  a fresh local D1 (stage-scoped state delete) and never touches the
  deployed database.

## Commands (run from `apps/api/`)

```sh
pnpm dev            # the dev stack (API workerd :8787 + vite :5173)
pnpm dev:e2e        # the isolated e2e stack (what the e2e suite starts)
pnpm db:generate    # generate a versioned D1 migration from src/schema.ts
pnpm type-check     # type-check (tsc --noEmit)
pnpm lint           # lint (oxlint)
pnpm fmt            # format (oxfmt)
```

## Provisioning accounts (ADR 0003)

Sign-up is the **one-time bootstrap**: it succeeds only while the user table is
empty, and the first account becomes the **Admin**. Afterwards sign-up is
closed for good (server rejects, the UI hides it), and every further account is
provisioned by the Admin from the app: sign in as the Admin and the **Settings**
page shows an **Add a user** form (name, email, password). The account is created
through better-auth's admin route — so password hashing stays with better-auth,
never raw SQL — and is email-verified, so it can sign in immediately. Only the
Admin sees the form; the route itself rejects anyone without the `admin` role.

## Authentication (better-auth)

[better-auth](https://better-auth.com) is mounted at `/api/auth/*` and sign-in,
sign-up, and session endpoints are exposed. Auth is backed by the same D1
store, so sessions persist across requests.

- The auth instance is built per request in [`src/auth.ts`](src/auth.ts) from
  the request's `env` — the D1 `db` binding and the better-auth settings
  (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`).
  The **secret** is documented in the root [`example env file`](../../.env.example)
  and bound via `alchemy.run.ts` (`env` in the resource, resolved from the
  root `.env`).
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

and are **applied to D1** on every `alchemy dev` / `alchemy deploy` run by
Alchemy's migration runner, pointed at the `drizzle/` folder via `migrations`
in `alchemy.run.ts` (both the dev simulators and the deployed database).
Applied migrations are recorded in Alchemy's `__alchemy_migrations`
bookkeeping table, so applying is re-runnable and only pending migrations
run. The `db.test.ts` / `migrate.test.ts` / `auth.test.ts` suite additionally
proves the generated SQL executes against D1, round-trips all domain tables,
and lets better-auth sign up / sign in / read sessions against the same store.

The hono app reads its bindings from the request `env` (`src/index.ts`'s
`AuthEnv`); Alchemy supplies them as Worker `env` bindings declared in
`alchemy.run.ts` — no generated types file needed.
