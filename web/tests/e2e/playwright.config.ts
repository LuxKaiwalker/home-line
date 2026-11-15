// Playwright config for the planning-UI acceptance checks (Notion "Planning UI — declutter and usability
// plan", §6 tests 1–8 and §10.4 part B; package L5, D111). Same browser settings and viewports as the
// visual config (../../playwright.config.ts, D5), but three builds of the app, each served by its own
// `vite preview`:
//   static    VITE_LIVE off                                  (kit rule 4: static first)
//   live      VITE_LIVE=1 VITE_LIVE_MOCK=1 VITE_SIM_EXPORT=1 (API reachable: the contract mock)
//   livedown  VITE_LIVE=1 VITE_API_BASE=http://127.0.0.1:9   (the published build with the API down)
// Build them first: `npm run build:planning` (tests/e2e/build.mjs), then `npm run test:planning`.
// Projects: <build>-<viewport> (no real clicks, parallel) and clicks-<build>-<viewport> for every test
// tagged @clicks: one worker, after all others, one after the other (issue #131, notes/M10d.md: real
// clicks while the map animates time out under parallel load in software GL).
// HL_CHROMIUM=/path/to/chromium where Playwright's bundled browser cannot start (NixOS).
// HL_PLANNING_BUILDS=live,livedown runs a subset of the builds.
import { fileURLToPath } from 'node:url'
import { defineConfig, type Project } from 'playwright/test'
import visual from '../../playwright.config.ts'

const web = fileURLToPath(new URL('../..', import.meta.url))
const BASE_PORT = Number(process.env.HL_PLANNING_PORT ?? 4185)

export type BuildName = 'static' | 'live' | 'livedown'
export const BUILDS: { name: BuildName; dir: string; port: number }[] = [
  { name: 'static', dir: 'dist-static', port: BASE_PORT },
  { name: 'live', dir: 'dist-live', port: BASE_PORT + 1 },
  { name: 'livedown', dir: 'dist-livedown', port: BASE_PORT + 2 },
]
const only = process.env.HL_PLANNING_BUILDS?.split(',').map((s) => s.trim())
const builds = only ? BUILDS.filter((b) => only.includes(b.name)) : BUILDS

const VIEWPORTS: [string, { width: number; height: number }][] = [
  ['1440x900', { width: 1440, height: 900 }],
  ['1024x768', { width: 1024, height: 768 }],
]
const CLICKS = /@clicks/

const plain: Project[] = []
const clicks: Project[] = []
for (const b of builds)
  for (const [vp, viewport] of VIEWPORTS) {
    const use = { ...visual.use, viewport, baseURL: `http://127.0.0.1:${b.port}/` }
    const metadata = { build: b.name }
    plain.push({ name: `${b.name}-${vp}`, use, metadata, grepInvert: CLICKS })
    const prev = clicks[clicks.length - 1]
    clicks.push({
      name: `clicks-${b.name}-${vp}`,
      use,
      metadata,
      grep: CLICKS,
      workers: 1,
      fullyParallel: false,
      dependencies: prev ? [prev.name!] : [],
    })
  }
// the first click project waits for every plain project
if (clicks[0]) clicks[0].dependencies = plain.map((p) => p.name!)

export default defineConfig({
  ...visual,
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: '../../test-results/e2e',
  snapshotPathTemplate: undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-e2e' }]] : 'list',
  projects: [...plain, ...clicks],
  webServer: builds.map((b) => ({
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${b.port} --strictPort --outDir ${b.dir}`,
    url: `http://127.0.0.1:${b.port}/`,
    cwd: web,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  })),
})
