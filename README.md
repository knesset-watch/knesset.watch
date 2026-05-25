# knesset.watch

A Hebrew-language dashboard for Israeli Knesset data: MKs, bills, votes, committees, plenary speeches, and ministers. Includes an AI-powered Hebrew search across protocol transcripts (RAG over committee + plenary turns).

Production: **https://knesset.watch** (password-gated — ask Dror for access).

## Repo layout

This is a monorepo with three apps:

```
knesset/
├── apps/
│   ├── knesset-watch/   # Main Next.js app (the dashboard + AI search)
│   ├── knesset-proxy/   # Fly.io HTTP proxy that forwards to knesset.gov.il
│   └── knesset-worker/  # Cloudflare Worker — alternative proxy implementation
├── package.json          # npm workspaces root
└── README.md             # you are here
```

Each app has its own README with setup details. The main app to work on is `apps/knesset-watch`.

## Tech stack

- **Next.js 16** (App Router), TypeScript, Tailwind CSS — RTL, Hebrew UI
- **Local SQLite** (`apps/knesset-watch/knesset.db`, via `better-sqlite3`) — committed to git, holds bills/votes/MKs/committees/positions
- **Turso** (libSQL hosted) — protocol search + vector embeddings for RAG
- **Google Gemini** (`gemini-2.5-flash`) — query rewriting, answer streaming, Google Search grounding
- **Jina AI** — 256-dim text embeddings
- **Upstash Redis** — Ask API response cache (TTL 2h)
- **Vercel** — current hosting (Netlify migration planned, see `docs/plans/`)

## Getting started

1. Clone the repo:
   ```bash
   git clone https://github.com/knesset-watch/knesset.watch.git
   cd knesset.watch
   ```
2. Install workspace dependencies from the root:
   ```bash
   npm install
   ```
3. Set up the main app — see `apps/knesset-watch/README.md` for env vars and dev commands.

## Common workflows

| Task | Command (from repo root) |
|------|--------------------------|
| Dev server (port 3001) | `npm run dev -w knesset-watch` |
| Build | `npm run build -w knesset-watch` |
| Lint | `npm run lint` |
| Sync data from Knesset API | `npm run db:sync -w knesset-watch` |

Many more scripts in `apps/knesset-watch/package.json` (data syncing, embedding workers, validation, etc.). All script names start with `db:`, `scrape:`, or `validate:`.

## Deployment

Currently deployed on **Vercel** from the `main` branch (root directory: `apps/knesset-watch`, region: `fra1`). Auto-deploys on push.

A migration to **Netlify** is planned. The supporting `knesset-proxy` (Fly.io) and `knesset-worker` (Cloudflare) deploy independently.

## Repository

- GitHub: `knesset-watch/knesset.watch` (Organization-owned)
- Default branch: `main`
- The old URL `Bren/knesset.watch` auto-redirects, but please use the canonical URL above.

## Conventions you should know

These come up often enough to be worth flagging up front:

- **Never hide data.** If something looks misplaced (e.g. a חקיקה document in the protocols tab), relabel or move it — don't filter it out. Information loss is a regression.
- **Batch-validate before long runs.** Any scraper, embedder, or backfill — run with `LIMIT 5` first, spot-check, then run full. The plenary scraper once ran 4.5 hours before we discovered the parser was broken.
- **Always save original source documents.** Scraped PDFs/DOCX/XMLs go to disk under `apps/knesset-watch/protocols/` or `documents/` (gitignored) before parsing. Don't download-parse-discard — re-parsing without the originals means re-hitting the source server.
- **Vector indexes after bulk insert.** When creating a new Turso vector index: CREATE TABLE → INSERT all rows → CREATE INDEX. Doing it in the other order causes shadow row failures.
- **No `git commit` from this conversation** — the harness has hung on it before. Use plumbing commands if you need to script commits.

## Where to go next

- `apps/knesset-watch/README.md` — main app setup, architecture, env vars, scripts
- `apps/knesset-proxy/README.md` — Fly.io proxy
- `apps/knesset-worker/README.md` — Cloudflare worker proxy
- `docs/plans/` — design docs for in-flight work
