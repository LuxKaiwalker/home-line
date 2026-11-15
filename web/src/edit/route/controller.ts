// Edit-route controller (R5, D97 §3): the stop list edits (through the route store, one undo step
// each), Compute plan (one live job for the route as given), the staged result and the infeasible
// answer. No DOM and nothing from src/live: the live side passes a RouteJobs port (live/route/jobs.ts)
// and optionally a RouteMap port (live/route/map.ts). D85: nothing is computed while the user drags a
// stop; only "Compute plan" starts a job. Waypoint rule 2: the order is never changed here.
//
// WP12 (L6 W-1, W-4): this is the ONE compute action of the Plan view: the inputs are the route store's
// step (pad from the pad tool or the plan in use, crew from the crew panel, the route), one job at a
// time; a second press while a job runs starts nothing and asks the panel to focus the progress. Ticking
// a station while the engine chooses switches to "My order" and adds it in one undo step.
import { computed, signal, type ReadSignal } from '../../state/signal'
import { checkRoute, legCoords, moveStop, routeLegs, rowIds, setMode, toggleStation, type PlanRoute, type RouteCheck, type RouteMode, type StationGeo, type StopProbe } from './model'
import type { RouteDraftTarget, RouteStep, RouteStore } from './store'
import { fill, LIMIT_SHORT, MAP_TEXT } from './text'

/** The limit an infeasible route breaks first (draft §4.2: O₂ at the effort-cap rule D45, daylight, EVA length D28, dose). */
export type RouteLimit = 'O2' | 'daylight' | 'EVA duration' | 'dose'

export type Feasibility = { feasible: true } | { feasible: false; leg: number; from: string; to: string; limit: RouteLimit | string; shortfallMin: number | null; legsPlanned: number | null }

/** A job state as the panel shows it (live job fields it needs). */
export interface RouteJobView {
  status: string
  stage: string | null
  progress: number
  stagesDone: readonly string[]
  hash: string
  /** WP13 (F2): 0-based place in the queue while queued (job.queue_position); null = not reported */
  queuePosition?: number | null
}

/** One staged snapshot of the result tree (live/stage.ts loadStage, summarised); `data` goes to the map as is. */
export interface RouteStageView {
  stages: readonly string[]
  /** layers present in the tree so far: bands, route, isochrones, edges, partner */
  layers: readonly string[]
  errors: readonly string[]
  data: unknown
}

/** A failed job: HTTP status (0 = no answer), error code, readable text, the stop the error names (422). */
export interface RouteFailure {
  status: number
  code: string
  message: string
  stop: number | null
  retryAfterS: number | null
}

export interface RouteResultView {
  hash: string
  feasibility: Feasibility | null
  /** config/backend.yaml labels.live (the run record's label) */
  label: string
  /** #/plan/{hash}/provenance */
  provenanceHref: string
  engineCommit: string | null
  recordError: string | null
  /** WP13 (W-6): the tightest margin of the computed route and its binding limit (result timeline); null = not in the result */
  margin?: RouteMargin | null
}

/** WP13 (W-6): the lowest margin on the route (turn-back rows left out) and the limit that sets it. */
export interface RouteMargin {
  min: number
  binding: string | null
  /** the timeline row's station, when it names one */
  station: string | null
}

export type RouteOutcome = { status: 'done'; result: RouteResultView } | { status: 'failed'; failure: RouteFailure } | { status: 'cancelled' }

export interface RouteJobCallbacks {
  onUpdate(job: RouteJobView): void
  onStage(stage: RouteStageView): void
}
export interface RouteJobs {
  run(inputs: RouteStep['inputs'], cb: RouteJobCallbacks): { promise: Promise<RouteOutcome>; cancel(): void }
}

export interface RouteMap {
  /** Draw a staged snapshot through the console map's own setters (one rendering path). */
  showStage(data: unknown): void | Promise<void>
  /** Highlight the failing leg `leg` (null clears it). */
  highlightLeg(coords: [number, number][] | null, label?: string, leg?: number, end?: RouteEnd): void
  /** Give the map back to the static plan. */
  restore(): void
}

/** D117: where an infeasible route stops (the last reached stop: the failing leg's start); no way home is drawn. */
export interface RouteEnd {
  /** run-record name of the stop ('pad' when the first leg fails) */
  name: string
  label: string
  /** the failing leg (contract numbering): route legs from it on are not drawn */
  leg: number
}

export type ComputeState =
  | { kind: 'idle' }
  /** since: ms (options.now) when Compute was pressed; runningSince: when the job left the queue (WP13 W-2) */
  | { kind: 'running'; job: RouteJobView | null; stage: RouteStageView | null; key: string; since: number; runningSince: number | null }
  | { kind: 'done'; job: RouteJobView | null; stage: RouteStageView | null; result: RouteResultView; key: string }
  | { kind: 'failed'; job: RouteJobView | null; stage: RouteStageView | null; failure: RouteFailure; key: string }
  | { kind: 'cancelled'; key: string }

export interface RouteControllerOptions {
  store: RouteStore
  jobs: RouteJobs
  stations: readonly StationGeo[]
  /** pad lon/lat of the plan the console shows now */
  pad: () => { lon: number; lat: number }
  probe?: (lon: number, lat: number) => StopProbe
  map?: RouteMap | null
  /** health says heavy jobs are possible now (index.ts onLiveState + bannerFor) */
  canCompute?: ReadSignal<boolean>
  /** WP12: why the job cannot start although the route is fine (crew panel: a field is not a number); null = nothing */
  blocked?: ReadSignal<string | null>
  /** WP13: clock for the elapsed time (default Date.now) */
  now?: () => number
}

export function createRouteController(o: RouteControllerOptions) {
  const { store } = o
  const compute = signal<ComputeState>({ kind: 'idle' })
  /** index of the stop being dragged (D85: nothing is applied or computed until the drop) */
  const dragging = signal<number | null>(null)
  let handle: { cancel(): void } | null = null
  let seq = 0
  let drawn = false
  /** bumped when the user asks for a job while one runs: the panel focuses the progress (W-1) */
  const focusRequest = signal(0)
  /**
   * W-7: the order of the rows in the stop list. A tick, a mode change or a waypoint edit keeps every
   * row where it is (nothing moves under the pointer); an explicit reorder (drag, Alt+Up/Down), undo
   * or redo lays the rows out in route order again (null = route order).
   */
  const layout = signal<readonly string[] | null>(null)
  const resort = () => {
    if (layout.peek() !== null) layout.value = null
  }
  const requestFocus = () => void (focusRequest.value = focusRequest.peek() + 1)

  const check = computed<RouteCheck>(() => {
    void store.step.value // pad changes rebuild the check
    return checkRoute(store.route.value, { stations: o.stations, pad: o.pad(), probe: o.probe })
  })

  function clearResult(): void {
    seq++
    handle?.cancel()
    handle = null
    if (compute.peek().kind !== 'idle') compute.value = { kind: 'idle' }
    o.map?.highlightLeg(null)
    if (drawn) o.map?.restore()
    drawn = false
  }
  /** Every route edit: one undo step; a shown result belongs to the old route, so it is cleared. */
  function edit(next: PlanRoute, rows: 'keep' | 'resort' = 'keep'): boolean {
    const pre = layout.peek() ?? rowIds(store.route.peek(), o.stations)
    if (!store.apply(next)) return false
    if (rows === 'resort') resort()
    else if (layout.peek() === null) layout.value = pre
    clearResult()
    return true
  }

  function runCompute(): boolean {
    const c = compute.peek()
    if (c.kind === 'running') {
      // one job at a time (W-1): a second press only brings the progress into view
      requestFocus()
      return false
    }
    if (dragging.peek() !== null) return false
    if (!check.peek().ok || (o.canCompute && !o.canCompute.peek()) || o.blocked?.peek()) return false
    clearResult()
    const my = ++seq
    const step = store.step.peek()
    const route = step.route
    const now = o.now ?? Date.now
    compute.value = { kind: 'running', job: null, stage: null, key: step.key, since: now(), runningSince: null }
    const live = (fn: () => void) => {
      if (my === seq) fn()
    }
    const h = o.jobs.run(step.inputs, {
      onUpdate: (job) =>
        live(() => {
          const s = compute.peek()
          if (s.kind === 'running') compute.value = { ...s, job, runningSince: s.runningSince ?? (job.status !== 'queued' ? now() : null) }
        }),
      onStage: (stage) =>
        live(() => {
          const s = compute.peek()
          if (s.kind !== 'running') return
          compute.value = { ...s, stage }
          drawn = true
          void o.map?.showStage(stage.data)
        }),
    })
    handle = h
    void h.promise.then((out) =>
      live(() => {
        handle = null
        const s = compute.peek()
        const job = s.kind === 'running' ? s.job : null
        const stage = s.kind === 'running' ? s.stage : null
        if (out.status === 'done') {
          compute.value = { kind: 'done', job, stage, result: out.result, key: step.key }
          const f = out.result.feasibility
          if (f && !f.feasible)
            o.map?.highlightLeg(legCoords(route, f.leg, { stations: o.stations, pad: o.pad() }), fill(MAP_TEXT.fails, { limit: LIMIT_SHORT[f.limit as RouteLimit] ?? f.limit }), f.leg, { name: f.from, label: MAP_TEXT.end, leg: f.leg })
        } else if (out.status === 'failed') compute.value = { kind: 'failed', job, stage, failure: out.failure, key: step.key }
        else compute.value = { kind: 'cancelled', key: step.key }
      }),
    )
    return true
  }

  return {
    store,
    compute: compute as ReadSignal<ComputeState>,
    check,
    dragging: dragging as ReadSignal<number | null>,
    legs: computed(() => routeLegs(store.route.value)),
    stations: o.stations,
    blocked: o.blocked ?? null,
    focusRequest: focusRequest as ReadSignal<number>,
    requestFocus,
    setMode: (m: RouteMode) => edit(setMode(store.route.peek(), m)),
    /** W-4: in "Engine chooses" a tick (or untick) switches to "My order" too: one undo step for both. */
    toggle: (id: string, on: boolean) => {
      const r = store.route.peek()
      const next = toggleStation(r, id, on)
      return next === r ? false : edit(setMode(next, 'ordered'))
    },
    move: (from: number, to: number) => edit(moveStop(store.route.peek(), from, to), 'resort'),
    /** Any other route edit (WP6 free points: add, move, rename, delete): one undo step, result cleared; rows stay. */
    edit: (next: PlanRoute) => edit(next),
    /** setRouteDraft's view of this panel (store.ts): the same checks, one undo step, rows in route order. */
    draftTarget: (): RouteDraftTarget => ({
      route: () => store.route.peek(),
      check: (r) => checkRoute(r, { stations: o.stations, pad: o.pad(), probe: o.probe }),
      apply: (r) => edit(r, 'resort'),
    }),
    /** W-7: the row layout of the stop list (null = route order). */
    layout: layout as ReadSignal<readonly string[] | null>,
    /** Drag gesture: start (no store change), drop (one undo step), cancel. */
    dragStart(i: number): void {
      dragging.value = i
    },
    dragDrop(to: number): boolean {
      const from = dragging.peek()
      dragging.value = null
      return from === null ? false : edit(moveStop(store.route.peek(), from, to), 'resort')
    },
    dragCancel(): void {
      dragging.value = null
    },
    undo(): boolean {
      if (!store.undo()) return false
      resort()
      clearResult()
      return true
    },
    redo(): boolean {
      if (!store.redo()) return false
      resort()
      clearResult()
      return true
    },
    computePlan: runCompute,
    /** WP13: the clock the elapsed time is read with */
    now: o.now ?? Date.now,
    cancel(): void {
      handle?.cancel()
    },
    /** Offline or warming: pending work stops and the live layers go. */
    reset: clearResult,
    dispose(): void {
      clearResult()
    },
  }
}

export type RouteController = ReturnType<typeof createRouteController>
