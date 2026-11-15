// J1d (team lead 2026-11-15 16:57): "Add to route" from a station card (Plan map) or a map pop-up goes to
// #/mission?add=<station id>. The tab reads `add` on load (a hashchange re-mounts the view), appends that
// station to its route (no duplicate, at most MAX_STOPS stops) and drops the param (history.replaceState,
// views/mission.tsx). The plan lives in the address (D97, no browser storage), so a link from another page
// carries no plan: the tab keeps its last plan of this page load in memory and adds to that one.
import backendRaw from '../../../config/backend.yaml'
import { href } from '../router'

/** config/backend.yaml route.max_stops (stations + free points in one route), as edit/route/model.ts ROUTE_LIMITS. */
export const MAX_STOPS: number = (() => {
  const v = (backendRaw as { route?: Record<string, unknown> }).route?.max_stops
  return typeof v === 'number' && v > 0 ? v : 8
})()

/** The link of "Add to route". */
export const addToRouteHref = (stationId: string): string => href({ name: 'mission', add: stationId })

let lastPlan = ''
let lastPad: string | null = null

/** The tab's current plan string (mission/share.ts encodePlan; '' = empty), kept for this page load only. */
export function rememberPlan(plan: string): void {
  lastPlan = plan
}

/** The plan to start from: the link's own plan, else (an "Add to route" link) the tab's last plan of this page load. */
export function startPlan(initial: { plan?: string; add?: string }): string | undefined {
  if (initial.plan) return initial.plan
  return initial.add && lastPlan ? lastPlan : undefined
}

/** The tab's pad (mission/pads.ts MissionPad), kept with the plan for this page load only. */
export function rememberPad(pad: string | null): void {
  lastPad = pad
}

/** The pad to start from: the last one of this page load when the link continues that plan (startPlan), else the official pad. */
export function startPad(initial: { plan?: string; add?: string }): string | null {
  return !initial.plan && initial.add && lastPlan ? lastPad : null
}

/** Why a station cannot be appended (null = it can): already in the route, or the route is full. */
export function addRefusal(list: readonly { station?: string }[], id: string): string | null {
  if (list.some((w) => w.station === id)) return `${id} is already in the plan.`
  if (list.length >= MAX_STOPS) return `The route already has ${MAX_STOPS} stops (the most one route can have): ${id} not added.`
  return null
}
