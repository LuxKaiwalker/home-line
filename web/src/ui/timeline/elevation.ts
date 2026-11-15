// Elevation along the planned EVA (user 2026-11-15), on the EVA clock so it lines up with the margin strip:
// pad -> legs (one point per route cell, at the router's own times) -> flat during each stop -> the way
// home (WS2's pointer path) to the pad. Heights are the planner's terrain grid (the same cells and heights
// the router walks), never interpolated beyond it. The way home is timed like margin.ts: T_home falls one
// minute per minute, so a home cell is reached at t_leave + (T_home(last waypoint) - T_home(cell)).
// Each segment carries its along-route grade, atan(dz / horizontal length), as router.ts computes it,
// coloured in the Slope layer's classes (slope.ts).
// PORT F15: ported from origin/main web/src/mission/elevation.ts (elevationProfile, slopeRuns unchanged;
// the slope classes are the Plan map's, map/overlays/slope/classes.ts). Added for the user replay
// (state/userReplay.ts): replayElevation() walks the core's lon/lat leg paths on the replay clock and
// reads the heights from fp3d/far.f32.gz (8 m, ui/timeline/elevationData.ts, loaded lazily).
import { slopeClasses, slopeClassOf as classOf } from '../../map/overlays/slope/classes'
import type { UserReplay } from '../../state/userReplay'

export const SLOPE_CLASSES = slopeClasses()
const slopeClassOf = (deg: number): number => classOf(deg, SLOPE_CLASSES)

export interface ElevPoint {
  /** EVA minute */
  t: number
  /** metres */
  z: number
  /** |grade| in degrees of the segment that ends here (null at the start and across a stop) */
  deg: number | null
}

export interface ElevProfile {
  points: ElevPoint[]
  zMin: number
  zMax: number
  /** EVA minute back at the pad, or of the last point when there is no way home */
  tEnd: number
  /** the profile reaches the pad (walk home included) */
  home: boolean
}

export interface ElevInputs {
  legs: { cells: readonly number[]; tauS: readonly number[] }[]
  stopsMin: readonly number[]
  width: number
  resM: number
  elev: ArrayLike<number>
  /** way home from the last waypoint as grid cells (first = last waypoint), with T_home per cell; null = none */
  home: { cells: readonly number[]; tHomeMin: readonly (number | null)[] } | null
}

function gradeDeg(a: number, b: number, za: number, zb: number, width: number, resM: number): number {
  const dr = Math.floor(b / width) - Math.floor(a / width)
  const dc = (b % width) - (a % width)
  const len = Math.hypot(dr, dc) * resM
  return len > 0 ? Math.abs((Math.atan((zb - za) / len) * 180) / Math.PI) : 0
}

/** null when a leg is missing or a height on the route is unknown (unknown stays unknown). */
export function elevationProfile(inp: ElevInputs): ElevProfile | null {
  const { width, resM, elev } = inp
  const pts: ElevPoint[] = []
  let t = 0
  let prevCell: number | null = null
  const push = (cell: number, tMin: number, across: boolean): boolean => {
    const z = elev[cell]
    if (!Number.isFinite(z)) return false
    const deg = prevCell === null || across ? null : gradeDeg(prevCell, cell, elev[prevCell], z, width, resM)
    if (prevCell === cell && pts.length && !across) {
      pts[pts.length - 1] = { ...pts[pts.length - 1], t: tMin }
    } else pts.push({ t: tMin, z, deg })
    prevCell = cell
    return true
  }
  for (let i = 0; i < inp.legs.length; i++) {
    const leg = inp.legs[i]
    if (!leg || !leg.cells.length || leg.cells.length !== leg.tauS.length) return null
    for (let k = i === 0 ? 0 : 1; k < leg.cells.length; k++) if (!push(leg.cells[k], t + leg.tauS[k] / 60, false)) return null
    t += leg.tauS[leg.tauS.length - 1] / 60
    const stop = Math.max(0, inp.stopsMin[i] ?? 0)
    if (stop > 0) {
      t += stop
      if (!push(prevCell!, t, true)) return null
    }
  }
  let home = false
  const h = inp.home
  if (h && h.cells.length > 1 && h.tHomeMin[0] !== null) {
    const t0 = t
    const th0 = h.tHomeMin[0] as number
    let last = t0
    for (let k = 1; k < h.cells.length; k++) {
      const th = h.tHomeMin[k]
      if (th === null || !Number.isFinite(elev[h.cells[k]])) continue
      const tk = Math.min(t0 + th0, Math.max(last, t0 + (th0 - th)))
      push(h.cells[k], tk, false)
      last = tk
    }
    if (last < t0 + th0) pts[pts.length - 1] = { ...pts[pts.length - 1], t: t0 + th0 }
    t = t0 + th0
    home = true
  }
  if (!pts.length) return null
  const zs = pts.map((p) => p.z)
  return { points: pts, zMin: Math.min(...zs), zMax: Math.max(...zs), tEnd: Math.max(t, pts[pts.length - 1].t), home }
}

/** Consecutive segments of one slope class, as polylines (each starts at the previous run's last point). */
export function slopeRuns(points: readonly ElevPoint[]): { cls: number; pts: ElevPoint[] }[] {
  const out: { cls: number; pts: ElevPoint[] }[] = []
  for (let k = 1; k < points.length; k++) {
    const p = points[k]
    const cls = p.deg === null ? -1 : slopeClassOf(p.deg)
    const run = out[out.length - 1]
    if (run && run.cls === cls) run.pts.push(p)
    else out.push({ cls, pts: [points[k - 1], p] })
  }
  return out
}

/** Height and analysis-CRS position (metres) at lon/lat; z NaN / null when unknown. */
export type HeightAt = (lon: number, lat: number) => { x: number; y: number; z: number } | null

/** PORT F15: the height along the user's replay (pad -> legs -> stops -> pad), on the replay clock:
 *  one point per path vertex, timed like replayAt() (uniform speed along each leg's path length), flat
 *  during each stop. Grade = atan(dz / horizontal length) between vertices. null when a height on the
 *  route is unknown (unknown stays unknown). */
export function replayElevation(u: UserReplay, heightAt: HeightAt): ElevProfile | null {
  const pts: ElevPoint[] = []
  let prev: { x: number; y: number; z: number } | null = null
  for (const s of u.segments) {
    if (s.kind === 'dwell') {
      if (!prev) return null
      pts.push({ t: s.t1, z: prev.z, deg: null })
      continue
    }
    const total = s.cum[s.cum.length - 1]
    for (let k = 0; k < s.path.length; k++) {
      if (k === 0 && prev) continue // the leg starts where the previous one ended
      const h = heightAt(s.path[k][0], s.path[k][1])
      if (!h || !Number.isFinite(h.z)) return null
      const t = s.t0 + (total > 0 ? (s.t1 - s.t0) * (s.cum[k] / total) : k === s.path.length - 1 ? s.t1 - s.t0 : 0)
      let deg: number | null = null
      if (prev) {
        const len = Math.hypot(h.x - prev.x, h.y - prev.y)
        deg = len > 0 ? Math.abs((Math.atan((h.z - prev.z) / len) * 180) / Math.PI) : 0
      }
      pts.push({ t, z: h.z, deg })
      prev = h
    }
  }
  if (!pts.length) return null
  const zs = pts.map((p) => p.z)
  return { points: pts, zMin: Math.min(...zs), zMax: Math.max(...zs), tEnd: Math.max(u.totalMin, pts[pts.length - 1].t), home: true }
}

/** Height at minute t on a profile (linear between its points, clamped to its ends). */
export function heightAtT(e: ElevProfile, t: number): number {
  const p = e.points
  if (t <= p[0].t) return p[0].z
  for (let k = 1; k < p.length; k++) {
    if (t <= p[k].t) {
      const dt = p[k].t - p[k - 1].t
      return dt > 0 ? p[k - 1].z + ((p[k].z - p[k - 1].z) * (t - p[k - 1].t)) / dt : p[k].z
    }
  }
  return p[p.length - 1].z
}
