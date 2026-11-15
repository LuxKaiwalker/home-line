// PORT U4: the route core's mission.json exporter, reached ONLY through import() inside functions
// (interfaces.md §7b: no static import of edit/route/** from outside edit/route). The default core:
//   user route    edit/route/browser computeBrowserRoute + buildBrowserMission (origin mission_planer,
//                 origin_label = the core's estimate label), on the active pad's routing fields
//   official plan official pad: WP9c's precomputed sim/official/mission.json, passed through unchanged;
//                 picker pad: the stations of its precomputed "Official route for this pad", in that
//                 order, through the same core exporter (an Estimate, labelled by the core)
// Nothing here recomputes or rounds a number: the core's document is used as is.
import { loadPadEnv, type PadEnv } from '../../../pads'
import { EMPTY_ROUTE, makeStop, OFFICIAL_PAD_ID, toRouteStops, type PadId, type PlanningDoc, type PlanStop } from '../../../state/planning'
import { isMissionText, officialMissionUrl } from '../../cards/simslot'

type DataModule = typeof import('../../../edit/route/browser/data')
type BrowserRouteData = Awaited<ReturnType<DataModule['loadBrowserRouteData']>>

export type ExportErrorCode = 'route' | 'pad' | 'official' | 'generic'

/** Why an export could not be built (the panel shows copy errors.<code> with the reason). */
export class ExportError extends Error {
  readonly code: ExportErrorCode
  readonly reason: string
  constructor(code: ExportErrorCode, reason = '') {
    super(reason || code)
    this.name = 'ExportError'
    this.code = code
    this.reason = reason
  }
}

export type MissionDoc = Record<string, unknown>

export interface ExportCore {
  /** mission.json (finalized: mission_id, created_utc) of the user's route on its pad */
  routeMission(doc: PlanningDoc, now?: Date): Promise<MissionDoc>
  /** the official plan of a pad; `text` = the file as published when it is a precomputed file */
  officialMission(padId: PadId, now?: Date): Promise<{ doc: MissionDoc; text?: string }>
}

export interface CoreDeps {
  /** the core's data for a pad (default: official = loadBrowserRouteData, picker = its routing fields) */
  dataFor?: (padId: PadId) => Promise<BrowserRouteData>
  /** a pad's environment (default: pads/ loadPadEnv) */
  padEnv?: (padId: PadId) => Promise<PadEnv>
  /** the official tree's data for a scenario (default: edit/route/browser loadBrowserRouteData) */
  baseData?: (scenario?: string) => Promise<BrowserRouteData>
  /** fetch for the official mission.json (default: global fetch) */
  fetch?: (url: string) => Promise<Response>
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The core's data for a picker pad: the official tree with this pad's routing fields (same 5 m grid). */
async function pickerData(padId: PadId, padEnv: (id: PadId) => Promise<PadEnv>, baseData: (scenario?: string) => Promise<BrowserRouteData>): Promise<BrowserRouteData> {
  const env = await padEnv(padId)
  if (!env.info.hasRoutingFields || !env.info.files.fields) throw new ExportError('pad')
  const f = env.routingFields
  const [{ makeBrowserRouteData }, base] = await Promise.all([import('../../../edit/route/browser/data'), baseData(f.scenario)])
  const same = f.tHome.width === base.tHome.width && f.tHome.height === base.tHome.height && f.tHome.w === base.tHome.w && f.tHome.n === base.tHome.n
  if (!same) throw new ExportError('pad', 'the pad fields are on another grid')
  // the routing grid of this pad = edit/route/map/grid.ts routeGridOf(T_home, heights): walkable = T_home known,
  // heights of the official tree (same cells). Restated here: edit/route/map/ is imported only by its owners (map.test.tsx).
  const grid: BrowserRouteData['grid'] = { width: f.tHome.width, height: f.tHome.height, resM: f.tHome.resM, elev: base.grid.elev, passable: Uint8Array.from(f.tHome.data.known) }
  // a fresh router + leg cache on this grid (makeBrowserRouteData builds them); everything else from the official tree
  const fresh = makeBrowserRouteData({ scenario: base.scenario, tHome: f.tHome, o2Home: f.o2Home, pointer: f.pointer, grid, model: base.model, stations: [], padFile: null, rad: base.rad, clock: null, storm: base.storm })
  const keys = env.info.files.fields
  return {
    ...base,
    tHome: f.tHome,
    o2Home: f.o2Home,
    pointer: f.pointer,
    grid,
    router: fresh.router,
    components: fresh.components,
    legCache: fresh.legCache,
    fieldsPad: { lon: f.pad.lon, lat: f.pad.lat, id: env.info.sourceId, elevM: f.pad.elevM, kind: 'picker', source: `scenarios/pads/${env.info.sourceId}/summary.json pad (D21 rover parking option)` },
    files: { ...base.files, tHome: `fields/${keys.tHome}.png`, o2Home: f.o2Home ? `fields/${keys.o2Home}.png` : null, pointer: f.pointer ? `fields/${keys.pointer}.png` : null },
  }
}

/** Station stops of a pad's precomputed official route (legs in order; 'pad' ends dropped). */
export function officialStops(route: { features: readonly { properties?: Record<string, unknown> | null }[] } | null): PlanStop[] {
  if (!route) return []
  const legs = route.features
    .map((f) => f.properties ?? {})
    .filter((p) => typeof p.leg === 'number' && typeof p.to === 'string')
    .sort((a, b) => (a.leg as number) - (b.leg as number))
  return legs.filter((p) => p.to !== 'pad').map((p) => makeStop({ kind: 'station', station: p.to as string }))
}

export function createExportCore(deps: CoreDeps = {}): ExportCore {
  const padEnv = deps.padEnv ?? ((id: PadId) => loadPadEnv(id))
  const baseData = deps.baseData ?? (async (scenario?: string) => (await import('../../../edit/route/browser/data')).loadBrowserRouteData(scenario))
  const dataFor = deps.dataFor ?? ((padId: PadId) => (padId === OFFICIAL_PAD_ID ? baseData() : pickerData(padId, padEnv, baseData)))

  async function routeMission(doc: PlanningDoc, now?: Date): Promise<MissionDoc> {
    if (!doc.route.stops.length) throw new ExportError('route', 'no stops')
    const [compute, start, adapter] = await Promise.all([
      import('../../../edit/route/browser/compute'),
      import('../../../edit/route/browser/start'),
      import('../../../edit/route/instant/adapter'),
    ])
    let data: BrowserRouteData
    try {
      data = await dataFor(doc.padId)
    } catch (e) {
      throw e instanceof ExportError ? e : new ExportError('generic', why(e))
    }
    const startMs = doc.route.startUtc ? Date.parse(doc.route.startUtc) : null
    data = { ...start.withEvaStart(data, Number.isFinite(startMs) ? startMs : null), storm: doc.route.storm }
    const r = compute.computeBrowserRoute(data, data.fieldsPad, toRouteStops(doc.route.stops))
    if (!r.feasibility) {
      let reason = 'the route cannot be estimated'
      try {
        adapter.fromBrowser(r)
      } catch (e) {
        reason = why(e)
      }
      throw new ExportError('route', reason)
    }
    return compute.buildBrowserMission(r, { data, ...(now ? { now } : {}) })
  }

  async function officialMission(padId: PadId, now?: Date): Promise<{ doc: MissionDoc; text?: string }> {
    if (padId === OFFICIAL_PAD_ID) {
      let text: string
      try {
        const res = await (deps.fetch ?? fetch)(officialMissionUrl())
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        text = await res.text()
      } catch (e) {
        throw new ExportError('official', why(e))
      }
      if (!isMissionText(text)) throw new ExportError('official', 'not a mission.json')
      return { doc: JSON.parse(text) as MissionDoc, text }
    }
    let stops: PlanStop[]
    try {
      stops = officialStops((await (await padEnv(padId)).planProducts()).route)
    } catch (e) {
      throw new ExportError('official', why(e))
    }
    if (!stops.length) throw new ExportError('official', 'no official route for this pad')
    return { doc: await routeMission({ padId, route: { ...EMPTY_ROUTE, stops } }, now) }
  }

  return { routeMission, officialMission }
}
