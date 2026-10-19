const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Slugs that would shadow real routes or look official. Matching is case-insensitive.
export const RESERVED = new Set([
  'api', 'app', 'assets', 'health', 'admin', 'login', 'static', 'favicon', 'www', 'abuse', 'about', 'privacy', 'terms',
]);

/** Random base62 slug, case-sensitive. 7 chars = 62^7 (~3.5 trillion) codes; callers grow the length on collision. */
export function randomSlug(length = 7): string {
  let out = '';
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      // 248 = 62 * 4: bytes above it are skipped so every character is equally likely.
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

/** 256-bit token, base64url. Shown to the creator once, only its hash is stored. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. Hashing first makes both sides the same length. */
export async function secureEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((v) => crypto.subtle.digest('SHA-256', enc.encode(v))));
  return crypto.subtle.timingSafeEqual(x!, y!);
}

/**
 * Rate-limit bucket for an IP. IPv6 users usually control a whole /64, so counting single
 * addresses would let them rotate past the limit.
 */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1); // IPv4-mapped, e.g. ::ffff:1.2.3.4
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}

/**
 * Rules for a redirect target beyond "valid http(s) URL". Returns an error message, or null if allowed.
 * `url` must already be parsed by `new URL`.
 */
export function targetProblem(url: URL, selfHost: string): string | null {
  if (url.username || url.password) return 'URLs with embedded credentials are not allowed'; // https://paypal.com@evil.com
  const host = url.hostname;
  // Raw IPs are a strong phishing signal and cover private ranges (127.x, 10.x, 192.168.x, [::1]...).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) return 'Links to raw IP addresses are not allowed';
  if (!host.includes('.') || /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host)) {
    return 'Links must point to a public domain';
  }
  if (url.host === selfHost) return 'Cannot shorten a link to this shortener';
  return null;
}

const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'];

/**
 * Google Safe Browsing v4 lookup. Returns true if the URL is on a threat list.
 * Throws on network errors or a non-200 answer, so the caller can fail closed.
 */
export async function isFlagged(url: string, apiKey: string): Promise<boolean> {
  const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client: { clientId: 'url-shortener', clientVersion: '2.0' },
      threatInfo: {
        threatTypes: THREAT_TYPES,
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }],
      },
    }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Safe Browsing answered ${res.status}`);
  const body = await res.json<{ matches?: unknown[] }>();
  return (body.matches?.length ?? 0) > 0;
}

// ponytail: keyword list, not a full UA database. Catches link-preview bots (Slack, X, WhatsApp,
// Discord...) and scripts, which are what inflate counts. Swap for a maintained list if misses show up.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|curl|wget|python|go-http|headless/i;

export function parseUserAgent(ua: string | undefined) {
  if (!ua) return { isBot: true, device: null, browser: null };
  const device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
  // Order matters: Edge and Opera UAs also contain "Chrome", and Chrome UAs contain "Safari".
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Other';
  return { isBot: BOT.test(ua), device, browser };
}

export function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname || null;
  } catch {
    return null;
  }
}

/** Last `days` UTC days as YYYY-MM-DD, oldest first, so charts have no gaps. */
export function lastDays(days: number, now = Date.now()): string[] {
  return Array.from({ length: days }, (_, i) =>
    new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Minimal HTML page for people who land on a dead link in a browser. */
export function htmlPage(status: number, title: string, message: string): Response {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:0 16px;background:#f8fafc;color:#0f172a}
@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}a{color:#93c5fd}}
main{max-width:28rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}</style>
<main><h1>${escape(title)}</h1><p>${escape(message)}</p><p><a href="/">Create a short link</a></p></main>`;
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
