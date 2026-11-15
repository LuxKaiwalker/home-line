// J1i: station access for the Mission Planer (as I1a's instant estimate, edit/route/browser/compute.ts
// "Stop snapping"). On the 5 m browser grid with 8 m heights, some station access points sit in small
// pockets the router cannot reach from the pad: A* then searches the whole pad component (~2 s) and finds
// nothing. So each pad's reachable component is computed once (flood fill with the router's own move
// rules), and every stop is routed from/to the NEAREST cell of that component within the D27 access
// radius. A stop with no such cell is "not reachable from this pad" at once; it never goes to A*.
// reachableFrom / nearestIn are I1a's code and accessCell is WP6's (edit/route/map/grid.ts), copied
// line for line (pinned in parity.test.ts): the static tab must not import edit/route/**.
import { CONFIG } from '../config'
import type { GradeModel } from './physio'
import { CROSSINGS, type RouteGrid } from './router'

/** What the flood fill reads (mission/data.ts MissionData has all three). */
export interface ReachData {
  grid: RouteGrid
  /** the router's grade model: a move with infinite pace is not a move */
  model: GradeModel
  /** cells the router can reach from a pad cell (key: pad cell), filled lazily here */
  components: Map<number, Uint8Array>
}

/** D27 access radius (config/variants.yaml route.access_radius_m), as I1a's ACCESS_RADIUS_M. */
export const ACCESS_RADIUS_M = CONFIG.accessRadiusM

// graph.OFFSETS (as map/router.ts): 8 neighbours + 8 knight moves, (drow, dcol), rows grow southwards
const OFFSETS: [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
  [-2, -1], [-2, 1], [2, -1], [2, 1],
  [-1, -2], [-1, 2], [1, -2], [1, 2],
] // prettier-ignore

/**
 * Cells the router can reach from `start` with its own move rules (passable ends and crossings, finite
 * pace at the grade between the two cells; the grade limit is symmetric, so reachability is too).
 * The browser grid (5 m cells, 8 m heights) has small pockets the engine's 3 m graph does not; a stop
 * is routed from the nearest cell of the pad's component within the access radius. Cached per pad cell.
 */
export function reachableFrom(d: ReachData, start: number): Uint8Array {
  const hit = d.components.get(start)
  if (hit) return hit
  const { width: W, height: H, passable, elev, resM } = d.grid
  const seen = new Uint8Array(W * H)
  const len = OFFSETS.map(([a, b]) => Math.hypot(a, b) * resM)
  const stack = new Int32Array(W * H)
  let top = 0
  if (passable[start]) {
    seen[start] = 1
    stack[top++] = start
  }
  while (top > 0) {
    const i = stack[--top]
    const r = Math.floor(i / W)
    const c = i - r * W
    for (let k = 0; k < 16; k++) {
      const r2 = r + OFFSETS[k][0]
      const c2 = c + OFFSETS[k][1]
      if (r2 < 0 || c2 < 0 || r2 >= H || c2 >= W) continue
      const j = r2 * W + c2
      if (seen[j] || !passable[j]) continue
      let ok = true
      for (const [xi, xj] of CROSSINGS[k]) if (!passable[(r + xi) * W + (c + xj)]) ok = false
      if (!ok || d.model.lookup(Math.atan((elev[j] - elev[i]) / len[k])).pace === Infinity) continue
      seen[j] = 1
      stack[top++] = j
    }
  }
  d.components.set(start, seen)
  return seen
}

/** Nearest cell of `comp` within radiusM of `cell` (own cell first), or null. */
export function nearestIn(d: ReachData, comp: Uint8Array, cell: number, radiusM: number): number | null {
  if (comp[cell]) return cell
  const { width: W, height: H, resM } = d.grid
  const R = Math.floor(radiusM / resM)
  const r0 = Math.floor(cell / W)
  const c0 = cell - r0 * W
  let best: number | null = null
  let bestD = Infinity
  for (let dr = -R; dr <= R; dr++) {
    const r = r0 + dr
    if (r < 0 || r >= H) continue
    for (let dc = -R; dc <= R; dc++) {
      const c = c0 + dc
      if (c < 0 || c >= W) continue
      const q = dr * dr + dc * dc
      if (q > R * R || q >= bestD) continue
      if (comp[r * W + c]) {
        best = r * W + c
        bestD = q
      }
    }
  }
  return best
}

// Nearest walkable cell within radiusM (own cell first), or null (WP6 edit/route/map/grid.ts accessCell).
export function accessCell(g: RouteGrid, cell: number | null, radiusM: number): number | null {
  if (cell === null || cell < 0 || cell >= g.width * g.height) return null
  if (g.passable[cell]) return cell
  const R = Math.floor(radiusM / g.resM)
  const r0 = Math.floor(cell / g.width)
  const c0 = cell - r0 * g.width
  let best: number | null = null
  let bestD = Infinity
  for (let dr = -R; dr <= R; dr++) {
    const r = r0 + dr
    if (r < 0 || r >= g.height) continue
    for (let dc = -R; dc <= R; dc++) {
      const c = c0 + dc
      if (c < 0 || c >= g.width) continue
      const d = dr * dr + dc * dc
      if (d > R * R || d >= bestD) continue
      if (g.passable[r * g.width + c]) {
        best = r * g.width + c
        bestD = d
      }
    }
  }
  return best
}

// ---------------------------------------------------------------- the tab's stop snapping (I1a snapCell)

/** Where a stop is routed from, or why it cannot be: outside the grid, no walkable cell within the
 *  radius (blocked), or walkable but not connected to the pad within the radius (unreachable). */
export type StopCell = number | 'outside' | 'blocked' | 'unreachable'

/**
 * The routing cell of a stop at grid cell `own` (null = outside the grid): the nearest cell of the pad's
 * component `comp` within the access radius (I1a compute.ts snapCell, the same order of checks).
 */
export function stopCell(d: ReachData, comp: Uint8Array | null, own: number | null, radiusM: number = ACCESS_RADIUS_M): StopCell {
  if (own === null) return 'outside'
  if (accessCell(d.grid, own, radiusM) === null) return 'blocked'
  if (!comp) return 'unreachable'
  const c = nearestIn(d, comp, own, radiusM)
  return c === null ? 'unreachable' : c
}

/** The pad's routing cell (I1a: the pad snaps to its nearest walkable cell, no component yet), or -1. */
export function padCellOf(g: RouteGrid, own: number | null, radiusM: number = ACCESS_RADIUS_M): number {
  return accessCell(g, own, radiusM) ?? -1
}

/** J1i: a leg is only worth routing when both ends are in the pad's component (else: null at once). */
export function legInComponent(comp: Uint8Array | null, a: number, b: number): boolean {
  return !!comp && a >= 0 && b >= 0 && comp[a] === 1 && comp[b] === 1
}
