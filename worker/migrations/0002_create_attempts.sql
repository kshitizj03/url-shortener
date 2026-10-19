-- Rate limiting now counts every create attempt that reaches the limiter (flagged URLs, taken
-- slugs, Safe Browsing errors), not rows in `links`. Before this, submitting flagged URLs or
-- deleting links freed budget, so the limit could be bypassed. The hourly cron deletes rows
-- older than an hour, so this table only ever holds recent attempts.
CREATE TABLE create_attempts (
  creator_hash TEXT    NOT NULL,          -- sha256 of salt + IP bucket
  ts           INTEGER NOT NULL           -- unix milliseconds
);
CREATE INDEX create_attempts_creator_time ON create_attempts (creator_hash, ts);
CREATE INDEX create_attempts_time ON create_attempts (ts);

-- links.creator_hash only existed for rate limiting.
DROP INDEX links_creator_time;
ALTER TABLE links DROP COLUMN creator_hash;
