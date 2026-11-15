// R1 (Plan port): the route worker of the one route core (worker.types.ts contract). Moved from the
// Mission Planer's J1h worker (mission/legsWorker.ts + legsRoute.ts): the same grade model
// (physio.ts gradeModel on the scenario's Params), now behind R2's leg search (search.ts via
// legSearch.ts) with per-request sequencing, partial answers, a leg cache per pad and an idle refine.
//
// Per 'route' request: legs already cached answer at once (one 'legs' partial), the rest are routed
// shortest first (mode 'fast' = weighted A*, capped per leg; 'exact' = w 1 = LegRouter), one 'legs'
// partial per finished leg, yielding between legs so a newer request or a 'cancel' stops the old one;
// then 'timing' and 'legs' final (every leg; timing first so the main thread has the worker's time
// when it publishes). When idle, legs that are not exact are refined with exact A* in slices
// (PORT R1b: beginRefine(...).step(REFINE_SLICE_MS) on a separate refine searcher), so a new edit is
// read between two slices and never waits more than one slice; a refine interrupted by an edit
// resumes where it stopped when the same leg is still in the route. A finished refine posts
// 'refined': the exact leg when isBetterLeg says it is faster (savedS > 0), else the current leg,
// now confirmed the fastest (savedS 0, mode 'exact'). A cell < 0 (no cell: the stop could not be
// placed) gives a null leg that is never routed. The handler is free of any Worker API (tested
// directly in worker.test.ts); the bottom of this file wires it to `self`.
import { gradeModel, type GradeModel } from '../map/physio'
import type { Leg, RouteGrid } from '../map/router'
import { createLegSearch, isBetterLeg, savedSeconds, type LegSearch, type RefineJob, type RefineSearch } from './legSearch'
import { LegSearch as SearchImpl } from './search'
import { LEG_CAP_MS, type RouteWorkerRequest, type RouteWorkerResponse, type SearchMode, type WorkerLeg, type WorkerPadEnv } from './worker.types'

/** Pads kept in the worker (pads/types.ts PAD_CACHE_SIZE). */
export const WORKER_PAD_CACHE = 3
/** One idle refine slice, ms: the worker is single-threaded, so a new edit waits at most about this
 *  long (search.ts checks the clock every 512 expansions). */
export const REFINE_SLICE_MS = 20
/** Busy-time cap of one idle refine, ms (slices only; the user is not waiting on it). Over it the leg
 *  stays fast ("may not be the fastest") and is not retried. */
export const REFINE_CAP_MS = 5000

interface CachedLeg {
  leg: Leg | null
  mode: SearchMode
  capped: boolean
  /** the leg LegRouter gives (w 1, finished): serves exact requests */
  exact: boolean
  /** the idle refine has run on it (finished or capped): not queued again */
  refineDone?: boolean
}

interface PadSlot {
  env: WorkerPadEnv
  search: LegSearch
  model: GradeModel
  legs: Map<string, CachedLeg>
}

export interface RouteWorkerOptions {
  /** run fn later (between legs, idle refine); default setTimeout 0 */
  defer?: (fn: () => void) => void
  now?: () => number
  /** the leg search per pad (default legSearch.ts createLegSearch; tests inject a fake fast search) */
  createSearch?: (grid: RouteGrid, model: GradeModel) => LegSearch
  /** the sliced refine searcher (default: search.ts LegSearch with its own buffers, sharing the fast
   *  searcher's move mask; one at a time, for the pad being refined) */
  createRefine?: (grid: RouteGrid, model: GradeModel) => RefineSearch
  /** clock of the refine slices (default `now`) */
  refineNow?: () => number
}

export interface RouteWorkerHandler {
  handle(msg: RouteWorkerRequest): void
  /** tests: the pads held, most recent last */
  pads(): string[]
}

const key = (a: number, b: number) => `${a}-${b}`
const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const defaultDefer = (fn: () => void): void => void setTimeout(fn, 0)
const sameLeg = (a: Leg | null, b: Leg | null): boolean =>
  a === b || (a !== null && b !== null && a.timeS === b.timeS && a.o2L === b.o2L && a.cells.length === b.cells.length && a.cells.every((x, i) => x === b.cells[i]))

export function createRouteWorkerHandler(post: (m: RouteWorkerResponse) => void, opts: RouteWorkerOptions = {}): RouteWorkerHandler {
  const defer = opts.defer ?? defaultDefer
  const now = opts.now ?? defaultNow
  const refineNow = opts.refineNow ?? now
  const slots = new Map<string, PadSlot>() // insertion order = LRU (oldest first)
  /** the newest request seen; requests (and refines) older than it stop */
  let latest = 0
  let cancelledUpTo = 0
  const live = (seq: number) => seq >= latest && seq > cancelledUpTo
  type RefineItem = { seq: number; padId: string; index: number; from: number; to: number }
  let refineQueue: RefineItem[] = []
  let refineScheduled = false
  /** the refine in progress (kept across edits: resumed when its leg is queued again) */
  let active: (RefineItem & { job: RefineJob }) | null = null
  /** the one refine searcher (~40 MB on the real grid): for one pad at a time */
  let refiner: { padId: string; grid: RouteGrid; search: RefineSearch } | null = null
  const createRefine = opts.createRefine ?? ((g: RouteGrid, m: GradeModel): RefineSearch => new SearchImpl(g, m, createLegSearch(g, m)))

  function touch(padId: string): PadSlot | undefined {
    const s = slots.get(padId)
    if (s) {
      slots.delete(padId)
      slots.set(padId, s)
    }
    return s
  }

  function route(msg: Extract<RouteWorkerRequest, { type: 'route' }>): void {
    latest = Math.max(latest, msg.seq)
    refineQueue = [] // a refine slice of an older seq stops (the active job is kept for a resume)
    const slot = touch(msg.padId)
    if (!slot) {
      post({ type: 'error', seq: msg.seq, message: `route worker: no environment for pad ${msg.padId}` })
      return
    }
    const t0 = now()
    const { seq, padId, cells, mode } = msg
    // exact = the parity mode: LegRouter has no cap, so neither has it (a capped leg would finish
    // greedily and break parity on a loaded machine); the cap is the fast mode's
    const capMs = mode === 'exact' ? Infinity : msg.legCapMs > 0 ? msg.legCapMs : LEG_CAP_MS
    const weight = mode === 'exact' ? 1 : Math.max(1, msg.weight)
    const n = Math.max(0, cells.length - 1)
    const out: (WorkerLeg | undefined)[] = new Array(n)
    const perLegMs: number[] = new Array(n).fill(0)
    let cacheHits = 0
    const todo: number[] = []
    const first: WorkerLeg[] = []
    for (let i = 0; i < n; i++) {
      const a = cells[i]
      const b = cells[i + 1]
      if (a < 0 || b < 0) {
        out[i] = { index: i, from: a, to: b, leg: null, mode: 'exact', capped: false }
        first.push(out[i]!)
        continue
      }
      const c = slot.legs.get(key(a, b))
      // a cached leg serves when it is as good as asked: exact always, fast only for a fast request
      if (c && (c.exact || mode === 'fast')) {
        cacheHits++
        out[i] = { index: i, from: a, to: b, leg: c.leg, mode: c.mode, capped: c.capped }
        first.push(out[i]!)
      } else todo.push(i)
    }
    // shortest legs first (straight-line cells): partial results come in cheap-first
    const W = slot.env.grid.width
    const span = (i: number) => {
      const a = cells[i]
      const b = cells[i + 1]
      return Math.hypot(Math.floor(a / W) - Math.floor(b / W), (a % W) - (b % W))
    }
    todo.sort((x, y) => span(x) - span(y))
    if (first.length && todo.length) post({ type: 'legs', seq, padId, legs: first, final: false })

    const finish = () => {
      post({ type: 'timing', seq, totalMs: now() - t0, perLegMs, cacheHits })
      post({ type: 'legs', seq, padId, legs: out as WorkerLeg[], final: true })
      if (msg.refine !== false) {
        for (const l of out as WorkerLeg[]) {
          const c = l.from >= 0 && l.to >= 0 ? slot.legs.get(key(l.from, l.to)) : undefined
          if (c && !c.exact && !c.refineDone) refineQueue.push({ seq, padId, index: l.index, from: l.from, to: l.to })
        }
        // the leg refined when the edit came in goes first: it resumes where it stopped
        const a = active
        const ia = a ? refineQueue.findIndex((j) => j.padId === a.padId && j.from === a.from && j.to === a.to) : -1
        if (ia > 0) refineQueue.unshift(...refineQueue.splice(ia, 1))
        if (refineQueue.length) scheduleRefine()
      }
    }
    if (!todo.length) return finish()

    let k = 0
    const step = () => {
      if (!live(seq)) return
      const i = todo[k++]
      const a = cells[i]
      const b = cells[i + 1]
      const t1 = now()
      const r = slot.search.searchLeg(a, b, { weight, capMs })
      perLegMs[i] = now() - t1
      if (r.aborted) return
      const legMode: SearchMode = r.exact ? 'exact' : 'fast'
      slot.legs.set(key(a, b), { leg: r.leg, mode: legMode, capped: r.timedOut, exact: r.exact })
      out[i] = { index: i, from: a, to: b, leg: r.leg, mode: legMode, capped: r.timedOut }
      if (k < todo.length) {
        post({ type: 'legs', seq, padId, legs: [out[i]!], final: false })
        defer(step)
      } else finish()
    }
    step()
  }

  function scheduleRefine(): void {
    if (refineScheduled) return
    refineScheduled = true
    defer(refineSlice)
  }

  function refinerOf(padId: string, slot: PadSlot): RefineSearch {
    if (!refiner || refiner.padId !== padId || refiner.grid !== slot.env.grid) {
      refiner = null // free the old pad's buffers before taking new ones
      refiner = { padId, grid: slot.env.grid, search: createRefine(slot.env.grid, slot.model) }
    }
    return refiner.search
  }

  /** The next refine to run: the active one when it is next in the queue (resume), else a new job. */
  function nextJob(): boolean {
    while (refineQueue.length) {
      const j = refineQueue.shift()!
      const slot = slots.get(j.padId)
      const c = slot?.legs.get(key(j.from, j.to))
      if (!live(j.seq) || !slot || !c || c.exact || c.refineDone) continue
      if (active && active.padId === j.padId && active.from === j.from && active.to === j.to && !active.job.done) {
        active = { ...j, job: active.job }
        return true
      }
      active = null
      active = { ...j, job: refinerOf(j.padId, slot).beginRefine(j.from, j.to, { capMs: REFINE_CAP_MS, now: refineNow }) }
      return true
    }
    return false
  }

  /** One slice of the idle refine (at most about REFINE_SLICE_MS), then yield. */
  function refineSlice(): void {
    refineScheduled = false
    // an edit came in (active of an older seq): wait for its final, which queues the legs again
    if ((!active || !live(active.seq)) && !nextJob()) return
    const a = active!
    const r = a.job.step(REFINE_SLICE_MS)
    if (!r) return scheduleRefine()
    active = null
    const slot = slots.get(a.padId)
    const c = slot?.legs.get(key(a.from, a.to))
    if (slot && c && !c.exact && !r.aborted) {
      if (!r.exact) {
        // refine cap hit: the leg stays fast ("may not be the fastest"), not retried
        slot.legs.set(key(a.from, a.to), { ...c, refineDone: true })
      } else if (isBetterLeg(c.leg, r)) {
        slot.legs.set(key(a.from, a.to), { leg: r.leg, mode: 'exact', capped: false, exact: true, refineDone: true })
        if (live(a.seq)) post({ type: 'refined', seq: a.seq, padId: a.padId, leg: { index: a.index, from: a.from, to: a.to, leg: r.leg, mode: 'exact', capped: false }, savedS: savedSeconds(c.leg, r) })
      } else {
        // not faster: the current leg is already a fastest one; it is kept and confirmed. It serves
        // exact requests only when it is LegRouter's very leg (a tie on another path does not).
        const same = sameLeg(c.leg, r.leg)
        slot.legs.set(key(a.from, a.to), { ...c, mode: 'exact', capped: false, exact: same, refineDone: true })
        if (live(a.seq)) post({ type: 'refined', seq: a.seq, padId: a.padId, leg: { index: a.index, from: a.from, to: a.to, leg: c.leg, mode: 'exact', capped: false }, savedS: 0 })
      }
    }
    if (refineQueue.length) scheduleRefine()
  }

  function forget(padId: string): void {
    slots.delete(padId)
    refineQueue = refineQueue.filter((j) => j.padId !== padId)
    if (active?.padId === padId) active = null
    if (refiner?.padId === padId) refiner = null
  }

  function handle(msg: RouteWorkerRequest): void {
    try {
      switch (msg.type) {
        case 'env': {
          const old = slots.get(msg.env.padId)
          slots.delete(msg.env.padId)
          const same = old && old.env.scenario === msg.env.scenario && old.env.grid.width === msg.env.grid.width && old.env.grid.height === msg.env.grid.height
          const model = gradeModel(msg.env.params)
          slots.set(msg.env.padId, { env: msg.env, model, search: (opts.createSearch ?? createLegSearch)(msg.env.grid, model), legs: same ? old.legs : new Map() })
          while (slots.size > WORKER_PAD_CACHE) forget(slots.keys().next().value as string)
          if (refiner && (!slots.has(refiner.padId) || slots.get(refiner.padId)!.env.grid !== refiner.grid)) refiner = null
          return
        }
        case 'route':
          return route(msg)
        case 'cancel':
          cancelledUpTo = Math.max(cancelledUpTo, msg.seq)
          refineQueue = refineQueue.filter((j) => j.seq > msg.seq)
          return
        case 'drop':
          forget(msg.padId)
          return
      }
    } catch (e) {
      post({ type: 'error', seq: msg.type === 'route' ? msg.seq : null, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return { handle, pads: () => [...slots.keys()] }
}

// ---- Worker entry (only inside a dedicated worker; importing this module elsewhere does nothing) ----
declare const WorkerGlobalScope: { new (): unknown } | undefined
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof (WorkerGlobalScope as unknown as typeof Object)) {
  const scope = self as unknown as { onmessage: ((e: MessageEvent<RouteWorkerRequest>) => void) | null; postMessage(m: unknown): void }
  const h = createRouteWorkerHandler((m) => scope.postMessage(m))
  scope.onmessage = (e) => h.handle(e.data)
}
