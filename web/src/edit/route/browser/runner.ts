// R1 (Plan port): the planning runner. Watches the planning store (state/planning.ts), routes the
// user's route with the route worker (worker.ts) and publishes the result into state/routeResults.ts,
// where the route panel, the map route layer and the context bar read it without importing
// edit/route/** (interfaces.md §7b, §9). Reached by I1 through a dynamic import():
//
//   const { startPlanningRunner } = await import('../edit/route/browser/runner')
//   const stop = startPlanningRunner(planning, padService())
//
// Per edit (pad, stops, EVA start, storm): seq++, the stops are placed on the pad's grid (compute.ts
// routeCells: the same snapping as the estimate), legs missing from the pad's leg cache go to the
// worker (pad first, then the stops; the way home is WS2's pointer field, never routed), each leg that
// comes back is published at once (status 'partial'), and when all are in the route is computed by the
// core (computeBrowserRoute, every leg a cache hit: no A* on the main thread) and published 'ready'.
// Results of an older seq are dropped. A refined leg (idle exact pass) replaces its cache entry and the
// route is recomputed. Every number is the core's: minutes / litres as in mission.json, margin = the
// four-term margin (tightest point), totalMinutes = the EVA (walk out + stops + way home).
import { CONFIG } from '../../../config'
import type { PadEnv, PadService } from '../../../pads/types'
import { OFFICIAL_PAD_ID, toRouteStops, type PlanStop, type PlanningRoute, type PlanningState, type PlanningStore } from '../../../state/planning'
import { getRouteResults, publishRouteResults, type LegResult, type RouteResults } from '../../../state/routeResults'
import { routeGridOf } from '../map/grid'
import { legPairs } from '../map/legs'
import { scenarioParams } from '../map/physio'
import { LegRouter, type Leg } from '../map/router'
import { computeBrowserRoute, routeCells, type BrowserRouteResult } from './compute'
import { loadBrowserRouteData, type BrowserRouteData } from './data'
import { withEvaStart } from './start'
import { DEFAULT_HEURISTIC_WEIGHT, LEG_CAP_MS, type RouteWorkerRequest, type RouteWorkerResponse, type SearchMode, type WorkerLeg } from './worker.types'

/** fromStopId / toStopId of the pad in LegResult. */
export const PAD_STOP_ID = 'pad'

export interface WorkerPort {
  post(msg: RouteWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export interface RunnerOptions {
  /** the worker (default: a module Worker on worker.ts; no Worker API → the handler in-process) */
  connect?: (onMessage: (m: RouteWorkerResponse) => void) => WorkerPort
  /** the route data of a pad (default: official = loadBrowserRouteData, others from the pad service) */
  loadData?: (padId: string, pads: PadService) => Promise<BrowserRouteData>
  publish?: (r: RouteResults) => void
  mode?: SearchMode
  weight?: number
  legCapMs?: number
  now?: () => number
  /** recompute timings per edit (perf probe / tests) */
  onTiming?: (t: { seq: number; totalMs: number; workerMs: number | null; computeMs: number; cacheHits: number; legs: number }) => void
}

export interface PlanningRunner {
  stop(): void
  /** the core's full result of the last 'ready' publish (mission.json export: compute.ts buildBrowserMission) */
  lastResult(): { result: BrowserRouteResult; data: BrowserRouteData } | null
  /** resolves when the current seq is published 'ready' or 'error' (tests) */
  settled(): Promise<RouteResults>
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const k = (a: number, b: number) => `${a}-${b}`

function defaultConnect(onMessage: (m: RouteWorkerResponse) => void): WorkerPort {
  if (typeof Worker !== 'undefined') {
    try {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<RouteWorkerResponse>) => onMessage(e.data)
      w.onerror = (e) => onMessage({ type: 'error', seq: null, message: `route worker failed: ${e.message ?? 'error'}` })
      return { post: (m, t) => w.postMessage(m, t ?? []), terminate: () => w.terminate() }
    } catch {
      /* fall through: in-process */
    }
  }
  let h: { handle(m: RouteWorkerRequest): void } | null = null
  let dead = false
  const queue: RouteWorkerRequest[] = []
  void import('./worker').then((m) => {
    h = m.createRouteWorkerHandler((r) => !dead && onMessage(r))
    for (const q of queue.splice(0)) h.handle(q)
  })
  return {
    post: (m) => (h ? h.handle(m) : queue.push(m)),
    terminate: () => void (dead = true),
  }
}

/** Route data of a picker pad: the official data with the pad's routing fields (same 5 m field grid). */
export function padRouteData(base: BrowserRouteData, env: PadEnv): BrowserRouteData {
  const rf = env.routingFields
  const t = rf.tHome
  const same = t.width === base.tHome.width && t.height === base.tHome.height && t.w === base.tHome.w && t.n === base.tHome.n && t.resM === base.tHome.resM
  if (!same) throw new Error(`pad ${rf.padId}: its field grid differs from the official one`)
  if (rf.scenario !== base.scenario) throw new Error(`pad ${rf.padId}: scenario ${rf.scenario}, routing data ${base.scenario}`)
  const grid = routeGridOf(t, base.grid.elev)
  return {
    ...base,
    tHome: t,
    o2Home: rf.o2Home,
    pointer: rf.pointer,
    grid,
    router: new LegRouter(grid, base.model),
    components: new Map(),
    legCache: new Map(),
    fieldsPad: { lon: rf.pad.lon, lat: rf.pad.lat, id: env.info.sourceId, elevM: rf.pad.elevM, kind: 'picker', source: `scenarios/pads/index.json ${env.info.sourceId}` },
  }
}

async function defaultLoadData(padId: string, pads: PadService): Promise<BrowserRouteData> {
  const base = await loadBrowserRouteData(CONFIG.defaultScenario)
  if (padId === OFFICIAL_PAD_ID) return base
  const env = await pads.loadPadEnv(padId)
  if (!env.info.hasRoutingFields) throw new Error(`pad ${padId} has no routing fields`)
  return padRouteData(base, env)
}

/** Planned stop minutes for the core: the stop's own (Mission semantics); a station left at 0 keeps its dwell. */
export function stopDwell(stops: readonly PlanStop[]): (number | undefined)[] {
  return stops.map((s) => (s.kind === 'station' && !(s.stopMin > 0) ? undefined : s.stopMin))
}

const REASON: Record<string, string> = { O2: 'budget', 'EVA duration': 'budget', daylight: 'daylight', dose: 'dose' }

/** The core's result as RouteResults (§9). */
export function toRouteResults(
  r: BrowserRouteResult,
  o: { seq: number; padId: string; stops: readonly PlanStop[]; modes: (q: number, b: number) => { mode: SearchMode; refined: boolean; capped: boolean } | undefined; timingMs?: number },
): RouteResults {
  const ids = [PAD_STOP_ID, ...o.stops.map((s) => s.id), PAD_STOP_ID]
  const failLeg = r.feasibility && !r.feasibility.feasible ? r.feasibility.leg : null
  let fast = false
  const legs: LegResult[] = r.legs.map((row) => {
    const out = row.kind === 'out'
    const a = out ? (row.leg === 0 ? r.detail.padCell : r.detail.cells[row.leg - 1]) : null
    const b = out ? r.detail.cells[row.leg] : null
    const m = out && a !== null && b !== null && a !== undefined && b !== undefined ? o.modes(a, b) : undefined
    if (m?.mode === 'fast') fast = true
    const unreachable = out ? !row.routed : row.walkMin === null
    const feasible = !unreachable && row.checkOk !== false && (failLeg === null || row.leg !== failLeg)
    const limit = row.checkBinding ?? (r.feasibility && !r.feasibility.feasible && r.feasibility.leg === row.leg ? r.feasibility.limit : null)
    const reason = unreachable ? 'unreachable' : !feasible ? (REASON[limit ?? ''] ?? 'budget') : undefined
    return {
      index: row.leg,
      fromStopId: ids[row.leg],
      toStopId: ids[row.leg + 1],
      minutes: row.walkMin,
      o2L: row.o2L,
      distanceM: row.distM,
      feasible,
      ...(reason ? { reason } : {}),
      path: row.coords.map(([x, y]) => [x, y] as [number, number]),
      mode: m?.mode ?? 'exact',
      refined: m?.refined ?? false,
    }
  })
  const firstBad = legs.find((l) => !l.feasible)
  return {
    seq: o.seq,
    padId: o.padId,
    status: 'ready',
    legs,
    totalMinutes: r.totals.evaMin,
    marginMin: r.tightest ? r.tightest.marginMin : null,
    binding: r.tightest ? r.tightest.binding : null,
    doseMarginMin: r.detail.margin?.dose ? r.detail.margin.dose.lowestDoseMarginMin : null,
    firstInfeasibleLeg: failLeg ?? (firstBad ? firstBad.index : null),
    fastRoute: fast,
    ...(o.timingMs !== undefined ? { timingMs: Math.round(o.timingMs * 10) / 10 } : {}),
  }
}

interface PadSlot {
  data: Promise<BrowserRouteData>
  /** worker env posted */
  sent: boolean
  /** per leg pair: how the cached leg was found */
  modes: Map<string, { mode: SearchMode; refined: boolean; capped: boolean }>
}

/**
 * Start the runner on a planning store. Publishes into state/routeResults.ts until stop().
 * Never blocks: data loads and routing are async; the store's state is read at each edit.
 */
export function startPlanningRunner(store: PlanningStore, pads: PadService, opts: RunnerOptions = {}): PlanningRunner {
  const publish = opts.publish ?? publishRouteResults
  const now = opts.now ?? nowMs
  const mode = opts.mode ?? 'fast'
  const weight = opts.weight ?? DEFAULT_HEURISTIC_WEIGHT
  const legCapMs = opts.legCapMs ?? LEG_CAP_MS
  const loadData = opts.loadData ?? defaultLoadData
  const slots = new Map<string, PadSlot>()
  let seq = 0
  let stopped = false
  let last: { result: BrowserRouteResult; data: BrowserRouteData } | null = null
  let lastPublished: RouteResults = getRouteResults()
  let waiters: ((r: RouteResults) => void)[] = []
  /** the request in flight */
  let cur: {
    seq: number
    padId: string
    route: PlanningRoute
    d: BrowserRouteData
    slot: PadSlot
    cells: number[]
    t0: number
    workerMs: number | null
    cacheHits: number
    partial: Map<number, WorkerLeg>
    /** published 'ready' (a refined leg recomputes only then: before, legs may still be missing) */
    ready: boolean
    /** the edit's time to 'ready' (kept for the recomputes after refined legs) */
    totalMs?: number
  } | null = null

  const emit = (r: RouteResults) => {
    if (stopped) return
    lastPublished = r
    publish(r)
    if (r.seq === seq && (r.status === 'ready' || r.status === 'error' || r.status === 'idle')) {
      const w = waiters
      waiters = []
      for (const f of w) f(r)
    }
  }

  const port = (opts.connect ?? defaultConnect)(onMessage)

  function slotOf(padId: string): PadSlot {
    let s = slots.get(padId)
    if (!s) {
      s = { data: loadData(padId, pads), sent: false, modes: new Map() }
      s.data.catch(() => slots.delete(padId))
      slots.set(padId, s)
      while (slots.size > 3) {
        const old = slots.keys().next().value as string
        slots.delete(old)
        port.post({ type: 'drop', padId: old })
      }
    } else {
      slots.delete(padId)
      slots.set(padId, s)
    }
    return s
  }

  /** the data an edit computes on: the pad's data (shared leg cache) with this route's start and storm */
  const dataFor = (base: BrowserRouteData, route: PlanningRoute): BrowserRouteData => {
    const ms = route.startUtc === null ? null : Date.parse(route.startUtc)
    const d = withEvaStart(base, ms !== null && Number.isFinite(ms) ? ms : null)
    return d.storm === route.storm ? d : { ...d, storm: route.storm }
  }

  /** `refined`: a recompute after an idle-refined leg (not an edit: no onTiming) */
  function finish(c: NonNullable<typeof cur>, refined = false): void {
    const t1 = now()
    const result = computeBrowserRoute(c.d, c.d.fieldsPad, toRouteStops(c.route.stops), { dwellMin: stopDwell(c.route.stops) })
    const computeMs = now() - t1
    last = { result, data: c.d }
    const totalMs = c.totalMs ?? now() - c.t0
    c.totalMs = totalMs
    c.ready = true
    if (!refined) opts.onTiming?.({ seq: c.seq, totalMs, workerMs: c.workerMs, computeMs, cacheHits: c.cacheHits, legs: c.cells.length - 1 })
    emit(toRouteResults(result, { seq: c.seq, padId: c.padId, stops: c.route.stops, modes: (a, b) => c.slot.modes.get(k(a, b)), timingMs: totalMs }))
  }

  function sendEnv(padId: string, slot: PadSlot, d: BrowserRouteData, padCell: number): void {
    if (slot.sent) return
    // copies (the main thread keeps its arrays for snapping), transferred to avoid a second copy
    const elev = d.grid.elev.slice()
    const passable = d.grid.passable.slice()
    port.post({ type: 'env', env: { padId, scenario: d.scenario, grid: { width: d.grid.width, height: d.grid.height, resM: d.grid.resM, elev, passable }, params: scenarioParams(d.scenario), padCell } }, [elev.buffer, passable.buffer])
    slot.sent = true
  }

  /** A pad with no stops yet: load its data, send it to the worker and find the pad's reachable
   *  component now, so the first stop routes without that cost. */
  function warm(padId: string): void {
    const slot = slotOf(padId)
    void slot.data.then(
      (d) => {
        if (stopped || !slots.has(padId)) return
        const rc = routeCells(d, d.fieldsPad, [])
        sendEnv(padId, slot, d, rc.padCell ?? -1)
      },
      () => undefined,
    )
  }

  async function run(state: PlanningState): Promise<void> {
    const my = ++seq
    if (cur) port.post({ type: 'cancel', seq: cur.seq })
    cur = null
    const { padId, route } = state
    if (!route.stops.length) {
      warm(padId)
      last = null
      emit({ seq: my, padId, status: 'idle', legs: [], totalMinutes: null, marginMin: null, firstInfeasibleLeg: null, fastRoute: false })
      return
    }
    const t0 = now()
    emit({ ...lastPublished, seq: my, padId, status: 'computing', ...(lastPublished.padId === padId ? {} : { legs: [], totalMinutes: null, marginMin: null, firstInfeasibleLeg: null }) })
    const slot = slotOf(padId)
    let base: BrowserRouteData
    try {
      base = await slot.data
    } catch (e) {
      if (my === seq) emit({ seq: my, padId, status: 'error', legs: [], totalMinutes: null, marginMin: null, firstInfeasibleLeg: null, fastRoute: false, error: e instanceof Error ? e.message : String(e) })
      return
    }
    if (my !== seq || stopped) return
    const d = dataFor(base, route)
    const rc = routeCells(d, d.fieldsPad, toRouteStops(route.stops))
    const padCell = rc.padCell ?? -1
    const cells = [padCell, ...rc.cells.map((x) => x ?? -1)]
    const pairs = legPairs(padCell, rc.cells.map((x) => ({ cell: x ?? -1 })))
    // pairs with a missing end are never routed (compute.ts caches them as null itself)
    const missing = pairs.filter(([a, b]) => a >= 0 && b >= 0 && !d.legCache.has(k(a, b)))
    cur = { seq: my, padId, route, d, slot, cells, t0, workerMs: null, cacheHits: pairs.length - missing.length, partial: new Map(), ready: false }
    if (!missing.length) return finish(cur)
    sendEnv(padId, slot, d, padCell)
    port.post({ type: 'route', seq: my, padId, cells, mode, weight, legCapMs, refine: true })
  }

  function onMessage(m: RouteWorkerResponse): void {
    if (stopped) return
    if (m.type === 'error') {
      if (m.seq === null || m.seq === seq) emit({ ...lastPublished, seq, status: 'error', error: m.message })
      return
    }
    if (m.type === 'refined') {
      // a refined leg is exact and pair-keyed: good for the cache whatever its seq
      const s = slots.get(m.padId)
      if (!s) return
      void s.data.then((d) => {
        d.legCache.set(k(m.leg.from, m.leg.to), m.leg.leg)
        s.modes.set(k(m.leg.from, m.leg.to), { mode: 'exact', refined: true, capped: false })
        // only a route already published 'ready': one still waiting on the worker gets the leg from the cache
        if (!cur || cur.padId !== m.padId || cur.seq !== seq || !cur.ready || !last) return
        const idx = cur.cells.findIndex((c, i) => i < cur!.cells.length - 1 && c === m.leg.from && cur!.cells[i + 1] === m.leg.to)
        if (idx >= 0) finish(cur, true)
      })
      return
    }
    const c = cur
    if (!c || m.seq !== c.seq) return // stale: an older edit
    if (m.type === 'timing') {
      c.workerMs = m.totalMs
      return
    }
    if (m.padId !== c.padId) return
    for (const l of m.legs) c.partial.set(l.index, l)
    if (m.final) {
      for (const l of m.legs) {
        if (l.from < 0 || l.to < 0) continue
        c.d.legCache.set(k(l.from, l.to), l.leg)
        const prev = c.slot.modes.get(k(l.from, l.to))
        c.slot.modes.set(k(l.from, l.to), { mode: l.mode, refined: prev?.refined === true && l.mode === 'exact', capped: l.capped })
      }
      finish(c)
      return
    }
    emit(partialResults(c))
  }

  function partialResults(c: NonNullable<typeof cur>): RouteResults {
    const ids = [PAD_STOP_ID, ...c.route.stops.map((s) => s.id)]
    const W = c.d.tHome.width
    const legs: LegResult[] = []
    let fast = false
    for (let i = 0; i < c.cells.length - 1; i++) {
      const a = c.cells[i]
      const b = c.cells[i + 1]
      const wl = c.partial.get(i)
      const cached: Leg | null | undefined = wl ? wl.leg : a >= 0 && b >= 0 ? c.d.legCache.get(k(a, b)) : null
      if (cached === undefined) continue // still routing
      const mm = wl ? { mode: wl.mode, refined: false } : c.slot.modes.get(k(a, b))
      if (mm?.mode === 'fast') fast = true
      legs.push({
        index: i,
        fromStopId: ids[i],
        toStopId: ids[i + 1],
        minutes: cached ? cached.timeS / 60 : null,
        o2L: cached ? cached.o2L : null,
        distanceM: cached ? cached.distM : null,
        feasible: cached !== null,
        ...(cached ? {} : { reason: 'unreachable' }),
        path: cached ? cached.cells.map((x) => c.d.tHome.lonLatOf(Math.floor(x / W), x % W)) : [],
        mode: mm?.mode ?? 'exact',
        refined: mm?.refined ?? false,
      })
    }
    return { seq: c.seq, padId: c.padId, status: 'partial', legs, totalMinutes: null, marginMin: null, firstInfeasibleLeg: null, fastRoute: fast }
  }

  // coalesce edits made in one task (a drag fires many moves; only the last one is routed)
  let pending: PlanningState | null = null
  const onState = (s: PlanningState) => {
    const first = pending === null
    pending = s
    if (first)
      queueMicrotask(() => {
        const p = pending
        pending = null
        if (p && !stopped) void run(p)
      })
  }
  let prevKey: unknown = null
  const unsub = store.state.subscribe((s) => {
    // the view toggles change nothing here
    if (prevKey && (prevKey as { pad: string; route: PlanningRoute }).pad === s.padId && (prevKey as { route: PlanningRoute }).route === s.route) return
    prevKey = { pad: s.padId, route: s.route }
    onState(s)
  })
  const s0 = store.state.peek()
  prevKey = { pad: s0.padId, route: s0.route }
  onState(s0)

  return {
    stop() {
      stopped = true
      unsub()
      port.terminate()
      for (const f of waiters) f(lastPublished)
      waiters = []
    },
    lastResult: () => last,
    settled: () =>
      new Promise((res) => {
        const r = lastPublished
        if (!pending && r.seq === seq && (r.status === 'ready' || r.status === 'error' || r.status === 'idle')) res(r)
        else waiters.push(res)
      }),
  }
}
