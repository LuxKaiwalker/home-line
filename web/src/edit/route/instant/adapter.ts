// I1b: the ONE file between the Edit-route panel and I1a's browser compute core (edit/route/browser/:
// loadBrowserRouteData, computeBrowserRoute, buildBrowserMission). Everything else in instant/ codes
// against types.ts.
import { loadBrowserRouteData, type BrowserRouteData } from '../browser/data'
import { buildBrowserMission, computeBrowserRoute, type BrowserRouteResult } from '../browser/compute'
import type { RouteStop } from '../model'
import type { EstimateCore, EstimateResult } from './types'

/** Official-pad fields of the published data. */
export const OFFICIAL_FIELDS = 'fields/index.json'

/**
 * I2b: the picker pads with their own browser fields (I2: fields/index.json `pads/{id}/nom_104/...`; ids of
 * scenarios/pads/index.json). With the official pad these are the four pads of the Edit-route pad picker.
 */
export const FIELD_PADS: readonly string[] = ['rank2', 'rank3', 'rank4']

const PAD_FIELDS_PREFIX = `${OFFICIAL_FIELDS}#pads/`

/**
 * The fields the browser estimate runs on for this pad: the official pad's ('fields/index.json'), a picker
 * pad's own ('fields/index.json#pads/{id}'), or null when the browser has none (a custom spot, any other pad).
 */
export function padFields(padId: string | null, officialPadId: string): string | null {
  if (padId === null) return null
  if (padId === officialPadId) return OFFICIAL_FIELDS
  return FIELD_PADS.includes(padId) ? `${PAD_FIELDS_PREFIX}${padId}` : null
}

/** padFields' value -> loadBrowserRouteData's pad (null = the official fields). */
export function fieldsPadId(fields: string): string | null {
  return fields.startsWith(PAD_FIELDS_PREFIX) ? fields.slice(PAD_FIELDS_PREFIX.length) : null
}

const ISSUE_TEXT: Record<string, string> = {
  route_station_unknown: 'unknown station',
  route_point_outside_grid: 'outside the 5 m grid',
  route_point_not_walkable: 'not walkable',
  route_point_unreachable: 'not reachable',
}

/** I1a's result -> the panel's shape. Throws (the panel says "unavailable" with the reason) when the route cannot be computed. */
export function fromBrowser(r: BrowserRouteResult): EstimateResult {
  if (!r.feasibility) {
    const why = r.issues.map((i) => `${i.index < 0 ? 'rover pad' : (r.names[i.index] ?? `stop ${i.index + 1}`)} ${ISSUE_TEXT[i.code] ?? i.code}`).join('; ')
    throw new Error(why || 'the route cannot be estimated')
  }
  const f = r.feasibility
  return {
    legs: r.legs.map((l) => ({ leg: l.leg, from: l.from, to: l.to, walkMin: l.walkMin, o2UsedL: l.o2L, marginMin: l.marginMin, binding: l.binding })),
    totals: { walkMin: r.totals.walkMin, evaMin: r.totals.evaMin, o2UsedL: r.totals.o2UsedL, o2LeftL: r.totals.o2LeftL },
    tightest: r.tightest ? { marginMin: r.tightest.marginMin, binding: r.tightest.binding, leg: null } : null,
    feasibility: f.feasible ? { feasible: true } : { feasible: false, leg: f.leg, from: f.from, to: f.to, term: f.limit, shortMin: f.shortfall_min },
    raw: r,
  }
}

export const browserCore: EstimateCore = {
  // the default scenario only (P2–P4 have nom_104 fields only); cached per (pad, scenario) in data.ts
  load: (fields) => loadBrowserRouteData(undefined, fieldsPadId(fields)),
  compute: (data, pad, stops: readonly RouteStop[], start) => fromBrowser(computeBrowserRoute(data as BrowserRouteData, pad, stops, start)),
  mission: (result, ctx) => buildBrowserMission(result.raw as BrowserRouteResult, { data: ctx.data as BrowserRouteData }),
}
