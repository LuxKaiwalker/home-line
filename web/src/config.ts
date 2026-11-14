// Typed view of the config/*.yaml values the web app uses. AGENTS rule 2: every constant comes
// from config/; this module only reads it (parsed at build time, see vite.config.ts). A missing
// key throws at import time, so a renamed config value fails the build and the tests.
import siteRaw from '../../config/site.yaml'
import crewRaw from '../../config/crew.yaml'
import variantsRaw from '../../config/variants.yaml'
import hudRaw from '../../config/hud.yaml'
import haulRaw from '../../config/haul.yaml'
import conditionsRaw from '../../config/conditions.yaml'
import stationsRaw from '../../config/stations.yaml'
import horizonRaw from '../../config/horizon.yaml'
import eventRaw from '../../config/event.yaml'

type Obj = Record<string, unknown>

/** Read a dotted path from a parsed YAML object; throw if it is missing. */
export function cfg<T = unknown>(root: unknown, path: string): T {
  let cur: unknown = root
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as Obj))) {
      throw new Error(`config value missing: ${path}`)
    }
    cur = (cur as Obj)[part]
  }
  return cur as T
}

/** Like cfg, but undefined when the key is absent (for values that config/ may add later). */
export function cfgOpt<T = unknown>(root: unknown, path: string): T | undefined {
  try {
    return cfg<T>(root, path)
  } catch {
    return undefined
  }
}

function num(root: unknown, path: string): number {
  const v = cfg(root, path)
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`config value not a number: ${path}`)
  return v
}

/** A config value with the file and key it came from, so the UI can cite it. */
export interface CfgValue<T> {
  value: T
  source: string // e.g. "config/site.yaml: crs.mars_radius_m"
}

function cite<T>(file: string, root: unknown, path: string): CfgValue<T> {
  return { value: cfg<T>(root, path), source: `config/${file}: ${path}` }
}

export interface IsochroneMinutes {
  min: number
  max: number
  step: number
}

export const CONFIG = {
  marsRadiusM: num(siteRaw, 'crs.mars_radius_m'),
  aoiFocus: cfg<{ west: number; east: number; south: number; north: number }>(siteRaw, 'aoi_focus'),
  padDefault: cfg<{ lon: number; lat: number; rule: string; verify_at_h0?: boolean }>(siteRaw, 'pad_default'),
  planningRadiusM: num(siteRaw, 'planning_radius_m'),
  walkbackBudgetsMin: cfg<number[]>(crewRaw, 'walkback_budgets_min'),
  bandBudgetsMin: cfg<number[]>(variantsRaw, 'outputs.band_budgets_min'),
  suitMassesKg: cfg<number[]>(crewRaw, 'suit_masses_kg'),
  defaultSuitKg: num(crewRaw, 'default_suit_kg'),
  defaultScenario: cfg<string>(variantsRaw, 'scenarios.default'),
  scenarioIds: cfg<string[]>(variantsRaw, 'scenarios.ids'),
  variantNames: Object.keys(cfg<Obj>(variantsRaw, 'variants')),
  isochroneMinutes: cfg<IsochroneMinutes>(variantsRaw, 'outputs.isochrone_minutes'),
  simulatedLabel: cfg<string>(hudRaw, 'labels.simulated'),
  haulContourMin: num(haulRaw, 'contour_min'),
  dAllowMgy: num(conditionsRaw, 'leash.d_allow_mgy'),
  /** D9 slider {min, max, step}; not in config/conditions.yaml yet (only a comment there), see STATUS Blocked. */
  dAllowSliderMgy: cfgOpt<{ min: number; max: number; step: number }>(conditionsRaw, 'leash.d_allow_slider_mgy'),
  tripwireFactor: num(conditionsRaw, 'rad.tripwire.factor'),
  tripwireSamples: num(conditionsRaw, 'rad.tripwire.consecutive_samples'),
  remsStaleSince: cfg<string>(conditionsRaw, 'rems.feed_stale_since'),
  distanceClassesKm: cfg<number[]>(horizonRaw, 'distance_classes_km'),
  stationsPlan: cfg<{ id: string; name: string; rule: string }[]>(stationsRaw, 'stations').map((s) => ({ id: s.id, name: s.name, rule: s.rule })),
  h0Utc: cfg<string>(eventRaw, 'h0_utc'),
  timezone: cfg<string>(eventRaw, 'timezone'),
  o2PrimaryL: num(crewRaw, 'o2_budget.primary_L'),
} as const

/** Config values shown on screen (assumptions table, labels), each with its source. */
export const CITED = {
  bodyMassKg: cite<number>('crew.yaml', crewRaw, 'body_mass_kg'),
  vo2maxMlKgMin: cite<number>('crew.yaml', crewRaw, 'vo2max_ml_kg_min'),
  effortCapFrac: cite<number>('crew.yaml', crewRaw, 'effort_cap_frac'),
  evaH: cite<number>('crew.yaml', crewRaw, 'eva_h'),
  reserveMin: cite<number>('crew.yaml', crewRaw, 'reserve_min'),
  o2ReserveFrac: cite<number>('crew.yaml', crewRaw, 'o2_reserve_frac'),
  walkbackBudgetsMin: cite<number[]>('crew.yaml', crewRaw, 'walkback_budgets_min'),
  suitMassesKg: cite<number[]>('crew.yaml', crewRaw, 'suit_masses_kg'),
  anchorVo2: cite<number>('crew.yaml', crewRaw, 'anchor.vo2_ml_kg_min'),
  anchorSpeed: cite<number>('crew.yaml', crewRaw, 'anchor.speed_ms'),
  o2PrimaryL: cite<number>('crew.yaml', crewRaw, 'o2_budget.primary_L'),
  o2SecondaryL: cite<number>('crew.yaml', crewRaw, 'o2_budget.secondary_L'),
  nogoNominalDeg: cite<number>('site.yaml', siteRaw, 'slope.nogo_deg.nominal'),
  nogoOptimisticDeg: cite<number>('site.yaml', siteRaw, 'slope.nogo_deg.optimistic'),
  flagBeyondTestedDeg: cite<number>('site.yaml', siteRaw, 'slope.flag_beyond_tested_deg'),
  dAllowMgy: cite<number>('conditions.yaml', conditionsRaw, 'leash.d_allow_mgy'),
  tripwireFactor: cite<number>('conditions.yaml', conditionsRaw, 'rad.tripwire.factor'),
  tripwireSamples: cite<number>('conditions.yaml', conditionsRaw, 'rad.tripwire.consecutive_samples'),
  qSep: cite<number>('conditions.yaml', conditionsRaw, 'rad.q_sep'),
  radExpected: cite<{ peak_mgy_day: [number, number]; excess_mgy: [number, number] }>('conditions.yaml', conditionsRaw, 'rad.expected'),
  remsStaleSince: cite<string>('conditions.yaml', conditionsRaw, 'rems.feed_stale_since'),
  fixSigmaRoverM: cite<number>('hud.yaml', hudRaw, 'fix_sigma_m.rover'),
  fixSigmaStationM: cite<number>('hud.yaml', hudRaw, 'fix_sigma_m.station'),
  driftPct: cite<number>('hud.yaml', hudRaw, 'fallback_drift.pct_of_distance'),
  haulBootMu: cite<number>('haul.yaml', haulRaw, 'boot_mu'),
  casualtyBoundKg: cite<number>('haul.yaml', haulRaw, 'casualty_kg.bound'),
  haulContourMin: cite<number>('haul.yaml', haulRaw, 'contour_min'),
} as const
