// PORT R4 acceptance: route rendering on the Plan map (interfaces §3, §9; Notion §2.4).
//  - official = the active pad's precomputed route (plan products), thin, labelled; pad switch swaps it
//  - mine = bold, numbered stops, legs from results; first infeasible leg onward in the limit token;
//    legs still computing as a dashed ghost; refined legs swap silently (setData only)
//  - toggles from planning view (toggleView) and the host's setVisible; legend entry + switches
//  - stacking in the 'route' slot; layers added once; an 8-stop update ≤ 16 ms
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMockPadService } from '../../pads/mock'
import { setPadService } from '../../pads'
import { createPlanningStore, makeStop, type PlanStop } from '../../state/planning'
import { TOKENS } from '../../ui/tokens'
import { byClass, installDom, type FakeNode } from '../../ui/testing/dom'
import { installMapExtensions, mapControlsIn, resetMapExtensions, type MapExtensionContext } from '../extensions'
import copyR4 from './copy.R4.json'
import { captureKeys, labelAt, mineView, officialLines } from './features'
import { install, mineRouteLayer, officialRouteLayer, RouteLegend } from './index'
import { MINE_LAYERS, MINE_SOURCE, OFFICIAL_LAYER, OFFICIAL_SOURCE, type ResultsSource } from './layers'
import { MOCK_ROUTE_RESULTS as R1_MOCK, type RouteResults } from '../../state/routeResults'

/** R4 fixture: pad → s1 (station S1) → s2 (point W1) → pad, the last leg infeasible. */
const MOCK_ROUTE_RESULTS: RouteResults = {
  seq: 1,
  padId: 'official',
  status: 'ready',
  legs: [
    { index: 0, fromStopId: 'pad', toStopId: 's1', minutes: 12, o2L: 20, distanceM: 600, feasible: true, path: [[137.4018, -4.7775], [137.4022, -4.7770], [137.4030, -4.7765]], mode: 'fast', refined: false },
    { index: 1, fromStopId: 's1', toStopId: 's2', minutes: 9, o2L: 15, distanceM: 450, feasible: true, path: [[137.4030, -4.7765], [137.4036, -4.7760]], mode: 'fast', refined: false },
    { index: 2, fromStopId: 's2', toStopId: 'pad', minutes: null, o2L: null, distanceM: null, feasible: false, reason: 'budget', path: [[137.4036, -4.7760], [137.4026, -4.7769], [137.4018, -4.7775]], mode: 'fast', refined: false },
  ],
  totalMinutes: null,
  marginMin: -4,
  firstInfeasibleLeg: 2,
  fastRoute: true,
}

// ---- fakes ---------------------------------------------------------------------------------------

interface FakeMarker {
  el: FakeNode
  at: [number, number] | null
  added: boolean
  setLngLat(p: [number, number]): FakeMarker
  addTo(): FakeMarker
  remove(): void
}

function fakeCtx() {
  const sources = new Map<string, { data: GeoJSON.FeatureCollection; setCalls: number }>()
  const layers: { id: string; before: string | undefined; spec: Record<string, unknown> }[] = []
  const vis = new Map<string, string>()
  const markers: FakeMarker[] = []
  const counts = { addLayer: 0, addSource: 0 }
  const map = {
    addSource(id: string, s: { data: GeoJSON.FeatureCollection }) {
      counts.addSource++
      sources.set(id, { data: s.data, setCalls: 0 })
    },
    addLayer(spec: { id: string }, before?: string) {
      counts.addLayer++
      layers.push({ id: spec.id, before, spec })
    },
    getSource: (id: string) => {
      const s = sources.get(id)
      return s && { setData: (d: GeoJSON.FeatureCollection) => ((s.data = d), s.setCalls++) }
    },
    getLayer: (id: string) => layers.find((l) => l.id === id),
    removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id), 1),
    removeSource: (id: string) => void sources.delete(id),
    setLayoutProperty: (id: string, k: string, v: string) => k === 'visibility' && vis.set(id, v),
    on: () => {},
    off: () => {},
    getCanvas: () => ({ style: { cursor: '' } }),
  }
  const ctx = {
    map,
    beforeId: (slot: string) => (slot === 'route' ? 'route-coming' : undefined),
    marker: (el: FakeNode) => {
      const mk: FakeMarker = {
        el,
        at: null,
        added: false,
        setLngLat(p) {
          mk.at = p
          return mk
        },
        addTo() {
          mk.added = true
          return mk
        },
        remove() {
          mk.added = false
        },
      }
      markers.push(mk)
      return mk
    },
    inShell: true,
  } as unknown as MapExtensionContext
  const feats = (id: string) => (sources.get(id)?.data.features ?? []) as GeoJSON.Feature<GeoJSON.LineString, Record<string, unknown>>[]
  return { ctx, sources, layers, vis, markers, counts, feats }
}

function fakeResults(initial: RouteResults = { ...MOCK_ROUTE_RESULTS, legs: [], status: 'idle', seq: 0 }) {
  let cur = initial
  const subs = new Set<(r: RouteResults) => void>()
  const src: ResultsSource & { publish(r: RouteResults): void } = {
    get: () => cur,
    subscribe: (f) => (subs.add(f), () => void subs.delete(f)),
    publish(r) {
      cur = r
      subs.forEach((f) => f(r))
    },
  }
  return src
}

const sync = (f: () => void) => f()
const S1 = makeStop({ kind: 'station', station: 'S1', id: 's1' })
const W1 = makeStop({ kind: 'point', lon: 137.4036, lat: -4.776, id: 's2' })
const twoStops = (): PlanStop[] => [S1, W1]

let restorePads: () => void = () => {}
beforeEach(() => {
  installDom()
})
afterEach(() => {
  resetMapExtensions()
  restorePads()
})

// ---- pure part -----------------------------------------------------------------------------------

describe('features', () => {
  it('official route: lines only, label on the middle of the longest line', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { leg: 0 } },
        { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[5, 5], [6, 6], [7, 7]]] }, properties: { leg: 1 } },
      ],
    }
    const lines = officialLines(fc)
    expect(lines.features.map((f) => f.geometry.type)).toEqual(['LineString', 'MultiLineString'])
    expect(labelAt(lines)).toEqual([6, 6])
    expect(officialLines(null).features).toEqual([])
    expect(labelAt(officialLines(null))).toBeNull()
  })

  it('your route from the mock results: ok legs, then the infeasible leg; numbered stops with labels', () => {
    const stops = twoStops()
    const keys = captureKeys(MOCK_ROUTE_RESULTS, stops, 'official')
    const v = mineView({ stops, padId: 'official', pad: [137.4018, -4.7775], results: MOCK_ROUTE_RESULTS, keys, stationName: (id) => (id === 'S1' ? 'Delta front' : null) })
    expect(v.fc.features.map((f) => f.properties.state)).toEqual(['ok', 'ok', 'infeasible'])
    expect(v.fc.features[0].geometry.coordinates).toEqual(MOCK_ROUTE_RESULTS.legs[0].path)
    expect(v.firstBad).toBe(2)
    expect(v.stops.map((s) => [s.n, s.label, s.infeasible])).toEqual([
      [1, 'Delta front', false],
      [2, 'W1', false],
    ])
    // the station's position comes from the result path's end when no lookup is given
    expect(v.stops[0].at).toEqual([137.403, -4.7765])
  })

  it('first infeasible leg and every later leg in the infeasible state; their stops flagged', () => {
    const stops = twoStops()
    const r: RouteResults = { ...MOCK_ROUTE_RESULTS, legs: MOCK_ROUTE_RESULTS.legs.map((l) => (l.index === 1 ? { ...l, feasible: false } : { ...l, feasible: l.index === 0 })), firstInfeasibleLeg: 1 }
    const v = mineView({ stops, padId: 'official', pad: null, results: r, keys: captureKeys(r, stops, 'official') })
    expect(v.fc.features.map((f) => f.properties.state)).toEqual(['ok', 'infeasible', 'infeasible'])
    expect(v.stops.map((s) => s.infeasible)).toEqual([false, true])
  })

  it('legs still computing are ghosts (straight line between the ends)', () => {
    const stops = twoStops()
    const r: RouteResults = { ...MOCK_ROUTE_RESULTS, status: 'partial', legs: [MOCK_ROUTE_RESULTS.legs[0]], firstInfeasibleLeg: null }
    const v = mineView({ stops, padId: 'official', pad: [137.4018, -4.7775], results: r, keys: captureKeys(r, stops, 'official') })
    expect(v.fc.features.map((f) => f.properties.state)).toEqual(['ok', 'ghost', 'ghost'])
    expect(v.fc.features[1].geometry.coordinates).toEqual([[137.403, -4.7765], [137.4036, -4.776]])
    expect(v.fc.features[2].geometry.coordinates).toEqual([[137.4036, -4.776], [137.4018, -4.7775]])
  })

  it('a moved point turns its two legs back into ghosts until the core answers again', () => {
    const stops = twoStops()
    const keys = captureKeys(MOCK_ROUTE_RESULTS, stops, 'official')
    const moved = [S1, { ...W1, lon: 137.405 } as PlanStop]
    const v = mineView({ stops: moved, padId: 'official', pad: [137.4018, -4.7775], results: MOCK_ROUTE_RESULTS, keys })
    expect(v.fc.features.map((f) => f.properties.state)).toEqual(['ok', 'ghost', 'ghost'])
    expect(v.firstBad).toBeNull()
  })

  it('results of another pad are not drawn as answers', () => {
    const stops = twoStops()
    const v = mineView({ stops, padId: 'rank2', pad: [137.3933, -4.7765], results: MOCK_ROUTE_RESULTS, keys: captureKeys(MOCK_ROUTE_RESULTS, stops, 'rank2'), stationAt: () => [137.403, -4.7765] })
    expect(v.fc.features.map((f) => f.properties.state)).toEqual(['ghost', 'ghost', 'ghost'])
  })

  it('R1 mock (state/routeResults): an infeasible leg without a path is a straight line in the infeasible state', () => {
    const stops: PlanStop[] = [makeStop({ kind: 'point', lon: 137.396, lat: -4.772, id: 'w1' }), makeStop({ kind: 'station', station: 'S3', id: 's3' })]
    const v = mineView({ stops, padId: 'official', pad: [137.385, -4.78], results: R1_MOCK, keys: captureKeys(R1_MOCK, stops, 'official') })
    expect(v.fc.features.map((f) => [f.properties.state, f.properties.refined])).toEqual([
      ['ok', false],
      ['ok', true],
      ['infeasible', false],
    ])
    expect(v.fc.features[2].geometry.coordinates).toEqual([[137.408, -4.765], [137.385, -4.78]])
    expect(v.stops.map((s) => [s.n, s.label])).toEqual([
      [1, 'W1'],
      [2, 'S3'],
    ])
  })

  it('no stops: nothing drawn', () => {
    const v = mineView({ stops: [], padId: 'official', pad: null, results: MOCK_ROUTE_RESULTS, keys: new Map() })
    expect(v.fc.features).toEqual([])
    expect(v.stops).toEqual([])
  })
})

// ---- map layers ----------------------------------------------------------------------------------

describe('mine layer', () => {
  function setup(stops = twoStops()) {
    const store = createPlanningStore({ initial: { route: { stops, startUtc: null, storm: false } } })
    restorePads = setPadService(createMockPadService())
    const results = fakeResults()
    const f = fakeCtx()
    const handle = mineRouteLayer({ store, results, schedule: sync }).install(f.ctx)
    return { store, results, handle, ...f }
  }

  it('adds its layers once in the route slot, bold line + casing + infeasible + ghost in tokens', () => {
    const { layers, counts } = setup()
    expect(layers.map((l) => l.id)).toEqual([...MINE_LAYERS])
    expect(layers.every((l) => l.before === 'route-coming')).toBe(true)
    expect(counts.addSource).toBe(1)
    const paint = (id: string) => (layers.find((l) => l.id === id)!.spec as { paint: Record<string, unknown> }).paint
    expect(paint('r4-mine-bad')['line-color']).toBe(TOKENS.color.limit)
    expect(paint('r4-mine-ok')['line-color']).toBe(TOKENS.color.text)
    expect(paint('r4-mine-ok')['line-width']).toBeGreaterThan(TOKENS.line.fieldEdgePx)
    expect(paint('r4-mine-ghost')['line-dasharray']).toBeDefined()
  })

  it('draws ghosts before results, then the computed legs; refined legs swap silently', () => {
    const { results, feats, sources, counts, markers } = setup()
    // no answer yet: the station has no position (no lookup, no results), so only W1 -> pad is drawn, as a ghost
    expect(feats(MINE_SOURCE).map((f) => [f.properties.leg, f.properties.state])).toEqual([[2, 'ghost']])
    expect(markers.filter((m) => m.added).map((m) => m.el.textContent)).toEqual(['2'])
    results.publish(MOCK_ROUTE_RESULTS)
    expect(feats(MINE_SOURCE).map((f) => f.properties.state)).toEqual(['ok', 'ok', 'infeasible'])
    const before = sources.get(MINE_SOURCE)!.setCalls
    const refinedPath: [number, number][] = [[137.403, -4.7765], [137.4033, -4.7763], [137.4036, -4.776]]
    results.publish({ ...MOCK_ROUTE_RESULTS, seq: 2, legs: MOCK_ROUTE_RESULTS.legs.map((l) => (l.index === 1 ? { ...l, path: refinedPath, mode: 'exact', refined: true } : l)) })
    expect(sources.get(MINE_SOURCE)!.setCalls).toBe(before + 1)
    expect(feats(MINE_SOURCE)[1].geometry.coordinates).toEqual(refinedPath)
    expect(feats(MINE_SOURCE)[1].properties).toMatchObject({ state: 'ok', refined: true })
    expect(counts.addLayer).toBe(MINE_LAYERS.length)
    // numbered stops
    const shown = markers.filter((m) => m.added)
    expect(shown.map((m) => m.el.textContent)).toEqual(['1', '2'])
    expect(shown[1].el.getAttribute('title')).toBe('Stop 2: W1')
  })

  it('editing the route re-renders from the store (ghost for the new leg) without re-adding layers', () => {
    const { store, results, feats, counts, markers } = setup()
    results.publish(MOCK_ROUTE_RESULTS)
    store.addStop({ kind: 'point', lon: 137.41, lat: -4.78, id: 's3' })
    expect(feats(MINE_SOURCE).map((f) => f.properties.state)).toEqual(['ok', 'ok', 'ghost', 'ghost'])
    expect(markers.filter((m) => m.added).map((m) => m.el.textContent)).toEqual(['1', '2', '3'])
    store.removeStop('s3')
    store.removeStop('s2')
    expect(markers.filter((m) => m.added).map((m) => m.el.textContent)).toEqual(['1'])
    expect(counts.addLayer).toBe(MINE_LAYERS.length)
  })

  it('view.showMine (toggleView) and the host switch hide lines and numbers; destroy removes all', () => {
    const { store, results, handle, vis, markers, layers, sources } = setup()
    results.publish(MOCK_ROUTE_RESULTS)
    store.toggleView('showMine', false)
    expect(MINE_LAYERS.map((id) => vis.get(id))).toEqual(MINE_LAYERS.map(() => 'none'))
    expect(markers.some((m) => m.added)).toBe(false)
    store.toggleView('showMine', true)
    expect(vis.get('r4-mine-ok')).toBe('visible')
    expect(markers.filter((m) => m.added)).toHaveLength(2)
    handle.setVisible(false)
    expect(vis.get('r4-mine-ok')).toBe('none')
    expect(markers.some((m) => m.added)).toBe(false)
    handle.setVisible(true)
    handle.destroy()
    expect(layers).toEqual([])
    expect(sources.has(MINE_SOURCE)).toBe(false)
    expect(markers.some((m) => m.added)).toBe(false)
  })

  it('perf: an 8-stop route updates in ≤ 16 ms per frame (setData only)', () => {
    const stops = Array.from({ length: 8 }, (_, i) => makeStop({ kind: 'point', lon: 137.39 + i * 0.002, lat: -4.78 + (i % 2) * 0.002, id: `p${i}` }))
    const { results, sources, counts } = setup(stops)
    const ends: [number, number][] = [[137.4018, -4.7775], ...stops.map((s) => [(s as { lon: number }).lon, (s as { lat: number }).lat] as [number, number]), [137.4018, -4.7775]]
    const legsFor = (seq: number) =>
      ends.slice(0, -1).map((a, i) => {
        const b = ends[i + 1]
        const path = Array.from({ length: 600 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / 599, a[1] + ((b[1] - a[1]) * k) / 599 + (seq % 2) * 1e-7] as [number, number])
        return { index: i, fromStopId: i ? stops[i - 1].id : 'pad', toStopId: i < 8 ? stops[i].id : 'pad', minutes: 5, o2L: 1, distanceM: 100, feasible: i < 6, path, mode: 'fast' as const, refined: false }
      })
    const N = 60
    const frames: RouteResults[] = Array.from({ length: N }, (_, k) => ({ ...MOCK_ROUTE_RESULTS, seq: k + 1, legs: legsFor(k + 1), firstInfeasibleLeg: 6 }))
    const ms: number[] = []
    for (const r of frames) {
      const t0 = performance.now()
      results.publish(r)
      ms.push(performance.now() - t0)
    }
    // median per frame (robust to a loaded box); the budget is one 60 Hz frame
    const median = [...ms].sort((a, b) => a - b)[N >> 1]
    expect(median).toBeLessThanOrEqual(16)
    expect(counts.addLayer).toBe(MINE_LAYERS.length)
    expect(sources.get(MINE_SOURCE)!.setCalls).toBe(N + 1)
  })

  it('coalesces several changes in one frame into one render', () => {
    const store = createPlanningStore({ initial: { route: { stops: twoStops(), startUtc: null, storm: false } } })
    restorePads = setPadService(createMockPadService())
    const queue: (() => void)[] = []
    const results = fakeResults()
    const { ctx, sources } = fakeCtx()
    mineRouteLayer({ store, results, schedule: (f) => queue.push(f) }).install(ctx)
    const base = sources.get(MINE_SOURCE)!.setCalls
    results.publish(MOCK_ROUTE_RESULTS)
    store.addStop({ kind: 'point', lon: 137.41, lat: -4.78 })
    store.toggleView('showMine', false)
    expect(queue).toHaveLength(1)
    queue.splice(0).forEach((f) => f())
    expect(sources.get(MINE_SOURCE)!.setCalls).toBe(base + 1)
  })
})

describe('official layer', () => {
  const route = (x: number) => ({
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[x, -4.77], [x + 0.001, -4.771], [x + 0.002, -4.772]] }, properties: { leg: 0 } },
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [x, -4.77] }, properties: {} },
    ],
  })
  const products = (id: string) => ({ bands: { type: 'FeatureCollection' as const, features: [] }, edges: { type: 'FeatureCollection' as const, features: [] }, partner: null, route: id === 'rank4' ? null : route(id === 'official' ? 137.4 : 137.39), timeline: null })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('draws the active pad’s precomputed route thin, labelled, and swaps it on a pad switch', async () => {
    const store = createPlanningStore()
    restorePads = setPadService(createMockPadService({ products }))
    const { ctx, layers, feats, markers } = fakeCtx()
    const h = officialRouteLayer({ store }).install(ctx)
    expect(layers.map((l) => [l.id, l.before])).toEqual([[OFFICIAL_LAYER, 'route-coming']])
    const paint = (layers[0].spec as { paint: Record<string, unknown> }).paint
    expect(paint['line-color']).toBe(TOKENS.color.safe)
    expect(paint['line-width']).toBe(TOKENS.line.fieldEdgePx)
    await flush()
    expect(feats(OFFICIAL_SOURCE)).toHaveLength(1)
    expect(feats(OFFICIAL_SOURCE)[0].geometry.coordinates[0]).toEqual([137.4, -4.77])
    const label = markers.find((m) => m.added)!
    expect(label.el.textContent).toBe('Official route for this pad')
    expect(label.at).toEqual([137.401, -4.771])

    store.setPad('rank2')
    expect(feats(OFFICIAL_SOURCE)).toHaveLength(0) // never the old pad's route under the new pad
    await flush()
    expect(feats(OFFICIAL_SOURCE)[0].geometry.coordinates[0]).toEqual([137.39, -4.77])

    store.setPad('rank4') // a pad without a precomputed route: nothing drawn, no label
    await flush()
    expect(feats(OFFICIAL_SOURCE)).toHaveLength(0)
    expect(markers.some((m) => m.added)).toBe(false)
    h.destroy()
    expect(layers).toEqual([])
  })

  it('a slow load of an earlier pad never overwrites the active pad’s route', async () => {
    const store = createPlanningStore()
    restorePads = setPadService(createMockPadService({ products, delayMs: 5 }))
    const { ctx, feats } = fakeCtx()
    officialRouteLayer({ store }).install(ctx)
    store.setPad('rank2')
    await new Promise((r) => setTimeout(r, 30))
    expect(feats(OFFICIAL_SOURCE)[0].geometry.coordinates[0]).toEqual([137.39, -4.77])
  })

  it('view.showOfficial and the host switch hide line and label; a failing pad draws nothing', async () => {
    const store = createPlanningStore()
    restorePads = setPadService(createMockPadService({ products, failing: ['rank3'] }))
    const { ctx, vis, markers, feats } = fakeCtx()
    const h = officialRouteLayer({ store }).install(ctx)
    await flush()
    store.toggleView('showOfficial', false)
    expect(vis.get(OFFICIAL_LAYER)).toBe('none')
    expect(markers.some((m) => m.added)).toBe(false)
    store.toggleView('showOfficial', true)
    expect(vis.get(OFFICIAL_LAYER)).toBe('visible')
    expect(markers.some((m) => m.added)).toBe(true)
    h.setVisible(false)
    expect(vis.get(OFFICIAL_LAYER)).toBe('none')
    h.setVisible(true)
    store.setPad('rank3')
    await flush()
    expect(feats(OFFICIAL_SOURCE)).toHaveLength(0)
  })
})

describe('install + legend', () => {
  it('registers both route kinds (ConsoleMap.routeLayers) and the legend control; dispose removes them', () => {
    const store = createPlanningStore()
    restorePads = setPadService(createMockPadService())
    const off = install({ store, results: fakeResults(), schedule: sync })
    const { ctx, layers } = fakeCtx()
    const host = installMapExtensions(ctx)
    expect(host.routeLayer('official')).toBeDefined()
    expect(host.routeLayer('mine')).toBeDefined()
    expect(mapControlsIn('layers-popover').map((c) => c.id)).toEqual(['routes'])
    expect(layers.map((l) => l.id)).toEqual([OFFICIAL_LAYER, ...MINE_LAYERS])
    off()
    expect(host.routeLayer('official')).toBeUndefined()
    expect(host.routeLayer('mine')).toBeUndefined()
    expect(mapControlsIn('layers-popover')).toEqual([])
    expect(layers).toEqual([])
    host.destroy()
  })

  it('legend: two switches bound to the planning view, swatches for the four looks', () => {
    const store = createPlanningStore()
    const { container } = installDom()
    act(() => render(<RouteLegend store={store} />, container as unknown as Element))
    const toggles = byClass(container, 'hl-toggle')
    expect(toggles.map((t) => t.getAttribute('aria-checked'))).toEqual(['true', 'true'])
    expect(byClass(container, 'hl-legend-row__label').map((n) => n.textContent)).toEqual(['Official route for this pad', 'Your route', 'Not feasible from here on', 'Still computing'])
    act(() => void toggles[0].dispatch('click', {}))
    expect(store.view.peek().showOfficial).toBe(false)
    expect(byClass(container, 'hl-toggle')[0].getAttribute('aria-checked')).toBe('false')
    act(() => void byClass(container, 'hl-toggle')[1].dispatch('click', {}))
    expect(store.view.peek()).toEqual({ showOfficial: false, showMine: false })
    act(() => render(null, container as unknown as Element))
  })

  it('copy: the seed strings of route.map, no digits outside placeholders', () => {
    const seed = JSON.parse(readFileSync(resolve(__dirname, '../../ui/copy.json'), 'utf8')).route.map
    expect(copyR4.official).toBe(seed.official)
    expect(copyR4.mine).toBe(seed.mine)
    for (const v of Object.values(copyR4)) expect(v.replace(/\{[a-z_]+\}/g, '')).not.toMatch(/\d/)
  })
})
