// WP12 (L6 W-1, W-4, W-5, W-7; D117) known answers:
//   W-1  one compute action: the job carries pad + crew + route as one plan_inputs; a second press
//        while it runs starts no job (it only asks for the progress to be focused)
//   W-4  ticking a station while the engine chooses switches to "My order" and adds it: one undo step
//   W-5  one undo behind the global Ctrl/Cmd-Z (ui/shell/keys.ts) for route edits and H1 plan edits,
//        in the order they were made, from focus anywhere; the buttons run the same
//   W-7  a tick keeps every row in place; an explicit reorder lays the rows out in route order
//   D117 the infeasible sentence per limit; on the map the failing leg is labelled, the route ends at
//        the last reached stop and no home leg is drawn
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteFC } from '../../data/types'
import { missionPlanKey } from './mount'
import { consoleRouteMap, FAILING_LEG_ID, ROUTE_END_ID, walkedRoute, type RouteConsoleMap } from './map'
import { mission } from '../../state/mission'
import { installShortcuts } from '../../ui/shell/keys'
import { installPlanEdit, missionApply } from '../../edit/bind'
import { buildCatalog } from '../../edit/options'
import { createPlanEditStore } from '../../edit/store'
import { createRouteController, type RouteJobs } from '../../edit/route/controller'
import { rowIds, routePayload, type StationGeo } from '../../edit/route/model'
import { routeRows } from '../../edit/route/panel'
import { createRouteStore, registerRouteDraftTarget, setRouteDraft } from '../../edit/route/store'
import { FakeWindow, keydown } from '../../edit/route/testing'
import { infeasibleText } from '../../edit/route/text'
import { createSharedUndo } from '../../edit/route/undo'

const PUB = resolve(__dirname, '../../../public/data')
const json = (p: string) => JSON.parse(readFileSync(resolve(PUB, p), 'utf8'))
const catalog = buildCatalog(json('scenarios/index.json'), json('scenarios/pads/index.json'), json('stations.json'))
const stations: StationGeo[] = (json('stations.json') as StationGeo[]).map(({ id, name, lon, lat }) => ({ id, name, lon, lat }))
const PAD = { lon: 137.401783, lat: -4.77748 }
const fakeJobs = () => {
  const run = vi.fn(() => ({ promise: new Promise<never>(() => {}), cancel: () => {} }))
  return { run } as unknown as RouteJobs & { run: typeof run }
}
const missionKey = missionPlanKey(catalog)
const stops = (r: { stops: readonly unknown[] }) => r.stops.map((s) => (s as { station: string }).station)

afterEach(() => {
  mission.plan.pad.value = null
  mission.plan.scenario.value = undefined
})

describe('W-1: one compute action', () => {
  it('the job carries the pad (pad tool spot), the crew panel changes and the route as one plan_inputs', () => {
    const jobs = fakeJobs()
    const spot = { lon: 137.393301, lat: -4.776468 }
    const store = createRouteStore({
      catalog,
      plan: () => ({ scenario: catalog.padScenario, budgetMin: catalog.bandBudgetsMin[0], pad: spot, dwell: {} }),
      extra: () => ({ crew: { body_mass_kg: 90 } }),
    })
    const c = createRouteController({ store, jobs, stations, pad: () => spot })
    c.toggle('S4', true)
    c.toggle('S1', true)
    expect(c.computePlan()).toBe(true)
    expect(jobs.run).toHaveBeenCalledTimes(1)
    const inputs = (jobs.run.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(inputs.pad).toEqual(spot)
    expect(inputs.crew).toMatchObject({ body_mass_kg: 90 })
    expect((inputs.crew as Record<string, number>).suit_kg).toBeTypeOf('number') // the scenario's suit stays
    expect(inputs.route).toEqual({ mode: 'ordered', stops: [{ station: 'S4' }, { station: 'S1' }] })
    // the hash covers the crew change: a different crew, a different key
    const other = createRouteStore({ catalog, plan: () => store.step.peek().plan, extra: () => ({}) })
    other.apply(store.route.peek())
    expect(other.step.peek().key).not.toBe(store.step.peek().key)
  })

  it('auto (stops never edited): no route is sent', () => {
    const jobs = fakeJobs()
    const store = createRouteStore({ catalog })
    const c = createRouteController({ store, jobs, stations, pad: () => PAD })
    expect(c.computePlan()).toBe(true)
    expect(((jobs.run.mock.calls[0] as unknown[])[0] as Record<string, unknown>).route).toBeUndefined()
  })

  it('a second press while the job runs starts nothing and asks for the progress', () => {
    const jobs = fakeJobs()
    const store = createRouteStore({ catalog })
    const c = createRouteController({ store, jobs, stations, pad: () => PAD })
    expect(c.computePlan()).toBe(true)
    expect(c.focusRequest.peek()).toBe(0)
    expect(c.computePlan()).toBe(false)
    expect(c.computePlan()).toBe(false)
    expect(jobs.run).toHaveBeenCalledTimes(1)
    expect(c.focusRequest.peek()).toBe(2)
  })

  it('the crew panel blocks the job (a field is not a number)', async () => {
    const { signal } = await import('../../state/signal')
    const jobs = fakeJobs()
    const blocked = signal<string | null>('Crew: vo2max is not a number.')
    const c = createRouteController({ store: createRouteStore({ catalog }), jobs, stations, pad: () => PAD, blocked })
    expect(c.computePlan()).toBe(false)
    blocked.value = null
    expect(c.computePlan()).toBe(true)
    expect(jobs.run).toHaveBeenCalledTimes(1)
  })
})

describe('W-4: a tick in "Engine chooses" switches to "My order"', () => {
  it('ticking S4 in auto mode: ordered with S4, one undo step; undo restores mode and stops', () => {
    const store = createRouteStore({ catalog })
    const c = createRouteController({ store, jobs: fakeJobs(), stations, pad: () => PAD })
    expect(store.route.peek()).toEqual({ mode: 'auto', stops: [] })
    expect(c.toggle('S4', true)).toBe(true)
    expect(store.route.peek()).toEqual({ mode: 'ordered', stops: [{ station: 'S4' }] })
    expect(store.past.peek()).toHaveLength(1)
    expect(c.undo()).toBe(true)
    expect(store.route.peek()).toEqual({ mode: 'auto', stops: [] })
    expect(c.redo()).toBe(true)
    expect(routePayload(store.route.peek())).toEqual({ mode: 'ordered', stops: [{ station: 'S4' }] })
  })
})

describe('W-7: a tick keeps every row in place', () => {
  it('tick S4 then S1 at the same row positions: both ticked, in that order; a reorder resorts the rows', () => {
    const store = createRouteStore({ catalog })
    const c = createRouteController({ store, jobs: fakeJobs(), stations, pad: () => PAD })
    const ids = () => routeRows(store.route.peek(), stations, c.check.peek(), c.layout.peek()).map((r) => r.id)
    const start = ids()
    expect(start).toEqual(['S1', 'S2', 'S4', 'S6', 'S7', 'S8'])
    // click the row at screen position 2 (S4), then the row at position 0 (S1)
    c.toggle(ids()[2], true)
    expect(ids()).toEqual(start) // nothing moved under the pointer
    c.toggle(ids()[0], true)
    expect(ids()).toEqual(start)
    expect(stops(store.route.peek())).toEqual(['S4', 'S1'])
    // an explicit reorder (Alt+Up on S1) lays the rows out in route order
    c.move(1, 0)
    expect(stops(store.route.peek())).toEqual(['S1', 'S4'])
    expect(ids()).toEqual(rowIds(store.route.peek(), stations))
    expect(ids().slice(0, 2)).toEqual(['S1', 'S4'])
  })
})

describe('W-5: one undo behind the global Ctrl/Cmd-Z', () => {
  function setup() {
    const win = new FakeWindow()
    const offKeys = installShortcuts(win as unknown as Window, () => {})
    const h1 = createPlanEditStore({ catalog, onApply: missionApply })
    const offH1 = installPlanEdit(h1, { win: win as unknown as Window, actions: false })
    const store = createRouteStore({ catalog, tag: missionKey })
    const c = createRouteController({ store, jobs: fakeJobs(), stations, pad: () => PAD })
    const undo = createSharedUndo({ ctl: c, planKey: missionKey, win })
    const offUndo = undo.install()
    const outside = { localName: 'canvas' } // focus on the map, outside the panel
    const press = (init: Parameters<typeof keydown>[0]) => win.dispatchEvent(keydown({ target: outside, ...init }))
    return { win, h1, store, c, undo, press, off: () => [offUndo, offH1, offKeys].forEach((f) => f()) }
  }
  const picker = catalog.pads.find((p) => p.id !== catalog.officialPadId)!.id
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('Ctrl+Z with focus outside the panel undoes a route edit; Cmd+Shift+Z redoes it', () => {
    const { store, c, press, off } = setup()
    c.toggle('S4', true)
    c.toggle('S1', true)
    expect(press({ key: 'z', ctrlKey: true })).toBe(false) // used (default prevented)
    expect(stops(store.route.peek())).toEqual(['S4'])
    press({ key: 'z', metaKey: true })
    expect(store.route.peek()).toEqual({ mode: 'auto', stops: [] })
    press({ key: 'Z', metaKey: true, shiftKey: true })
    expect(stops(store.route.peek())).toEqual(['S4'])
    off()
  })

  it('route and rover/plan edits undo in the order they were made (one timeline)', async () => {
    const { h1, store, c, undo, press, off } = setup()
    c.toggle('S4', true) // route edit 1, on the official pad
    expect(h1.apply({ pad: picker }).ok).toBe(true) // H1: the rover moves to another pad
    undo.planChanged()
    await flush()
    expect(mission.plan.pad.peek()).toBe(picker)
    c.toggle('S1', true) // route edit 2, on that pad
    expect(undo.next('undo')).toBe('route')
    press({ key: 'z', ctrlKey: true }) // route edit 2
    expect(stops(store.route.peek())).toEqual(['S4'])
    expect(mission.plan.pad.peek()).toBe(picker)
    expect(undo.next('undo')).toBe('plan')
    press({ key: 'z', ctrlKey: true }) // the pad move (H1's own stack)
    expect(mission.plan.pad.peek()).toBeNull()
    expect(stops(store.route.peek())).toEqual(['S4'])
    press({ key: 'z', ctrlKey: true }) // route edit 1
    expect(store.route.peek()).toEqual({ mode: 'auto', stops: [] })
    expect(undo.canUndo.peek()).toBe(false)
    // redo walks forward in the same order
    press({ key: 'z', ctrlKey: true, shiftKey: true })
    expect(stops(store.route.peek())).toEqual(['S4'])
    expect(mission.plan.pad.peek()).toBeNull()
    press({ key: 'z', ctrlKey: true, shiftKey: true })
    expect(mission.plan.pad.peek()).toBe(picker)
    press({ key: 'z', ctrlKey: true, shiftKey: true })
    expect(stops(store.route.peek())).toEqual(['S4', 'S1'])
    off()
  })

  it('the buttons run the same undo; typing in a field keeps Ctrl+Z for the field', () => {
    const { store, c, undo, win, off } = setup()
    c.toggle('S4', true)
    win.dispatchEvent(keydown({ key: 'z', ctrlKey: true, target: { localName: 'input', type: 'text' } }))
    expect(stops(store.route.peek())).toEqual(['S4'])
    expect(undo.canUndo.peek()).toBe(true)
    expect(undo.undo()).toBe(true)
    expect(store.route.peek().stops).toEqual([])
    expect(undo.canUndo.peek()).toBe(false)
    expect(undo.canRedo.peek()).toBe(true)
    expect(undo.redo()).toBe(true)
    expect(stops(store.route.peek())).toEqual(['S4'])
    off()
  })
})

describe('D117: the infeasible answer', () => {
  it('O₂ is a departure-time shortfall; every limit has its own sentence; leg 1-based, whole minutes', () => {
    const f = { leg: 2, from: 'S7', to: 'S6', shortfallMin: 25.34 }
    const o2 = infeasibleText({ ...f, limit: 'O2' })
    expect(`${o2.head}: ${o2.short}`).toBe('O₂ limit on leg 3 (S7 → S6): you would need to set off 25 min earlier (conservative O₂ rule, D45)')
    expect(infeasibleText({ ...f, limit: 'daylight' }).short).toBe('the walk would end after dark: set off 25 min earlier')
    expect(infeasibleText({ ...f, limit: 'EVA duration' }).short).toBe('the route exceeds the EVA length: 25 min too long')
    expect(infeasibleText({ ...f, limit: 'dose' }).short).toBe('the route exceeds the dose allowance on this leg (25 min short)')
    expect(infeasibleText({ ...f, limit: 'O2', shortfallMin: null }).short).toContain('not reported')
  })

  it('map: the failing leg is labelled, the route ends at the last reached stop, no home leg is drawn', async () => {
    const data = new Map<string, unknown>()
    const layers: Record<string, unknown>[] = []
    const routes: (RouteFC | null)[] = []
    const box = { dataset: {} as Record<string, string> }
    const cm: RouteConsoleMap = {
      map: {
        getSource: (id) => (data.has(id) ? { setData: (d: unknown) => data.set(id, d) } : undefined),
        addSource: (id, spec) => data.set(id, spec.data),
        addLayer: (spec) => layers.push(spec),
        getLayer: (id) => layers.find((l) => l.id === id),
        getContainer: () => box as unknown as HTMLElement,
      },
      whenReady: async () => {},
      setScenarioData: async () => {},
      setRoute: async (r) => void routes.push(r),
    }
    const pins: { text: string; kind: string; at: [number, number] }[] = []
    const m = consoleRouteMap(cm, () => {}, () => true, (at, text, kind) => (pins.push({ at, text, kind }), { remove: () => {} }))
    const leg = (from: string, to: string, i: number) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[0, i], [0, i + 1]] }, properties: { from, to, leg: i } })
    const planned = { type: 'FeatureCollection', features: [leg('pad', 'S4', 0), leg('S4', 'S1', 1), leg('S1', 'pad', 2)] } as unknown as RouteFC
    await m.showStage({ stages: ['nominal'], route: planned, errors: [] })
    const s1: [number, number] = [137.4, -4.77]
    const s2: [number, number] = [137.41, -4.78]
    m.highlightLeg([s1, s2], 'fails: O₂', 2, { name: 'S1', label: 'route stops here · no way home planned', leg: 2 })
    await new Promise((r) => setTimeout(r, 0))
    // no home leg: the last route drawn ends at S1
    const drawn = routes.at(-1)!
    expect(drawn.features.map((f) => [f.properties?.from, f.properties?.to])).toEqual([['pad', 'S4'], ['S4', 'S1']])
    // the failing-leg layer and the end marker
    const fc = data.get(FAILING_LEG_ID) as GeoJSON.FeatureCollection
    expect(fc.features.map((f) => [f.geometry.type, f.properties?.state, f.properties?.label])).toEqual([
      ['LineString', 'failing', 'fails: O₂'],
      ['Point', 'end', 'route stops here · no way home planned'],
    ])
    expect((fc.features[1].geometry as GeoJSON.Point).coordinates).toEqual(s1)
    expect(layers.map((l) => l.id)).toEqual([FAILING_LEG_ID, ROUTE_END_ID])
    expect(pins.map((p) => [p.kind, p.text])).toEqual([
      ['fails', 'fails: O₂'],
      ['end', 'route stops here · no way home planned'],
    ])
    expect(box.dataset).toMatchObject({ failingLeg: '2', routeEnd: 'S1' })
    // without leg numbers the home leg (to the pad) is still dropped
    const noNum = { type: 'FeatureCollection', features: planned.features.map((f) => ({ ...f, properties: { from: f.properties?.from, to: f.properties?.to } })) } as unknown as RouteFC
    expect(walkedRoute(noNum, 2).features).toHaveLength(2)
  })
})

describe('setRouteDraft (search route builder S3a): one undoable step, validated like a manual edit', () => {
  function setup() {
    const win = new FakeWindow()
    const store = createRouteStore({ catalog, tag: missionKey })
    const c = createRouteController({ store, jobs: fakeJobs(), stations, pad: () => PAD, probe: () => ({ inGrid: true, assessed: true, walkable: true, reachable: true }) })
    const undo = createSharedUndo({ ctl: c, planKey: missionKey, win })
    const off = [registerRouteDraftTarget(c.draftTarget()), undo.install()]
    return { store, c, undo, win, off: () => off.forEach((f) => f()) }
  }

  it('no panel: nothing applied', () => {
    expect(setRouteDraft([{ station: 'S1' }])).toEqual({ ok: false, problems: [] })
  })

  it('applies the whole draft as ONE step (free points W1..); one undo (global Ctrl+Z) restores the previous route', () => {
    const { store, c, win, off } = setup()
    c.toggle('S2', true)
    const before = store.route.peek()
    const steps = store.past.peek().length
    const r = setRouteDraft([{ station: 'S4' }, { lon: 137.3962, lat: -4.7781, label: 'Dark sand' }, { station: 'S1' }])
    expect(r).toEqual({ ok: true, problems: [] })
    expect(store.route.peek()).toEqual({ mode: 'ordered', stops: [{ station: 'S4' }, { lon: 137.3962, lat: -4.7781, label: 'Dark sand' }, { station: 'S1' }] })
    expect(routeRows(store.route.peek(), stations, c.check.peek(), c.layout.peek()).slice(0, 3).map((x) => x.id)).toEqual(['S4', 'W1', 'S1'])
    expect(store.past.peek()).toHaveLength(steps + 1)
    win.dispatchEvent(keydown({ key: 'z', ctrlKey: true, target: { localName: 'canvas' } }))
    expect(store.route.peek()).toEqual(before)
    off()
  })

  it('an unknown station or a repeat is dropped and reported, the rest applies; limits and spacing refuse the draft', () => {
    const { store, off } = setup()
    expect(setRouteDraft([{ station: 'S4' }, { station: 'S99' }, { station: 'S4' }, { station: 'S1' }])).toEqual({ ok: true, problems: ['unknownStation', 'duplicate'] })
    expect(stops(store.route.peek())).toEqual(['S4', 'S1'])
    const before = store.route.peek()
    // spacing: a free point on the rover pad
    const near = setRouteDraft([{ station: 'S2' }, { lon: PAD.lon, lat: PAD.lat }])
    expect(near.ok).toBe(false)
    expect(near.problems).toContain('spacing')
    // too many free points (max 4) and too many stops (max 8)
    const pts = Array.from({ length: 5 }, (_, i) => ({ lon: 137.38 + i * 0.002, lat: -4.79 }))
    const many = setRouteDraft([...stations.map((x) => ({ station: x.id })), ...pts])
    expect(many.ok).toBe(false)
    expect(many.problems).toContain('tooMany')
    expect(store.route.peek()).toBe(before) // nothing applied silently
    off()
  })
})
