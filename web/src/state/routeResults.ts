// Route results (Plan port, interfaces.md §9; owner R1). The computed route of the planning store,
// readable by the route panel, the map route layer and the context bar WITHOUT importing
// edit/route/** (isolation rule §7b). Only the route core's runner (edit/route/browser/runner.ts)
// publishes here; tests and mocks may too. Numbers come only from the core: minutes / o2L /
// marginMin in mission.json units (minutes, litres), margin = the four-term margin. The UI labels
// them "Estimate", and "Fast route · may not be the fastest" while fastRoute is true.
import { signal, useSignalValue } from './signal'

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
  /** PORT F12: the core's binding margin term at the lowest point (D28 tie order); absent/null = unknown */
  binding?: 'O2' | 'daylight' | 'dose' | 'EVA duration' | null
  /** PORT F12: the lowest dose-term margin (D39 storm replay); only while the storm switch is on, else null */
  doseMarginMin?: number | null
  /** true → show "Fast route · may not be the fastest" */
  fastRoute: boolean
  timingMs?: number
  error?: string
}

/** Nothing planned / nothing computed yet. */
export const IDLE_ROUTE_RESULTS: RouteResults = Object.freeze({
  seq: 0,
  padId: 'official',
  status: 'idle',
  legs: [],
  totalMinutes: null,
  marginMin: null,
  firstInfeasibleLeg: null,
  fastRoute: false,
}) as RouteResults

const results = signal<RouteResults>(IDLE_ROUTE_RESULTS)

export function getRouteResults(): RouteResults {
  return results.peek()
}

/** fn runs on every change (never immediately). Returns unsubscribe. */
export function subscribeRouteResults(fn: (r: RouteResults) => void): () => void {
  return results.subscribe(fn)
}

/** Preact hook: the selected slice; re-renders when the results change. */
export function useRouteResults<T>(sel: (r: RouteResults) => T): T {
  return sel(useSignalValue(results))
}

/** R1's runner only (and tests / mocks). Publishing the same object again is a no-op. */
export function publishRouteResults(r: RouteResults): void {
  results.value = r
}

/** Tests: back to idle. */
export function resetRouteResults(): void {
  results.value = IDLE_ROUTE_RESULTS
}

/** For UI / R4 tests only: 3 legs pad → W1 → S3 → pad, the last one infeasible (budget). Not real numbers. */
export const MOCK_ROUTE_RESULTS: RouteResults = Object.freeze({
  seq: 1,
  padId: 'official',
  status: 'ready',
  legs: [
    { index: 0, fromStopId: 'pad', toStopId: 'w1', minutes: 18.5, o2L: 9.6, distanceM: 640, feasible: true, path: [[137.385, -4.78], [137.39, -4.776], [137.396, -4.772]], mode: 'fast', refined: false },
    { index: 1, fromStopId: 'w1', toStopId: 's3', minutes: 26.0, o2L: 13.5, distanceM: 910, feasible: true, path: [[137.396, -4.772], [137.402, -4.768], [137.408, -4.765]], mode: 'exact', refined: true },
    { index: 2, fromStopId: 's3', toStopId: 'pad', minutes: null, o2L: null, distanceM: null, feasible: false, reason: 'budget', path: [], mode: 'fast', refined: false },
  ],
  totalMinutes: 44.5,
  marginMin: -6.2,
  firstInfeasibleLeg: 2,
  fastRoute: true,
  timingMs: 42,
}) as RouteResults
