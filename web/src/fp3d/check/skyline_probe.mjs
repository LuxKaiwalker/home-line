#!/usr/bin/env node
// SPEC F20 acceptance in a real browser: "the rendered skyline at each station within 0.5 deg of
// the computed horizon". Loads /hud3d with ?fp3d-probe, asks the running view to draw the scene
// white-on-black from each station at eye height (view.ts probeSkyline: GPU render + readPixels,
// curvature shader and ring included), and compares every pixel column's skyline with the
// reference horizons (WS3 engine).
//
// Usage (from web/, a build served by `npx vite preview`):
//   node src/fp3d/check/skyline_probe.mjs [baseUrl] [checkJson]
//   baseUrl   default http://localhost:4173/
//   checkJson default src/fp3d/testdata/skyline_check.dummy.json (dummy build); for real data
//             pass a file holding fp3d/index.json "skyline_check" (or the index itself).
// Needs Chromium (CHROMIUM env, default `chromium`); SwiftShader is fine. Exit 1 on failure.
import { readFileSync } from 'node:fs'
import { sleep, withChromium } from './cdp.mjs'

const base = process.argv[2] ?? 'http://localhost:4173/'
const checkPath = process.argv[3] ?? new URL('../testdata/skyline_check.dummy.json', import.meta.url).pathname
let check = JSON.parse(readFileSync(checkPath, 'utf8'))
if (check.skyline_check) check = check.skyline_check

let code = 1
await withChromium(async ({ send, evaluate }) => {
  const url = new URL(base)
  url.search = '?fp3d-probe=1'
  url.hash = '#/hud3d'
  await send('Page.navigate', { url: url.href })
  for (let i = 0; i < 120; i++) {
    if (await evaluate('typeof window.__fp3dProbe === "function"')) break
    await sleep(250)
  }
  if (!(await evaluate('typeof window.__fp3dProbe === "function"'))) throw new Error('3D view did not start (fallback?)')

  const tol = check.tolerance_deg
  const step = check.az_step_deg
  let ok = true
  for (const st of check.stations) {
    const res = await evaluate(`JSON.stringify(window.__fp3dProbe(${st.x_m}, ${st.y_m}))`)
    const { azDeg, elDeg } = JSON.parse(res)
    // nearest rendered column to each reference azimuth
    let worst = 0
    let worstAz = null
    let n = 0
    let sum = 0
    let missing = 0
    st.elevation_deg.forEach((ref, k) => {
      if (ref === null) return
      const az = k * step
      let best = -1
      let bd = Infinity
      for (let q = 0; q < azDeg.length; q++) {
        let d = Math.abs(azDeg[q] - az)
        if (d > 180) d = 360 - d
        if (d < bd) {
          bd = d
          best = q
        }
      }
      if (best < 0 || bd > 0.2) {
        missing++
        return
      }
      const e = Math.abs(elDeg[best] - ref)
      n++
      sum += e
      if (e > worst) {
        worst = e
        worstAz = az
      }
    })
    const pass = n > 0 && missing === 0 && worst <= tol
    ok &&= pass
    console.log(
      `${pass ? 'PASS' : 'FAIL'} ${st.id}: ${n} azimuths, ${azDeg.length} pixel columns, max |d| ${worst.toFixed(3)} deg at az ${worstAz}, mean ${(sum / Math.max(1, n)).toFixed(3)} deg${missing ? `, ${missing} azimuths without a skyline column` : ''}`,
    )
  }
  console.log(`F20 rendered-skyline check (GPU), tolerance ${tol} deg: ${ok ? 'PASS' : 'FAIL'}`)
  code = ok ? 0 : 1
})
process.exit(code)
