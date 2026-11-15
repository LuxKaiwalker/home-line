// PORT U1: the computed route as the Route panel reads it (interfaces.md §9, owner R1).
// R1's stub (state/routeResults.ts) had not merged when U1 was built, so this file restates the §9
// contract with a local in-memory store. At rebase onto R1's stub this whole file becomes
//   export * from '../../state/routeResults'
// and nothing else in ui/route-panel/ changes (everything imports from './results').
import { signal, useSignalValue } from '../../state/signal'

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
  /** lon/lat polyline */
  path: [number, number][]
  mode: 'fast' | 'exact'
  /** replaced by the idle exact pass */
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
  /** true → show "Fast route · may not be the fastest" */
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

const leg = (index: number, from: string, to: string, minutes: number | null, o2L: number | null, feasible: boolean, reason?: string): LegResult => ({
  index,
  fromStopId: from,
  toStopId: to,
  minutes,
  o2L,
  distanceM: null,
  feasible,
  reason,
  path: [],
  mode: 'fast',
  refined: false,
})

/** 3 legs, last infeasible (tests only; made-up numbers, never shown in the app). */
export const MOCK_ROUTE_RESULTS: RouteResults = {
  seq: 1,
  padId: 'official',
  status: 'ready',
  legs: [leg(0, 'pad', 's1', 12.5, 1.5, true), leg(1, 's1', 's2', 8, 1, true), leg(2, 's2', 'pad', null, null, false, 'unreachable')],
  totalMinutes: null,
  marginMin: null,
  firstInfeasibleLeg: 2,
  fastRoute: true,
}
