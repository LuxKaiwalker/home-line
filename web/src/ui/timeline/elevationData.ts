// PORT F15: terrain heights for the user replay's elevation profile, as main's mission/data.ts reads
// them: fp3d/index.json + fp3d/far.f32.gz (WS8, 8 m, built from WS1's 1 m DEM where it exists),
// sampled bilinearly. Loaded lazily, once, only when a user replay is loaded (never at start-up).
import { dataUrl } from '../../env'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, parseIndex } from '../../fp3d/format'
import { lonLatToXY, parseEqc } from '../../fp3d/geo'
import { HeightGrid } from '../../fp3d/terrain'
import type { HeightAt } from './elevation'

export interface HeightSampler {
  heightAt: HeightAt
  /** the far grid's resolution (m), main's `elevationResM` */
  resM: number
  /** file the heights came from */
  file: string
}

/** A sampler from the parsed fp3d/index.json and the (gunzipped) far height buffer. */
export function heightSamplerFrom(indexJson: unknown, farBuf: ArrayBuffer): HeightSampler {
  const fp = parseIndex(indexJson)
  const [west, north] = farOrigin(fp)
  const heights = new HeightGrid(west, north, fp.far.res_m, fp.far.width, fp.far.height, decodeHeights(farBuf, fp.far.width, fp.far.height, codecOf(fp)))
  const eqc = parseEqc(fp.chunk_grid.crs)
  return {
    resM: fp.far.res_m,
    file: fp.far.file,
    heightAt: (lon, lat) => {
      const [x, y] = lonLatToXY(eqc, lon, lat)
      return { x, y, z: heights.bilinear(x, y) }
    },
  }
}

async function fetchBuf(path: string): Promise<ArrayBuffer> {
  const res = await fetch(dataUrl(path))
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.arrayBuffer()
}

let pending: Promise<HeightSampler | null> | null = null

/** The terrain heights (memoised); null when the files are missing (no profile: unknown stays unknown). */
export function loadHeightSampler(): Promise<HeightSampler | null> {
  pending ??= (async () => {
    try {
      const fp = JSON.parse(new TextDecoder().decode(await fetchBuf('fp3d/index.json')))
      const far = await gunzipIfNeeded(await fetchBuf(parseIndex(fp).far.file))
      return heightSamplerFrom(fp, far)
    } catch {
      pending = null
      return null
    }
  })()
  return pending
}
