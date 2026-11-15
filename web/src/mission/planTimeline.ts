// The planned EVA in the timeline dock's style (user 2026-11-15): the Mission Planer's own margin profile
// (margin.ts missionMargin) turned into the dock's TimelineModel (ui/timeline/model.ts), so the user's plan
// gets the same margin-over-time strip as the official plan, without playback. Nothing new is computed:
// every row is a point of the profile (time, margin, binding term); stops are the arrive -> leave pairs.
import { buildTimelineModel, type TimelineFileRow, type TimelineModel } from '../ui/timeline/model'
import type { MarginProfile } from './margin'

export interface PlanStop {
  /** label on the strip: the station id, or "#n" for a plain waypoint */
  label: string
  /** EVA minute of arrival */
  t: number
}

export interface PlanTimeline {
  model: TimelineModel
  /** every waypoint's arrival, including ones with no stop time (they have no dwell band) */
  stops: PlanStop[]
  /** EVA minute back at the pad */
  tReturn: number
}

/** "#3" or the station id (as on the map). */
export const stopLabel = (i: number, station?: string): string => station ?? `#${i + 1}`

export function planTimeline(profile: MarginProfile, labels: readonly string[], tDarkMin: number | null): PlanTimeline {
  const rows: TimelineFileRow[] = profile.points.map((p) => ({
    t_min: p.tMin,
    event: p.phase,
    station: p.wp !== null ? (labels[p.wp] ?? stopLabel(p.wp)) : null,
    margin_min: p.marginMin,
    margin_binding: p.binding,
    t_home_min: p.tHomeMin,
  }))
  const tReturn = profile.points[profile.points.length - 1]?.tMin ?? 0
  const model = buildTimelineModel({ scenario: 'plan', timeline: rows, tMax: Math.max(tReturn, 1e-6), tDarkMin })
  const stops = profile.points.filter((p) => p.phase === 'arrive' && p.wp !== null).map((p) => ({ label: labels[p.wp!] ?? stopLabel(p.wp!), t: p.tMin }))
  return { model, stops, tReturn }
}
