// Builds the three app variants the planning-UI acceptance checks run on (tests/e2e/playwright.config.ts):
//   dist-static    VITE_LIVE off
//   dist-live      VITE_LIVE=1 VITE_LIVE_MOCK=1 VITE_SIM_EXPORT=1   (API reachable through the contract mock)
//   dist-livedown  VITE_LIVE=1 VITE_API_BASE=http://127.0.0.1:9      (nothing listens on port 9: API unreachable)
// Usage (from web/): node tests/e2e/build.mjs [static,live,livedown]
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../..', import.meta.url))
const OFF = { VITE_LIVE: '', VITE_LIVE_MOCK: '', VITE_SIM_EXPORT: '', VITE_API_BASE: '' }
const VARIANTS = {
  static: { dir: 'dist-static', env: {} },
  live: { dir: 'dist-live', env: { VITE_LIVE: '1', VITE_LIVE_MOCK: '1', VITE_SIM_EXPORT: '1' } },
  livedown: { dir: 'dist-livedown', env: { VITE_LIVE: '1', VITE_API_BASE: 'http://127.0.0.1:9' } },
}
const want = (process.argv[2] ?? Object.keys(VARIANTS).join(',')).split(',')
for (const name of want) {
  const v = VARIANTS[name]
  if (!v) throw new Error(`unknown variant ${name} (static, live, livedown)`)
  console.log(`build ${name} -> ${v.dir}`)
  const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', v.dir, '--emptyOutDir'], {
    cwd: web,
    stdio: 'inherit',
    env: { ...process.env, ...OFF, ...v.env },
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
