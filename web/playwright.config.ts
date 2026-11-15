// Playwright config for the visual-regression screenshots (DESIGN §9 "Visual regression", kit R7, D5).
// Runs against the *built* app (web/dist) served by `vite preview`; build first (`npm run build`).
// Only 2D views and /styleguide are judged (R7: headless WebGL is software-rendered); map canvases are
// masked. Baselines live in tests/visual/__screenshots__/ and must be produced on CI (ubuntu-latest,
// Playwright's bundled Chromium): see the header of tests/visual/screens.spec.ts.
// Run: npm run test:visual   (HL_CHROMIUM=/path/to/chromium where the bundled one cannot start, e.g. NixOS)
import { defineConfig } from 'playwright/test'

const PORT = Number(process.env.HL_VISUAL_PORT ?? 4179)

export default defineConfig({
  testDir: './tests/visual',
  outputDir: './test-results/visual',
  // One fixed name per screen and viewport, no platform suffix: CI (linux) is the only reference.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}{ext}',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  // Never write a baseline implicitly: a missing baseline is handled by the spec (saved for upload).
  updateSnapshots: 'none',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: 0.2, // per-pixel colour distance (0..1), absorbs anti-aliasing noise
      maxDiffPixelRatio: 0.002, // at most 0.2 % of the pixels may differ
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    launchOptions: process.env.HL_CHROMIUM ? { executablePath: process.env.HL_CHROMIUM } : {},
  },
  projects: [
    { name: '1440x900', use: { viewport: { width: 1440, height: 900 } } },
    { name: '1024x768', use: { viewport: { width: 1024, height: 768 } } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
