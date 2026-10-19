const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Slugs that would shadow real routes or look official.
export const RESERVED = new Set(['api', 'app', 'assets', 'health', 'admin', 'login', 'static', 'favicon']);

/** Random base62 slug. 62^7 is ~3.5 trillion, so collisions are rare and retried by the caller. */
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
