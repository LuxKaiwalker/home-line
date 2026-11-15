// I1a (instant browser path): everything computeBrowserRoute reads, for one scenario. Reuses WP6's route
// grid (map/grid.ts loadRouteGrid: the 5 m T_home field grid, walkable = T_home known, 8 m fp3d heights);
// adds only what the margin and the way home need, ported from origin/waypoint-routing (N0CEO, Mission
// Planer) web/src/mission/data.ts: the scenario's O2_home field, WS2's pointer field (hud/wayhome), WS4
// rad.json + clock.json (EVA start 09:00 LMST, t_dark), stations.json (access point + dwell) and pad.json.
// Nothing here is imported by the static build: only the live Edit-route panel (I1b) loads it.
import siteRaw from '../../../../../config/site.yaml'
import stationsRaw from '../../../../../config/stations.yaml'
import { cfg, CONFIG } from '../../../config'
import { data } from '../../../data/loader'
import type { PadFile, Rad, Station } from '../../../data/types'
import { dataUrl } from '../../../env'
import { parseHudConfig } from '../../../hud/config'
import { FieldGrid, loadField } from '../../../hud/fields'
import type { FieldsIndex as HudFieldsIndex } from '../../../hud/types'
import { loadPointer, type PointerField } from '../../../hud/wayhome'
import hudRaw from '../../../../../config/hud.yaml'
import crewRaw from '../../../../../config/crew.yaml'
import conditionsRaw from '../../../../../config/conditions.yaml'
import { loadRouteGrid } from '../map/grid'
import { LegRouter, type Leg, type RouteGrid } from '../map/router'

/** config/site.yaml crs.analysis_proj: the pad-local frame of mission.json. */
export const ANALYSIS_PROJ: string = cfg<string>(siteRaw, 'crs.analysis_proj')
/** config/hud.yaml margin_amber_min (mission.json constants). */
export const MARGIN_AMBER_MIN: number = parseHudConfig(hudRaw, crewRaw, conditionsRaw).marginAmberMin
/** config/stations.yaml dwell_min: a station without its own dwell, and every free point (WP2b). */
export const DEFAULT_DWELL_MIN: number = cfg<number>(stationsRaw, 'dwell_min')

// ---- clock.json readers (ported unchanged from mission/data.ts) ----------------------------------

/** clock.json eva.start_utc (WS4), or null. */
export function evaStartUtcOf(clock: unknown): string | null {
  const v = (clock as { eva?: { start_utc?: unknown } } | null)?.eva?.start_utc
  return typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(v) ? v : null
}

/** clock.json eva.msl_sol (WS4), or null. */
export function mslSolOf(clock: unknown): number | null {
  const v = (clock as { eva?: { msl_sol?: unknown } } | null)?.eva?.msl_sol
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

/** clock.json eva.start_lmst (WS4), or null. */
export function evaStartLmstOf(clock: unknown): string | null {
  const v = (clock as { eva?: { start_lmst?: unknown } } | null)?.eva?.start_lmst
  return typeof v === 'string' && /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(v) ? v : null
}

/** clock.json eva.t_dark_min (WS4), or null. */
export function tDarkOf(clock: unknown): number | null {
  const v = (clock as { eva?: { t_dark_min?: unknown } } | null)?.eva?.t_dark_min
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// ---- the data object ------------------------------------------------------------------------------

/** A station as the route reaches it: its access point in this scenario (stations.json) and its dwell. */
export interface BrowserStation {
  id: string
  name: string
  lon: number
  lat: number
  dwellMin: number
}

export interface BrowserPad {
  lon: number
  lat: number
  id: string | null
  elevM: number | null
  /** mission.json frame.pad.kind / source */
  kind: 'official' | 'picker' | 'custom' | 'config_default'
  source: string
}

export interface BrowserRouteData {
  scenario: string
  /** WS2 T_home on the 5 m field grid; the routing grid is this grid (walkable = T_home known) */
  tHome: FieldGrid
  o2Home: FieldGrid | null
  /** WS2 pointer field: the fastest way home from any cell (hud/wayhome) */
  pointer: PointerField | null
  grid: RouteGrid
  router: { route(from: number, to: number): Leg | null }
  /** leg cache (map/legs.ts routeLegs): key "from-to" cell pair; kept across recomputes */
  legCache: Map<string, Leg | null>
  stations: BrowserStation[]
  /** the pad the fields were computed for (pad.json): home of T_home / O2_home / pointer */
  fieldsPad: BrowserPad
  rad: Rad | null
  tDarkMin: number | null
  evaStartLmst: string | null
  evaStartUtc: string | null
  mslSol: number | null
  /** D39 storm replay on (the engine's default: the dose term is in route.{sid}.margin_terms) */
  storm: boolean
  files: Record<string, string | null>
  elevationResM: number
}

/** stations.json -> BrowserStation: the access point of this scenario when known (WS2 access-cell rule). */
export function browserStations(list: readonly Station[], scenario: string): BrowserStation[] {
  return list.map((s) => {
    const a = s.access?.[scenario] as { lon?: number; lat?: number } | undefined
    const ext = s as Station & { access_lon?: number; access_lat?: number }
    const lon = typeof a?.lon === 'number' ? a.lon : typeof ext.access_lon === 'number' ? ext.access_lon : s.lon
    const lat = typeof a?.lat === 'number' ? a.lat : typeof ext.access_lat === 'number' ? ext.access_lat : s.lat
    const dwellMin = typeof s.dwell_min === 'number' && Number.isFinite(s.dwell_min) && s.dwell_min >= 0 ? s.dwell_min : DEFAULT_DWELL_MIN
    return { id: s.id, name: s.name, lon, lat, dwellMin }
  })
}

/** pad.json -> the fields' pad (the official pad = rank1 on the published data). */
export function fieldsPadOf(padFile: PadFile | null): BrowserPad {
  const p = padFile?.pad as (PadFile['pad'] & { id?: string; elev_m?: number; source?: string }) | undefined
  if (!p) return { lon: CONFIG.padDefault.lon, lat: CONFIG.padDefault.lat, id: null, elevM: null, kind: 'config_default', source: 'config/site.yaml pad_default' }
  const official = typeof p.source === 'string' && /D21/.test(p.source)
  return { lon: p.lon, lat: p.lat, id: p.id ?? null, elevM: typeof p.elev_m === 'number' ? p.elev_m : null, kind: official ? 'official' : 'custom', source: p.source ?? 'pad.json' }
}

/** Assemble the data object from loaded parts (the loader below; tests build it from files). */
export function makeBrowserRouteData(p: {
  scenario: string
  tHome: FieldGrid
  o2Home: FieldGrid | null
  pointer: PointerField | null
  grid: RouteGrid
  router: { route(from: number, to: number): Leg | null }
  stations: readonly Station[]
  padFile: PadFile | null
  rad: Rad | null
  clock: unknown
  files?: Record<string, string | null>
  elevationResM?: number
  storm?: boolean
}): BrowserRouteData {
  return {
    scenario: p.scenario,
    tHome: p.tHome,
    o2Home: p.o2Home,
    pointer: p.pointer,
    grid: p.grid,
    router: p.router,
    legCache: new Map(),
    stations: browserStations(p.stations, p.scenario),
    fieldsPad: fieldsPadOf(p.padFile),
    rad: p.rad,
    tDarkMin: tDarkOf(p.clock),
    evaStartLmst: evaStartLmstOf(p.clock),
    evaStartUtc: evaStartUtcOf(p.clock),
    mslSol: mslSolOf(p.clock),
    storm: p.storm ?? true,
    files: p.files ?? {},
    elevationResM: p.elevationResM ?? 8,
  }
}

const loaded = new Map<string, Promise<BrowserRouteData>>()

/**
 * Load once per scenario (default: variants.yaml scenarios.default). The T_home grid, heights and
 * router model are WP6's (loadRouteGrid, shared with the ghost route); O2_home, the pointer field,
 * stations, pad and WS4 conditions are fetched here. Everything after this is synchronous.
 */
export function loadBrowserRouteData(scenario: string = CONFIG.defaultScenario): Promise<BrowserRouteData> {
  let p = loaded.get(scenario)
  if (!p) {
    p = (async () => {
      const L = data()
      const fi = (await L.fieldsIndex()) as unknown as HudFieldsIndex
      const oKey = `${scenario}/o2_home`
      const pKey = `${scenario}/pointer`
      const [rg, o2Home, pointer, stations, padFile, rad, clock] = await Promise.all([
        loadRouteGrid(scenario),
        fi.fields[oKey] ? loadField(fi, oKey, dataUrl) : Promise.resolve(null),
        fi.fields[pKey]?.stencil ? L.optional(() => loadPointer(fi, pKey, dataUrl)) : Promise.resolve(null),
        L.stations(),
        L.optional(() => L.pad()),
        L.optional(() => L.rad()),
        L.optional(() => L.clock()),
      ])
      return makeBrowserRouteData({
        scenario,
        tHome: rg.tHome,
        o2Home,
        pointer,
        grid: rg.grid,
        router: new LegRouter(rg.grid, rg.model),
        stations,
        padFile,
        rad,
        clock,
        files: {
          tHome: fi.fields[`${scenario}/t_home`]?.file ?? null,
          o2Home: fi.fields[oKey]?.file ?? null,
          pointer: pointer ? fi.fields[pKey].file : null,
          elevation: 'fp3d/far.f32.gz',
        },
        elevationResM: 8,
      })
    })()
    p.catch(() => loaded.delete(scenario))
    loaded.set(scenario, p)
  }
  return p
}
