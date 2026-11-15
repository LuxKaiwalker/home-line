// V1 (D141): the 3D far-field DEM as a MapLibre protocol (`hl-dem://{z}/{x}/{y}`). Each tile is read
// from terrain/ (planning extent), terrain_low/ (Gale), or upsampled from terrain_low's finest zoom
// (farfield.ts routeDemTile). Loaded with terrain.ts (import() on the first 3D), main thread.
import { addProtocol, removeProtocol } from 'maplibre-gl'
import { routeDemTile, tileRange, upsampleTerrarium, type TileSet } from './farfield'
import { terrariumHeight } from './tiles'

export const DEM_PROTOCOL = 'hl-dem'

export interface DemTileUrls {
  near: TileSet
  far: TileSet
  /** URL of tile z/x/y of terrain/ */
  nearUrl(z: number, x: number, y: number): string
  /** URL of tile z/x/y of terrain_low/ */
  farUrl(z: number, x: number, y: number): string
}

/** Decoded far tiles kept for upsampling (a pitched view asks for many children of a few z10 tiles). */
const DECODED_MAX = 24

export async function decode(buf: ArrayBuffer): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('hl-dem: no 2d context')
  g.drawImage(bmp, 0, 0)
  bmp.close()
  return g.getImageData(0, 0, c.width, c.height).data
}

/** Register the protocol; returns the uninstall. One registration per page (the last call wins). */
export function installDemProtocol(u: DemTileUrls): () => void {
  const decoded = new Map<string, Promise<Uint8ClampedArray>>()
  const parent = (z: number, x: number, y: number): Promise<Uint8ClampedArray> => {
    const key = `${z}/${x}/${y}`
    let p = decoded.get(key)
    if (p) {
      decoded.delete(key)
      decoded.set(key, p) // most recent last
      return p
    }
    p = fetch(u.farUrl(z, x, y))
      .then((r) => {
        if (!r.ok) throw new Error(`hl-dem: ${r.status} ${key}`)
        return r.arrayBuffer()
      })
      .then(decode)
    p.catch(() => decoded.delete(key))
    decoded.set(key, p)
    while (decoded.size > DECODED_MAX) decoded.delete(decoded.keys().next().value as string)
    return p
  }
  addProtocol(DEM_PROTOCOL, async (params, abort) => {
    const m = /^[a-z-]+:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url)
    if (!m) throw new Error(`hl-dem: bad url ${params.url}`)
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const r = routeDemTile(u.near, u.far, z, x, y)
    if (!r) return { data: new ArrayBuffer(0) } // empty body: MapLibre's 'tile without content' (outside Gale)
    if (r.kind !== 'up') {
      const res = await fetch(r.kind === 'near' ? u.nearUrl(z, x, y) : u.farUrl(z, x, y), { signal: abort.signal })
      if (!res.ok) throw new Error(`hl-dem: ${res.status} ${z}/${x}/${y}`)
      return { data: await res.arrayBuffer() }
    }
    const src = await parent(r.z, r.x, r.y)
    const px = Math.round(Math.sqrt(src.length / 4))
    const out = upsampleTerrarium(src, px, r.ox * (px / 256), r.oy * (px / 256), r.scale)
    return { data: await createImageBitmap(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, px, px), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) }
  })
  return () => {
    removeProtocol(DEM_PROTOCOL)
    decoded.clear()
  }
}

/**
 * Lowest height (map metres: factor and vertical offset included) in the far set's coarsest tiles: the
 * floor of the 3D camera's far plane (terrain.ts clipFloor). Null when they cannot be read.
 */
export async function lowestFarHeight(u: DemTileUrls): Promise<number | null> {
  const z = u.far.minzoom
  const r = tileRange(u.far.bounds, z)
  let lo = Infinity
  for (let y = r.y0; y <= r.y1; y++)
    for (let x = r.x0; x <= r.x1; x++) {
      const res = await fetch(u.farUrl(z, x, y))
      if (!res.ok) continue
      const d = await decode(await res.arrayBuffer())
      for (let p = 0; p < d.length; p += 4) lo = Math.min(lo, terrariumHeight(d[p], d[p + 1], d[p + 2]))
    }
  return Number.isFinite(lo) ? lo : null
}
