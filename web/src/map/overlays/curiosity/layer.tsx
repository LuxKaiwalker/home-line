// L1b: the Curiosity overlay on the Plan map (ConsoleMap extension, map/extensions.ts registerOverlay).
// Re-implements the Mission Planer's msl-* layers (mission/missionMap.ts, not ported) on the extension
// hooks: the traverse line and the drive-end points in the 'overlay' slot, a ring on the drive end whose
// card is open, a click handler (registerEditHandlers, above route editing so a click on a drive end
// opens its card instead of adding a free point) and the card host inside the map container.
// Colours: purple = live (DESIGN §3.1) for NASA's live data; yellow (select) only for the open drive end.
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { render } from 'preact'
import { color, TOKENS } from '../../../ui/tokens'
import { registerEditHandlers, type MapExtensionContext, type MapPointer, type OverlayHandle } from '../../extensions'
import { CuriosityCard } from './Card'
import { curiosityOn, curiositySelected, curiosityStatus, openCuriosityStop, setCuriosityOn, type CuriosityStatus } from './store'

export const CURIOSITY_SOURCES = { traverse: 'hl-curiosity-traverse', stops: 'hl-curiosity-stops' } as const
export const CURIOSITY_LAYERS = { line: 'hl-curiosity-line', stops: 'hl-curiosity-stops', selected: 'hl-curiosity-selected' } as const
/** px around the pointer that still hits a drive end */
export const HIT_PX = TOKENS.space[2]
/** the edit-handler priority: above route editing (R3), which adds a free point on click */
export const CLICK_PRIORITY = 100

const EMPTY = { type: 'FeatureCollection' as const, features: [] }
const RADIUS = ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7]
const RADIUS_SEL = ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 11]

type Status = CuriosityStatus

function geo(s: Status) {
  if (s.kind !== 'ready') return { traverse: EMPTY, stops: EMPTY }
  return {
    traverse: { type: 'FeatureCollection' as const, features: s.traverse.map((coordinates) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } })) },
    stops: {
      type: 'FeatureCollection' as const,
      features: s.stops.map((p, i) => ({ type: 'Feature' as const, properties: { i, sol: p.sol, rmc: p.rmc }, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } })),
    },
  }
}

/** OverlaySpec.install: adds empty sources (no data, no request) and hidden layers; data arrives from the store. */
export function installCuriosityLayer(ctx: MapExtensionContext): OverlayHandle {
  const m = ctx.map as MlMap
  const before = ctx.beforeId('overlay')
  const live = color('live')
  m.addSource(CURIOSITY_SOURCES.traverse, { type: 'geojson', data: EMPTY })
  m.addSource(CURIOSITY_SOURCES.stops, { type: 'geojson', data: EMPTY })
  m.addLayer(
    { id: CURIOSITY_LAYERS.line, type: 'line', source: CURIOSITY_SOURCES.traverse, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': live, 'line-width': TOKENS.line.threadPx } },
    before,
  )
  m.addLayer(
    {
      id: CURIOSITY_LAYERS.stops,
      type: 'circle',
      source: CURIOSITY_SOURCES.stops,
      layout: { visibility: 'none' },
      paint: { 'circle-radius': RADIUS as never, 'circle-color': live, 'circle-stroke-color': color('bg'), 'circle-stroke-width': TOKENS.line.fieldEdgePx },
    },
    before,
  )
  m.addLayer(
    {
      id: CURIOSITY_LAYERS.selected,
      type: 'circle',
      source: CURIOSITY_SOURCES.stops,
      layout: { visibility: 'none' },
      filter: ['==', ['get', 'i'], -1],
      paint: { 'circle-radius': RADIUS_SEL as never, 'circle-opacity': 0, 'circle-stroke-color': color('select'), 'circle-stroke-width': TOKENS.line.focusRingPx },
    },
    before,
  )

  let visible = false
  let shown: Status | null = null
  let hovering = false
  const ids = Object.values(CURIOSITY_LAYERS)
  const apply = () => {
    const s = curiosityStatus.peek()
    if (s !== shown) {
      shown = s
      const g = geo(s)
      ;(m.getSource(CURIOSITY_SOURCES.traverse) as GeoJSONSource | undefined)?.setData(g.traverse)
      ;(m.getSource(CURIOSITY_SOURCES.stops) as GeoJSONSource | undefined)?.setData(g.stops)
    }
    visible = curiosityOn.peek() && s.kind === 'ready'
    for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    if (m.getLayer(CURIOSITY_LAYERS.selected)) m.setFilter(CURIOSITY_LAYERS.selected, ['==', ['get', 'i'], curiositySelected.peek() ?? -1])
  }
  const unsubs = [curiosityOn.subscribe(apply), curiosityStatus.subscribe(apply), curiositySelected.subscribe(apply)]
  apply()

  const hit = (p: MapPointer): number | null => {
    if (!visible || !m.getLayer(CURIOSITY_LAYERS.stops)) return null
    const f = m.queryRenderedFeatures(
      [
        [p.x - HIT_PX, p.y - HIT_PX],
        [p.x + HIT_PX, p.y + HIT_PX],
      ],
      { layers: [CURIOSITY_LAYERS.stops] },
    )[0]
    const i = Number(f?.properties?.i)
    return f && Number.isInteger(i) ? i : null
  }
  const offEdit = registerEditHandlers({
    id: 'curiosity',
    priority: CLICK_PRIORITY,
    click(p) {
      const i = hit(p)
      if (i === null) return false
      openCuriosityStop(i)
      return true
    },
    hover(p) {
      hovering = hit(p) !== null
    },
    cursor: () => (hovering ? 'pointer' : null),
  })

  // the drive-end card (ui/layout MarkerCard) lives in the map container, so it follows the map
  const container = typeof document !== 'undefined' ? (m.getContainer?.() as HTMLElement | undefined) : undefined
  let cardHost: HTMLElement | null = null
  if (container) {
    cardHost = document.createElement('div')
    cardHost.className = 'hl-curiosity-host'
    // keep pointer and wheel events in the card away from the map (no pan, zoom or free point)
    for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel']) cardHost.addEventListener(ev, (e) => e.stopPropagation())
    container.appendChild(cardHost)
    render(<CuriosityCard map={m} />, cardHost)
  }

  return {
    setVisible(on) {
      // the host's install-time call (defaultOn false) and I1's generic rows land here: same state as the toggle
      setCuriosityOn(on)
    },
    setOpacity(v) {
      const o = Math.max(0, Math.min(1, v))
      if (m.getLayer(CURIOSITY_LAYERS.line)) m.setPaintProperty(CURIOSITY_LAYERS.line, 'line-opacity', o)
      if (m.getLayer(CURIOSITY_LAYERS.stops)) {
        m.setPaintProperty(CURIOSITY_LAYERS.stops, 'circle-opacity', o)
        m.setPaintProperty(CURIOSITY_LAYERS.stops, 'circle-stroke-opacity', o)
      }
    },
    destroy() {
      for (const u of unsubs) u()
      offEdit()
      if (cardHost) {
        render(null, cardHost)
        cardHost.remove()
      }
      try {
        for (const id of [...ids].reverse()) if (m.getLayer(id)) m.removeLayer(id)
        for (const id of Object.values(CURIOSITY_SOURCES)) if (m.getSource(id)) m.removeSource(id)
      } catch {
        // the map (and its style) is already gone
      }
    },
  }
}
