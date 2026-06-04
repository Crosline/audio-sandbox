import { defineConfig } from 'vitest/config';

// Unit tests for the app's pure (non-Svelte, non-DOM) logic — e.g. canvas sizing math.
// Component/E2E behaviour is covered by the Playwright suite in ./tests, not here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
