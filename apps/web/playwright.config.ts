import { defineConfig } from '@playwright/test'

// The browser smoke suite: the real SPA in a real browser, with the native
// (Tauri) backend replaced by an in-memory fake installed via addInitScript
// BEFORE any app code runs (see smoke/tauri-mock.ts). Deliberately NOT called
// e2e — the native side is a contract fake, not the real Rust (that seam is
// pinned by the contract tests instead). Specs are named *.smoke.ts so
// `vitest run` (which picks up *.test.* / *.spec.*) never collects them.
//
// The suite's server runs on its own port (4331) so a developer's `pnpm dev`
// on 4330 keeps working next to a test run.

// Serve a PREBUILT bundle instead of dev-mode transforms. On by default in CI
// (see the webServer note at the bottom for the measured why); `SMOKE_PREBUILT`
// forces it either way, so the CI arrangement is reproducible locally — a bug
// that only shows in the built bundle must not be a bug only CI can see.
const PREBUILT = process.env.SMOKE_PREBUILT
  ? process.env.SMOKE_PREBUILT !== '0'
  : !!process.env.CI

export default defineConfig({
  testDir: './smoke',
  testMatch: /.*\.smoke\.ts/,
  // The suite drives one shared server; keep runs deterministic.
  fullyParallel: false,
  // Playwright's default — HALF the cores, i.e. 2 workers on the 4-vCPU public
  // runner. A 4-worker pin was tried (#778: 2 workers did 99 tests in 4.0m, 4
  // workers 105 in 3.9m — the box saturates at 2, Chromium + Vite
  // dev-transforms being CPU-bound) and REVERTED a day later with the flake
  // bill attached: six different houdini-* specs across five PR runs failed
  // as starvation timeouts — interactions that are instant locally, a
  // different spec each run (contention picks who loses), every one green on
  // rerun — and one still starved past a doubled 60 s budget. ~0.1 min of
  // wall time bought all of that. Of the two levers that genuinely move wall
  // time, the PREBUILT BUNDLE is now pulled (see the webServer note below);
  // sharding across runners remains available and untaken, because it changes
  // the required `smoke` check's shape (see .ai/testing.md). This 2-worker pin
  // is unchanged either way: it was never the wrong number, the server was
  // just spending the cores. Worker-safety is proven daily
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
  // WHAT SERVES THE APP is the lever that fixed the starvation flakes.
  //
  // `vite dev` transforms every module on demand, in-process, on the same box
  // as the browsers — and that transform work is what saturated the public
  // runner's 4 vCPU (measured in #778/#790: adding workers made it worse, not
  // better, because the box was already CPU-bound at 2). The cost is not the
  // suite's; it is the server's, and it lands DURING the run, competing with
  // Chromium for the cores the assertions need. That is why six different
  // specs failed as starvation timeouts across ~42h of PR runs — a different
  // one each time, every one green on rerun, none of them broken.
  //
  // `vite build` + `vite preview` moves that work OUT of the run: one build up
  // front (~8s locally, and it is the same bundle the app ships), then a static
  // file server that costs essentially nothing while the tests execute. The
  // contention is removed rather than tolerated — which is why this and not
  // `retries` (which would hide exactly the nondeterminism this suite exists to
  // catch) or a bigger timeout (already doubled; one spec starved past it).
  //
  // MEASURED 2026-08-13 on an 8-core dev box, forced to CI's own settings
  // (`CI=1`: 2 workers, 60 s budget), whole suite, 144 specs, two samples each:
  // dev 2.3m / 2.3m → prebuilt 1.6m / 1.7m. ~28% off the wall clock on a
  // machine that is NOT starved, all 144 green on the built bundle both times.
  // The saving is the transform work leaving the run; the 4-vCPU runner, which
  // IS starved, is where that headroom actually matters.
  // NOT verified here: that this ends the flakes. It cannot be — the failure
  // needs a saturated 4-vCPU box to reproduce, and this machine is not one.
  // What is verified is the mechanism and that the suite passes prebuilt.
  //
  // The bundle is a PRODUCTION build, so `import.meta.env.DEV` is false in it.
  // Nothing the suite needs lives behind that flag: `__dthToast` (__root.tsx)
  // is set for ad-hoc harness use and read by nothing, `__dthHideDevtools`
  // guards devtools a production build never renders, and `updater.ts` returns
  // early in a browser regardless (`!isTauri()`).
  webServer: {
    command: PREBUILT
      ? 'pnpm exec vite build && pnpm exec vite preview --port 4331 --strictPort'
      : 'pnpm exec vite dev --port 4331 --strictPort',
    url: 'http://localhost:4331',
    // Locally this reuses whatever already answers on 4331 — including a
    // stale server from an interrupted run, which then serves the WRONG thing
    // silently. `--strictPort` is the backstop: a second server refuses to
    // start rather than landing on another port nobody is testing.
    reuseExistingServer: !process.env.CI,
    // The build runs inside this budget, so the prebuilt path needs more of it.
    timeout: PREBUILT ? 180_000 : 60_000,
  },
})
