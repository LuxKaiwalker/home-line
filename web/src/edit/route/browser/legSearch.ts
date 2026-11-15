// R1 (Plan port): the worker's leg search, behind R2's API (requests-I1.md "R2 (20:20)": search.ts
// createLegSearch / isBetterLeg / SearchResult). Until R2's weighted A* lands this is the thin adapter
// onto the main thread's exact A* (map/router.ts LegRouter, w = 1, no cap): every leg is exact, so the
// numbers equal the Mission Planer's and nothing needs refining. R2's swap = replace this file's body
// with `export { createLegSearch, isBetterLeg, type LegSearch, type SearchOpts, type SearchResult } from './search'`.
import type { GradeModel } from '../map/physio'
import { LegRouter, type Leg, type RouteGrid } from '../map/router'

export interface SearchOpts {
  /** heuristic weight >= 1 (1 = exact) */
  weight?: number
  /** per-leg cap, ms */
  capMs?: number
  signal?: { readonly aborted: boolean }
  now?: () => number
}

export interface SearchResult {
  /** same shape as LegRouter.route; null = no path */
  leg: Leg | null
  /** leg.timeS, Infinity when null */
  cost: number
  /** equals LegRouter.route (weight 1, not timed out) */
  exact: boolean
  timedOut: boolean
  aborted: boolean
  expanded: number
  ms: number
  weight: number
}

export interface LegSearch {
  searchLeg(from: number, to: number, opts?: SearchOpts): SearchResult
  refineLeg(from: number, to: number, opts?: Pick<SearchOpts, 'capMs' | 'signal'>): SearchResult
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Adapter: exact A* for every mode (the weight is ignored until R2's search.ts). */
export function createLegSearch(grid: RouteGrid, model: GradeModel): LegSearch {
  const router = new LegRouter(grid, model)
  const run = (from: number, to: number, opts?: SearchOpts): SearchResult => {
    const now = opts?.now ?? nowMs
    const t0 = now()
    const leg = router.route(from, to)
    return { leg, cost: leg ? leg.timeS : Infinity, exact: true, timedOut: false, aborted: false, expanded: 0, ms: now() - t0, weight: 1 }
  }
  return { searchLeg: run, refineLeg: run }
}

/** Replace only when strictly faster (more than half a second). */
export function isBetterLeg(current: Leg | null, refined: SearchResult): boolean {
  if (!refined.leg || refined.aborted) return false
  if (!current) return true
  return current.timeS - refined.cost > 0.5
}
