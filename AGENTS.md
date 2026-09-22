This is a progressive web app written with Vue to manage shopping lists and save simple balance (amount paid and date).
This project uses corepack/pnpm workspaces, hono as api, dexie.js for local first, better auth and sqlite.

# Repository layout

- `apps/web` contains the progressive web app written as Vue single page application.
- `apps/api` contains the hono api routes.

## Agent skills

### Issue tracker
Issues live in GitHub Issues. Work is always done in a separate worktree placed beside the main checkout (e.g. `../<feature-worktree>`) and lands only via a PR that must be reviewed and approved by ben-me before merge. See `docs/agents/issue-tracker.md`.

### Triage labels
The five canonical roles map to default labels. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context. See `docs/agents/domain.md`.
