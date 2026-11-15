// PORT I2: Fly replays "your route" (userRoute.ts).
import { describe, expect, it } from 'vitest'
import { Plan } from '../../hud/plan'
import { createPlanningStore } from '../../state/planning'
import type { LegResult, RouteResults } from '../../state/routeResults'
import { userFlight } from './userRoute'
import { t } from '../../ui/copy'

const metric = { mPerDegLon: 59000, mPerDegLat: 59000 }
const leg = (index: number, from: string, to: string, minutes: number | null, path: [number, number][]): LegResult => ({ index, fromStopId: from, toStopId: to, minutes, o2L: null, distanceM: null, feasible: true, path, mode: 'fast', refined: false })

function setup() {
  const s = createPlanningStore()
  s.setPad('rank2')
  s.addStop({ kind: 'station', station: 'st1', stopMin: 15 })
  s.addStop({ kind: 'point', lon: 137.42, lat: -4.7 })
  const [a, b] = s.doc.peek().route.stops
  const r: RouteResults = {
    seq: 1,
    padId: 'rank2',
    status: 'ready',
    legs: [
      leg(0, 'pad', a.id, 20, [[137.4, -4.72], [137.41, -4.71]]),
      leg(1, a.id, b.id, 10, [[137.41, -4.71], [137.42, -4.7]]),
      leg(2, b.id, 'pad', 25, [[137.42, -4.7], [137.41, -4.715], [137.4, -4.72]]),
    ],
    totalMinutes: 70,
    marginMin: 5,
    firstInfeasibleLeg: null,
    fastRoute: true,
  }
  return { s, r }
}

describe('userFlight', () => {
  it('legs + stop times become a timeline the flythrough Plan flies', () => {
    const { s, r } = setup()
    const f = userFlight(r, s.doc.peek().route, 'rank2')!
    expect(f.route.features).toHaveLength(3)
    expect(f.timeline.map((e) => [e.t_min, e.event])).toEqual([
      [0, 'depart'],
      [20, 'arrive'],
      [35, 'leave'], // 15 min at st1
      [45, 'arrive'],
      [45, 'leave'], // 0 min at the free point
      [70, 'arrive_home'],
    ])
    const plan = new Plan(f.route, f.timeline, metric)
    expect(plan.tEnd).toBe(70)
    expect(plan.legs).toHaveLength(3)
    const mid = plan.stateAt(25)
    expect([mid.lon, mid.lat]).toEqual([137.41, -4.71]) // dwelling at st1
    expect(f.timeline.every((e) => e.o2_left_L === null && e.margin_min === null)).toBe(true) // estimates only
  })

  it('nothing to fly: no stops, not computed, a leg missing, another pad', () => {
    const { s, r } = setup()
    const route = s.doc.peek().route
    expect(userFlight(r, { ...route, stops: [] })).toBe(null)
    expect(userFlight({ ...r, status: 'computing' }, route)).toBe(null)
    expect(userFlight({ ...r, legs: r.legs.slice(0, 2) }, route)).toBe(null)
    expect(userFlight({ ...r, legs: r.legs.map((l, i) => (i === 1 ? { ...l, minutes: null } : l)) }, route)).toBe(null)
    expect(userFlight(r, route, 'rank3')).toBe(null)
    expect(userFlight({ ...r, status: 'partial' }, route)).not.toBe(null)
  })
})

// PORT I5: during a "Your route" flight the HUD and the crew marker still follow the official timeline;
// the toggle's tip must say so, so nothing is mislabelled
describe('"Your route" toggle copy', () => {
  it('says the camera follows your route while the HUD numbers stay the official plan\'s (Estimate)', () => {
    const tip = t('route.fly.mineTip')
    expect(tip).toContain('Estimate')
    expect(tip).toMatch(/camera follows your route/)
    expect(tip).toMatch(/HUD numbers .*stay the official plan/)
    expect(t('route.fly.mine')).toBe('Your route')
  })
})
