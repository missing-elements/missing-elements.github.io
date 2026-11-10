import { defineConfig } from '@playwright/test'

/*
 * The browser tests run against the built site, `_site/`, served the way GitHub Pages serves it:
 * static files, a folder as its index.html. Run `pnpm build` first; `pnpm e2e` then starts the
 * preview server.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/h5p/bundles/index.json',
    reuseExistingServer: !process.env.CI
  }
})
