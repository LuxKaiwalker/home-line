// PORT U2: route results as the waypoint list reads them (interfaces.md §9, owner R1).
//
// TEMPORARY local copy of the §9 contract until R1's web/src/state/routeResults.ts merges into
// port/plan-mission. At rebase this whole file becomes one line:
//   export { MOCK_ROUTE_RESULTS, publishRouteResults, useRouteResults, type LegResult, type RouteResults } from '../../../state/routeResults'
// The list only uses LegResult / RouteResults, useRouteResults and (tests) MOCK_ROUTE_RESULTS.
import { signal, useSignalValue } from '../../../state/signal'

export type LegResult = {
  index: number
  fromStopId: string
  toStopId: string
  minutes: number | null
  o2L: number | null
  distanceM: number | null
  feasible: boolean
  /** e.g. 'unreachable' | 'budget' | 'slope' */
  reason?: string
  path: [number, number][]
  mode: 'fast' | 'exact'
  refined: boolean
}

export type RouteResults = {
  seq: number
  padId: string
  status: 'idle' | 'computing' | 'partial' | 'ready' | 'error'
  legs: LegResult[]
  totalMinutes: number | null
  marginMin: number | null
  firstInfeasibleLeg: number | null
  fastRoute: boolean
  timingMs?: number
  error?: string
}

const IDLE: RouteResults = { seq: 0, padId: 'official', status: 'idle', legs: [], totalMinutes: null, marginMin: null, firstInfeasibleLeg: null, fastRoute: false }
const results = signal<RouteResults>(IDLE)

export const getRouteResults = (): RouteResults => results.peek()
export const subscribeRouteResults = (fn: (r: RouteResults) => void): (() => void) => results.subscribe(fn)
export function useRouteResults<T>(sel: (r: RouteResults) => T): T {
  return sel(useSignalValue(results))
}
export function publishRouteResults(r: RouteResults): void {
  results.value = r
}

/** §9 test fixture (same as R1's): pad → w1 → s3 → pad, the last leg (walk home) infeasible. Not real numbers. */
export const MOCK_ROUTE_RESULTS: RouteResults = {
  seq: 1,
  padId: 'official',
  status: 'ready',
  legs: [
    { index: 0, fromStopId: 'pad', toStopId: 'w1', minutes: 18.5, o2L: 9.6, distanceM: 640, feasible: true, path: [], mode: 'fast', refined: false },
    { index: 1, fromStopId: 'w1', toStopId: 's3', minutes: 26.0, o2L: 13.5, distanceM: 910, feasible: true, path: [], mode: 'exact', refined: true },
    { index: 2, fromStopId: 's3', toStopId: 'pad', minutes: null, o2L: null, distanceM: null, feasible: false, reason: 'budget', path: [], mode: 'fast', refined: false },
  ],
  totalMinutes: 44.5,
  marginMin: -6.2,
  firstInfeasibleLeg: 2,
  fastRoute: true,
  timingMs: 42,
}
