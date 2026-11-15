import { describe, expect, it } from 'vitest'
import { makeStop, PLAN_TAGS, type PlanStop } from '../../../state/planning'
import { clampStopMin, displayLabels, legsForStops, STOP_MIN_MAX, stopSummary, toggleTag } from './model'
import { MOCK_ROUTE_RESULTS, type RouteResults } from './routeResults'
import own from './copy.list.json'

const W1 = makeStop({ id: 'w1', kind: 'point', lon: 137.39, lat: -4.776 })
const S3 = makeStop({ id: 's3', kind: 'station', station: 'S3' })

describe('stop time bounds', () => {
  it('max is one whole EVA from config/crew.yaml (8 h = 480 min)', () => {
    expect(STOP_MIN_MAX).toBe(480)
  })
  it('clamps to 0 … STOP_MIN_MAX; garbage is 0', () => {
    expect(clampStopMin(15)).toBe(15)
    expect(clampStopMin(-5)).toBe(0)
    expect(clampStopMin(0)).toBe(0)
    expect(clampStopMin(NaN)).toBe(0)
    expect(clampStopMin(Infinity)).toBe(0)
    expect(clampStopMin(STOP_MIN_MAX + 1)).toBe(STOP_MIN_MAX)
    expect(clampStopMin(12.5)).toBe(12.5)
  })
})

describe('toggleTag', () => {
  it('adds and removes, always in PLAN_TAGS order', () => {
    expect(toggleTag([], 'Photo')).toEqual(['Photo'])
    expect(toggleTag(['Photo'], 'Sample')).toEqual(['Sample', 'Photo'])
    expect(toggleTag(['Sample', 'Photo'], 'Sample')).toEqual(['Photo'])
    expect(toggleTag([...PLAN_TAGS].reverse(), 'Rest')).toEqual(PLAN_TAGS.filter((t) => t !== 'Rest'))
  })
})

describe('labels', () => {
  it('station names from config, W1… for points, user names win', () => {
    const named = makeStop({ id: 'p2', kind: 'point', lon: 1, lat: 2, name: 'Cache' })
    const labels = displayLabels([W1, S3, named], (id) => (id === 'S3' ? 'Nodule census' : undefined))
    expect(labels).toEqual(['W1', 'Nodule census', 'Cache'])
    expect(displayLabels([S3], () => undefined)).toEqual(['S3'])
  })
})

describe('legsForStops (§9 results → rows)', () => {
  const stops: PlanStop[] = [W1, S3]
  it('MOCK_ROUTE_RESULTS: estimates into w1 and s3, the walk home infeasible (budget)', () => {
    const l = legsForStops(stops, MOCK_ROUTE_RESULTS, 'official')
    expect(l.into).toEqual([
      { kind: 'ok', minutes: 18.5 },
      { kind: 'ok', minutes: 26.0 },
    ])
    expect(l.home).toEqual({ kind: 'infeasible', reason: 'budget' })
  })
  it('marks the stop whose incoming leg is infeasible', () => {
    const r: RouteResults = { ...MOCK_ROUTE_RESULTS, legs: MOCK_ROUTE_RESULTS.legs.map((g) => (g.index === 1 ? { ...g, feasible: false, minutes: null, reason: 'slope' } : g)), firstInfeasibleLeg: 1 }
    const l = legsForStops(stops, r, 'official')
    expect(l.into[0].kind).toBe('ok')
    expect(l.into[1]).toEqual({ kind: 'infeasible', reason: 'slope' })
  })
  it('stale results (another order) mark nothing wrongly', () => {
    const l = legsForStops([S3, W1], MOCK_ROUTE_RESULTS, 'official')
    expect(l.into.every((x) => x.kind === 'none')).toBe(true)
    expect(l.home.kind).toBe('none')
  })
  it('computing → missing legs show computing; another pad or idle → nothing', () => {
    expect(legsForStops(stops, { ...MOCK_ROUTE_RESULTS, status: 'computing', legs: [] }, 'official').into[0].kind).toBe('computing')
    expect(legsForStops(stops, MOCK_ROUTE_RESULTS, 'rank2').into[0].kind).toBe('none')
    expect(legsForStops(stops, { ...MOCK_ROUTE_RESULTS, status: 'idle' }, 'official').home.kind).toBe('none')
  })
})

describe('summary + copy', () => {
  it('summary joins stop time, tags, note', () => {
    const s = { ...W1, stopMin: 10, tags: ['Photo' as const], note: ' look ' }
    expect(stopSummary(s, (m) => `stop ${m} min`)).toBe('stop 10 min · Photo · look')
    expect(stopSummary(W1, () => 'x')).toBe('')
  })
  it('copy.list.json follows the copy.json rules: no digits, no "waypoint", camelCase keys', () => {
    const leaves: [string, string][] = []
    const walk = (n: unknown, p: string) => {
      if (typeof n === 'string') leaves.push([p, n])
      else for (const [k, v] of Object.entries(n as object)) (expect(k).toMatch(/^[a-z][A-Za-z0-9]*$/), walk(v, p ? `${p}.${k}` : k))
    }
    walk(own, '')
    for (const [p, s] of leaves) {
      const rest = s.replace(/\{[a-z][a-z0-9_]*\}/g, '')
      expect(/\p{Nd}/u.test(rest), p).toBe(false)
      expect(/[{}]/.test(rest), p).toBe(false)
      expect(/waypoint/i.test(s), p).toBe(false)
      expect(s.trim(), p).toBe(s)
    }
  })
})
