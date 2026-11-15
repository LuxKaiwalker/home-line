// PORT R4: route results as the map reads them (interfaces.md §9, `state/routeResults.ts`, owner R1).
// Until R1's stub merges this file restates the §9 contract with a local store so R4 can be built and
// tested; at rebase it becomes `export * from '../../state/routeResults'` (one line, same names).
// Nothing here imports edit/route/** (§7b).

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

const IDLE: RouteResults = { seq: 0, padId: 'official', status: 'idle', legs: [], totalMinutes: null, marginMin: null, firstInfeasibleLeg: null, fastRoute: true }

let current: RouteResults = IDLE
const subs = new Set<(r: RouteResults) => void>()

export function getRouteResults(): RouteResults {
  return current
}
export function subscribeRouteResults(fn: (r: RouteResults) => void): () => void {
  subs.add(fn)
  return () => void subs.delete(fn)
}
/** R1's runner only (and tests / mocks). */
export function publishRouteResults(r: RouteResults): void {
  current = r
  for (const f of [...subs]) f(r)
}

/** 3 legs (pad → s1 → s2 → pad), the last one infeasible: for UI / R4 tests. */
export const MOCK_ROUTE_RESULTS: RouteResults = {
  seq: 1,
  padId: 'official',
  status: 'ready',
  legs: [
    { index: 0, fromStopId: 'pad', toStopId: 's1', minutes: 12, o2L: 20, distanceM: 600, feasible: true, path: [[137.4018, -4.7775], [137.4022, -4.7770], [137.4030, -4.7765]], mode: 'fast', refined: false },
    { index: 1, fromStopId: 's1', toStopId: 's2', minutes: 9, o2L: 15, distanceM: 450, feasible: true, path: [[137.4030, -4.7765], [137.4036, -4.7760]], mode: 'fast', refined: false },
    { index: 2, fromStopId: 's2', toStopId: 'pad', minutes: null, o2L: null, distanceM: null, feasible: false, reason: 'budget', path: [[137.4036, -4.7760], [137.4026, -4.7769], [137.4018, -4.7775]], mode: 'fast', refined: false },
  ],
  totalMinutes: null,
  marginMin: -4,
  firstInfeasibleLeg: 2,
  fastRoute: true,
}
