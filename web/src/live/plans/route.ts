// The route a plan carries (D97, waypoint block §4.2): DRAFT shape of plan_inputs v1.2.0, which R0
// has not merged yet. plan_inputs.schema.json v1.0.x does not know `route` (additionalProperties:
// false), so planio.ts and plan.ts check `route` here and the rest of the document against the
// schema. When R0 lands, align these types with the contract and with R5's web/src/live/route/types.ts
// (not on origin/design when this was written), and keep one definition.
//
//   route: { mode: "auto" | "ordered", stops: [ {station: "S4"} | {lon, lat, label?} ] }
//   missing route = auto (old files stay valid)
//
// Structure and names only, like the schema: stop counts, spacing and validity on the terrain are
// the server's (config/backend.yaml route.* limits, R0/R3).
import { TITLE_MAX_CHARS } from '../config'

export const ROUTE_MODES = ['auto', 'ordered'] as const
export type RouteMode = (typeof ROUTE_MODES)[number]

export interface StationStop {
  station: string
}
export interface PointStop {
  lon: number
  lat: number
  label?: string
}
export type RouteStop = StationStop | PointStop

export interface RouteSpec {
  mode: RouteMode
  stops?: RouteStop[]
}

/** Station ids a route may name (stations.json ids; user points are {lon, lat}, not U ids). */
export const STATION_ID_RE = /^S[0-9]+$/

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const extra = (o: Record<string, unknown>, allowed: string[], path: string) =>
  Object.keys(o)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${path}.${k}: unknown field "${k}"`)

/** Readable errors for a `route` value; [] = valid. `path` prefixes each message. */
export function checkRoute(v: unknown, path = 'route'): string[] {
  if (!isObj(v)) return [`${path}: must be an object {mode, stops}`]
  const out = extra(v, ['mode', 'stops'], path)
  if (!ROUTE_MODES.includes(v.mode as RouteMode)) out.push(`${path}.mode: must be "auto" or "ordered", not ${JSON.stringify(v.mode)}`)
  if (v.stops !== undefined && !Array.isArray(v.stops)) out.push(`${path}.stops: must be a list`)
  const stops = Array.isArray(v.stops) ? v.stops : []
  if (v.mode === 'ordered' && stops.length === 0) out.push(`${path}.stops: an ordered route needs at least one stop`)
  stops.forEach((s, i) => out.push(...checkStop(s, `${path}.stops[${i}]`)))
  return out
}

function checkStop(s: unknown, path: string): string[] {
  if (!isObj(s)) return [`${path}: must be {station} or {lon, lat, label?}`]
  if ('station' in s) {
    const out = extra(s, ['station'], path)
    if (typeof s.station !== 'string' || !STATION_ID_RE.test(s.station)) out.push(`${path}.station: ${JSON.stringify(s.station)} is not a station id (S1, S2, …)`)
    return out
  }
  const out = extra(s, ['lon', 'lat', 'label'], path)
  if (!isNum(s.lon) || s.lon < -180 || s.lon > 360) out.push(`${path}.lon: must be a number from -180 to 360`)
  if (!isNum(s.lat) || s.lat < -90 || s.lat > 90) out.push(`${path}.lat: must be a number from -90 to 90`)
  if (s.label !== undefined) {
    if (typeof s.label !== 'string') out.push(`${path}.label: must be text`)
    else if ([...s.label].length > TITLE_MAX_CHARS) out.push(`${path}.label: longer than ${TITLE_MAX_CHARS} characters (limits.title_max_chars)`)
  }
  return out
}

/** The route of plan inputs (missing = auto). Assumes `inputs` passed checkRoute. */
export function routeOf(inputs: Record<string, unknown> | null | undefined): RouteSpec {
  const r = inputs?.route
  return isObj(r) && ROUTE_MODES.includes(r.mode as RouteMode) ? (r as unknown as RouteSpec) : { mode: 'auto' }
}

/** One stop as text: "S4", or "Crater rim (77.512000, 18.401000)" for a free point. */
export function stopText(s: RouteStop): string {
  if ('station' in s) return s.station
  const at = `${s.lon.toFixed(6)}, ${s.lat.toFixed(6)}`
  return s.label ? `${s.label} (${at})` : `point (${at})`
}

/** Short text of a route for lists: "auto (the engine chooses)" or "ordered: S4 → S1 → point (…)". */
export function routeText(r: RouteSpec): string {
  if (r.mode === 'auto') return 'auto (the engine chooses stations and order)'
  return `ordered: ${(r.stops ?? []).map(stopText).join(' → ')}`
}
