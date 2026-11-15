// I1a (instant browser path, D127): the ordered route computed in the browser, pure and synchronous once
// loadBrowserRouteData has resolved. Every number is an ESTIMATE on the 5 m field grid (8 m heights);
// the live job's run record is the validated answer.
//
//   legs      pad -> stops[0] -> ... -> stops[n-1] with WP6's A* router and leg cache (map/router.ts,
//             map/legs.ts): stations at their access point (stations.json, this scenario), free points
//             at their own cell; a point off the walkable grid snaps to the nearest walkable cell within
//             the D27 access radius (map/grid.ts accessCell, as validity / the ghost route do)
//   way home  last stop -> pad along WS2's POINTER field (hud/wayhome, the fastest way home), timed by
//             T_home / O2_home of the fields (ported margin.ts buildTrack)
//   dwell     stations.json dwell_min per station; free points config/stations.yaml dwell_min (WP2b)
//   clock     EVA minutes from 09:00 LMST (clock.json, D31)
//   margin    the engine's four terms O2, daylight, dose (D39 storm replay), EVA duration with the D28
//             tie order, along the track (ported margin.ts marginProfile): the tightest point
//   feasible  the engine's ordered-route rule (pipeline/engine/traverse.py _route_order, then
//             _route_dose_check): leg i departs at t = walk + dwell so far and fails when t is later
//             than its latest departure (O2 used bounded by the effort-cap rate x t, as the DP);
//             the FIRST failing leg is the answer, never reordered (contract run_record.feasibility).
//             I1c: every leg row carries this check's own number (checkMin = latest departure - departure,
//             checkBinding, checkOk) and feasibility is read off the rows, so the headline and the row of
//             the failing leg show the same minutes. The check charges the O2 used before a leg at the
//             effort cap (1.35 L/min x elapsed time, dwell included), as the engine's DP; marginMin is the
//             walked margin (dwell at the station task rate), so a leg can fail the check while its walked
//             margin is still >= 0 (pads/index.json counts these as excluded_by_effort_cap_rule).
import { CONFIG } from '../../../config'
import { CUSTOM_START_LABEL } from './start'
import { distanceM, isStationStop, stopNames, type RouteStop } from '../model'
import { accessCell, cellOf, lonLatOfCell } from '../map/grid'
import { legPairs, routeLegs } from '../map/legs'
import { CROSSINGS, type Leg } from '../map/router'
import { ACCESS_RADIUS_M } from '../map/validity'
import { BUDGET_CONSTANTS, missionBudget, type MissionBudget } from './budget'
import { ANALYSIS_PROJ, DEFAULT_DWELL_MIN, MARGIN_AMBER_MIN, type BrowserPad, type BrowserRouteData } from './data'
import { buildMission, finalizeMission, ORIGIN_LABEL, type LonLat, type MissionExportInput, type Waypoint } from './export'
import { buildTrack, legProfile, missionMargin, type MarginPoint, type MarginProfile, type Term, type TrackSample } from './margin'

/** Same shape as the contract's run_record.feasibility (live/types.ts Feasibility; src/live is not imported here). */
export type BrowserFeasibility =
  | { feasible: true }
  | { feasible: false; leg: number; from: string; to: string; limit: Term; shortfall_min: number; legs_planned: number }

/** Why the route could not be computed at all (no feasibility then). index = stop index, -1 = the pad. */
export interface BrowserStopIssue {
  index: number
  code: 'route_station_unknown' | 'route_point_outside_grid' | 'route_point_not_walkable' | 'route_point_unreachable'
}

export interface BrowserLegRow {
  /** contract numbering: 0 = pad -> stops[0], n = last stop -> pad (the way home) */
  leg: number
  kind: 'out' | 'home'
  from: string
  to: string
  /** out: the router found a path; home: the pointer path reaches the pad */
  routed: boolean
  /** dwell at `from` before this leg departs (min; 0 for leg 0) */
  dwellBeforeMin: number
  departMin: number | null
  walkMin: number | null
  arriveMin: number | null
  distM: number | null
  o2L: number | null
  /** lowest margin on this leg (dwell before it included) and its binding term; null = unknown */
  marginMin: number | null
  binding: Term | null
  /**
   * I1c: the ordered-route check of this leg (the engine's rule, see the header): latest departure minus
   * the departure (min; negative = the leg fails by that much), the term that binds it, and whether the
   * leg passes. The headline (feasibility) is the first row with checkOk false. null = unknown.
   */
  checkMin: number | null
  checkBinding: Term | null
  checkOk: boolean | null
  /** the walked line (lon/lat): router cells, or the pointer path home; straight when unrouted */
  coords: LonLat[]
}

export interface BrowserTotals {
  /** out legs + way home */
  walkMin: number | null
  outWalkMin: number | null
  homeWalkMin: number | null
  dwellMin: number
  evaMin: number | null
  /** O2 used over the whole EVA (back at the pad) */
  o2UsedL: number | null
  /** O2 left back at the pad */
  o2LeftL: number | null
  o2CapacityL: number
  reserveL: number
}

export interface BrowserRouteResult {
  estimate: true
  scenario: string
  pad: { lon: number; lat: number }
  stops: readonly RouteStop[]
  /** stop names as the run record writes them (station id, W1..Wn among free points) */
  names: string[]
  dwellMin: number[]
  legs: BrowserLegRow[]
  totals: BrowserTotals
  /** lowest margin along the track and its binding term (D28 tie order); null = unknown */
  tightest: { marginMin: number; binding: Term; tMin: number } | null
  /** null when the route cannot be computed (issues says why) */
  feasibility: BrowserFeasibility | null
  issues: BrowserStopIssue[]
  /** 'fields_pad_mismatch': the pad is not the fields' pad, so T_home / O2_home lead to that pad */
  warnings: string[]
  /** inputs of the mission.json export and the panel's charts */
  detail: {
    padCell: number | null
    cells: (number | null)[]
    routerLegs: (Leg | null)[]
    track: TrackSample[] | null
    budget: MissionBudget
    margin: MarginProfile | null
    homePath: LonLat[] | null
    homeReachesPad: boolean
    positions: ({ lon: number; lat: number } | null)[]
  }
}

const EVA = 'EVA duration' as const

function fieldAtCell(d: BrowserRouteData, f: BrowserRouteData['tHome'] | null, cell: number): number | null {
  if (!f) return null
  if (f.width === d.tHome.width && f.height === d.tHome.height) {
    const r = Math.floor(cell / f.width)
    return f.valueAtPixel(r, cell - r * f.width)
  }
  const [lon, lat] = lonLatOfCell(d.tHome, cell)
  return f.valueAt(lon, lat)
}

/** WS2 T_home / O2_home at a routing cell. */
export function homeAtCell(d: BrowserRouteData, cell: number): { tHomeMin: number | null; o2HomeL: number | null } {
  return { tHomeMin: fieldAtCell(d, d.tHome, cell), o2HomeL: fieldAtCell(d, d.o2Home, cell) }
}

// graph.OFFSETS (as map/router.ts): 8 neighbours + 8 knight moves, (drow, dcol), rows grow southwards
const OFFSETS: [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
  [-2, -1], [-2, 1], [2, -1], [2, 1],
  [-1, -2], [-1, 2], [1, -2], [1, 2],
] // prettier-ignore

/**
 * Cells the router can reach from `start` with its own move rules (passable ends and crossings, finite
 * pace at the grade between the two cells; the grade limit is symmetric, so reachability is too).
 * The browser grid (5 m cells, 8 m heights) has small pockets the engine's 3 m graph does not; a stop
 * is routed from the nearest cell of the pad's component within the access radius. Cached per pad cell.
 */
export function reachableFrom(d: BrowserRouteData, start: number): Uint8Array {
  const hit = d.components.get(start)
  if (hit) return hit
  const { width: W, height: H, passable, elev, resM } = d.grid
  const seen = new Uint8Array(W * H)
  const len = OFFSETS.map(([a, b]) => Math.hypot(a, b) * resM)
  const stack = new Int32Array(W * H)
  let top = 0
  if (passable[start]) {
    seen[start] = 1
    stack[top++] = start
  }
  while (top > 0) {
    const i = stack[--top]
    const r = Math.floor(i / W)
    const c = i - r * W
    for (let k = 0; k < 16; k++) {
      const r2 = r + OFFSETS[k][0]
      const c2 = c + OFFSETS[k][1]
      if (r2 < 0 || c2 < 0 || r2 >= H || c2 >= W) continue
      const j = r2 * W + c2
      if (seen[j] || !passable[j]) continue
      let ok = true
      for (const [xi, xj] of CROSSINGS[k]) if (!passable[(r + xi) * W + (c + xj)]) ok = false
      if (!ok || d.model.lookup(Math.atan((elev[j] - elev[i]) / len[k])).pace === Infinity) continue
      seen[j] = 1
      stack[top++] = j
    }
  }
  d.components.set(start, seen)
  return seen
}

/** Nearest cell of `comp` within radiusM of `cell` (own cell first), or null. */
function nearestIn(d: BrowserRouteData, comp: Uint8Array, cell: number, radiusM: number): number | null {
  if (comp[cell]) return cell
  const { width: W, height: H, resM } = d.grid
  const R = Math.floor(radiusM / resM)
  const r0 = Math.floor(cell / W)
  const c0 = cell - r0 * W
  let best: number | null = null
  let bestD = Infinity
  for (let dr = -R; dr <= R; dr++) {
    const r = r0 + dr
    if (r < 0 || r >= H) continue
    for (let dc = -R; dc <= R; dc++) {
      const c = c0 + dc
      if (c < 0 || c >= W) continue
      const q = dr * dr + dc * dc
      if (q > R * R || q >= bestD) continue
      if (comp[r * W + c]) {
        best = r * W + c
        bestD = q
      }
    }
  }
  return best
}

function snapCell(d: BrowserRouteData, lon: number, lat: number, comp: Uint8Array | null): { cell: number | null; code: BrowserStopIssue['code'] | null } {
  const own = cellOf(d.tHome, lon, lat)
  if (own === null) return { cell: null, code: 'route_point_outside_grid' }
  const c = accessCell(d.grid, own, ACCESS_RADIUS_M)
  if (c === null) return { cell: null, code: 'route_point_not_walkable' }
  if (!comp) return { cell: c, code: null }
  const inComp = nearestIn(d, comp, own, ACCESS_RADIUS_M)
  return inComp === null ? { cell: null, code: 'route_point_unreachable' } : { cell: inComp, code: null }
}

/** One leg's vertices for the latest-departure check (physio_core.latest_departure_terms inputs). */
interface LegVerts {
  tau: ArrayLike<number>
  o2: ArrayLike<number>
  tHome: ArrayLike<number>
  o2Home: ArrayLike<number>
  /** walk time of the leg (min) */
  t: number
}

/** physio_core.latest_departure_terms with t0 = 0, u0 = 0, rate = the effort cap, static terms only. */
function latestDeparture(v: LegVerts, tDarkMin: number | null): Partial<Record<Term, number>> {
  const C = BUDGET_CONSTANTS
  const n = v.tau.length
  for (let k = 0; k < n; k++) if (!Number.isFinite(v.tHome[k]) || !Number.isFinite(v.o2Home[k])) return { O2: -Infinity }
  let slack = Infinity
  let day = Infinity
  let eva = Infinity
  for (let k = 0; k < n; k++) {
    slack = Math.min(slack, C.o2CapacityL - v.o2[k] - v.o2Home[k] - C.reserveL)
    day = Math.min(day, (tDarkMin ?? Infinity) - v.tau[k] - v.tHome[k])
    eva = Math.min(eva, C.evaLimitMin - v.tau[k] - v.tHome[k])
  }
  const out: Partial<Record<Term, number>> = { O2: slack / C.effortRateLMin }
  if (tDarkMin !== null) out.daylight = day
  out[EVA] = eva
  return out
}

const round2 = (x: number) => Math.round(x * 100) / 100

/** I1c: one leg's ordered-route check (latest departure - departure, its binding term, pass/fail). */
interface LegCheck {
  min: number
  binding: Term
  ok: boolean
}

function rowCheck(c: LegCheck | undefined): Pick<BrowserLegRow, 'checkMin' | 'checkBinding' | 'checkOk'> {
  return c ? { checkMin: c.min, checkBinding: c.binding, checkOk: c.ok } : { checkMin: null, checkBinding: null, checkOk: null }
}

/**
 * The browser estimate of an ordered route: legs, totals, tightest margin and feasibility.
 * Pure and synchronous; the leg cache in `d.legCache` is reused and updated (moving one stop re-routes
 * only its two legs).
 */
export function computeBrowserRoute(d: BrowserRouteData, padLonLat: LonLat | { lon: number; lat: number }, stops: readonly RouteStop[]): BrowserRouteResult {
  const pad = Array.isArray(padLonLat) ? { lon: padLonLat[0], lat: padLonLat[1] } : { lon: (padLonLat as { lon: number }).lon, lat: (padLonLat as { lat: number }).lat }
  const names = stopNames({ mode: 'ordered', stops })
  const n = stops.length
  const issues: BrowserStopIssue[] = []
  const warnings: string[] = []
  if (distanceM(pad, d.fieldsPad) > 1.5 * d.tHome.resM) warnings.push('fields_pad_mismatch')

  // positions, dwell and cells
  const positions = stops.map((s) => {
    if (!isStationStop(s)) return { lon: s.lon, lat: s.lat }
    const st = d.stations.find((x) => x.id === s.station)
    return st ? { lon: st.lon, lat: st.lat } : null
  })
  const dwellMin = stops.map((s) => (isStationStop(s) ? (d.stations.find((x) => x.id === s.station)?.dwellMin ?? DEFAULT_DWELL_MIN) : DEFAULT_DWELL_MIN))
  const padSnap = snapCell(d, pad.lon, pad.lat, null)
  if (padSnap.code) issues.push({ index: -1, code: padSnap.code })
  const comp = padSnap.cell === null ? null : reachableFrom(d, padSnap.cell)
  const cells = positions.map((p, i) => {
    if (!p) {
      issues.push({ index: i, code: 'route_station_unknown' })
      return null
    }
    const s = snapCell(d, p.lon, p.lat, comp)
    if (s.code) issues.push({ index: i, code: s.code })
    return s.cell
  })

  // out legs through the leg cache (-1 = no cell: cached as a pair, never routed)
  const padCell = padSnap.cell
  const pairs = legPairs(padCell ?? -1, cells.map((c) => ({ cell: c ?? -1 })))
  const routerLegs = n ? routeLegs(pairs, (a, b) => (a < 0 || b < 0 ? null : d.router.route(a, b)), d.legCache) : []
  routerLegs.forEach((l, i) => {
    if (!l && cells[i] !== null && (i === 0 ? padCell !== null : cells[i - 1] !== null)) issues.push({ index: i, code: 'route_point_unreachable' })
  })

  // the way home from the last stop: T_home / O2_home there, the pointer path for the line
  const lastCell = n ? cells[n - 1] : padCell
  const home = lastCell === null ? { tHomeMin: null, o2HomeL: null } : n ? homeAtCell(d, lastCell) : { tHomeMin: 0, o2HomeL: 0 }
  if (n && lastCell !== null && (home.tHomeMin === null || home.o2HomeL === null)) issues.push({ index: n - 1, code: 'route_point_unreachable' })
  let homePath: LonLat[] | null = null
  let homeReachesPad = false
  if (n && lastCell !== null && d.pointer) {
    const from = lonLatOfCell(d.tHome, lastCell)
    const w = d.pointer.pathFrom(from[0], from[1], [d.fieldsPad.lon, d.fieldsPad.lat])
    if (w && w.startKnown) {
      homePath = w.coords
      homeReachesPad = w.reachesPad
    }
  }

  const profiles = routerLegs.map((l) => (l ? legProfile(l, (c) => homeAtCell(d, c)) : null))
  const track = n ? buildTrack(profiles, dwellMin) : null
  const budget = missionBudget(routerLegs.map((l) => (l ? { timeMin: l.timeS / 60, o2L: l.o2L } : null)), home, dwellMin)
  const margin = track ? missionMargin(track, { tDarkMin: d.tDarkMin, rad: d.rad, storm: d.storm }) : null

  // per-leg times (dwell before a leg belongs to it, as the engine)
  const known = n > 0 && issues.length === 0 && track !== null && home.tHomeMin !== null
  const legTimes: { dwell: number; walk: number | null }[] = []
  for (let i = 0; i <= n && n; i++) {
    const dwell = i === 0 ? 0 : dwellMin[i - 1]
    const walk = i < n ? (routerLegs[i] ? routerLegs[i]!.timeS / 60 : null) : home.tHomeMin
    legTimes.push({ dwell, walk })
  }

  // feasibility: traverse._route_order, then the timed dose check on the walked track
  let feasibility: BrowserFeasibility | null = null
  const checks: LegCheck[] = []
  if (known) {
    const ids = ['pad', ...names]
    const fail = (i: number, limit: Term, short: number): BrowserFeasibility => ({
      feasible: false,
      leg: i,
      from: ids[i],
      to: i < n ? ids[i + 1] : 'pad',
      limit,
      shortfall_min: round2(Math.max(0, Number.isFinite(short) ? short : 0)),
      legs_planned: i,
    })
    const budgetMin = BUDGET_CONSTANTS.evaLimitMin
    let t = 0
    let firstFail: number | null = null
    for (let i = 0; i <= n; i++) {
      let v: LegVerts
      if (i < n) {
        const p = profiles[i]!
        v = { tau: p.tMin, o2: p.o2L, tHome: p.tHomeMin, o2Home: p.o2HomeL, t: routerLegs[i]!.timeS / 60 }
      } else {
        // WS2's fastest way home: T_home falls 1 min per minute, so every vertex gives the start's terms
        v = { tau: [0], o2: [0], tHome: [home.tHomeMin!], o2Home: [home.o2HomeL!], t: home.tHomeMin! }
      }
      const terms = latestDeparture(v, d.tDarkMin)
      let bind: Term = 'O2'
      for (const k of ['O2', 'daylight', EVA] as Term[]) if (terms[k] !== undefined && terms[k]! < terms[bind]!) bind = k
      // the engine's order of the three conditions (_route_order); a passing leg shows its least slack
      let c: LegCheck
      if (!(t <= terms[bind]!)) c = { min: Number.isFinite(terms[bind]!) ? terms[bind]! - t : -Infinity, binding: bind, ok: false }
      else if (i && t > budgetMin) c = { min: budgetMin - t, binding: EVA, ok: false }
      else if (i === n && t + v.t > budgetMin + 1e-9) c = { min: budgetMin - t - v.t, binding: EVA, ok: false }
      else {
        c = { min: terms[bind]! - t, binding: bind, ok: true }
        const evaSlack = i === n ? budgetMin - t - v.t : i ? budgetMin - t : Infinity
        if (evaSlack < c.min) c = { min: evaSlack, binding: EVA, ok: true }
      }
      checks.push(c)
      if (!c.ok && firstFail === null) firstFail = i
      t = t + v.t + (i < n ? dwellMin[i] : 0)
    }
    if (firstFail === null && margin?.dose) {
      const pts = margin.points
      const bad = pts.findIndex((p) => p.terms.dose !== undefined && p.terms.dose < 0)
      if (bad >= 0) {
        const tf = pts[bad].tMin
        let lo = 0
        for (let i = 0; i <= n; i++) {
          const hi = lo + legTimes[i].dwell + (legTimes[i].walk ?? 0)
          if (tf <= hi + 1e-9 || i === n) {
            const on = pts.filter((p) => (i ? p.tMin > lo - 1e-9 : true) && p.tMin <= hi + 1e-9 && p.terms.dose !== undefined)
            const short = on.length ? -Math.min(...on.map((p) => p.terms.dose!)) : -pts[bad].terms.dose!
            checks[i] = { min: -Math.max(0, short), binding: 'dose', ok: false }
            firstFail = i
            break
          }
          lo = hi
        }
      }
    }
    // one source of truth: the headline is the first row whose check fails, with that row's number
    feasibility = firstFail === null ? { feasible: true } : fail(firstFail, checks[firstFail].binding, -checks[firstFail].min)
  }

  // leg rows, with the lowest margin on each leg
  const legs: BrowserLegRow[] = []
  let t: number | null = 0
  let lo = 0
  const ptsOn = (a: number, b: number, first: boolean): MarginPoint[] => (margin ? margin.points.filter((p) => (first ? true : p.tMin > a + 1e-9) && p.tMin <= b + 1e-9) : [])
  for (let i = 0; i <= n && n; i++) {
    const { dwell, walk } = legTimes[i]
    const depart: number | null = t === null ? null : t + dwell
    const arrive: number | null = depart === null || walk === null ? null : depart + walk
    const from = i === 0 ? 'pad' : names[i - 1]
    const to = i < n ? names[i] : 'pad'
    const a = i === 0 ? pad : positions[i - 1]
    const b = i < n ? positions[i] : pad
    const straight: LonLat[] = a && b ? [[a.lon, a.lat], [b.lon, b.lat]] : []
    let row: BrowserLegRow
    if (i < n) {
      const l = routerLegs[i]
      row = {
        leg: i, kind: 'out', from, to, routed: !!l, dwellBeforeMin: dwell, departMin: depart, walkMin: walk, arriveMin: arrive,
        distM: l ? l.distM : null, o2L: l ? l.o2L : null, marginMin: null, binding: null, ...rowCheck(checks[i]),
        coords: l && l.cells.length > 1 ? l.cells.map((c) => lonLatOfCell(d.tHome, c)) : straight,
      } // prettier-ignore
    } else {
      row = {
        leg: i, kind: 'home', from, to, routed: homeReachesPad, dwellBeforeMin: dwell, departMin: depart, walkMin: walk, arriveMin: arrive,
        distM: homePath ? homePath.reduce((s, p, k) => (k ? s + d.tHome.distanceM(homePath![k - 1], p) : 0), 0) : null,
        o2L: home.o2HomeL, marginMin: null, binding: null, ...rowCheck(checks[i]), coords: homePath ?? straight,
      } // prettier-ignore
    }
    if (margin && arrive !== null) {
      const on = ptsOn(lo, arrive, i === 0)
      if (on.length) {
        let best = on[0]
        for (const p of on) if (p.marginMin < best.marginMin) best = p
        row.marginMin = best.marginMin
        row.binding = best.binding
      }
      lo = arrive
    }
    legs.push(row)
    t = arrive
  }

  const C = BUDGET_CONSTANTS
  const homeWalk = n ? home.tHomeMin : 0
  const outWalk = budget.walkMin
  const o2Used = budget.o2UsedL === null || home.o2HomeL === null ? null : budget.o2UsedL + (n ? home.o2HomeL : 0)
  const totals: BrowserTotals = {
    walkMin: outWalk === null || homeWalk === null ? null : outWalk + homeWalk,
    outWalkMin: outWalk,
    homeWalkMin: homeWalk,
    dwellMin: budget.stopMin,
    evaMin: budget.evaMin,
    o2UsedL: o2Used,
    o2LeftL: o2Used === null ? null : C.o2CapacityL - o2Used,
    o2CapacityL: C.o2CapacityL,
    reserveL: C.reserveL,
  }

  return {
    estimate: true,
    scenario: d.scenario,
    pad,
    stops,
    names,
    dwellMin,
    legs,
    totals,
    tightest: margin ? { marginMin: margin.lowest.marginMin, binding: margin.lowest.binding, tMin: margin.lowest.tMin } : null,
    feasibility,
    issues,
    warnings,
    detail: { padCell, cells, routerLegs, track, budget, margin, homePath, homeReachesPad, positions },
  }
}

// ---- mission.json -------------------------------------------------------------------------------

export interface BrowserMissionContext {
  data: BrowserRouteData
  /** the pad block of the frame; default: the fields' pad when the route starts there, else a picker pad */
  pad?: Partial<BrowserPad>
  title?: string
  appCommit?: string | null
  configHash?: string | null
  /** default: true when the data tree is the dummy one */
  dummy?: boolean
  now?: Date
}

const VARIANTS: Record<string, string> = { opt: 'optimistic', nom: 'nominal', con: 'conservative' }

/** The export input (ported export.ts) for a computed route. Pure. */
export function browserMissionInput(r: BrowserRouteResult, ctx: BrowserMissionContext): MissionExportInput {
  const d = ctx.data
  const [vk, suit] = d.scenario.split('_')
  const atFieldsPad = !r.warnings.includes('fields_pad_mismatch')
  const elevAtCell = (c: number | null) => (c !== null && Number.isFinite(d.grid.elev[c]) ? d.grid.elev[c] : null)
  const pad: BrowserPad = {
    ...(atFieldsPad ? d.fieldsPad : { id: null, elevM: elevAtCell(r.detail.padCell), kind: 'picker' as const, source: 'Edit route start (browser estimate)' }),
    ...ctx.pad,
    lon: r.pad.lon,
    lat: r.pad.lat,
  } as BrowserPad
  const wps: Waypoint[] = r.stops.map((s, i) => {
    const p = r.detail.positions[i] ?? { lon: NaN, lat: NaN }
    const station = isStationStop(s) ? d.stations.find((x) => x.id === s.station) : undefined
    // note = what the map shows: "S4 · name" for a station, the label (else W{n}) for a free point
    const label = isStationStop(s) ? (station ? `${s.station} · ${station.name}` : s.station) : s.label ? `${r.names[i]} · ${s.label}` : r.names[i]
    return { id: i + 1, lon: p.lon, lat: p.lat, cell: r.detail.cells[i] ?? -1, note: label, tags: [r.names[i]], stopMin: r.dwellMin[i] }
  })
  return {
    title: ctx.title,
    proj: ANALYSIS_PROJ,
    pad,
    scenario: { id: d.scenario, variant: VARIANTS[vk] ?? 'nominal', suit_kg: Number(suit) },
    planner: { gridResM: d.tHome.resM, elevationResM: d.elevationResM, files: d.files, appCommit: ctx.appCommit ?? null, configHash: ctx.configHash ?? null },
    constants: { ...BUDGET_CONSTANTS, marginAmberMin: MARGIN_AMBER_MIN },
    conditions: { evaStartLmst: d.evaStartLmst, tDarkMin: d.tDarkMin, storm: d.storm, evaStartUtc: d.evaStartUtc, mslSol: d.mslSol, rad: d.rad },
    wps,
    legs: r.detail.routerLegs,
    homePath: r.detail.homePath,
    homeReachesPad: r.detail.homeReachesPad,
    budget: r.detail.budget,
    margin: r.detail.margin,
    cellLonLat: (c) => lonLatOfCell(d.tHome, c),
    elevAt: (lon, lat) => elevAtCell(cellOf(d.tHome, lon, lat)),
    homeAt: (lon, lat) => ({ tHomeMin: d.tHome.valueAt(lon, lat), o2HomeL: d.o2Home?.valueAt(lon, lat) ?? null }),
    label: CONFIG.simulatedLabel,
    dummy: ctx.dummy ?? false,
  }
}

/** mission.json (contracts/bundle/mission.schema.json 1.1.0, origin mission_planer) without id / time. Sync. */
export function buildBrowserMissionDraft(r: BrowserRouteResult, ctx: BrowserMissionContext): Record<string, unknown> {
  const doc = buildMission(browserMissionInput(r, ctx))
  // I3: a moved EVA start says so wherever the estimate goes
  return { ...doc, origin: 'mission_planer', origin_label: ctx.data.customStart ? `${ORIGIN_LABEL} · ${CUSTOM_START_LABEL}` : ORIGIN_LABEL }
}

/** mission.json, finalized: mission_id (sha256 of the plan) and created_utc filled. */
export function buildBrowserMission(r: BrowserRouteResult, ctx: BrowserMissionContext): Promise<Record<string, unknown>> {
  return finalizeMission(buildBrowserMissionDraft(r, ctx), ctx.now)
}
