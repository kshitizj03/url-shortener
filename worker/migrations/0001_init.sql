-- Times are unix milliseconds.

CREATE TABLE links (
  id           INTEGER PRIMARY KEY,
  slug         TEXT    NOT NULL UNIQUE,   -- case-sensitive: /aB3xY9z and /ab3xy9z are different URLs
  url          TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL,          -- sha256 of the manage token, the token itself is never stored
  creator_hash TEXT    NOT NULL,          -- sha256 of salt + IP bucket, rate limiting only; blanked after an hour
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER
);
-- No two links may differ only by case, so nobody can register 'MY-LAUNCH' next to 'my-launch',
-- or 'AB3XY9Z' next to 'aB3xY9z'. A wrong-case visit gets a 404, never someone else's link.
CREATE UNIQUE INDEX links_slug_nocase ON links (lower(slug));
CREATE INDEX links_creator_time ON links (creator_hash, created_at);

CREATE TABLE clicks (
  id       INTEGER PRIMARY KEY,
  link_id  INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  ts       INTEGER NOT NULL,
  country  TEXT,
  device   TEXT,
  browser  TEXT,
  referrer TEXT,                          -- hostname only
  is_bot   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX clicks_link_time ON clicks (link_id, ts);
