import { defineConfig } from '@playwright/test'

// Interaction GIFs for the guide — same in-memory Tauri fake and fixture world
// as the screenshots, rendered as deterministic frame sequences with a fake
// cursor overlay (see smoke/gif-recorder.ts). Kept out of `pnpm smoke` and the
// screenshot run (own testMatch + port).
//
// Run: pnpm --filter @dth/web gifs
// Output: docs/guide/gifs/*.gif (see guide.gifs.ts).
export default defineConfig({
  testDir: './smoke',
  testMatch: /.*\.gifs\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4333',
    viewport: { width: 1280, height: 720 },
    // @1x on purpose: GIF's 256-color palette gains nothing from a 2x raster,
    // and the files stay a quarter of the size.
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'Europe/Zurich',
  },
  webServer: {
    command: 'pnpm exec vite dev --port 4333 --strictPort',
    url: 'http://localhost:4333',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
