// Unit tests of the planning-UI acceptance helpers (package L5). Run: cd web && npm run test:planning:unit
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from '../../vite.config.ts'

const web = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig((env) => {
  const merged = mergeConfig(typeof base === 'function' ? base(env) : base, { root: web })
  merged.test = { ...merged.test, include: ['tests/e2e/**/*.test.ts'], environment: 'node' }
  return merged
})
