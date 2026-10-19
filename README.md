# URL Shortener

Short links with bot-filtered, privacy-friendly click analytics. The whole thing is one Cloudflare
Worker and one D1 (SQLite) database: no servers, no Redis, and it fits the free plan.

**Live:** https://url-shortener.kshitizj.workers.dev

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

- **Short, unguessable slugs.** 7 random base62 characters, or a custom slug. See [ID design](#id-design).
- **The redirect never waits on analytics.** The click row is written after the 302 is sent.
- **Bot-filtered stats.** Link previews from Slack, X, WhatsApp, Discord and scripts are counted
  separately instead of inflating clicks.
- **No IPs stored.** Country comes from Cloudflare's edge. Rate limiting uses a salted hash,
  deleted after an hour.
- **Unsafe URLs are refused.** Every new link is checked against Google Safe Browsing.
- **Manage tokens instead of accounts (for now).** Creating a link returns a secret token. Only its
  SHA-256 is stored. Stats and delete need it, and the web app keeps it in the browser under My Links.
- **Rate limit:** 20 create attempts per IP per hour (IPv6 counted per /64, `CREATE_LIMIT_PER_HOUR`).
  Attempts are counted, not links, so flagged URLs, taken slugs and deleted links all use budget.

## ID design

Each link has two IDs. The internal one is SQLite's integer primary key, and it's never exposed.
The public one is the slug.

- **Case-sensitive base62** (`0-9a-zA-Z`), the same convention as Bitly. `/aB3xY9z` and
  `/ab3xy9z` are different URLs. Short links are almost always clicked or scanned rather than
  typed, so the shortest code wins over typo-friendliness.
- **Unique ignoring case:** a second index, `UNIQUE (lower(slug))`, means no two links may differ
  only by case. Nobody can register `MY-LAUNCH` next to `my-launch`, or `AB3XY9Z` next to
  `aB3xY9z`. A wrong-case visit gets a 404, never someone else's link. It's enforced by the
  database, so there's no race between check and insert.
- **Capacity:** 62^7 ≈ 3.5 trillion codes, but the case rule leaves 36^7 ≈ 78 billion usable
  ones. With a million links, a new random slug collides about once in 78,000 tries. The insert
  retries, and after 3 collisions the slug grows to 8 characters, so creation never fails and
  length grows only if it ever has to.
- **Why not Snowflake (V1)?** Snowflake solves ID generation across many writers without
  coordination. This system has one database, so it already has unique IDs. Using a Snowflake as
  the public code also made codes sequential, so every link could be enumerated.

## Security

- Validation: `http(s)` only, at most 2048 characters, stored in normalized form (punycode hosts,
  no stray control characters). Rejected: embedded credentials (`https://paypal.com@evil.example`),
  raw IPs, `localhost` and other non-public hosts, links to the shortener itself, and reserved slugs.
- Google Safe Browsing lookup on create. It **fails closed**: if the key is missing or Google is
  unreachable, creation returns 503 instead of skipping the check.
- Manage tokens are 256-bit random values. Only their SHA-256 is stored, and comparisons are
  constant-time. An optional `ADMIN_TOKEN` (32+ characters) lets the operator take down any link.
- Security headers everywhere: a strict CSP, `frame-ancestors 'none'`, HSTS and `nosniff`, set by
  Hono `secureHeaders` for the Worker and by [`frontend/public/_headers`](frontend/public/_headers)
  for the app.
- `Cross-Origin-Resource-Policy: same-origin` on the API only. Redirects omit it so a short link
  works as an `<img>` source on other sites.
- 8 KB body limit on the API. All SQL is parameterized. Errors are generic (HTML for browsers,
  JSON for the API).
- Known limits: the redirect cache can serve a deleted link for up to 5 minutes in other data
  centers. Manage tokens live in `localStorage` until accounts exist (React escaping and the CSP
  guard against XSS reading them).

Report abuse by opening an issue. Flagged links are taken down with the admin token.

## API

| Method | Path | Auth | |
|---|---|---|---|
| `POST` | `/api/links` | none | `{ url, slug?, expiresAt? }` → `201 { slug, shortUrl, manageToken, ... }` |
| `GET` | `/api/links/:slug` | `Bearer <manageToken or ADMIN_TOKEN>` | last 30 days: clicks, bot hits, per-day series, top countries / devices / browsers / referrers |
| `DELETE` | `/api/links/:slug` | `Bearer <manageToken or ADMIN_TOKEN>` | deletes the link and its clicks |
| `GET` | `/:slug` | none | `302` to the target, `404` / `410` HTML page otherwise |
| `GET` | `/api/health` | none | checks D1 |

## Run locally

```bash
cd frontend && npm install && npm run build && cd ..
cd worker && npm install
cp .dev.vars.example .dev.vars   # sets URL_SCREENING=off, so no Google key is needed locally
npm run dev          # applies local D1 migrations, serves app + API on http://localhost:8787
npm test             # tests run inside the Workers runtime against a real local D1
cd ../frontend && npm test   # API client tests (Node's built-in runner)
```

For frontend hot reload, run `npm run dev` in `frontend/` too (port 3000, proxies `/api` to 8787).

## Deploy

```bash
cd worker
npx wrangler d1 create url-shortener      # put the printed database_id in wrangler.jsonc
npx wrangler secret put IP_SALT           # any long random string
npx wrangler secret put SAFE_BROWSING_KEY # free key: Google Cloud console > Safe Browsing API
npx wrangler secret put ADMIN_TOKEN       # optional, 32+ random characters, for takedowns
cd ../frontend && npm run build && cd ../worker
npm run deploy
```

The redirect cache uses the Workers Cache API, which only works on a custom domain. On
`*.workers.dev` every redirect reads D1 (still within the free plan's 5M reads a day).

## What changed from V1

| V1 | Problem | V2 |
|---|---|---|
| Redis cache-aside | A cache hit still queried Postgres for `id` and `expiresAt`, so the cache saved nothing | The cache stores the whole record, and its TTL is capped by the link's expiry |
| Snowflake ID as the short code | 10 characters, consecutive, so every link was enumerable | Random 7-char base62, unique ignoring case |
| Redis Pub/Sub to an analytics worker | Clicks were lost while the worker was down, and doubled with 2 workers | Insert after the response with `waitUntil` |
| Sorted-set rate limiter | Check and add were separate round trips (race) | One indexed D1 count |
| Public `/analytics/:code` | Anyone could read any link's stats, and it loaded every click into memory | Token-protected, aggregated in SQL |
| 4 processes (API, worker, Postgres, Redis) | Never deployed | 1 Worker + 1 D1 database |

## Roadmap

Accounts and API keys, a dashboard redesign, an MCP server for agents, then
custom domains and smart routing.
