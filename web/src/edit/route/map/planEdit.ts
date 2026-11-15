// PORT R3: waypoint editing on the Plan map, on the ONE planning state (state/planning.ts). WP6's
// behaviour (D97 §3.3: click = free point, drag moves it, delete, validity, ghost while dragging) is
// re-implemented on the map extension points (map/extensions.ts registerEditHandlers) instead of the
// old Edit-route controller. Map-free: the map binding is planMap.ts; tests drive this with pointers.
//
//   editing   live only while the route panel / "Plan a route" is on (setEditing; I1 wires it)
//   click     a left click on bare ground adds a free point (one undo step); a click on a station,
//             a pad or another marker is left to the map (MapSelection: its card has "Add to route")
//   refuse    ROUTE_LIMITS (edit/route/model.ts: max stops, max free points, min stop spacing) and the
//             pad's routing field (outside the field, no known walk home within the access disc) refuse
//             with a notice; unknown (field not loaded) never refuses (U15: unknown stays unknown)
//   drag      a left press on a point's handle owns the drag (map does not pan); nothing is applied
//             until the drop (D85); the drop is one undo step (moveStop) or is refused (snaps back)
//   suppress  the click the browser fires after a drag end is swallowed (W0a trap), and every
//             consumed click calls preventDefault() on the DOM event so MapSelection can skip it
//   delete    removeStop (handle key Delete / Backspace, the handle's remove button)
// Every edit gives visible feedback synchronously (store change or notice): far under 200 ms.
import { computed, signal, type ReadSignal } from '../../../state/signal'
import { planning, stopLabels, type PlanStop, type PlanningStore, type StopId } from '../../../state/planning'
import type { EditHandlers, MapPointer } from '../../../map/extensions'
import { distanceM, ROUTE_LIMITS, type StationGeo } from '../model'
import { t } from '../../../ui/copy'


/** Validity lookups at a candidate point (null = not known in this browser: never refused). */
export interface PointProbe {
  inGrid: boolean | null
  reachable: boolean | null
}
export const UNKNOWN_POINT: PointProbe = { inGrid: null, reachable: null }

export type Refusal = 'tooManyStops' | 'tooManyFreePoints' | 'spacing' | 'outside' | 'unreachable' | 'unknownStation'

export interface EditNotice {
  text: string
  kind: 'info' | 'refused'
  /** increments with every notice (same text twice still re-announces) */
  seq: number
}

export interface DragState {
  id: StopId
  name: string
  lon: number
  lat: number
  /** where the press went down (screen px): a release within CLICK_SLOP_PX is a click, not a move */
  x0: number
  y0: number
  /** null = not judged (unknown), false = would be refused at the drop */
  valid: boolean | null
  /** neighbours for the ghost: previous stop (or the pad) and next stop (or the pad) */
  prev: { lon: number; lat: number } | null
  next: { lon: number; lat: number } | null
}

export interface PlanEditOptions {
  store?: PlanningStore
  /** field lookups at a point for the active pad (default: unknown) */
  probe?: (lon: number, lat: number) => PointProbe
  /** the active pad's position (spacing, ghost ends); null = not known yet */
  pad?: () => { lon: number; lat: number } | null
  /** station positions (access point if any) */
  stations?: () => readonly StationGeo[]
  /** ms clock (tests) */
  now?: () => number
  /** how long a notice stays (ms); 0 = until the next one */
  noticeMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

/** Left-press slop (H2b, edit/drag.ts CLICK_SLOP_PX): less movement than this is a click. */
export const CLICK_SLOP_PX = 4
/** A click this soon after a drag end belongs to the drag (the browser's click after mouseup). */
export const POST_DRAG_CLICK_MS = 400
/** Edit handler priority: above the default 0 (generic tools), below specific hit handlers such as L1b's
 *  Curiosity drive ends (100), which consume only clicks on their own features. */
export const R3_PRIORITY = 10
/** 1e-6 deg (~6 cm on Mars): the link format's precision (planningUrl.ts). */
const round6 = (x: number) => Math.round(x * 1e6) / 1e6

const targetEl = (p: MapPointer): Element | null => {
  const t = p.originalEvent?.target as unknown as { closest?: (s: string) => Element | null } | null
  return t && typeof t.closest === 'function' ? (t as unknown as Element) : null
}
/** The stop id of the handle under the pointer (the handle element carries data-r3-stop). */
export function handleStopAt(p: MapPointer): StopId | null {
  const el = targetEl(p)?.closest('[data-r3-stop]')
  return el?.getAttribute('data-r3-stop') ?? null
}
/** Another DOM marker (station label, pad pin, card) is under the pointer: leave the click to it. */
function otherMarkerAt(p: MapPointer): boolean {
  const el = targetEl(p)
  return !!el && !el.closest('[data-r3-stop]') && !!el.closest('.maplibregl-marker, .maplibregl-popup, button, a')
}
const prevent = (p: MapPointer) => {
  const e = p.originalEvent as { preventDefault?: () => void } | undefined
  if (typeof e?.preventDefault === 'function') e.preventDefault()
}

export function createPlanEditor(o: PlanEditOptions = {}) {
  const store = o.store ?? planning
  const now = o.now ?? (() => Date.now())
  const probe = o.probe ?? (() => UNKNOWN_POINT)
  const padAt = o.pad ?? (() => null)
  const stations = o.stations ?? (() => [])
  const noticeMs = o.noticeMs ?? 4000
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))

  const editing = signal(false)
  const drag = signal<DragState | null>(null)
  const hoverId = signal<StopId | null>(null)
  const notice = signal<EditNotice | null>(null)
  let noticeSeq = 0
  let noticeTimer: unknown = null
  /** a drag ended at this time and no new press came since: the next click is the drag's own */
  let dragEndedAt: number | null = null
  /** a map layer query (planMap.ts): a station / pad feature under the pointer → not ours */
  let featureAt: ((p: MapPointer) => boolean) | null = null
  /** F11: the ground (terrain surface) under the pointer, from the map (planMap.ts: map.unproject, the
   *  terrain-aware unprojection MapSelection's crosshair uses); null = the event's own lngLat */
  let groundAt: ((p: MapPointer) => { lon: number; lat: number } | null) | null = null
  /** The pointer's ground position: the map's terrain pick, else the event's lngLat. */
  const ground = (p: MapPointer): { lon: number; lat: number } => {
    const g = groundAt?.(p)
    return g && Number.isFinite(g.lon) && Number.isFinite(g.lat) ? g : { lon: p.lon, lat: p.lat }
  }

  const stops = () => store.doc.peek().route.stops
  const nameOf = (id: StopId): string => {
    const s = stops()
    const i = s.findIndex((x) => x.id === id)
    return i >= 0 ? stopLabels(s)[i] : id
  }
  const stationName = (id: string) => stations().find((s) => s.id === id)?.name ?? id
  const posOf = (s: PlanStop): { lon: number; lat: number } | null => {
    if (s.kind === 'point') return { lon: s.lon, lat: s.lat }
    const g = stations().find((x) => x.id === s.station)
    return g ? { lon: g.lon, lat: g.lat } : null
  }

  function say(kind: EditNotice['kind'], text: string): void {
    notice.value = { text, kind, seq: ++noticeSeq }
    if (noticeTimer !== null) clearTimer(noticeTimer)
    noticeTimer = noticeMs > 0 ? setTimer(() => ((noticeTimer = null), (notice.value = null)), noticeMs) : null
  }
  function refuseText(r: Refusal, station?: string): string {
    switch (r) {
      case 'tooManyStops':
        return t('route.mapEdit.notice.tooManyStops', { n: ROUTE_LIMITS.maxStops })
      case 'tooManyFreePoints':
        return t('route.mapEdit.notice.tooManyFreePoints', { n: ROUTE_LIMITS.maxFreePoints })
      case 'spacing':
        return t('route.mapEdit.notice.spacing', { m: ROUTE_LIMITS.minStopSpacingM })
      case 'outside':
        return t('route.mapEdit.notice.outside')
      case 'unreachable':
        return t('route.mapEdit.notice.unreachable')
      case 'unknownStation':
        return t('route.mapEdit.notice.unknownStation', { station: station ?? '' })
    }
  }

  /**
   * Why a stop at `at` would be refused (null = allowed). `adding`: a new stop of `kind`; `except`:
   * the stop being moved (it does not count against itself).
   */
  function refusal(at: { lon: number; lat: number }, kind: 'point' | 'station', adding: boolean, except?: StopId): Refusal | null {
    const s = stops()
    if (adding && s.length >= ROUTE_LIMITS.maxStops) return 'tooManyStops'
    if (adding && kind === 'point' && s.filter((x) => x.kind === 'point').length >= ROUTE_LIMITS.maxFreePoints) return 'tooManyFreePoints'
    if (kind === 'point') {
      const p = probe(at.lon, at.lat)
      if (p.inGrid === false) return 'outside'
      if (p.reachable === false) return 'unreachable'
    }
    const near = (b: { lon: number; lat: number } | null) => !!b && distanceM(b, at) < ROUTE_LIMITS.minStopSpacingM
    if (near(padAt())) return 'spacing'
    if (s.some((x) => x.id !== except && near(posOf(x)))) return 'spacing'
    return null
  }

  /** Add a free point at lon/lat (one undo step), or refuse with a notice. */
  function addPointAt(lon: number, lat: number): boolean {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
    const at = { lon: round6(lon), lat: round6(lat) }
    const r = refusal(at, 'point', true)
    if (r) {
      say('refused', refuseText(r))
      return false
    }
    const ok = store.addStop({ kind: 'point', ...at })
    if (ok) {
      const s = stops()
      say('info', t('route.mapEdit.notice.pointAdded', { name: stopLabels(s)[s.length - 1] }))
    }
    return ok
  }

  /** Add a station (station card "Add to route", ?add=): one undo step, or a notice why not. */
  function addStation(station: string): 'added' | 'already' | Refusal {
    if (stops().some((s) => s.kind === 'station' && s.station === station)) {
      say('info', t('route.mapEdit.notice.stationInRoute', { station: stationName(station) }))
      return 'already'
    }
    const known = stations()
    const g = known.find((x) => x.id === station)
    if (known.length && !g) {
      say('refused', refuseText('unknownStation', station))
      return 'unknownStation'
    }
    const r = g ? refusal(g, 'station', true) : stops().length >= ROUTE_LIMITS.maxStops ? 'tooManyStops' : null
    if (r) {
      say('refused', refuseText(r, station))
      return r
    }
    store.addStop({ kind: 'station', station })
    say('info', t('route.mapEdit.notice.stationAdded', { station: stationName(station) }))
    return 'added'
  }

  function remove(id: StopId): boolean {
    const name = nameOf(id)
    if (drag.peek()?.id === id) drag.value = null
    const ok = store.removeStop(id)
    if (ok) say('info', t('route.mapEdit.notice.removed', { name }))
    return ok
  }

  function neighbours(id: StopId): { prev: DragState['prev']; next: DragState['next'] } {
    const s = stops()
    const i = s.findIndex((x) => x.id === id)
    return { prev: i > 0 ? posOf(s[i - 1]) : padAt(), next: i >= 0 && i < s.length - 1 ? posOf(s[i + 1]) : padAt() }
  }

  /** The click the browser fires after a drag end (W0a trap): true = swallow it. */
  function isPostDragClick(): boolean {
    if (dragEndedAt === null) return false
    const recent = now() - dragEndedAt <= POST_DRAG_CLICK_MS
    dragEndedAt = null
    return recent
  }

  const handlers: EditHandlers = {
    id: 'r3-waypoints',
    priority: R3_PRIORITY,
    click(p) {
      if (isPostDragClick()) {
        prevent(p)
        return true
      }
      if (!editing.peek()) return false
      // a click on one of our handles: the handle's own (no new point, no selection)
      if (handleStopAt(p)) {
        prevent(p)
        return true
      }
      if (otherMarkerAt(p) || featureAt?.(p)) return false
      prevent(p)
      const g = ground(p)
      addPointAt(g.lon, g.lat)
      return true // consumed even when refused: the notice is the answer, not a selection card
    },
    hover(p) {
      if (!editing.peek()) {
        if (hoverId.peek() !== null) hoverId.value = null
        return
      }
      const id = handleStopAt(p)
      if (hoverId.peek() !== id) hoverId.value = id
    },
    dragStart(p) {
      dragEndedAt = null // a new press: whatever click follows is judged on its own
      if (!editing.peek()) return false
      const id = handleStopAt(p)
      const s = id ? stops().find((x) => x.id === id) : undefined
      if (!s || s.kind !== 'point') return false
      drag.value = { id: s.id, name: nameOf(s.id), lon: s.lon, lat: s.lat, x0: p.x, y0: p.y, valid: true, ...neighbours(s.id) }
      return true
    },
    drag(p) {
      const d = drag.peek()
      if (!d) return
      const g = ground(p)
      const r = refusal(g, 'point', false, d.id)
      drag.value = { ...d, lon: g.lon, lat: g.lat, valid: r ? false : true }
    },
    dragEnd(p) {
      const d = drag.peek()
      drag.value = null
      dragEndedAt = now()
      if (!d) return
      if (Math.hypot(p.x - d.x0, p.y - d.y0) < CLICK_SLOP_PX) return // a click on the handle: stays
      // a touchend may carry no position: the last drag position is the drop
      const g = Number.isFinite(p.x) && Number.isFinite(p.y) ? ground(p) : p
      const fin = Number.isFinite(g.lon) && Number.isFinite(g.lat)
      const at = { lon: round6(fin ? g.lon : d.lon), lat: round6(fin ? g.lat : d.lat) }
      const r = refusal(at, 'point', false, d.id)
      if (r) return say('refused', refuseText(r)) // the handle snaps back (the store is unchanged)
      if (store.moveStop(d.id, at)) say('info', t('route.mapEdit.notice.pointMoved', { name: d.name }))
    },
    cursor() {
      if (!editing.peek()) return null
      if (drag.peek()) return 'grabbing'
      return hoverId.peek() ? 'grab' : 'crosshair'
    },
  }

  return {
    store,
    handlers,
    editing: editing as ReadSignal<boolean>,
    drag: drag as ReadSignal<DragState | null>,
    hoverId: hoverId as ReadSignal<StopId | null>,
    notice: notice as ReadSignal<EditNotice | null>,
    /** the free points (handles) as the map binding draws them, with their default names */
    points: computed(() => {
      const s = store.doc.value.route.stops
      const names = stopLabels(s)
      return s.flatMap((x, i) => (x.kind === 'point' ? [{ id: x.id, name: names[i], lon: x.lon, lat: x.lat }] : []))
    }),
    /** Editing is live only while the route panel / "Plan a route" is on (I1 wires it). */
    setEditing(on: boolean): void {
      if (editing.peek() === on) return
      editing.value = on
      if (!on) {
        drag.value = null
        hoverId.value = null
      }
    },
    /** Escape during a drag: nothing is applied, the handle goes back. */
    cancelDrag(): boolean {
      if (!drag.peek()) return false
      drag.value = null
      dragEndedAt = now()
      return true
    },
    setFeatureQuery(f: ((p: MapPointer) => boolean) | null): void {
      featureAt = f
    },
    /** F11: the map's terrain-aware ground pick for a pointer (planMap.ts); null = the event's lngLat */
    setGroundQuery(f: ((p: MapPointer) => { lon: number; lat: number } | null) | null): void {
      groundAt = f
    },
    addPointAt,
    addStation,
    remove,
    refusal,
    say,
    dispose(): void {
      if (noticeTimer !== null) clearTimer(noticeTimer)
      noticeTimer = null
      editing.value = false
      drag.value = null
    },
  }
}

export type PlanEditor = ReturnType<typeof createPlanEditor>
