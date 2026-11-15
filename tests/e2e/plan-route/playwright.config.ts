// Plan-port e2e (W0b skeleton): the Plan route-planning flows, on the *built* app (web/dist) served by
// `vite preview`. Build first (cd web && npm run build). Run from web/ (its node_modules has playwright):
//   cd web && NODE_PATH=$PWD/node_modules npx playwright test -c ../tests/e2e/plan-route/playwright.config.ts
// (NODE_PATH: this folder has no node_modules, so playwright/test resolves from web/node_modules.)
// Env: HL_E2E_WEB (web/ dir whose dist to serve; default this checkout's), HL_E2E_PORT (default 4291; the waypoint block's 4200-4299 range), HL_CHROMIUM (system chromium:
// Playwright's bundled browser does not start on NixOS). One worker: the map is software-GL and slow.
import { resolve } from 'node:path'
import { defineConfig } from 'playwright/test'

const PORT = Number(process.env.HL_E2E_PORT ?? 4291)
/** web/ whose dist is served (HL_E2E_WEB: another worktree's web/, e.g. one already built) */
const WEB = process.env.HL_E2E_WEB ?? resolve(__dirname, '../../../web') // loaded as CommonJS (no package.json here)

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  outputDir: '/tmp/hl-port/e2e-results/plan-route',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce', // no L12 intro, no camera flights
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--enable-gpu-compositing'], ...(process.env.HL_CHROMIUM ? { executablePath: process.env.HL_CHROMIUM } : {}) },
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: WEB,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false, // never talk to another agent's server on the same port
    timeout: 30_000,
  },
})
