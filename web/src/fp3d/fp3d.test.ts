// Known-answer tests for the 3D view's pure logic (WS8, F20): config, projection, chunk decode,
// terrain sampling/meshing, camera eye height on the dummy route, path timing, fps fallback.
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { FP3D_CONFIG, buildConfig } from './config'
import { hasWebGL2 } from './fallback'
import { Plan } from '../hud/plan'
import { codecOf, decodeHeights, gunzipIfNeeded, parseIndex, type Fp3dIndex } from './format'
import { FpsWatchdog } from './fps'
import { WS7_PARTNER_KEY, partnerRowLabel, relabelPartnerRow } from './hudOverlay'
import { lonLatToXY, parseEqc, xyToLonLat } from './geo'
import { buildRoute, type TimelineEvent } from './path'
import { HeightGrid, Terrain, cameraPosition, farMesh, gridIndex, nearChunkMesh, triInterp } from './terrain'

const REPO = resolve(__dirname, '../../..')
const DUMMY = resolve(REPO, 'web/public/data-dummy')
const yamlOf = (name: string) => parse(readFileSync(resolve(REPO, 'config', name), 'utf8'))
const readDummy = (p: string) => readFileSync(resolve(DUMMY, p))
const toAB = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
const LE = { byte_order: 'little', row_order: 'north_to_south', scale: 1, offset_m: 0 } as const

function f32le(values: number[], little = true): ArrayBuffer {
  const dv = new DataView(new ArrayBuffer(values.length * 4))
  values.forEach((v, k) => dv.setFloat32(4 * k, v, little))
  return dv.buffer
}

// ------------------------------------------------------------------------------------- config
describe('config', () => {
  it('takes the eye height and fps thresholds from config/hud.yaml', () => {
    const hud = yamlOf('hud.yaml')
    expect(FP3D_CONFIG.eyeHeightM).toBe(hud.eye_height_m)
    expect(FP3D_CONFIG.eyeHeightM).toBe(1.7)
    expect(FP3D_CONFIG.fpsFallbackBelow).toBe(hud.performance.fps_3d_fallback_below)
    expect(FP3D_CONFIG.budget3dMb).toBe(hud.performance.budget_3d_mb)
    expect(FP3D_CONFIG.defaultSpeed).toBe(hud.default_speed)
    expect(FP3D_CONFIG.defaultScenario).toBe(yamlOf('variants.yaml').scenarios.default)
    expect(FP3D_CONFIG.resolutionCaption).toBe('1 m terrain: ridges under ~3 m are not resolved')
  })
  it('throws on a missing value instead of inventing one', () => {
    const hud = { ...yamlOf('hud.yaml') }
    delete hud.eye_height_m
    expect(() => buildConfig(hud, yamlOf('fp3d.yaml'), yamlOf('variants.yaml'), yamlOf('horizon.yaml'), yamlOf('site.yaml'), yamlOf('crew.yaml'))).toThrow(
      /eye_height_m/,
    )
  })
})

// ----------------------------------------------------------------------------------------- geo
describe('geo (eqc from the PROJ string)', () => {
  const site = yamlOf('site.yaml')
  const eqc = parseEqc(site.crs.analysis_proj)
  it('parses the analysis CRS', () => {
    expect(eqc).toEqual({ R: 3396190, latTsDeg: -4.8, lon0Deg: 137.39, lat0Deg: 0, x0: 0, y0: 0 })
  })
  it('puts the pad at the centre of the dummy chunk grid', () => {
    const idx = JSON.parse(readDummy('fp3d/index.json').toString()) as Fp3dIndex
    const g = idx.chunk_grid
    const half = (g.cols * g.chunk_px * g.res_m) / 2
    const [x, y] = lonLatToXY(eqc, site.pad_default.lon, site.pad_default.lat)
    expect(x).toBeCloseTo(g.origin_xy_m[0] + half, 1)
    expect(y).toBeCloseTo(g.origin_xy_m[1] - half, 1)
    expect(g.crs).toBe(site.crs.analysis_proj)
  })
  it('round-trips', () => {
    const [x, y] = lonLatToXY(eqc, 137.401, -4.777)
    const [lon, lat] = xyToLonLat(eqc, x, y)
    expect(lon).toBeCloseTo(137.401, 10)
    expect(lat).toBeCloseTo(-4.777, 10)
  })
  it('matches the dummy chunk bounds (grid alignment)', () => {
    const idx = JSON.parse(readDummy('fp3d/index.json').toString()) as Fp3dIndex
    const g = idx.chunk_grid
    const S = g.chunk_px * g.res_m
    expect(g.chunks.length).toBeGreaterThan(0)
    for (const ch of g.chunks) {
      const w = g.origin_xy_m[0] + ch.i * S
      const n = g.origin_xy_m[1] - ch.j * S
      const [lw, ls] = xyToLonLat(eqc, w, n - S)
      const [le, ln] = xyToLonLat(eqc, w + S, n)
      // origin_xy_m is rounded to 1 cm in the index: < 2e-6 deg
      for (const [a, b] of [
        [lw, ch.bounds[0]],
        [ls, ch.bounds[1]],
        [le, ch.bounds[2]],
        [ln, ch.bounds[3]],
      ]) {
        expect(Math.abs(a - b)).toBeLessThan(2e-6)
      }
    }
  })
})

// -------------------------------------------------------------------------------------- format
describe('format', () => {
  it('decodes little-endian, row 0 north', () => {
    const d = decodeHeights(f32le([1.5, 2, -3.25, 4]), 2, 2, LE)
    expect(Array.from(d)).toEqual([1.5, 2, -3.25, 4])
  })
  it('honours byte order, row order, scale and offset from the index', () => {
    const d = decodeHeights(f32le([1, 2, 3, 4], false), 2, 2, {
      byte_order: 'big',
      row_order: 'south_to_north',
      scale: 2,
      offset_m: -10,
    })
    expect(Array.from(d)).toEqual([-4, -2, -8, -6])
  })
  it('refuses a wrong size', () => {
    expect(() => decodeHeights(new ArrayBuffer(12), 2, 2, LE)).toThrow(/expected 16 bytes/)
  })
  it('gunzips only gzip data', async () => {
    const raw = f32le([7, 8])
    expect(await gunzipIfNeeded(raw)).toBe(raw)
    const gz = toAB(gzipSync(new Uint8Array(raw)))
    expect(Array.from(new Float32Array(await gunzipIfNeeded(gz)))).toEqual([7, 8])
  })
  it('parses the dummy index', () => {
    const idx = parseIndex(JSON.parse(readDummy('fp3d/index.json').toString()))
    expect(idx.dummy).toBe(true)
    expect(idx.chunk_grid.chunk_px).toBe(256)
    expect(idx.height_scale).toBe(1)
    expect(idx.far.width * idx.far.res_m).toBe(idx.chunk_grid.cols * idx.chunk_grid.chunk_px * idx.chunk_grid.res_m)
    expect(() => parseIndex({ dummy: true })).toThrow()
  })
  it('decodes a dummy chunk to 256 x 256 finite heights', async () => {
    const buf = await gunzipIfNeeded(toAB(readDummy('fp3d/near/14_14.f32.gz')))
    const d = decodeHeights(buf, 256, 256, LE)
    expect(d.length).toBe(65536)
    expect(d.every(Number.isFinite)).toBe(true)
  })
})

// ------------------------------------------------------------------------------------- terrain
function planeTerrain(P = 4, n = 3, far = 2) {
  // plane h = 10 + 0.5 x - 0.25 y over a tiny grid; chunk (1, 1) loaded
  const idx = {
    chunk_grid: { origin_xy_m: [0, 100] as [number, number], chunk_px: P, res_m: 1, cols: n, rows: n, chunks: [], crs: '' },
    far: { file: '', res_m: far, width: (n * P) / far, height: (n * P) / far },
  } as unknown as Fp3dIndex
  const h = (x: number, y: number) => 10 + 0.5 * x - 0.25 * y
  const fw = (n * P) / far
  const farData = new Float32Array(fw * fw)
  for (let r = 0; r < fw; r++) for (let c = 0; c < fw; c++) farData[r * fw + c] = h((c + 0.5) * far, 100 - (r + 0.5) * far)
  const t = new Terrain(idx, farData)
  const chunk = new Float32Array(P * P)
  for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) chunk[r * P + c] = h(P + c + 0.5, 100 - P - r - 0.5)
  t.setChunk(1, 1, chunk)
  return { t, h }
}

describe('terrain', () => {
  it('triangle interpolation hits the corners and splits on the NE-SW diagonal', () => {
    expect(triInterp(1, 2, 3, 4, 0, 0)).toBe(1)
    expect(triInterp(1, 2, 3, 4, 1, 0)).toBe(2)
    expect(triInterp(1, 2, 3, 4, 0, 1)).toBe(3)
    expect(triInterp(1, 2, 3, 4, 1, 1)).toBe(4)
    expect(triInterp(0, 0, 0, 1, 0.5, 0.5)).toBe(0) // on the diagonal: NW triangle
    expect(triInterp(0, 0, 0, 1, 0.6, 0.6)).toBeCloseTo(0.2, 12)
  })
  it('reproduces a plane exactly (near chunk and far fallback)', () => {
    const { t, h } = planeTerrain()
    expect(t.meshChunkAt(6, 94)).toEqual([1, 1])
    expect(t.heightAt(6.3, 93.1)).toBeCloseTo(h(6.3, 93.1), 5)
    expect(t.meshChunkAt(1, 99)).toBeNull()
    expect(t.heightAt(3.0, 97.0)).toBeCloseTo(h(3.0, 97.0), 5) // far triangles
  })
  it('meshes a chunk on its lattice with the seam from the neighbour/far grid', () => {
    const { t, h } = planeTerrain()
    const a = { x: 0, y: 100, h: 0 }
    const m = nearChunkMesh(t, 1, 1, a)
    expect(m.vertsPerSide).toBe(5)
    expect(m.positions.length).toBe(25 * 3)
    // vertex (0,0): lattice (4,4) -> x = 4.5, y = 95.5 -> Three (4.5, h, 4.5)
    expect(m.positions[0]).toBeCloseTo(4.5, 6)
    expect(m.positions[2]).toBeCloseTo(4.5, 6)
    expect(m.positions[1]).toBeCloseTo(h(4.5, 95.5), 5)
    // last vertex: seam column/row (lattice 8,8) from the far grid, still on the plane
    const k = 24 * 3
    expect(m.positions[k]).toBeCloseTo(8.5, 6)
    expect(m.positions[k + 1]).toBeCloseTo(h(8.5, 91.5), 4)
    // plane normal ~ (-hX, 1, hY) normalised with hX = 0.5, hY = -0.25
    const len = Math.hypot(0.5, 1, 0.25)
    expect(m.normals[1 * 3 + 1 + 3 * 5 * 3]).toBeCloseTo(1 / len, 5) // an interior vertex
    expect(m.uvs![0]).toBeCloseTo(0.5 / 4, 9)
    expect(m.uvs![1]).toBeCloseTo(1 - 0.5 / 4, 9)
  })
  it('winds every triangle counter-clockwise seen from above', () => {
    const { t } = planeTerrain()
    const m = nearChunkMesh(t, 1, 1, { x: 0, y: 100, h: 0 })
    const p = m.positions
    for (let k = 0; k < m.index.length; k += 3) {
      const [a, b, c] = [m.index[k], m.index[k + 1], m.index[k + 2]]
      const ux = p[3 * b] - p[3 * a]
      const uz = p[3 * b + 2] - p[3 * a + 2]
      const vx = p[3 * c] - p[3 * a]
      const vz = p[3 * c + 2] - p[3 * a + 2]
      expect(uz * vx - ux * vz).toBeGreaterThan(0) // (u x v).y > 0
    }
    expect(gridIndex(4)).toBe(gridIndex(4)) // cached
  })
  it('maps far_tex.jpg over the whole far square (u east, v north, texel = position)', () => {
    const { t } = planeTerrain(8, 3, 2)
    const g = t.far
    const m = farMesh(t, { x: 0, y: 100, h: 0 }, 1, true)
    const n = m.vertsPerSide
    expect(m.uvs).not.toBeNull()
    expect(m.uvs!.length).toBe(n * n * 2)
    // vertex (r, c) sits at the cell centre (west + (c + .5) res, north - (r + .5) res); u, v are
    // the fractions of the far square (flipY image: v = 1 at the north edge = image row 0)
    for (const [r, c] of [[0, 0], [0, n - 1], [n - 1, 0], [2, 3]]) {
      const k = r * n + c
      const x = m.positions[3 * k] + 0 // anchor x = 0
      const y = 100 - m.positions[3 * k + 2]
      expect(m.uvs![2 * k]).toBeCloseTo((x - g.west) / (g.cols * g.res), 6)
      expect(m.uvs![2 * k + 1]).toBeCloseTo(1 - (g.north - y) / (g.rows * g.res), 6)
    }
    expect(m.uvs![0]).toBeCloseTo(0.5 / g.cols, 6)
    expect(m.uvs![1]).toBeCloseTo(1 - 0.5 / g.rows, 6)
  })
  it('reads the optional far texture keys of the index', () => {
    const idx = JSON.parse(readDummy('fp3d/index.json').toString()) as Fp3dIndex
    expect(parseIndex(idx).far.tex ?? null).toBeNull() // the dummy has none: untextured far mesh
    const withTex = parseIndex({ ...idx, far: { ...idx.far, tex: 'fp3d/far_tex.jpg', tex_bytes: 123 } })
    expect(withTex.far.tex).toBe('fp3d/far_tex.jpg')
    expect(() => parseIndex({ ...idx, far: { ...idx.far, tex: 5 as unknown as string } })).toThrow()
  })
  it('leaves far cells under loaded near chunks out of the far mesh', () => {
    const { t } = planeTerrain(8, 3, 2)
    const all = farMesh(t, { x: 0, y: 100, h: 0 }, 1, false)
    const cut = farMesh(t, { x: 0, y: 100, h: 0 }, 1, true)
    expect(cut.index.length).toBeLessThan(all.index.length)
    expect(cut.index.length % 3).toBe(0)
  })
  it('reads a far grid larger than the chunk grid at its own origin (far.origin_xy_m)', () => {
    // chunk grid 3 x 4 m at (0, 100); far grid 2 m cells over (-8, 108) .. (20, 80)
    const h = (x: number, y: number) => 10 + 0.5 * x - 0.25 * y
    const fw = 14
    const farData = new Float32Array(fw * fw)
    for (let r = 0; r < fw; r++) for (let c = 0; c < fw; c++) farData[r * fw + c] = h(-8 + (c + 0.5) * 2, 108 - (r + 0.5) * 2)
    const idx = {
      chunk_grid: { origin_xy_m: [0, 100] as [number, number], chunk_px: 4, res_m: 1, cols: 3, rows: 3, chunks: [], crs: '' },
      far: { file: '', res_m: 2, width: fw, height: fw, origin_xy_m: [-8, 108] as [number, number] },
    } as unknown as Fp3dIndex
    const t = new Terrain(idx, farData)
    expect(t.far.west).toBe(-8)
    expect(t.far.north).toBe(108)
    expect(t.heightAt(-5.3, 104.1)).toBeCloseTo(h(-5.3, 104.1), 5) // outside the chunk grid
    expect(t.heightAt(6.2, 95.7)).toBeCloseTo(h(6.2, 95.7), 5)
    expect(t.x0).toBe(0) // near lattice unchanged
  })
  it('HeightGrid bilinear clamps at the edges', () => {
    const g = new HeightGrid(0, 2, 1, 2, 2, Float32Array.from([1, 2, 3, 4]))
    expect(g.bilinear(0.5, 1.5)).toBe(1)
    expect(g.bilinear(1, 1)).toBe(2.5)
    expect(g.bilinear(-50, 50)).toBe(1)
  })
})

// --------------------------------------------------------------------------------------- path
describe('path', () => {
  const eqc = parseEqc('+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs')
  const deg = (m: number) => (m / 3396190) * (180 / Math.PI)
  const fcDummy = {
    features: [
      { geometry: { type: 'LineString', coordinates: [[0, 0], [deg(100), 0]] }, properties: { from: 'pad', to: 'S1', t_start_min: 0, t_end_min: 10 } },
      { geometry: { type: 'LineString', coordinates: [[deg(100), 0], [deg(100), deg(50)]] }, properties: { from: 'S1', to: 'pad', t_start_min: 40, t_end_min: 45 } },
    ],
  }
  it('moves at constant speed along a leg and dwells between legs', () => {
    const r = buildRoute(fcDummy, null, eqc, 15)
    expect(r.startMin).toBe(0)
    expect(r.endMin).toBe(45)
    const mid = r.poseAt(5)
    expect(mid.x).toBeCloseTo(50, 6)
    expect(mid.y).toBeCloseTo(0, 6)
    expect(mid.headingDeg).toBeCloseTo(90, 6) // east
    const dwell = r.poseAt(25)
    expect(dwell.x).toBeCloseTo(100, 6)
    expect(dwell.dwellAt).toBe('S1')
    expect(dwell.headingDeg).toBeCloseTo(0, 6) // looking along the next leg (north)
    const end = r.poseAt(99)
    expect(end.y).toBeCloseTo(50, 6)
    expect(end.headingDeg).toBeCloseTo(0, 6)
    expect(r.lengthM).toBeCloseTo(150, 6)
  })
  it('takes WS2 leg durations (t_min) with dwell from the timeline', () => {
    const fc = {
      features: fcDummy.features.map((f, k) => ({ ...f, properties: { from: f.properties.from, to: f.properties.to, t_min: k ? 5 : 10 } })),
    }
    const tl: TimelineEvent[] = [
      { t_min: 0, event: 'depart', station: null },
      { t_min: 10, event: 'arrive', station: 'S1' },
      { t_min: 40, event: 'leave', station: 'S1' },
      { t_min: 45, event: 'return', station: null },
    ]
    const r = buildRoute(fc, tl, eqc, 15)
    expect(r.legs.map((l) => [l.t0, l.t1])).toEqual([
      [0, 10],
      [40, 45],
    ])
  })
  it('uses per-vertex times_min (route contract v1.1.0) when present', () => {
    const fc = {
      features: [
        {
          geometry: { type: 'LineString', coordinates: [[0, 0], [deg(100), 0], [deg(200), 0]] },
          // first 100 m in 2 min, next 100 m in 8 min: not constant speed
          properties: { from: 'pad', to: 'S1', t_start_min: 0, t_end_min: 10, times_min: [0, 2, 10] },
        },
      ],
    }
    const r = buildRoute(fc, null, eqc, 15)
    expect(r.poseAt(1).x).toBeCloseTo(50, 6)
    expect(r.poseAt(2).x).toBeCloseTo(100, 6)
    expect(r.poseAt(6).x).toBeCloseTo(150, 6)
    // malformed times_min (wrong length) falls back to constant speed
    const bad = { features: [{ ...fc.features[0], properties: { ...fc.features[0].properties, times_min: [0, 10] } }] }
    expect(buildRoute(bad, null, eqc, 15).poseAt(5).x).toBeCloseTo(100, 6)
  })
  it('refuses legs without times', () => {
    const fc = { features: [{ geometry: fcDummy.features[0].geometry, properties: {} }] }
    expect(() => buildRoute(fc, null, eqc, 15)).toThrow(/start\/end time/)
  })
})

// ------------------------------------- eye height along the route (brief WS8 Tests, SPEC F20)
function eyeHeightCheck(fp3dRoot: string, routePath: string, timelinePath: string | null) {
  const read = (p: string) => readFileSync(resolve(fp3dRoot, p))
  const idx = parseIndex(JSON.parse(read('fp3d/index.json').toString()))
  const codec = codecOf(idx)
  const far = decodeHeights(toAB(gunzipSync(read(idx.far.file))), idx.far.width, idx.far.height, codec)
  const t = new Terrain(idx, far)
  const P = idx.chunk_grid.chunk_px
  for (const ch of idx.chunk_grid.chunks) t.setChunk(ch.i, ch.j, decodeHeights(toAB(gunzipSync(read(ch.file))), P, P, codec))
  const eqc = parseEqc(idx.chunk_grid.crs)
  const route = buildRoute(
    JSON.parse(readFileSync(routePath).toString()),
    timelinePath && existsSync(timelinePath) ? JSON.parse(readFileSync(timelinePath).toString()) : null,
    eqc,
    FP3D_CONFIG.lookAheadM,
  )
  const start = route.poseAt(route.startMin)
  const anchor = { x: start.x, y: start.y, h: t.heightAt(start.x, start.y) }
  const meshes = new Map<string, ReturnType<typeof nearChunkMesh>>()
  const eye = FP3D_CONFIG.eyeHeightM
  let worst = 0
  let n = 0
  let offNear = 0
  const check = (x: number, y: number) => {
    const owner = t.meshChunkAt(x, y)
    if (!owner) {
      offNear++ // the whole route must be on near chunks (asserted below)
      return
    }
    const [i, j] = owner
    const key = `${i}_${j}`
    if (!meshes.has(key)) meshes.set(key, nearChunkMesh(t, i, j, anchor))
    const m = meshes.get(key)!
    // locate the triangle in the mesh arrays and interpolate its vertex heights
    const u = (x - t.x0) / t.res - 0.5 - i * P
    const v = (t.y0 - y) / t.res - 0.5 - j * P
    const c = Math.floor(u)
    const r = Math.floor(v)
    const nv = m.vertsPerSide
    const hy = (rr: number, cc: number) => m.positions[3 * (rr * nv + cc) + 1]
    const meshY = triInterp(hy(r, c), hy(r, c + 1), hy(r + 1, c), hy(r + 1, c + 1), u - c, v - r)
    const cam = cameraPosition(t, anchor, x, y, eye)
    worst = Math.max(worst, Math.abs(cam[1] - meshY - eye))
    n++
  }
  for (const [x, y] of route.samples(1)) check(x, y)
  for (let tm = route.startMin; tm <= route.endMin; tm += 0.5) {
    const p = route.poseAt(tm)
    check(p.x, p.y)
  }
  return { n, worst, offNear, lengthM: route.lengthM }
}

describe('camera on the route: 1.7 +- 0.1 m above the drawn mesh', () => {
  it('dummy route', () => {
    const r = eyeHeightCheck(DUMMY, resolve(DUMMY, 'route_nom_104.geojson'), resolve(DUMMY, 'timeline_nom_104.json'))
    expect(r.offNear).toBe(0)
    expect(r.n).toBeGreaterThan(5000)
    expect(r.worst).toBeLessThanOrEqual(0.1)
    expect(r.worst).toBeLessThan(1e-3) // camera and mesh share one surface (float32 vertices)
  })
  // real data: the exporter output + WS2 route before make web, else the public tree
  const real = [
    [resolve(REPO, 'data/interim/export'), resolve(REPO, 'data/interim/engine/public')],
    [resolve(REPO, 'web/public/data'), resolve(REPO, 'web/public/data')],
  ].find(([f, r]) => existsSync(resolve(f, 'fp3d/index.json')) && existsSync(resolve(r, 'route_nom_104.geojson')))
  it.skipIf(!real)('real route (nom_104)', () => {
    const [f, r] = real!
    const res = eyeHeightCheck(f, resolve(r, 'route_nom_104.geojson'), resolve(r, 'timeline_nom_104.json'))
    console.log(`[F20 eye height, real] ${res.n} points over ${Math.round(res.lengthM)} m, max |agl - eye| ${res.worst.toExponential(2)} m`)
    expect(res.offNear).toBe(0)
    expect(res.n).toBeGreaterThan(5000)
    expect(res.worst).toBeLessThanOrEqual(0.1)
  })
})

// -------------------- same position object as the 2D HUD (SPEC F20: same clock and position)
function cameraVsHudPosition(dir: string) {
  const eqc = parseEqc(yamlOf('site.yaml').crs.analysis_proj)
  const route = JSON.parse(readFileSync(resolve(dir, 'route_nom_104.geojson')).toString())
  const timeline = JSON.parse(readFileSync(resolve(dir, 'timeline_nom_104.json')).toString())
  const mine = buildRoute(route, timeline, eqc, FP3D_CONFIG.lookAheadM)
  const mLat = (eqc.R * Math.PI) / 180
  const plan = new Plan(route, timeline, { mPerDegLat: mLat, mPerDegLon: mLat * Math.cos((eqc.latTsDeg * Math.PI) / 180) })
  let worst = 0
  let n = 0
  for (let t = 0; t <= plan.tEnd; t += 0.25) {
    const p = mine.poseAt(t)
    const st = plan.stateAt(t)
    const [x, y] = lonLatToXY(eqc, st.lon, st.lat)
    worst = Math.max(worst, Math.hypot(p.x - x, p.y - y))
    n++
  }
  return { worst, n }
}

describe('camera position = WS7 HUD playback position at every clock time', () => {
  it('dummy route', () => {
    const r = cameraVsHudPosition(DUMMY)
    expect(r.n).toBeGreaterThan(500)
    expect(r.worst).toBeLessThan(0.01)
  })
  const realDir = [resolve(REPO, 'web/public/data'), resolve(REPO, 'data/interim/engine/public')].find((d) =>
    existsSync(resolve(d, 'route_nom_104.geojson')),
  )
  it.skipIf(!realDir)('real route (nom_104)', () => {
    const r = cameraVsHudPosition(realDir!)
    console.log(`[F20 camera vs HUD position, real] ${r.n} times, max ${r.worst.toExponential(2)} m`)
    expect(r.worst).toBeLessThan(0.01)
  })
})

// ---------------------------------------------------------------------------------- fps, clock
describe('fps watchdog', () => {
  const run = (fps: number, seconds: number, wd: FpsWatchdog, t0 = 0) => {
    let last = { fps: null as number | null, fallback: false }
    const dt = 1000 / fps
    let t = t0
    for (; t <= t0 + seconds * 1000; t += dt) last = wd.frame(t)
    return { last, t }
  }
  const cfg = { belowFps: FP3D_CONFIG.fpsFallbackBelow, windowS: 5, warmupS: 3 }
  it('never trips at 60 fps', () => {
    const { last } = run(60, 30, new FpsWatchdog(cfg))
    expect(last.fallback).toBe(false)
  })
  it('trips when the rate stays under the threshold for the window', () => {
    const wd = new FpsWatchdog(cfg)
    expect(run(10, 7, wd).last.fallback).toBe(false) // warm-up 3 s + < 5 s low
    expect(run(10, 3, wd, 7100).last.fallback).toBe(true)
  })
  it('a short dip does not trip it, nor does a paused tab', () => {
    const wd = new FpsWatchdog(cfg)
    let t = run(60, 5, wd).t
    t = run(10, 3, wd, t).t
    t = run(60, 3, wd, t).t
    // tab hidden for a minute (the view signals the resume), then 60 fps again
    wd.frame(t + 60000, true)
    expect(run(60, 10, wd, t + 60000 + 16).last.fallback).toBe(false)
  })
  it('trips on a machine slower than one frame per second (gaps are not pauses)', () => {
    const wd = new FpsWatchdog(cfg)
    expect(run(0.7, 12, wd).last.fallback).toBe(true)
  })
  it('reports fps once per second', () => {
    const wd = new FpsWatchdog(cfg)
    run(50, 2.5, wd)
    expect(wd.lastFps).toBeCloseTo(50, 0)
  })
})

describe('playback clock (shared with WS7, F18)', () => {
  it('uses the HUD clock length and speeds', () => {
    expect(FP3D_CONFIG.evaMin).toBe(yamlOf('crew.yaml').eva_h * 60)
    expect(FP3D_CONFIG.playbackSpeeds).toEqual(yamlOf('hud.yaml').playback_speeds)
  })
})

describe('fallback', () => {
  const canvas = (ctx: unknown) => () => ({ getContext: () => ctx }) as unknown as HTMLCanvasElement
  it('detects WebGL2', () => {
    expect(hasWebGL2(canvas(null))).toBe(false)
    expect(hasWebGL2(canvas({ getExtension: () => null }))).toBe(true)
    expect(
      hasWebGL2(() => {
        throw new Error('no canvas')
      }),
    ).toBe(false)
  })
})

// ------------------------------------------------------------------- HUD over the 3D view
describe('3D HUD labels (D19, D20)', () => {
  const feat = (props: Record<string, unknown>) => ({ type: 'Feature' as const, properties: props, geometry: { type: 'Polygon' as const, coordinates: [] } })
  const fc = (...p: Record<string, unknown>[]) => ({ type: 'FeatureCollection' as const, features: p.map(feat) })
  it('labels the partner row "Partner line (cart haul, 60 min)" from the partner file (D20)', () => {
    const cartDrag = fc({ case: 'cart', contour_min: 60 }, { case: 'drag', contour_min: 60 }, { case: 'cart', contour_min: 60 })
    expect(partnerRowLabel(cartDrag)).toBe('Partner line (cart haul, 60 min)')
    expect(partnerRowLabel(fc({ case: 'cart', contour_min: 45 }))).toBe('Partner line (cart haul, 45 min)')
    // no cart line, two cart contours or no file: nothing invented, WS7's label stays
    expect(partnerRowLabel(fc({ case: 'drag', contour_min: 60 }))).toBeNull()
    expect(partnerRowLabel(fc({ case: 'cart', contour_min: 60 }, { case: 'cart', contour_min: 90 }))).toBeNull()
    expect(partnerRowLabel(fc({ case: 'cart' }))).toBeNull()
    expect(partnerRowLabel(null)).toBeNull()
  })
  it('relabels only WS7\'s partner key in the mounted panel', () => {
    const keys = [{ textContent: 'NEXT STATION' }, { textContent: WS7_PARTNER_KEY }, { textContent: 'DOSE RATE' }]
    const root = { querySelectorAll: (sel: string) => (sel === '.hl-hud-k' ? keys : []) }
    expect(relabelPartnerRow(root, 'Partner line (cart haul, 60 min)')).toBe(true)
    expect(keys.map((k) => k.textContent)).toEqual(['NEXT STATION', 'Partner line (cart haul, 60 min)', 'DOSE RATE'])
    expect(relabelPartnerRow(root, 'x')).toBe(false) // WS7 key gone (already relabelled / renamed upstream)
    expect(relabelPartnerRow(root, null)).toBe(false)
  })
  it('runs the HUD frame without WS9 navigation: F19 circle, no F21 ellipse or Odometry line (D19)', () => {
    const src = readFileSync(resolve(__dirname, 'hudOverlay.ts'), 'utf8')
    expect(src).toMatch(/hud\.hudFrame\([^)]*\), data\.ctx, null\)/)
    expect(src).toMatch(/minimap: null/)
  })
})
