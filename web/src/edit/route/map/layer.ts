// WP6 (D97): free waypoints and the ghost route on the console map. Marker and drag patterns ported
// from origin/waypoint-routing web/src/mission/missionMap.ts (N0CEO, Mission Planer: numbered
// draggable markers, click to add, dashed line), adapted to the design map, its tokens and I1's
// mouse model (left button interacts; a right / middle press on a marker belongs to the map).
//
//   markers  one MapLibre Marker per free point, .hl-route-marker[data-point="W{n}"], draggable;
//            the drag changes nothing until the drop (D85), then one undo step (editor.drop)
//   add      while "Add waypoint" is armed, the next map click appends W{n}; Escape disarms
//   ghost    one dashed line layer (muted: an estimate), hidden once a computed result is drawn
import type { FeatureCollection } from 'geojson'
import { effect } from '../../../state/signal'
import { TOKENS } from '../../../ui/tokens'
import { fill } from '../text'
import type { WaypointEditor } from './editor'
import { ghostData } from './ghost'
import { freePoints } from './points'
import { WAYPOINT_TEXT as W } from './text'

export const GHOST_LAYER_ID = 'hl-route-ghost'
export const GHOST_SOURCE_ID = 'hl-route-ghost'

/** The part of a MapLibre Marker used here (tests pass a fake). */
export interface PointMarker {
  getElement(): HTMLElement
  getLngLat(): { lng: number; lat: number }
  setLngLat(ll: [number, number]): unknown
  setDraggable(on: boolean): unknown
  on(type: 'dragstart' | 'dragend', fn: () => void): unknown
  addTo(map: never): unknown
  remove(): unknown
}

interface ClickEvent {
  lngLat: { lng: number; lat: number }
}
interface GeoJsonSourceLike {
  setData(d: unknown): unknown
}
/** The parts of maplibre-gl's Map used here. */
export interface WaypointMlMap {
  on(type: 'click', fn: (e: ClickEvent) => void): unknown
  off(type: 'click', fn: (e: ClickEvent) => void): unknown
  getSource(id: string): unknown
  addSource(id: string, spec: { type: 'geojson'; data: FeatureCollection }): unknown
  addLayer(spec: Record<string, unknown>): unknown
  getLayer(id: string): unknown
  getContainer(): HTMLElement
}
export interface WaypointConsoleMap {
  readonly map: WaypointMlMap
  whenReady(): Promise<void>
}

export interface AttachOptions {
  /** new marker for an element (default: maplibre-gl Marker, loaded with this lazy chunk) */
  makeMarker: (el: HTMLElement) => PointMarker
  doc?: Pick<Document, 'createElement'>
  /** where Escape and a right / middle release are heard (default window) */
  win?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Put the editor's points and ghost on the console map. Returns the disposer. */
export function attachWaypointMap(ed: WaypointEditor, cm: WaypointConsoleMap, o: AttachOptions): () => void {
  const { ctl } = ed
  const doc = o.doc ?? document
  const win = o.win !== undefined ? o.win : typeof window === 'undefined' ? null : window
  let alive = true
  const offs: (() => void)[] = []
  const markers = new Map<string, { m: PointMarker; el: HTMLElement; off: () => void }>()

  // ---- ghost layer --------------------------------------------------------------------------
  let ghostReady = false
  const drawGhost = () => {
    if (!ghostReady) return
    const g = ed.ghost.peek()
    const data = ed.ghostShown.peek() && g.kind === 'ready' ? ghostData(g.ghost) : EMPTY
    ;(cm.map.getSource(GHOST_SOURCE_ID) as GeoJsonSourceLike | undefined)?.setData(data)
  }
  void cm.whenReady().then(() => {
    if (!alive) return
    const m = cm.map
    if (!m.getSource(GHOST_SOURCE_ID)) m.addSource(GHOST_SOURCE_ID, { type: 'geojson', data: EMPTY })
    if (!m.getLayer(GHOST_LAYER_ID))
      m.addLayer({
        id: GHOST_LAYER_ID,
        type: 'line',
        source: GHOST_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // an estimate: muted and dashed; a leg without a path on the browser grid in the unknown grey
          'line-color': ['case', ['get', 'routed'], TOKENS.color.textMuted, TOKENS.color.unknown],
          'line-width': TOKENS.line.threadPx,
          'line-dasharray': [2, 2],
        },
      })
    ghostReady = true
    drawGhost()
  })
  offs.push(
    effect(() => {
      void ed.ghost.value
      void ed.ghostShown.value
      drawGhost()
    }),
  )

  // ---- markers --------------------------------------------------------------------------------
  function makePointMarker(name: string): { m: PointMarker; el: HTMLElement; off: () => void } {
    const el = doc.createElement('div')
    el.className = 'hl-route-marker'
    el.dataset.point = name
    el.textContent = name
    el.tabIndex = 0
    el.setAttribute('role', 'button')
    const m = o.makeMarker(el)
    m.setDraggable(true)
    let index = -1
    m.on('dragstart', () => {
      el.classList.add('is-dragging')
      ed.dragStart(el.dataset.point ?? name)
    })
    m.on('dragend', () => {
      el.classList.remove('is-dragging')
      const p = m.getLngLat()
      const cur = freePoints(ctl.store.route.peek()).find((f) => f.name === el.dataset.point)
      index = cur ? cur.index : -1
      if (index < 0) ed.dragCancel()
      else ed.drop(index, p.lng, p.lat)
      place()
    })
    // a click on a marker never adds a point or selects what is under it (missionMap pattern)
    const stop = (e: Event) => e.stopPropagation()
    el.addEventListener('click', stop)
    // I1: points move with the LEFT button only; a right / middle press belongs to the map
    let release: (() => void) | null = null
    const onPress = (e: Event): void => {
      const p = e as PointerEvent
      if (p.pointerType === 'touch' || p.button === 0 || release) return
      m.setDraggable(false)
      const back = (): void => {
        win?.removeEventListener('pointerup', back)
        win?.removeEventListener('pointercancel', back)
        release = null
        m.setDraggable(true)
      }
      release = back
      win?.addEventListener('pointerup', back)
      win?.addEventListener('pointercancel', back)
    }
    el.addEventListener('pointerdown', onPress)
    m.addTo(cm.map as never)
    return {
      m,
      el,
      off: () => {
        el.removeEventListener('click', stop)
        el.removeEventListener('pointerdown', onPress)
        release?.()
        m.remove()
      },
    }
  }

  /** Markers follow the route (added, moved by undo, renamed, deleted, renumbered). */
  function place(): void {
    if (!alive) return
    const pts = freePoints(ctl.store.route.peek())
    const check = ctl.check.peek()
    const names = new Set(pts.map((p) => p.name))
    for (const [n, mk] of markers) {
      if (!names.has(n)) {
        mk.off()
        markers.delete(n)
      }
    }
    const dragging = ed.dragging.peek()
    for (const p of pts) {
      let mk = markers.get(p.name)
      if (!mk) markers.set(p.name, (mk = makePointMarker(p.name)))
      if (dragging !== p.name) mk.m.setLngLat([p.stop.lon, p.stop.lat])
      const c = check.stops[p.index]
      mk.el.dataset.validity = !c ? 'unknown' : c.valid === false ? 'invalid' : c.valid ? 'valid' : 'unknown'
      mk.el.title = fill(W.markerTitle, { name: p.name, label: p.stop.label ? ` · ${p.stop.label}` : '' })
      mk.el.setAttribute('aria-label', mk.el.title)
    }
  }
  offs.push(
    effect(() => {
      void ctl.store.route.value
      void ctl.check.value
      void ed.dragging.value
      place()
    }),
  )

  // ---- add: the armed map click --------------------------------------------------------------
  const onClick = (e: ClickEvent) => {
    if (ed.adding.peek()) ed.add(e.lngLat.lng, e.lngLat.lat)
  }
  cm.map.on('click', onClick)
  offs.push(() => cm.map.off('click', onClick))
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape' && ed.adding.peek()) {
      ed.cancelAdd()
      e.stopPropagation()
    }
  }
  // capture: Escape disarms adding before the shell's own Escape (selection, ghost) hears it
  win?.addEventListener('keydown', onKey, true)
  offs.push(() => win?.removeEventListener('keydown', onKey, true))
  offs.push(
    effect(() => {
      const on = ed.adding.value
      cm.map.getContainer().classList.toggle('hl-route-adding', on)
    }),
  )

  ed.setMapAttached(true)
  return () => {
    alive = false
    ed.setMapAttached(false)
    for (const f of offs.reverse()) f()
    for (const mk of markers.values()) mk.off()
    markers.clear()
    if (ghostReady) (cm.map.getSource(GHOST_SOURCE_ID) as GeoJsonSourceLike | undefined)?.setData(EMPTY)
  }
}
