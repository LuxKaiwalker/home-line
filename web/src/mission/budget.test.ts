import { describe, expect, it } from 'vitest'
import { BUDGET_CONSTANTS, missionBudget } from './budget'

describe('mission O2 / time budget (crew.yaml o2_budget, o2_margin; engine margin.py)', () => {
  it('constants are derived from config exactly as the engine does', () => {
    // primary_L = 8 h x 1200 BTU/h x 1055.056 J/BTU / 21.0 J/mL / 1000 = 482.3113 L (crew.yaml note: 482.31)
    expect(BUDGET_CONSTANTS.o2CapacityL).toBeCloseTo(482.31131, 4)
    // effort rate = 0.5 x 36 x 75 / 1000 = 1.35 L/min; reserve = 30 min x 1.35 = 40.5 L (D24)
    expect(BUDGET_CONSTANTS.effortRateLMin).toBeCloseTo(1.35, 12)
    expect(BUDGET_CONSTANTS.reserveL).toBeCloseTo(40.5, 12)
    expect(BUDGET_CONSTANTS.evaLimitMin).toBe(390) // 6.5 h
  })

  it('two legs then the way home', () => {
    const b = missionBudget([{ timeMin: 20, o2L: 30 }, { timeMin: 10, o2L: 12.5 }], { tHomeMin: 25, o2HomeL: 35 })
    expect(b.walkMin).toBe(30)
    expect(b.legsKnown).toBe(true)
    expect(b.tHomeMin).toBe(25)
    expect(b.evaMin).toBe(55)
    expect(b.timeMarginMin).toBe(335)
    expect(b.o2UsedL).toBe(42.5)
    expect(b.o2LeftL).toBeCloseTo(482.31131 - 42.5, 4)
    expect(b.o2NeedL).toBeCloseTo(35 + 40.5, 12)
    expect(b.o2MarginL).toBeCloseTo(482.31131 - 42.5 - 35 - 40.5, 4)
    expect(b.o2MarginMin).toBeCloseTo((482.31131 - 42.5 - 35 - 40.5) / 1.35, 3)
  })

  it('no waypoints: the crew stands at the pad, nothing used, home is 0', () => {
    const b = missionBudget([], { tHomeMin: 0, o2HomeL: 0 })
    expect(b.walkMin).toBe(0)
    expect(b.o2LeftL).toBeCloseTo(482.31131, 4)
    expect(b.o2MarginL).toBeCloseTo(482.31131 - 40.5, 4)
  })

  it('a leg that could not be routed makes every downstream number unknown', () => {
    const b = missionBudget([{ timeMin: 20, o2L: 30 }, null], { tHomeMin: 25, o2HomeL: 35 })
    expect(b.legsKnown).toBe(false)
    expect(b.walkMin).toBeNull()
    expect(b.evaMin).toBeNull()
    expect(b.o2LeftL).toBeNull()
    expect(b.o2MarginMin).toBeNull()
  })

  it('unknown way home (no T_home at the last waypoint): home terms unknown, walk-out still known', () => {
    const b = missionBudget([{ timeMin: 20, o2L: 30 }], { tHomeMin: null, o2HomeL: null })
    expect(b.walkMin).toBe(20)
    expect(b.o2LeftL).toBeCloseTo(482.31131 - 30, 4)
    expect(b.evaMin).toBeNull()
    expect(b.o2NeedL).toBeNull()
    expect(b.o2MarginL).toBeNull()
  })

  it('negative margins stay negative (shown, never clamped)', () => {
    const b = missionBudget([{ timeMin: 380, o2L: 430 }], { tHomeMin: 30, o2HomeL: 40 })
    expect(b.timeMarginMin).toBe(-20)
    expect(b.o2MarginL!).toBeLessThan(0)
  })
})
