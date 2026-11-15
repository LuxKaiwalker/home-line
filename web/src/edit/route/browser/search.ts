// PORT R2: the browser route's leg search — weighted A* (the "Fast route"), a per-leg time cap that
// still returns a path, and the idle-time refine at w = 1.
//
// Same graph and cost model as WP6's exact LegRouter (../map/router.ts, a port of the Mission Planer's
// router): 8 neighbours + 8 knight moves, a move needs both end cells and every crossed cell passable,
// edge time = length * pace(atan(dz / length)) from the scenario's GradeModel, heuristic = straight-line
// length * minimum pace (consistent). The only change is the priority key: g + w * h. With w = 1 the
// expressions, push order and heap are the same as LegRouter's, so the leg is IDENTICAL (cells, times,
// O2; parity-tested on the real grid in search.test.ts). With w > 1 the leg costs at most w times the
// fastest one (weighted A* with a consistent heuristic, no re-expansions) and is found much sooner.
//
// Per-leg cap (capMs, default LEG_CAP_MS): when the search has not reached the target by then it is
// marked timedOut and switches to a greedy key (w = GREEDY_WEIGHT, the open list re-keyed) for up to
// GREEDY_EXTRA x capMs more, so a leg that has a path gets one (labelled "may not be the fastest").
// refineLeg (w = 1, no greedy fallback) is meant for idle time: the caller replaces a leg only when
// isBetterLeg says the refined one is faster. In a single-threaded worker use beginRefine on a
// createRefineSearch searcher: it runs in slices (job.step(sliceMs)), so an edit arriving meanwhile is
// read between two slices instead of waiting for the whole exact search.
//
// No Worker API here: R1's worker.ts calls it (and tests call it directly).
import designRaw from '../../../../../config/design.yaml'
import { cfg } from '../../../config'
import type { GradeModel } from '../map/physio'
import { CROSSINGS, type Leg, type RouteGrid } from '../map/router'
import { DEFAULT_HEURISTIC_WEIGHT, LEG_CAP_MS } from './worker.types'

/** config/design.yaml route.heuristic_weight (assumed: true, PORT R2): w of the fast search. */
export const HEURISTIC_WEIGHT: number = heuristicWeightOf(designRaw)

/** Greedy key weight used after the cap, to finish a leg quickly (bound: cost <= GREEDY_WEIGHT x fastest). */
export const GREEDY_WEIGHT = 8
/** After the cap, the greedy finish may run this many caps more before the leg is given up (timedOut, null). */
export const GREEDY_EXTRA = 4
/** Default cap of the idle refine (exact A*), ms: generous, it runs when the user is not editing; abortable. */
export const REFINE_CAP_MS = 2000
/** Clock and abort checks every this many expansions (a power of two minus one is used as a mask). */
const CHECK_EVERY = 512

export function heuristicWeightOf(design: unknown): number {
  let w: unknown
  try {
    w = cfg<unknown>(design, 'route.heuristic_weight')
  } catch {
    return DEFAULT_HEURISTIC_WEIGHT
  }
  if (typeof w !== 'number' || !Number.isFinite(w) || w < 1) throw new Error('config/design.yaml route.heuristic_weight must be a number >= 1')
  return w
}

export interface SearchOpts {
  /** heuristic weight w >= 1 (default HEURISTIC_WEIGHT); 1 = exact A* (LegRouter parity) */
  weight?: number
  /** per-leg time cap, ms (default LEG_CAP_MS) */
  capMs?: number
  /** a newer edit arrived: stop and return { leg: null, aborted: true } (AbortSignal fits) */
  signal?: { readonly aborted: boolean }
  /** after the cap, finish greedily (default true for searchLeg, false for refineLeg) */
  fallback?: boolean
  /** clock, ms (default performance.now; tests inject a fake one) */
  now?: () => number
}

/** A sliced refine (LegSearch.beginRefine). */
export interface RefineJob {
  /** run at most about `sliceMs` more (checks every 512 expansions); null = not finished yet */
  step(sliceMs: number): SearchResult | null
  readonly done: boolean
}

export interface SearchResult {
  /** the leg (same shape as LegRouter.route), null = none found */
  leg: Leg | null
  /** leg.timeS, Infinity when leg is null */
  cost: number
  /** w = 1 and finished inside the cap: equals LegRouter.route (the fastest leg on this grid) */
  exact: boolean
  /** the cap was hit: leg (when not null) is the greedy finish, may not be the fastest */
  timedOut: boolean
  /** signal.aborted was seen: drop the result */
  aborted: boolean
  /** nodes expanded */
  expanded: number
  /** wall time, ms */
  ms: number
  /** largest key weight used: cost <= weight x fastest (1 = exact) */
  weight: number
}

/** Binary min-heap of (key, node) in typed arrays, grown on demand (= LegRouter's heap; plus rekey). */
class Heap {
  keys = new Float64Array(1024)
  nodes = new Int32Array(1024)
  size = 0
  clear(): void {
    this.size = 0
  }
  push(key: number, node: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2)
      k.set(this.keys)
      this.keys = k
      const n = new Int32Array(this.size * 2)
      n.set(this.nodes)
      this.nodes = n
    }
    let i = this.size++
    const { keys, nodes } = this
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]
      nodes[i] = nodes[p]
      i = p
    }
    keys[i] = key
    nodes[i] = node
  }
  /** Pop the minimum node (caller checks size > 0). */
  pop(): number {
    const { keys, nodes } = this
    const top = nodes[0]
    const last = --this.size
    const k = keys[last]
    const nd = nodes[last]
    this.siftDown(0, k, nd, last)
    return top
  }
  private siftDown(i: number, k: number, nd: number, size: number): void {
    const { keys, nodes } = this
    for (;;) {
      let c = 2 * i + 1
      if (c >= size) break
      if (c + 1 < size && keys[c + 1] < keys[c]) c++
      if (keys[c] >= k) break
      keys[i] = keys[c]
      nodes[i] = nodes[c]
      i = c
    }
    keys[i] = k
    nodes[i] = nd
  }
  /** Give every entry a new key and restore the heap order (Floyd). */
  rekey(key: (node: number) => number): void {
    const { keys, nodes, size } = this
    for (let i = 0; i < size; i++) keys[i] = key(nodes[i])
    for (let i = (size >> 1) - 1; i >= 0; i--) this.siftDown(i, keys[i], nodes[i], size)
  }
}

// (drow, dcol), rows grow southwards: LegRouter's OFFSETS, read back from its exported CROSSINGS
// order (the parity test pins this); restated because router.ts does not export them.
const OFFSETS: [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
  [-2, -1], [-2, 1], [2, -1], [2, 1],
  [-1, -2], [-1, 2], [1, -2], [1, 2],
] // prettier-ignore
if (CROSSINGS.length !== OFFSETS.length) throw new Error('search.ts: move set differs from router.ts')

const now0 = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** A leg searcher for one grid + grade model (holds its buffers, like LegRouter; reuse it per pad). */
export class LegSearch {
  readonly grid: RouteGrid
  readonly model: GradeModel
  private readonly cost: Float64Array
  private readonly parent: Int32Array
  private readonly stamp: Uint32Array
  private readonly closed: Uint32Array
  private gen = 0
  private readonly heap = new Heap()
  private readonly unit: Float64Array
  private readonly dr = OFFSETS.map((o) => o[0])
  private readonly dc = OFFSETS.map((o) => o[1])
  /** crossed cells of move k (rows, cols relative to the origin: CROSSINGS) */
  private readonly cross: [number, number][][] = CROSSINGS
  /** allowed moves per cell, filled lazily: bit k = move k allowed (LegRouter.target), bit 16 = known */
  private readonly moves: Uint32Array

  /** `shareMovesWith`: another LegSearch of the same grid whose (immutable) move mask is reused. */
  constructor(grid: RouteGrid, model: GradeModel, shareMovesWith?: LegSearch) {
    const n = grid.width * grid.height
    if (grid.elev.length !== n || grid.passable.length !== n) throw new Error('RouteGrid arrays do not match width x height')
    this.grid = grid
    this.model = model
    this.cost = new Float64Array(n)
    this.parent = new Int32Array(n)
    this.stamp = new Uint32Array(n)
    this.closed = new Uint32Array(n)
    this.moves = shareMovesWith && shareMovesWith.grid === grid ? shareMovesWith.moves : new Uint32Array(n)
    this.unit = Float64Array.from(OFFSETS, ([a, b]) => Math.hypot(a, b) * grid.resM)
  }

  /** Fast leg: weighted A* (default w = HEURISTIC_WEIGHT), capped, greedy finish after the cap. */
  searchLeg(from: number, to: number, opts: SearchOpts = {}): SearchResult {
    return this.begin(from, to, opts.weight ?? HEURISTIC_WEIGHT, opts.capMs ?? LEG_CAP_MS, opts.fallback ?? true, opts.signal, opts.now ?? now0)(Infinity)!
  }

  /** Idle refine: exact A* (w = 1), cap REFINE_CAP_MS by default, no greedy finish (null when capped). */
  refineLeg(from: number, to: number, opts: Omit<SearchOpts, 'weight'> = {}): SearchResult {
    return this.begin(from, to, 1, opts.capMs ?? REFINE_CAP_MS, opts.fallback ?? false, opts.signal, opts.now ?? now0)(Infinity)!
  }

  /**
   * Sliced idle refine for a single-threaded worker: the exact search (w = 1) runs in slices,
   * `job.step(sliceMs)` returns null while it is not finished, so the worker can yield between slices
   * and read the next edit. capMs counts busy time only (default REFINE_CAP_MS; over it: leg null,
   * timedOut). The job owns this LegSearch's buffers: any other search on it in between ends the job
   * (step returns aborted). Use a separate searcher for refining: createRefineSearch.
   */
  beginRefine(from: number, to: number, opts: Omit<SearchOpts, 'weight' | 'fallback'> = {}): RefineJob {
    const step = this.begin(from, to, 1, opts.capMs ?? REFINE_CAP_MS, false, opts.signal, opts.now ?? now0)
    const now = opts.now ?? now0
    let result: SearchResult | null = null
    return {
      get done() {
        return result !== null
      },
      step(sliceMs: number): SearchResult | null {
        if (result === null) result = step(now() + sliceMs)
        return result
      },
    }
  }

  /**
   * Set up one search; the returned stepper runs it until `sliceEnd` (clock ms) and returns null
   * there, or the result once finished. A stepper whose buffers were taken by a newer search returns
   * aborted.
   */
  private begin(from: number, to: number, weight: number, capMs: number, fallback: boolean, signal: SearchOpts['signal'], now: () => number): (sliceEnd: number) => SearchResult | null {
    if (!(weight >= 1) || !Number.isFinite(weight)) throw new Error(`search: weight must be a finite number >= 1, got ${weight}`)
    const { width: W, passable, elev } = this.grid
    let busyMs = 0
    let w = weight
    let wMax = weight
    let timedOut = false
    let expanded = 0
    const done = (leg: Leg | null, aborted = false): SearchResult => ({
      leg,
      cost: leg ? leg.timeS : Infinity,
      exact: wMax === 1 && !timedOut && !aborted,
      timedOut,
      aborted,
      expanded,
      ms: busyMs,
      weight: wMax,
    })
    const t0 = now()
    if (!passable[from] || !passable[to]) return () => ((busyMs = now() - t0), done(null))
    if (from === to) return () => ((busyMs = now() - t0), done({ cells: [from], timeS: 0, o2L: 0, distM: 0, tauS: [0], o2CumL: [0] }))
    if (++this.gen === 0xffffffff) {
      this.stamp.fill(0)
      this.closed.fill(0)
      this.gen = 1
    }
    const gen = this.gen
    const { cost, parent, stamp, closed, heap, unit, dr, dc, moves, model } = this
    const tr = Math.floor(to / W)
    const tc = to % W
    const hf = model.minPace * this.grid.resM
    const keyOf = (node: number) => {
      const r = Math.floor(node / W)
      return cost[node] + w * (Math.hypot(r - tr, node - r * W - tc) * hf)
    }
    heap.clear()
    cost[from] = 0
    parent[from] = -1
    stamp[from] = gen
    heap.push(w * (Math.hypot(Math.floor(from / W) - tr, (from % W) - tc) * hf), from)
    let first = true
    let ticks = 0
    return (sliceEnd: number): SearchResult | null => {
      const s0 = first ? t0 : now()
      first = false
      const busy0 = busyMs
      if (this.gen !== gen) return done(null, true)
      if (signal?.aborted) return (busyMs = busy0 + now() - s0), done(null, true)
      while (heap.size > 0) {
        // clock, abort, cap and slice checks before the pop, so a yield leaves the open list untouched
        if ((++ticks & (CHECK_EVERY - 1)) === 0) {
          const t = now()
          busyMs = busy0 + t - s0
          if (signal?.aborted) return done(null, true)
          if (!timedOut && busyMs >= capMs) {
            timedOut = true
            if (!fallback) return done(null)
            w = Math.max(w, GREEDY_WEIGHT)
            wMax = w
            heap.rekey(keyOf)
          } else if (timedOut && busyMs >= (1 + GREEDY_EXTRA) * capMs) return done(null)
          else if (t >= sliceEnd) return null
        }
        const i = heap.pop()
        if (closed[i] === gen) continue
        closed[i] = gen
        if (i === to) {
          const leg = this.build(from, to)
          busyMs = busy0 + now() - s0
          return done(leg)
        }
        expanded++
        const r = Math.floor(i / W)
        const c = i - r * W
        const ci = cost[i]
        const ei = elev[i]
        let mv = moves[i]
        if (mv === 0) mv = moves[i] = this.movesOf(r, c)
        for (let k = 0; k < 16; k++) {
          if (!(mv & (1 << k))) continue
          const r2 = r + dr[k]
          const c2 = c + dc[k]
          const j = r2 * W + c2
          if (closed[j] === gen) continue
          // LegRouter.edge
          const len = unit[k]
          const pace = model.lookup(Math.atan((elev[j] - ei) / len)).pace
          if (pace === Infinity) continue
          const cj = ci + len * pace
          if (stamp[j] !== gen || cj < cost[j]) {
            stamp[j] = gen
            cost[j] = cj
            parent[j] = i
            heap.push(cj + w * (Math.hypot(r2 - tr, c2 - tc) * hf), j)
          }
        }
      }
      busyMs = busy0 + now() - s0
      return done(null)
    }
  }

  /** LegRouter.target for all 16 moves of (r, c): bit k = in bounds, target and crossed cells passable; bit 16 set. */
  private movesOf(r: number, c: number): number {
    const { width: W, height: H, passable } = this.grid
    let m = 1 << 16
    for (let k = 0; k < 16; k++) {
      const r2 = r + this.dr[k]
      const c2 = c + this.dc[k]
      if (r2 < 0 || c2 < 0 || r2 >= H || c2 >= W || !passable[r2 * W + c2]) continue
      let ok = true
      for (const [xi, xj] of this.cross[k]) if (!passable[(r + xi) * W + (c + xj)]) ok = false
      if (ok) m |= 1 << k
    }
    return m
  }

  /** = LegRouter.build: walk the parents, then re-sum time, O2 and length along the path. */
  private build(from: number, to: number): Leg {
    const { width: W, elev } = this.grid
    const cells: number[] = []
    for (let i = to; i !== -1; i = this.parent[i]) cells.push(i)
    cells.reverse()
    let timeS = 0
    let o2L = 0
    let distM = 0
    const tauS = [0]
    const o2CumL = [0]
    for (let s = 1; s < cells.length; s++) {
      const a = cells[s - 1]
      const b = cells[s]
      const di = Math.floor(b / W) - Math.floor(a / W)
      const dj = (b % W) - (a % W)
      const k = OFFSETS.findIndex(([x, y]) => x === di && y === dj)
      const len = this.unit[k]
      const p = this.model.lookup(Math.atan((elev[b] - elev[a]) / len))
      timeS += len * p.pace
      o2L += len * p.o2
      distM += len
      tauS.push(timeS)
      o2CumL.push(o2L)
    }
    if (cells[0] !== from) throw new Error('A* path does not start at the start cell')
    return { cells, timeS, o2L, distM, tauS, o2CumL }
  }
}

const searchers = new WeakMap<RouteGrid, LegSearch>()

/** The LegSearch of a grid + model (one per grid, rebuilt when the model changes). */
export function createLegSearch(grid: RouteGrid, model: GradeModel): LegSearch {
  const s = searchers.get(grid)
  if (s && s.model === model) return s
  const n = new LegSearch(grid, model)
  searchers.set(grid, n)
  return n
}

const refiners = new WeakMap<RouteGrid, LegSearch>()

/**
 * A second LegSearch of the grid for the sliced idle refine (beginRefine): own buffers, so a fast
 * search for a new edit does not end the refine job; shares the move mask with createLegSearch's.
 * Memory: about 8 + 4 + 4 + 4 bytes per cell (~40 MB on the 1480 x 1480 grid); make it for the active pad only.
 */
export function createRefineSearch(grid: RouteGrid, model: GradeModel): LegSearch {
  const s = refiners.get(grid)
  if (s && s.model === model) return s
  const n = new LegSearch(grid, model, createLegSearch(grid, model))
  refiners.set(grid, n)
  return n
}

/** Fast leg on `grid` (see LegSearch.searchLeg). */
export function searchLeg(grid: RouteGrid, model: GradeModel, from: number, to: number, opts?: SearchOpts): SearchResult {
  return createLegSearch(grid, model).searchLeg(from, to, opts)
}

/** Idle refine on `grid` (see LegSearch.refineLeg). */
export function refineLeg(grid: RouteGrid, model: GradeModel, from: number, to: number, opts?: Omit<SearchOpts, 'weight'>): SearchResult {
  return createLegSearch(grid, model).refineLeg(from, to, opts)
}

/**
 * Should the refined leg replace the current one? Only a finished exact search, only when it is
 * faster by more than `minSavedS` seconds (default: any amount). A current null leg (none found yet)
 * is replaced by any refined leg.
 */
export function isBetterLeg(current: Leg | null, refined: SearchResult, minSavedS = 0): boolean {
  if (!refined.leg || refined.aborted || !refined.exact) return false
  if (!current) return true
  return refined.leg.timeS < current.timeS - minSavedS
}

/** Seconds a refined leg saves over the current one (0 when it does not replace it). */
export function savedSeconds(current: Leg | null, refined: SearchResult): number {
  if (!refined.leg || !current) return 0
  return Math.max(0, current.timeS - refined.leg.timeS)
}
