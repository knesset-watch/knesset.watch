# KnessetWatch - Open Knesset 26

This project provides a minimalist dashboard for Israeli Knesset data (MKs, bills, committees).

## ⚠️ STRICT RULE FOR AI AGENTS
- **Folder Focus**: All project-related files—including screenshots, temporary scripts, tests, and documentation—**MUST** be saved strictly within the `apps/knesset-watch` directory.
- **NEVER** save or move files into other project folders or root workspace directories.
- **Cleanliness**: Move all project-related screenshots to `public/screenshots/`.

## Session Learnings (Feb 27, 2026)
- **Deployment Paths**: Vercel is configured with a `Root Directory` of `apps/knesset-watch`. Running `vercel --prod` from inside this folder causes a path nesting error (`apps/knesset-watch/apps/knesset-watch`). Deployment **must** be triggered from the monorepo root or via Git push.
- **Vercel Limits**: Encountered `api-deployments-free-per-day` limit. CLI deployments are blocked for 5 hours.
- **Auth Logic**: The `@minimal-db/ui` auth-utils normalize passwords to lowercase during token hashing. The local `api/auth` route was updated to match this behavior.
- **API Status**: OData V4 (`ParliamentInfo`) is the only reliable source; OData V2 is deprecated/offline.

## Current Status
- **MK Cards**: Fully functional locally. Displays "Proposed" and "Passed" counts.
- **Pulse POC**: Active at `/knesset-watch/pulse`, showing legislation from the last 30 days.
- **Track Record**: Active at `/knesset-watch/track-record`, showing individual MK legislative history and conversion rates.
- **Security**: Password gate is active. Default password is `Pixelbilbo26` (normalized to lowercase).

## TODO List
1. **Verify Live Deployment**: Manually check the production URL once the Vercel SSO gate is passed. Ensure stats cards render correctly.
2. **Tab Implementation**: The "committees", "factions", and "bills" tabs are currently empty placeholders in `KnessetWatchClient.tsx`.
3. **Caching Layer**: Implement local caching or a DB layer for Knesset stats to avoid hitting OData V4 rate limits during high traffic.
4. **Project Settings**: Update Vercel project settings to resolve the Root Directory conflict if we want to deploy directly from the `apps/knesset-watch` subfolder.
