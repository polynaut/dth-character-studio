import { defineConfig } from '@playwright/test'

// Documentation screenshots — the real SPA against the same in-memory Tauri fake
// the smoke suite uses (smoke/tauri-mock.ts + fixtures.ts), so the shots show a
// fully-populated app with fixture data (no real Daz install, no personal data)
// and regenerate deterministically when the UI changes. Kept OUT of the smoke
// suite (different testMatch) so `pnpm smoke` / CI never runs it.
//
// Run: pnpm --filter @dth/web screenshots
// Output: docs/guide/screenshots/*.png (see guide.screenshots.ts).
export default defineConfig({
  testDir: './smoke',
  testMatch: /.*\.screenshots\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4332',
    // A realistic 16:9 window (1280×720) — you work on a widescreen and don't
    // see a whole tall page at once. The `shoot()` helper (guide.screenshots.ts)
    // caps every shot at this height and scrolls to the documented feature.
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    // Pin locale + timezone so date strings (toLocaleString etc.) render the
    // same on every machine — together with the frozen clock in prime(), this
    // makes a full regeneration byte-stable across runs AND machines.
    locale: 'en-US',
    timezoneId: 'Europe/Zurich',
  },
  webServer: {
    command: 'pnpm exec vite dev --port 4332 --strictPort',
    url: 'http://localhost:4332',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
