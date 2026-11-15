// Unit tests of the drawer geometry the coverage spec relies on (package L5, D111).
// Run: cd web && npm run test:planning:unit
import { describe, expect, it } from 'vitest'
import { LIMITS, visibleShare } from './coverage-math'

const MAP = { x: 56, y: 48, width: 1384, height: 852 }

describe('visibleShare', () => {
  it('no drawer: the whole map', () => {
    expect(visibleShare(MAP, { right: [], bottom: [] })).toEqual({ width: 1, height: 1 })
  })

  it('a right drawer at 40 % of the map leaves exactly 60 % of the width', () => {
    const w = MAP.width * 0.4
    const s = visibleShare(MAP, { right: [{ x: MAP.x + MAP.width - w, y: MAP.y, width: w, height: MAP.height - 40 }], bottom: [] })
    expect(s.width).toBeCloseTo(0.6, 6)
    expect(s.width).toBeGreaterThanOrEqual(LIMITS.minVisibleShare - 1e-9)
    expect(s.height).toBe(1)
  })

  it('a right drawer wider than 40 % fails the rule', () => {
    const w = MAP.width * 0.45
    const s = visibleShare(MAP, { right: [{ x: MAP.x + MAP.width - w, y: MAP.y, width: w, height: MAP.height }], bottom: [] })
    expect(s.width).toBeLessThan(LIMITS.minVisibleShare)
  })

  it('the bottom drawer counts from its top edge (collapsed bar included)', () => {
    const h = 40
    expect(visibleShare(MAP, { right: [], bottom: [{ x: MAP.x, y: MAP.y + MAP.height - h, width: MAP.width, height: h }] }).height).toBeCloseTo(1 - h / MAP.height, 6)
    const big = MAP.height * 0.5
    expect(visibleShare(MAP, { right: [], bottom: [{ x: MAP.x, y: MAP.y + MAP.height - big, width: MAP.width, height: big }] }).height).toBeCloseTo(0.5, 6)
  })

  it('obstacles outside the map are ignored; one starting left of the map leaves nothing', () => {
    expect(visibleShare(MAP, { right: [{ x: 0, y: MAP.y, width: 56, height: 100 }], bottom: [{ x: 0, y: 0, width: 1440, height: 48 }] })).toEqual({ width: 1, height: 1 })
    expect(visibleShare(MAP, { right: [{ x: 10, y: MAP.y, width: 1430, height: 100 }], bottom: [] }).width).toBe(0)
  })

  it('an empty map is never visible', () => {
    expect(visibleShare({ x: 0, y: 0, width: 0, height: 0 }, { right: [], bottom: [] })).toEqual({ width: 0, height: 0 })
  })

  it('thresholds are the spec values', () => {
    expect(LIMITS.defaultCoveredPct).toEqual({ '1440x900': 25, '1024x768': 35 })
    expect(LIMITS.minVisibleShare).toBe(0.6)
  })
})
