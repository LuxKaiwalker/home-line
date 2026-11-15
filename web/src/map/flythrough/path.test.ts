// M10 acceptance (WS16 task 10, DESIGN U6 item 2): the flythrough path is smooth and stays on the route.
// Real tree: route_nom_104.geojson + timeline_nom_104.json through WS7's Plan, as the app does.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Plan } from '../../hud/plan'
import { CHASE, FLYTHROUGH, FOLLOW_TURN_DEG_PER_MIN } from '../../story/config'
import { routeLine } from '../route'
import { angleDiff, bearingOf, cameraOffset, catmullRom, chasePitch, chasePose, resample, SmoothPath } from './path'
import { boxSmooth, flightPath, gridMetric } from './route'

const DATA = new URL('../../../public/data/', import.meta.url)
const have = existsSync(new URL('route_nom_104.geojson', DATA))
const read = (p: string) => JSON.parse(readFileSync(new URL(p, DATA), 'utf8'))

/** distance (m) from point q to the polyline (local metres) */
function distToPolyline(q: [number, number], pts: [number, number][]): number {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const L2 = dx * dx + dy * dy
    const u = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2)) : 0
    best = Math.min(best, Math.hypot(q[0] - a[0] - u * dx, q[1] - a[1] - u * dy))
  }
  return best
}

describe('config (design.yaml camera.flythrough)', () => {
  it('reads the DESIGN U6 values', () => {
    expect(FLYTHROUGH).toEqual({ sampleM: 20, spline: 'centripetal_catmull_rom', behindM: 250, aboveM: 175, lookaheadM: 150 })
  })
  it('reads the L10 chase keys (pitch cap 55 = T1, smoothing window, reduced-motion cut)', () => {
    expect(CHASE).toEqual({ maxPitchDeg: 55, smoothMin: 1, reducedCutS: 2 })
  })
})

describe('centripetal Catmull-Rom', () => {
  it('passes through its control points and is straight on a line', () => {
    const p: [number, number][] = [[0, 0], [10, 0], [20, 0], [30, 0]]
    expect(catmullRom(p[0], p[1], p[2], p[3], 0)).toEqual([10, 0])
    const end = catmullRom(p[0], p[1], p[2], p[3], 1)
    expect(end[0]).toBeCloseTo(20, 9)
    for (let u = 0; u <= 1; u += 0.1) expect(catmullRom(p[0], p[1], p[2], p[3], u)[1]).toBeCloseTo(0, 9)
  })
  it('does not loop or overshoot on uneven spacing (centripetal)', () => {
    const p: [number, number][] = [[0, 0], [1, 0], [1, 30], [2, 30]]
    for (let u = 0; u <= 1; u += 0.05) {
      const q = catmullRom(p[0], p[1], p[2], p[3], u)
      expect(q[1]).toBeGreaterThanOrEqual(-1e-9)
      expect(q[1]).toBeLessThanOrEqual(30 + 1e-9)
    }
  })
})

describe.skipIf(!have)('flythrough path on the real route (nom_104)', () => {
  const metric = gridMetric(read('fields/index.json'))
  const plan = new Plan(read('route_nom_104.geojson'), read('timeline_nom_104.json'), metric)
  const line = routeLine(plan)
  const path = new SmoothPath(line, metric, FLYTHROUGH.sampleM)
  const routeXY = line.coords.map((c) => path.toXY(c))

  it('samples every 20 m along the route', () => {
    const { s } = resample(line, 20)
    expect(s[0]).toBe(0)
    expect(s[s.length - 1]).toBeCloseTo(line.length, 6)
    for (let i = 1; i < s.length - 1; i++) expect(s[i] - s[i - 1]).toBeCloseTo(20, 9)
    expect(path.samples.pts.length).toBeGreaterThan(100)
  })

  it('stays on the route within one field cell (5 m) everywhere', () => {
    let worst = 0
    for (let s = 0; s <= path.length; s += 2) worst = Math.max(worst, distToPolyline(path.xyAt(s), routeXY))
    expect(worst).toBeLessThan(5)
  })

  it('starts at the pad end of the route and ends at its last point', () => {
    const a = path.at(0)
    const b = path.at(path.length)
    expect(a[0]).toBeCloseTo(line.coords[0][0], 9)
    expect(b[1]).toBeCloseTo(line.coords[line.coords.length - 1][1], 9)
  })

  it('is smooth: the path never jumps', () => {
    const ds = 1
    let maxStep = 0
    for (let s = ds; s <= path.length; s += ds) {
      const q0 = path.xyAt(s - ds)
      const q1 = path.xyAt(s)
      maxStep = Math.max(maxStep, Math.hypot(q1[0] - q0[0], q1[1] - q0[1]))
    }
    // position moves at most ~ds per metre of route (no teleport, no loop)
    expect(maxStep).toBeLessThan(ds * 1.5)
  })

  it('the follow camera never snaps: bearing turns <= FOLLOW_TURN_DEG_PER_MIN, look-at and camera move continuously', () => {
    const fp = flightPath(plan, metric, 'nom_104')
    const dt = 0.01 // EVA minutes (0.6 s): finer than any playback frame at speed <= 1 min/frame
    let prev = fp.poseAt(0)
    let maxTurn = 0
    let maxMove = 0
    let maxCamMove = 0
    for (let t = dt; t <= plan.tEnd + 1; t += dt) {
      const p = fp.poseAt(t)
      maxTurn = Math.max(maxTurn, Math.abs(angleDiff(prev.bearing, p.bearing)))
      const a = path.toXY(prev.target)
      const b = path.toXY(p.target)
      maxMove = Math.max(maxMove, Math.hypot(b[0] - a[0], b[1] - a[1]))
      const ca = path.toXY(cameraOffset(prev, metric).cam)
      const cb = path.toXY(cameraOffset(p, metric).cam)
      maxCamMove = Math.max(maxCamMove, Math.hypot(cb[0] - ca[0], cb[1] - ca[1]))
      prev = p
    }
    expect(maxTurn).toBeLessThanOrEqual(FOLLOW_TURN_DEG_PER_MIN * dt + 1e-6)
    // walking 0.98 m/s for 0.6 s; the look-at point moves at most a few metres per step
    expect(maxMove).toBeLessThan(3)
    // the camera swings on a 250 m arm: <= 250 m x turn (rad) + the look-at move
    expect(maxCamMove).toBeLessThan(250 * ((FOLLOW_TURN_DEG_PER_MIN * dt * Math.PI) / 180) + 3)
  })

  it('L10 chase camera: looks at the crew from 250 m behind and 175 m above (pitch 55°), along the route', () => {
    const fp = flightPath(plan, metric, 'nom_104')
    const t = 20 // walking to S7
    const st = plan.stateAt(t)
    expect(st.phase).toBe('walk')
    const pose = fp.poseAt(t)
    const crew = path.xyAt(st.distanceWalkedM)
    const look = path.toXY(pose.target)
    // the look-at point is the crew (smoothed anchor: within a few metres at a steady pace)
    expect(Math.hypot(look[0] - crew[0], look[1] - crew[1])).toBeLessThan(5)
    expect(pose.altM).toBe(175)
    expect(pose.pitch).toBeCloseTo(55, 6)
    expect(pose.pitch).toBeLessThanOrEqual(CHASE.maxPitchDeg)
    const { cam, horizM } = cameraOffset(pose, metric)
    expect(horizM).toBeCloseTo(175 * Math.tan((55 * Math.PI) / 180), 6) // = 250 m (atan(250/175) = 55.008°, capped at 55)
    expect(horizM).toBeGreaterThan(249)
    const c = path.toXY(cam)
    // the camera is behind the crew: 250 m from it, and farther from the look-ahead point than the crew is
    expect(Math.hypot(c[0] - crew[0], c[1] - crew[1])).toBeGreaterThan(245)
    const ahead = path.xyAt(st.distanceWalkedM + 150)
    expect(Math.hypot(c[0] - ahead[0], c[1] - ahead[1])).toBeGreaterThan(Math.hypot(c[0] - crew[0], c[1] - crew[1]))
    // looking ahead along the route: the bearing points from the crew towards the look-ahead point (± the turn-rate lag)
    const want = bearingOf(ahead[0] - crew[0], ahead[1] - crew[1])
    expect(Math.abs(angleDiff(pose.bearing, want))).toBeLessThan(30)
  })

  it('L10: the crew marker sits on the planned position and in the middle of the chase view at every walking minute', () => {
    const fp = flightPath(plan, metric, 'nom_104')
    let worst = 0
    for (let t = 0; t <= plan.tEnd; t += 0.5) {
      const st = plan.stateAt(t)
      expect(fp.crewAt(t)).toEqual([st.lon, st.lat])
      const a = path.toXY(fp.crewAt(t))
      const b = path.toXY(fp.poseAt(t).target)
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]))
    }
    // smoothing over 1 EVA min at <= ~1.5 m/s plus the 20 m spline vs the polyline: far inside the
    // ~120 m of ground between the screen centre and the bottom edge at 55° from 175 m
    expect(worst).toBeLessThan(40)
  })

  it('L10: the pitch is capped (max_pitch_deg) whatever the arm', () => {
    const fp = flightPath(plan, metric, 'nom_104')
    for (let t = 0; t <= plan.tEnd + 30; t += 0.25) expect(fp.poseAt(t).pitch).toBeLessThanOrEqual(55)
    const steep = { behindM: 400, aboveM: 100, lookaheadM: 150, maxPitchDeg: 55 }
    expect(chasePitch(steep)).toBe(55)
    expect(chasePose(path, 500, steep).pitch).toBe(55)
    expect(chasePitch({ ...steep, behindM: 100, aboveM: 100 })).toBeCloseTo(45, 9)
  })

  it('L10: the camera anchor is smoothed: no kink at station arrivals and departures', () => {
    const fp = flightPath(plan, metric, 'nom_104')
    const dt = 0.05
    // acceleration of the anchor along the route (m/min²): raw distance has a step in speed at each
    // arrival (≈ 60 m/min -> 0 within one sample); the 1-min box spreads it over a minute
    let rawMax = 0
    let smMax = 0
    for (let t = 2 * dt; t <= plan.tEnd; t += dt) {
      const r = (k: number): number => plan.stateAt(t - k * dt).distanceWalkedM
      const g = (k: number): number => fp.anchorAt(t - k * dt)
      rawMax = Math.max(rawMax, Math.abs(r(0) - 2 * r(1) + r(2)) / (dt * dt))
      smMax = Math.max(smMax, Math.abs(g(0) - 2 * g(1) + g(2)) / (dt * dt))
    }
    expect(smMax).toBeLessThan(rawMax / 5)
    // a steady pace is not lagged: mid-leg the anchor is within a few metres of the crew
    const leg = plan.legs[0]
    const mid = (leg.t0 + leg.t1) / 2
    expect(Math.abs(fp.anchorAt(mid) - plan.stateAt(mid).distanceWalkedM)).toBeLessThan(5)
  })

  it('the timeline scrubs it: dwells hold the look-at point (the camera may swing round), the clock end parks it', () => {
    const fp = flightPath(plan, metric, 'nom_104')
    const dwell = plan.dwells[0]
    expect(fp.poseAt(dwell.t0 + 1).target).toEqual(fp.poseAt(dwell.t1 - 1).target)
    expect(fp.poseAt(plan.tEnd + 15)).toEqual(fp.poseAt(plan.tEnd + 60))
    // scrubbing is a pure function of t: the same minute twice gives the same pose
    expect(flightPath(plan, metric, 'nom_104').poseAt(123.456)).toEqual(fp.poseAt(123.456))
  })
})

describe('L10 boxSmooth (camera anchor smoothing)', () => {
  it('keeps a straight line, flattens a kink, holds the ends, is a pure function of t', () => {
    const lin = boxSmooth((t) => 3 * t, 10, 0.05, 1)
    for (const t of [1, 2.5, 5, 9]) expect(lin(t)).toBeCloseTo(3 * t, 9)
    const kink = (t: number): number => Math.min(t, 5) // walk, then stop at t = 5
    const sm = boxSmooth(kink, 10, 0.05, 1)
    expect(sm(5)).toBeLessThan(5)
    expect(sm(5)).toBeGreaterThan(4.8)
    expect(sm(8)).toBeCloseTo(5, 9)
    expect(sm(0)).toBeCloseTo(boxSmooth(kink, 10, 0.05, 1)(0), 12)
    expect(boxSmooth(kink, 10, 0.05, 0)).toBe(kink)
  })
})
