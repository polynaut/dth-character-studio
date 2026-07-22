import { defineConfig } from '@playwright/test'

// Interaction clips (animated WebP) for the guide — same in-memory Tauri fake
// and fixture world as the screenshots, rendered as deterministic frame
// sequences with a fake cursor overlay (see smoke/webp-recorder.ts). Kept out of
// `pnpm smoke` and the screenshot run (own testMatch + port).
//
// Run: pnpm --filter @dth/web clips
// Output: docs/guide/clips/*.webp (see guide.clips.ts).
export default defineConfig({
  testDir: './smoke',
  testMatch: /.*\.clips\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4333',
    viewport: { width: 1280, height: 720 },
    // @1x keeps the clip small; lossless WebP is already pixel-crisp at 1x (no
    // 256-colour banding like the old GIF), so a 2x raster isn't worth the bytes.
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
