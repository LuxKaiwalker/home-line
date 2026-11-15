// V1 (D141): preload the tiles along the flythrough path. When a flight starts (the container's
// data-flythrough="on", set by flythrough/fly.ts), the terrain and HiRISE tiles around the chase
// camera's look-at points are fetched in route order, a few at a time, so MapLibre finds them in the
// HTTP cache when the camera gets there. Stops when the flight ends. Loaded with import() on the first
// flight (not part of the first load).
import { CONFIG } from '../../config'
import { DATA_MODE, dataUrl } from '../../env'
import { FAR_FIELD, inTileSet, pathTiles, tileRange, type TileId, type TileSet } from './farfield'
import { marsMetric } from '../flythrough/camera'
import type { TerrainTiles } from './tiles'

interface BasemapJson {
  tiles: string[]
  minzoom: number
  maxzoom: number
  bounds: [number, number, number, number]
  zoom_bounds?: Record<string, [number, number, number, number]>
}

const range = ([a, b]: readonly [number, number]): number[] => Array.from({ length: b - a + 1 }, (_, i) => b - i) // finest first

const fill = (tpl: string, t: TileId): string => tpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))

/** Interleave lists (a0, b0, a1, b1, …) so neither tile set waits for the other. */
export function interleave<T>(...lists: T[][]): T[] {
  const out: T[] = []
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}

/** Fetch the flight's tiles; returns the stop. Never throws (a failed tile is MapLibre's to fetch). */
export function preloadFlight(near: TerrainTiles, nearTop: number): () => void {
  const ctl = new AbortController()
  void (async () => {
    const { loadFlightPath } = await import('../flythrough/route')
    const fp = await loadFlightPath()
    if (!fp || ctl.signal.aborted) return
    const pts: [number, number][] = []
    for (let t = 0; t <= fp.plan.tEnd; t += 1) {
      const p = fp.poseAt(t).target
      const last = pts[pts.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push([p[0], p[1]])
    }
    if (!pts.length) return
    const metric = marsMetric(pts[0][1], CONFIG.marsRadiusM)
    const pl = FAR_FIELD.preload
    const o = { radiusM: pl.radiusM, stepM: pl.stepM, maxTiles: Math.ceil(pl.maxTiles / 2) }
    const nearSet: TileSet = { minzoom: near.minzoom, maxzoom: nearTop, bounds: near.bounds }
    const dem = pathTiles(pts, range(pl.terrainZooms), o, metric, (z, x, y) => inTileSet(nearSet, z, x, y)).map((t) => dataUrl(fill(near.tiles[0], t), DATA_MODE))
    const bj = (await fetch(dataUrl('tiles/basemap/tilejson.json', DATA_MODE), { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as BasemapJson | null
    const img = bj
      ? pathTiles(pts, range(pl.basemapZooms), o, metric, (z, x, y) => {
          if (z < bj.minzoom || z > bj.maxzoom) return false
          const r = tileRange(bj.zoom_bounds?.[String(z)] ?? bj.bounds, z)
          return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
        }).map((t) => dataUrl(fill(bj.tiles[0], t), DATA_MODE))
      : []
    const queue = interleave(dem, img)
    const worker = async (): Promise<void> => {
      for (let u = queue.shift(); u !== undefined && !ctl.signal.aborted; u = queue.shift()) await fetch(u, { signal: ctl.signal }).then((r) => r.arrayBuffer()).catch(() => undefined)
    }
    await Promise.all(Array.from({ length: pl.concurrency }, worker))
  })().catch(() => undefined)
  return () => ctl.abort()
}
