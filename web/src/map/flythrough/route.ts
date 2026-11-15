// WS16 task 10 (M10): the flight path of the plan on show: WS7's Plan (route + timeline of the
// published scenario) -> routeLine (M5) -> SmoothPath. The clock maps to metres along the route by
// Plan.stateAt(t).distanceWalkedM, so the flythrough follows the timeline exactly (dwells hold still).
// L10 (D111): the camera chases the crew (path.ts chasePose). Its anchor is the crew's distance along
// the route, box-smoothed over camera.flythrough.smooth_min EVA minutes (centred, so it does not lag at
// a steady pace; starts and stops at stations ease in and out). The crew marker itself sits on the
// exact planned position (crewAt).
import { data } from '../../data/loader'
import { Plan } from '../../hud/plan'
import type { TimelineEvent } from '../../hud/types'
import { resolvePlanScenario } from '../../state'
import { CHASE, FLYTHROUGH, FOLLOW_TABLE_STEP_MIN, FOLLOW_TURN_DEG_PER_MIN } from '../../story/config'
import { routeLine } from '../route'
import type { LonLat } from '../../hud/types'
import { angleDiff, chasePose, SmoothPath, type CameraPose, type Metric } from './path'
import type { UserFlight } from './userRoute'

export interface FlightPath {
  scenario: string
  plan: Plan
  path: SmoothPath
  /** chase-camera pose at an EVA minute */
  poseAt(tMin: number): CameraPose
  /** the crew's planned position at an EVA minute (Plan.stateAt; the crew marker) */
  crewAt(tMin: number): LonLat
  /** the camera anchor: metres along the route at an EVA minute (smoothed) */
  anchorAt(tMin: number): number
}

/** Metres per degree of the field grid (fields/index.json), the metric the HUD and the route use. */
export function gridMetric(ix: { bounds: number[]; width: number; height: number; res_m: number }): Metric {
  const [w, s, e, n] = ix.bounds
  return { mPerDegLon: (ix.width * ix.res_m) / (e - w), mPerDegLat: (ix.height * ix.res_m) / (n - s) }
}

/**
 * Follow-camera bearing over EVA time: the crew -> look-ahead direction, turned at most
 * `degPerMin` per EVA minute (a forward pass over a fixed table, so it is a pure function of t and
 * scrubbing anywhere gives the same picture as playing there).
 */
export function bearingTable(raw: (t: number) => number, tEnd: number, stepMin: number, degPerMin: number): (t: number) => number {
  const n = Math.max(1, Math.ceil(tEnd / stepMin))
  const tab = new Float64Array(n + 1)
  tab[0] = raw(0)
  const maxStep = degPerMin * stepMin
  for (let i = 1; i <= n; i++) {
    const d = angleDiff(tab[i - 1], raw(Math.min(tEnd, i * stepMin)))
    tab[i] = (((tab[i - 1] + Math.max(-maxStep, Math.min(maxStep, d))) % 360) + 360) % 360
  }
  return (t) => {
    const x = Math.min(n, Math.max(0, t / stepMin))
    const i = Math.floor(x)
    if (i >= n) return tab[n]
    const f = x - i
    return (((tab[i] + angleDiff(tab[i], tab[i + 1]) * f) % 360) + 360) % 360
  }
}

/**
 * Centred box smoothing of f over EVA time: g(t) = mean of f over [t - w/2, t + w/2] (f clamped to
 * [0, tEnd] outside the walk), on a table of `stepMin` with linear interpolation in between. A pure
 * function of t, so a capture frame and a scrub land on the same picture. w <= stepMin: no smoothing.
 */
export function boxSmooth(f: (t: number) => number, tEnd: number, stepMin: number, w: number): (t: number) => number {
  const h = Math.max(0, Math.round(w / 2 / stepMin))
  if (h === 0) return f
  const n = Math.max(1, Math.ceil(tEnd / stepMin))
  // samples i = -h .. n + h at t = i * step (clamped), prefix sums for the window means
  const m = n + 2 * h + 1
  const pre = new Float64Array(m + 1)
  for (let k = 0; k < m; k++) pre[k + 1] = pre[k] + f(Math.min(tEnd, Math.max(0, (k - h) * stepMin)))
  const tab = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) tab[i] = (pre[i + 2 * h + 1] - pre[i]) / (2 * h + 1)
  return (t) => {
    const x = Math.min(n, Math.max(0, t / stepMin))
    const i = Math.floor(x)
    if (i >= n) return tab[n]
    return tab[i] + (tab[i + 1] - tab[i]) * (x - i)
  }
}

export function flightPath(plan: Plan, metric: Metric, scenario: string): FlightPath {
  const path = new SmoothPath(routeLine(plan), metric, FLYTHROUGH.sampleM)
  const cfg = { behindM: FLYTHROUGH.behindM, aboveM: FLYTHROUGH.aboveM, lookaheadM: FLYTHROUGH.lookaheadM, maxPitchDeg: CHASE.maxPitchDeg }
  // run the tables on past the walk's end until any turn has finished (at most 180 deg)
  const tTab = plan.tEnd + 180 / FOLLOW_TURN_DEG_PER_MIN
  const anchorAt = boxSmooth((t) => plan.stateAt(t).distanceWalkedM, tTab, FOLLOW_TABLE_STEP_MIN, CHASE.smoothMin)
  const raw = (t: number): CameraPose => chasePose(path, anchorAt(t), cfg)
  const bearing = bearingTable((t) => raw(t).bearing, tTab, FOLLOW_TABLE_STEP_MIN, FOLLOW_TURN_DEG_PER_MIN)
  return {
    scenario,
    plan,
    path,
    poseAt: (t) => ({ ...raw(t), bearing: bearing(t) }),
    crewAt: (t) => {
      const st = plan.stateAt(t)
      return [st.lon, st.lat]
    },
    anchorAt,
  }
}

/**
 * The plan scenario's flight path; null when it has no route or timeline (only published ones do).
 * PORT I2: `mine` = the user's route (userRoute.ts userFlight) flown instead of the official one.
 */
export async function loadFlightPath(mine?: UserFlight | null): Promise<FlightPath | null> {
  const L = data()
  if (mine) {
    const fix = await L.optional(() => L.fieldsIndex())
    if (!fix) return null
    const metric = gridMetric(fix as unknown as { bounds: number[]; width: number; height: number; res_m: number })
    return flightPath(new Plan(mine.route, mine.timeline, metric), metric, 'mine')
  }
  const idx = await L.scenarios()
  const sc = resolvePlanScenario(idx)
  const [route, timeline, fix] = await Promise.all([L.optional(() => L.route(sc.id)), L.optional(() => L.timeline(sc.id)), L.optional(() => L.fieldsIndex())])
  if (!route || !timeline || !fix || !route.features.length) return null
  const metric = gridMetric(fix as unknown as { bounds: number[]; width: number; height: number; res_m: number })
  const plan = new Plan(route as never, timeline as unknown as TimelineEvent[], metric)
  return flightPath(plan, metric, sc.id)
}
