// WS7's helmet HUD panel over the 3D view (F20: "the same playback clock, position object and HUD
// components as F18"). Uses only WS7's public exports (web/src/hud/index.ts); nothing in
// web/src/hud/ is changed. Every number on the panel is WS7's readout of the exported fields and
// timeline at WS7's playback position for the clock time; the 3D view only supplies that time.
import type { HudData } from '../hud/index'
import type { PolygonFC } from '../hud/types'

/** The partner row's key as WS7's panel writes it (web/src/hud/panel.ts). */
export const WS7_PARTNER_KEY = 'PARTNER LINE'

/**
 * D20 (user, 14:22): the partner line is the cart haul only, labelled "Partner line (cart haul,
 * 60 min)". The case and the minutes come from WS2's partner file (feature properties `case`,
 * `contour_min`); with no cart feature or more than one cart contour nothing is invented (null:
 * WS7's own key stays).
 */
export function partnerRowLabel(fc: PolygonFC | null | undefined): string | null {
  const mins = new Set<number>()
  for (const f of fc?.features ?? []) {
    const p = f.properties ?? {}
    if (p.case === 'cart' && typeof p.contour_min === 'number' && Number.isFinite(p.contour_min)) mins.add(p.contour_min)
  }
  return mins.size === 1 ? `Partner line (cart haul, ${[...mins][0]} min)` : null
}

/** Replace WS7's partner key text in the mounted panel (DOM only, WS7's files untouched). */
export function relabelPartnerRow(root: { querySelectorAll(sel: string): ArrayLike<{ textContent: string | null }> }, label: string | null): boolean {
  if (!label) return false
  const keys = root.querySelectorAll('.hl-hud-k')
  for (let k = 0; k < keys.length; k++) {
    if (keys[k].textContent === WS7_PARTNER_KEY) {
      keys[k].textContent = label
      return true
    }
  }
  return false
}

export interface HudOverlay {
  /** Update the panel for EVA minute t (the shared clock's time). */
  update(tMin: number): void
  /** WS7's F19 position at EVA minute t (lon/lat), for the camera/HUD consistency check. */
  positionAt(tMin: number): { lon: number; lat: number }
  readonly data: HudData
  destroy(): void
}

/**
 * Load WS7's HUD data for the active data tree and mount its panel in `host` (absolutely
 * positioned over the canvas). The HUD module is imported dynamically so it stays out of the
 * /hud3d entry chunk until the 3D view is running.
 */
export async function mountHudOverlay(host: HTMLElement, dataUrl: (path: string) => string, scenario?: string): Promise<HudOverlay> {
  const hud = await import('../hud/index')
  const config = hud.hudConfigFromYaml()
  const data = await hud.loadHudData({ dataUrl, config, scenario })
  const layer = document.createElement('div')
  layer.className = 'hl-hud fp3d-hud'
  // .hl-hud is WS7's full-page layout; as an overlay it must be transparent and click-through
  layer.style.cssText =
    'position:absolute;inset:0;width:auto;height:auto;min-height:0;background:transparent;pointer-events:none;display:block;z-index:2'
  host.append(layer)
  const panel = hud.createHudPanel(layer, config)
  panel.el.style.pointerEvents = 'auto'
  panel.el.style.top = '2.4em' // below the 3D view's label / fps line
  relabelPartnerRow(panel.el, partnerRowLabel(data.ctx.partner)) // D20
  const stations = new Map(data.stations.map((s) => [s.id, s]))
  const plan = data.ctx.plan
  let lastHeading: number | null = null
  let lastT = Number.NaN
  return {
    data,
    positionAt(t) {
      const p = hud.playbackPosition(plan, t)
      return { lon: p.lon, lat: p.lat }
    },
    update(t) {
      if (t === lastT) return
      lastT = t
      const state = plan.stateAt(t)
      if (state.headingDeg !== null) lastHeading = state.headingDeg
      // D19: F21 ellipse / Odometry line are an optional add-on on the 2D HUD only; the 3D HUD
      // runs without WS9 nav (null), i.e. F19's circle and station fixes. No storm switch here.
      const f = hud.hudFrame(hud.playbackPosition(plan, t), data.ctx, null)
      panel.update(f.readout, f.pos, {
        headingDeg: lastHeading,
        stationName: (id) => stations.get(id)?.name ?? id,
        stationTasks: (id) => stations.get(id)?.tasks ?? [],
        rad: data.rad,
        dummy: data.dummy,
        minimap: null,
        sources: hud.readoutSources(f.readout, {
          scenario: data.scenario,
          consScenario: data.consScenario,
          padFromFile: data.padFromFile,
          partnerFile: data.partnerFile,
        }),
        navLine: f.line,
      })
    },
    destroy() {
      panel.destroy()
      layer.remove()
    },
  }
}
