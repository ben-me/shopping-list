# Shopping List

A progressive web app for a household to share what they need to buy and keep
track of who paid what. See [CONTEXT.md](CONTEXT.md) for the domain language
and [docs/spec.md](docs/spec.md) for the product spec.

- **`apps/web`** — Vue SPA (vite), offline-first with Dexie + a PWA service worker
- **`apps/api`** — hono API running as a Cloudflare Worker, backed by D1

## Development

Local dev and deployment run through [Alchemy](https://alchemy.run) (declared
in [`alchemy.run.ts`](alchemy.run.ts)):

```sh
pnpm install
pnpm dev                        # API workerd on :8787 + vite on :5173 (proxies /api/*)
```

Dev and tests need no `.env` — dev/e2e stages run a local workerd + D1
simulator with a bundled dev secret. The root `.env` is reserved for deploys.

Data lives in the local D1 simulator (`.alchemy/local/`) — the deployed
database is never touched by dev or e2e. The e2e suite runs the same layout as
its own stage on :8788 / :5174 with a fresh local database per run.

## Tests

```sh
pnpm test            # unit + e2e
pnpm test:unit       # unit only
pnpm test:e2e        # playwright (starts its own isolated dev stack)
```

## Deploy

```sh
cp .env.example .env            # then set the real BETTER_AUTH_SECRET
pnpm deploy                     # one Worker hosting the SPA + API, D1 created and migrated by Alchemy
```
