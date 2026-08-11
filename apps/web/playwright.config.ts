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
  // Playwright's default — HALF the cores, i.e. 2 workers on the 4-vCPU public
  // runner. A 4-worker pin was tried (#778: 2 workers did 99 tests in 4.0m, 4
  // workers 105 in 3.9m — the box saturates at 2, Chromium + Vite
  // dev-transforms being CPU-bound) and REVERTED a day later with the flake
  // bill attached: six different houdini-* specs across five PR runs failed
  // as starvation timeouts — interactions that are instant locally, a
  // different spec each run (contention picks who loses), every one green on
  // rerun — and one still starved past a doubled 60 s budget. ~0.1 min of
  // wall time bought all of that. The levers that genuinely move wall time
  // are sharding across runners or serving a prebuilt bundle instead of
  // dev-mode transforms (see .ai/testing.md). Worker-safety is proven daily
  // by local runs at 8+: tests share nothing but the stateless Vite server —
  // every page installs its own in-memory native fake — and `fullyParallel:
  // false` still holds within a file, so per-file ordering stays
  // deterministic; only FILES spread across workers.
  workers: process.env.CI ? 2 : undefined,
  // Belt to the braces above: a doubled per-test budget on CI, so residual
  // contention spikes (the runner is still a shared 4-vCPU box) never snap a
  // healthy spec. Locally the default 30 s stays — the heaviest spec runs
  // ~12 s there. NOT retries: a retry hides exactly the nondeterminism this
  // suite exists to catch; `retries: 0` stays load-bearing.
  timeout: process.env.CI ? 60_000 : undefined,
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
