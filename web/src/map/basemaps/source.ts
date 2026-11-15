// L1c: the elevation grid behind the Topography / Material rasters, as the Mission Planer built it
// (mission/data.ts, not imported: mission/ goes away): the official pad's T_home field grid of the
// default scenario (5 m cells, row 0 north) with fp3d's far terrain heights sampled bilinearly at
// every cell centre. Loaded once, on the first switch away from Satellite.
import { data } from '../../data/loader'
import { dataUrl } from '../../env'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, parseIndex } from '../../fp3d/format'
import { lonLatToXY, parseEqc } from '../../fp3d/geo'
import { HeightGrid } from '../../fp3d/terrain'
import { loadField, type FieldGrid } from '../../hud/fields'
import type { FieldsIndex as HudFieldsIndex } from '../../hud/types'

export interface ReliefSource {
  grid: FieldGrid
  elev: Float32Array
  resM: number
  /** resolution of the terrain heights (legend) */
  elevationResM: number
}

async function fetchBuf(path: string): Promise<ArrayBuffer> {
  const res = await fetch(dataUrl(path))
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.arrayBuffer()
}

/** Elevation of every cell centre of `g` from a height grid in the analysis CRS. */
export function sampleElevation(g: FieldGrid, heights: { bilinear(x: number, y: number): number }, toXY: (lon: number, lat: number) => [number, number]): Float32Array {
  const out = new Float32Array(g.width * g.height)
  for (let r = 0; r < g.height; r++)
    for (let c = 0; c < g.width; c++) {
      const [lon, lat] = g.lonLatOf(r, c)
      const [x, y] = toXY(lon, lat)
      out[r * g.width + c] = heights.bilinear(x, y)
    }
  return out
}

async function load(): Promise<ReliefSource> {
  const L = data()
  const [idx, fiRaw] = await Promise.all([L.scenarios(), L.fieldsIndex()])
  const fi = fiRaw as unknown as HudFieldsIndex
  const key = `${idx.default}/t_home`
  if (!fi.fields[key]) throw new Error(`fields/index.json has no ${key}`)
  const grid = await loadField(fi, key, dataUrl)
  const fp = parseIndex(JSON.parse(new TextDecoder().decode(await fetchBuf('fp3d/index.json'))))
  const farBuf = await gunzipIfNeeded(await fetchBuf(fp.far.file))
  const [west, north] = farOrigin(fp)
  const heights = new HeightGrid(west, north, fp.far.res_m, fp.far.width, fp.far.height, decodeHeights(farBuf, fp.far.width, fp.far.height, codecOf(fp)))
  const eqc = parseEqc(fp.chunk_grid.crs)
  const elev = sampleElevation(grid, heights, (lon, lat) => lonLatToXY(eqc, lon, lat))
  return { grid, elev, resM: grid.resM, elevationResM: fp.far.res_m }
}

let cached: Promise<ReliefSource> | null = null
/** Once per session; a failed load is retried on the next call. */
export function loadReliefSource(): Promise<ReliefSource> {
  if (!cached) {
    const p = load()
    cached = p
    p.catch(() => cached === p && (cached = null))
  }
  return cached
}
