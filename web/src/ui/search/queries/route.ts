// Route builder (search.md §2.2 #3, §4.2): `route S4 S1 S6`, `route s4, s1 → s6` → one row that drafts an
// ordered route through those stations. Live-only (spec rule 4): enabled only when live planning is
// reachable and route editing is in the build; otherwise disabled with the reason. Choosing calls only the
// waypoint store's setRouteDraft (routeAdapter.ts), one validated, undoable step.
import backendRaw from '../../../../../config/backend.yaml'
import type { CopyKey } from '../../copy'
import { runRouteDraft, type RouteStop } from './routeAdapter'
import type { QueryContext, QueryPattern, QueryRow } from './types'

const ROUTE = /^route\s+([^\s,→]+(?:\s*(?:,|→|\s)\s*[^\s,→]+)*)$/

/** config/backend.yaml route.max_stops (assumed, D97); 8 is the doc's value if the key is absent. */
export const MAX_STOPS: number = (() => {
  const v = (backendRaw as { route?: { max_stops?: unknown } }).route?.max_stops
  return typeof v === 'number' && v > 0 ? v : 8
})()

/** Station ids for a route query (as written in stations.json), or null when `q` is not one. Unknown tokens are kept upper-cased. */
export function parseRoute(q: string, ctx: Pick<QueryContext, 'stations'>): { stops: string[]; unknown: string[] } | null {
  const m = ROUTE.exec(q)
  if (!m) return null
  const byId = new Map(ctx.stations.map((s) => [s.id.toLowerCase(), s.id]))
  const stops: string[] = []
  const unknown: string[] = []
  for (const tok of m[1].split(/[\s,→]+/).filter(Boolean)) {
    const id = byId.get(tok)
    if (id) stops.push(id)
    else unknown.push(tok.toUpperCase())
  }
  return { stops, unknown }
}

function reasonFor(ctx: QueryContext, n: number): CopyKey | null {
  if (n > MAX_STOPS) return 'search.reason.tooManyStops'
  if (!ctx.live) return 'search.reason.offline'
  if (!ctx.routeEdit) return 'search.reason.routeEditOff'
  if (ctx.routeDraft === 'missing') return 'search.route.unavailable'
  return null
}

export const routePattern: QueryPattern = {
  id: 'route',
  hint: 'search.route.hint',
  examples: ['route S4 S1 S6', 'route s4, s1 → s6'],
  prefixes: ['route '],
  parse(q, ctx) {
    const r = parseRoute(q, ctx)
    if (!r) return null
    const base = { pattern: 'route' as const, icon: 'station' as const, live: true }
    if (r.unknown.length) {
      return [{ ...base, id: `route:unknown:${r.unknown[0]}`, title: 'search.route.unknown', vars: { code: r.unknown[0] }, disabledReason: 'search.reason.unknownStop', run: () => {} }]
    }
    const stops: RouteStop[] = r.stops.map((station) => ({ station }))
    const row: QueryRow = {
      ...base,
      id: `route:${r.stops.join('-')}`,
      title: 'search.route.row',
      vars: { stops: r.stops.join(' → ') },
      disabledReason: reasonFor(ctx, stops.length),
      // problems from setRouteDraft are shown by the route panel; the palette has closed by then
      run: () => void runRouteDraft(stops),
    }
    return [row]
  },
}
