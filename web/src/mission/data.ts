// Everything the Mission Planer reads, for one scenario (default: scenarios/index.json "default").
//   - routing grid: the shared 5 m field grid (fields/index.json). A cell is walkable iff WS2's
//     T_home field is known there (WS2 reached it from the pad within its no-go limit: blocked,
//     unknown and unreached cells have A = 0), so a waypoint can always walk home.
//   - elevation: fp3d/far.f32.gz (WS8, 8 m, built from WS1's 1 m DEM where it exists), sampled
//     bilinearly at every cell centre. This is coarser than WS2's 3 m graph, so leg times and O2 are
//     browser estimates, labelled as such; T_home and O2 home stay WS2's own numbers.
//   - way home: WS2's pointer field (same path as the HUD's drag-anywhere).
//   - J1d: the pad: the official pad (pad.json, the scenario's own fields) or a picker pad P2–P4 with its
//     own fields (I2, mission/pads.ts); loaded once per (pad, scenario), as I2b's edit/route/browser/data.ts.
import { CONFIG } from '../config'
import { data } from '../data/loader'
import type { BandsFC, EdgesFC, IsochroneFC, Rad, ScenarioEntry, TileJson } from '../data/types'
import { dataUrl } from '../env'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, parseIndex } from '../fp3d/format'
import { lonLatToXY, parseEqc } from '../fp3d/geo'
import { HeightGrid } from '../fp3d/terrain'
import { FieldGrid, loadField } from '../hud/fields'
import type { FieldsIndex as HudFieldsIndex } from '../hud/types'
import { loadPointer, type PointerField } from '../hud/wayhome'
import { citesD21, padMarker, type PadMarkerInfo } from '../map/pad'
import { gradeModel, scenarioParams, type GradeModel } from './physio'
import { fieldKeys, padChoices, PADS_INDEX, pickerLayerFiles, pickerPad, type MissionPad, type PadChoice, type PadIndexRow } from './pads'
import type { RouteGrid } from './router'

export interface MissionData {
  scenario: ScenarioEntry
  scenarios: ScenarioEntry[]
  pad: PadMarkerInfo
  tHome: FieldGrid
  o2Home: FieldGrid | null
  pointer: PointerField | null
  grid: RouteGrid
  model: GradeModel
  /** J1i: the pad's reachable component of `grid` (mission/reach.ts reachableFrom), keyed by pad cell, filled lazily */
  components: Map<number, Uint8Array>
  tilejson: TileJson | null
  bands: BandsFC | null
  isochrones: IsochroneFC | null
  edges: EdgesFC | null
  /** file each layer came from, for the captions */
  files: { tHome: string; o2Home: string | null; pointer: string | null; elevation: string; bands: string | null; isochrones: string | null; edges: string | null }
  elevationResM: number
  /** WS4 conditions for the margin (mission/margin.ts): the RAD storm series (D39) and the
   *  minutes from EVA start to darkness; null when the file is missing */
  rad: Rad | null
  tDarkMin: number | null
  /** pad.json pad id and areoid elevation (null without pad.json / when unknown): the mission export's frame */
  padId: string | null
  /** official = pad.json cites D21; config_default = no pad.json (site.yaml pad_default); custom = any other pad.json pad;
   *  picker = a pads index pad P2–P4 (J1d) */
  padKind: 'official' | 'picker' | 'custom' | 'config_default'
  /** J1d: the pad these fields are for (null = official) and the four choices of the tab */
  fieldsPad: MissionPad
  padChoices: PadChoice[]
  padElevM: number | null
  /** clock.json eva.start_lmst (D31), or null */
  evaStartLmst: string | null
  /** clock.json eva.start_utc and msl_sol (WS4): the EVA start as an instant, for the simulator's sky; null when missing */
  evaStartUtc: string | null
  mslSol: number | null
}

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

async function fetchBuf(path: string): Promise<ArrayBuffer> {
  const res = await fetch(dataUrl(path))
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.arrayBuffer()
}

/** Elevation of every cell centre of `g` from a height grid in the analysis CRS. */
export function sampleElevation(g: FieldGrid, heights: HeightGrid, toXY: (lon: number, lat: number) => [number, number]): Float32Array {
  const out = new Float32Array(g.width * g.height)
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      const [lon, lat] = g.lonLatOf(r, c)
      const [x, y] = toXY(lon, lat)
      out[r * g.width + c] = heights.bilinear(x, y)
    }
  }
  return out
}

const loaded = new Map<string, Promise<MissionData>>()

/** J1d: loadMissionData once per (pad, scenario); a failed load is not kept. */
export function missionData(scenarioId?: string, onStep?: (what: string) => void, pad: MissionPad = null): Promise<MissionData> {
  const key = JSON.stringify([pad, scenarioId ?? null])
  let p = loaded.get(key)
  if (!p) {
    p = loadMissionData(scenarioId, onStep, pad)
    loaded.set(key, p)
    p.catch(() => loaded.get(key) === p && loaded.delete(key))
  }
  return p
}

export async function loadMissionData(scenarioId?: string, onStep?: (what: string) => void, fieldsPad: MissionPad = null): Promise<MissionData> {
  const L = data()
  const step = (s: string) => onStep?.(s)
  step('scenarios and pad')
  const [idx, fiRaw, padFile, tilejson] = await Promise.all([L.scenarios(), L.fieldsIndex(), L.optional(() => L.pad()), L.optional(() => L.tilejson())])
  const sid = scenarioId ?? idx.default
  const scenario = idx.scenarios.find((s) => s.id === sid)
  if (!scenario) throw new Error(`scenario ${sid} not in scenarios/index.json`)
  let pad = padMarker(padFile, CONFIG.padDefault)
  // The HUD's view of the same file (adds the pointer entry's own grid and stencil, contracts v1.1.1).
  const fi = fiRaw as unknown as HudFieldsIndex

  const keys = fieldKeys(fieldsPad, sid)
  const tKey = keys.tHome
  const oKey = keys.o2Home
  const pKey = keys.pointer
  // J1d: a picker pad (P2–P4): its pads index row is the pad, its own layers the boundary
  let picker: ReturnType<typeof pickerPad> | null = null
  if (fieldsPad !== null) {
    const idxPads = await L.json<{ pads: PadIndexRow[] }>(PADS_INDEX)
    const row = idxPads.pads.find((r) => r.id === fieldsPad)
    if (!row) throw new Error(`${PADS_INDEX} has no pad ${fieldsPad}`)
    picker = pickerPad(row)
    pad = picker.marker
  }
  const layers = picker ? pickerLayerFiles(fieldsPad!, scenario.suit_kg) : null
  if (!fi.fields[tKey]) throw new Error(`fields/index.json has no ${tKey}`)
  step('walk-home fields')
  const [tHome, o2Home, pointer] = await Promise.all([
    loadField(fi, tKey, dataUrl),
    fi.fields[oKey] ? loadField(fi, oKey, dataUrl) : Promise.resolve(null),
    fi.fields[pKey]?.stencil ? L.optional(() => loadPointer(fi, pKey, dataUrl)) : Promise.resolve(null),
  ])

  step('terrain heights')
  const fp = parseIndex(JSON.parse(new TextDecoder().decode(await fetchBuf('fp3d/index.json'))))
  const farBuf = await gunzipIfNeeded(await fetchBuf(fp.far.file))
  const [west, north] = farOrigin(fp)
  const heights = new HeightGrid(west, north, fp.far.res_m, fp.far.width, fp.far.height, decodeHeights(farBuf, fp.far.width, fp.far.height, codecOf(fp)))
  const eqc = parseEqc(fp.chunk_grid.crs)
  const elev = sampleElevation(tHome, heights, (lon, lat) => lonLatToXY(eqc, lon, lat))
  const passable = new Uint8Array(tHome.width * tHome.height)
  passable.set(tHome.data.known)

  step('reachable-area layers and conditions')
  const [bands, isochrones, edges, rad, clock] = await Promise.all([
    layers ? L.optional(() => L.json<BandsFC>(layers.bands)) : L.optional(() => L.bands(scenario)),
    layers ? Promise.resolve(null) : L.optional(() => L.isochrones(scenario)),
    layers ? L.optional(() => L.json<EdgesFC>(layers.edges)) : L.optional(() => L.edges(scenario)),
    L.optional(() => L.rad()),
    L.optional(() => L.clock()),
  ])

  return {
    scenario,
    scenarios: idx.scenarios,
    pad,
    tHome,
    o2Home,
    pointer,
    grid: { width: tHome.width, height: tHome.height, resM: tHome.resM, elev, passable },
    model: gradeModel(scenarioParams(sid)),
    components: new Map(),
    tilejson,
    bands,
    isochrones,
    edges,
    files: {
      tHome: fi.fields[tKey].file,
      o2Home: fi.fields[oKey]?.file ?? null,
      pointer: pointer ? fi.fields[pKey].file : null,
      elevation: fp.far.file,
      bands: layers ? layers.bands : scenario.files.bands,
      isochrones: layers ? null : scenario.files.isochrones,
      edges: layers ? layers.edges : scenario.files.edges,
    },
    elevationResM: fp.far.res_m,
    rad,
    tDarkMin: tDarkOf(clock),
    padId: picker ? picker.id : padFile ? (padFile.pad.id ?? null) : null,
    padKind: picker ? picker.kind : !padFile ? 'config_default' : citesD21(padFile.pad.source) ? 'official' : 'custom',
    padElevM: picker ? picker.elevM : padFile && typeof padFile.pad.elev_m === 'number' ? padFile.pad.elev_m : null,
    fieldsPad,
    padChoices: padChoices(fi.fields, sid),
    evaStartLmst: evaStartLmstOf(clock),
    evaStartUtc: evaStartUtcOf(clock),
    mslSol: mslSolOf(clock),
  }
}
