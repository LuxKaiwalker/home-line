// PORT R3: waypoint editing on the planning state through the map extension points.
import { afterEach, describe, expect, it } from 'vitest'
import { installMapExtensions, registerEditHandlers, resetMapExtensions, type MapExtensionContext, type MapPointer } from '../../../map/extensions'
import { createPlanningStore, type PlanningStore } from '../../../state/planning'
import { distanceM, ROUTE_LIMITS, type StationGeo } from '../model'
import { createPlanEditor, CLICK_SLOP_PX, POST_DRAG_CLICK_MS, R3_PRIORITY, type PointProbe } from './planEdit'

const PAD = { lon: 137.4, lat: -4.78 }
/** ~1 km east steps: far beyond the spacing limit */
const at = (k: number) => ({ lon: Math.round((PAD.lon + 0.02 * (k + 1)) * 1e6) / 1e6, lat: PAD.lat })
const STATIONS: StationGeo[] = [
  { id: 'S1', name: 'Crater rim', lon: 137.3, lat: -4.7 },
  { id: 'S2', name: 'Ridge', lon: 137.31, lat: -4.71 },
]

/** a DOM-ish target: a handle of `stop`, another marker, or the bare canvas */
function target(kind: 'canvas' | 'marker' | { stop: string }) {
  return {
    closest(sel: string) {
      if (typeof kind === 'object' && sel.includes('data-r3-stop')) return { getAttribute: () => kind.stop }
      if (kind === 'marker' && sel.includes('maplibregl-marker')) return {}
      return null
    },
  }
}
function ev(kind: 'canvas' | 'marker' | { stop: string } = 'canvas') {
  return { button: 0, target: target(kind), defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
}
const ptr = (ll: { lon: number; lat: number }, x = 0, y = 0, kind: 'canvas' | 'marker' | { stop: string } = 'canvas'): MapPointer => ({ ...ll, x, y, originalEvent: ev(kind) as unknown as MouseEvent })

function setup(o: { probe?: (lon: number, lat: number) => PointProbe; store?: PlanningStore } = {}) {
  let t = 1000
  const store = o.store ?? createPlanningStore()
  const ed = createPlanEditor({ store, pad: () => PAD, stations: () => STATIONS, probe: o.probe, now: () => t, noticeMs: 0 })
  ed.setEditing(true)
  return { store, ed, tick: (ms: number) => (t += ms) }
}

afterEach(() => resetMapExtensions())

describe('R3 planEdit: click adds a free point', () => {
  it('a click on bare ground adds one point (one undo step) and consumes the click', () => {
    const { store, ed } = setup()
    const p = ptr(at(0))
    expect(ed.handlers.click!(p)).toBe(true)
    expect((p.originalEvent as unknown as { defaultPrevented: boolean }).defaultPrevented).toBe(true)
    const s = store.doc.peek().route.stops
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ kind: 'point', lon: at(0).lon, lat: at(0).lat })
    expect(store.canUndo.peek()).toBe(true)
    expect(ed.notice.peek()?.text).toContain('W1')
  })

  it('does nothing while editing is off (route panel closed)', () => {
    const { store, ed } = setup()
    ed.setEditing(false)
    expect(ed.handlers.click!(ptr(at(0)))).toBe(false)
    expect(ed.handlers.dragStart!(ptr(at(0)))).toBe(false)
    expect(ed.handlers.cursor!()).toBeNull()
    expect(store.doc.peek().route.stops).toHaveLength(0)
  })

  it('leaves clicks on other markers (station labels) and on station features to the map', () => {
    const { store, ed } = setup()
    expect(ed.handlers.click!(ptr(at(0), 0, 0, 'marker'))).toBe(false)
    ed.setFeatureQuery(() => true)
    expect(ed.handlers.click!(ptr(at(1)))).toBe(false)
    expect(store.doc.peek().route.stops).toHaveLength(0)
  })

  it('rounds to the link precision (1e-6 deg)', () => {
    const { store, ed } = setup()
    ed.addPointAt(at(0).lon + 1.23456789e-7, at(0).lat)
    expect((store.doc.peek().route.stops[0] as { lon: number }).lon).toBe(Math.round((at(0).lon + 1.23456789e-7) * 1e6) / 1e6)
  })
})

describe('R3 planEdit: limits refuse with a notice', () => {
  it(`free points are capped only by the ${ROUTE_LIMITS.maxStops}-stop total (no separate ${ROUTE_LIMITS.maxFreePoints}-point cap, F4)`, () => {
    const { store, ed } = setup()
    for (let k = 0; k < ROUTE_LIMITS.maxStops; k++) expect(ed.addPointAt(at(k).lon, at(k).lat)).toBe(true)
    expect(ed.handlers.click!(ptr(at(9)))).toBe(true) // consumed: the notice answers, no selection card
    expect(store.doc.peek().route.stops).toHaveLength(ROUTE_LIMITS.maxStops)
    expect(ed.notice.peek()).toMatchObject({ kind: 'refused' })
    expect(ed.notice.peek()?.text).toContain(String(ROUTE_LIMITS.maxStops))
  })

  it(`at most ${ROUTE_LIMITS.maxStops} stops`, () => {
    const many: StationGeo[] = Array.from({ length: ROUTE_LIMITS.maxStops }, (_, i) => ({ id: `S${i + 1}`, lon: PAD.lon - 0.02 * (i + 1), lat: PAD.lat }))
    const store = createPlanningStore()
    const ed = createPlanEditor({ store, pad: () => PAD, stations: () => many, noticeMs: 0 })
    ed.setEditing(true)
    for (const s of many) expect(ed.addStation(s.id)).toBe('added')
    expect(ed.addPointAt(at(0).lon, at(0).lat)).toBe(false)
    expect(store.doc.peek().route.stops).toHaveLength(ROUTE_LIMITS.maxStops)
    expect(ed.notice.peek()?.text).toContain(String(ROUTE_LIMITS.maxStops))
  })

  it(`keeps ${ROUTE_LIMITS.minStopSpacingM} m from the pad and every other stop`, () => {
    const { store, ed } = setup()
    const near = { lon: PAD.lon + 0.0003, lat: PAD.lat } // ~18 m
    expect(distanceM(PAD, near)).toBeLessThan(ROUTE_LIMITS.minStopSpacingM)
    expect(ed.addPointAt(near.lon, near.lat)).toBe(false)
    expect(ed.refusal(near, 'point', true)).toBe('spacing')
    ed.addPointAt(at(0).lon, at(0).lat)
    expect(ed.addPointAt(at(0).lon + 0.0003, at(0).lat)).toBe(false)
    expect(ed.addPointAt(STATIONS[0].lon + 0.0003, STATIONS[0].lat)).toBe(true) // station not in the route
    ed.addStation('S2')
    expect(ed.addPointAt(STATIONS[1].lon + 0.0003, STATIONS[1].lat)).toBe(false)
    expect(store.doc.peek().route.stops).toHaveLength(3)
  })

  it('validity: outside the field and no known walk home are refused; unknown is accepted', () => {
    const probe = (lon: number): PointProbe => (lon > 138 ? { inGrid: false, reachable: null } : lon > 137.45 ? { inGrid: true, reachable: false } : lon > 137.43 ? { inGrid: null, reachable: null } : { inGrid: true, reachable: true })
    const { store, ed } = setup({ probe })
    expect(ed.refusal({ lon: 139, lat: PAD.lat }, 'point', true)).toBe('outside')
    expect(ed.refusal({ lon: 137.46, lat: PAD.lat }, 'point', true)).toBe('unreachable')
    expect(ed.addPointAt(137.44, PAD.lat)).toBe(true)
    expect(ed.addPointAt(137.42, PAD.lat)).toBe(true)
    expect(store.doc.peek().route.stops).toHaveLength(2)
  })
})

describe('R3 planEdit: drag, ghost, delete', () => {
  it('a drag applies nothing until the drop, then one moveStop; a refused drop snaps back', () => {
    const probe = (lon: number): PointProbe => ({ inGrid: lon < 137.6, reachable: true })
    const { store, ed } = setup({ probe })
    ed.addPointAt(at(0).lon, at(0).lat)
    ed.addPointAt(at(2).lon, at(2).lat)
    const id = store.doc.peek().route.stops[0].id
    const before = store.doc.peek()
    expect(ed.handlers.dragStart!(ptr(at(0), 10, 10, { stop: id }))).toBe(true)
    expect(ed.drag.peek()).toMatchObject({ id, name: 'W1', prev: PAD })
    expect(ed.drag.peek()?.next).toEqual({ lon: at(2).lon, lat: at(2).lat })
    ed.handlers.drag!(ptr(at(1), 40, 10))
    expect(store.doc.peek()).toBe(before) // D85: nothing during the drag
    expect(ed.drag.peek()).toMatchObject({ lon: at(1).lon, valid: true })
    expect(ed.handlers.cursor!()).toBe('grabbing')
    ed.handlers.drag!(ptr({ lon: 137.7, lat: PAD.lat }, 90, 10))
    expect(ed.drag.peek()?.valid).toBe(false) // marked while dragging
    ed.handlers.dragEnd!(ptr({ lon: 137.7, lat: PAD.lat }, 90, 10))
    expect(store.doc.peek()).toBe(before) // refused: snaps back
    expect(ed.notice.peek()?.kind).toBe('refused')
    ed.handlers.dragStart!(ptr(at(0), 10, 10, { stop: id }))
    ed.handlers.dragEnd!(ptr(at(1), 40, 10))
    expect(store.doc.peek().route.stops[0]).toMatchObject({ id, lon: at(1).lon })
    store.undo()
    expect(store.doc.peek().route.stops[0]).toMatchObject({ id, lon: at(0).lon })
  })

  it('a press on a station stop or bare ground does not start a drag', () => {
    const { store, ed } = setup()
    ed.addStation('S1')
    const sid = store.doc.peek().route.stops[0].id
    expect(ed.handlers.dragStart!(ptr(at(0), 0, 0, { stop: sid }))).toBe(false)
    expect(ed.handlers.dragStart!(ptr(at(0)))).toBe(false)
  })

  it('a release within the click slop is a click on the handle (no move)', () => {
    const { store, ed } = setup()
    ed.addPointAt(at(0).lon, at(0).lat)
    const id = store.doc.peek().route.stops[0].id
    const before = store.doc.peek()
    ed.handlers.dragStart!(ptr(at(0), 10, 10, { stop: id }))
    ed.handlers.dragEnd!(ptr(at(1), 10 + CLICK_SLOP_PX - 1, 10))
    expect(store.doc.peek()).toBe(before)
  })

  it('remove deletes the stop (one undo step) with a notice; Escape cancels a drag', () => {
    const { store, ed } = setup()
    ed.addPointAt(at(0).lon, at(0).lat)
    const id = store.doc.peek().route.stops[0].id
    ed.handlers.dragStart!(ptr(at(0), 0, 0, { stop: id }))
    expect(ed.cancelDrag()).toBe(true)
    expect(ed.drag.peek()).toBeNull()
    expect(ed.remove(id)).toBe(true)
    expect(store.doc.peek().route.stops).toHaveLength(0)
    expect(ed.notice.peek()?.text).toContain('W1')
    store.undo()
    expect(store.doc.peek().route.stops).toHaveLength(1)
  })

  it('every edit gives visible feedback within 200 ms (synchronous store change or notice)', () => {
    const { store, ed } = setup()
    const t0 = performance.now()
    for (let k = 0; k < ROUTE_LIMITS.maxStops + 2; k++) ed.handlers.click!(ptr(at(k)))
    expect(performance.now() - t0).toBeLessThan(200)
    expect(store.doc.peek().route.stops).toHaveLength(ROUTE_LIMITS.maxStops)
  })
})

// ---- through map/extensions.ts (the W0a traps) ---------------------------------------------------

function fakeCtx() {
  const handlers = new Map<string, ((e: unknown) => void)[]>()
  const canvas = { style: { cursor: '' } }
  const map = { on: (t: string, f: (e: unknown) => void) => handlers.set(t, [...(handlers.get(t) ?? []), f]), off: (t: string) => handlers.delete(t), getCanvas: () => canvas }
  const ctx = { map, beforeId: () => undefined, marker: () => ({}), inShell: true } as unknown as MapExtensionContext
  const fire = (t: string, ll: { lon: number; lat: number }, x = 0, y = 0, kind: 'canvas' | 'marker' | { stop: string } = 'canvas') => {
    const originalEvent = ev(kind)
    for (const f of handlers.get(t) ?? []) f({ lngLat: { lng: ll.lon, lat: ll.lat }, point: { x, y }, originalEvent })
    return originalEvent
  }
  return { ctx, fire, canvas }
}

describe('R3 on the map extension points', () => {
  it('handler priority: R3 runs before default-priority handlers and the first consumer wins', () => {
    const { store, ed } = setup()
    const log: string[] = []
    registerEditHandlers({ id: 'other', click: () => (log.push('other'), true) })
    registerEditHandlers(ed.handlers)
    registerEditHandlers({ id: 'above', priority: R3_PRIORITY + 1, click: () => (log.push('above'), false) })
    const { ctx, fire, canvas } = fakeCtx()
    const host = installMapExtensions(ctx)
    const e = fire('click', at(0))
    expect(log).toEqual(['above']) // R3 consumed: 'other' never saw it
    expect(e.defaultPrevented).toBe(true) // MapSelection can skip a consumed click (I1 request)
    expect(store.doc.peek().route.stops).toHaveLength(1)
    ed.setEditing(false)
    fire('click', at(1))
    expect(log).toEqual(['above', 'above', 'other']) // editing off: R3 passes
    ed.setEditing(true)
    fire('mousemove', at(2))
    expect(canvas.style.cursor).toBe('crosshair')
    host.destroy()
  })

  it('drag then click: the click after a drag end adds nothing and reaches nobody', () => {
    const { store, ed, tick } = setup()
    const log: string[] = []
    registerEditHandlers(ed.handlers)
    registerEditHandlers({ id: 'selection-like', click: () => (log.push('select'), true) })
    const { ctx, fire } = fakeCtx()
    const host = installMapExtensions(ctx)
    ed.addPointAt(at(0).lon, at(0).lat)
    const id = store.doc.peek().route.stops[0].id
    fire('mousedown', at(0), 10, 10, { stop: id })
    fire('mousemove', at(1), 60, 10)
    fire('mouseup', at(1), 60, 10)
    tick(5)
    const e = fire('click', at(1), 60, 10)
    expect(e.defaultPrevented).toBe(true)
    expect(log).toEqual([])
    const s = store.doc.peek().route.stops
    expect(s).toHaveLength(1) // no second point at the drop
    expect(s[0]).toMatchObject({ id, lon: at(1).lon })
    // the next real click is a click again
    tick(POST_DRAG_CLICK_MS + 1)
    fire('mousedown', at(3), 200, 10)
    fire('mouseup', at(3), 200, 10)
    fire('click', at(3), 200, 10)
    expect(store.doc.peek().route.stops).toHaveLength(2)
    host.destroy()
  })

  it('a long drag that fires no map click does not swallow a later click', () => {
    const { store, ed, tick } = setup()
    registerEditHandlers(ed.handlers)
    const { ctx, fire } = fakeCtx()
    const host = installMapExtensions(ctx)
    ed.addPointAt(at(0).lon, at(0).lat)
    const id = store.doc.peek().route.stops[0].id
    fire('mousedown', at(0), 10, 10, { stop: id })
    fire('mouseup', at(1), 60, 10)
    tick(POST_DRAG_CLICK_MS + 50)
    fire('click', at(3), 200, 10)
    expect(store.doc.peek().route.stops).toHaveLength(2)
    host.destroy()
  })

  it('a click on a handle consumes it without adding a point', () => {
    const { store, ed } = setup()
    registerEditHandlers(ed.handlers)
    const { ctx, fire } = fakeCtx()
    const host = installMapExtensions(ctx)
    ed.addPointAt(at(0).lon, at(0).lat)
    const id = store.doc.peek().route.stops[0].id
    const e = fire('click', at(0), 10, 10, { stop: id })
    expect(e.defaultPrevented).toBe(true)
    expect(store.doc.peek().route.stops).toHaveLength(1)
    host.destroy()
  })
})
