import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { parseUserAgent, randomSlug } from '../src/lib';

const ORIGIN = 'https://sho.rt';
const HOUR_MS = 3_600_000;
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const EDGE = `${CHROME} Edg/141.0`;
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

/** Calls the app and waits for waitUntil work (click inserts, cache puts) to finish. */
async function call(path: string, init: RequestInit = {}, ip = freshIp()) {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', ip);
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(ORIGIN + path, { ...init, headers, redirect: 'manual' }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function create(body: object, ip?: string) {
  return call('/api/links', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }, ip);
}

async function createOk(body: object = { url: 'https://example.com/a/long/path?x=1' }) {
  const res = await create(body);
  expect(res.status).toBe(201);
  return res.json<{ slug: string; shortUrl: string; manageToken: string; expiresAt: string | null }>();
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe('create', () => {
  it('returns a random 7-char slug, short URL and manage token', async () => {
    const link = await createOk();
    expect(link.slug).toMatch(/^[0-9a-zA-Z]{7}$/);
    expect(link.shortUrl).toBe(`${ORIGIN}/${link.slug}`);
    expect(link.manageToken.length).toBeGreaterThanOrEqual(43);
  });

  it('does not produce sequential slugs', async () => {
    const a = await createOk();
    const b = await createOk();
    expect(a.slug.slice(0, 6)).not.toBe(b.slug.slice(0, 6));
  });

  it('accepts a custom slug once, then 409', async () => {
    expect((await createOk({ url: 'https://example.com', slug: 'my-launch' })).slug).toBe('my-launch');
    expect((await create({ url: 'https://example.com', slug: 'my-launch' })).status).toBe(409);
  });

  it.each([
    [{ url: 'javascript:alert(1)' }, 'http'],
    [{ url: 'ftp://example.com/file' }, 'http'],
    [{ url: 'not a url' }, 'http'],
    [{ url: `https://example.com/${'a'.repeat(2100)}` }, 'too long'],
    [{ url: `${ORIGIN}/abc1234` }, 'this shortener'],
    [{ url: 'https://example.com', slug: 'API' }, 'reserved'],
    [{ url: 'https://example.com', slug: 'a b' }, 'slug'],
    [{ url: 'https://example.com', expiresAt: '2001-01-01T00:00:00Z' }, 'future'],
  ])('rejects %j', async (body, message) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toContain(message);
  });

  it('rate limits per IP with Retry-After', async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) expect((await create({ url: 'https://example.com' }, ip)).status).toBe(201);
    const blocked = await create({ url: 'https://example.com' }, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await create({ url: 'https://example.com' })).status).toBe(201); // other IPs unaffected
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

  it('serves a second hit from cache without touching the links table', async () => {
    const link = await createOk();
    await call(`/${link.slug}`);
    // Point the DB row elsewhere: a cached redirect still uses the original target.
    await env.DB.prepare('UPDATE links SET url = ? WHERE slug = ?').bind('https://changed.example', link.slug).run();
    expect((await call(`/${link.slug}`)).headers.get('Location')).toBe('https://example.com/a/long/path?x=1');
  });

  it('404s with an HTML page for unknown slugs', async () => {
    const res = await call('/nope123');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('410s once expired', async () => {
    const link = await createOk({ url: 'https://example.com', expiresAt: new Date(Date.now() + HOUR_MS).toISOString() });
    expect(link.expiresAt).not.toBeNull();
    await env.DB.prepare('UPDATE links SET expires_at = ? WHERE slug = ?').bind(Date.now() - 1, link.slug).run();
    expect((await call(`/${link.slug}`)).status).toBe(410);
  });
});


describe('stats', () => {
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

describe('lib', () => {
  it('randomSlug uses only base62 characters', () => {
    const all = Array.from({ length: 2000 }, () => randomSlug()).join('');
    expect(all).toMatch(/^[0-9a-zA-Z]+$/);
    expect(new Set(all).size).toBe(62);
  });

  it('parseUserAgent tells Edge and Chrome apart and flags missing UAs as bots', () => {
    expect(parseUserAgent(EDGE).browser).toBe('Edge');
    expect(parseUserAgent(CHROME).browser).toBe('Chrome');
    expect(parseUserAgent(IPHONE_SAFARI)).toEqual({ isBot: false, device: 'mobile', browser: 'Safari' });
    expect(parseUserAgent(undefined).isBot).toBe(true);
  });
});
