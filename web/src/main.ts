// HOMELINE web app entry point (WS5 owns web/ except src/hud and src/nav, the HUD's navigation helpers).
// WS15 task 4 (A4): the app shell (DESIGN U0, §4) hosts every existing view unchanged in main.outlet.
// ?legacy=1 (or ?legacy=<route name>, in the page query or the hash query) renders the old layout;
// #/styleguide and #/spike (internal pages) also keep the old frame.
import './style.css'
import './ui/tokens.css'
import './ui/fonts/fonts.css'
import './ui/components/components.css'
import './ui/shell/shell.css'
import { DATA_MODE, IS_DEV, dataUrl } from './env'
import { clearUnbacked, onUnbackedChange, unbackedNumbers } from './prov/store'
import { isSpikeHash, isStyleguideHash, parseRoute, redirectFor, type Route } from './router'
import { applyRoute } from './ui/shell/store'
import { buildLegacyFrame, buildShellFrame, frameKindFor, type Frame, type FrameKind } from './ui/shell/frame'
import type { ShellHandle } from './ui/shell/Shell'
import { mountShell } from './ui/shell/Shell'
import { VIEWS } from './views'
import { bootLoading, loadingActive, loadingDone, setLoadProgress, STAGE, whenIntroStarted } from './story/loading'
import { storyParams, storyRequest } from './story/query'
import { ui } from './state/ui'

const app = document.querySelector<HTMLDivElement>('#app')!

// L12 (D111): the inline loading screen (index.html) stays only when the descent intro will play on
// this load: the planning map in the shell frame, no capture / kiosk, no ?intro=0, no reduced motion.
function introExpected(): boolean {
  const hash = redirectFor(location.hash) ?? location.hash
  if (isSpikeHash(hash) || isStyleguideHash(hash) || parseRoute(hash).name !== 'console') return false
  const legacy = frameKindFor(location.search, location.hash) === 'legacy'
  return storyRequest(storyParams(location.search, location.hash), { reduced: ui.reducedMotion.peek(), introSeen: ui.introSeen.peek(), legacy })?.kind === 'intro'
}
const intro = introExpected()
bootLoading(intro)

// L12 (c): intro first. When the intro will play, fetch what it needs before it starts in parallel with
// the app code (the waterfall was: view -> manifest -> map 'load' -> story chunk -> storyboard ->
// tile indexes): the small JSON files as <link rel=preload> (the later fetch() takes them from the
// preload cache), the story code as a lazy chunk. Everything else waits for whenIntroStarted().
if (intro) {
  const files = [
    `${import.meta.env.BASE_URL}story/intro.json`,
    ...['manifest.json', 'scenarios/index.json', 'labels.json', 'fields/index.json', 'terrain_low/tiles.json', 'terrain/tiles.json', 'tiles/basemap/tilejson.json'].map((p) => dataUrl(p, DATA_MODE)),
  ]
  for (const href of files) {
    const l = document.createElement('link')
    l.rel = 'preload'
    l.as = 'fetch'
    l.crossOrigin = 'anonymous' // = fetch()'s default mode for same-origin files, so the preload is reused
    l.href = href
    document.head.append(l)
  }
  void import('./story/attach').catch(() => undefined)
}
document.body.classList.toggle('is-dummy', DATA_MODE === 'dummy')
document.body.classList.toggle('is-dev', IS_DEV)

let frame: Frame | undefined
let shellHandle: ShellHandle | undefined
let liveCleanup: (() => void) | undefined
let stopBadge: (() => void) | undefined

function setFrame(kind: FrameKind): Frame {
  if (frame?.kind === kind) return frame
  shellHandle?.destroy()
  shellHandle = undefined
  liveCleanup?.()
  liveCleanup = undefined
  stopBadge?.()
  stopBadge = undefined
  frame?.root.remove()
  const f = kind === 'shell' ? buildShellFrame(document) : buildLegacyFrame(document)
  app.append(f.root)
  f.banner.hidden = DATA_MODE !== 'dummy'
  if (kind === 'shell') shellHandle = mountShell(f, navigate)

  // Dev-mode check (brief WS5 tests): every displayed number must have a manifest entry.
  if (IS_DEV) {
    const badge = document.createElement('button')
    badge.className = 'prov-badge'
    badge.hidden = true
    badge.title = 'Numbers on this page without a manifest.json entry (click to log them)'
    badge.addEventListener('click', () => console.table(unbackedNumbers()))
    ;(f.slots?.top.querySelector('.hl-topbar__end') ?? f.topbar).append(badge)
    stopBadge = onUnbackedChange(() => {
      const n = unbackedNumbers().length
      badge.hidden = n === 0
      badge.textContent = `${n} number${n === 1 ? '' : 's'} without manifest entry`
    })
  }

  // Live layer (D48, WS13): lazy, only in builds with VITE_LIVE=1; static builds contain no live code.
  // L12 (c): after the intro has started (or when none plays): its health check never delays the intro.
  const topbar = f.topbar
  if (import.meta.env.VITE_LIVE === '1') void whenIntroStarted().then(() => import('./live')).then((m) => {
    if (frame === f) liveCleanup = m.mountLive(topbar)
  })
  frame = f
  return f
}

function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash
}

let cleanup: (() => void) | undefined
let renderSeq = 0
let first = true

async function render(): Promise<void> {
  const seq = ++renderSeq
  const userNav = !first
  first = false
  const spike = isSpikeHash(location.hash)
  const styleguide = !spike && isStyleguideHash(location.hash)
  const internal = spike || styleguide
  let route: Route = parseRoute(location.hash)
  const legacy = frameKindFor(location.search, location.hash) === 'legacy'
  if (!legacy) {
    // DESIGN §4.2: old URLs move to their mode route (replace, so Back skips the old entry).
    const to = redirectFor(location.hash)
    if (to) {
      history.replaceState(history.state, '', to)
      route = parseRoute(to)
    }
  }
  cleanup?.()
  cleanup = undefined
  clearUnbacked()
  const f = setFrame(legacy ? 'legacy' : 'shell')
  const outlet = f.outlet
  outlet.replaceChildren()
  outlet.dataset.route = document.body.dataset.route = spike ? 'spike' : styleguide ? 'styleguide' : route.name
  if (f.nav) for (const a of f.nav.querySelectorAll<HTMLAnchorElement>('a')) a.classList.toggle('active', a.dataset.route === route.name)
  if (!internal) document.body.dataset.mode = applyRoute(route, location.hash)
  shellHandle?.routed(route, location.hash, userNav)
  // L12: navigated away from the planning map before the intro: the loading screen goes
  if (loadingActive() && (internal || legacy || route.name !== 'console')) loadingDone()
  try {
    const view = spike ? (await import('./map/spike/view')).view : styleguide ? (await import('./ui/styleguide/view')).view : await VIEWS[route.name]()
    if (seq !== renderSeq) return
    setLoadProgress(STAGE.view)
    const c = await view(outlet, route)
    setLoadProgress(STAGE.built)
    if (seq !== renderSeq) {
      c?.()
      return
    }
    cleanup = c ?? undefined
  } catch (err) {
    console.error(err)
    loadingDone() // L12: a failed view never keeps the loading screen up
    if (seq !== renderSeq) return
    const box = document.createElement('div')
    box.className = 'page error'
    box.textContent = `This view failed to load: ${err instanceof Error ? err.message : String(err)}`
    outlet.replaceChildren(box)
  }
}

window.addEventListener('hashchange', () => void render())
// DESIGN U6 (M10): ?capture=<id> / ?demo=1 set up story mode (virtual time, route) before the first render.
const storyBoot = /[?&](capture|demo)=/.test(location.search + location.hash) ? import('./story/boot').then((m) => m.boot()) : Promise.resolve()
void storyBoot.catch((e) => console.error(e)).then(() => render())
