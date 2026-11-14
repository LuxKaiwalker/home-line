// One HUD frame: every number the panel shows, from the position object (F19), field lookups
// and the plan. Lookups and arithmetic on looked-up values only (brief WS7 "Don't").
//
// Definitions (assumption A-WS7-3, see STATUS.md):
//   headroom H(t)  = timeline margin_min + t_home_min, interpolated in t (WS2's margin terms)
//   margin         = H(t) - T_home at the position (worst case within sigma)
//   turn-back in   = margin (standing still, H falls one minute per minute); its binding term is
//                    the timeline row's margin_binding, incl. "EVA duration" (D28, contract v1.1.3)
import { evaluateAlarm, marginBand, type Alarm } from './alarms'
import { vSafeAt, type HudConfig } from './config'
import type { FieldGrid } from './fields'
import type { Plan } from './plan'
import type { Binding, HudPosition, LonLat, PolygonFC } from './types'

export interface HudFields {
  tHome: FieldGrid // nominal T_home of the active scenario
  tHomeCons?: FieldGrid // conservative variant, same suit mass
  o2Home?: FieldGrid
  homeBearing?: FieldGrid
  slope?: FieldGrid
  /** worst-case fields by radius (m), nominal 104 kg only (F19) */
  worst?: Map<number, { tHome?: FieldGrid; o2Home?: FieldGrid }>
}

export interface HudContext {
  cfg: HudConfig
  fields: HudFields
  plan: Plan
  budgetMin: number // homeline budget for the circle test (crew.yaml walkback_budgets_min)
  pad: LonLat
  partner?: PolygonFC | null
  /** storm switch: tripwire state on the EVA clock and tau_dose; absent = never fires */
  radiation?: { tripwireFired: boolean; tauDoseMin: number | null }
}

export interface Readout {
  t: number
  tHomeMin: number | null
  tHomeConsMin: number | null
  worstRadiusM: number | null // 0 = point value; null = sigma beyond the largest radius
  marginMin: number | null
  turnBackInMin: number | null
  o2LeftL: number | null
  o2NeededL: number | null
  bearingDeg: number | null
  distanceM: number
  slopeDeg: number | null
  vSafeMs: number | null
  outsidePartner: boolean | null
  circleCrossesHomeline: boolean
  nextStation: { station: string; etaMin: number } | null
  band: 'green' | 'amber' | 'red' | 'unknown'
  alarm: Alarm | null
  /** binding term of the timeline row in force (undefined = timeline has none) */
  binding: Binding | undefined
  /** during a station dwell: WS2's turn_back row for that station (latest leave, binding; D28) */
  latestLeave: { station: string; t_min: number; binding: Binding } | null
}

/** Smallest precomputed radius >= sigma (F19); 0 for an exact position; null if none is large enough. */
export function pickWorstRadius(sigmaM: number, radiiM: readonly number[]): number | null {
  if (!(sigmaM > 0)) return 0
  for (const r of [...radiiM].sort((a, b) => a - b)) if (r >= sigmaM) return r
  return null
}

/**
 * Does the uncertainty circle reach past the homeline? True when a reachable pixel within sigma
 * has T_home > budget, or when nothing is known there (disc off the grid / no reachable pixel).
 */
export function circleCrossesHomeline(tHome: FieldGrid, lon: number, lat: number, sigmaM: number, budgetMin: number): boolean {
  if (!(sigmaM > 0)) return false
  const m = tHome.discMax(lon, lat, sigmaM)
  return m === null || m > budgetMin
}

function ringContains(ring: number[][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Point in any polygon of a FeatureCollection (holes respected). */
export function insidePolygons(fc: PolygonFC, lon: number, lat: number): boolean {
  for (const f of fc.features) {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][]
    for (const poly of polys) {
      if (!poly.length || !ringContains(poly[0], lon, lat)) continue
      if (!poly.slice(1).some((hole) => ringContains(hole, lon, lat))) return true
    }
  }
  return false
}

export function computeReadout(pos: HudPosition, ctx: HudContext): Readout {
  const { cfg, fields, plan } = ctx
  const { lon, lat } = pos
  const r = pickWorstRadius(pos.sigma_m, cfg.worstCaseRadiiM)
  const worst = r && r > 0 ? fields.worst?.get(r) : undefined
  let tHome: number | null
  let o2Need: number | null
  if (r === 0) {
    tHome = fields.tHome.valueAt(lon, lat)
    o2Need = fields.o2Home?.valueAt(lon, lat) ?? null
  } else {
    // sigma > 0: only a precomputed worst case is honest; missing -> unknown
    tHome = worst?.tHome?.valueAt(lon, lat) ?? null
    o2Need = worst?.o2Home?.valueAt(lon, lat) ?? null
  }
  const H = plan.headroomAt(pos.t_eva_min)
  const margin = H !== null && tHome !== null ? H - tHome : null
  const crosses = circleCrossesHomeline(fields.tHome, lon, lat, pos.sigma_m, ctx.budgetMin)
  const outside = ctx.partner ? !insidePolygons(ctx.partner, lon, lat) : null
  const slope = fields.slope?.valueAt(lon, lat) ?? null
  const next = plan.nextArrival(pos.t_eva_min)
  const rad = ctx.radiation ?? { tripwireFired: false, tauDoseMin: null }
  const alarm = evaluateAlarm(
    { marginMin: margin, tripwireFired: rad.tripwireFired, tHomeMin: tHome, tauDoseMin: rad.tauDoseMin, circleCrossesHomeline: crosses, outsidePartner: outside },
    cfg.marginAmberMin,
  )
  return {
    t: pos.t_eva_min,
    tHomeMin: tHome,
    tHomeConsMin: fields.tHomeCons?.valueAt(lon, lat) ?? null,
    worstRadiusM: r,
    marginMin: margin,
    turnBackInMin: margin,
    o2LeftL: plan.o2LeftAt(pos.t_eva_min),
    o2NeededL: o2Need,
    bearingDeg: fields.homeBearing?.valueAt(lon, lat) ?? null,
    distanceM: fields.tHome.distanceM([lon, lat], ctx.pad),
    slopeDeg: slope,
    vSafeMs: slope === null ? null : vSafeAt(cfg, slope),
    outsidePartner: outside,
    circleCrossesHomeline: crosses,
    nextStation: next ? { station: next.station, etaMin: next.t_min - pos.t_eva_min } : null,
    band: marginBand(margin, cfg.marginAmberMin),
    alarm,
    binding: plan.bindingAt(pos.t_eva_min),
    latestLeave: latestLeaveAt(plan, pos),
  }
}

/** The dwell station's turn_back row (playback / drift on the route only; not for a dragged spot). */
function latestLeaveAt(plan: Plan, pos: HudPosition): Readout['latestLeave'] {
  if (pos.source === 'drag') return null
  const s = plan.stateAt(pos.t_eva_min)
  return s.phase === 'dwell' && s.station ? plan.turnBackAt(s.station) : null
}

/** Playback position (F19 source "playback"): on the planned route, sigma 0. */
export function playbackPosition(plan: Plan, t: number): HudPosition {
  const s = plan.stateAt(t)
  return { lon: s.lon, lat: s.lat, sigma_m: 0, source: 'playback', t_eva_min: t, last_fix: null }
}
