// PORT P3: local stand-in for `state/routeResults.ts` (interfaces.md §9, owner R1). Same contract; once
// R1's stub is on port/plan-mission this file becomes one line:
//   export * from '../../state/routeResults'
// Until then the store is local (nothing publishes into it in the app, so the bar shows "Your route ·
// n stops" without a margin). No edit/route import (§7b).
import { signal, useSignalValue } from '../../state/signal'

export type LegResult = {
  index: number
  fromStopId: string
  toStopId: string
  minutes: number | null
  o2L: number | null
  distanceM: number | null
  feasible: boolean
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
const store = signal<RouteResults>(IDLE)

export function getRouteResults(): RouteResults {
  return store.peek()
}
export function subscribeRouteResults(fn: (r: RouteResults) => void): () => void {
  return store.subscribe(fn)
}
export function useRouteResults<T>(sel: (r: RouteResults) => T): T {
  return sel(useSignalValue(store))
}
export function publishRouteResults(r: RouteResults): void {
  store.value = r
}

const leg = (index: number, feasible: boolean): LegResult => ({
  index,
  fromStopId: `s${index}`,
  toStopId: `s${index + 1}`,
  minutes: feasible ? 20 + index : null,
  o2L: feasible ? 10 : null,
  distanceM: feasible ? 900 : null,
  feasible,
  reason: feasible ? undefined : 'unreachable',
  path: [],
  mode: 'fast',
  refined: false,
})
export const MOCK_ROUTE_RESULTS: RouteResults = { seq: 1, padId: 'official', status: 'ready', legs: [leg(0, true), leg(1, true), leg(2, false)], totalMinutes: null, marginMin: null, firstInfeasibleLeg: 2, fastRoute: true }
