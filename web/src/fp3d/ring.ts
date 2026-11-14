// Far-skyline ring (F20: "the computed horizon as a far-skyline ring so the crater rim is
// correct"), from WS3's fp3d/horizon_ring.json (pipeline/horizon/cards.py ring_doc). Pure; no Three.js.
//
// Each ring point is the horizon point of one azimuth as seen from the ring observer: distance d
// and absolute height height_m. It is placed at its true position (observer + d along the
// azimuth, z = height_m), so it stays geometrically right from anywhere on the route, and drawn
// as a curtain hanging below the skyline. Points inside the far-mesh square are skipped: there the
// terrain mesh itself is the skyline. The curvature drop is applied in the vertex shader (same as
// the terrain), relative to the camera.
import { lonLatToXY, type Eqc } from './geo'

export interface RingPoint {
  x: number
  y: number
  /** absolute height of the horizon point (m, same datum as the terrain) */
  z: number
  /** distance from the ring observer (m) */
  d: number
  azDeg: number
}

export interface RingCurtain {
  /** runs of neighbouring points joined into a curtain (each >= 2 points) */
  segments: RingPoint[][]
  /** z of the curtain bottom per point, parallel to segments */
  bottoms: number[][]
  observer: { x: number; y: number } | null
  /** number of ring points drawn / skipped because the far mesh covers them */
  drawn: number
  covered: number
  note: string
}

export interface MeshSquare {
  west: number
  north: number
  size: number
}

export function insideSquare(sq: MeshSquare, x: number, y: number): boolean {
  return x >= sq.west && x <= sq.west + sq.size && y <= sq.north && y >= sq.north - sq.size
}

type Obj = Record<string, unknown>
const arr = (v: unknown): (number | null)[] | null =>
  Array.isArray(v) && v.every((x) => x === null || (typeof x === 'number' && Number.isFinite(x))) ? (v as (number | null)[]) : null

const empty = (note: string, observer: RingCurtain['observer'] = null, covered = 0): RingCurtain => ({
  segments: [],
  bottoms: [],
  observer,
  drawn: 0,
  covered,
  note,
})

/**
 * Parse horizon_ring.json into the curtain to draw outside the far-mesh square. Formats:
 *  - WS3 (pipeline/horizon/cards.py ring_doc): observer {x, y, lon, lat, z_eye_m, ...}, az_deg[],
 *    elev_deg[], dist_m[], z_m[] (terrain height of the horizon point), east_m[], north_m[]
 *    (offsets from the observer, analysis CRS); null = unknown;
 *  - M0 dummy: observer {lon, lat}, az_deg, elev_deg, max_range_m, no distances.
 */
export function parseRing(
  raw: unknown,
  eqc: Eqc,
  square: MeshSquare,
  opts: { skirtDeg: number; maxDistanceRatio: number },
): RingCurtain {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty('ring: unreadable')
  const o = raw as Obj
  const ob = (o.observer ?? {}) as Obj
  let ox = Number(ob.x)
  let oy = Number(ob.y)
  if (!Number.isFinite(ox) || !Number.isFinite(oy) || ob.x === null || ob.y === null) {
    const lon = Number(ob.lon)
    const lat = Number(ob.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return empty('ring: no observer')
    ;[ox, oy] = lonLatToXY(eqc, lon, lat)
  }
  const observer = { x: ox, y: oy }
  const el = arr(o.elev_deg) ?? arr(o.elevation_deg)
  if (!el || el.length === 0) return empty('ring: no elevations', observer)
  const n = el.length
  const dist = arr(o.dist_m) ?? arr(o.distance_m)
  const height = arr(o.z_m) ?? arr(o.height_m)
  const east = arr(o.east_m)
  const north = arr(o.north_m)
  const step = typeof o.az_step_deg === 'number' && o.az_step_deg > 0 ? o.az_step_deg : 360 / n
  const azList = arr(o.az_deg)
  const azOf = (k: number) => (azList && azList.length === n && azList[k] !== null ? (azList[k] as number) : k * step)
  const offsets = !!(east && north && east.length === n && north.length === n)

  if (!dist || !height || dist.length !== n || height.length !== n) {
    // No distances: a point cannot be placed. If every horizon point is known to lie inside the
    // terrain square (max_range_m), the mesh already draws that skyline and nothing is lost.
    const maxR = typeof o.max_range_m === 'number' ? o.max_range_m : Number.NaN
    const inside =
      Number.isFinite(maxR) &&
      insideSquare(square, ox - maxR, oy + maxR) &&
      insideSquare(square, ox + maxR, oy - maxR)
    return inside
      ? empty('skyline ring inside the terrain extent (drawn by the mesh)', observer, n)
      : empty('skyline ring has no distances: not drawn', observer)
  }

  const pts: (RingPoint | null)[] = []
  let covered = 0
  for (let k = 0; k < n; k++) {
    const d = dist[k]
    const z = height[k]
    if (d === null || z === null || el[k] === null || !(d > 0)) {
      pts.push(null)
      continue
    }
    const az = azOf(k)
    const a = (az * Math.PI) / 180
    const e = offsets ? east![k] : null
    const nn = offsets ? north![k] : null
    const x = ox + (e !== null ? e : d * Math.sin(a))
    const y = oy + (nn !== null ? nn : d * Math.cos(a))
    if (insideSquare(square, x, y)) {
      covered++
      pts.push(null)
      continue
    }
    pts.push({ x, y, z, d, azDeg: az })
  }
  // join neighbours (wrapping at 360) into runs; break at gaps and at distance jumps
  const joined = (a: RingPoint, b: RingPoint) => Math.max(a.d, b.d) / Math.min(a.d, b.d) <= opts.maxDistanceRatio
  const link = pts.map((p, k) => {
    const q = pts[(k + 1) % n]
    return !!(p && q && joined(p, q))
  })
  const segments: RingPoint[][] = []
  if (link.every(Boolean)) {
    segments.push([...(pts as RingPoint[]), pts[0] as RingPoint]) // closed ring
  } else {
    const start = (link.findIndex((l) => !l) + 1) % n // first point after a break
    let run: RingPoint[] = []
    for (let m = 0; m < n; m++) {
      const k = (start + m) % n
      const p = pts[k]
      if (p) run.push(p)
      if (!link[k]) {
        if (run.length >= 2) segments.push(run)
        run = []
      }
    }
  }
  const t = Math.tan((opts.skirtDeg * Math.PI) / 180)
  const bottoms = segments.map((s) => s.map((p) => p.z - p.d * t))
  const drawn = link.every(Boolean) ? n : segments.reduce((s, r) => s + r.length, 0)
  return {
    segments,
    bottoms,
    observer,
    drawn,
    covered,
    note: drawn ? `skyline ring: ${drawn} points beyond the terrain` : 'skyline ring inside the terrain extent (drawn by the mesh)',
  }
}

/**
 * Height of the curtain top where the horizontal ray (x, y) + s (sin az, cos az) crosses it, as
 * [s, z] pairs (pure geometry, used by the skyline check).
 */
export function ringCrossings(c: RingCurtain, x: number, y: number, azDeg: number): [number, number][] {
  const a = (azDeg * Math.PI) / 180
  const dx = Math.sin(a)
  const dy = Math.cos(a)
  const out: [number, number][] = []
  for (const seg of c.segments) {
    for (let k = 0; k + 1 < seg.length; k++) {
      const p = seg[k]
      const q = seg[k + 1]
      const ex = q.x - p.x
      const ey = q.y - p.y
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-12) continue
      const wx = p.x - x
      const wy = p.y - y
      const s = (wx * ey - wy * ex) / den
      const w = (wx * dy - wy * dx) / den
      if (s > 0 && w >= 0 && w <= 1) out.push([s, p.z + w * (q.z - p.z)])
    }
  }
  return out
}

/** One curtain from several (segments side by side; counts summed; first observer kept). */
export function mergeCurtains(parts: RingCurtain[]): RingCurtain | null {
  if (!parts.length) return null
  if (parts.length === 1) return parts[0]
  return {
    segments: parts.flatMap((c) => c.segments),
    bottoms: parts.flatMap((c) => c.bottoms),
    observer: parts[0].observer,
    drawn: parts.reduce((s, c) => s + c.drawn, 0),
    covered: parts.reduce((s, c) => s + c.covered, 0),
    note: parts.map((c) => c.note).join('; '),
  }
}

/**
 * The far-skyline curtains the view draws: WS3's pad ring (horizon_ring.json, null when absent)
 * plus fp3d/index.json `station_rings` (pipeline/export/terrain_chunks.py station_rings: each
 * station's WS3 horizon points beyond the far square, same per-azimuth format). A station ring's
 * points are real horizon points at their true position, so from that station the drawn far
 * skyline is its computed horizon (F20 "computed horizon as a far-skyline ring"). Station rings
 * break at distance jumps over `stationMaxDistanceRatio` (config ring.station_max_distance_ratio):
 * a top edge joining a near and a far point hangs in the air when seen from elsewhere.
 */
export function farCurtains(
  ws3Ring: unknown,
  stationRings: unknown,
  eqc: Eqc,
  square: MeshSquare,
  opts: { skirtDeg: number; maxDistanceRatio: number; stationMaxDistanceRatio?: number },
): RingCurtain | null {
  const parts: RingCurtain[] = []
  const so = { skirtDeg: opts.skirtDeg, maxDistanceRatio: opts.stationMaxDistanceRatio ?? opts.maxDistanceRatio }
  if (ws3Ring) parts.push(parseRing(ws3Ring, eqc, square, opts))
  const rings = stationRings && typeof stationRings === 'object' ? (stationRings as Obj).rings : null
  let k = 0
  if (Array.isArray(rings)) {
    for (const r of rings) {
      const c = parseRing(r, eqc, square, so)
      if (c.segments.length) {
        parts.push(c)
        k++
      }
    }
  }
  const m = mergeCurtains(parts)
  if (m && k) m.note += ` (+ ${k} station ring${k === 1 ? '' : 's'})`
  return m
}
