// V1 (D141, 3D far field): known-answer tests for the pure pieces (tile routing, Terrarium upsampling,
// pitch cap, flythrough preload tile list). Written before farfield.ts.
import { describe, expect, it } from 'vitest'
import { FAR_FIELD, farDemSource, pathTiles, pitchCap, routeDemTile, tileRange, upsampleTerrarium, type TileSet } from './farfield'
import { terrariumHeight, tilePixel } from './tiles'

// the published tile sets (web/public/data/terrain{,_low}/tiles.json): planning extent and Gale
const NEAR: TileSet = { minzoom: 10, maxzoom: 15, bounds: [137.319359, -4.868422, 137.444641, -4.743578] }
const FAR: TileSet = { minzoom: 6, maxzoom: 10, bounds: [136.5078, -6.219757, 138.800732, -4.0675] }
const PAD: [number, number] = [137.3826, -4.8062]

describe('tileRange', () => {
  it('matches the published tile counts of terrain/ (z10..15) and terrain_low/ (z6..10)', () => {
    const count = (ts: TileSet, z: number): number => {
      const r = tileRange(ts.bounds, z)
      return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)
    }
    // tile_count in terrain/tiles.json and terrain_low/tiles.json
    expect([10, 11, 12, 13, 14, 15].map((z) => count(NEAR, z))).toEqual([1, 1, 4, 12, 42, 144])
    expect([6, 7, 8, 9, 10].map((z) => count(FAR, z))).toEqual([2, 4, 6, 16, 49])
  })
})

describe('routeDemTile', () => {
  it('serves the planning-extent tiles from terrain/ wherever they exist (z10..15)', () => {
    for (const z of [10, 12, 15]) {
      const { x, y } = tilePixel(PAD[0], PAD[1], z)
      expect(routeDemTile(NEAR, FAR, z, x, y)).toEqual({ kind: 'near', z, x, y })
    }
  })
  it('serves Gale outside the planning extent from terrain_low/ up to its finest zoom', () => {
    const far = tilePixel(137.0, -5.5, 9)
    expect(routeDemTile(NEAR, FAR, 9, far.x, far.y)).toEqual({ kind: 'far', z: 9, x: far.x, y: far.y })
    const z10 = tilePixel(138.2, -5.0, 10)
    expect(routeDemTile(NEAR, FAR, 10, z10.x, z10.y)).toEqual({ kind: 'far', z: 10, x: z10.x, y: z10.y })
  })
  it('upsamples a terrain_low z10 tile for a finer tile outside the planning extent', () => {
    const t = tilePixel(138.2, -5.0, 13)
    const r = routeDemTile(NEAR, FAR, 13, t.x, t.y)
    expect(r).toMatchObject({ kind: 'up', z: 10, x: t.x >> 3, y: t.y >> 3, scale: 8 })
    if (r?.kind !== 'up') throw new Error('want up')
    expect(r.ox).toBe((t.x - ((t.x >> 3) << 3)) * 32)
    expect(r.oy).toBe((t.y - ((t.y >> 3) << 3)) * 32)
  })
  it('has nothing below terrain_low or outside Gale', () => {
    expect(routeDemTile(NEAR, FAR, 5, 0, 0)).toBeNull()
    const out = tilePixel(140, 0, 9)
    expect(routeDemTile(NEAR, FAR, 9, out.x, out.y)).toBeNull()
  })
})

describe('farDemSource', () => {
  it('one raster-dem source from the low pyramid up to the planning extent, on the Gale bounds', () => {
    const s = farDemSource(NEAR, FAR, 'hl-dem')
    expect(s).toMatchObject({ type: 'raster-dem', encoding: 'terrarium', tileSize: 256, minzoom: FAR_FIELD.demMinzoom, maxzoom: 15, bounds: FAR.bounds })
    expect(s.tiles).toEqual(['hl-dem://{z}/{x}/{y}'])
  })
})

describe('upsampleTerrarium', () => {
  const enc = (h: number): [number, number, number] => {
    const v = h + 32768
    return [Math.floor(v / 256), Math.floor(v) % 256, Math.floor((v - Math.floor(v)) * 256)]
  }
  const tile = (f: (i: number, j: number) => number, px = 4): Uint8ClampedArray => {
    const d = new Uint8ClampedArray(px * px * 4)
    for (let i = 0; i < px; i++)
      for (let j = 0; j < px; j++) {
        const [r, g, b] = enc(f(i, j))
        d.set([r, g, b, 255], (i * px + j) * 4)
      }
    return d
  }
  const h = (d: Uint8ClampedArray, px: number, i: number, j: number): number => {
    const k = (i * px + j) * 4
    return terrariumHeight(d[k], d[k + 1], d[k + 2])
  }
  it('keeps a constant height exactly', () => {
    const out = upsampleTerrarium(tile(() => -1234.5), 4, 2, 0, 2)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) expect(h(out, 4, i, j)).toBeCloseTo(-1234.5, 2)
    expect(out[3]).toBe(255)
  })
  it('interpolates heights (not the encoded bytes) across a Terrarium byte boundary', () => {
    // west-east ramp 250, 260, 270, 280 m: crosses G = 255 -> 0 (bilinear on bytes would jump)
    const src = tile((_i, j) => 250 + 10 * j)
    const out = upsampleTerrarium(src, 4, 0, 0, 2) // the north-west quarter, 2x
    // output column j centre in source pixels: (j + 0.5) / 2 - 0.5 -> -0.25 (clamped 0), 0.25, 0.75, 1.25
    expect(h(out, 4, 0, 0)).toBeCloseTo(250, 1)
    expect(h(out, 4, 0, 1)).toBeCloseTo(252.5, 1)
    expect(h(out, 4, 0, 2)).toBeCloseTo(257.5, 1)
    expect(h(out, 4, 0, 3)).toBeCloseTo(262.5, 1)
  })
})

describe('pitchCap (manual 3D tilt by camera height)', () => {
  const c = { zoomLow: 11, pitchLow: 40, zoomFull: 14, pitchFull: 60 }
  it('full cap close in, low cap high up, linear between', () => {
    expect(pitchCap(16, c)).toBe(60)
    expect(pitchCap(14, c)).toBe(60)
    expect(pitchCap(11, c)).toBe(40)
    expect(pitchCap(8, c)).toBe(40)
    expect(pitchCap(12.5, c)).toBeCloseTo(50, 6)
  })
  it('never above the terrain_3d max pitch, and the config values hold together', () => {
    const p = FAR_FIELD.pitchCap
    expect(p.pitchLow).toBeLessThanOrEqual(p.pitchFull)
    expect(p.zoomLow).toBeLessThan(p.zoomFull)
    for (let z = 0; z <= 22; z += 0.5) expect(pitchCap(z, p)).toBeLessThanOrEqual(p.pitchFull)
  })
  it('the flythrough chase pitch (camera.flythrough.max_pitch_deg 55) is allowed at the flight zooms', () => {
    expect(pitchCap(15, FAR_FIELD.pitchCap)).toBeGreaterThanOrEqual(55)
  })
})

describe('pathTiles (flythrough preload list)', () => {
  const metric = { mPerDegLat: 59275, mPerDegLon: 59066 } // Mars at -4.8 deg (3389.5 km)
  it('covers the start and end of the route, every requested zoom, no duplicates', () => {
    const pts: [number, number][] = [PAD, [PAD[0] + 0.02, PAD[1] + 0.01]]
    const ts = pathTiles(pts, [15, 13], { radiusM: 250, stepM: 80, maxTiles: 1000 }, metric)
    const keys = ts.map((t) => `${t.z}/${t.x}/${t.y}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of pts)
      for (const z of [13, 15]) {
        const t = tilePixel(p[0], p[1], z)
        expect(keys).toContain(`${z}/${t.x}/${t.y}`)
      }
    expect(new Set(ts.map((t) => t.z))).toEqual(new Set([13, 15]))
  })
  it('lists tiles in route order (the first tiles are at the start) and stops at maxTiles', () => {
    const pts: [number, number][] = [PAD, [PAD[0] + 0.03, PAD[1]]]
    const ts = pathTiles(pts, [15], { radiusM: 100, stepM: 50, maxTiles: 5 }, metric)
    expect(ts).toHaveLength(5)
    const start = tilePixel(PAD[0], PAD[1], 15)
    expect(ts[0]).toEqual({ z: 15, x: start.x, y: start.y })
    const xs = pathTiles(pts, [15], { radiusM: 0, stepM: 50, maxTiles: 1000 }, metric).map((t) => t.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })
  it('a filter drops tiles outside a tile set', () => {
    const ts = pathTiles([PAD], [15], { radiusM: 5000, stepM: 50, maxTiles: 10000 }, metric, (z, x, y) => {
      const r = tileRange(NEAR.bounds, z)
      return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
    })
    expect(ts.length).toBeLessThanOrEqual(144)
    expect(ts.length).toBeGreaterThan(0)
  })
  it('an empty route lists nothing', () => {
    expect(pathTiles([], [15], { radiusM: 250, stepM: 80, maxTiles: 10 }, metric)).toEqual([])
  })
})

describe('interleave (preload order)', () => {
  it('alternates the tile lists so neither waits for the other', async () => {
    const { interleave } = await import('./preload')
    expect(interleave([1, 2, 3], [10], [])).toEqual([1, 10, 2, 3])
    expect(interleave<number>()).toEqual([])
  })
})
