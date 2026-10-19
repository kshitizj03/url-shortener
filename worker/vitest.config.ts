import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          // Set explicitly so tests never depend on a local .dev.vars (CI has none).
          IP_SALT: 'test-salt',
          CREATE_LIMIT_PER_HOUR: '3',
          URL_SCREENING: 'off', // the screening tests turn it back on per request
          SAFE_BROWSING_KEY: '',
          ADMIN_TOKEN: 'admin-token-for-tests-0123456789abcdef',
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
        },
      },
    }),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
}));
