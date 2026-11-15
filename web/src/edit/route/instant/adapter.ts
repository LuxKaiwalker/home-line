// I1b: the ONE file between the Edit-route panel and I1a's browser compute core (edit/route/browser/:
// loadBrowserRouteData, computeBrowserRoute, buildBrowserMission). Everything else in instant/ codes
// against types.ts.
import { loadBrowserRouteData, type BrowserRouteData } from '../browser/data'
import { buildBrowserMission, computeBrowserRoute, type BrowserRouteResult } from '../browser/compute'
import type { RouteStop } from '../model'
import type { EstimateCore, EstimateResult } from './types'

/** Official-pad fields of the published data (I2 adds the picker pads' fields here). */
export const OFFICIAL_FIELDS = 'fields/index.json'

/**
 * Seam for I2's picker pads: the fields the browser estimate runs on for this pad, or null when the
 * browser has no fields for it (custom spot, a picker pad without fields yet).
 */
export function padFields(padId: string | null, officialPadId: string): string | null {
  return padId !== null && padId === officialPadId ? OFFICIAL_FIELDS : null
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
  // the official fields = the default scenario's published tree (I2: per-pad fields by URL)
  load: () => loadBrowserRouteData(),
  compute: (data, pad, stops: readonly RouteStop[], start) => fromBrowser(computeBrowserRoute(data as BrowserRouteData, pad, stops, start)),
  mission: (result, ctx) => buildBrowserMission(result.raw as BrowserRouteResult, { data: ctx.data as BrowserRouteData }),
}
