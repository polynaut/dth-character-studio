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
  // Playwright's default is HALF the cores — 2 workers on the 4-vCPU public
  // runner. Pinned to 4 there, with the honest measurement attached: 2 workers
  // did 99 tests in 4.0m, 4 workers did 105 in 3.9m (both 2026-08-10), i.e.
  // ~8% per test — the runner is CPU-bound (Chromium + Vite dev-transforms
  // saturate 4 vCPU at 2 workers already), so more workers can't buy much.
  // Kept because it is free and mildly positive; the levers that would really
  // move the wall time are sharding across runners or serving a prebuilt
  // bundle instead of dev-mode transforms (see .ai/testing.md). Worker-safety
  // is proven daily by local runs at 8+: tests share nothing but the stateless
  // Vite server — every page installs its own in-memory native fake — and
  // `fullyParallel: false` still holds within a file, so per-file ordering
  // stays deterministic; only FILES spread across workers.
  workers: process.env.CI ? 4 : undefined,
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
