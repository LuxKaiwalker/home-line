// Mock result tree of the staged plan job (F24): the files a live plan writes under
// results/{hash}/, in the static data contracts (contracts/*.schema.json, "same file names and
// contracts as web/public/data", openapi getResultFile). Each stage adds files or replaces earlier
// versions (the manifest and the scenario index grow as stages finish). contract.test.ts checks every
// version against its contract. Geometry and numbers are placeholders around the mock pad, NOT results.
import type { Manifest } from '../../data/types'
import missionExample from '../../../../contracts/bundle/examples/mission.mission_planer.json'
import { LIVE_LABEL } from '../config'
import { MOCK_STAGES } from './fixtures'
import { MOCK_PAD_VALID } from './pads'

const { lon, lat } = MOCK_PAD_VALID
const SCN = 'nom_104'
const MOCK_COMMIT = '0000000000000000000000000000000000000000'
const MOCK_UTC = '2026-11-14T22:00:00Z'

function square(d: number, dx = 0): number[][][] {
  return [[[lon - d + dx, lat - d], [lon + d + dx, lat - d], [lon + d + dx, lat + d], [lon - d + dx, lat + d], [lon - d + dx, lat - d]]]
}
const poly = (coordinates: number[][][], properties: Record<string, unknown>) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates }, properties })
const line = (coordinates: number[][], properties: Record<string, unknown>) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties })
const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features })

const files = { isochrones: `scenarios/${SCN}/isochrones.geojson`, bands: 'scenarios/bands_104.geojson', edges: `scenarios/${SCN}/edges.geojson`, partner: `scenarios/${SCN}/partner.geojson` }

function index(rangePct: [number | null, number | null]) {
  return { dummy: false, default: SCN, scenarios: [{ id: SCN, variant: 'nominal', suit_kg: 104, files, headline: { budget_min: 30, reachable_pct: 24.1, range_pct: rangePct } }] }
}

function entry(value: unknown, units: string | null, file: string) {
  return { value, units, file, script: 'mock (web/src/live/mock/result.ts)', commit: MOCK_COMMIT, utc: MOCK_UTC }
}

const MANIFEST_NOMINAL: Manifest = {
  [`reachable_pct.${SCN}.30`]: entry(24.1, '%', 'scenarios/index.json'),
  [`route.${SCN}.total_min`]: entry(212.5, 'min', `route_${SCN}.geojson`),
} as unknown as Manifest

const MANIFEST_BANDS: Manifest = {
  ...MANIFEST_NOMINAL,
  [`reachable_pct_range.${SCN}.30.low`]: entry(12.3, '%', 'scenarios/index.json'),
  [`reachable_pct_range.${SCN}.30.high`]: entry(31, '%', 'scenarios/index.json'),
} as unknown as Manifest

const nominalBands = [poly(square(0.004), { budget: 30, variant: 'nominal' }), poly(square(0.007), { budget: 60, variant: 'nominal' })]

/** Files written by each mock stage (MOCK_STAGES order); a later stage may replace a path. */
export const MOCK_RESULT_STAGES: Record<(typeof MOCK_STAGES)[number], Record<string, unknown>> = {
  nominal: {
    'manifest.json': MANIFEST_NOMINAL,
    'scenarios/index.json': index([null, null]),
    [files.bands]: fc(nominalBands),
    [files.isochrones]: fc([poly(square(0.002), { minutes: 10 }), poly(square(0.003), { minutes: 20 }), poly(square(0.004), { minutes: 30 })]),
    [files.edges]: fc([line([[lon + 0.004, lat - 0.004], [lon + 0.004, lat + 0.004]], { budget: 30, cause: 'slope' })]),
    [`route_${SCN}.geojson`]: fc([
      line([[lon, lat], [lon + 0.003, lat + 0.001]], { leg: 1, from: 'pad', to: 'S1', t_min: 21.4 }),
      line([[lon + 0.003, lat + 0.001], [lon, lat]], { leg: 2, from: 'S1', to: 'pad', t_min: 23 }),
    ]),
  },
  bands: {
    'manifest.json': MANIFEST_BANDS,
    'scenarios/index.json': index([12.3, 31]),
    [files.bands]: fc([
      ...nominalBands,
      poly(square(0.003), { budget: 30, variant: 'conservative' }),
      poly(square(0.005), { budget: 30, variant: 'optimistic' }),
    ]),
  },
  hud: {
    [files.partner]: fc([line([[lon - 0.002, lat - 0.002], [lon + 0.002, lat - 0.002], [lon + 0.002, lat + 0.002]], { case: 'cart', style: 'dashed', default_visible: false })]),
  },
}

/** The staged files only (MOCK_RESULT_STAGES), without the exporter's mission.json. */
function stagedFile(path: string, stagesDone: readonly string[]): unknown | null {
  let out: unknown = null
  for (const st of MOCK_STAGES) {
    if (!stagesDone.includes(st)) continue
    const f = MOCK_RESULT_STAGES[st] as Record<string, unknown>
    if (path in f) out = f[path]
  }
  return out
}

/**
 * The file at `path` as the tree holds it once `stagesDone` have finished (null = not written yet).
 * Once every stage is done the "mission" exporter has run as on the server (WP9b, D110): the
 * manifest gains its sim_plan entry and mission.json is served.
 */
export function mockResultFile(path: string, stagesDone: readonly string[]): unknown | null {
  if (MOCK_STAGES.every((st) => stagesDone.includes(st))) return withMission(path, stagedFile(path, MOCK_STAGES))
  return stagedFile(path, stagesDone)
}

/** Every (stage, path, document) of the mock tree, for the contract test. */
export function mockResultDocs(): { stage: string; path: string; doc: unknown }[] {
  return Object.entries(MOCK_RESULT_STAGES).flatMap(([stage, f]) => Object.entries(f).map(([path, doc]) => ({ stage, path, doc })))
}

export const MOCK_RESULT_SCENARIO = SCN

// --- "Send to simulator" (D76 slot, D103 format, D110): mission.json and its manifest entry ---
// WP9b's exporter writes results/{hash}/mission.json for every live job, with a manifest entry of kind
// "sim_plan". The mock's mission.json is the contract example (contracts/bundle/examples/
// mission.mission_planer.json) with the origin of a live job; its numbers are the example's
// placeholders, NOT a result of the mock tree.

/** Path of the mock's sim_plan file: mission.json at the result root, as WP9b writes it. */
export const MOCK_SIM_FILE = 'mission.json'

/** The mock live job's mission.json: the contract example, origin computed_live, engine grid. */
export const MOCK_MISSION_LIVE = {
  ...missionExample,
  mission_id: 'm-000000mock01',
  title: `Mock live job · 1 waypoint · ${SCN}`,
  created_utc: MOCK_UTC,
  origin: 'computed_live',
  origin_label: LIVE_LABEL,
  planner: { ...missionExample.planner, app_commit: MOCK_COMMIT, routing_grid_res_m: 3, files: { route: `route_${SCN}.geojson`, timeline: `timeline_${SCN}.json` } },
}

/** `m` plus one entry of kind sim_plan (a copy; `m` is unchanged). */
export function withSimPlan(m: Manifest, file = MOCK_SIM_FILE): Manifest {
  return { ...m, [`sim.${SCN}.export`]: { ...entry(null, null, file), kind: 'sim_plan' } } as unknown as Manifest
}

/** A finished tree's file after the mission exporter ran (manifest entry + mission.json). */
function withMission(path: string, doc: unknown | null): unknown | null {
  if (path === 'manifest.json' && doc) return withSimPlan(doc as Manifest)
  if (path === MOCK_SIM_FILE) return MOCK_MISSION_LIVE
  return doc
}

/**
 * The complete mock tree (every stage done), with (sim) or without the exporter's sim_plan entry and
 * mission.json: without it, mission.json answers 404 (the slot's "not available" state).
 */
export function mockFinishedTree(sim: boolean): (path: string) => unknown | null {
  return (path) => (sim ? withMission(path, stagedFile(path, MOCK_STAGES)) : stagedFile(path, MOCK_STAGES))
}
