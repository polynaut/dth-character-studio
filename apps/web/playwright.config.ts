import { defineConfig } from '@playwright/test'

// The browser smoke suite: the real SPA in a real browser, with the native
// (Tauri) backend replaced by an in-memory fake installed via addInitScript
// BEFORE any app code runs (see smoke/tauri-mock.ts). Deliberately NOT called
// e2e — the native side is a contract fake, not the real Rust (that seam is
// pinned by the contract tests instead). Specs are named *.smoke.ts so
// `vitest run` (which picks up *.test.* / *.spec.*) never collects them.
//
// The dev server runs on its own port (4331) so a developer's `pnpm dev` on
// 4330 keeps working next to a test run.
export default defineConfig({
  testDir: './smoke',
  testMatch: /.*\.smoke\.ts/,
  // The suite drives one shared dev server; keep runs deterministic.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4331',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite dev --port 4331 --strictPort',
    url: 'http://localhost:4331',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
