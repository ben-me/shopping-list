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

### On a phone

Dev binds to `0.0.0.0` and vite proxies `/api/*`, so a phone on the same
network needs one thing from the API: the origin it reaches the stack on,
passed as `DEV_ORIGIN`.

```sh
ALCHEMY_STAGE=dev_phone DEV_ORIGIN=http://192.168.1.42:5173 pnpm dev
# then open http://192.168.1.42:5173 on the phone
```

Give it a stage of its own: a stage's D1 data live in the `.alchemy/local/` of
the checkout that created it, so a stage made in a worktree cannot boot from
the main checkout (and vice versa) until its state is reset:

```sh
pnpm exec alchemy state delete -r ShoppingList/dev_phone
```

A plain-HTTP origin is not a secure context, so the service worker and the
install prompt stay off there; both need HTTPS.

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
