#!/usr/bin/env node
// Smoke run of /hud3d in headless Chromium: waits for the scene (or the fallback), lets it play,
// prints state, fps, eye height above the drawn mesh and the loaded MB, and saves a screenshot.
// Usage (from web/, a build served by `npx vite preview`):
//   node src/fp3d/check/smoke.mjs [baseUrl] [screenshot.png] [seconds] [--gpu]
// SwiftShader fps is far below a real GPU: the low-fps fallback is disabled with ?fp3d-probe
// unless --gpu is given.
import { writeFileSync } from 'node:fs'
import { sleep, withChromium } from './cdp.mjs'

const args = process.argv.slice(2).filter((a) => a !== '--gpu')
const gpu = process.argv.includes('--gpu')
const base = args[0] ?? 'http://localhost:4173/'
const shot = args[1] ?? 'fp3d-smoke.png'
const seconds = Number(args[2] ?? 6)
let code = 1
await withChromium(
  async ({ send, evaluate }) => {
    const url = new URL(base)
    if (!gpu) url.search = '?fp3d-probe=1'
    url.hash = '#/hud3d'
    await send('Page.navigate', { url: url.href })
    let state = null
    for (let i = 0; i < 240; i++) {
      state = await evaluate(
        `(() => { const r = document.querySelector('.fp3d'); const f = document.querySelector('.fp3d-fallback'); return f ? 'fallback:' + f.dataset.reason + ':' + f.textContent : r ? r.dataset.state : null })()`,
      )
      if (state === 'running' || String(state).startsWith('fallback')) break
      await sleep(250)
    }
    await sleep(seconds * 1000)
    const info = await evaluate(
      `(() => { const r = document.querySelector('.fp3d'); const t = (s) => document.querySelector(s)?.textContent ?? null; return r ? { state: r.dataset.state, fps: r.dataset.fps, eyeAgl: r.dataset.eyeAgl, ring: r.dataset.ring, meter: t('.fp3d-fps'), caption: t('.fp3d-caption'), label: t('.fp3d-label'), t: t('.fp3d-t') } : { fallback: t('.fp3d-fallback') } })()`,
    )
    console.log(JSON.stringify(info, null, 1))
    const png = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(shot, Buffer.from(png.result.data, 'base64'))
    console.log(`screenshot -> ${shot}`)
    code = info?.state === 'running' ? 0 : 1
  },
  { gpu },
)
process.exit(code)
