// Palette queries (search block S3a; docs/design/search.md §2 grammar, §5 API). PATTERNS is in
// precedence order (§2.2); the first pattern that parses wins and its rows go first in the list
// ("Answer"), fuzzy results for the same text follow. S3b adds coords, timeHome and marginBelow.
import { CONFIG } from '../../../config'
import type { Loader } from '../../../data/loader'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useSignalValue } from '../../../state/signal'
import { commands } from '../../commands/registry'
import { missionClock, resolvePlanScenario } from '../../../state/mission'
import { fieldAt } from '../../../map/field/decode'
import { selection, type SelectionRef } from '../../../state/selection'
import { buildTimelineModel, type TimelineFileRow } from '../../timeline/model'
import { coordsPattern } from './coords'
import { marginPattern } from './margin'
import { routePattern } from './route'
import { timeHomePattern } from './timeHome'
import { timePattern } from './time'
import type { QueryContext, QueryHere, QueryPattern, QueryRow } from './types'
import { withinPattern } from './within'

export type { QueryContext, QueryPattern, QueryRow, QueryRunEnv, RowValue } from './types'
import { probeRouteDraft } from './routeAdapter'

export const PATTERNS: readonly QueryPattern[] = [coordsPattern, timePattern, routePattern, withinPattern, timeHomePattern, marginPattern]

/** §2.1 normalisation, applied before every pattern. */
export function normalizeQuery(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:->|–>|→)\s*/g, ' → ')
    .replace(/′/g, "'")
    .replace(/″/g, '"')
}

/** Answer rows for `q`: the first pattern that parses, or [] (fuzzy search only). */
export function runQueries(q: string, ctx: QueryContext): QueryRow[] {
  const n = normalizeQuery(q)
  if (!n) return []
  for (const p of PATTERNS) {
    const rows = p.parse(n, ctx)
    if (rows) return rows
  }
  return []
}

/** §2.3 Tab completion: the first prefix (precedence order) that starts with the typed text and is longer. */
export function completePrefix(input: string): string | null {
  const p = input.toLowerCase().replace(/^\s+/, '')
  if (!p) return null
  for (const pat of PATTERNS) for (const x of pat.prefixes) if (x.startsWith(p) && x.length > p.length) return x
  return null
}

/** S3b: a selection as a place for `time home here` (cell, station, pad, picked edge); null otherwise. */
export function hereOf(ref: SelectionRef | null, stations: QueryContext['stations'], pad: QueryContext['pad']): QueryHere | null {
  if (!ref) return null
  if (ref.kind === 'cell') return { lon: ref.lon, lat: ref.lat, ref }
  if (ref.kind === 'station') {
    const s = stations.find((x) => x.id === ref.id)
    return s ? { lon: s.lon, lat: s.lat, ref } : null
  }
  if (ref.kind === 'pad') return ref.id === pad.id && Number.isFinite(pad.lon) ? { lon: pad.lon, lat: pad.lat, ref } : null
  if (ref.kind === 'edge' && ref.lon !== undefined && ref.lat !== undefined) return { lon: ref.lon, lat: ref.lat, ref }
  return null
}

/** VITE_LIVE on and VITE_ROUTE_EDIT not 0/false (the rule of live/config.ts, read here without importing live/). */
function routeEditBuild(): boolean {
  const live = import.meta.env.VITE_LIVE
  const edit = import.meta.env.VITE_ROUTE_EDIT
  return (live === '1' || live === 'true') && !(edit === '0' || edit === 'false')
}

/** The query context from the files the app already loads (loader-cached). `live`: liveStatus.reachable. */
export async function loadQueryContext(L: Loader, live: boolean): Promise<QueryContext> {
  const [stations, idx, pad] = await Promise.all([L.optional(() => L.stations()), L.optional(() => L.scenarios()), L.optional(() => L.pad())])
  const scenario = idx ? resolvePlanScenario(idx).id : ''
  // S3b: the current plan's timeline (loader-cached; the dock and the index read the same file)
  const tl = scenario ? await L.optional(() => L.timeline(scenario)) : null
  const padAt = { id: pad?.pad.id ?? 'rank1', lon: pad?.pad.lon ?? NaN, lat: pad?.pad.lat ?? NaN }
  const st = stations ?? []
  return {
    stations: st,
    scenario,
    pad: padAt,
    fieldAt,
    timeline: tl ? buildTimelineModel({ scenario, timeline: tl as unknown as TimelineFileRow[], tMax: missionClock.tMax }) : null,
    hereNow: () => hereOf(selection.selected.peek(), st, padAt),
    planningRadiusM: CONFIG.planningRadiusM,
    tMaxMin: missionClock.tMax,
    live,
    marsRadiusM: CONFIG.marsRadiusM,
    routeEdit: routeEditBuild(),
    routeDraft: 'unknown',
  }
}

/** The palette's query context: `given` (tests), else loaded once per `live` value (none without a loader); in a live build with
 *  route editing, one probe of the route store says whether setRouteDraft exists. Loading never changes state. */
export function useQueryContext(L: Loader | null, live: boolean, given?: QueryContext): QueryContext | null {
  const [ctx, setCtx] = useState<QueryContext | null>(given ?? null)
  useEffect(() => {
    if (given || !L) return
    let alive = true
    loadQueryContext(L, live).then(
      async (c) => {
        if (alive) setCtx(c)
        if (!c.live || !c.routeEdit) return
        const routeDraft = await probeRouteDraft()
        if (alive) setCtx({ ...c, routeDraft })
      },
      () => {},
    )
    return () => void (alive = false)
  }, [live])
  const routeOpen = useSignalValue(commands).some((c) => c.id === 'route.open') // WP17 registers it (live builds)
  return useMemo(() => (ctx && !given ? { ...ctx, routeOpen } : ctx), [ctx, routeOpen])
}
