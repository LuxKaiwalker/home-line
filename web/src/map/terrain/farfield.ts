// V1 (D141, team lead 20:07): the 3D far field. Pure pieces, no map, no fetch (tested in node).
//
// Cause (notes in the V1 report, screenshots /tmp/hl-port/v1/): MapLibre 6.18 coveringTiles() picks a
// lower zoom for tiles further from the camera and DROPS every tile whose zoom falls under the
// source's minzoom (`if (it.zoom < minZoom) continue`). The 3D DEM (terrain/, z10-15 on the 7 km
// planning extent) and the HiRISE basemap (z13-18) have no low zooms, so a pitched view had no terrain
// mesh and no imagery along its top edge and corners: missing data, not loading.
// Fix: one raster-dem source for the 3D mesh and the relief shading that reads
//   terrain/      where it has the tile (the measured 1 m DEM; z10-15 on the planning extent),
//   terrain_low/  for the rest of Gale (P2 z6-10, CTX 20 m + MOLA-HRSC 200 m; 17 % edge-extended fill),
//   terrain_low z10 upsampled (bilinear in heights) for finer tiles outside the planning extent,
// served through a MapLibre protocol (protocol.ts), plus sky and horizon fog so the far edge fades, a
// zoom-dependent tilt cap, and a flythrough preload. Both tile sets carry the same factor and vertical
// offset (config/design.yaml terrain_tiles), so the seam has no step. A visual backdrop only: no number
// is read from the far field (the official numbers come from the pipeline, never from the mesh).
import designRaw from '../../../../config/design.yaml'
import type { RasterDEMSourceSpecification } from '@maplibre/maplibre-gl-style-spec'
import { cfg } from '../../config'
import { TERRAIN } from './config'
import { terrariumHeight, tilePixel } from './tiles'

const k = (path: string): number => cfg<number>(designRaw, `terrain_3d.far_field.${path}`)

/** config/design.yaml terrain_3d.far_field (V1, assumed: true). */
export const FAR_FIELD = {
  demMinzoom: k('dem_minzoom'),
  pitchCap: { zoomLow: k('pitch_cap.zoom_low'), pitchLow: k('pitch_cap.pitch_low'), zoomFull: k('pitch_cap.zoom_full'), pitchFull: TERRAIN.maxPitch3d },
  sky: {
    skyHorizonBlend: k('sky.sky_horizon_blend'),
    horizonFogBlend: k('sky.horizon_fog_blend'),
    fogGroundBlend: k('sky.fog_ground_blend'),
    atmosphereBlend: k('sky.atmosphere_blend'),
  },
  preload: {
    terrainZooms: cfg<[number, number]>(designRaw, 'terrain_3d.far_field.preload.terrain_zooms'),
    basemapZooms: cfg<[number, number]>(designRaw, 'terrain_3d.far_field.preload.basemap_zooms'),
    radiusM: k('preload.radius_m'),
    stepM: k('preload.step_m'),
    maxTiles: k('preload.max_tiles'),
    concurrency: k('preload.concurrency'),
  },
} as const

/** A tile pyramid: zooms (maxzoom = the finest zoom used) on one bounds box, a tile for every z/x/y in it. */
export interface TileSet {
  minzoom: number
  maxzoom: number
  bounds: [number, number, number, number]
}

/** Inclusive tile index range covering a [w, s, e, n] box at zoom z. */
export function tileRange(b: readonly [number, number, number, number], z: number): { x0: number; x1: number; y0: number; y1: number } {
  const nw = tilePixel(b[0], b[3], z)
  const se = tilePixel(b[2], b[1], z)
  return { x0: nw.x, x1: se.x, y0: nw.y, y1: se.y }
}

export function inTileSet(ts: TileSet, z: number, x: number, y: number): boolean {
  if (z < ts.minzoom || z > ts.maxzoom) return false
  const r = tileRange(ts.bounds, z)
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
}

export type DemRoute =
  | { kind: 'near' | 'far'; z: number; x: number; y: number }
  /** upsample tile (z, x, y) of the far set: the source square starts at pixel (ox, oy), 1/scale tile wide */
  | { kind: 'up'; z: number; x: number; y: number; ox: number; oy: number; scale: number }
  | null

/** Where the DEM tile z/x/y comes from: the planning extent first, then Gale, then Gale upsampled. */
export function routeDemTile(near: TileSet, far: TileSet, z: number, x: number, y: number, px = 256): DemRoute {
  if (inTileSet(near, z, x, y)) return { kind: 'near', z, x, y }
  if (z <= far.maxzoom) return inTileSet(far, z, x, y) ? { kind: 'far', z, x, y } : null
  const d = z - far.maxzoom
  const ax = x >> d
  const ay = y >> d
  if (!inTileSet(far, far.maxzoom, ax, ay)) return null
  const scale = 2 ** d
  return { kind: 'up', z: far.maxzoom, x: ax, y: ay, ox: (x - ax * scale) * (px / scale), oy: (y - ay * scale) * (px / scale), scale }
}

/** The 3D DEM source: one pyramid from far.minzoom (dem_minzoom) to the planning extent's top zoom. */
export function farDemSource(near: TileSet, far: TileSet, protocol: string, attribution?: string): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    encoding: 'terrarium',
    tiles: [`${protocol}://{z}/{x}/{y}`],
    tileSize: 256,
    minzoom: Math.max(FAR_FIELD.demMinzoom, far.minzoom),
    maxzoom: near.maxzoom,
    bounds: far.bounds,
    ...(attribution ? { attribution } : {}),
  }
}

/**
 * Upsample the square (ox, oy) .. + px/scale of a Terrarium tile to a full px × px tile: bilinear in
 * decoded heights (never in the encoded bytes), pixel-is-area, edges clamped. RGBA in and out.
 */
export function upsampleTerrarium(src: Uint8ClampedArray, px: number, ox: number, oy: number, scale: number): Uint8ClampedArray {
  const hs = new Float64Array(px * px)
  for (let p = 0; p < px * px; p++) hs[p] = terrariumHeight(src[p * 4], src[p * 4 + 1], src[p * 4 + 2])
  const out = new Uint8ClampedArray(px * px * 4)
  const clamp = (v: number): number => Math.min(px - 1, Math.max(0, v))
  for (let i = 0; i < px; i++) {
    const v = clamp(oy + (i + 0.5) / scale - 0.5)
    const i0 = Math.floor(v)
    const i1 = Math.min(px - 1, i0 + 1)
    const fv = v - i0
    for (let j = 0; j < px; j++) {
      const u = clamp(ox + (j + 0.5) / scale - 0.5)
      const j0 = Math.floor(u)
      const j1 = Math.min(px - 1, j0 + 1)
      const fu = u - j0
      const top = hs[i0 * px + j0] * (1 - fu) + hs[i0 * px + j1] * fu
      const bot = hs[i1 * px + j0] * (1 - fu) + hs[i1 * px + j1] * fu
      const val = top * (1 - fv) + bot * fv + 32768
      const q = (i * px + j) * 4
      const r = Math.floor(val / 256)
      const g = Math.floor(val) - r * 256
      out[q] = r
      out[q + 1] = g
      out[q + 2] = Math.floor((val - Math.floor(val)) * 256)
      out[q + 3] = 255
    }
  }
  return out
}

/** Manual 3D tilt cap at a zoom: the camera high above the site tilts less (its far edge stays on Gale). */
export function pitchCap(zoom: number, c: { zoomLow: number; pitchLow: number; zoomFull: number; pitchFull: number }): number {
  if (zoom >= c.zoomFull) return c.pitchFull
  if (zoom <= c.zoomLow) return c.pitchLow
  return c.pitchLow + ((zoom - c.zoomLow) / (c.zoomFull - c.zoomLow)) * (c.pitchFull - c.pitchLow)
}

export interface TileId {
  z: number
  x: number
  y: number
}

/**
 * Tiles around a route (lon/lat points), in route order: the route is walked every stepM true metres
 * and each sample adds, per zoom, the tiles of the box radiusM around it. No duplicates; at most maxTiles;
 * `keep` filters (e.g. to the tiles a tile set has).
 */
export function pathTiles(
  points: readonly (readonly [number, number])[],
  zooms: readonly number[],
  o: { radiusM: number; stepM: number; maxTiles: number },
  metric: { mPerDegLat: number; mPerDegLon: number },
  keep?: (z: number, x: number, y: number) => boolean,
): TileId[] {
  const out: TileId[] = []
  const seen = new Set<string>()
  const samples: [number, number][] = []
  points.forEach((p, i) => {
    if (i === 0) return void samples.push([p[0], p[1]])
    const a = points[i - 1]
    const dm = Math.hypot((p[0] - a[0]) * metric.mPerDegLon, (p[1] - a[1]) * metric.mPerDegLat)
    const n = Math.max(1, Math.ceil(dm / Math.max(1, o.stepM)))
    for (let s = 1; s <= n; s++) samples.push([a[0] + ((p[0] - a[0]) * s) / n, a[1] + ((p[1] - a[1]) * s) / n])
  })
  const dLon = o.radiusM / metric.mPerDegLon
  const dLat = o.radiusM / metric.mPerDegLat
  for (const [lon, lat] of samples) {
    for (const z of zooms) {
      // nearest tiles first: the sample's own tile, then the rest of its box
      const own = tilePixel(lon, lat, z)
      const r = tileRange([lon - dLon, lat - dLat, lon + dLon, lat + dLat], z)
      const ids: TileId[] = [{ z, x: own.x, y: own.y }]
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (x !== own.x || y !== own.y) ids.push({ z, x, y })
      for (const t of ids) {
        const key = `${t.z}/${t.x}/${t.y}`
        if (seen.has(key) || (keep && !keep(t.z, t.x, t.y))) continue
        seen.add(key)
        out.push(t)
        if (out.length >= o.maxTiles) return out
      }
    }
  }
  return out
}
