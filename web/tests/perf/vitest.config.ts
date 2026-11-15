// Plan-port perf probe (W0b): fast timing checks of the in-browser route core, run by
// /tmp/hl-port/check.sh step 6. Reuses the app's Vite config (YAML plugin for config/*.yaml).
// Run: cd web && npx vitest run -c tests/perf/vitest.config.ts
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from '../../vite.config.ts'

const web = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig((env) => {
  const merged = mergeConfig(typeof base === 'function' ? base(env) : base, { root: web })
  // Replace (not merge) the include list: only the perf probes, not the app's unit tests.
  merged.test = { ...merged.test, include: ['tests/perf/**/*.perf.test.ts'], environment: 'node', testTimeout: 60_000 }
  return merged
})
