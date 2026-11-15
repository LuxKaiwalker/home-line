// R1 (Plan port): the planning runner on the REAL published data. The numbers it publishes are the
// core's (computeBrowserRoute on a fresh leg cache), the stale results of older edits never land, and
// every edit is timed (J1h / Notion §2.5: <= 200 ms per edit; D137 known slow long legs).
/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CONFIG } from '../../../config'
import { createMockPadService } from '../../../pads/mock'
import { createPlanningStore, toRouteStops, type PlanningStore } from '../../../state/planning'
import { getRouteResults, MOCK_ROUTE_RESULTS, resetRouteResults, type RouteResults } from '../../../state/routeResults'
import { LegRouter } from '../map/router'
import { computeBrowserRoute } from './compute'
import type { BrowserRouteData } from './data'
import { PAD_STOP_ID, padRouteData, startPlanningRunner, stopDwell, toRouteResults, type PlanningRunner, type RunnerOptions, type WorkerPort } from './runner'
import { freePointNear, HAS_DATA, J, loadFromFiles } from './testData'
import { createRouteWorkerHandler } from './worker'
import type { RouteWorkerRequest, RouteWorkerResponse } from './worker.types'
import type { PadFile } from '../../../data/types'
import type { PadEnv } from '../../../pads/types'

/** The worker in-process: messages structured-cloned both ways, steps on real timers (as in a Worker). */
function inProcess(log?: RouteWorkerRequest[]): RunnerOptions['connect'] {
  return (onMessage: (m: RouteWorkerResponse) => void): WorkerPort => {
    let dead = false
    const h = createRouteWorkerHandler((m) => setTimeout(() => !dead && onMessage(structuredClone(m)), 0))
    return {
      post: (m) => {
        log?.push(m)
        const c = structuredClone(m)
        setTimeout(() => !dead && h.handle(c), 0)
      },
      terminate: () => void (dead = true),
    }
  }
}

/** A copy of the data with an empty leg cache and its own router (the core from scratch). */
const fresh = (d: BrowserRouteData): BrowserRouteData => ({ ...d, router: new LegRouter(d.grid, d.model), legCache: new Map(), components: new Map() })
const strip = (r: RouteResults) => ({ ...r, seq: 0, timingMs: undefined })

let runner: PlanningRunner | null = null
afterEach(() => {
  runner?.stop()
  runner = null
  resetRouteResults()
})

describe('runner helpers', () => {
  it('stopDwell: the stop minutes of the plan; a station left at 0 keeps its stations.json dwell', () => {
    const s = createPlanningStore()
    s.addStop({ kind: 'station', station: 'S1' })
    s.addStop({ kind: 'station', station: 'S2', stopMin: 12 })
    s.addStop({ kind: 'point', lon: 137.4, lat: -4.8 })
    s.addStop({ kind: 'point', lon: 137.41, lat: -4.8, stopMin: 7 })
    expect(stopDwell(s.state.peek().route.stops)).toEqual([undefined, 12, 0, 7])
  })

  it('MOCK_ROUTE_RESULTS has the shape the runner publishes (pad sentinel id)', () => {
    expect(MOCK_ROUTE_RESULTS.legs[0].fromStopId).toBe(PAD_STOP_ID)
  })
})

describe.skipIf(!HAS_DATA)('planning runner on the official pad (real data, nom_104)', () => {
  let d: BrowserRouteData
  let store: PlanningStore
  const pads = createMockPadService()
  beforeAll(async () => {
    d = await loadFromFiles(CONFIG.defaultScenario)
  }, 60_000)
  const start = (o: RunnerOptions = {}) => {
    store = createPlanningStore()
    const base = fresh(d)
    runner = startPlanningRunner(store, pads, { connect: inProcess(), loadData: async () => base, ...o })
    return { base }
  }

  it('no stops → idle; stations + a free point → ready with the core\'s numbers (exact = a fresh computeBrowserRoute)', async () => {
    const seen: RouteResults[] = []
    start({ publish: (r) => seen.push(r), mode: 'exact' })
    expect((await runner!.settled()).status).toBe('idle')
    const w1 = freePointNear(d, d.fieldsPad.lon, d.fieldsPad.lat, 200, 0)
    store.addStop({ kind: 'station', station: 'S4' })
    store.addStop({ kind: 'point', ...w1, stopMin: 10 })
    store.addStop({ kind: 'station', station: 'S1', stopMin: 20 })
    const r = await runner!.settled()
    expect(r.status).toBe('ready')
    const stops = store.state.peek().route.stops
    const core = computeBrowserRoute({ ...fresh(d), storm: store.state.peek().route.storm }, d.fieldsPad, toRouteStops(stops), { dwellMin: stopDwell(stops) })
    expect(strip(r)).toEqual(strip(toRouteResults(core, { seq: 0, padId: 'official', stops, modes: () => ({ mode: 'exact', refined: false, capped: false }) })))
    expect(r.legs).toHaveLength(4) // pad -> S4 -> W1 -> S1 -> pad (the way home on the pointer field)
    expect(r.legs.map((l) => [l.fromStopId, l.toStopId])).toEqual([[PAD_STOP_ID, stops[0].id], [stops[0].id, stops[1].id], [stops[1].id, stops[2].id], [stops[2].id, PAD_STOP_ID]])
    expect(r.totalMinutes).toBe(core.totals.evaMin)
    expect(r.marginMin).toBe(core.tightest!.marginMin)
    expect(r.legs.every((l) => l.feasible && l.minutes! > 0 && l.path.length > 1)).toBe(true)
    expect(r.fastRoute).toBe(false)
    expect(seen.some((x) => x.status === 'computing')).toBe(true)
    // a partial publish came before the ready one (legs routed one by one in the worker)
    const iReady = seen.indexOf(r)
    expect(seen.slice(0, iReady).some((x) => x.status === 'partial' && x.legs.length > 0)).toBe(true)
    // the planned stop minutes count (Mission semantics): stops 0 / 10 / 20 + S4's dwell
    expect(core.dwellMin).toEqual([d.stations.find((s) => s.id === 'S4')!.dwellMin, 10, 20])
    expect(runner!.lastResult()?.result.totals.evaMin).toBe(core.totals.evaMin)
  }, 60_000)

  it('fast mode (default): labelled fast, each leg within w x the exact one; the idle refine converges to the exact numbers and clears fastRoute; planning StopIds throughout', async () => {
    const seen: RouteResults[] = []
    // no per-leg cap here: the bound under test is w (the cap is a timing matter, per-edit test below)
    start({ publish: (r) => seen.push(r), legCapMs: 60_000 })
    await runner!.settled()
    const w1 = freePointNear(d, d.fieldsPad.lon, d.fieldsPad.lat, 200, 0)
    store.addStop({ kind: 'station', station: 'S4' })
    store.addStop({ kind: 'point', ...w1, stopMin: 10 })
    store.addStop({ kind: 'station', station: 'S1', stopMin: 20 })
    const r = await runner!.settled()
    const stops = store.state.peek().route.stops
    const core = computeBrowserRoute({ ...fresh(d), storm: store.state.peek().route.storm }, d.fieldsPad, toRouteStops(stops), { dwellMin: stopDwell(stops) })
    expect(r.status).toBe('ready')
    expect(r.fastRoute).toBe(true)
    r.legs.slice(0, 3).forEach((l, i) => {
      expect(l).toMatchObject({ mode: 'fast', refined: false, feasible: true })
      expect(l.minutes!).toBeGreaterThanOrEqual(core.legs[i].walkMin! - 1e-9)
      expect(l.minutes!).toBeLessThanOrEqual(1.6 * core.legs[i].walkMin! + 1e-9)
    })
    expect(r.legs[3]).toMatchObject({ mode: 'exact', minutes: core.legs[3].walkMin }) // the way home: pointer field
    // the idle refine (worker, sliced) replaces / confirms the legs; the route is recomputed each time
    const t0 = Date.now()
    while (!seen.some((x) => x.seq === r.seq && x.status === 'ready' && !x.fastRoute)) {
      expect(Date.now() - t0).toBeLessThan(50_000)
      await new Promise((res) => setTimeout(res, 20))
    }
    const done = seen.find((x) => x.seq === r.seq && x.status === 'ready' && !x.fastRoute)!
    expect(done.legs.every((l) => l.mode === 'exact')).toBe(true)
    expect(done.legs.slice(0, 3).every((l) => l.refined)).toBe(true)
    const unflag = (x: RouteResults) => ({ ...strip(x), legs: x.legs.map((l) => ({ ...l, refined: false })) })
    expect(unflag(done)).toEqual(unflag(toRouteResults(core, { seq: 0, padId: 'official', stops, modes: () => ({ mode: 'exact', refined: false, capped: false }) })))
    expect(done.totalMinutes).toBe(core.totals.evaMin)
    expect(done.marginMin).toBe(core.tightest!.marginMin)
    // U2 / R4 match legs by StopId: every publish (partial, ready, refined) uses the planning store's ids
    const ids = [PAD_STOP_ID, ...stops.map((s) => s.id), PAD_STOP_ID]
    expect(seen.filter((y) => y.seq === r.seq && y.status !== 'computing').every((y) => y.legs.length > 0)).toBe(true)
    for (const x of seen.filter((y) => y.seq === r.seq)) {
      for (const l of x.legs) expect([l.fromStopId, l.toStopId]).toEqual([ids[l.index], ids[l.index + 1]])
    }
    expect(seen.some((x) => x.seq === r.seq && x.status === 'partial')).toBe(true)
    expect(stops.every((s) => s.id !== PAD_STOP_ID)).toBe(true)
  }, 60_000)

  it('stale results are dropped: only the newest edit lands as ready; older seqs never publish after it', async () => {
    const seen: RouteResults[] = []
    start({ publish: (r) => seen.push(r) })
    await runner!.settled()
    store.addStop({ kind: 'station', station: 'S7' })
    await new Promise((r) => setTimeout(r, 0)) // edit 1 is in flight
    store.addStop({ kind: 'station', station: 'S8' })
    await new Promise((r) => setTimeout(r, 0))
    store.removeStop(store.state.peek().route.stops[0].id) // edit 3: only S8 left
    const r = await runner!.settled()
    expect(r.status).toBe('ready')
    expect(r.legs.map((l) => l.toStopId)).toEqual([store.state.peek().route.stops[0].id, PAD_STOP_ID])
    const maxSeq = Math.max(...seen.map((x) => x.seq))
    expect(r.seq).toBe(maxSeq)
    const iLast = seen.findIndex((x) => x.seq === maxSeq)
    expect(seen.slice(iLast).every((x) => x.seq === maxSeq)).toBe(true)
    for (let i = 1; i < seen.length; i++) expect(seen[i].seq).toBeGreaterThanOrEqual(seen[i - 1].seq)
    expect(getRouteResults().status).toBe('idle') // publish was injected: the app store untouched
  }, 60_000)

  it('publishes into state/routeResults.ts by default; storm and EVA start recompute; view toggles do not', async () => {
    start()
    store.addStop({ kind: 'station', station: 'S6' })
    const a = await runner!.settled()
    expect(getRouteResults()).toBe(a)
    store.toggleView('showOfficial', false)
    await Promise.resolve()
    expect(getRouteResults()).toBe(a)
    store.setStorm(!store.state.peek().route.storm)
    const b = await runner!.settled()
    expect(b.seq).toBeGreaterThan(a.seq)
    store.setStartUtc('2026-11-14T20:00:00Z')
    const c = await runner!.settled()
    expect(c.seq).toBeGreaterThan(b.seq)
    const stops = store.state.peek().route.stops
    expect(c.legs[0].minutes).toBe(a.legs[0].minutes) // the walk does not depend on the clock
    expect(c.marginMin).not.toBe(a.marginMin) // the daylight term does
    expect(stops).toHaveLength(1)
  }, 60_000)

  it('a pad whose data fails → status error (never throws, never blocks)', async () => {
    store = createPlanningStore()
    runner = startPlanningRunner(store, pads, { connect: inProcess(), loadData: () => Promise.reject(new Error('offline')) })
    store.addStop({ kind: 'station', station: 'S1' })
    const r = await runner.settled()
    expect(r).toMatchObject({ status: 'error', error: 'offline', legs: [] })
  }, 60_000)

  it('per-edit timing (J1h <= 200 ms): 23 edits, worker + core recompute; first feedback p95 <= 200 ms (fast mode, sliced idle refine in between)', async () => {
    const timings: { seq: number; totalMs: number; workerMs: number | null; computeMs: number; cacheHits: number; legs: number }[] = []
    // first feedback of an edit = its first publish with legs (partial or ready) after the edit
    const firstAt = new Map<number, number>()
    start({
      onTiming: (t) => timings.push(t),
      publish: (r) => {
        if ((r.status === 'partial' || r.status === 'ready') && r.legs.length && !firstAt.has(r.seq)) firstAt.set(r.seq, performance.now())
      },
    })
    await runner!.settled()
    const editAt = new Map<number, number>()
    const p = d.fieldsPad
    const fp = (e: number, n: number) => freePointNear(d, p.lon, p.lat, e, n)
    const edits: (() => void)[] = [
      ...['S1', 'S4', 'S6', 'S7', 'S8', 'S2'].map((id) => () => void store.addStop({ kind: 'station', station: id })),
      () => void store.addStop({ kind: 'point', ...fp(300, 0) }),
      () => void store.addStop({ kind: 'point', ...fp(-300, 200) }),
    ]
    const pt = () => store.state.peek().route.stops.find((s) => s.kind === 'point')!.id
    for (let i = 1; i <= 8; i++) edits.push(() => void store.moveStop(pt(), fp(300 + 15 * i, 10 * i)))
    edits.push(() => void store.reorderStops(0, 5), () => void store.reorderStops(2, 1), () => void store.removeStop(store.state.peek().route.stops[3].id))
    edits.push(() => void store.updateStop(pt(), { stopMin: 15 }), () => void store.setStorm(!store.state.peek().route.storm), () => void store.undo(), () => void store.undo())
    for (const e of edits) {
      const t0 = performance.now()
      e()
      const r = await runner!.settled()
      editAt.set(r.seq, t0)
    }
    expect(timings.length).toBe(edits.length)
    const first = [...editAt].map(([q, t0]) => firstAt.get(q)! - t0)
    const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]
    const fmt = (xs: number[]) => `p50 ${pct(xs, 50).toFixed(1)} / p95 ${pct(xs, 95).toFixed(1)} / max ${Math.max(...xs).toFixed(1)} ms`
    process.stdout.write(`\nperf: [R1b runner] first feedback ${fmt(first)}; final totals ${fmt(timings.map((t) => t.totalMs))}\n`)
    expect(first.every((x) => Number.isFinite(x) && x >= 0)).toBe(true)
    expect(pct(first, 95)).toBeLessThanOrEqual(200)
    const tot = timings.map((t) => t.totalMs).sort((a, b) => a - b)
    const med = tot[Math.floor(tot.length / 2)]
    const over = timings.filter((t) => t.totalMs > 200)
    const comp = Math.max(...timings.map((t) => t.computeMs))
    process.stdout.write(
      `\nperf: [R1 runner] ${timings.length} edits, per-edit ms: ${timings.map((t) => t.totalMs.toFixed(0)).join(' ')}; median ${med.toFixed(1)}, max ${tot[tot.length - 1].toFixed(1)}, >200 ms: ${over.length} (${over.map((t) => `${t.legs} legs, worker ${t.workerMs?.toFixed(0)}`).join('; ')}); main-thread core max ${comp.toFixed(1)} ms\n`,
    )
    // the main thread never routes: the core recompute with every leg cached stays well under budget
    expect(comp).toBeLessThan(200)
  }, 120_000)
})

describe.skipIf(!HAS_DATA)('planning runner on picker pad rank2 (real data, pad env from the pad service)', () => {
  const RANK2 = { lon: 137.393301, lat: -4.776468 }
  let rank2: BrowserRouteData
  let base: BrowserRouteData
  beforeAll(async () => {
    const pf = J<PadFile>('pad.json')
    base = await loadFromFiles(CONFIG.defaultScenario)
    rank2 = await loadFromFiles(CONFIG.defaultScenario, 'pads/rank2/', { ...pf, pad: { ...pf.pad, ...RANK2, id: 'rank2' } } as PadFile)
  }, 120_000)

  it('padRouteData(official data, rank2 env) = the rank2 data the I1c test checks against the engine', async () => {
    const env = { info: { id: 'rank2', sourceId: 'rank2', hasRoutingFields: true }, routingFields: { padId: 'rank2', scenario: 'nom_104', pad: { ...RANK2, elevM: null }, tHome: rank2.tHome, o2Home: rank2.o2Home, pointer: rank2.pointer } } as unknown as PadEnv
    const pd = padRouteData(base, env)
    const st = toRouteStops(createPlanningStore({ initial: { route: { stops: ['S4', 'S1', 'S6', 'S7'].map((station, i) => ({ id: `s${i}`, kind: 'station' as const, station, note: '', tags: [], stopMin: 0 })), startUtc: null, storm: true } } }).state.peek().route.stops)
    const a = computeBrowserRoute(pd, RANK2, st)
    const b = computeBrowserRoute(fresh(rank2), RANK2, st)
    expect(a.feasibility).toEqual({ feasible: true })
    expect(a.totals).toEqual(b.totals)
    expect(a.tightest).toEqual(b.tightest)
    expect(a.legs.map((l) => l.walkMin)).toEqual(b.legs.map((l) => l.walkMin))
    // and the runner on that pad
    const store = createPlanningStore()
    store.setPad('rank2')
    // exact mode: the engine's numbers bit for bit (the fast mode is bounded and converges: test above)
    runner = startPlanningRunner(store, createMockPadService(), { connect: inProcess(), mode: 'exact', loadData: async (id) => (id === 'rank2' ? pd : fresh(base)) })
    for (const s of ['S4', 'S1', 'S6', 'S7']) store.addStop({ kind: 'station', station: s })
    const r = await runner.settled()
    expect(r).toMatchObject({ padId: 'rank2', status: 'ready', firstInfeasibleLeg: null })
    expect(r.totalMinutes).toBe(b.totals.evaMin)
  }, 60_000)
})
