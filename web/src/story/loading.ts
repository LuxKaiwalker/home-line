// WS16 L12 (D111): the intro loading screen. Its markup is inline in web/index.html and its style
// (story/loading.css, linked there) is in the render-blocking stylesheet, so it is on screen with the
// first paint, before any JS. This module, loaded with the entry chunk, takes it over:
//   - decides at boot whether the descent intro will play (introExpected); if not, removes it at once,
//     so every other load (reduced motion, ?intro=0, capture, kiosk, legacy, other routes) is unchanged;
//   - a progress bar driven by the real loads the intro needs (app code, view, map, storyboard, the
//     warm-up's terrain / field / tiles; setLoadProgress is monotonic, never a timer);
//   - 'Skip intro' (a plain link to ?intro=0 before JS, a skip after) and Esc skip the intro, from the
//     loading screen and from the playing intro (RR1);
//   - 'Full screen' and the F key toggle the browser Fullscreen API (optional for the viewer); neither
//     counts as the "any input skips" input of the intro (attach.ts), and F does not reach the shell's
//     focus-mode shortcut while the intro owns the screen;
//   - after intro.still_loading_s a short 'Still loading…' note;
//   - phase 'playing' (the clock started): the screen fades out into the intro, the two buttons stay;
//     done (intro over, revealed, skipped or failed): removed.
// html[data-hl-intro] = 'loading' | 'playing' while it is on (tests, measurements, CSS).
import designRaw from '../../../config/design.yaml'

export type LoadPhase = 'loading' | 'playing'

/** intro.still_loading_s (assumed, L12). Read here, not through ../config, which would pull every
 *  config file into the entry chunk; a missing key throws at import time like cfg(). */
export const STILL_LOADING_S: number = (() => {
  const v = (designRaw as { intro?: { still_loading_s?: unknown } }).intro?.still_loading_s
  if (typeof v !== 'number') throw new Error('config value missing: intro.still_loading_s')
  return v
})()

/**
 * Where each real load the intro needs puts the bar (fractions of the whole): the app code runs, the
 * planning view and its map are built, the map style is loaded (story code and storyboard follow),
 * the director is ready (warm-up starts), the warm-up (tiles fetched, terrain and field drawn under
 * the cover) is done and frame 0 loads; 1 when the clock starts.
 */
export const STAGE = { app: 0.1, view: 0.2, built: 0.3, map: 0.4, warm: 0.5, frame0: 0.95 } as const

const ROOT_ID = 'hl-loading'
/** elements whose input never skips the intro (the intro's own controls) */
export const KEEP_ATTR = 'data-hl-intro-keep'

let progress = 0
let skipped = false
let doneCalled = false
const skipListeners = new Set<() => void>()
let teardown: (() => void) | null = null
let started: (() => void) | null = null
let startedP: Promise<void> = new Promise((r) => (started = r))

const root = (): HTMLElement | null => (typeof document === 'undefined' || typeof document.getElementById !== 'function' ? null : document.getElementById(ROOT_ID))
/** <html>'s dataset (undefined outside a browser, e.g. the stage tests' minimal document) */
const htmlData = (): DOMStringMap | undefined => (typeof document === 'undefined' ? undefined : document.documentElement?.dataset)

/** The loading screen (or the intro it fades into) is on screen. */
export function loadingActive(): boolean {
  return !doneCalled && root() !== null
}

/** True once the viewer skipped the intro from the loading screen or its Skip button. */
export function introSkipRequested(): boolean {
  return skipped
}

/** Run `f` when the viewer skips (at once if already skipped); returns an unsubscribe. */
export function onIntroSkip(f: () => void): () => void {
  if (skipped) {
    f()
    return () => undefined
  }
  skipListeners.add(f)
  return () => skipListeners.delete(f)
}

/**
 * Resolves once the intro has started (its clock runs), or when there is no intro / it was skipped:
 * the moment the loads the intro does not need may begin (L12 c: live layer, edit code).
 */
export function whenIntroStarted(): Promise<void> {
  if (!loadingActive() || htmlData()?.hlIntro === 'playing') return Promise.resolve()
  return startedP
}

/** Progress of the real loads the intro needs, 0..1; only ever moves forward. */
export function setLoadProgress(p: number): void {
  const v = Math.max(0, Math.min(1, p))
  if (v <= progress) return
  progress = v
  const el = root()
  if (!el) return
  el.style.setProperty('--hl-load-p', String(v))
  el.querySelector('[role=progressbar]')?.setAttribute('aria-valuenow', String(Math.round(v * 100)))
}

export function loadProgress(): number {
  return progress
}

/** The intro clock started: the screen fades into the intro (the two buttons stay until done). */
export function introPlaying(): void {
  if (doneCalled) return
  setLoadProgress(1)
  const el = root()
  if (el) el.querySelector('[role=progressbar]')?.setAttribute('aria-busy', 'false')
  const d = htmlData()
  if (d) d.hlIntro = 'playing'
  started?.()
}

/** Intro over, revealed, skipped or never playing: remove the screen and its listeners. */
export function loadingDone(): void {
  if (doneCalled) return
  doneCalled = true
  teardown?.()
  teardown = null
  root()?.remove()
  const d = htmlData()
  if (d) delete d.hlIntro
  started?.()
}

/** The viewer asked to skip: tell the story (attach.ts) and remove the screen. */
export function skipIntro(): void {
  if (!skipped) {
    skipped = true
    for (const f of [...skipListeners]) f()
    skipListeners.clear()
  }
  loadingDone()
}

/** F without modifiers, outside text fields: the Full screen key while the intro owns the screen. */
export function isFullscreenKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>): boolean {
  if (e.key !== 'f' && e.key !== 'F') return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  const t = e.target as { closest?: (s: string) => unknown; isContentEditable?: boolean } | null
  return !(t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable=true]') || t?.isContentEditable)
}

/** An input event the intro must not treat as "any input skips" (its own controls, the F key). */
export function keepsIntro(e: Event): boolean {
  if (!loadingActive()) return false
  if (e.type === 'keydown') return isFullscreenKey(e as KeyboardEvent)
  const t = e.target as { closest?: (s: string) => unknown } | null
  return !!t?.closest?.(`[${KEEP_ATTR}]`)
}

function toggleFullscreen(): void {
  const d = document
  if (d.fullscreenElement) void d.exitFullscreen?.().catch(() => undefined)
  else void d.documentElement.requestFullscreen?.().catch(() => undefined) // optional: a refusal is fine
}

/**
 * Take over the inline loading screen. `expected`: the descent intro will play on this load; when
 * false the screen is removed at once (the page loads exactly as before L12).
 */
export function bootLoading(expected: boolean): void {
  const el = root()
  if (!el) return
  if (!expected) return loadingDone()
  const html = document.documentElement
  html.dataset.hlIntro = 'loading'
  setLoadProgress(STAGE.app)
  const fsBtn = el.querySelector<HTMLButtonElement>('[data-hl-act=fullscreen]')
  const skipBtn = el.querySelector<HTMLElement>('[data-hl-act=skip]')
  const still = el.querySelector<HTMLElement>('.hl-loading__still')
  if (fsBtn && document.fullscreenEnabled) fsBtn.hidden = false
  const syncFs = (): void => {
    if (fsBtn) fsBtn.setAttribute('aria-pressed', String(!!document.fullscreenElement))
  }
  syncFs()
  const onSkipClick = (e: Event): void => {
    e.preventDefault() // without JS the link reloads with ?intro=0
    skipIntro()
  }
  const onFsClick = (): void => toggleFullscreen()
  // capture phase on window, registered before any story listener: the intro's own controls and the F key
  // stop here, so attach.ts never sees them as "any input" and the shell never sees F (focus mode)
  const guard = (e: Event): void => {
    if (!keepsIntro(e)) return
    e.stopImmediatePropagation()
    if (e.type === 'keydown') {
      e.preventDefault()
      if (!(e as KeyboardEvent).repeat) toggleFullscreen()
    }
  }
  // Esc skips from the loading screen and from the playing intro (RR1), next to the first click (D9);
  // capture phase, so a focused control or the map never swallows it
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') skipIntro()
  }
  const timer = window.setTimeout(() => {
    if (still) still.hidden = false
  }, STILL_LOADING_S * 1000)
  const evs = ['keydown', 'pointerdown', 'mousedown', 'wheel', 'touchstart'] as const
  for (const ev of evs) window.addEventListener(ev, guard, { capture: true })
  window.addEventListener('keydown', onKey, { capture: true })
  skipBtn?.addEventListener('click', onSkipClick)
  fsBtn?.addEventListener('click', onFsClick)
  document.addEventListener('fullscreenchange', syncFs)
  teardown = () => {
    clearTimeout(timer)
    for (const ev of evs) window.removeEventListener(ev, guard, { capture: true })
    window.removeEventListener('keydown', onKey, { capture: true })
    skipBtn?.removeEventListener('click', onSkipClick)
    fsBtn?.removeEventListener('click', onFsClick)
    document.removeEventListener('fullscreenchange', syncFs)
  }
}

/** Test hook: reset the module state (vitest). */
export function _resetLoadingForTests(): void {
  progress = 0
  skipped = false
  doneCalled = false
  skipListeners.clear()
  teardown = null
  startedP = new Promise((r) => (started = r))
}
