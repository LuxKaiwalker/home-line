// SPEC F20 acceptance (brief WS8 Tests): "the rendered skyline at each station within 0.5 deg of
// the computed horizon", plus KATs for the skyline geometry, the far-skyline ring and the sun
// track reader. The reference horizons for the dummy come from WS3's engine
// (tests/test_fp3d_export.py writes testdata/skyline_check.dummy.json and checks it stays current);
// for real data they are fp3d/index.json "skyline_check" written by the exporter from WS3's
// horizons/{id}.json.
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FP3D_CONFIG } from './config'
import { codecOf, decodeHeights, farOrigin, parseIndex, type Fp3dIndex } from './format'
import { lonLatToXY, parseEqc, type Eqc } from './geo'
import { farCurtains, parseRing, ringCrossings, type MeshSquare } from './ring'
import { DrawnSurface, compareSkylines, renderedSkyline } from './skyline'
import { daylightFactor, formatLmst, parseClockSun, sunAt, sunDirection } from './sun'
import { Terrain } from './terrain'

const REPO = resolve(__dirname, '../../..')
const toAB = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
const R = FP3D_CONFIG.marsRadiusM
const EYE = FP3D_CONFIG.eyeHeightM
const DEG = Math.PI / 180

function loadTerrain(root: string): { idx: Fp3dIndex; t: Terrain } {
  const read = (p: string) => readFileSync(resolve(root, p))
  const idx = parseIndex(JSON.parse(read('fp3d/index.json').toString()))
  const codec = codecOf(idx)
  const far = decodeHeights(toAB(gunzipSync(read(idx.far.file))), idx.far.width, idx.far.height, codec)
  const t = new Terrain(idx, far)
  const P = idx.chunk_grid.chunk_px
  for (const ch of idx.chunk_grid.chunks) t.setChunk(ch.i, ch.j, decodeHeights(toAB(gunzipSync(read(ch.file))), P, P, codec))
  return { idx, t }
}

const squareOf = (idx: Pick<Fp3dIndex, 'chunk_grid' | 'far'>): MeshSquare => {
  const [west, north] = farOrigin(idx)
  return { west, north, size: idx.far.width * idx.far.res_m }
}

interface CheckStation {
  id: string
  x_m: number
  y_m: number
  elevation_deg: (number | null)[]
  /** false: reported, not in the F20 pass rule (C 12:35: no access cell, the camera never stands there) */
  pass_rule?: boolean
  excluded_reason?: string
}
interface SkylineCheck {
  tolerance_deg: number
  az_step_deg: number
  stations: CheckStation[]
}

/** Synthetic index + terrain: far grid only (n x n at res), heights from f(x, y). */
function synthetic(n: number, res: number, f: (x: number, y: number) => number, west = 0, north = 0) {
  const idx = {
    dummy: true,
    bounds: [0, 0, 0, 0],
    height_scale: 1,
    height: { dtype: 'float32', byte_order: 'little', row_order: 'north_to_south', offset_m: 0, units: 'm' },
    chunk_grid: { crs: '+proj=eqc +R=3396190 +units=m', origin_xy_m: [west, north], chunk_px: 4, res_m: 1, cols: 1, rows: 1, chunks: [] },
    far: { file: '', res_m: res, width: n, height: n },
  } as unknown as Fp3dIndex
  const data = new Float32Array(n * n)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) data[r * n + c] = f(west + (c + 0.5) * res, north - (r + 0.5) * res)
  return { idx, t: new Terrain(idx, data) }
}

// ----------------------------------------------------------------------- geometry KATs
describe('rendered skyline geometry', () => {
  it('flat plane: skyline = the mesh edge, below the horizontal by eye height and curvature', () => {
    const { t } = synthetic(101, 8, () => 0)
    const x = 404
    const y = -404 // centre of the 101 x 8 m grid (vertex 50)
    const az = [0, 90, 180, 270]
    const { elevationDeg, zEye } = renderedSkyline(t, null, x, y, az, { eyeHeightM: EYE, radiusM: R })
    expect(zEye).toBeCloseTo(EYE, 6)
    const s = 50 * 8 // to the last vertex
    const want = Math.atan((0 - (s * s) / (2 * R) - EYE) / s) / DEG
    for (const e of elevationDeg) expect(e).toBeCloseTo(want, 6)
  })

  it('finds a sharp ridge between samples exactly (it sits on a lattice vertex)', () => {
    // one raised far vertex row 200 m north of the observer: 20 m high
    const { t } = synthetic(101, 8, (_x, y) => (Math.abs(y - -204) < 1e-6 ? 20 : 0))
    const x = 404
    const y = -404
    const { elevationDeg } = renderedSkyline(t, null, x, y, [0], { eyeHeightM: EYE, radiusM: R })
    const s = 200
    expect(elevationDeg[0]).toBeCloseTo(Math.atan((20 - (s * s) / (2 * R) - EYE) / s) / DEG, 6)
  })

  it('evaluates the drawn near chunk where loaded and the far mesh elsewhere (max where both)', () => {
    const { t } = synthetic(32, 2, () => 5)
    // one near chunk (4 x 4 at 1 m, at 0 m) in the NW corner, far mesh at 2 m and 5 m high
    t.setChunk(0, 0, new Float32Array(16).fill(0))
    const surf = new DrawnSurface(t)
    expect(surf.at(0.7, -0.7)).toBe(0) // near chunk only (outside the far vertex square)
    expect(surf.at(2.2, -1.4)).toBe(0) // far cell with all corners on the chunk: not drawn
    expect(t.heightAt(3.4, -1.4)).toBe(0)
    expect(surf.at(3.4, -1.4)).toBe(5) // far cell drawn there too and higher -> the max is seen
    expect(surf.at(40, -40)).toBe(5) // far mesh only
    expect(surf.at(0.2, -0.2)).toBeNaN() // nothing drawn
  })
})

// ------------------------------------------------------------------------- far-skyline ring
describe('far-skyline ring', () => {
  const eqc: Eqc = parseEqc('+proj=eqc +R=3396190 +units=m')
  const sq: MeshSquare = { west: -1000, north: 1000, size: 2000 }
  const opts = { skirtDeg: FP3D_CONFIG.ring.skirtDeg, maxDistanceRatio: FP3D_CONFIG.ring.maxDistanceRatio }
  // WS3 format (pipeline/horizon/cards.py ring_doc): a rim 15 km away all round, 600 m high
  const n = 360
  const d = 15000
  const z0 = 1.7 // observer eye height on z = 0 ground
  const height = 600
  const el = Math.atan((height - z0 - (d * d) / (2 * R)) / d) / DEG
  const az = Array.from({ length: n }, (_, k) => k)
  const ws3 = {
    observer: { id: 'pad', lon: 0, lat: 0, x: 0, y: 0, eye_height_m: 1.7, z_ground_m: 0, z_eye_m: z0 },
    az_step_deg: 1,
    min_range_m: 3700,
    az_deg: az,
    elev_deg: Array(n).fill(el),
    dist_m: Array(n).fill(d),
    z_m: Array(n).fill(height),
    east_m: az.map((a) => d * Math.sin(a * DEG)),
    north_m: az.map((a) => d * Math.cos(a * DEG)),
  }

  it('places WS3 ring points at their true position beyond the terrain square (closed loop)', () => {
    const c = parseRing(ws3, eqc, sq, opts)
    expect(c.drawn).toBe(360)
    expect(c.covered).toBe(0)
    expect(c.segments).toHaveLength(1)
    expect(c.segments[0]).toHaveLength(361)
    const p = c.segments[0][90]
    expect(p.x).toBeCloseTo(d, 6)
    expect(p.y).toBeCloseTo(0, 6)
    expect(c.bottoms[0][90]).toBeCloseTo(height - d * Math.tan(opts.skirtDeg * DEG), 6)
  })

  it('from the ring observer the rendered ring reproduces the ring elevations', () => {
    const { t } = synthetic(201, 10, () => 0, -1000, 1000)
    const c = parseRing(ws3, eqc, squareOf({ chunk_grid: { origin_xy_m: [-1000, 1000] }, far: { width: 201, res_m: 10 } } as Fp3dIndex), opts)
    const az = Array.from({ length: 36 }, (_, k) => k * 10 + 0.5)
    const { elevationDeg } = renderedSkyline(t, c, 0, 0, az, { eyeHeightM: EYE, radiusM: R })
    // chord between 1-deg ring points sags by d (1 - cos 0.5 deg) = 0.57 m: < 0.003 deg at 15 km
    for (const e of elevationDeg) expect(Math.abs(e - el)).toBeLessThan(0.005)
  })

  it('from 1 km away the ring keeps its true geometry (parallax), not the observer angles', () => {
    const c = parseRing(ws3, eqc, sq, opts)
    const [[s, z]] = ringCrossings(c, 0, -1000, 0) // looking north from 1 km south
    expect(s).toBeCloseTo(16000, -1) // 15 km + 1 km (chord sag < 1 m)
    expect(z).toBeCloseTo(height, 6)
  })

  it('skips points inside the terrain square; joins across distance jumps unless a ratio is set', () => {
    const dist = Array.from({ length: n }, (_, k) => (k < 90 ? 500 : k < 180 ? 15000 : 40000))
    const raw = { ...ws3, dist_m: dist, east_m: undefined, north_m: undefined }
    const broken = parseRing(raw, eqc, sq, { ...opts, maxDistanceRatio: 1.5 })
    expect(broken.covered).toBe(90)
    expect(broken.drawn).toBe(270)
    expect(broken.segments.map((s) => s.length).sort((a, b) => a - b)).toEqual([90, 180])
    expect(FP3D_CONFIG.ring.maxDistanceRatio).toBe(Infinity) // config/fp3d.yaml null
    const joined = parseRing(raw, eqc, sq, opts)
    expect(joined.drawn).toBe(270)
    expect(joined.segments.map((s) => s.length)).toEqual([270])
  })

  it('unknown (null) ring entries break the curtain instead of inventing points', () => {
    const z = ws3.z_m.map((v, k) => (k >= 10 && k < 20 ? null : v))
    const c = parseRing({ ...ws3, z_m: z }, eqc, sq, opts)
    expect(c.drawn).toBe(350)
    expect(c.segments).toHaveLength(1)
    expect(c.segments[0][0].azDeg).toBe(20)
  })

  it('the M0 dummy ring (no distances, within the planning radius) is left to the mesh', () => {
    const root = resolve(REPO, 'web/public/data-dummy')
    const idx = parseIndex(JSON.parse(readFileSync(resolve(root, 'fp3d/index.json')).toString()))
    const raw = JSON.parse(readFileSync(resolve(root, idx.horizon_ring!)).toString())
    const c = parseRing(raw, parseEqc(idx.chunk_grid.crs), squareOf(idx), opts)
    expect(c.segments).toHaveLength(0)
    expect(c.note).toMatch(/inside the terrain extent/)
  })
})

describe('station rings (fp3d/index.json station_rings, WS3 station horizons beyond the far square)', () => {
  const eqc: Eqc = parseEqc('+proj=eqc +R=3396190 +units=m')
  const sq: MeshSquare = { west: -1000, north: 1000, size: 2000 }
  const opts = { skirtDeg: FP3D_CONFIG.ring.skirtDeg, maxDistanceRatio: FP3D_CONFIG.ring.maxDistanceRatio }
  const n = 360
  const pad = {
    observer: { id: 'pad', x: 0, y: 0 },
    az_step_deg: 1,
    elev_deg: Array(n).fill(0.5),
    dist_m: Array(n).fill(15000),
    z_m: Array(n).fill(100),
  }
  // station 1.5 km east of the pad sees a rim 70 km away, 2,000 m high (the pad ring lacks it)
  const sx = 1500
  const d = 70000
  const zEye = 1.7
  const rimZ = 2000
  const stationRing = {
    id: 'S7',
    observer: { x: sx, y: 0 },
    az_step_deg: 1,
    elev_deg: Array.from({ length: n }, (_, k) => (k === 0 ? null : Math.atan((rimZ - zEye - (d * d) / (2 * R)) / d) / DEG)),
    dist_m: Array.from({ length: n }, (_, k) => (k === 0 ? null : d)),
    z_m: Array.from({ length: n }, (_, k) => (k === 0 ? null : rimZ)),
  }
  it('without station rings it is the WS3 ring alone', () => {
    const a = farCurtains(pad, undefined, eqc, sq, opts)!
    const b = parseRing(pad, eqc, sq, opts)
    expect(a.segments).toEqual(b.segments)
    expect(a.drawn).toBe(b.drawn)
    expect(farCurtains(null, undefined, eqc, sq, opts)).toBeNull()
  })
  it('adds every station ring as its own curtain (WS3 ring kept)', () => {
    const c = farCurtains(pad, { rings: [stationRing] }, eqc, sq, opts)!
    expect(c.segments).toHaveLength(2) // closed pad loop + station run (null at az 0 breaks it)
    expect(c.drawn).toBe(360 + 359)
    expect(c.note).toMatch(/1 station ring/)
    // from the station, the rendered skyline at az 90 is the station's own horizon elevation
    const { t } = synthetic(201, 10, () => 0, -1000, 1000)
    const { elevationDeg } = renderedSkyline(t, c, sx, 0, [90, 200], { eyeHeightM: EYE, radiusM: R })
    expect(elevationDeg[0]).toBeCloseTo(stationRing.elev_deg[90]!, 3)
    expect(elevationDeg[1]).toBeCloseTo(stationRing.elev_deg[200]!, 2) // chord sag < 0.01 deg
    // station rings alone (no WS3 ring file) still draw
    expect(farCurtains(null, { rings: [stationRing] }, eqc, sq, opts)!.drawn).toBe(359)
  })
  it('breaks a station ring at a distance jump (no mid-air top edge seen from elsewhere)', () => {
    // S1 on real data: 12.2 km at az 140.75, 7.9 km at az 141; joined, the top edge between them
    // hangs in the air and stood 0.36 deg above the pad's horizon at az 153
    const jump = { ...stationRing, dist_m: stationRing.dist_m.map((v, k) => (v === null ? null : k < 180 ? 70000 : 40000)) }
    const so = { ...opts, stationMaxDistanceRatio: FP3D_CONFIG.ring.stationMaxDistanceRatio }
    expect(FP3D_CONFIG.ring.stationMaxDistanceRatio).toBe(1.25) // config/fp3d.yaml
    const c = farCurtains(null, { rings: [jump] }, eqc, sq, so)!
    expect(c.segments.map((s) => s.length).sort((a, b) => a - b)).toEqual([179, 180])
    // the WS3 ring keeps its own rule (always joined)
    const both = farCurtains({ ...pad, dist_m: pad.dist_m.map((_, k) => (k < 180 ? 15000 : 40000)) }, { rings: [jump] }, eqc, sq, so)!
    expect(both.segments.length).toBe(3)
  })
  it('ignores a malformed station_rings block', () => {
    expect(farCurtains(pad, { rings: 'x' }, eqc, sq, opts)!.segments).toHaveLength(1)
    expect(farCurtains(pad, 42, eqc, sq, opts)!.segments).toHaveLength(1)
  })
})

// --------------------------------------------------------------- SPEC F20 acceptance check
function runCheck(root: string, check: SkylineCheck, label: string) {
  const { idx, t } = loadTerrain(root)
  // WS3 writes the ring; before make web it sits in data/interim/horizon/public/
  const ringPath = idx.horizon_ring
    ? [resolve(root, idx.horizon_ring), resolve(REPO, 'data/interim/horizon/public', idx.horizon_ring)].find((p) => existsSync(p))
    : undefined
  const raw = ringPath ? JSON.parse(readFileSync(ringPath).toString()) : null
  // the same curtains the view draws (view.ts: WS3 pad ring + index station_rings)
  const ring = farCurtains(raw, idx.station_rings, parseEqc(idx.chunk_grid.crs), squareOf(idx), {
    skirtDeg: FP3D_CONFIG.ring.skirtDeg,
    maxDistanceRatio: FP3D_CONFIG.ring.maxDistanceRatio,
    stationMaxDistanceRatio: FP3D_CONFIG.ring.stationMaxDistanceRatio,
  })
  const surf = new DrawnSurface(t)
  const rows: string[] = []
  const results = check.stations.map((st) => {
    const az = st.elevation_deg.map((_, k) => k * check.az_step_deg)
    const r = renderedSkyline(t, ring, st.x_m, st.y_m, az, { eyeHeightM: EYE, radiusM: R }, surf)
    const cmp = compareSkylines(r.elevationDeg, st.elevation_deg, az)
    rows.push(
      `${st.id}: n ${cmp.n}, max |d| ${cmp.maxAbsDeg.toFixed(3)} deg at az ${cmp.atAzDeg}, mean ${cmp.meanAbsDeg.toFixed(3)}, rms ${cmp.rmsDeg.toFixed(3)}`,
    )
    if (st.pass_rule === false) rows[rows.length - 1] += ` (reported, not in the pass rule: ${st.excluded_reason ?? 'excluded'})`
    return { id: st.id, cmp, inRule: st.pass_rule !== false }
  })
  console.log(`[F20 skyline check, ${label}] ring: ${ring?.note ?? 'none'}; tolerance ${check.tolerance_deg} deg\n  ${rows.join('\n  ')}`)
  return results
}

describe('SPEC F20: rendered skyline within 0.5 deg of the computed horizon', () => {
  it('uses the SPEC tolerance from config/fp3d.yaml', () => {
    expect(FP3D_CONFIG.skylineCheck.toleranceDeg).toBe(0.5)
  })

  it('dummy data: every station (and the pad) within tolerance at every azimuth', () => {
    const check = JSON.parse(readFileSync(resolve(__dirname, 'testdata/skyline_check.dummy.json')).toString()) as SkylineCheck
    expect(check.tolerance_deg).toBe(FP3D_CONFIG.skylineCheck.toleranceDeg)
    // the reference stations are the dummy stations.json + pad
    const stations = JSON.parse(readFileSync(resolve(REPO, 'web/public/data-dummy/stations.json')).toString()) as {
      id: string
      lon: number
      lat: number
    }[]
    const eqc = parseEqc(JSON.parse(readFileSync(resolve(REPO, 'web/public/data-dummy/fp3d/index.json')).toString()).chunk_grid.crs)
    for (const s of stations) {
      const ref = check.stations.find((c) => c.id === s.id)!
      const [x, y] = lonLatToXY(eqc, s.lon, s.lat)
      expect(ref.x_m).toBeCloseTo(x, 1)
      expect(ref.y_m).toBeCloseTo(y, 1)
    }
    const res = runCheck(resolve(REPO, 'web/public/data-dummy'), check, 'dummy')
    expect(res.map((r) => r.id)).toEqual(['pad', ...stations.map((s) => s.id)])
    for (const r of res) {
      expect(r.cmp.n).toBe(360 / check.az_step_deg)
      expect(r.cmp.maxAbsDeg).toBeLessThanOrEqual(check.tolerance_deg)
    }
  })

  // real data: the exporter's output (data/interim/export, make web source) or the public tree
  const realRoot = [resolve(REPO, 'data/interim/export'), resolve(REPO, 'web/public/data')].find((r) =>
    existsSync(resolve(r, 'fp3d/index.json')),
  )
  const real = realRoot
    ? (JSON.parse(readFileSync(resolve(realRoot, 'fp3d/index.json')).toString()) as { skyline_check?: SkylineCheck })
    : null
  // Data acceptance check, run by `make fp3d-check` (FP3D_REAL_CHECK=1), not by CI: its verdict
  // depends on other workstreams' data (STATUS WS8 records the result).
  it.skipIf(!real?.skyline_check || !process.env.FP3D_REAL_CHECK)('real data: every station within tolerance (fp3d/index.json skyline_check)', () => {
    // the ring is WS3's file; before make web it sits in data/interim/horizon/public/fp3d/
    const res = runCheck(realRoot!, real!.skyline_check!, 'real')
    // pass rule (C 12:35): the pad and the route stations; excluded stations are only reported
    const inRule = res.filter((r) => r.inRule)
    expect(inRule.map((r) => r.id)).toContain('pad')
    for (const r of inRule) expect(r.cmp.maxAbsDeg).toBeLessThanOrEqual(real!.skyline_check!.tolerance_deg)
  }, 120_000) // 7 stations x 360 rays over the near/far lattices and 7 ring curtains: ~6 s here
})

// --------------------------------------------------------------------------- sun track
describe('sun (WS4 Mars24 series in conditions/clock.json)', () => {
  const raw = {
    algorithm: 'Mars24 (Allison and McEwen 2000)',
    eva: {
      start_utc: '2026-11-14T10:51:18Z',
      sun_series_columns: ['t_eva_min', 'lmst_h', 'sun_azimuth_deg', 'sun_elevation_deg'],
      sun_series: [
        [0, 23.9, 359, 30],
        [5, 0.0, 1, 31],
        [10, 0.1, 3, 32],
      ],
    },
  }
  it('parses the clock.json series and refuses malformed ones', () => {
    expect(parseClockSun(raw)?.azDeg).toEqual([359, 1, 3])
    expect(parseClockSun(raw)?.source).toMatch(/Mars24/)
    expect(parseClockSun({ eva: { ...raw.eva, sun_series: [[0, 1, 2]] } })).toBeNull()
    expect(parseClockSun({ eva: { ...raw.eva, sun_series_columns: ['t', 'a'] } })).toBeNull()
    expect(parseClockSun(undefined)).toBeNull()
  })
  it('interpolates linearly, across north and LMST midnight, and clamps at the ends', () => {
    const tr = parseClockSun(raw)!
    expect(sunAt(tr, 2.5).azDeg).toBeCloseTo(0, 9)
    expect(sunAt(tr, 2.5).elDeg).toBeCloseTo(30.5, 9)
    expect(sunAt(tr, 2.5).lmstH).toBeCloseTo(23.95, 9)
    expect(sunAt(tr, 6.25).azDeg).toBeCloseTo(1.5, 9)
    expect(sunAt(tr, -5).elDeg).toBe(30)
    expect(sunAt(tr, 99).elDeg).toBe(32)
  })
  const realClock = resolve(REPO, 'web/public/data/conditions/clock.json')
  it.skipIf(!existsSync(realClock))('reads the real WS4 series: morning sun in the east, rising', () => {
    const tr = parseClockSun(JSON.parse(readFileSync(realClock).toString()))!
    expect(tr).not.toBeNull()
    expect(tr.tMin[0]).toBe(0)
    const s0 = sunAt(tr, 0)
    expect(s0.elDeg).toBeGreaterThan(0)
    expect(s0.azDeg).toBeGreaterThan(0)
    expect(s0.azDeg).toBeLessThan(180)
    expect(sunAt(tr, 30).elDeg).toBeGreaterThan(s0.elDeg)
    // at a sample the interpolation returns WS4's value exactly
    expect(sunAt(tr, tr.tMin[3]).elDeg).toBe(tr.elDeg[3])
  })
  it('points the light the right way (x east, y up, z south)', () => {
    const [x, y, z] = sunDirection(90, 0)
    expect(x).toBeCloseTo(1, 12)
    expect(y).toBeCloseTo(0, 12)
    expect(z).toBeCloseTo(0, 12)
    expect(sunDirection(0, 0)[2]).toBeCloseTo(-1, 12) // north = -z
    expect(sunDirection(123, 90)[1]).toBeCloseTo(1, 12)
  })
  it('formats LMST and dims the sky after sunset', () => {
    expect(formatLmst(9.5)).toBe('09:30')
    expect(formatLmst(23.999)).toBe('23:59')
    const { nightSunElDeg: n, nightFloor: f } = FP3D_CONFIG.sky
    expect(daylightFactor(10, n, f)).toBe(1)
    expect(daylightFactor(n, n, f)).toBe(f)
    expect(daylightFactor(n / 2, n, f)).toBeCloseTo((1 + f) / 2, 12)
  })
})
