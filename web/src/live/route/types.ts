// Typed client-side copy of the DRAFT backend contract v1.2.0 for the route (D97; waypoint block
// §4.2). R0 (contracts/backend v1.2.0 + mocks) is not merged yet: everything route-specific the
// client reads or writes is declared HERE and nowhere else, so aligning with R0 is one file. Shapes
// follow the R0 working draft (plan_inputs.route, run_record.route_mode / feasibility, Error.stop).
// When R0 lands: move these into ../types.ts, add the key maps to contract.test.ts, and replace
// ROUTE_LIMITS_DRAFT by config/backend.yaml route.* (edit/route/model.ts already reads it first).
import type { PlanRoute as EditPlanRoute, RouteStop as EditRouteStop } from '../../edit/route/model'
import type { ApiErrorBody, RunRecord } from '../types'

export const ROUTE_CONTRACT_DRAFT = '1.2.0'

export const ROUTE_MODES = ['auto', 'ordered'] as const
export type RouteMode = (typeof ROUTE_MODES)[number]

/** plan_inputs.route.stops[i]: a station of stations.json */
export interface StationStop {
  station: string
}
/** plan_inputs.route.stops[i]: a free point (R6); label is free text, dropped before hashing (D57) */
export interface PointStop {
  lon: number
  lat: number
  label?: string
}
export type RouteStop = StationStop | PointStop

/** plan_inputs.route (v1.2.0, additive). Missing = auto; ordered needs at least one stop; auto has none. */
export interface PlanRoute {
  mode: RouteMode
  stops?: RouteStop[]
}

/** config/backend.yaml route.* (assumed, D97 item 6) until R0 adds them. */
export const ROUTE_LIMITS_DRAFT = { max_stops: 8, max_free_points: 4, min_stop_spacing_m: 50 } as const

/** run_record.feasibility.limit: O₂ at the effort-cap rule (D45), daylight, dose, EVA duration (D28). */
export const FEASIBILITY_LIMITS = ['O2', 'daylight', 'dose', 'EVA duration'] as const
export type FeasibilityLimit = (typeof FEASIBILITY_LIMITS)[number]

/** run_record.feasibility (v1.2.0). leg 0 = pad -> stops[0]; leg len(stops) = last stop -> pad. */
export type Feasibility =
  | { feasible: true }
  | {
      feasible: false
      leg: number
      /** 'pad', a station id, or W1, W2, … (free points in their order) */
      from: string
      to: string
      limit: FeasibilityLimit
      /** minutes short on that limit (positive) */
      shortfall_min: number
      /** legs before the failing one whose files are in the tree */
      legs_planned?: number
    }

/** run_record.json v1.2.0: v1.1 plus route_mode and feasibility (absent in older records). */
export interface RouteRunRecord extends RunRecord {
  route_mode?: RouteMode
  feasibility?: Feasibility
}

/** Error body v1.2.0: a 422 on a route names the stop (index into inputs.route.stops; null = whole route). */
export interface RouteErrorBody extends ApiErrorBody {
  stop?: number | null
}

/** 422 codes of a route (openapi v1.2.0 draft, Error.stop description). */
export const ROUTE_ERROR_CODES = [
  'route_too_many_stops',
  'route_too_many_free_points',
  'route_stop_spacing',
  'route_station_unknown',
  'route_station_duplicate',
  'route_point_outside_grid',
  'route_point_unassessed',
  'route_point_not_walkable',
  'route_point_unreachable',
  'route_label_too_long',
  'route_mode_conflict',
] as const
export type RouteErrorCode = (typeof ROUTE_ERROR_CODES)[number]

// Compile-time alignment: the edit model's route (what the panel builds) fits the draft contract.
type Assert<T extends true> = T
export type _StopFits = Assert<EditRouteStop extends RouteStop ? true : false>
export type _ModeFits = Assert<EditPlanRoute['mode'] extends RouteMode ? true : false>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const STOP_NAME = /^(pad|S[0-9]+|W[0-9]+)$/

/**
 * The route answer of a run record: v1.2.0 feasibility, else the v1.1 `infeasible` block (binding,
 * negative margin), else null (no answer recorded). A malformed block is an error, never guessed.
 */
export function readFeasibility(rec: unknown): { value: Feasibility | null; error: string | null } {
  if (!isObj(rec)) return { value: null, error: 'run record is not an object' }
  const f = rec.feasibility
  if (f !== undefined) {
    if (!isObj(f) || typeof f.feasible !== 'boolean') return { value: null, error: 'run_record.feasibility is malformed' }
    if (f.feasible) return { value: { feasible: true }, error: null }
    const ok =
      Number.isInteger(f.leg) &&
      (f.leg as number) >= 0 &&
      typeof f.from === 'string' &&
      STOP_NAME.test(f.from) &&
      typeof f.to === 'string' &&
      STOP_NAME.test(f.to) &&
      (FEASIBILITY_LIMITS as readonly unknown[]).includes(f.limit) &&
      typeof f.shortfall_min === 'number' &&
      f.shortfall_min >= 0
    if (!ok) return { value: null, error: 'run_record.feasibility (infeasible) is malformed' }
    return { value: f as Feasibility, error: null }
  }
  const inf = rec.infeasible
  if (isObj(inf) && Number.isInteger(inf.leg) && typeof inf.from === 'string' && typeof inf.to === 'string') {
    const limit = (FEASIBILITY_LIMITS as readonly unknown[]).includes(inf.binding) ? (inf.binding as FeasibilityLimit) : null
    if (!limit) return { value: null, error: `run_record.infeasible.binding ${String(inf.binding)} is not a route limit` }
    const m = typeof inf.margin_min === 'number' ? Math.abs(inf.margin_min) : NaN
    return { value: { feasible: false, leg: inf.leg as number, from: inf.from, to: inf.to, limit, shortfall_min: m }, error: null }
  }
  // no route answer recorded (a v1.1 record of a feasible plan has infeasible: null)
  return { value: null, error: null }
}

/** The stop a 422 names: Error.stop (v1.2.0), else "stops[i]" in the detail text. */
export function errorStop(body: { stop?: unknown; detail?: unknown } | null | undefined): number | null {
  if (!body) return null
  if (Number.isInteger(body.stop) && (body.stop as number) >= 0) return body.stop as number
  const d = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? '')
  const m = /stops\[(\d+)\]/.exec(d)
  return m ? Number(m[1]) : null
}
