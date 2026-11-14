// TypeScript shapes of the web-facing files, from contracts/*.schema.json v1.0.0 (SPEC §6, §6.1,
// §6.2). The loader validates every file against its schema before these types are trusted.
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon } from 'geojson'

export type Variant = 'optimistic' | 'nominal' | 'conservative'
export type EdgeCause = 'physiology' | 'slope' | 'data'

export interface ScenarioEntry {
  id: string
  variant: Variant
  suit_kg: number
  files: { isochrones: string; bands: string; edges: string; partner: string }
  headline: { budget_min: number; reachable_pct: number | null; range_pct: [number | null, number | null] }
}

export interface ScenariosIndex {
  dummy: boolean
  default: string
  scenarios: ScenarioEntry[]
}

type FC<G extends Polygon | MultiPolygon | LineString | MultiLineString | Point, P> = FeatureCollection<G, P> & { dummy?: boolean }

export type IsochroneFC = FC<Polygon | MultiPolygon, { minutes: number }>
export type BandsFC = FC<Polygon | MultiPolygon, { budget: number; variant: Variant; [k: string]: unknown }>
export type EdgesFC = FC<LineString | MultiLineString, { budget: number; cause: EdgeCause; [k: string]: unknown }>
export type PartnerFC = FC<Polygon | MultiPolygon | LineString | MultiLineString, Record<string, unknown>>
export type RouteFC = FC<LineString | MultiLineString | Point, Record<string, unknown>>
export type AnyFC = FeatureCollection & { dummy?: boolean }
export type AnyFeature = Feature

export interface Station {
  id: string
  name: string
  lon: number
  lat: number
  value: number | null
  objective: string
  tasks: string[]
  dwell_min: number
  t_home_min: Record<string, number | null>
  in_partner_line: boolean | null
  card: string
}

export interface Card {
  dummy?: boolean
  navcam: { sol: number | null; image_id: string | null; url_local: string | null; overlay_png: string | null }
  skyline_error_deg: { near: number | null; mid: number | null; far: number | null }
  panorama_png: string | null
  landmarks: { name: string; bearing_deg: number; dist_km: number }[]
  timeline: { arrive: number | null; leave: number | null; turn_back: number | null }
  margin_binding: 'O2' | 'daylight' | 'dose'
  contingency: string
}

export interface TimelineEvent {
  t_min: number
  event: string
  station: string | null
  o2_left_L: number | null
  t_home_min: number | null
  margin_min: number | null
}

export interface TradeCell {
  science_value: number | null
  reachable_pct: number | null
  partner_area_km2: number | null
}

export interface TradeTable {
  dummy?: boolean
  rows: number[]
  cols: number[]
  cells: TradeCell[][]
}

export interface PadFile {
  dummy: boolean
  pad: {
    lon: number
    lat: number
    elev_m: number | null
    score: number | null
    checks: { assessed_pct_30min: number | null; max_slope_deg: number | null; rule_passed: boolean | null }
  }
  alternatives: { rank: number; lon: number; lat: number; elev_m: number | null; score: number | null }[]
  hop_options: { pads: number[][]; note: string }[]
  site_rule_version: string | number
}

export interface Rad {
  dummy?: boolean
  latest: { utc: string | null; dose_rate_uGy_day: number | null; lag_days: number | null }
  baseline_uGy_day: number | null
  storm_2024: {
    series: [string, number | null][]
    peak_uGy_day: number | null
    excess_mGy: number | null
    onset_utc: string | null
    tripwire_utc: string | null
  }
  leash: { D_allow_mGy: number | null; tau_min_at_peak: number | null }
}

export interface ManifestEntry {
  value: unknown
  units: string | null
  file: string
  script: string
  commit: string
  utc: string
}
export type Manifest = { dummy?: boolean } & Record<string, ManifestEntry | boolean | undefined>

export interface FieldInfo {
  file: string
  scale: number
  units: string
  scenario: string | null
}
export interface FieldsIndex {
  dummy: boolean
  bounds: [number, number, number, number]
  width: number
  height: number
  res_m: number
  fields: Record<string, FieldInfo>
}

export interface V1 {
  n: number
  bias_deg: number | null
  rmse_deg: number | null
  r: number | null
  thresholds_deg: number[]
  confusion: unknown
  [k: string]: unknown
}

export interface V2 {
  summary: Record<string, unknown>
  frames: Record<string, unknown>[]
  [k: string]: unknown
}

export interface Coreg {
  dx_m: number | null
  dy_m: number | null
  residual_median_m: number | null
  residual_mad_m: number | null
  residuals: Record<string, unknown>[]
  [k: string]: unknown
}

/** Loose contracts (structure not fixed by SPEC; the producer proposes it to C). */
export type Coverage = Record<string, unknown>
export type Rems = Record<string, unknown>
export type Clock = Record<string, unknown>
export interface Donki {
  label: 'context only, not a trigger'
  records: Record<string, unknown>[]
  [k: string]: unknown
}

export interface FixIntervalSummary {
  set: 'low' | 'medium' | 'high'
  median_m: number | null
  edge_p10_m: number | null
  class_area_pct: Record<'<100' | '100-300' | '300-1000' | '>1000', number | null>
}
