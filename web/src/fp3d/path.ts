// Camera path "on rails" (pure). The route (route_{scenario}.geojson, WS2; contract route v1.1.0)
// gives the legs. Leg times, in order of preference:
//   1. times_min[]: EVA time at every vertex (WS2 traverse.py) -> exact per-vertex timing;
//   2. t_start_min / t_end_min, or t_start + t_min (duration) -> constant speed along the leg;
//   3. the timeline (timeline_{scenario}.json): departure and station "leave" events.
// Between legs the crew dwells at the station.
import { lonLatToXY, type Eqc } from './geo'

export interface TimelineEvent {
  t_min: number
  event: string
  station: string | null
}

interface Leg {
  from: string | null
  to: string | null
  xs: number[]
  ys: number[]
  cum: number[] // cumulative length at each vertex
  ts: number[] // EVA minute at each vertex (non-decreasing)
  length: number
  t0: number
  t1: number
}

export interface Pose {
  x: number
  y: number
  /** Heading, degrees clockwise from grid north. */
  headingDeg: number
  tMin: number
  leg: number
  /** Station id while dwelling (between legs), else null. */
  dwellAt: string | null
}

type Feature = {
  geometry: { type: string; coordinates: unknown }
  properties?: Record<string, unknown> | null
}

function lines(geom: Feature['geometry']): number[][][] {
  if (geom.type === 'LineString') return [geom.coordinates as number[][]]
  if (geom.type === 'MultiLineString') return geom.coordinates as number[][][]
  return []
}

const numOr = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const strOr = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export class RoutePath {
  readonly legs: Leg[]
  readonly startMin: number
  readonly endMin: number
  private readonly lookAheadM: number

  constructor(legs: Leg[], lookAheadM: number) {
    if (legs.length === 0) throw new Error('route has no legs')
    this.legs = legs
    this.startMin = legs[0].t0
    this.endMin = legs[legs.length - 1].t1
    this.lookAheadM = lookAheadM
  }

  get lengthM(): number {
    return this.legs.reduce((s, l) => s + l.length, 0)
  }

  /** Point at arc length s along leg k, extended into the following legs (clamped at the end). */
  pointAlong(k: number, s: number): [number, number] {
    while (k < this.legs.length - 1 && s > this.legs[k].length) {
      s -= this.legs[k].length
      k += 1
    }
    const leg = this.legs[k]
    s = Math.min(Math.max(s, 0), leg.length)
    let v = 1
    while (v < leg.cum.length - 1 && leg.cum[v] < s) v++
    const seg = leg.cum[v] - leg.cum[v - 1]
    const f = seg > 0 ? (s - leg.cum[v - 1]) / seg : 0
    return [leg.xs[v - 1] + f * (leg.xs[v] - leg.xs[v - 1]), leg.ys[v - 1] + f * (leg.ys[v] - leg.ys[v - 1])]
  }

  private heading(k: number, s: number, x: number, y: number): number {
    let [ax, ay] = this.pointAlong(k, s + this.lookAheadM)
    if (Math.hypot(ax - x, ay - y) < 1e-6) {
      // at the very end: look back along the route instead
      const [bx, by] = this.pointAlong(k, s - this.lookAheadM)
      ax = 2 * x - bx
      ay = 2 * y - by
    }
    const h = (Math.atan2(ax - x, ay - y) * 180) / Math.PI
    return (h + 360) % 360
  }

  /** Arc length along leg k at EVA minute t (t inside [t0, t1]). */
  private arcAt(leg: Leg, t: number): number {
    const ts = leg.ts
    let v = 1
    while (v < ts.length - 1 && ts[v] < t) v++
    const dt = ts[v] - ts[v - 1]
    const f = dt > 0 ? Math.min(1, Math.max(0, (t - ts[v - 1]) / dt)) : 1
    return leg.cum[v - 1] + f * (leg.cum[v] - leg.cum[v - 1])
  }

  poseAt(tMin: number): Pose {
    const t = Math.min(Math.max(tMin, this.startMin), this.endMin)
    for (let k = 0; k < this.legs.length; k++) {
      const leg = this.legs[k]
      if (t < leg.t0) {
        // dwelling at the end of the previous leg (k >= 1 because t >= startMin = legs[0].t0)
        const prev = this.legs[k - 1]
        const [x, y] = this.pointAlong(k - 1, prev.length)
        return { x, y, headingDeg: this.heading(k, 0, x, y), tMin: t, leg: k - 1, dwellAt: prev.to }
      }
      if (t <= leg.t1) {
        const s = this.arcAt(leg, t)
        const [x, y] = this.pointAlong(k, s)
        return { x, y, headingDeg: this.heading(k, s, x, y), tMin: t, leg: k, dwellAt: null }
      }
    }
    const k = this.legs.length - 1
    const [x, y] = this.pointAlong(k, this.legs[k].length)
    return { x, y, headingDeg: this.heading(k, this.legs[k].length, x, y), tMin: t, leg: k, dwellAt: null }
  }

  /** Sample the route every `stepM` metres of arc, plus every vertex (for the eye-height check). */
  samples(stepM: number): [number, number][] {
    const out: [number, number][] = []
    this.legs.forEach((leg, k) => {
      for (let s = 0; s <= leg.length; s += stepM) out.push(this.pointAlong(k, s))
      for (let v = 0; v < leg.xs.length; v++) out.push([leg.xs[v], leg.ys[v]])
    })
    return out
  }
}

/** Build the camera path from route + timeline. Throws when leg times cannot be determined. */
export function buildRoute(
  fc: { features: Feature[] },
  timeline: TimelineEvent[] | null,
  eqc: Eqc,
  lookAheadM: number,
): RoutePath {
  const ev = timeline ?? []
  const depart = ev.find((e) => e.event === 'depart')
  const leaveOf = (st: string | null) =>
    st === null ? undefined : ev.find((e) => e.event === 'leave' && e.station === st)?.t_min
  const legs: Leg[] = []
  let prevEnd: number | undefined
  fc.features.forEach((f, k) => {
    const p = f.properties ?? {}
    const parts = lines(f.geometry)
    const timesAll = Array.isArray(p.times_min) ? (p.times_min as unknown[]) : null
    for (const coords of parts) {
      if (coords.length < 2) continue
      const xs: number[] = []
      const ys: number[] = []
      for (const c of coords) {
        const [x, y] = lonLatToXY(eqc, c[0], c[1])
        xs.push(x)
        ys.push(y)
      }
      const cum = [0]
      for (let v = 1; v < xs.length; v++) cum.push(cum[v - 1] + Math.hypot(xs[v] - xs[v - 1], ys[v] - ys[v - 1]))
      const length = cum[cum.length - 1]
      const from = strOr(p.from)
      const to = strOr(p.to)
      let ts: number[] | null = null
      if (parts.length === 1 && timesAll && timesAll.length === coords.length && timesAll.every((t) => numOr(t) !== undefined)) {
        const tt = timesAll as number[]
        if (tt.every((t, v) => v === 0 || t >= tt[v - 1])) ts = tt.slice()
      }
      let t0: number | undefined
      let t1: number | undefined
      if (ts) {
        t0 = ts[0]
        t1 = ts[ts.length - 1]
      } else {
        t0 = numOr(p.t_start_min) ?? (legs.length === 0 ? (depart?.t_min ?? 0) : (leaveOf(from) ?? prevEnd))
        const dur = numOr(p.t_min)
        t1 = numOr(p.t_end_min) ?? (t0 !== undefined && dur !== undefined ? t0 + dur : undefined)
      }
      if (t0 === undefined || t1 === undefined || !(t1 >= t0)) {
        throw new Error(`route leg ${k}: cannot determine its start/end time`)
      }
      if (!ts) {
        const a = t0
        const b = t1
        ts = cum.map((c) => (length > 0 ? a + ((b - a) * c) / length : b))
      }
      legs.push({ from, to, xs, ys, cum, ts, length, t0, t1 })
      prevEnd = t1
    }
  })
  return new RoutePath(legs, lookAheadM)
}
