// R1 (Plan port): the route worker of the one route core (worker.types.ts contract). Moved from the
// Mission Planer's J1h worker (mission/legsWorker.ts + legsRoute.ts): the same LegRouter / grade model
// (physio.ts gradeModel on the scenario's Params), now behind the leg search (legSearch.ts, R2's API)
// with per-request sequencing, partial answers, a leg cache per pad and an idle refine pass.
//
// Per 'route' request: legs already cached answer at once (one 'legs' partial), the rest are routed
// shortest first, one 'legs' partial per finished leg, yielding between legs so a newer request or a
// 'cancel' stops the old one; then 'timing' and 'legs' final (every leg; timing first so the main
// thread has the worker's time when it publishes). When idle, legs that are not
// exact are refined with exact A* and 'refined' is posted when one got faster. A cell < 0 (no cell:
// the stop could not be placed) gives a null leg that is never routed. The handler is free of any
// Worker API (tested directly in worker.test.ts); the bottom of this file wires it to `self`.
import { gradeModel } from '../map/physio'
import type { Leg } from '../map/router'
import { createLegSearch, isBetterLeg, type LegSearch } from './legSearch'
import { LEG_CAP_MS, type RouteWorkerRequest, type RouteWorkerResponse, type SearchMode, type WorkerLeg, type WorkerPadEnv } from './worker.types'

/** Pads kept in the worker (pads/types.ts PAD_CACHE_SIZE). */
export const WORKER_PAD_CACHE = 3
/** Cap of one idle refine, ms: the worker is single-threaded, so a refine delays the next edit by at
 *  most this much (an uncapped exact leg of 3 km takes longer: D137). A refine over the cap is dropped. */
export const REFINE_CAP_MS = 250

interface CachedLeg {
  leg: Leg | null
  mode: SearchMode
  capped: boolean
  exact: boolean
}

interface PadSlot {
  env: WorkerPadEnv
  search: LegSearch
  legs: Map<string, CachedLeg>
}

export interface RouteWorkerOptions {
  /** run fn later (between legs, idle refine); default setTimeout 0 */
  defer?: (fn: () => void) => void
  now?: () => number
  /** the leg search per pad (default legSearch.ts createLegSearch; tests inject a fake fast search) */
  createSearch?: typeof createLegSearch
}

export interface RouteWorkerHandler {
  handle(msg: RouteWorkerRequest): void
  /** tests: the pads held, most recent last */
  pads(): string[]
}

const key = (a: number, b: number) => `${a}-${b}`
const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const defaultDefer = (fn: () => void): void => void setTimeout(fn, 0)

export function createRouteWorkerHandler(post: (m: RouteWorkerResponse) => void, opts: RouteWorkerOptions = {}): RouteWorkerHandler {
  const defer = opts.defer ?? defaultDefer
  const now = opts.now ?? defaultNow
  const slots = new Map<string, PadSlot>() // insertion order = LRU (oldest first)
  /** the newest request seen; requests (and refines) older than it stop */
  let latest = 0
  let cancelledUpTo = 0
  const live = (seq: number) => seq >= latest && seq > cancelledUpTo
  let refineQueue: { seq: number; padId: string; index: number; from: number; to: number }[] = []
  let refining = false
  const abort = { aborted: false }

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
    abort.aborted = true // stop a running refine (checked between expansions by R2's search)
    refineQueue = []
    const slot = touch(msg.padId)
    if (!slot) {
      post({ type: 'error', seq: msg.seq, message: `route worker: no environment for pad ${msg.padId}` })
      return
    }
    const t0 = now()
    const { seq, padId, cells, mode } = msg
    const capMs = msg.legCapMs > 0 ? msg.legCapMs : LEG_CAP_MS
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
          if (c && !c.exact) refineQueue.push({ seq, padId, index: l.index, from: l.from, to: l.to })
        }
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
    if (refining) return
    refining = true
    defer(refineOne)
  }

  function refineOne(): void {
    refining = false
    const job = refineQueue.shift()
    if (!job) return
    if (!live(job.seq)) return
    const slot = slots.get(job.padId)
    const c = slot?.legs.get(key(job.from, job.to))
    if (slot && c && !c.exact) {
      abort.aborted = false
      const r = slot.search.refineLeg(job.from, job.to, { capMs: REFINE_CAP_MS, signal: abort })
      if (!r.aborted && r.exact) {
        const better = isBetterLeg(c.leg, r)
        const saved = c.leg && r.leg ? c.leg.timeS - r.cost : 0
        // exact now either way (the cached leg was already the fastest when not better)
        slot.legs.set(key(job.from, job.to), better ? { leg: r.leg, mode: 'exact', capped: false, exact: true } : { ...c, exact: true })
        if (better && live(job.seq)) post({ type: 'refined', seq: job.seq, padId: job.padId, leg: { index: job.index, from: job.from, to: job.to, leg: r.leg, mode: 'exact', capped: false }, savedS: saved })
      }
    }
    if (refineQueue.length) scheduleRefine()
  }

  function handle(msg: RouteWorkerRequest): void {
    try {
      switch (msg.type) {
        case 'env': {
          const old = slots.get(msg.env.padId)
          slots.delete(msg.env.padId)
          const same = old && old.env.scenario === msg.env.scenario && old.env.grid.width === msg.env.grid.width && old.env.grid.height === msg.env.grid.height
          slots.set(msg.env.padId, { env: msg.env, search: (opts.createSearch ?? createLegSearch)(msg.env.grid, gradeModel(msg.env.params)), legs: same ? old.legs : new Map() })
          while (slots.size > WORKER_PAD_CACHE) slots.delete(slots.keys().next().value as string)
          return
        }
        case 'route':
          return route(msg)
        case 'cancel':
          cancelledUpTo = Math.max(cancelledUpTo, msg.seq)
          abort.aborted = true
          refineQueue = refineQueue.filter((j) => j.seq > msg.seq)
          return
        case 'drop':
          slots.delete(msg.padId)
          refineQueue = refineQueue.filter((j) => j.padId !== msg.padId)
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
