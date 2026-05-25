# AGENTS.md

This file is the repo-level init note for coding agents working on Knesset Watch.

## Operating Rules

- Do not push, deploy, rotate secrets, mutate hosted services, or run destructive git commands without explicit user permission.
- Do not commit from this conversation unless the user explicitly asks; repo onboarding notes say prior harness runs have hung on commits.
- Check `git status --short --branch` before editing. Preserve user changes and keep edits scoped.
- Prefer `rg` / `rg --files` for repo search.
- The active application is `apps/knesset-watch`. The archived legacy Django material under `apps/knesset-watch/archive/` is reference material unless a task explicitly targets it.
- For app work, run commands from `apps/knesset-watch` unless a workspace-level command is clearly needed.

## Repo Shape

- Root workspace package: `package.json`
- Main app: `apps/knesset-watch`
  - Next.js app, currently configured for Vercel via `apps/knesset-watch/vercel.json`.
  - Dev command: `npm run dev` from `apps/knesset-watch` starts Next on port `3001`.
  - Build command in Vercel copies `knesset-deploy.db` to `knesset.db` before `next build`.
  - Production site: `https://knesset.watch`, password-gated.
- Fly proxy app: `apps/knesset-proxy`
  - Minimal Node HTTP proxy to `https://knesset.gov.il`.
  - Fly config: `apps/knesset-proxy/fly.toml`, app name `knesset-proxy`, region `fra`.
- Cloudflare Worker: `apps/knesset-worker`
  - Minimal Worker proxy to `https://knesset.gov.il`.
  - Wrangler config currently names it `knesset-proxy`, not `knesset-worker`.
- Database sync workflow: `.github/workflows/sync-db.yml`
  - Nightly GitHub Actions job copies `knesset-deploy.db` to `knesset.db`, runs sync scripts, copies back, commits, and pushes if changed.

## Known Services

Current service inventory inferred from repo config and code:

- Vercel: hosts the Next.js app. `vercel.json` uses region `fra1`.
- Fly.io: hosts `apps/knesset-proxy`, a Knesset API proxy. README says production uses `https://knesset-proxy.fly.dev` for `KNESSET_PROXY_URL` and `KNESSET_API_BASE`.
- Cloudflare Workers: `apps/knesset-worker` is another Knesset API proxy / backup. No active app call site hardcodes a workers.dev URL.
- GitHub Actions: runs the nightly SQLite sync workflow.
- Local committed SQLite: `apps/knesset-watch/knesset-deploy.db` is tracked and shipped at build time as `knesset.db`.
- Turso/libSQL: optional hosted protocol/session/vector data when `TURSO_URL` is set.
- Upstash Redis / Vercel KV: `/api/ask` cache uses `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; `vote-cache.ts` checks `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
- Google Gemini: `/api/ask` uses `GEMINI_API_KEY` for query rewriting, answer generation, suggestions, and Google Search grounding.
- Jina AI: protocol/vector search embeds queries and data with `JINA_API_KEY`, 256 dimensions.
- Groq: legacy `/api/protocols/ask` route uses `GROQ_API_KEY`.
- Knesset OData: primary source is `https://knesset.gov.il/OdataV4/ParliamentInfo`.
- Password gate: `SITE_PASSWORD` and `SESSION_SECRET` protect the site through `src/proxy.ts` and `src/app/api/auth/route.ts`.

## Consolidation Notes

- The Fly proxy and Cloudflare Worker appear functionally redundant. The active code uses `KNESSET_PROXY_URL` when configured, otherwise calls `https://knesset.gov.il` directly. It does not hardcode a Cloudflare Worker URL.
- If only one proxy is kept, prefer Fly unless production envs prove otherwise; the new READMEs state Fly is the production-wired proxy and Cloudflare is the alternative.
- The app has two AI ask paths:
  - `src/app/api/ask/route.ts`: current broader RAG path using Gemini, Jina, Turso, and Upstash.
  - `src/app/api/protocols/ask/route.ts`: older protocol-only Groq path.
  Consider deleting or folding the Groq path if no UI still calls it.
- Cache configuration is split between Upstash Redis env names and Vercel KV env names. Normalize to one provider/env convention before adding more cache code.
- Turso env names in code are `TURSO_URL` and `TURSO_TOKEN`. Some older docs mention `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; prefer the code names unless migrating deliberately.

## Data Sync Notes

- The committed deploy database is `apps/knesset-watch/knesset-deploy.db` and is currently the build artifact source.
- Local runtime code opens `knesset.db` from the `apps/knesset-watch` working directory.
- GitHub Actions currently syncs via direct Knesset OData calls unless `KNESSET_API_BASE` is provided in the workflow environment.
- If GitHub Actions is failing because Knesset blocks GitHub IPs, set `KNESSET_API_BASE` for sync steps to the retained proxy origin, without the `/OdataV4/ParliamentInfo` suffix. The scripts append that suffix themselves.
- The README claims Actions uses `KNESSET_API_BASE=https://knesset-proxy.fly.dev`, but `.github/workflows/sync-db.yml` does not currently set it inline. Verify repo/org Actions variables or add it to the workflow before assuming the nightly job is using the proxy.
- Do not manually regenerate or commit database files unless the task explicitly asks for data sync/backfill work.

## Useful Commands

From repo root:

```sh
npm install
npm run lint --workspace knesset-watch
```

From `apps/knesset-watch`:

```sh
npm run dev
npm run build
npm run lint
npm run db:sync
npm run db:sync-investigative
```

From `apps/knesset-proxy`:

```sh
npm start
```
