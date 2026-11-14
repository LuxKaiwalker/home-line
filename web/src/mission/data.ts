// Everything the Mission Planer reads, for one scenario (default: scenarios/index.json "default").
//   - routing grid: the shared 5 m field grid (fields/index.json). A cell is walkable iff WS2's
//     T_home field is known there (WS2 reached it from the pad within its no-go limit: blocked,
//     unknown and unreached cells have A = 0), so a waypoint can always walk home.
//   - elevation: fp3d/far.f32.gz (WS8, 8 m, built from WS1's 1 m DEM where it exists), sampled
//     bilinearly at every cell centre. This is coarser than WS2's 3 m graph, so leg times and O2 are
//     browser estimates, labelled as such; T_home and O2 home stay WS2's own numbers.
//   - way home: WS2's pointer field (same path as the HUD's drag-anywhere).
import { CONFIG } from '../config'
import { data } from '../data/loader'
import type { BandsFC, EdgesFC, IsochroneFC, ScenarioEntry, TileJson } from '../data/types'
import { dataUrl } from '../env'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, parseIndex } from '../fp3d/format'
import { lonLatToXY, parseEqc } from '../fp3d/geo'
import { HeightGrid } from '../fp3d/terrain'
import { FieldGrid, loadField } from '../hud/fields'
import type { FieldsIndex as HudFieldsIndex } from '../hud/types'
import { loadPointer, type PointerField } from '../hud/wayhome'
import { padMarker, type PadMarkerInfo } from '../map/pad'
import { gradeModel, scenarioParams, type GradeModel } from './physio'
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
  tilejson: TileJson | null
  bands: BandsFC | null
  isochrones: IsochroneFC | null
  edges: EdgesFC | null
  /** file each layer came from, for the captions */
  files: { tHome: string; o2Home: string | null; pointer: string | null; elevation: string; bands: string; isochrones: string; edges: string }
  elevationResM: number
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

export async function loadMissionData(scenarioId?: string, onStep?: (what: string) => void): Promise<MissionData> {
  const L = data()
  const step = (s: string) => onStep?.(s)
  step('scenarios and pad')
  const [idx, fiRaw, padFile, tilejson] = await Promise.all([L.scenarios(), L.fieldsIndex(), L.optional(() => L.pad()), L.optional(() => L.tilejson())])
  const sid = scenarioId ?? idx.default
  const scenario = idx.scenarios.find((s) => s.id === sid)
  if (!scenario) throw new Error(`scenario ${sid} not in scenarios/index.json`)
  const pad = padMarker(padFile, CONFIG.padDefault)
  // The HUD's view of the same file (adds the pointer entry's own grid and stencil, contracts v1.1.1).
  const fi = fiRaw as unknown as HudFieldsIndex

  const tKey = `${sid}/t_home`
  const oKey = `${sid}/o2_home`
  const pKey = `${sid}/pointer`
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

  step('reachable-area layers')
  const [bands, isochrones, edges] = await Promise.all([
    L.optional(() => L.bands(scenario)),
    L.optional(() => L.isochrones(scenario)),
    L.optional(() => L.edges(scenario)),
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
    tilejson,
    bands,
    isochrones,
    edges,
    files: {
      tHome: fi.fields[tKey].file,
      o2Home: fi.fields[oKey]?.file ?? null,
      pointer: pointer ? fi.fields[pKey].file : null,
      elevation: fp.far.file,
      bands: scenario.files.bands,
      isochrones: scenario.files.isochrones,
      edges: scenario.files.edges,
    },
    elevationResM: fp.far.res_m,
  }
}
