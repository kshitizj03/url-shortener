import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { pruneAttempts } from '../src/index';
import { parseUserAgent, randomSlug, rateLimitKey } from '../src/lib';

const ORIGIN = 'https://sho.rt';
const HOUR_MS = 3_600_000;
const SLUG_7 = /^[0-9a-zA-Z]{7}$/;
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const EDGE = `${CHROME} Edg/141.0`;
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

type CallOpts = { ip?: string; env?: Partial<Env> };

/** Calls the Worker and waits for waitUntil work (click inserts, cache puts) to finish. */
async function call(path: string, init: RequestInit = {}, opts: CallOpts = {}) {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', opts.ip ?? freshIp());
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(ORIGIN + path, { ...init, headers, redirect: 'manual' }), { ...env, ...opts.env }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const post = (body: unknown) => ({ method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const create = (body: unknown, opts?: CallOpts) => call('/api/links', post(body), opts);

async function createOk(body: object = { url: 'https://example.com/a/long/path?x=1' }) {
  const res = await create(body);
  expect(res.status).toBe(201);
  return res.json<{ slug: string; shortUrl: string; url: string; manageToken: string; expiresAt: string | null }>();
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const errorOf = async (res: Response) => (await res.json<{ error: string }>()).error;

afterEach(() => vi.restoreAllMocks());

describe('slugs', () => {
  it('are 7 chars of base62, with a token and short URL', async () => {
    const link = await createOk();
    expect(link.slug).toMatch(SLUG_7);
    expect(link.shortUrl).toBe(`${ORIGIN}/${link.slug}`);
    expect(link.manageToken.length).toBeGreaterThanOrEqual(43);
  });

  it('are not sequential', async () => {
    const a = await createOk();
    const b = await createOk();
    expect(a.slug.slice(0, 6)).not.toBe(b.slug.slice(0, 6));
  });

  it('are case-sensitive: a wrong-case visit is a 404', async () => {
    const link = await createOk({ url: 'https://example.com', slug: 'aBc123x' });
    expect((await call(`/${link.slug}`)).status).toBe(302);
    expect((await call('/ABC123X')).status).toBe(404);
  });

  it('cannot be registered as a case variant of an existing slug', async () => {
    expect((await createOk({ url: 'https://example.com', slug: 'my-launch' })).slug).toBe('my-launch');
    const res = await create({ url: 'https://evil.example', slug: 'MY-LAUNCH' });
    expect(res.status).toBe(409);
    expect((await call('/MY-LAUNCH')).status).toBe(404); // never someone else's link

    const random = await createOk();
    const swapped = [...random.slug].map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase())).join('');
    expect((await create({ url: 'https://evil.example', slug: swapped })).status).toBe(409);
  });

  it('grow one character when the 7-char attempts collide', async () => {
    // Force every 7-char draw to the same slug: the first link takes it, the next link
    // collides three times and must fall back to 8 chars. (A 7-char slug draws 14 bytes.)
    const values = vi.spyOn(crypto, 'getRandomValues');
    values.mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      const bytes = array as unknown as Uint8Array;
      if (bytes.length === 14) bytes.fill(0);
      else for (let i = 0; i < bytes.length; i++) bytes[i] = i; // tokens and 8-char slugs
      return array;
    });
    const first = await createOk();
    expect(first.slug).toBe('0000000');
    const second = await createOk();
    expect(second.slug).toHaveLength(8);
  });
});

describe('create validation', () => {
  it.each([
    [{ url: 'javascript:alert(1)' }, 'http'],
    [{ url: 'ftp://example.com/file' }, 'http'],
    [{ url: 'not a url' }, 'http'],
    [{ url: `https://example.com/${'a'.repeat(2100)}` }, 'too long'],
    [{ url: `${ORIGIN}/abc1234` }, 'this shortener'],
    [{ url: 'https://paypal.com@evil.example/login' }, 'credentials'],
    [{ url: 'http://192.168.1.1/admin' }, 'raw IP'],
    [{ url: 'http://[::1]:8080/' }, 'raw IP'],
    [{ url: 'http://localhost:3000/' }, 'public domain'],
    [{ url: 'http://intranet/wiki' }, 'public domain'],
    [{ url: 'http://localhost./' }, 'public domain'],
    [{ url: 'http://router.local./admin' }, 'public domain'],
    [{ url: `${ORIGIN}./abc1234` }, 'this shortener'],
    [{ url: `${ORIGIN}../abc1234` }, 'this shortener'],
    [{ url: 'https://example.com', slug: 'API' }, 'reserved'],
    [{ url: 'https://example.com', slug: 'a b' }, 'slug'],
    [{ url: 'https://example.com', expiresAt: '2001-01-01T00:00:00Z' }, 'future'],
  ])('rejects %j', async (body, message) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain(message);
  });

  it('stores the normalized URL: Unicode hosts become punycode', async () => {
    expect((await createOk({ url: 'https://bücher.example/Straße' })).url).toBe('https://xn--bcher-kva.example/Stra%C3%9Fe');
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await create({ url: 'https://example.com', pad: 'x'.repeat(10_000) });
    expect(res.status).toBe(413);
  });

  it('refuses to run without IP_SALT instead of hashing IPs with a guessable salt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await create({ url: 'https://example.com' }, { env: { IP_SALT: '' } })).status).toBe(500);
  });
});

describe('rate limit', () => {
  it('limits per IP with Retry-After, without affecting other IPs', async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) expect((await create({ url: 'https://example.com' }, { ip })).status).toBe(201);
    const blocked = await create({ url: 'https://example.com' }, { ip });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await create({ url: 'https://example.com' })).status).toBe(201);
  });

  it('counts a whole IPv6 /64 as one client', async () => {
    for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2:aaaa::3']) {
      expect((await create({ url: 'https://example.com' }, { ip })).status).toBe(201);
    }
    expect((await create({ url: 'https://example.com' }, { ip: '2001:db8:1:2:ffff:ffff:ffff:ffff' })).status).toBe(429);
    expect((await create({ url: 'https://example.com' }, { ip: '2001:db8:1:3::1' })).status).toBe(201);
  });

  it('counts attempts, so deleting links does not free budget', async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) {
      const res = await create({ url: 'https://example.com' }, { ip });
      expect(res.status).toBe(201);
      const { slug, manageToken } = await res.json<any>();
      expect((await call(`/api/links/${slug}`, { method: 'DELETE', ...auth(manageToken) }, { ip })).status).toBe(204);
    }
    expect((await create({ url: 'https://example.com' }, { ip })).status).toBe(429);
  });

  it('counts rejected attempts too: a taken slug still uses budget', async () => {
    const ip = freshIp();
    await createOk({ url: 'https://example.com', slug: 'budget-test' });
    for (let i = 0; i < 3; i++) expect((await create({ url: 'https://example.com', slug: 'budget-test' }, { ip })).status).toBe(409);
    expect((await create({ url: 'https://example.com' }, { ip })).status).toBe(429);
  });

  it('does not write attempts for blocked requests', async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) await create({ url: 'https://example.com' }, { ip });
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM create_attempts').first('n');
    for (let i = 0; i < 5; i++) expect((await create({ url: 'https://example.com' }, { ip })).status).toBe(429);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM create_attempts').first('n')).toBe(before);
  });

  it('falls back to 20 per hour when CREATE_LIMIT_PER_HOUR is missing, instead of no limit', async () => {
    const ip = freshIp();
    const noVar = { env: { CREATE_LIMIT_PER_HOUR: undefined as unknown as Env["CREATE_LIMIT_PER_HOUR"] }, ip };
    for (let i = 0; i < 20; i++) expect((await create({ url: 'https://example.com' }, noVar)).status).toBe(201);
    expect((await create({ url: 'https://example.com' }, noVar)).status).toBe(429);
  });

  it('prunes attempts older than an hour', async () => {
    await createOk();
    const count = () => env.DB.prepare('SELECT COUNT(*) AS n FROM create_attempts').first<number>('n');
    await pruneAttempts(env.DB);
    expect(await count()).toBeGreaterThan(0); // still inside the hour
    await pruneAttempts(env.DB, Date.now() + HOUR_MS + 1);
    expect(await count()).toBe(0);
  });
});

describe('url screening', () => {
  const screening = { env: { URL_SCREENING: '', SAFE_BROWSING_KEY: 'test-key' } };
  // A fresh Response per call: a body can only be read once.
  const mockGoogle = (make: () => Response) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => make());

  it('blocks URLs Google flags', async () => {
    const fetchSpy = mockGoogle(() => Response.json({ matches: [{ threatType: 'SOCIAL_ENGINEERING' }] }));
    const res = await create({ url: 'https://phish.example/login' }, screening);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain('unsafe');
    const [request, init] = fetchSpy.mock.calls[0]!;
    expect(String(request)).toBe('https://safebrowsing.googleapis.com/v4/threatMatches:find?key=test-key');
    expect(JSON.parse(String(init!.body)).threatInfo.threatEntries).toEqual([{ url: 'https://phish.example/login' }]);
  });

  it('counts flagged URLs toward the rate limit, so Google is not called without bound', async () => {
    const google = mockGoogle(() => Response.json({ matches: [{ threatType: 'MALWARE' }] }));
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await create({ url: `https://bad${i}.example/` }, { ...screening, ip })).status);
    expect(statuses).toEqual([400, 400, 400, 429, 429, 429]);
    expect(google).toHaveBeenCalledTimes(3);
  });

  it('allows URLs Google has no match for', async () => {
    mockGoogle(() => Response.json({}));
    expect((await create({ url: 'https://example.com' }, screening)).status).toBe(201);
  });

  it('fails closed when Google errors or the key is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGoogle(() => new Response('quota exceeded', { status: 429 }));
    expect((await create({ url: 'https://example.com' }, screening)).status).toBe(503);
    expect((await create({ url: 'https://example.com' }, { env: { URL_SCREENING: '', SAFE_BROWSING_KEY: '' } })).status).toBe(503);
  });
});

describe('redirect', () => {
  it('302s to the target and records the click', async () => {
    const link = await createOk();
    const res = await call(`/${link.slug}`, { headers: { 'User-Agent': CHROME, Referer: 'https://news.ycombinator.com/item?id=1' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://example.com/a/long/path?x=1');

    const row = await env.DB.prepare(
      'SELECT browser, device, referrer, is_bot FROM clicks JOIN links ON links.id = link_id WHERE slug = ?',
    ).bind(link.slug).first();
    expect(row).toEqual({ browser: 'Chrome', device: 'desktop', referrer: 'news.ycombinator.com', is_bot: 0 });
  });

  it('does not count HEAD requests', async () => {
    const link = await createOk();
    expect((await call(`/${link.slug}`, { method: 'HEAD', headers: { 'User-Agent': CHROME } })).status).toBe(302);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM clicks JOIN links ON links.id = link_id WHERE slug = ?').bind(link.slug).first('n');
    expect(n).toBe(0);
  });

  it('serves a second hit from cache without touching the links table', async () => {
    const link = await createOk();
    await call(`/${link.slug}`);
    await env.DB.prepare('UPDATE links SET url = ? WHERE slug = ?').bind('https://changed.example', link.slug).run();
    expect((await call(`/${link.slug}`)).headers.get('Location')).toBe('https://example.com/a/long/path?x=1');
  });

  it('404s with an HTML page for unknown slugs', async () => {
    const res = await call('/nope1234');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('shows browsers an HTML error page on internal errors, while the API keeps JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenDb = { prepare() { throw new Error('D1 is down'); } } as unknown as D1Database;
    const page = await call('/zzzzzzz', {}, { env: { DB: brokenDb } });
    expect(page.status).toBe(500);
    expect(page.headers.get('Content-Type')).toContain('text/html');
    const api = await call('/api/health', {}, { env: { DB: brokenDb } });
    expect(api.status).toBe(500);
    expect(api.headers.get('Content-Type')).toContain('application/json');
  });

  it('410s once expired', async () => {
    const link = await createOk({ url: 'https://example.com', expiresAt: new Date(Date.now() + HOUR_MS).toISOString() });
    expect(link.expiresAt).not.toBeNull();
    await env.DB.prepare('UPDATE links SET expires_at = ? WHERE slug = ?').bind(Date.now() - 1, link.slug).run();
    expect((await call(`/${link.slug}`)).status).toBe(410);
  });
});

describe('security headers', () => {
  it('leave redirects embeddable cross-origin (no CORP) but keep CORP same-origin on the API', async () => {
    const link = await createOk();
    const redirect = await call(`/${link.slug}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('Cross-Origin-Resource-Policy')).toBeNull();
    expect(redirect.headers.get('X-Content-Type-Options')).toBe('nosniff'); // the rest still applies
    expect((await call('/api/health')).headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });

  it('are set on API responses and HTML pages', async () => {
    for (const res of [await call('/api/health'), await call('/nope1234')]) {
      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Strict-Transport-Security')).toBeTruthy();
    }
  });
});

describe('stats', () => {
  it('only counts the last 30 days, in totals and breakdowns alike', async () => {
    const link = await createOk();
    await call(`/${link.slug}`, { headers: { 'User-Agent': CHROME } });
    const id = await env.DB.prepare('SELECT id FROM links WHERE slug = ?').bind(link.slug).first('id');
    // An old click: outside the window, so it must not show up anywhere.
    await env.DB.prepare("INSERT INTO clicks (link_id, ts, country, device, browser, is_bot) VALUES (?, ?, 'FR', 'desktop', 'Firefox', 0)")
      .bind(id, Date.now() - 40 * 86_400_000).run();
    const stats = await (await call(`/api/links/${link.slug}`, auth(link.manageToken))).json<any>();
    expect(stats.days).toBe(30);
    expect(stats.clicks).toBe(1);
    expect(stats.browsers).toEqual([{ value: 'Chrome', clicks: 1 }]);
    expect(stats.countries.some((r: any) => r.value === 'FR')).toBe(false);
  });

  it('requires the manage token', async () => {
    const link = await createOk();
    expect((await call(`/api/links/${link.slug}`)).status).toBe(401);
    expect((await call(`/api/links/${link.slug}`, auth('wrong'))).status).toBe(401);
    expect((await call('/api/links/missing1', auth(link.manageToken))).status).toBe(404);
  });

  it('aggregates human clicks and counts bots separately', async () => {
    const link = await createOk();
    await call(`/${link.slug}`, { headers: { 'User-Agent': EDGE } });
    await call(`/${link.slug}`, { headers: { 'User-Agent': IPHONE_SAFARI } });
    await call(`/${link.slug}`, { headers: { 'User-Agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' } });

    const res = await call(`/api/links/${link.slug}`, auth(link.manageToken));
    expect(res.status).toBe(200);
    const stats = await res.json<any>();
    expect(stats.clicks).toBe(2);
    expect(stats.botClicks).toBe(1);
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.at(-1).clicks).toBe(2);
    expect(stats.browsers).toEqual(expect.arrayContaining([{ value: 'Edge', clicks: 1 }, { value: 'Safari', clicks: 1 }]));
    expect(stats.devices).toEqual(expect.arrayContaining([{ value: 'mobile', clicks: 1 }, { value: 'desktop', clicks: 1 }]));
  });
});

describe('delete', () => {
  it('removes the link, its clicks and the cached redirect', async () => {
    const link = await createOk();
    await call(`/${link.slug}`, { headers: { 'User-Agent': CHROME } });
    const id = await env.DB.prepare('SELECT id FROM links WHERE slug = ?').bind(link.slug).first('id');
    const clicks = () => env.DB.prepare('SELECT COUNT(*) AS n FROM clicks WHERE link_id = ?').bind(id).first('n');
    expect(await clicks()).toBe(1);
    expect((await call(`/api/links/${link.slug}`, { method: 'DELETE' })).status).toBe(401);
    expect((await call(`/api/links/${link.slug}`, { method: 'DELETE', ...auth(link.manageToken) })).status).toBe(204);

    expect((await call(`/${link.slug}`)).status).toBe(404);
    expect(await clicks()).toBe(0);
  });
});

describe('admin token', () => {
  it('can read stats for and take down any link', async () => {
    const link = await createOk();
    const admin = auth(env.ADMIN_TOKEN);
    expect((await call(`/api/links/${link.slug}`, admin)).status).toBe(200);
    expect((await call(`/api/links/${link.slug}`, { method: 'DELETE', ...admin })).status).toBe(204);
    expect((await call(`/${link.slug}`)).status).toBe(404);
  });

  it('is ignored when shorter than 32 characters', async () => {
    const link = await createOk();
    expect((await call(`/api/links/${link.slug}`, auth('short'), { env: { ADMIN_TOKEN: 'short' } })).status).toBe(401);
  });
});

describe('lib', () => {
  it('randomSlug uses all 62 base62 characters', () => {
    const all = Array.from({ length: 2000 }, () => randomSlug()).join('');
    expect(all).toMatch(/^[0-9a-zA-Z]+$/);
    expect(new Set(all).size).toBe(62);
  });

  it('rateLimitKey buckets IPv6 by /64 and leaves IPv4 alone', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKey('2001:db8::1')).toBe('2001:0db8:0000:0000::/64');
    expect(rateLimitKey('2001:DB8:0:0:1:2:3:4')).toBe('2001:0db8:0000:0000::/64');
    expect(rateLimitKey('2001:db8:aa:bb:cc::')).toBe('2001:0db8:00aa:00bb::/64');
  });

  it('parseUserAgent tells Edge and Chrome apart and flags missing UAs as bots', () => {
    expect(parseUserAgent(EDGE).browser).toBe('Edge');
    expect(parseUserAgent(CHROME).browser).toBe('Chrome');
    expect(parseUserAgent(IPHONE_SAFARI)).toEqual({ isBot: false, device: 'mobile', browser: 'Safari' });
    expect(parseUserAgent(undefined).isBot).toBe(true);
  });
});
