// PORT P2: the pad environment swap on the Plan map (Notion "Port Mission Planer into Plan" §2.2, §3;
// interfaces.md §3). Choosing a pad swaps what ConsoleMap draws for the official plan for that pad's
// precomputed plan products (scenarios/pads/{id}/: bands, edges, partner line, official route; no
// isochrones), with a fade; choosing the official pad again restores exactly what ConsoleMap loaded.
//
// How (map/consoleMap.ts is not edited): the existing geojson sources 'bands' 'iso' 'edges' 'partner'
// 'route' get the pad's data with setData (interfaces §3 allows it). While a pad is active the sources
// are "held": a later ConsoleMap setData (scenario change, the old parking-option flow) is recorded as
// the official data but not drawn, so the pad's plan stays and the restore uses ConsoleMap's latest data.
// The GPU field ('field-bands', map/field/layer.ts) is drawn from the official pad's fields (opt/nom/con
// t_home at every suit mass); the picker pads have nom_104 t_home only, so while one is active the GPU
// field is hidden and the pad's own precomputed band polygons are shown instead (as the Mission Planer did).
// Numbers are never recomputed here: the products are drawn as the pipeline wrote them.
import { drawnPartner } from '../../data/partner'
import type { PartnerFC } from '../../data/types'
import type { PlanProducts } from '../../pads/types'

/** ConsoleMap's geojson sources this module swaps (map/consoleMap.ts initLayers). */
export const SWAP_SOURCES = ['bands', 'iso', 'edges', 'partner', 'route'] as const
export type SwapSource = (typeof SWAP_SOURCES)[number]

/** map/field/layer.ts FIELD_LAYER_ID (not imported: layer.ts is the lazy shader chunk). */
export const FIELD_LAYER = 'field-bands'
/** ConsoleMap's polygon band layers (shown while the GPU field is hidden). */
export const POLYGON_BAND_LAYERS = ['band-opt', 'band-con', 'band-lines'] as const
/** Layers that fade in with a new pad (layer id, opacity paint property). */
export const FADE_LAYERS: readonly (readonly [string, string])[] = [
  ['band-opt', 'fill-opacity'],
  ['band-con', 'fill-opacity'],
  ['band-lines', 'line-opacity'],
  ['edges-line', 'line-opacity'],
  ['partner-line', 'line-opacity'],
]

const EMPTY = { type: 'FeatureCollection' as const, features: [] }

/** The part of a MapLibre map the swap uses (a fake in tests). */
export interface SwapMap {
  getSource(id: string): unknown
  getLayer(id: string): unknown
  getLayoutProperty(id: string, name: string): unknown
  setLayoutProperty(id: string, name: string, value: unknown): unknown
  getPaintProperty(id: string, name: string): unknown
  setPaintProperty(id: string, name: string, value: unknown): unknown
}

interface GeoSource {
  setData(d: unknown): unknown
  getData?(): Promise<unknown>
}

export interface EnvSwap {
  /** Draw a pad's products (non-official pad) or restore the official plan (null). */
  show(products: PlanProducts | null): void
  /** true while a pad's products are drawn */
  readonly active: boolean
  /** Restore the official plan and unhook the sources. */
  dispose(): void
}

export interface EnvSwapOptions {
  /** fade-in duration in ms (0 = none; reduced motion) */
  fadeMs(): number
}

/** The data a pad shows in each swapped source (pads have no isochrones: the iso layers go empty). */
export function padSourceData(p: PlanProducts): Record<SwapSource, unknown> {
  return {
    bands: p.bands,
    iso: EMPTY,
    edges: p.edges,
    partner: p.partner ? drawnPartner(p.partner as PartnerFC) : EMPTY, // D20: cart only, drag never drawn
    route: p.route ?? EMPTY,
  }
}

export function createEnvSwap(map: SwapMap, opts: EnvSwapOptions): EnvSwap {
  const official = new Map<SwapSource, unknown>()
  const originals = new Map<SwapSource, (d: unknown) => unknown>()
  const hooked = new Map<SwapSource, { src: GeoSource; own: PropertyDescriptor | undefined }>()
  let active = false
  let fieldWas: unknown = undefined
  let fieldHidden = false
  const opacity = new Map<string, unknown>()

  // hold the sources: ConsoleMap's later setData calls are the official data
  for (const id of SWAP_SOURCES) {
    const src = map.getSource(id) as GeoSource | undefined
    if (!src || typeof src.setData !== 'function') continue
    const orig = src.setData.bind(src)
    originals.set(id, orig)
    hooked.set(id, { src, own: Object.getOwnPropertyDescriptor(src, 'setData') })
    src.setData = (d: unknown) => {
      official.set(id, d)
      return active ? src : orig(d)
    }
    // registered after ConsoleMap's first setData: read what it drew (MapLibre >= 4 getData)
    void src
      .getData?.()
      .then((d) => {
        if (!official.has(id)) official.set(id, d)
      })
      .catch(() => {})
  }

  const has = (id: string) => !!map.getLayer(id)

  function hideField(on: boolean): void {
    if (on && !fieldHidden && has(FIELD_LAYER)) {
      fieldWas = map.getLayoutProperty(FIELD_LAYER, 'visibility')
      map.setLayoutProperty(FIELD_LAYER, 'visibility', 'none')
      fieldHidden = true
      for (const id of POLYGON_BAND_LAYERS) if (has(id)) map.setLayoutProperty(id, 'visibility', 'visible')
    } else if (!on && fieldHidden) {
      if (has(FIELD_LAYER)) {
        map.setLayoutProperty(FIELD_LAYER, 'visibility', fieldWas ?? 'visible')
        // the GPU field replaces the polygons again (ConsoleMap's applyVisibility rule)
        for (const id of POLYGON_BAND_LAYERS) if (has(id)) map.setLayoutProperty(id, 'visibility', 'none')
      }
      fieldHidden = false
      fieldWas = undefined
    }
  }

  /** Fade the swapped layers in: opacity 0 at once, then back to their value over `fadeMs`. */
  function fade(apply: () => void): void {
    const ms = opts.fadeMs()
    const layers = FADE_LAYERS.filter(([id]) => has(id))
    if (ms > 0)
      for (const [id, prop] of layers) {
        const key = `${id}|${prop}`
        if (!opacity.has(key)) opacity.set(key, map.getPaintProperty(id, prop) ?? 1)
        map.setPaintProperty(id, `${prop}-transition`, { duration: 0, delay: 0 })
        map.setPaintProperty(id, prop, 0)
      }
    apply()
    if (ms > 0)
      for (const [id, prop] of layers) {
        map.setPaintProperty(id, `${prop}-transition`, { duration: ms, delay: 0 })
        map.setPaintProperty(id, prop, opacity.get(`${id}|${prop}`))
      }
  }

  function restore(): void {
    for (const [id, orig] of originals) if (official.has(id)) orig(official.get(id))
  }

  return {
    get active() {
      return active
    },
    show(products) {
      if (!products) {
        if (!active) return
        active = false
        fade(() => {
          restore()
          hideField(false)
        })
        return
      }
      active = true
      const d = padSourceData(products)
      fade(() => {
        for (const [id, orig] of originals) orig(d[id])
        hideField(true)
      })
    },
    dispose() {
      if (active) {
        active = false
        restore()
        hideField(false)
      }
      // unhook: back to the prototype method (or the source's own one)
      for (const { src, own } of hooked.values()) {
        if (own) Object.defineProperty(src, 'setData', own)
        else delete (src as Partial<GeoSource>).setData
      }
      hooked.clear()
      originals.clear()
    },
  }
}
