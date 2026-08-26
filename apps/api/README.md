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
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
pnpm cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```
