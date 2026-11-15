// PORT F5: "Load into replay". The user's computed route (state/routeResults.ts, status 'ready') becomes
// a replay timeline for the mission clock, like map/flythrough/userRoute.ts (I2) turns it into a flight:
// walk segments along each leg path for the leg's core minutes, a dwell at every stop for its stopMin
// (planning store), pad -> stops -> pad. Timeline length = sum of the core leg minutes + the stop dwells.
// Numbers are the core's only (leg minutes, leg O2, the four-term margin); the UI labels them "Estimate".
// O2 is shown as the sum of the core's leg O2 for the legs finished so far (no interpolation).
// The default stays the official replay: nothing changes until loadUserReplay() is called (the value
// snapshot is unchanged). The scrubber keeps its length (clock tMax = EVA length, shared with the field's
// EVA term); the user replay stops itself at its own end.
import type { PlanningRoute } from './planning'
import type { RouteResults } from './routeResults'
import { missionClock, mission } from './mission'
import { batch, signal } from './signal'

export interface ReplaySegment {
  kind: 'walk' | 'dwell'
  t0: number
  t1: number
  /** leg index (walk) or the leg that arrived at the stop (dwell) */
  leg: number
  /** walk: destination stop id (null = back at the pad); dwell: the stop */
  stopId: string | null
  /** walk: lon/lat path; dwell: the one point */
  path: [number, number][]
  /** walk: cumulative planar length along path (deg units, cos(lat) scaled), last = total */
  cum: number[]
}

export interface UserReplay {
  seq: number
  padId: string
  /** timeline length (min) = core leg minutes + stop dwells */
  totalMin: number
  segments: ReplaySegment[]
  /** end time of each leg (min) and the core's O2 of each leg (L) */
  legEnds: number[]
  legO2L: (number | null)[]
  /** the core's four-term margin (min); null when the core gave none */
  marginMin: number | null
}

export interface ReplayState {
  t: number
  lon: number
  lat: number
  phase: 'walk' | 'dwell' | 'done'
  stopId: string | null
  /** legs finished at t */
  legsDone: number
  /** sum of the core's leg O2 over the finished legs (L); null if any of them has none */
  o2UsedL: number | null
}

function cumLen(path: [number, number][]): number[] {
  const out = [0]
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]
    const [x1, y1] = path[i]
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180)
    out.push(out[i - 1] + Math.hypot((x1 - x0) * k, y1 - y0))
  }
  return out
}

/** The user's route as a replay timeline, or null when it cannot be replayed (not 'ready', no stops,
 *  a leg without minutes or path, legs not pad -> every stop -> pad). */
export function buildUserReplay(r: RouteResults, route: PlanningRoute): UserReplay | null {
  if (r.status !== 'ready' || !route.stops.length || !r.legs.length) return null
  const legs = [...r.legs].sort((a, b) => a.index - b.index)
  if (legs.length !== route.stops.length + 1) return null
  if (legs.some((l) => l.minutes === null || !(l.minutes >= 0) || l.path.length < 2)) return null
  const stopMin = new Map(route.stops.map((s) => [s.id, s.stopMin]))
  const segments: ReplaySegment[] = []
  const legEnds: number[] = []
  let t = 0
  legs.forEach((l, i) => {
    const last = i === legs.length - 1
    const path = l.path.map(([x, y]) => [x, y] as [number, number])
    const t1 = t + (l.minutes as number)
    segments.push({ kind: 'walk', t0: t, t1, leg: i, stopId: last ? null : l.toStopId, path, cum: cumLen(path) })
    legEnds.push(t1)
    t = t1
    if (!last) {
      const d = Math.max(0, stopMin.get(l.toStopId) ?? 0)
      const end = path[path.length - 1]
      if (d > 0) segments.push({ kind: 'dwell', t0: t, t1: t + d, leg: i, stopId: l.toStopId, path: [end], cum: [0] })
      t += d
    }
  })
  return { seq: r.seq, padId: r.padId, totalMin: t, segments, legEnds, legO2L: legs.map((l) => l.o2L), marginMin: r.marginMin }
}

function along(s: ReplaySegment, f: number): [number, number] {
  const total = s.cum[s.cum.length - 1]
  if (s.path.length === 1 || total <= 0) return f >= 1 ? s.path[s.path.length - 1] : s.path[0]
  const d = Math.min(1, Math.max(0, f)) * total
  let i = 1
  while (i < s.cum.length - 1 && s.cum[i] < d) i++
  const seg = s.cum[i] - s.cum[i - 1]
  const g = seg > 0 ? (d - s.cum[i - 1]) / seg : 1
  const [x0, y0] = s.path[i - 1]
  const [x1, y1] = s.path[i]
  return [x0 + (x1 - x0) * g, y0 + (y1 - y0) * g]
}

/** Where the crew is at EVA minute t on the user's route (clamped to [0, totalMin]). */
export function replayAt(u: UserReplay, tIn: number): ReplayState {
  const t = Math.min(u.totalMin, Math.max(0, tIn))
  const legsDone = u.legEnds.filter((e) => e <= t + 1e-9).length
  const done = u.legO2L.slice(0, legsDone)
  const o2UsedL = done.some((x) => x === null) ? null : done.reduce<number>((a, b) => a + (b as number), 0)
  if (tIn >= u.totalMin) {
    const last = u.segments[u.segments.length - 1]
    const [lon, lat] = last.path[last.path.length - 1]
    return { t, lon, lat, phase: 'done', stopId: null, legsDone, o2UsedL }
  }
  const s = u.segments.find((x) => t >= x.t0 && t < x.t1) ?? u.segments[u.segments.length - 1]
  const [lon, lat] = s.kind === 'dwell' ? s.path[0] : along(s, s.t1 > s.t0 ? (t - s.t0) / (s.t1 - s.t0) : 1)
  return { t, lon, lat, phase: s.kind, stopId: s.stopId, legsDone, o2UsedL }
}

// ---- the replay source: official plan (default) or the user's loaded route -------------------------

/** null = the official plan (default). */
export const userReplay = signal<UserReplay | null>(null)

let offClock: (() => void) | null = null

/** Switch the replay player to the user's route (paused at 00:00). false when it cannot be replayed. */
export function loadUserReplay(r: RouteResults, route: PlanningRoute): boolean {
  const u = buildUserReplay(r, route)
  if (!u) return false
  batch(() => {
    missionClock.pause()
    missionClock.seek(0)
    userReplay.value = u
  })
  offClock?.()
  // the user's timeline ends before the scrubber does: stop there; Play at the end starts again at 00:00
  const offT = mission.clock.t.subscribe((t) => {
    const cur = userReplay.peek()
    if (cur && t > cur.totalMin) {
      missionClock.pause()
      missionClock.seek(cur.totalMin)
    }
  })
  const offP = mission.clock.playing.subscribe((p) => {
    const cur = userReplay.peek()
    if (p && cur && missionClock.t >= cur.totalMin - 1e-9) missionClock.seek(0)
  })
  offClock = () => {
    offT()
    offP()
  }
  return true
}

/** Back to the official plan's replay (paused at 00:00). */
export function replayOfficialPlan(): void {
  offClock?.()
  offClock = null
  batch(() => {
    missionClock.pause()
    missionClock.seek(0)
    userReplay.value = null
  })
}

/** The crew position the map draws during the user's replay; null = official replay. */
export function userReplayPosition(t: number): [number, number] | null {
  const u = userReplay.peek()
  if (!u) return null
  const s = replayAt(u, t)
  return [s.lon, s.lat]
}
