// WS8 entry for the /hud3d route (F20). The shell (web/src/views/slot.ts) lazy-loads this module
// and calls mount(el, ctx). Three.js is only imported (dynamically) once WebGL2 is confirmed, so
// the fallback path and the 2D pages never download it.
import type { Fp3dClock } from './clock'
import { FP3D_CONFIG, type Fp3dConfig } from './config'
import { hasWebGL2, renderFallback, type FallbackReason } from './fallback'
import type { Fp3dPosition, ViewHandle } from './view'

export type { Fp3dClock } from './clock'
export type { Fp3dPosition } from './view'
export type { FallbackReason } from './fallback'

export interface Fp3dOptions {
  /** Maps a path in the active data tree (e.g. 'fp3d/index.json') to a URL. */
  dataUrl: (path: string) => string
  /** Scenario id of route_/timeline_ files; default config/variants.yaml scenarios.default. */
  scenario?: string
  /** External playback clock (e.g. WS7's); default: an internal clock with its own controls. */
  clock?: Fp3dClock
  /** Called each frame with the F19 position object (for the HUD). */
  onPosition?: (p: Fp3dPosition) => void
  /** Called on fallback; default: render the fallback panel with a link to the 2D HUD. */
  onFallback?: (reason: FallbackReason, detail?: string) => void
  config?: Fp3dConfig
}

export interface Fp3dHandle {
  /** Resolves once the scene is running (or has fallen back). */
  ready: Promise<void>
  dispose(): void
}

export function mountFp3d(container: HTMLElement, opts: Fp3dOptions): Fp3dHandle {
  const cfg = opts.config ?? FP3D_CONFIG
  let view: ViewHandle | null = null
  let disposed = false
  const onFallback =
    opts.onFallback ??
    ((reason: FallbackReason, detail?: string) =>
      renderFallback(container, reason, {
        hud2dHref: cfg.hud2dRoute,
        simulatedLabel: cfg.simulatedLabel,
        detail,
      }))

  const ready = (async () => {
    if (!hasWebGL2()) {
      onFallback('no-webgl2')
      return
    }
    let mod: typeof import('./view')
    try {
      mod = await import('./view')
    } catch (e) {
      if (!disposed) onFallback('load-error', e instanceof Error ? e.message : String(e))
      return
    }
    if (disposed) return
    view = await mod.startView(container, {
      dataUrl: opts.dataUrl,
      cfg,
      scenario: opts.scenario ?? cfg.defaultScenario,
      clock: opts.clock,
      onPosition: opts.onPosition,
      onFallback: (r, d) => {
        if (!disposed) onFallback(r, d)
      },
    })
    if (disposed) view.dispose()
  })()

  return {
    ready,
    dispose() {
      disposed = true
      view?.dispose()
    },
  }
}

/** WS5 slot contract (web/src/views/slot.ts): mount(el, ctx) -> cleanup. The WS7 HUD panel is
 *  mounted over the view once web/src/hud/ is on main (STATUS WS8 "Next"). */
export function mount(el: HTMLElement, ctx: { dataUrl: (path: string) => string }): () => void {
  const wrap = document.createElement('div')
  wrap.className = 'fp3d-wrap'
  wrap.style.cssText = 'position:relative;width:100%;min-height:420px'
  el.append(wrap)
  // fill the viewport below the shell's header/banners (their height varies)
  const fit = () => {
    wrap.style.height = `${Math.max(420, Math.floor(window.innerHeight - wrap.getBoundingClientRect().top - 4))}px`
  }
  fit()
  window.addEventListener('resize', fit)
  const h = mountFp3d(wrap, { dataUrl: ctx.dataUrl })
  return () => {
    window.removeEventListener('resize', fit)
    h.dispose()
    wrap.remove()
  }
}
