import { describe, expect, it } from 'vitest'
import { buildTrack, marginInputs, marginProfile, type LegProfile } from './margin'
import { planTimeline, stopLabel } from './planTimeline'

// two straight legs: 10 min each, O2 0.1 L/min, T_home rising 5 -> 10 then 10 -> 12
const leg = (t0h: number, t1h: number): LegProfile => ({ tMin: [0, 5, 10], o2L: [0, 0.5, 1], tHomeMin: [t0h, (t0h + t1h) / 2, t1h], o2HomeL: [0, 0.2, 0.4] })

describe('planned EVA as a dock timeline (mission/planTimeline.ts)', () => {
  const track = buildTrack([leg(0, 10), leg(10, 12)], [15, 0])!
  const prof = marginProfile(track, marginInputs({ tDarkMin: 300 }))
  const pt = planTimeline(prof, ['S4', '#2'], 300)

  it('one row per profile point, the axis ends back at the pad', () => {
    expect(pt.model.rows).toHaveLength(prof.points.length)
    expect(pt.tReturn).toBeCloseTo(10 + 15 + 10 + 12, 9)
    expect(pt.model.tMax).toBe(pt.tReturn)
    expect(pt.model.daylightEnd).toBe(300)
  })

  it('a stop with time is a dwell band; every arrival is a stop label', () => {
    expect(pt.model.dwells).toEqual([{ station: 'S4', t0: 10, t1: 25, i0: expect.any(Number), i1: expect.any(Number) }])
    expect(pt.stops).toEqual([
      { label: 'S4', t: 10 },
      { label: '#2', t: 35 },
    ])
  })

  it('margins and binding terms are the profile values, unchanged', () => {
    expect(pt.model.curve.map((r) => r.margin)).toEqual(prof.points.map((p) => p.marginMin))
    expect(pt.model.yMin).toBeLessThanOrEqual(Math.min(0, ...prof.points.map((p) => p.marginMin)))
    expect(pt.model.bindingRuns.length).toBeGreaterThan(0)
    expect(pt.model.turnBacks).toEqual([])
    expect(pt.model.storm).toBeNull()
  })

  it('labels', () => {
    expect(stopLabel(0)).toBe('#1')
    expect(stopLabel(2, 'S6')).toBe('S6')
  })
})
