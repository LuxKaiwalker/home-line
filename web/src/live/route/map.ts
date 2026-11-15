// The console map seen by the Edit-route panel (R5): staged results through the console map's OWN
// setters (setScenarioData / setRoute, one rendering path, kit rule 7, as the pad tool does), and the
// failing leg of an infeasible route as one extra line layer in the limit colour (DESIGN §3.1: limit
// = red). The failing leg was not planned (the engine stops there), so the line joins its two stops
// straight and dashed: it marks which leg, it is not a path.
// WP12 (D117): the failing leg carries a label "fails: O₂"; the walked legs end at the last reached stop,
// marked "route stops here · no way home planned"; no route leg from the failing leg on (no home leg)
// is drawn. Labels are DOM markers (the style has no glyphs, labels/layer.ts), only on a real map.
import type { FeatureCollection } from 'geojson'
import { Marker } from 'maplibre-gl'
import type { RouteEnd, RouteMap } from '../../edit/route/controller'
import type { BandsFC, EdgesFC, IsochroneFC, PartnerFC, RouteFC } from '../../data/types'
import { TOKENS } from '../../ui/tokens'
import type { ScenarioLayers } from '../mapPort'
import type { StageResult } from '../stage'

export const FAILING_LEG_ID = 'hl-route-failing-leg'
/** the end marker (circle) of an infeasible route, on the same source */
export const ROUTE_END_ID = 'hl-route-end'

interface GeoJsonSourceLike {
  setData(d: unknown): unknown
}
/** The parts of maplibre-gl's Map used here (tests pass a fake). */
export interface RouteMlMap {
  getSource(id: string): unknown
  addSource(id: string, spec: { type: 'geojson'; data: FeatureCollection }): unknown
  addLayer(spec: Record<string, unknown>): unknown
  getLayer(id: string): unknown
  /** the map's container: carries data-failing-leg for tests and the e2e harness */
  getContainer?(): HTMLElement
}

/** A DOM label on the map (maplibre Marker; tests pass a fake through `pin`). */
export interface MapPin {
  remove(): void
}
export type PinMaker = (at: [number, number], text: string, kind: 'fails' | 'end') => MapPin
/** The parts of ConsoleMap used here (ConsoleMap satisfies it). */
export interface RouteConsoleMap {
  readonly map: RouteMlMap
  whenReady(): Promise<void>
  setScenarioData(d: ScenarioLayers): Promise<void>
  setRoute(r: RouteFC | null): Promise<void>
}

const empty = <T>() => ({ type: 'FeatureCollection', features: [] }) as unknown as T

/** The failing-leg feature collection (empty = no highlight); with `end`, the point where the route stops. */
export function failingLegData(coords: [number, number][] | null, label?: string, end?: RouteEnd): FeatureCollection {
  if (!coords || coords.length < 2) return { type: 'FeatureCollection', features: [] }
  const features: FeatureCollection['features'] = [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { label: label ?? '', state: 'failing' } }]
  if (end) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coords[0] }, properties: { label: end.label, state: 'end', stop: end.name } })
  return { type: 'FeatureCollection', features }
}

/** The planned route without any leg from the failing one on: no home leg is drawn for an infeasible route. */
export function walkedRoute(r: RouteFC, failLeg: number): RouteFC {
  const features = r.features.filter((f) => {
    const p = (f.properties ?? {}) as { leg?: unknown; to?: unknown }
    if (typeof p.leg === 'number') return p.leg < failLeg
    return p.to !== 'pad'
  })
  return features.length === r.features.length ? r : { ...r, features }
}

const mid = (c: [number, number][]): [number, number] => [(c[0][0] + c[c.length - 1][0]) / 2, (c[0][1] + c[c.length - 1][1]) / 2]

/** Default labels: maplibre Markers with a DOM pill (styles in edit/route/route.css). */
function domPins(m: RouteMlMap): PinMaker | null {
  if (typeof (m as { getCanvasContainer?: unknown }).getCanvasContainer !== 'function' || typeof document === 'undefined') return null
  return (at, text, kind) => {
    const el = document.createElement('div')
    el.className = `hl-route-pin hl-route-pin--${kind}`
    el.dataset.routePin = kind
    el.textContent = text
    return new Marker({ element: el, anchor: kind === 'end' ? 'top' : 'center', offset: kind === 'end' ? [0, 8] : [0, 0] }).setLngLat(at).addTo(m as unknown as import('maplibre-gl').Map)
  }
}

export function consoleRouteMap(cm: RouteConsoleMap, restore: () => void | Promise<void>, alive: () => boolean = () => true, pin?: PinMaker | null): RouteMap {
  let layer: Promise<void> | null = null
  let lastRoute: RouteFC | null = null
  let pins: MapPin[] = []
  const clearPins = () => {
    for (const p of pins) p.remove()
    pins = []
  }
  const ensure = () =>
    (layer ??= cm.whenReady().then(() => {
      const m = cm.map
      if (!m.getSource(FAILING_LEG_ID)) m.addSource(FAILING_LEG_ID, { type: 'geojson', data: failingLegData(null) })
      if (!m.getLayer(FAILING_LEG_ID))
        m.addLayer({
          id: FAILING_LEG_ID,
          type: 'line',
          source: FAILING_LEG_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': TOKENS.color.limit, 'line-width': TOKENS.line.threadPx * 2, 'line-dasharray': [2, 1.5] },
        })
      if (!m.getLayer(ROUTE_END_ID))
        m.addLayer({
          id: ROUTE_END_ID,
          type: 'circle',
          source: FAILING_LEG_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': TOKENS.line.threadPx * 3, 'circle-color': TOKENS.color.bg, 'circle-stroke-color': TOKENS.color.limit, 'circle-stroke-width': TOKENS.line.threadPx },
        })
    }))
  return {
    async showStage(data) {
      if (!alive()) return
      const r = data as StageResult
      if (r.bands || r.isochrones || r.edges || r.partner)
        await cm.setScenarioData({
          bands: r.bands ?? empty<BandsFC>(),
          isochrones: r.isochrones ?? empty<IsochroneFC>(),
          edges: r.edges ?? empty<EdgesFC>(),
          partner: r.partner ?? empty<PartnerFC>(),
          variant: r.scenario?.variant ?? 'nominal',
        })
      if (r.route) {
        lastRoute = r.route
        await cm.setRoute(r.route)
      }
    },
    highlightLeg(coords, label, leg, end) {
      if (!alive()) return
      const box = cm.map.getContainer?.()
      if (box) {
        if (coords && leg !== undefined) box.dataset.failingLeg = String(leg)
        else delete box.dataset.failingLeg
        if (coords && end) box.dataset.routeEnd = end.name
        else delete box.dataset.routeEnd
      }
      clearPins()
      // the walked legs end at the last reached stop: no leg from the failing one on, no home leg
      if (coords && end && lastRoute) {
        const walked = walkedRoute(lastRoute, end.leg)
        if (walked !== lastRoute) void cm.setRoute(walked).catch(() => {})
      }
      if (!coords && !layer) return
      void ensure()
        .then(() => {
          if (!alive()) return
          ;(cm.map.getSource(FAILING_LEG_ID) as GeoJsonSourceLike | undefined)?.setData(failingLegData(coords, label, end))
          const make = pin === undefined ? domPins(cm.map) : pin
          if (coords && coords.length >= 2 && make) {
            if (label) pins.push(make(mid(coords), label, 'fails'))
            if (end) pins.push(make(coords[0], end.label, 'end'))
          }
        })
        .catch(() => {}) // the map went away meanwhile
    },
    restore() {
      clearPins()
      lastRoute = null
      if (alive()) void restore()
    },
  }
}
