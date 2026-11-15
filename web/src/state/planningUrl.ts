// PORT W0a: URL sync of the planning state, in one place (Notion "Port Mission Planer into Plan" §2.7).
//
//   #/?route=<v2>          the share link: pad + route (stops, EVA start, storm, boundary)
//   #/mission?plan=<v1>    legacy Mission Planer link (mission/share.ts format v1) -> redirect into Plan
//   #/mission?add=<id>     legacy "Add to route" link -> redirect into Plan, station appended
//
// Format v2: base64url(UTF-8 JSON [2, padId, startUtc|null, storm 0|1, boundary|null, rows]) with
//   station row ['s', stationId, stopMin, tagMask, note, name?]
//   point row   [lon, lat, stopMin, tagMask, note, name?]      (lon/lat rounded to 1e-6 deg; no grid cell)
// tagMask = bits of PLAN_TAGS in order (same as v1). The v1 decoder is a copy of mission/share.ts
// decodePlan (mission/ is deleted at the end of wave 2; this file must not import it).
import { DEFAULT_STORM, EMPTY_ROUTE, makeStop, OFFICIAL_PAD_ID, PLAN_TAGS, type PadId, type PlanningDoc, type PlanningRoute, type PlanStop, type PlanTag } from './planning'

export const ROUTE_PARAM = 'route'
const V2 = 2
const V1 = 1
const round6 = (v: number) => Math.round(v * 1e6) / 1e6
const minutes = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function toB64Url(s: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}
const maskOf = (tags: readonly string[]) => PLAN_TAGS.reduce((m, t, i) => (tags.includes(t) ? m | (1 << i) : m), 0)
const tagsOf = (mask: unknown): PlanTag[] => PLAN_TAGS.filter((_, i) => (typeof mask === 'number' ? mask : 0) & (1 << i))

/** The `route` param value for a doc ('' for the official pad with no route and default settings). */
export function encodeRouteParam(doc: PlanningDoc): string {
  const r = doc.route
  if (doc.padId === OFFICIAL_PAD_ID && !r.stops.length && r.startUtc === null && r.storm === DEFAULT_STORM && !r.boundary) return ''
  const rows = r.stops.map((s) => {
    const row: (number | string)[] = s.kind === 'station' ? ['s', s.station] : [round6(s.lon), round6(s.lat)]
    row.push(minutes(s.stopMin), maskOf(s.tags), s.note)
    if (s.name) row.push(s.name)
    return row
  })
  return toB64Url(JSON.stringify([V2, doc.padId, r.startUtc, r.storm ? 1 : 0, r.boundary ?? null, rows]))
}

/** The doc of a `route` param; '' = the default doc; null = not a valid v2 value. New stop ids. */
export function decodeRouteParam(s: string): PlanningDoc | null {
  if (!s) return { padId: OFFICIAL_PAD_ID, route: EMPTY_ROUTE }
  try {
    const v: unknown = JSON.parse(fromB64Url(s))
    if (!Array.isArray(v) || v[0] !== V2 || typeof v[1] !== 'string' || !Array.isArray(v[5])) return null
    const [, padId, startUtc, storm, boundary, rows] = v as [number, PadId, unknown, unknown, unknown, unknown[]]
    const stops: PlanStop[] = []
    for (const row of rows) {
      if (!Array.isArray(row)) return null
      const station = row[0] === 's' && typeof row[1] === 'string' && row[1] ? row[1] : null
      if (!station && !(finite(row[0]) && finite(row[1]))) return null
      const [, , stop, mask, note, name] = row
      const common = { stopMin: minutes(stop), tags: tagsOf(mask), note: typeof note === 'string' ? note : '', ...(typeof name === 'string' && name ? { name } : {}) }
      stops.push(makeStop(station ? { kind: 'station', station, ...common } : { kind: 'point', lon: row[0] as number, lat: row[1] as number, ...common }))
    }
    const route: PlanningRoute = { stops, startUtc: typeof startUtc === 'string' && startUtc ? startUtc : null, storm: storm === 1 }
    if (typeof boundary === 'string' && boundary) route.boundary = boundary
    return { padId, route }
  } catch {
    return null
  }
}

/** Legacy v1 plan string (mission/share.ts) as stops; [] for '', null when invalid. Pad: official. */
export function decodeLegacyPlan(s: string): PlanStop[] | null {
  if (!s) return []
  try {
    const v: unknown = JSON.parse(fromB64Url(s))
    if (!Array.isArray(v) || v[0] !== V1 || !Array.isArray(v[1])) return null
    const out: PlanStop[] = []
    for (const r of v[1] as unknown[]) {
      if (!Array.isArray(r)) return null
      const [lon, lat, stop, mask, note, station] = r
      if (!finite(lon) || !finite(lat)) return null
      const common = { stopMin: minutes(stop), tags: tagsOf(mask), note: typeof note === 'string' ? note : '' }
      out.push(makeStop(typeof station === 'string' && station ? { kind: 'station', station, ...common } : { kind: 'point', lon, lat, ...common }))
    }
    return out
  } catch {
    return null
  }
}

/** What a hash asks of the planning state. */
export interface PlanningLink {
  /** pad + route to load (null: keep the current state) */
  doc: PlanningDoc | null
  /** a station to append (legacy ?add=; also allowed on #/?add=) */
  add: string | null
  /** the hash came from the old Mission tab: replace it with `canonical` (history.replaceState) */
  legacy: boolean
  /** the Plan hash that says the same: '#/' or '#/?route=…' (add is applied, then dropped) */
  canonical: string
  /** the link's route value could not be read (show a notice; nothing loaded) */
  invalid: boolean
}

/**
 * Read a hash: `#/?route=…` (Plan), `#/mission?plan=…&add=…` (legacy). null = the hash is neither the
 * Plan page nor the Mission tab (other views): planning ignores it.
 */
export function parsePlanningHash(hash: string): PlanningLink | null {
  const raw = hash.replace(/^#/, '')
  const [pathPart, query = ''] = raw.split('?', 2)
  const path = pathPart.split('/').filter(Boolean)
  const q = new URLSearchParams(query)
  const add = q.get('add') || null
  if (path.length === 0) {
    const r = q.get(ROUTE_PARAM)
    const doc = r ? decodeRouteParam(r) : null
    return { doc, add, legacy: false, canonical: doc ? planningHref(doc) : '#/', invalid: !!r && !doc }
  }
  if (path.length === 1 && path[0] === 'mission') {
    const p = q.get('plan')
    const stops = p ? decodeLegacyPlan(p) : null
    const doc = stops ? { padId: OFFICIAL_PAD_ID, route: { ...EMPTY_ROUTE, stops } } : null
    return { doc, add, legacy: true, canonical: doc ? planningHref(doc) : '#/', invalid: !!p && !stops }
  }
  return null
}

/** The share link hash of a doc: '#/?route=…', or '#/' for the default doc. */
export function planningHref(doc: PlanningDoc): string {
  const v = encodeRouteParam(doc)
  return v ? `#/?${ROUTE_PARAM}=${v}` : '#/'
}

/** Where a legacy Mission link goes (router redirect, U4/I3); null = not a legacy link. */
export function legacyRedirect(hash: string): string | null {
  const l = parsePlanningHash(hash)
  if (!l?.legacy) return null
  return l.add ? `${l.canonical}${l.canonical.includes('?') ? '&' : '?'}add=${encodeURIComponent(l.add)}` : l.canonical
}
