import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { getRouteResults, IDLE_ROUTE_RESULTS, MOCK_ROUTE_RESULTS, publishRouteResults, resetRouteResults, subscribeRouteResults, type RouteResults } from './routeResults'

afterEach(() => resetRouteResults())

describe('route results (interfaces §9)', () => {
  it('starts idle with no legs', () => {
    const r = getRouteResults()
    expect(r).toBe(IDLE_ROUTE_RESULTS)
    expect(r.status).toBe('idle')
    expect(r.legs).toEqual([])
    expect(r.totalMinutes).toBeNull()
    expect(r.marginMin).toBeNull()
  })

  it('publish → get and subscribers; unsubscribe stops; same object is a no-op', () => {
    const seen: RouteResults[] = []
    const off = subscribeRouteResults((r) => seen.push(r))
    publishRouteResults(MOCK_ROUTE_RESULTS)
    expect(getRouteResults()).toBe(MOCK_ROUTE_RESULTS)
    publishRouteResults(MOCK_ROUTE_RESULTS)
    expect(seen).toEqual([MOCK_ROUTE_RESULTS])
    const next: RouteResults = { ...MOCK_ROUTE_RESULTS, seq: 2, status: 'computing' }
    publishRouteResults(next)
    expect(seen.length).toBe(2)
    off()
    resetRouteResults()
    expect(seen.length).toBe(2)
    expect(getRouteResults().status).toBe('idle')
  })

  it('MOCK_ROUTE_RESULTS: 3 legs, last infeasible, consistent', () => {
    const m = MOCK_ROUTE_RESULTS
    expect(m.legs).toHaveLength(3)
    expect(m.legs.map((l) => l.index)).toEqual([0, 1, 2])
    expect(m.legs[2].feasible).toBe(false)
    expect(m.legs[2].reason).toBeTruthy()
    expect(m.firstInfeasibleLeg).toBe(2)
    expect(m.legs.slice(0, 2).every((l) => l.feasible && l.path.length > 1)).toBe(true)
    for (let i = 1; i < 3; i++) expect(m.legs[i].fromStopId).toBe(m.legs[i - 1].toStopId)
    expect(m.totalMinutes).toBeCloseTo((m.legs[0].minutes ?? 0) + (m.legs[1].minutes ?? 0))
    expect(m.fastRoute).toBe(true)
  })

  it('imports nothing from edit/route (isolation §7b)', () => {
    const src = readFileSync(new URL('./routeResults.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/from\s+['"][^'"]*edit\/route/)
    expect(src).not.toMatch(/import\(\s*['"][^'"]*edit\/route/)
  })
})
