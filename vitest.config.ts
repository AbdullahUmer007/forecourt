import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors apps/crm/tsconfig.json so the CRM's own modules are testable.
      // Without it a test can only reach the domain layer, which is the half
      // that was already covered.
      '@/': `${fileURLToPath(new URL('./apps/crm/src', import.meta.url))}/`,
      '@forecourt/domain': fileURLToPath(
        new URL('./packages/domain/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
    // Loads the root .env so the isolation suite finds DATABASE_URL. Without
    // it that suite silently skipped all 125 tests and still reported green —
    // see tests/isolation/setup.mjs. Harmless for every other suite: a real
    // environment variable always wins over the file.
    setupFiles: ['tests/isolation/setup.mjs'],
  },
});
