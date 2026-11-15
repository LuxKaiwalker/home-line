# Fallback drill (H2, gate B1′)

Kit rule 4 (static first): the submitted app works fully with the server off; no static view
imports from `web/src/live/`; with `/health` unreachable for 2 s, live controls hide behind the
offline banner.

- Run: 2026-11-15 ~01:00–01:40 local, worktree `hardening-h2` at `19b7ce2` (origin/main).
- Browser: headless system Chromium 157 driven over CDP by the script in the appendix.
  Playwright is not installed in `web/node_modules`, so a small CDP driver was used instead.
- Ports: preview 8090/8092/8094, API 8022, blackhole 8091, CDP 8093. Port 8012 was free all through
  (`ss -ltn | grep 8012` gave nothing). Everything started was stopped at the end.
- Official hash at this HEAD: `c20497ca023aab37`
  (`uv run --no-sync python -c "from server.engine.hashing import official_hash; print(official_hash())"`).

## Result

| Step | What | Result |
|---|---|---|
| 1 | Static build, flag off | **PASS** |
| 2 | Live build, no server | **PASS** |
| 3 | Server up, then killed mid-session | **FAIL**: the banner does not come back until a reload |
| 4 | Official permalink, server down | **PASS** (with one observation, see below) |

Overall: **PARTIAL**. Step 3 fails. Production code was not changed (out of scope for H2).

## Step 1: static build, flag off (published configuration)

```
cd web && npm ci
flock /tmp/hl-heavy.lock npx vite build      # ✓ built in 958ms
ls dist/assets | grep -ci live               # 0  (no live chunk)
grep -l "Live planning is offline" dist/assets/*.js   # nothing: no live text in the bundle
npm test                                     # 57 files passed, 1 skipped; 751 passed, 13 skipped
npx tsc --noEmit                             # OK
```

## Step 2: live build, no server

```
ss -ltn | grep 8012                          # nothing: 8012 free, default base kept
VITE_LIVE=1 flock /tmp/hl-heavy.lock npx vite build --outDir <scratch>/dist-live-8012 --emptyOutDir
#   emits assets/live-*.js (46.6 kB); the bundle contains http://localhost:8012
npx vite preview --outDir <scratch>/dist-live-8012 --port 8090 --strictPort --host 127.0.0.1
node drive.mjs offline http://127.0.0.1:8090
```

Results (connection refused on 8012):
- The banner text is exactly `Live planning is offline · showing precomputed plans`. It is visible,
  with `data-state="offline"`, 123 ms after navigation.
- No live controls are visible (0 of `.live-pad`, `.live-btn`, import inputs, buttons in `live-*`).
- The static console renders. The headline `.headline-value` reads `23%`, and the page shows
  "23% reachable of the assessed flat disc within 30 min. Range 15.2% …".
- `#/trade`, `#/scorecard` and `#/conditions` render, with the banner still offline and no live controls.
- Uncaught exceptions and `console.error` calls: **0**. The only browser log entries are the network
  failures to `localhost:8012` (health, provenance) and `favicon.ico` 404 from vite preview.

Extra variant, a server that accepts the connection but never answers (the 2 s timeout path):
- Setup: a node TCP blackhole on 8091, a build with `VITE_API_BASE=http://localhost:8091`, and a preview on 8092.
- The banner appeared 2227 ms after navigation (`api.health_timeout_s` = 2 s plus page load).
- The static console showed 23% before the banner came up.
- No live controls were visible, and there were 0 uncaught errors.

Supporting unit tests: `npx vitest run src/live/health.test.ts src/live/index.test.ts src/live/isolation.test.ts`
gives 3 files and 16 tests, all passing.

## Step 3: server up, then killed mid-session — FAIL

```
uv sync --frozen        # the fresh worktree had no .venv (gitignored; installs dev+server groups)
HL_SERVER_DATA=/home/vincent/hl-data/server uv run --no-sync uvicorn server.app:app --host 127.0.0.1 --port 8022
curl -s http://127.0.0.1:8022/api/v1/engine/version   # commit 19b7ce226ee0… = HEAD
VITE_LIVE=1 VITE_API_BASE=http://localhost:8022 flock /tmp/hl-heavy.lock npx vite build --outDir <scratch>/dist-live-8022 --emptyOutDir
npx vite preview --outDir <scratch>/dist-live-8022 --port 8094 --strictPort --host 127.0.0.1
NOSEC=1 OFFICIAL_HASH=c20497ca023aab37 node drive.mjs kill http://127.0.0.1:8094 "kill <uvicorn pid>"
```

CORS note: the preview origin `http://127.0.0.1:8094` is not in `api.cors_origins` (only Pages, the custom
domain and `http://localhost:5173`). A control run without the bypass got the console error
"blocked by CORS policy: No 'Access-Control-Allow-Origin' header". The app showed the offline banner and the
static console, so it fails safe. To exercise the live state from a port in the 8020–8099 range, the drill browser
ran with `--disable-web-security` (`NOSEC=1`). This flag affects only the test browser; the app and the server were unchanged.

Before the kill:
- 139 ms after load the state was `ready`, with the banner hidden.
- The pad tool (`.live-pad`) was visible and the console showed 23%.
- The official permalink rendered with the server up: "Precomputed · official plan · provenance of plan
  c20497ca023aab37", 23%, range 15.2% to 28.7%, route Pad S7 S6 S1 S4 Pad, total 325.94 min.

After `kill <pid>` (uvicorn shut down cleanly):
- **No offline banner for 60 s.** The poll ran every 250 ms. `data-state` stayed `ready`, the banner stayed
  hidden, and the pad tool stayed visible. A second run with the official hash waited 10 s and saw the same.
- Static views kept working: `#/trade`, `#/scorecard` and `#/` rendered, and the console still showed 23%.
- A page reload brought the banner back 143–176 ms later: the live controls hid and 23% was still rendered.
- Uncaught errors: **0**.

Cause: `web/src/live/health.ts` `watchHealth` checks once and re-checks only while `warming`. Its doc
comment says it "stops at 'ready' or 'offline' (a page reload checks again)". Nothing re-checks
`/health` once the state is `ready`, so a server that dies mid-session leaves live controls visible.
The first live request after that fails (the pad tool shows its own failed state) instead of the banner coming back.
Rule 4 asks that the controls hide when `/health` has been unreachable for 2 s.

Suggested fix for the WS13 owner (not done here; H2 may not change production code):
- Keep polling `/health` while `ready`, for example every `CLIENT.warmPollMs` (3 s) or a new
  `web_live.health_poll_s` in backend.yaml.
- Possibly also drop to `offline` on any transient `ApiError` (status 0 or timeout) from a live request.
- Then add a vitest case to `health.test.ts`: ready → health fails → `offline` within poll + 2 s.

## Step 4: official permalink with the server down — PASS

Test: `node drive.mjs offline http://127.0.0.1:8090` (no server on 8012), with `OFFICIAL_HASH=c20497ca023aab37`.
- Opening `#/plan/c20497ca023aab37` as a fresh load showed `.live-offline` after 106 ms: "Live planning is
  offline · showing precomputed plans. This plan needs the live server. Back to the plan."
  The h1 reads "Plan c20497ca023aab37".
- Opening it with an in-app hash change from `#/` gave the same result after 111 ms.
- Uncaught errors: 0. No crash.

Observations, not failures:
- With a server that hangs instead of refusing (the 8091 blackhole), the permalink stays on "Loading…"
  until the 15 s client request timeout (`CLIENT.requestTimeoutMs`), then shows the same offline text.
  It does not wait for the 2 s health result.
- After the step-3 kill, without a reload, an official permalink that was already opened in the session
  still renders from the in-session cache (planmount keeps found results). It shows no offline text, and the
  "Play this plan" and Export controls remain.
- As U3 noted, the app router renders its "Not found" page in the hidden `.outlet` on `#/plan/…` routes.

## Cleanup

All of these were stopped, and afterwards `ss -ltn` showed nothing on 8012, 8022 or 8090–8094:
- the previews on 8090, 8092 and 8094
- the API on 8022, killed by the drill
- the blackhole on 8091, which exits by itself
- the CDP Chromium instances, killed by the driver on exit

## Appendix: drive.mjs (CDP driver, node ≥ 22, system `chromium`)

Usage: `[NOSEC=1] [OFFICIAL_HASH=…] [KILL_WAIT_MS=60000] SCRATCH=<dir> node drive.mjs offline|kill <base> [killCmd]`

```js
// H2 fallback drill driver: headless system Chromium over CDP (Playwright is not installed).
// usage: node drive.mjs <mode> <baseUrl> [killCmd]
//   mode = offline  : load the app with no API, time the banner, check controls + 23 %, permalink offline
//   mode = kill     : load with API up, wait for ready, run killCmd, poll for the banner, check static views
// env: NOSEC=1 adds --disable-web-security (CORS bypass; see the drill doc)
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [mode, base, killCmd] = process.argv.slice(2)
const OFFICIAL = process.env.OFFICIAL_HASH ?? 'c20497ca023aab37' // official_hash() at 19b7ce2
const CDP_PORT = 8093
const prof = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), 'prof-'))
const args = ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${prof}`, '--no-first-run',
  '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900']
if (process.env.NOSEC === '1') args.push('--disable-web-security')
try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); console.error(`port ${CDP_PORT} busy: a browser is already there`); process.exit(3) } catch {}
const chrome = spawn('chromium', [...args, 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill('SIGKILL') } catch {} })
process.on('uncaughtException', (e) => { console.error(e); process.exit(1) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(`[${((performance.now()) / 1000).toFixed(2)}s]`, ...a)

let page
for (let i = 0; i < 50 && !page; i++) {
  await sleep(200)
  try { page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
}
if (!page) { console.error('no CDP page'); chrome.kill(); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const errors = []
const consoleAll = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push('UNCAUGHT ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text))
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = `${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`
    consoleAll.push(t)
    if (m.params.type === 'error') errors.push('console.' + t)
  }
  if (m.method === 'Log.entryAdded') consoleAll.push(`log.${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`)
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable')
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (r.result?.exceptionDetails || r.error) { if (process.env.DEBUG) console.error('eval failed', JSON.stringify(r).slice(0, 400)); return undefined }
  return r.result?.result?.value
}

const PROBE = `JSON.stringify((() => {
  const l = document.querySelector('.live-status')
  const vis = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length))
  const liveCtl = [...document.querySelectorAll('.live-pad, .live-btn, .live-import, input[type=file], [class*="live-"] button')].filter(vis).length
  const txt = document.body.innerText
  return {
    banner: l ? { hidden: l.hidden, visible: vis(l), state: l.dataset.state, text: l.textContent } : null,
    liveControlsVisible: liveCtl,
    has23: /(^|\\D)23\\s*%/.test(txt),
    headline: document.querySelector('.headline-value')?.innerText ?? null,
    route: document.body.dataset.route ?? null,
    planOffline: document.querySelector('.live-offline')?.innerText ?? null,
    planNotFound: document.querySelector('.live-notfound')?.innerText ?? null,
    planH1: document.querySelector('.live-plan h1, .live-plan-page h1')?.innerText ?? null,
    outletText: (document.querySelector('.outlet')?.innerText ?? '').slice(0, 80).replace(/\\n/g, ' | '),
  }
})())`
const probe = async () => { const v = await ev(PROBE); return v ? JSON.parse(v) : { banner: null, liveControlsVisible: -1, has23: false, outletText: '(no document)' } }
const navigate = async (url) => { await send('Page.navigate', { url }); }
async function waitFor(pred, ms, step = 100) {
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    const p = await probe()
    if (pred(p)) return { ms: Math.round(performance.now() - t0), p }
    await sleep(step)
  }
  return { ms: null, p: await probe() }
}
const isOffline = (p) => p.banner && !p.banner.hidden && p.banner.state === 'offline'

try {
  if (mode === 'offline') {
    await navigate(base + '/#/')
    const b = await waitFor(isOffline, 10000)
    log('banner offline after ms:', b.ms, JSON.stringify(b.p))
    const c = await waitFor((p) => p.has23, 15000)
    log('23 % present after ms:', c.ms, JSON.stringify(c.p))
    await sleep(1500)
    log('settled:', JSON.stringify(await probe()))
    for (const h of ['#/trade', '#/scorecard', '#/conditions']) {
      await ev(`location.hash = '${h}'`); await sleep(1500)
      const p = await probe(); log(h, JSON.stringify({ route: p.route, banner: p.banner?.state, liveCtl: p.liveControlsVisible, outlet: p.outletText }))
    }
    await navigate(base + '/#/plan/' + OFFICIAL)
    const pl = await waitFor((p) => p.planOffline || p.planNotFound, 20000)
    log('permalink (fresh load) after ms:', pl.ms, JSON.stringify(pl.p))
    await navigate(base + '/#/'); await sleep(1500)
    await ev(`location.hash = '#/plan/${OFFICIAL}'`)
    const pl2 = await waitFor((p) => p.planOffline || p.planNotFound, 20000)
    log('permalink (in-app hash change) after ms:', pl2.ms, JSON.stringify(pl2.p))
  } else if (mode === 'kill') {
    await navigate(base + '/#/')
    const r = await waitFor((p) => p.banner && p.banner.state === 'ready', 10000)
    log('ready after ms:', r.ms, JSON.stringify(r.p))
    const c = await waitFor((p) => p.has23 && p.liveControlsVisible > 0, 15000)
    log('23 % + live controls:', c.ms, JSON.stringify(c.p))
    await ev(`location.hash = '#/plan/${OFFICIAL}'`)
    const pl = await waitFor((p) => p.planH1 && !/Loading/.test(p.outletText), 8000)
    await sleep(2000)
    log('permalink with server up:', JSON.stringify(await probe()))
    log('  plan section text:', JSON.stringify((await ev(`document.querySelector('.live-plan')?.innerText ?? null`))?.slice(0, 500)))
    await ev(`location.hash = '#/'`); await sleep(2000)
    log('KILL:', killCmd); execSync(killCmd, { stdio: 'inherit' })
    const k = await waitFor(isOffline, Number(process.env.KILL_WAIT_MS ?? 60000), 250)
    log('banner after kill (no reload), ms:', k.ms, JSON.stringify(k.p))
    for (const h of ['#/trade', '#/scorecard', '#/']) {
      await ev(`location.hash = '${h}'`); await sleep(1500)
      const p = await probe(); log('after kill', h, JSON.stringify({ route: p.route, banner: p.banner?.state, liveCtl: p.liveControlsVisible, has23: p.has23, outlet: p.outletText }))
    }
    await ev(`location.hash = '#/plan/${OFFICIAL}'`)
    const pl2 = await waitFor((p) => p.planOffline || p.planNotFound, 20000)
    log('permalink after kill (no reload) ms:', pl2.ms, JSON.stringify(pl2.p))
    await ev(`history.replaceState(null, '', '#/')`); await send('Page.reload', { ignoreCache: false })
    const k2 = await waitFor(isOffline, 10000)
    log('banner after reload, ms:', k2.ms, JSON.stringify(k2.p))
    const c2 = await waitFor((p) => p.has23, 15000)
    log('23 % after reload:', c2.ms, 'liveCtl', c2.p.liveControlsVisible)
  }
  log('ERRORS (uncaught + console.error):', errors.length); for (const e of errors) log('  ', e)
  log('console/log entries:', consoleAll.length); for (const e of consoleAll.slice(0, 40)) log('  ', e.slice(0, 300))
} finally {
  ws.close(); chrome.kill('SIGTERM'); await sleep(500); try { chrome.kill('SIGKILL') } catch {}
}
```
