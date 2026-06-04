import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the app — the browser-only behaviour that Vitest can't cover
 * (canvas rendering, Web Audio playback, scroll/zoom layout). Playwright boots the Vite
 * dev server itself via `webServer`, so `pnpm --filter app test:e2e` is self-contained.
 *
 * Fixtures are generated at runtime (see tests/helpers/wav.ts) rather than committed, so
 * these run in CI without the gitignored, user-provided `fixtures/` directory.
 */
const PORT = 5180;

export default defineConfig({
  testDir: './tests',
  // Each spec is independent; run files in parallel.
  fullyParallel: true,
  // Fail the build if someone left a test.only in.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
