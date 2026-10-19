import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  RESERVED, htmlPage, isFlagged, lastDays, parseUserAgent, randomSlug, randomToken, rateLimitKey,
  referrerHost, secureEqual, sha256, targetProblem,
} from './lib';

type Link = { id: number; slug: string; url: string; token_hash: string; created_at: number; expires_at: number | null };
type Cached = Pick<Link, 'id' | 'url' | 'expires_at'>;
type Ctx = Context<{ Bindings: Env }>;

const HOUR = 3_600_000;
const DEFAULT_CREATE_LIMIT = 20;
const STATS_DAYS = 30;
const SLUG = '[A-Za-z0-9_-]{3,32}';
// ponytail: Cache API is per data center and a no-op on *.workers.dev, so after a delete other
// data centers can serve the old target for up to this long. Lower it, or move to KV, if that matters.
const CACHE_SECONDS = 300;

const app = new Hono<{ Bindings: Env }>();

// Headers for everything the Worker answers. The React app's headers live in frontend/public/_headers.
const headerPolicy: NonNullable<Parameters<typeof secureHeaders>[0]> = {
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    styleSrc: ["'unsafe-inline'"], // the error pages' one <style> block
    baseUri: ["'none'"],
    formAction: ["'none'"],
    frameAncestors: ["'none'"],
  },
  xFrameOptions: 'DENY',
};
const apiHeaders = secureHeaders(headerPolicy); // CORP same-origin: API JSON is never embedded elsewhere
// Redirects must be usable from any site, e.g. a short link as an <img> src; CORP same-origin on
// the 302 makes browsers block that (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin).
const linkHeaders = secureHeaders({ ...headerPolicy, crossOriginResourcePolicy: false });
app.use((c, next) => (c.req.path.startsWith('/api/') ? apiHeaders : linkHeaders)(c, next));

app.use('/api/*', bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: 'Request body too large' }, 413) }));

const createBody = z.object({
  url: z.url({ protocol: /^https?$/, error: 'URL must be a valid http:// or https:// address' }).max(2048, 'URL is too long'),
  slug: z.string().regex(new RegExp(`^${SLUG}$`), 'Custom slug must be 3-32 letters, digits, - or _').optional(),
  expiresAt: z.iso.datetime({ offset: true, error: 'expiresAt must be an ISO date' }).optional(),
});

const cacheKey = (c: Ctx, slug: string) => new Request(new URL(`/__link/${slug}`, c.req.url));

/**
 * Looks up a link by slug and checks the bearer token: the link's own manage token, or the
 * operator's ADMIN_TOKEN (for takedowns). Returns the link or an error response.
 */
async function authorize(c: Ctx, slug: string): Promise<Link | Response> {
  const link = await c.env.DB.prepare('SELECT * FROM links WHERE slug = ?').bind(slug).first<Link>();
  if (!link) return c.json({ error: 'Short link not found' }, 404);
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const admin = c.env.ADMIN_TOKEN ?? '';
  const ok =
    (token !== '' && (await secureEqual(await sha256(token), link.token_hash))) ||
    (admin.length >= 32 && (await secureEqual(token, admin))); // a short or unset admin token is ignored
  return ok ? link : c.json({ error: 'Invalid or missing manage token' }, 401);
}

app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ status: 'ok' });
});

app.post('/api/links', zValidator('json', createBody, (result, c) => {
  if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? 'Invalid request' }, 400);
}), async (c) => {
  const { slug: customSlug, expiresAt } = c.req.valid('json');
  const now = Date.now();
  const origin = new URL(c.req.url).origin;

  // Store the parsed form: it drops stray whitespace and control characters that could
  // otherwise end up in the Location header, and turns Unicode hostnames into punycode.
  const target = new URL(c.req.valid('json').url);
  const url = target.href;
  const problem = targetProblem(target, new URL(origin).host);
  if (problem) return c.json({ error: problem }, 400);
  if (url.length > 2048) return c.json({ error: 'URL is too long' }, 400);
  if (customSlug && RESERVED.has(customSlug.toLowerCase())) return c.json({ error: 'That slug is reserved' }, 400);
  const expires = expiresAt ? Date.parse(expiresAt) : null;
  if (expires !== null && expires <= now) return c.json({ error: 'expiresAt must be in the future' }, 400);

  if (!c.env.IP_SALT) throw new Error('IP_SALT secret is not set'); // never hash IPs with a guessable salt

  // Every attempt that gets this far counts, whatever happens next (flagged URL, taken slug,
  // Safe Browsing error), so neither bad submissions nor deleting links frees budget.
  // ponytail: count-then-insert, so a burst of parallel requests can overshoot by a few.
  // Fine for abuse control; use a Durable Object counter if it ever needs to be exact.
  const creator = await sha256(`${c.env.IP_SALT}:${rateLimitKey(c.req.header('CF-Connecting-IP') ?? 'unknown')}`);
  const limit = Number(c.env.CREATE_LIMIT_PER_HOUR) || DEFAULT_CREATE_LIMIT; // a missing var must not disable the limit
  const recent = await c.env.DB
    .prepare('SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM create_attempts WHERE creator_hash = ? AND ts > ?')
    .bind(creator, now - HOUR)
    .first<{ n: number; oldest: number | null }>();
  if (recent && recent.n >= limit) {
    const retryAfter = Math.max(1, Math.ceil(((recent.oldest ?? now) + HOUR - now) / 1000));
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: `Rate limit reached: ${limit} links per hour. Try again in ${Math.ceil(retryAfter / 60)} min.` }, 429);
  }
  // Only allowed attempts are written, so a blocked client hammering us costs reads, not writes.
  await c.env.DB.prepare('INSERT INTO create_attempts (creator_hash, ts) VALUES (?, ?)').bind(creator, now).run();

  // After the rate limit, so abusers can't spend our Safe Browsing quota.
  if (c.env.URL_SCREENING !== 'off') {
    if (!c.env.SAFE_BROWSING_KEY) {
      console.error('SAFE_BROWSING_KEY is not set, refusing to create links unscreened');
      return c.json({ error: 'Link creation is temporarily unavailable' }, 503);
    }
    let flagged: boolean;
    try {
      flagged = await isFlagged(url, c.env.SAFE_BROWSING_KEY);
    } catch (err) {
      console.error('safe browsing lookup failed', { err: String(err) });
      return c.json({ error: 'Could not check this URL for safety right now, please retry' }, 503);
    }
    if (flagged) return c.json({ error: 'This URL is flagged as unsafe by Google Safe Browsing' }, 400);
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const insert = c.env.DB.prepare(
    `INSERT INTO links (slug, url, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, // either the exact slug or a case variant exists
  );

  // Random slugs: 3 tries at 7 chars, then 8. The case-insensitive unique index leaves 36^7
  // (~78 billion) usable codes, so at a million links a collision is ~1 in 78,000 tries.
  // Growing is a safety valve, not something that happens in practice.
  const candidates = customSlug ? [customSlug] : [7, 7, 7, 8, 8].map((n) => randomSlug(n));
  let slug: string | null = null;
  for (const candidate of candidates) {
    const { meta } = await insert.bind(candidate, url, tokenHash, now, expires).run();
    if (meta.changes === 1) { slug = candidate; break; }
  }
  if (!slug) {
    return customSlug
      ? c.json({ error: 'That slug is already taken' }, 409)
      : c.json({ error: 'Could not allocate a slug, please retry' }, 503);
  }

  return c.json({
    slug,
    shortUrl: `${origin}/${slug}`,
    url,
    createdAt: new Date(now).toISOString(),
    expiresAt: expires ? new Date(expires).toISOString() : null,
    manageToken: token,
  }, 201);
});

app.get(`/api/links/:slug{${SLUG}}`, async (c) => {
  const link = await authorize(c, c.req.param('slug'));
  if (link instanceof Response) return link;

  // Every query is bounded to the last STATS_DAYS via the (link_id, ts) index, so a view costs
  // rows read proportional to recent clicks, not to the link's whole history.
  // ponytail: still scans each recent click; add a daily rollup table if links get ~100k clicks a month.
  const days = lastDays(STATS_DAYS);
  const since = Date.parse(days[0]!);
  const db = c.env.DB;
  const recentHumans = 'FROM clicks WHERE link_id = ? AND ts >= ? AND is_bot = 0';
  // `column` is always one of the literals below, never user input.
  const top = (column: 'country' | 'device' | 'browser' | 'referrer') =>
    db.prepare(`SELECT ${column} AS value, COUNT(*) AS clicks ${recentHumans}
                GROUP BY value ORDER BY clicks DESC LIMIT 10`).bind(link.id, since);

  const [totals, daily, countries, devices, browsers, referrers] = await db.batch<any>([
    db.prepare(`SELECT COUNT(*) - COALESCE(SUM(is_bot), 0) AS clicks, COALESCE(SUM(is_bot), 0) AS bots
                FROM clicks WHERE link_id = ? AND ts >= ?`).bind(link.id, since),
    db.prepare(`SELECT date(ts / 1000, 'unixepoch') AS day, COUNT(*) AS clicks ${recentHumans} GROUP BY day`).bind(link.id, since),
    top('country'), top('device'), top('browser'), top('referrer'),
  ]);

  const perDay = new Map<string, number>(daily!.results.map((r: any) => [r.day, r.clicks]));
  return c.json({
    slug: link.slug,
    url: link.url,
    createdAt: new Date(link.created_at).toISOString(),
    expiresAt: link.expires_at ? new Date(link.expires_at).toISOString() : null,
    days: STATS_DAYS, // every number below covers this window
    clicks: totals!.results[0].clicks,
    botClicks: totals!.results[0].bots,
    daily: days.map((day) => ({ day, clicks: perDay.get(day) ?? 0 })),
    countries: countries!.results,
    devices: devices!.results,
    browsers: browsers!.results,
    referrers: referrers!.results,
  });
});

app.delete(`/api/links/:slug{${SLUG}}`, async (c) => {
  const link = await authorize(c, c.req.param('slug'));
  if (link instanceof Response) return link;
  await c.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(link.id).run();
  await caches.default.delete(cacheKey(c, link.slug));
  return c.body(null, 204);
});

app.get(`/:slug{${SLUG}}`, async (c) => {
  const slug = c.req.param('slug');
  const key = cacheKey(c, slug);
  let link = await (await caches.default.match(key))?.json<Cached>();

  if (!link) {
    link = await c.env.DB.prepare('SELECT id, url, expires_at FROM links WHERE slug = ?').bind(slug).first<Cached>() ?? undefined;
    if (!link) return htmlPage(404, 'Link not found', 'This short link does not exist or was deleted.');
    const ttl = Math.min(CACHE_SECONDS, link.expires_at ? Math.floor((link.expires_at - Date.now()) / 1000) : CACHE_SECONDS);
    if (ttl > 0) c.executionCtx.waitUntil(caches.default.put(key, Response.json(link, { headers: { 'Cache-Control': `max-age=${ttl}` } })));
  }

  if (link.expires_at && link.expires_at <= Date.now()) return htmlPage(410, 'Link expired', 'This short link has expired.');

  // Recorded after the response is sent, so analytics never slows the redirect. HEAD requests
  // come from link checkers, not people, so they are not counted.
  if (c.req.method === 'GET') {
    const ua = parseUserAgent(c.req.header('User-Agent'));
    const cf = c.req.raw.cf as IncomingRequestCfProperties | undefined;
    c.executionCtx.waitUntil(
      c.env.DB.prepare('INSERT INTO clicks (link_id, ts, country, device, browser, referrer, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(link.id, Date.now(), cf?.country ?? null, ua.device, ua.browser, referrerHost(c.req.header('Referer')), ua.isBot ? 1 : 0)
        .run()
        .catch((err) => console.error('click insert failed', { slug, err: String(err) })), // e.g. link deleted mid-flight
    );
  }

  c.header('Cache-Control', 'private, max-age=0'); // every visit should reach us and be counted
  return c.redirect(link.url, 302);
});

app.notFound((c) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: 'Not found' }, 404)
    : htmlPage(404, 'Page not found', 'There is nothing at this address.'),
);

app.onError((err, c) => {
  console.error('unhandled', { path: c.req.path, err: String(err) });
  return c.req.path.startsWith('/api/')
    ? c.json({ error: 'Internal server error' }, 500)
    : htmlPage(500, 'Something went wrong', 'Please try this link again in a moment.'); // visitors are browsers
});

/** Attempts only matter for an hour of rate limiting, so (salted, hashed) IPs are not kept longer. */
export async function pruneAttempts(db: D1Database, now = Date.now()) {
  await db.prepare('DELETE FROM create_attempts WHERE ts < ?').bind(now - HOUR).run(); // uses create_attempts_time
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    await pruneAttempts(env.DB);
  },
} satisfies ExportedHandler<Env>;
