# knesset-proxy

A minimal Node.js HTTP proxy that forwards requests to `knesset.gov.il`.

## Why it exists

The Knesset OData API (`knesset.gov.il/OdataV4/ParliamentInfo`) blocks IPs from common hosting providers — including GitHub Actions runners. This proxy runs on Fly.io (Frankfurt region) from non-blocked IPs and forwards requests with browser-like headers.

GitHub Actions sets `KNESSET_API_BASE=https://knesset-proxy.fly.dev` so the nightly sync (`apps/knesset-watch/scripts/sync.ts`) works. The same URL is used as `KNESSET_PROXY_URL` for server-side proxied fetches from the Next.js app.

## URL

`https://knesset-proxy.fly.dev`

## Deployment

- Host: **Fly.io**, app name `knesset-proxy`, primary region `fra`
- VM: 256 MB shared CPU, auto-stops when idle (`auto_stop_machines = "stop"`) — no cost when not in use
- Config: `fly.toml`
- Container: built from `Dockerfile`

Deploy with:

```bash
cd apps/knesset-proxy
fly deploy
```

## How it works

`server.js` is a single-file Node.js server that:
1. Receives any path
2. Forwards to `https://knesset.gov.il${path}${search}` with:
   - `User-Agent: Mozilla/5.0 (...)` (browser UA)
   - `Accept-Language: he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7`
   - `Referer: https://knesset.gov.il/`
3. Returns the response with `Access-Control-Allow-Origin: *` for browser access

## Related

`apps/knesset-worker/` is a Cloudflare Worker that does similar proxying. Both currently exist; consolidating to one is on the to-do list.
