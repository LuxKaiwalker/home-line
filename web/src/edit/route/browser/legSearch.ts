// R1 (Plan port): the worker's leg search = R2's search.ts (weighted A* "Fast route" with a per-leg cap
// and greedy finish; w = 1 is exact and equals LegRouter). PORT R1b: swapped from R1's exact adapter.
// LegSearch / RefineSearch stay interfaces here (search.ts's LegSearch is a class with private
// buffers), so tests can inject fakes.
import type { Leg } from '../map/router'
import { isBetterLeg as isBetter, type RefineJob, type SearchOpts, type SearchResult } from './search'
export { createLegSearch, createRefineSearch, savedSeconds, type RefineJob, type SearchOpts, type SearchResult } from './search'

/** The fast / exact leg search of one pad (search.ts createLegSearch). */
export interface LegSearch {
  searchLeg(from: number, to: number, opts?: SearchOpts): SearchResult
  refineLeg(from: number, to: number, opts?: Pick<SearchOpts, 'capMs' | 'signal'>): SearchResult
}

/** The sliced idle refine of one pad, on its own buffers (search.ts createRefineSearch). */
export interface RefineSearch {
  beginRefine(from: number, to: number, opts?: Pick<SearchOpts, 'capMs' | 'signal' | 'now'>): RefineJob
}

/**
 * Should the refined (exact) leg replace the current one? Only a finished exact search that is
 * strictly faster (search.ts isBetterLeg, minSavedS 0: any amount, so the route converges to the
 * exact legs). A finished exact leg that is not faster means the current leg is already the fastest.
 */
export function isBetterLeg(current: Leg | null, refined: SearchResult): boolean {
  return isBetter(current, refined, 0)
}
