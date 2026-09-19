import {defineConfig, devices} from '@playwright/test';

/**
 * The storyboard is driven through __d2s.seek(), never by wall clock, so runs
 * are deterministic and screenshots are stable. Workers are pinned to 1 because
 * every test seeks the same shared timeline.
 */
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  reporter: [['list'], ['html', {open: 'never'}]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: {width: 520, height: 1000},
    deviceScaleFactor: 2,
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {
    command: 'python3 -m http.server 4173 --directory out',
    url: 'http://127.0.0.1:4173/storyboard.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  expect: {toHaveScreenshot: {maxDiffPixelRatio: 0.01}},
});
