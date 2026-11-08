---
inclusion: auto
name: cloudflare
description: Cloudflare Workers deployment for TanStack Start with Durable Objects, wrangler config, secrets and the Neon connection
---

# Cloudflare deployment

## wrangler.jsonc

- Single Worker with `main` set to `src/worker.ts` and the `nodejs_compat` compatibility flag.
- Declare Durable Object bindings under `durable_objects.bindings`: `PIN_MAILBOX` (class `PinMailbox`) and `ECHO` (class `EchoDO`).
- Declare a migration under `migrations` with a tag and `new_sqlite_classes` (or `new_classes`) listing `PinMailbox` and `EchoDO`. Add a new tag for every later class change.
- `pnpm cf-typegen` must complete with zero errors after any binding change.

## Secrets

- Production: `wrangler secret put DATABASE_URL`.
- Local: put `DATABASE_URL` in `.dev.vars`. `.dev.vars` must be listed in `.gitignore`. Never commit secrets or put them in `wrangler.jsonc` `vars`.
- If `DATABASE_URL` is missing or empty, fail the request with `db_not_configured` before attempting any connection.

## Neon

- Access Neon through Drizzle and `@neondatabase/serverless`: `neon()` HTTP driver for single queries, `Pool` over WebSocket for transactions.
- Create a fresh client per request. Never cache clients or pools in module scope across requests on Workers.
- Read the connection string from the `DATABASE_URL` binding, not `process.env`.

## Scripts

- `pnpm dev`, `build`, `deploy`, `test`, `lint`, `db:generate`, `db:migrate`, `cf-typegen`.
