import { defineConfig } from '@playwright/test'

// Renders every design-system screen and demo and fails on any render error.
// Own port (4334) so it never collides with the smoke (4331) or screenshots (4332) servers.
export default defineConfig({
  testDir: './design-system',
  testMatch: /.*\.check\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4334',
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'Europe/Zurich',
  },
  webServer: {
    command: 'pnpm run design-system',
    url: 'http://localhost:4334',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
