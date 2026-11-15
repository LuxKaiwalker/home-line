// Pure geometry of the "single drawer open" rule (Notion plan §4 rules, §6 test 1): an open right drawer
// leaves ≥ 60 % of the map width visible, the expanded bottom drawer ≥ 60 % of the height. Unit-tested
// in coverage-math.test.ts; used by coverage.spec.ts on the boxes the browser reports.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Section 6 test 1 thresholds (never loosen). */
export const LIMITS = {
  /** default state: covered % of the work area */
  defaultCoveredPct: { '1440x900': 25, '1024x768': 35 } as Record<string, number>,
  /** any single drawer open: share of the map width and height that stays visible */
  minVisibleShare: 0.6,
} as const

const overlapsY = (a: Rect, b: Rect) => a.y < b.y + b.height && b.y < a.y + a.height
const overlapsX = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width

/**
 * Visible share of the map: the free rectangle from the map's top-left corner up to the nearest
 * right-anchored obstacle (its left edge) and the nearest bottom-anchored obstacle (its top edge).
 * Obstacles outside the map are ignored; an obstacle that starts left of / above the map leaves 0.
 */
export function visibleShare(map: Rect, obstacles: { right: Rect[]; bottom: Rect[] }): { width: number; height: number } {
  if (map.width <= 0 || map.height <= 0) return { width: 0, height: 0 }
  let freeW = map.width
  let freeH = map.height
  for (const r of obstacles.right) if (overlapsY(r, map) && overlapsX(r, map)) freeW = Math.min(freeW, Math.max(0, r.x - map.x))
  for (const b of obstacles.bottom) if (overlapsY(b, map) && overlapsX(b, map)) freeH = Math.min(freeH, Math.max(0, b.y - map.y))
  return { width: freeW / map.width, height: freeH / map.height }
}
