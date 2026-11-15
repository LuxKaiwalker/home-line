// WP11 check 4 (section 10.7, D115): health and fallback drill on the PUBLISHED site.
// Based on the H2 driver (docs/hardening/fallback-drill.md, appendix), with one difference: this
// script never stops the API itself. The hosting session stops and restarts the prod service
// (homeline-backend); this script watches the public /health from Node every WATCH_MS and times the
// page against the moment the API was seen down and up again.
//
// usage: node docs/hardening/published-drill.mjs smoke|drill [siteBase]
//   smoke : API up: ready + live controls, static views, official permalink. Changes nothing.
//   drill : smoke, then waits (DOWN_WAIT_MS) for the API to go down, times the offline banner and
//           the hidden live controls, checks the static views and the permalink while it is down,
//           then waits (UP_WAIT_MS) for it to come back and times the live controls' return,
//           all in ONE document (no reload: the page 'load' event must fire exactly once).
// env: PW=<path to web/node_modules/playwright/index.mjs> (required), CHROMIUM (default `chromium`
//      on PATH; Playwright's bundled browser does not start on NixOS), API (default
//      https://homeline-api.vxliu.com/api/v1), OFFICIAL_HASH (default 016355600dbe194c, the official
//      hash of the prod identity, checked with GET /results/{hash}/provenance), WATCH_MS (200),
//      DOWN_WAIT_MS (900000), UP_WAIT_MS (900000), BANNER_LIMIT_MS (3000), OUT (summary JSON path)
// exit 0 = every criterion passed.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const { chromium } = await import(process.env.PW)
const [mode = 'smoke', base = 'https://homeline.vxliu.com'] = process.argv.slice(2)
const API = process.env.API ?? 'https://homeline-api.vxliu.com/api/v1'
const OFFICIAL = process.env.OFFICIAL_HASH ?? '016355600dbe194c'
const WATCH_MS = Number(process.env.WATCH_MS ?? 200)
const DOWN_WAIT_MS = Number(process.env.DOWN_WAIT_MS ?? 900000)
const UP_WAIT_MS = Number(process.env.UP_WAIT_MS ?? 900000)
const BANNER_LIMIT_MS = Number(process.env.BANNER_LIMIT_MS ?? 3000)
const exe = process.env.CHROMIUM ?? execSync('command -v chromium').toString().trim()

const T0 = performance.now()
const now = () => performance.now() - T0
const stamp = () => `[${(now() / 1000).toFixed(2)}s ${new Date().toISOString().slice(11, 23)}Z]`
const log = (...a) => console.log(stamp(), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const result = { mode, base, api: API, official: OFFICIAL, started: new Date().toISOString(), checks: {}, timings: {}, notes: [] }
const check = (name, ok, detail) => { result.checks[name] = { ok: !!ok, detail }; log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail ?? '')) }

// --- API watcher: the public /health as a visitor sees it (2 s timeout = api.health_timeout_s)
const watch = { up: null, transitions: [] }
let watching = true
;(async () => {
  while (watching) {
    const t = now()
    let up = false
    try {
      const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000), headers: { Origin: base } })
      up = r.ok && (await r.json()).ok === true
    } catch { up = false }
    if (up !== watch.up) { watch.transitions.push({ t, up }); log('API watcher:', up ? 'UP' : 'DOWN') }
    watch.up = up
    await sleep(Math.max(0, WATCH_MS - (now() - t)))
  }
})()
const waitApi = async (up, ms) => {
  const t0 = now()
  while (now() - t0 < ms) {
    const tr = watch.transitions.findLast((x) => x.up === up)
    if (watch.up === up && tr) return tr.t
    await sleep(50)
  }
  return null
}

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
let loads = 0
page.on('load', () => { loads++ })
page.on('pageerror', (e) => errors.push(`${stamp()} UNCAUGHT ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(`${stamp()} console.error ${m.text().split('\n')[0]}`) })

const probe = () => page.evaluate(() => {
  const l = document.querySelector('.live-status')
  const vis = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length))
  const liveCtl = [...document.querySelectorAll('.live-pad, .live-btn, .live-import, input[type=file], [class*="live-"] button, [class*="live-"] a[download]')].filter(vis).length
  const txt = document.body?.innerText ?? ''
  const plan = document.querySelector('.live-plan')
  return {
    banner: l ? { hidden: l.hidden, visible: vis(l), state: l.dataset.state, text: l.textContent } : null,
    liveControlsVisible: liveCtl,
    has23: /(^|\D)23\s*%/.test(txt),
    route: document.body?.dataset.route ?? null,
    planOffline: vis(plan) ? (plan.querySelector('.live-offline')?.innerText ?? null) : null,
    planText: vis(plan) ? plan.innerText.replace(/\n+/g, ' | ').slice(0, 220) : null,
    outlet: (document.querySelector('.outlet')?.innerText ?? '').replace(/\n+/g, ' | ').slice(0, 90),
  }
}).catch(() => ({ banner: null, liveControlsVisible: -1, has23: false }))
async function waitFor(pred, ms, step = 100) {
  const t0 = now()
  while (now() - t0 < ms) {
    const p = await probe()
    if (pred(p)) return { at: now(), ms: Math.round(now() - t0), p }
    await sleep(step)
  }
  return { at: null, ms: null, p: await probe() }
}
const isOffline = (p) => p.banner && !p.banner.hidden && p.banner.visible && p.banner.state === 'offline'
const isLive = (p) => p.banner?.state === 'ready' && p.liveControlsVisible > 0
const hash = (h) => page.evaluate((h) => { location.hash = h }, h)
async function staticViews(tag) {
  const out = {}
  for (const h of ['#/trade', '#/scorecard', '#/conditions', '#/about', '#/']) {
    await hash(h); await sleep(1500)
    const p = await probe()
    out[h] = { route: p.route, banner: p.banner?.state ?? null, liveCtl: p.liveControlsVisible, has23: p.has23, outlet: p.outlet }
    log(tag, h, JSON.stringify(out[h]))
  }
  return out
}

let exit = 1
try {
  // --- phase 0: API up
  await page.goto(base + '/#/')
  const r = await waitFor((p) => isLive(p) && p.has23, 20000)
  check('up: console ready with live controls and 23 %', r.ms !== null, { ms: r.ms, probe: r.p })
  await hash('#/plan/' + OFFICIAL)
  const pu = await waitFor((p) => p.planText && /Precomputed/.test(p.planText), 15000)
  check('up: official permalink renders', pu.ms !== null, { ms: pu.ms, plan: pu.p.planText })
  result.timings.up_views = await staticViews('up')
  await hash('#/')
  await waitFor((p) => p.route === 'console' && isLive(p) && p.has23, 15000)

  if (mode === 'drill') {
    // --- phase 1: the hosting session stops the API
    log(`READY FOR STOP: waiting up to ${DOWN_WAIT_MS / 1000} s for the API to go down`)
    const tDown = await waitApi(false, DOWN_WAIT_MS)
    check('API seen down by the watcher', tDown !== null, { at_s: tDown && +(tDown / 1000).toFixed(2) })
    if (tDown !== null) {
      const k = await waitFor((p) => isOffline(p) && p.liveControlsVisible === 0, 20000, 50)
      const ms = k.at === null ? null : Math.round(k.at - tDown)
      result.timings.banner_after_down_ms = ms
      check(`down: offline banner + live controls hidden within ${BANNER_LIMIT_MS} ms`, ms !== null && ms <= BANNER_LIMIT_MS, { ms, probe: k.p })
      const views = await staticViews('down')
      result.timings.down_views = views
      const okViews = Object.values(views).every((v) => v.banner === 'offline' && v.liveCtl === 0 && v.route)
      check('down: static views render, banner offline, 0 live controls', okViews && views['#/'].has23, views)
      await hash('#/plan/' + OFFICIAL)
      const pk = await waitFor((p) => p.planOffline, 10000)
      check('down: official permalink shows the offline text', pk.ms !== null, { ms: pk.ms, text: pk.p.planOffline })
      await hash('#/')
      await waitFor((p) => p.route === 'console' && p.has23, 10000)

      // --- phase 2: the hosting session starts the API again
      log(`READY FOR START: waiting up to ${UP_WAIT_MS / 1000} s for the API to come back`)
      const tUp = await waitApi(true, UP_WAIT_MS)
      check('API seen up again by the watcher', tUp !== null, { at_s: tUp && +(tUp / 1000).toFixed(2), down_for_s: tUp && +((tUp - tDown) / 1000).toFixed(1) })
      if (tUp !== null) {
        const rv = await waitFor((p) => isLive(p), 60000, 100)
        const rms = rv.at === null ? null : Math.round(rv.at - tUp)
        result.timings.live_after_up_ms = rms
        check('up again: live controls return without reload', rms !== null && loads === 1, { ms: rms, loads, probe: rv.p })
        await hash('#/plan/' + OFFICIAL)
        const pr = await waitFor((p) => p.planText && /Precomputed/.test(p.planText), 15000)
        check('up again: official permalink renders', pr.ms !== null, { ms: pr.ms })
      }
    }
  }
  check('no reload during the run (one load event)', loads === 1, { loads })
  check('no uncaught error or console.error (network failures excluded)', errors.length === 0, errors)
  exit = Object.values(result.checks).every((c) => c.ok) ? 0 : 1
} finally {
  watching = false
  result.watch = watch.transitions.map((x) => ({ t_s: +(x.t / 1000).toFixed(2), up: x.up }))
  result.finished = new Date().toISOString()
  result.result = exit === 0 ? 'PASS' : 'FAIL'
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(result, null, 1))
  log('RESULT:', result.result)
  await browser.close()
}
process.exit(exit)
