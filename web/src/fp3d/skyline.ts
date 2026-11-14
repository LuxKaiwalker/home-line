// Skyline of the rendered scene (pure geometry; SPEC F20 acceptance "the rendered skyline at each
// station within 0.5 deg of the computed horizon"). For an observer at eye height above the
// drawn surface, the elevation angle of the highest drawn point along each azimuth, over exactly
// the geometry the view draws:
//   * near chunk triangles where a chunk is loaded (Terrain.heightAt),
//   * far-mesh triangles in every far cell the view draws (farMesh(..., skipCovered = true)
//     leaves out cells whose four corners lie on loaded chunks),
//   * the far-skyline ring curtain (ring.ts),
// with the same curvature drop d^2 / 2R the vertex shader applies relative to the camera.
// The surfaces are piecewise linear along a ray, so the maximum of (h - z_eye) / s is reached at
// a lattice-line or diagonal crossing (or the mesh edge); every such crossing is evaluated, so the
// result is exact up to the (tiny) curvature term between crossings.
import { ringCrossings, type RingCurtain } from './ring'
import type { Terrain } from './terrain'

export interface SkylineOptions {
  eyeHeightM: number
  radiusM: number
}

const farKey = (c: number, r: number) => r * 1_000_003 + c

/** Height of the drawn surface at (x, y): max over the meshes drawn there, NaN where none. */
export class DrawnSurface {
  private readonly t: Terrain
  private readonly farDrawn = new Map<number, boolean>()
  readonly w0: number
  readonly w1: number
  readonly s0: number
  readonly n0: number

  constructor(t: Terrain) {
    this.t = t
    const g = t.far
    this.w0 = g.west + 0.5 * g.res
    this.w1 = g.west + (g.cols - 0.5) * g.res
    this.n0 = g.north - 0.5 * g.res
    this.s0 = g.north - (g.rows - 0.5) * g.res
  }

  /** Same rule as farMesh(skipCovered): a far cell is drawn unless all 4 corners are on loaded chunks. */
  private farCellDrawn(c: number, r: number): boolean {
    const k = farKey(c, r)
    const hit = this.farDrawn.get(k)
    if (hit !== undefined) return hit
    const g = this.t.far
    let all = this.t.chunkCount > 0
    for (const [dc, dr] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      if (!all) break
      const x = g.west + (c + dc + 0.5) * g.res
      const y = g.north - (r + dr + 0.5) * g.res
      all = this.t.meshChunkAt(x, y) !== null
    }
    this.farDrawn.set(k, !all)
    return !all
  }

  at(x: number, y: number): number {
    let h = Number.NaN
    if (this.t.meshChunkAt(x, y)) h = this.t.heightAt(x, y)
    if (x < this.w0 || x > this.w1 || y > this.n0 || y < this.s0) return h
    const g = this.t.far
    const c = Math.min(g.cols - 2, Math.floor((x - g.west) / g.res - 0.5))
    const r = Math.min(g.rows - 2, Math.floor((g.north - y) / g.res - 0.5))
    if (this.farCellDrawn(c, r)) {
      const f = g.triangle(x, y)
      if (!(h >= f)) h = f
    }
    return h
  }
}

/** Integer crossings of g(s) = g0 + g1 s for s in (0, sMax]. */
function crossings(g0: number, g1: number, sMax: number, out: (s: number) => void): void {
  if (Math.abs(g1) < 1e-12) return
  const a = g0
  const b = g0 + g1 * sMax
  const k0 = Math.ceil(Math.min(a, b))
  const k1 = Math.floor(Math.max(a, b))
  for (let k = k0; k <= k1; k++) {
    const s = (k - g0) / g1
    if (s > 1e-9 && s <= sMax) out(s)
  }
}

/** Distance along (dx, dy) from (x, y) to the edge of the drawn square. */
function exitDistance(surf: DrawnSurface, x: number, y: number, dx: number, dy: number): number {
  let s = Infinity
  if (dx > 1e-12) s = Math.min(s, (surf.w1 - x) / dx)
  if (dx < -1e-12) s = Math.min(s, (surf.w0 - x) / dx)
  if (dy > 1e-12) s = Math.min(s, (surf.n0 - y) / dy)
  if (dy < -1e-12) s = Math.min(s, (surf.s0 - y) / dy)
  return Math.max(0, s)
}

/**
 * Rendered skyline elevation (deg) seen from (x, y) at eye height above the drawn surface, for
 * each azimuth (deg clockwise from grid north). NaN where nothing is drawn along the ray.
 */
export function renderedSkyline(
  t: Terrain,
  ring: RingCurtain | null,
  x: number,
  y: number,
  azDeg: readonly number[],
  opts: SkylineOptions,
  surface?: DrawnSurface,
): { elevationDeg: number[]; zEye: number } {
  const surf = surface ?? new DrawnSurface(t)
  const zEye = t.heightAt(x, y) + opts.eyeHeightM
  const twoR = 2 * opts.radiusM
  const lattices = [
    { west: t.x0, north: t.y0, res: t.res },
    { west: t.far.west, north: t.far.north, res: t.far.res },
  ]
  const out: number[] = []
  for (const az of azDeg) {
    const a = (az * Math.PI) / 180
    const dx = Math.sin(a)
    const dy = Math.cos(a)
    const sMax = exitDistance(surf, x, y, dx, dy)
    let best = -Infinity
    const visit = (s: number) => {
      const h = surf.at(x + s * dx, y + s * dy)
      if (h === h) {
        const e = (h - (s * s) / twoR - zEye) / s
        if (e > best) best = e
      }
    }
    for (const L of lattices) {
      const u0 = (x - L.west) / L.res - 0.5
      const v0 = (L.north - y) / L.res - 0.5
      crossings(u0, dx / L.res, sMax, visit) // vertical lattice lines
      crossings(v0, -dy / L.res, sMax, visit) // horizontal lattice lines
      crossings(u0 + v0, (dx - dy) / L.res, sMax, visit) // NE-SW diagonals (u + v integer)
    }
    if (sMax > 0) visit(sMax * (1 - 1e-12))
    if (ring) {
      for (const [s, z] of ringCrossings(ring, x, y, az)) {
        const e = (z - (s * s) / twoR - zEye) / s
        if (e > best) best = e
      }
    }
    out.push(best === -Infinity ? Number.NaN : (Math.atan(best) * 180) / Math.PI)
  }
  return { elevationDeg: out, zEye }
}

export interface SkylineComparison {
  n: number
  maxAbsDeg: number
  atAzDeg: number
  meanAbsDeg: number
  rmsDeg: number
}

/** Compare a rendered skyline with a reference (null/NaN reference entries are skipped). */
export function compareSkylines(
  rendered: readonly number[],
  reference: readonly (number | null)[],
  azDeg: readonly number[],
): SkylineComparison {
  let n = 0
  let max = 0
  let at = Number.NaN
  let sum = 0
  let sq = 0
  for (let k = 0; k < reference.length; k++) {
    const r = reference[k]
    if (r === null || !Number.isFinite(r)) continue
    const d = Math.abs(rendered[k] - r)
    const dd = Number.isFinite(d) ? d : Infinity
    n++
    sum += dd
    sq += dd * dd
    if (dd > max || Number.isNaN(at)) {
      max = dd
      at = azDeg[k]
    }
  }
  return { n, maxAbsDeg: max, atAzDeg: at, meanAbsDeg: n ? sum / n : Number.NaN, rmsDeg: n ? Math.sqrt(sq / n) : Number.NaN }
}
