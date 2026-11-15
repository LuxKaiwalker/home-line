// PORT W0a: pad environment service types (owner after W0a: P1). FINAL: other packages code against them.
// Data layout (web/public/data):
//   official pad   pad.json; routing fields fields/{scenario}/{t_home,o2_home,pointer}.png (fields/index.json
//                  keys `{scenario}/t_home` …); plan products scenarios/bands_{suit}.geojson,
//                  scenarios/{scenario}/edges.geojson, route_{scenario}.geojson, timeline_{scenario}.json
//   picker pads    scenarios/pads/index.json rows rank2..rank4 (+ pad_default: plan products only, NO
//                  routing fields); routing fields fields/pads/{id}/nom_104/{t_home,o2_home,pointer}.png
//                  (keys `pads/{id}/nom_104/t_home` …, nom_104 only); plan products scenarios/pads/{id}/
//                  {summary.json, bands_104.geojson, edges.geojson, partner.geojson, route_nom_104.geojson,
//                  timeline_nom_104.json} (data/pads.ts padFiles)
import type { BandsFC, EdgesFC, PartnerFC, RouteFC, TimelineEvent } from '../data/types'
import type { PadSummaryView } from '../data/pads'
import type { FieldGrid } from '../hud/fields'
import type { PointerField } from '../hud/wayhome'
import type { ReadSignal } from '../state/signal'
import type { PadId } from '../state/planning'

export type { PadId } from '../state/planning'
export { OFFICIAL_PAD_ID } from '../state/planning'

/** Pads kept in memory (LRU). */
export const PAD_CACHE_SIZE = 3

export interface PadInfo {
  /** OFFICIAL_PAD_ID for the official pad, else the index row id (rank2 …) */
  id: PadId
  /** the scenarios/pads/index.json row id (official: rank1) */
  sourceId: string
  /** short map / picker label: "Official pad", "P2", "P3", … (copy: route.pads) */
  label: string
  lon: number
  lat: number
  elevM: number | null
  /** D21 rank (1 = official) */
  rank: number | null
  official: boolean
  /** routing fields exist for the default scenario: a user route can be planned from this pad */
  hasRoutingFields: boolean
  files: PadEnvFiles
}

export interface PadEnvFiles {
  /** fields/index.json keys (hud/fields loadField) */
  fields: { tHome: string; o2Home: string; pointer: string } | null
  summary: string | null
  bands: string
  edges: string
  partner: string | null
  route: string | null
  timeline: string | null
}

/** What the route core needs (~5 MB per pad; loaded first). R1 builds BrowserRouteData from it. */
export interface RoutingFields {
  padId: PadId
  scenario: string
  pad: { lon: number; lat: number; elevM: number | null }
  tHome: FieldGrid
  o2Home: FieldGrid | null
  pointer: PointerField | null
}

/** The pad's precomputed plan (~6 MB per pad; loaded lazily). Never recomputed: official numbers. */
export interface PlanProducts {
  bands: BandsFC
  edges: EdgesFC
  partner: PartnerFC | null
  /** the pad's precomputed "Official route for this pad" */
  route: RouteFC | null
  timeline: TimelineEvent[] | null
}

export interface PadEnv {
  info: PadInfo
  routingFields: RoutingFields
  /** lazy: first call starts the fetch; the promise is cached with the env */
  planProducts(): Promise<PlanProducts>
  /** scenarios/pads/{id}/summary.json; official pad: null (the strip keeps scenarios/index.json numbers) */
  summary: PadSummaryView | null
}

export type PadLoadState =
  | { state: 'idle' }
  /** since = performance.now() at start: UI shows the skeleton at once, "Loading pad P3…" */
  | { state: 'loading'; since: number }
  | { state: 'ready'; env: PadEnv }
  | { state: 'error'; error: unknown }

export interface LoadPadOptions {
  signal?: AbortSignal
  /** idle prefetch: lower priority, never reported as the active load */
  prefetch?: boolean
}

export interface PadService {
  /** pads index (official first, then by rank); resolves once, cached */
  loadPadIndex(): Promise<PadInfo[]>
  /** the index once loaded, [] before (synchronous for render) */
  listPads(): PadInfo[]
  /** routing fields + summary; plan products lazily. Cached (LRU of PAD_CACHE_SIZE); never blocks the map. */
  loadPadEnv(padId: PadId, opts?: LoadPadOptions): Promise<PadEnv>
  /** the cached env, if any (no fetch) */
  peekPadEnv(padId: PadId): PadEnv | undefined
  /** after first paint, in idle time: load these (usually the next pads by rank) */
  prefetchPads(ids: readonly PadId[]): void
  /** load state per pad id (UI skeletons, "Loading pad P3…") */
  loadState: ReadSignal<Readonly<Record<PadId, PadLoadState>>>
}
