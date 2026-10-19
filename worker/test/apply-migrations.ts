import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
  }
}

// Only applies migrations not yet applied, so running it once per test file is safe.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
