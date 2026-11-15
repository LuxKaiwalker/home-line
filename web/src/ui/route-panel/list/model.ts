// PORT U2: pure helpers of the waypoint list (no DOM): stop-time bounds, tag toggle in PLAN_TAGS
// order, labels with station names, and the per-stop leg info read from the route results (§9).
import crewRaw from '../../../../../config/crew.yaml'
import { cfg, CONFIG } from '../../../config'
import { PLAN_TAGS, stopLabels, type PlanStop, type PlanTag } from '../../../state/planning'
import type { LegResult, RouteResults } from './routeResults'

/** Stop time bounds (minutes). Upper: one whole EVA, config/crew.yaml o2_budget.primary_design_eva_h
 *  (a stop cannot outlast the EVA). Step of the input's arrows: Mission Planer's 5 min (UI only). */
export const STOP_MIN_MAX: number = cfg<number>(crewRaw, 'o2_budget.primary_design_eva_h') * 60
export const STOP_MIN_STEP = 5

/** A typed stop time as the store keeps it: not a number / negative → 0, above STOP_MIN_MAX → max. */
export function clampStopMin(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.min(v, STOP_MIN_MAX)
}

/** Toggle one tag, keeping PLAN_TAGS order (the link packs tags as a bit mask in this order). */
export function toggleTag(tags: readonly PlanTag[], tag: PlanTag): PlanTag[] {
  const on = new Set(tags)
  if (on.has(tag)) on.delete(tag)
  else on.add(tag)
  return PLAN_TAGS.filter((t) => on.has(t))
}

const STATION_NAMES = new Map(CONFIG.stationsPlan.map((s) => [s.id, s.name]))

/** Display names: the user's name, else the station's name (config/stations.yaml), else W1, W2, … */
export function displayLabels(stops: readonly PlanStop[], stationName: (id: string) => string | undefined = (id) => STATION_NAMES.get(id)): string[] {
  const base = stopLabels(stops)
  return stops.map((s, i) => (s.name === undefined && s.kind === 'station' ? (stationName(s.station) ?? base[i]) : base[i]))
}

/** What the list shows for one leg. */
export type LegView =
  | { kind: 'none' } // nothing computed (idle, error, stale results)
  | { kind: 'computing' }
  | { kind: 'ok'; minutes: number | null }
  | { kind: 'infeasible'; reason: string }

export interface ListLegs {
  /** leg INTO stops[i] */
  into: LegView[]
  /** walk home from the last stop to the pad */
  home: LegView
}

const view = (l: LegResult | undefined, pending: boolean): LegView =>
  !l ? (pending ? { kind: 'computing' } : { kind: 'none' }) : !l.feasible ? { kind: 'infeasible', reason: l.reason ?? 'other' } : { kind: 'ok', minutes: l.minutes }

/**
 * Per-stop leg info. Legs are matched by stop ids, never by position, so stale results (computed
 * before a reorder) never mark the wrong stop: a leg counts only when its from/to ids are the stop
 * and its predecessor in the current order (any id that is not a stop of the route is the pad).
 * Results for another pad are ignored.
 */
export function legsForStops(stops: readonly PlanStop[], r: RouteResults, padId: string): ListLegs {
  if (!stops.length || r.padId !== padId || r.status === 'idle' || r.status === 'error') return { into: stops.map(() => ({ kind: 'none' })), home: { kind: 'none' } }
  const pending = r.status === 'computing' || r.status === 'partial'
  const ids = new Set(stops.map((s) => s.id))
  const isPad = (id: string) => !ids.has(id)
  const find = (from: string | null, to: string | null) =>
    r.legs.find((l) => (to === null ? isPad(l.toStopId) : l.toStopId === to) && (from === null ? isPad(l.fromStopId) : l.fromStopId === from))
  return {
    into: stops.map((s, i) => view(find(i === 0 ? null : stops[i - 1].id, s.id), pending)),
    home: view(find(stops[stops.length - 1].id, null), pending),
  }
}

/** Closed-editor summary: stop time, tags, note. */
export function stopSummary(s: PlanStop, stopText: (minutes: number) => string): string {
  const parts: string[] = []
  if (s.stopMin > 0) parts.push(stopText(s.stopMin))
  if (s.tags.length) parts.push(s.tags.join(', '))
  if (s.note.trim()) parts.push(s.note.trim())
  return parts.join(' · ')
}
