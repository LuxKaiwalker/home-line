import { describe, expect, it } from 'vitest'
import { elevationProfile, slopeRuns } from './elevation'
import { slopeClassOf } from './slope'

// a 1 x 10 strip of 5 m cells; heights rise 1 m per cell then fall
const width = 10
const elev = Float32Array.from([0, 1, 2, 3, 4, 5, 4, 3, 2, 1])

describe('elevation along the plan (mission/elevation.ts)', () => {
  it('leg cells at the router times, flat during a stop, then the way home timed by T_home', () => {
    const p = elevationProfile({
      legs: [{ cells: [0, 1, 2, 3], tauS: [0, 60, 120, 180] }],
      stopsMin: [10],
      width,
      resM: 5,
      elev,
      home: { cells: [3, 2, 1, 0], tHomeMin: [3, 2, 1, 0] },
    })!
    expect(p.points.map((q) => [q.t, q.z])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [13, 3], // stop: same height, 10 min later
      [14, 2],
      [15, 1],
      [16, 0],
    ])
    expect(p.tEnd).toBe(16)
    expect(p.home).toBe(true)
    expect(p.zMin).toBe(0)
    expect(p.zMax).toBe(3)
    // grade: 1 m over 5 m = 11.31 deg; the stop segment has none
    expect(p.points[1].deg).toBeCloseTo((Math.atan(1 / 5) * 180) / Math.PI, 9)
    expect(p.points[4].deg).toBeNull()
    expect(p.points[5].deg).toBeCloseTo(p.points[1].deg!, 9)
  })

  it('second leg starts where the first ended (no duplicate point); diagonal length counts', () => {
    const w = 3
    const z = Float32Array.from([0, 0, 0, 0, 5, 0, 0, 0, 0])
    const p = elevationProfile({ legs: [{ cells: [0, 4], tauS: [0, 60] }, { cells: [4, 8], tauS: [0, 30] }], stopsMin: [0, 0], width: w, resM: 5, elev: z, home: null })!
    expect(p.points.map((q) => q.t)).toEqual([0, 1, 1.5])
    expect(p.points[1].deg).toBeCloseTo((Math.atan(5 / (Math.SQRT2 * 5)) * 180) / Math.PI, 9)
    expect(p.home).toBe(false)
  })

  it('an unknown height on a leg gives no profile', () => {
    const z = Float32Array.from([0, NaN, 2])
    expect(elevationProfile({ legs: [{ cells: [0, 1, 2], tauS: [0, 1, 2] }], stopsMin: [0], width: 3, resM: 5, elev: z, home: null })).toBeNull()
  })

  it('slope runs split by class; the stop segment is its own run', () => {
    const p = elevationProfile({ legs: [{ cells: [0, 1, 2], tauS: [0, 60, 120] }], stopsMin: [5], width, resM: 5, elev, home: null })!
    const runs = slopeRuns(p.points)
    expect(runs.map((r) => r.cls)).toEqual([slopeClassOf(p.points[1].deg!), -1])
    expect(runs[0].pts).toHaveLength(3)
  })
})
