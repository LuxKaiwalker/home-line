import { afterEach, describe, expect, it } from 'vitest'
import { missionClock } from './mission'
import type { PlanningRoute } from './planning'
import { MOCK_ROUTE_RESULTS, type RouteResults } from './routeResults'
import { buildUserReplay, loadUserReplay, replayAt, replayOfficialPlan, userReplay, userReplayPosition } from './userReplay'

const route = {
  stops: [
    { id: 'w1', kind: 'point', lon: 137.396, lat: -4.772, stopMin: 10 },
    { id: 's3', kind: 'point', lon: 137.408, lat: -4.765, stopMin: 5 },
  ],
  startUtc: null,
  storm: true,
} as unknown as PlanningRoute

const ready: RouteResults = {
  ...MOCK_ROUTE_RESULTS,
  status: 'ready',
  legs: [
    MOCK_ROUTE_RESULTS.legs[0],
    MOCK_ROUTE_RESULTS.legs[1],
    { ...MOCK_ROUTE_RESULTS.legs[2], minutes: 20, o2L: 10, feasible: true, path: [[137.408, -4.765], [137.385, -4.78]] },
  ],
  marginMin: 12.5,
}

afterEach(() => replayOfficialPlan())

describe('buildUserReplay (PORT F5)', () => {
  it('timeline length = core leg minutes + stop dwells', () => {
    const u = buildUserReplay(ready, route)!
    expect(u.totalMin).toBeCloseTo(18.5 + 10 + 26 + 5 + 20)
    expect(u.legEnds).toEqual([18.5, 18.5 + 10 + 26, 18.5 + 10 + 26 + 5 + 20])
    expect(u.marginMin).toBe(12.5)
  })
  it('positions follow the leg paths', () => {
    const u = buildUserReplay(ready, route)!
    expect(replayAt(u, 0)).toMatchObject({ lon: 137.385, lat: -4.78, phase: 'walk', stopId: 'w1' })
    const mid = replayAt(u, 9.25)
    // halfway along leg 0's polyline: on the path, between its first and last vertex
    expect(mid.lon).toBeGreaterThan(137.385)
    expect(mid.lon).toBeLessThan(137.396)
    expect(mid.lat).toBeGreaterThan(-4.78)
    expect(replayAt(u, 18.5 + 10 + 26 + 5 + 20 - 1e-6).lon).toBeCloseTo(137.385, 4)
  })
  it('dwells at each stop for its stopMin, O2 = sum of finished core legs', () => {
    const u = buildUserReplay(ready, route)!
    const a = replayAt(u, 20)
    const b = replayAt(u, 28)
    expect(a).toMatchObject({ phase: 'dwell', stopId: 'w1', lon: 137.396, lat: -4.772, legsDone: 1 })
    expect(b).toMatchObject({ phase: 'dwell', stopId: 'w1', lon: 137.396, lat: -4.772 })
    expect(a.o2UsedL).toBeCloseTo(9.6)
    expect(replayAt(u, 56)).toMatchObject({ phase: 'dwell', stopId: 's3' })
    expect(replayAt(u, 999)).toMatchObject({ phase: 'done', legsDone: 3 })
    expect(replayAt(u, 999).o2UsedL).toBeCloseTo(9.6 + 13.5 + 10)
  })
  it('refuses routes that are not ready or have a leg without minutes', () => {
    expect(buildUserReplay(MOCK_ROUTE_RESULTS, route)).toBeNull() // last leg infeasible (no minutes)
    expect(buildUserReplay({ ...ready, status: 'partial' }, route)).toBeNull()
    expect(buildUserReplay(ready, { ...route, stops: [] })).toBeNull()
  })
})

describe('switching the replay source', () => {
  it('default is the official plan; load switches; back restores', () => {
    expect(userReplay.peek()).toBeNull()
    expect(userReplayPosition(5)).toBeNull()
    const tMax = missionClock.tMax
    missionClock.seek(40)
    expect(loadUserReplay(ready, route)).toBe(true)
    expect(userReplay.peek()?.totalMin).toBeCloseTo(79.5)
    expect(missionClock.t).toBe(0)
    expect(missionClock.playing).toBe(false)
    expect(missionClock.tMax).toBe(tMax) // the scrubber / field EVA term is unchanged
    expect(userReplayPosition(0)).toEqual([137.385, -4.78])
    // the user's replay stops at its own end
    missionClock.seek(200)
    expect(missionClock.t).toBeCloseTo(79.5)
    replayOfficialPlan()
    expect(userReplay.peek()).toBeNull()
    expect(missionClock.t).toBe(0)
    missionClock.seek(200)
    expect(missionClock.t).toBe(Math.min(200, tMax))
    missionClock.seek(0)
  })
  it('a route that cannot replay leaves the official replay on', () => {
    expect(loadUserReplay(MOCK_ROUTE_RESULTS, route)).toBe(false)
    expect(userReplay.peek()).toBeNull()
  })
})
