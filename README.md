# URL Shortener

A production-grade URL shortener built on distributed systems principles. Converts long URLs into short codes, tracks click analytics, and handles high redirect traffic — engineered the way real systems are built.

> Built to demonstrate core distributed systems concepts: conflict-free ID generation, cache-aside pattern, async event processing, and sliding window rate limiting.

---

## Architecture

```
SHORTEN FLOW
─────────────────────────────────────────────────────────────
Long URL ──► Snowflake ID Generator ──► Base62 Encoder ──► PostgreSQL
                                              │
                                         Short Code
                                         (e.g. aX9kRm)

REDIRECT FLOW
─────────────────────────────────────────────────────────────
GET /aX9kRm ──► Redis Cache ──► HIT  ──► 302 Redirect
                    │
                   MISS
                    │
               PostgreSQL ──► cache result ──► 302 Redirect
                    │
                    └──► publish click event (non-blocking)
                                    │
                            Redis Pub/Sub Channel
                                    │
                            Analytics Worker (async)
                                    │
                              PostgreSQL clicks table
```

---

## Features

- **Snowflake ID Generation** — distributed 64-bit IDs, no DB coordination, no collisions
- **Base62 Encoding** — clean 6–8 character short codes from `a-zA-Z0-9`
- **Cache-Aside Pattern** — Redis serves hot URLs in under 1ms, PostgreSQL is the source of truth
- **Async Analytics** — click events published to Redis Pub/Sub; redirect latency is never affected by analytics writes
- **Sliding Window Rate Limiter** — 10 shorten requests per IP per minute, enforced via Redis sorted sets
- **QR Code Generation** — instant QR codes for every shortened link
- **API Key Auth** — protected delete operations

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Database | PostgreSQL, Prisma ORM |
| Cache + Queue | Redis (cache-aside + Pub/Sub) |
| Frontend | React 18, Tailwind CSS, Vite |
| Charts | Recharts |
| Containerization | Docker, docker-compose |

---

## Getting Started

### Prerequisites
- Docker and Docker Compose

### Run with Docker

```bash
git clone <your-repo-url>
cd url-shortener

cp backend/.env.example backend/.env
# Add your settings to backend/.env

docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

### Local Development

**Backend**
```bash
cd backend
npm install
cp .env.example .env
npx prisma db push
npm run dev
```

**Analytics Worker** (separate terminal)
```bash
cd backend
npm run worker
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

---

## How It Works

**Snowflake ID — conflict-free ID generation**

Every short code starts as a 64-bit integer split into three parts:

```
┌──────────┬────────────────┬────────────┬──────────────┐
│  1 bit   │   41 bits      │  10 bits   │   12 bits    │
│  unused  │  timestamp ms  │ machine ID │   sequence   │
└──────────┴────────────────┴────────────┴──────────────┘
```

The timestamp ensures uniqueness over time, machine ID allows multiple servers to generate IDs simultaneously without coordination, and the sequence handles 4096 IDs per millisecond per server. The result is Base62-encoded into a short, readable code — no database lookup needed before insertion.

**Cache-aside — sub-millisecond redirects**

Every redirect checks Redis first. On a miss, PostgreSQL is queried and the result is stored in Redis with a 24-hour TTL. Popular links are served entirely from memory.

**Async analytics — hot path stays fast**

On every redirect, a click event is published to a Redis channel and the 302 response is returned immediately. A separate worker process subscribes to the channel and writes to PostgreSQL asynchronously. A slow analytics write never delays a user's redirect.

**Sliding window rate limiter — abuse prevention**

Uses Redis sorted sets keyed by IP address. On each request, entries older than 60 seconds are removed, the remaining count is checked, and a new entry is added if under the limit. Shared Redis means the limit is enforced consistently across multiple server instances.

---

## License

MIT