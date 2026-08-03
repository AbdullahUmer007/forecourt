import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
    // Loads the root .env so the isolation suite finds DATABASE_URL. Without
    // it that suite silently skipped all 125 tests and still reported green —
    // see tests/isolation/setup.mjs. Harmless for every other suite: a real
    // environment variable always wins over the file.
    setupFiles: ['tests/isolation/setup.mjs'],
  },
});
