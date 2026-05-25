# knesset-worker

A Cloudflare Worker that proxies requests to `knesset.gov.il`. An alternative implementation of the same idea as `apps/knesset-proxy/` (Fly.io).

## Why it exists

Cloudflare's network IPs are usually not blocked by the Knesset OData API, so this Worker can serve as a proxy alternative to the Fly.io app. Useful as a backup or for client-side use cases that prefer a Cloudflare-served endpoint.

## What it does

`src/index.js` forwards any request to `https://knesset.gov.il{pathname}{search}` with browser-like headers and CORS allowed. It's effectively a single-file Worker.

## Deployment

Config in `wrangler.toml`:

```toml
name = "knesset-proxy"
main = "src/index.js"
compatibility_date = "2024-01-01"

[placement]
mode = "smart"
```

Deploy with:

```bash
cd apps/knesset-worker
wrangler deploy
```

You'll need a Cloudflare account with Workers enabled.

## Related

`apps/knesset-proxy/` is the Fly.io version of the same concept. The Fly.io proxy is the one currently wired into production (`KNESSET_PROXY_URL=https://knesset-proxy.fly.dev`). Pick one to keep.
