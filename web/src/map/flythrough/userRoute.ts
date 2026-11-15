// PORT I2 (stretch): Fly replays "your route". The user's computed route (state/routeResults.ts legs,
// planning stop ids) becomes a Plan-shaped route + timeline the flythrough already flies: one LineString
// per leg (pad -> stops -> pad), 'depart' / 'arrive' / 'leave' / 'arrive_home' events at the leg
// minutes of the route core, the stop time of each stop (planning store stopMin) as the dwell.
// Estimates only: no official number is read or written here; o2 / margin rows stay null.
// The choice is the small "Your route" toggle in the flythrough control (flyMine, off by default).
import type { PlanningRoute } from '../../state/planning'
import type { RouteResults } from '../../state/routeResults'
import { signal } from '../../state/signal'
import type { RouteFC, TimelineEvent } from '../../hud/types'

/** The flythrough flies the user's route (when one is computed) instead of the official one. */
export const flyMine = signal(false)

export interface UserFlight {
  route: RouteFC
  timeline: TimelineEvent[]
}

const ev = (t_min: number, event: string, station: string | null): TimelineEvent => ({ t_min, event, station, o2_left_L: null, t_home_min: null, margin_min: null })

/**
 * The user's route as a flight, or null when there is none to fly: no stops, not computed yet
 * (status not 'ready' / 'partial'), a leg without minutes or path, or results of another pad.
 */
export function userFlight(r: RouteResults, route: PlanningRoute, padId?: string): UserFlight | null {
  if (!route.stops.length || !r.legs.length) return null
  if (r.status !== 'ready' && r.status !== 'partial') return null
  if (padId !== undefined && r.padId !== padId) return null
  const legs = [...r.legs].sort((a, b) => a.index - b.index)
  if (legs.length !== route.stops.length + 1) return null // pad -> every stop -> pad
  if (legs.some((l) => l.minutes === null || !(l.minutes >= 0) || l.path.length < 2)) return null
  const stopMin = new Map(route.stops.map((s) => [s.id, s.stopMin]))
  const timeline: TimelineEvent[] = []
  const features: RouteFC['features'] = []
  let t = 0
  legs.forEach((l, i) => {
    const last = i === legs.length - 1
    timeline.push(ev(t, i === 0 ? 'depart' : 'leave', i === 0 ? null : l.fromStopId))
    t += l.minutes as number
    timeline.push(ev(t, last ? 'arrive_home' : 'arrive', last ? null : l.toStopId))
    if (!last) t += Math.max(0, stopMin.get(l.toStopId) ?? 0)
    features.push({ type: 'Feature', properties: { leg: i }, geometry: { type: 'LineString', coordinates: l.path.map(([x, y]) => [x, y]) } })
  })
  return { route: { type: 'FeatureCollection', features }, timeline }
}
