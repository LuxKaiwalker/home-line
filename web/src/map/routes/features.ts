// PORT R4: the two routes on the Plan map, pure part (no MapLibre, no DOM).
//
//   officialLines(routeFC)            the pad's precomputed official route, lines only (RouteFC also holds points)
//   labelAt(fc)                       where "Official route for this pad" sits (middle of the longest line)
//   mineView(input)                   "Your route": one feature per leg (pad → stop 1 → … → pad) in state
//                                     ok | infeasible | ghost, plus the numbered stop marks
//
// Leg states (Notion §2.4, interfaces §9): a leg the core has answered for the CURRENT stops is drawn
// along its path; from the first infeasible leg onward the route is in the infeasible token colour;
// a leg the core has not answered yet (still computing, or the stop moved since) is a dashed ghost,
// a straight line between its two ends. A refined leg (idle exact pass) simply replaces the path.
// Nothing is recomputed here: paths, feasibility and the first infeasible leg come from the results.
import type { PlanStop } from '../../state/planning'
import { stopLabels } from '../../state/planning'
import type { LegResult, RouteResults } from '../../state/routeResults'

export type LonLat = [number, number]
export type LegState = 'ok' | 'infeasible' | 'ghost'

export type LegFeature = GeoJSON.Feature<GeoJSON.LineString, { leg: number; state: LegState; refined: boolean }>
export type LegFC = GeoJSON.FeatureCollection<GeoJSON.LineString, LegFeature['properties']>
export type LineFC = GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>

export const EMPTY_FC: LineFC = { type: 'FeatureCollection', features: [] }

type AnyFC = { features: readonly { geometry: { type: string; coordinates: unknown } | null; properties?: unknown }[] } | null | undefined

/** The line features of a route file (RouteFC holds LineString, MultiLineString and Point features). */
export function officialLines(fc: AnyFC): LineFC {
  if (!fc) return EMPTY_FC
  const features = fc.features.filter((f) => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) as LineFC['features']
  return features.length ? { type: 'FeatureCollection', features } : EMPTY_FC
}

/** The middle vertex of the longest line (the label anchor), null when there is no line. */
export function labelAt(fc: LineFC): LonLat | null {
  let best: GeoJSON.Position[] | null = null
  for (const f of fc.features) {
    const g = f.geometry
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates
    for (const l of lines) if (l.length >= 2 && (!best || l.length > best.length)) best = l
  }
  if (!best) return null
  const p = best[Math.floor(best.length / 2)]
  return [p[0], p[1]]
}

// ---- your route ----------------------------------------------------------------------------------

/** Identity of a stop's position: a moved point is a different key (its old legs are stale). */
export const stopKey = (s: PlanStop): string => (s.kind === 'station' ? `s:${s.station}` : `p:${s.lon},${s.lat}`)
const padKey = (padId: string) => `pad:${padId}`

/** Expected end keys of leg i for `stops` (leg 0 = pad → stops[0], leg n = stops[n-1] → pad). */
export function legEndKey(stops: readonly PlanStop[], padId: string, i: number): string {
  const a = i === 0 ? padKey(padId) : stopKey(stops[i - 1])
  const b = i === stops.length ? padKey(padId) : stopKey(stops[i])
  return `${a}>${b}`
}

/** Does result leg `l` answer leg i of `stops`? Index plus stop ids (the pad end is matched by index). */
export function legMatches(l: LegResult, stops: readonly PlanStop[], i: number): boolean {
  if (l.index !== i) return false
  if (i > 0 && l.fromStopId !== stops[i - 1].id) return false
  if (i < stops.length && l.toStopId !== stops[i].id) return false
  return true
}

/**
 * The end keys each result leg was computed for, captured when the results arrive (the core answers
 * the stops as they are at publish time). A later move of a point changes its key, so the leg turns
 * back into a ghost until the core answers again.
 */
export function captureKeys(r: RouteResults, stops: readonly PlanStop[], padId: string): Map<LegResult, string> {
  const out = new Map<LegResult, string>()
  if (r.padId !== padId) return out
  for (const l of r.legs) if (l.index >= 0 && l.index <= stops.length && stops.length && legMatches(l, stops, l.index)) out.set(l, legEndKey(stops, padId, l.index))
  return out
}

export interface StopMark {
  id: string
  /** 1-based stop number */
  n: number
  label: string
  at: LonLat | null
  /** reached by an infeasible leg (the first infeasible leg or later) */
  infeasible: boolean
}

export interface MineInput {
  stops: readonly PlanStop[]
  padId: string
  pad: LonLat | null
  results: RouteResults
  keys: ReadonlyMap<LegResult, string>
  stationAt?: (id: string) => LonLat | null
  stationName?: (id: string) => string | null
}

export interface MineView {
  fc: LegFC
  stops: StopMark[]
  /** first infeasible leg index among the legs drawn from results, null = none */
  firstBad: number | null
}

const end = (p: [number, number][], last: boolean): LonLat | null => (p.length ? (last ? p[p.length - 1] : p[0]) : null)

export function mineView(o: MineInput): MineView {
  const { stops, padId, results } = o
  const n = stops.length
  if (!n) return { fc: { type: 'FeatureCollection', features: [] }, stops: [], firstBad: null }
  const samePad = results.padId === padId

  // the result leg answering each expected leg (valid = computed for the current ends)
  const legs: (LegResult | null)[] = []
  for (let i = 0; i <= n; i++) {
    const l = samePad ? (results.legs.find((x) => legMatches(x, stops, i)) ?? null) : null
    legs.push(l && o.keys.get(l) === legEndKey(stops, padId, i) ? l : null)
  }
  let firstBad: number | null = null
  for (let i = 0; i <= n; i++) {
    const l = legs[i]
    if (l && (!l.feasible || results.firstInfeasibleLeg === i)) {
      firstBad = i
      break
    }
  }

  // stop positions: points as placed; stations from the lookup, else from any result path ending there
  // PORT F19: a stop the results already route through is drawn on the route's own vertex (the
  // snapped cell / leg end of the current leg into it, else the start of the leg out of it), so its
  // badge and 3D ground dot sit on the line, never beside it at the raw planned lng/lat.
  const routed = (k: number): LonLat | null => {
    const into = legs[k]
    if (into && into.path.length) return end(into.path, true)
    const out = legs[k + 1]
    if (out && out.path.length) return end(out.path, false)
    return null
  }
  const pos = (s: PlanStop, k: number): LonLat | null => {
    const r = routed(k)
    if (r) return r
    if (s.kind === 'point') return [s.lon, s.lat]
    const hit = o.stationAt?.(s.station)
    if (hit) return hit
    if (!samePad) return null
    for (const l of results.legs) {
      if (l.toStopId === s.id) return end(l.path, true)
      if (l.fromStopId === s.id) return end(l.path, false)
    }
    return null
  }
  const at = stops.map((s, k) => pos(s, k))
  const pad = o.pad ?? (samePad ? (end(results.legs.find((l) => l.index === 0)?.path ?? [], false) ?? null) : null)

  const features: LegFeature[] = []
  for (let i = 0; i <= n; i++) {
    const l = legs[i]
    const a = i === 0 ? pad : at[i - 1]
    const b = i === n ? pad : at[i]
    const coords = l && l.path.length >= 2 ? l.path : a && b ? [a, b] : null
    if (!coords) continue
    const state: LegState = !l ? 'ghost' : firstBad !== null && i >= firstBad ? 'infeasible' : 'ok'
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { leg: i, state, refined: !!l?.refined } })
  }

  const labels = stopLabels(stops)
  const marks = stops.map((s, k) => ({
    id: s.id,
    n: k + 1,
    label: s.kind === 'station' && !s.name ? (o.stationName?.(s.station) ?? labels[k]) : labels[k],
    at: at[k],
    infeasible: firstBad !== null && k >= firstBad,
  }))
  return { fc: { type: 'FeatureCollection', features }, stops: marks, firstBad }
}
