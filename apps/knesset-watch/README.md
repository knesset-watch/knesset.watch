# knesset-watch

The main Next.js 16 app — the dashboard at https://knesset.watch.

## Prerequisites

- **Node.js 24 LTS** (declared in `vercel.json` and matches Vercel's default)
- **`knesset.db`** must exist at `apps/knesset-watch/knesset.db` before `npm run dev` or `npm run build`. This file is committed to the repo (and `knesset-deploy.db` is copied to `knesset.db` during Vercel builds).

## Setup

1. From the repo root, install workspace deps:
   ```bash
   npm install
   ```
2. Copy the env template:
   ```bash
   cp apps/knesset-watch/.env.example apps/knesset-watch/.env.local
   ```
3. Fill in `.env.local` — ask Dror for the values, or grab them from Vercel via the dashboard / `vercel env pull` (when CLI is installed).
4. Confirm `apps/knesset-watch/knesset.db` exists. If not, you can either:
   - Pull it from git LFS / latest main (it's tracked despite the gitignore entry), or
   - Run `npm run db:sync` to regenerate from the Knesset API (slow — multiple hours).

## Dev / build

From the repo root or this directory:

```bash
npm run dev      # starts on http://localhost:3001
npm run build    # production build
npm run lint     # eslint
```

The site password gate is active locally too — sign in via the cookie that gets set on first auth, or temporarily comment out the middleware in `src/proxy.ts` for unhindered local dev.

## Architecture

### Two-database split

- **Local SQLite (`knesset.db`)** — bills, votes, MKs, committees, ministers, factions, positions. Read-heavy, deterministic, shipped with the build via `cp knesset-deploy.db knesset.db && npm run build`.
- **Turso (libSQL hosted)** — protocol RAG: `committee_session`, `session_speaker_turn`, `plenary_speaker_turn`, `vote_embedding`. Has vector indexes for ANN search via `vector_top_k`.

Both DBs are accessed via thin wrappers:
- `src/lib/knesset-db.ts` — local SQLite queries
- `src/lib/protocols-db.ts` — Turso vector and keyword queries

### Ask API pipeline (`src/app/api/ask/route.ts`)

The main AI endpoint runs a full RAG pipeline per query:

1. **MK detection + date range parsing** — extracts MK names and Hebrew temporal phrases (`לאחרונה`, `השנה`, `אשתקד`, `YYYY`)
2. **Query rewriting** via Gemini (expands nicknames, adds official terms) — ~200ms
3. **Embed** rewritten query via Jina AI (256-dim)
4. **Parallel searches** — committee turns, plenary turns, vote vectors, keyword votes/bills, Gemini Google Search grounding
5. **Build LLM context** from retrieved turns
6. **Stream Gemini answer** via SSE
7. **Generate follow-up suggestions** concurrently, sent after `done` event

Caching: `@upstash/redis` keys responses by canonicalized query, TTL 2h.

### Auth / site password

`src/proxy.ts` is the Next.js middleware that enforces the site password. Server components also call `checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token')` per page. The token is normalized lowercase server-side.

### Knesset OData proxying

Most server-side fetches to `knesset.gov.il/OdataV4/ParliamentInfo` route through `KNESSET_PROXY_URL` (set to `https://knesset-proxy.fly.dev` in production) because Knesset blocks some hosting provider IPs. Sync scripts use `KNESSET_API_BASE` to the same effect.

## Key directories

```
src/
  app/
    api/
      ask/route.ts          # main AI search endpoint — full RAG pipeline
      knesset-proxy/...     # routes that fetch from Knesset OData via proxy
      preview/...           # SSR previews used by hover cards
    ask/AskClient.tsx       # search UI with streaming, multi-turn, suggestions
    [many other pages]      # mks, bills, ministers, ministry, committee, etc.
  components/               # shared React components (AppSidebar, charts, cards)
  lib/
    knesset-db.ts           # local SQLite data access
    protocols-db.ts         # Turso vector search
    period-context.tsx      # global time-period context (localStorage)
scripts/                    # all sync, embed, validate, migrate scripts
public/                     # static assets
protocols/                  # downloaded protocol files (gitignored)
documents/                  # downloaded bill documents (gitignored)
```

## Scripts

Every script lives in `scripts/` and is wired into `package.json`. Categories:

- **`db:sync*`** — incremental sync from Knesset OData (bills, MKs, votes, committees, plenary)
- **`db:scrape-*`** — scrape protocols, attendance, documents
- **`db:embed-*`** — generate Jina embeddings into Turso (committee turns, plenary turns, vote titles)
- **`db:migrate-*`** — schema migrations
- **`db:seed-*`** — seed canonical offices / activity journal
- **`db:fix-*`** — one-off data corrections
- **`validate:*`** — validation runs (minister sources, external comparison)
- **`scrape:government:external`** — pull government composition from external sources

Run any with `npm run <script>` from this directory.

## External services

| Service | Purpose | Env vars |
|---------|---------|----------|
| Turso (libSQL) | Protocol DB + vector indexes | `TURSO_URL`, `TURSO_TOKEN` |
| Google Gemini | LLM + Google Search grounding | `GEMINI_API_KEY` |
| Jina AI | Text embeddings (256-dim) | `JINA_API_KEY` |
| Groq | Secondary LLM | `GROQ_API_KEY` |
| Upstash Redis | Ask cache | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (and `KV_REST_API_*` from Vercel KV integration) |
| Fly.io proxy | Knesset OData proxy | `KNESSET_PROXY_URL`, `KNESSET_API_BASE` |
| Auth | Site password | `SITE_PASSWORD`, `SESSION_SECRET` |

See `.env.example` for the full list with comments.

## Data sync (production)

`sync.ts` is the canonical sync script. GitHub Actions runs it nightly via `.github/workflows/sync-db.yml`, using `KNESSET_API_BASE=https://knesset-proxy.fly.dev` to bypass Knesset's GitHub-runner IP block. To update production:

1. Run `npm run db:sync` locally
2. `cp knesset.db knesset-deploy.db`
3. Commit + push — Vercel build copies `knesset-deploy.db` → `knesset.db`

## Gotchas worth knowing

These are real things that have bitten us:

- **`bill.init_date` is NULL** for all bills. Use `bill.publication_date` for date filtering.
- **`mk_person.is_current`** is unreliable for ministers. Prefer `mk_position.is_current = 1`.
- **`vote_faction_stats.faction_id`** matches `mk_person.faction_id` directly — no join needed.
- **`mk_vote_result.result_code`**: `7` = for, `8` = against, `6` = abstain/present.
- **Streaming Ask API** uses NDJSON over SSE. Order: `meta` (sources first) → `chunk` (answer tokens) → `done` → `suggestions`.
- **Hebrew + RTL everywhere.** All UI text is Hebrew. Use `dir="rtl"`, Frank Ruhl Libre + Source Serif 4 fonts.
- **`BASE_PATH`** — always prefix client fetches with `process.env.NEXT_PUBLIC_BASE_PATH ?? ''` to keep them working under sub-path deploys.

## Code style notes

- Server components fetch data → pass to `*Client.tsx` client components for interactivity
- API routes use `new URL(request.url).searchParams` (sync), not Next.js async `searchParams`
- Cards: `rounded-2xl`, list items: `rounded-xl`, chips/badges: `rounded-full`
- Coalition color: green (`#16A34A`), opposition: blue (`#2563EB`), ministers: amber
- Borders are deliberately subtle: `border-black/8` for cards, `border-black/10` for inputs

## Deployment

Currently Vercel — auto-deploys from `main`. Root directory is `apps/knesset-watch`, framework `nextjs`, region `fra1`. See `vercel.json`.

A Netlify migration is planned (see `docs/plans/` and project notes). The current Vercel deploy will stay live during the cutover.

## Note on `GEMINI.md`

`apps/knesset-watch/GEMINI.md` is an older AI-assistant instructions file with some out-of-date info (including a stale password). It's not authoritative for human contributors — use this README and the root README instead.
