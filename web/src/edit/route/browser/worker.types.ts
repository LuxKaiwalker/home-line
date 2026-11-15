// PORT W0a: message contract of the route worker (R1 moves mission/legsWorker.ts here as worker.ts;
// R2 adds the fast heuristic + anytime refine). Main thread <-> worker, structured-clone only (no
// classes, no functions): grids travel as typed arrays, legs as plain objects.
//
// Flow per edit:  main posts 'route' {seq} -> worker answers 'legs' partial (each finished leg, cheap
// first) … then 'timing', then 'legs' final. When idle, the worker refines legs with exact A* (w = 1)
// and posts 'refined' for every leg that got faster. Main drops every message whose seq is older
// than its latest request ('cancel' lets the worker stop early). Legs are keyed by cell pair
// "from-to" (edit/route/browser/data.ts legCache key), so a refined leg replaces the cached one.
import type { Leg, RouteGrid } from '../map/router'
import type { Params } from '../map/physio'
import type { PadId } from '../../../state/planning'

/** 'fast' = weighted A* (w = config/design.yaml route.heuristic_weight, default 1.6, assumed);
 *  'exact' = A* with w = 1 (the parity mode: numbers equal the main-thread LegRouter). */
export type SearchMode = 'fast' | 'exact'

/** Routing environment of one pad (sent once per pad; the worker keeps the last PAD_CACHE_SIZE). */
export interface WorkerPadEnv {
  padId: PadId
  scenario: string
  grid: RouteGrid
  /** grade model parameters of the scenario (map/physio.ts scenarioParams) */
  params: Params
  /** the pad's cell on the grid (access cell) */
  padCell: number
}

export type RouteWorkerRequest =
  /** load (or replace) a pad's routing environment */
  | { type: 'env'; env: WorkerPadEnv }
  /**
   * route the legs of a stop sequence: cells in walking order, pad first and last
   * (pad -> stops… -> pad). Legs already known (same pair, same or better mode) come from the cache.
   */
  | {
      type: 'route'
      seq: number
      padId: PadId
      cells: readonly number[]
      mode: SearchMode
      /** heuristic weight w >= 1 for 'fast' (ignored for 'exact') */
      weight: number
      /** per-leg time cap, ms (default 150): over it, the best path so far is returned (capped: true) */
      legCapMs: number
      /** idle refine after the final answer (default true) */
      refine?: boolean
    }
  /** stop work for requests with seq <= this (a newer edit arrived) */
  | { type: 'cancel'; seq: number }
  /** drop a pad's environment and its legs */
  | { type: 'drop'; padId: PadId }

export interface WorkerLeg {
  /** index in the request: 0 = pad -> cells[1], …, last = back to the pad */
  index: number
  from: number
  to: number
  /** null = no path (unreachable) */
  leg: Leg | null
  mode: SearchMode
  /** the per-leg cap stopped the search: leg is the best path so far, may not be the fastest */
  capped: boolean
}

export type RouteWorkerResponse =
  /** legs of request `seq`; final = every leg of the request is in (some may still be refined later) */
  | { type: 'legs'; seq: number; padId: PadId; legs: WorkerLeg[]; final: boolean }
  /** idle refine found a faster leg (exact A*): replace leg `index` of request `seq` and the cache */
  | { type: 'refined'; seq: number; padId: PadId; leg: WorkerLeg; savedS: number }
  /** timing of request `seq` (perf probe: <= 200 ms per edit) */
  | { type: 'timing'; seq: number; totalMs: number; perLegMs: number[]; cacheHits: number }
  | { type: 'error'; seq: number | null; message: string }

/** Default per-leg cap, ms (Notion §3 "Fast heuristic"). */
export const LEG_CAP_MS = 150
/** Default heuristic weight (config/design.yaml route.heuristic_weight; assumed until it exists). */
export const DEFAULT_HEURISTIC_WEIGHT = 1.6
