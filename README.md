# URL Shortener

Short links with bot-filtered, privacy-friendly click analytics. The whole thing is one Cloudflare
Worker and one D1 (SQLite) database: no servers, no Redis, and it fits the free plan.

> **V1** (Express + Prisma + Postgres + Redis, Snowflake IDs) is preserved at tag
> [`v1.0.0`](https://github.com/kshitizj03/url-shortener/tree/v1.0.0) and branch `v1`. Why V2 replaced it is under [What changed from V1](#what-changed-from-v1).

## How it works

```
             ┌──────────────── one Cloudflare Worker ────────────────┐
GET /        │ static assets (React app), served without running code │
             │                                                        │
GET /aB3xY9z │ Cache API (5 min) ──miss──► D1 links ──► 302 redirect  │
             │                    after the response: ctx.waitUntil ──► D1 clicks
             │                                                        │
/api/links   │ Hono + Zod: create, stats, delete                      │
             └────────────────────────────────────────────────────────┘
```

- **Random 7-character slugs** (62^7 ≈ 3.5 trillion), or a custom slug. Slugs are not sequential,
  so links cannot be enumerated.
- **The redirect never waits on analytics.** The click row is written after the 302 is sent.
- **Bot-filtered stats.** Link previews from Slack, X, WhatsApp, Discord and scripts are counted
  separately instead of inflating clicks.
- **No IPs stored.** Country comes from Cloudflare's edge, and rate limiting uses a salted hash.
- **Manage tokens instead of accounts (for now).** Creating a link returns a secret token. Only its
  SHA-256 is stored. Stats and delete need it, and the web app keeps it in the browser under My Links.
- **Rate limit:** 20 links per IP per hour, counted in D1 (`CREATE_LIMIT_PER_HOUR`).

## API

| Method | Path | Auth | |
|---|---|---|---|
| `POST` | `/api/links` | none | `{ url, slug?, expiresAt? }` → `201 { slug, shortUrl, manageToken, ... }` |
| `GET` | `/api/links/:slug` | `Bearer <manageToken>` | clicks, bot hits, last 30 days, top countries / devices / browsers / referrers |
| `DELETE` | `/api/links/:slug` | `Bearer <manageToken>` | deletes the link and its clicks |
| `GET` | `/:slug` | none | `302` to the target, `404` / `410` HTML page otherwise |
| `GET` | `/api/health` | none | checks D1 |

## Run locally

```bash
cd frontend && npm install && npm run build && cd ..
cd worker && npm install
cp .dev.vars.example .dev.vars
npm run dev          # applies local D1 migrations, serves app + API on http://localhost:8787
npm test             # tests run inside the Workers runtime against a real local D1
```

For frontend hot reload, run `npm run dev` in `frontend/` too (port 3000, proxies `/api` to 8787).

## Deploy

```bash
cd worker
npx wrangler d1 create url-shortener      # put the printed database_id in wrangler.jsonc
npx wrangler secret put IP_SALT           # any long random string
cd ../frontend && npm run build && cd ../worker
npm run deploy
```

The redirect cache uses the Workers Cache API, which only works on a custom domain. On
`*.workers.dev` every redirect reads D1 (still within the free plan's 5M reads a day).

## What changed from V1

| V1 | Problem | V2 |
|---|---|---|
| Redis cache-aside | A cache hit still queried Postgres for `id` and `expiresAt`, so the cache saved nothing | The cache stores the whole record, and its TTL is capped by the link's expiry |
| Snowflake ID as the short code | 10 characters, consecutive, so every link was enumerable | Random slugs |
| Redis Pub/Sub to an analytics worker | Clicks were lost while the worker was down, and doubled with 2 workers | Insert after the response with `waitUntil` |
| Sorted-set rate limiter | Check and add were separate round trips (race) | One indexed D1 count |
| Public `/analytics/:code` | Anyone could read any link's stats, and it loaded every click into memory | Token-protected, aggregated in SQL |
| 4 processes (API, worker, Postgres, Redis) | Never deployed | 1 Worker + 1 D1 database |

## Roadmap

Accounts and API keys, link safety checks (Safe Browsing / URLhaus), a dashboard rebuild, an MCP
server for agents, then custom domains and smart routing.
