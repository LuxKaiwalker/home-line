// Interface text of the Edit-route panel (R5). Kept here, not in ui/copy.json, because copy.json is
// bundled into the static app and the static build must stay byte-identical (waypoint rule 4); the
// live views (src/live/view.tsx) keep their text next to the code the same way. Wording follows
// DESIGN §3.8 (station, rover pad, margin, Computed live). Move into copy.json when D folds the live
// copy into the deck.
import type { RouteLimit, RouteFailure } from './controller'
import type { RouteProblem, StopProblem } from './model'

export const ROUTE_TEXT = {
  title: 'Edit route',
  modeLabel: 'Route',
  modeAuto: 'Engine chooses',
  modeOrdered: 'My order',
  autoNote: 'The engine chooses the stations and their order, as in the official plan.',
  orderedNote: 'Legs run from the rover pad through the checked stations in this order and back. Nothing is reordered.',
  stopsLabel: 'Stations',
  moveHint: 'Drag to reorder, or Alt+Up / Alt+Down',
  dragHandle: 'Move {station}',
  include: 'Include {station}',
  // WP12 (W-5): the buttons run the one undo of the Plan view (route edits and rover / plan edits)
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Shift+Z)',
  compute: 'Compute plan',
  computing: 'Computing your route…',
  cancel: 'Cancel',
  hash: 'Plan hash',
  hashPending: 'known once live planning answers',
  needsLive: 'Computing a route needs live planning.',
  checkingLive: 'Checking whether live planning is reachable…',
  heavyJobsOff: 'Live planning is not taking new plans now.',
  legs: 'Legs',
  stagesTitle: 'Staged result',
  stageFirst: 'Nominal band and route',
  stageRest: 'Other bands, edges and partner line',
  stageWaiting: 'waiting',
  stageShown: 'on the map',
  computedLabel: 'Computed live · your route',
  /** WP13: after the Computed live badge (badge text + this = computedLabel) */
  yourRoute: 'your route',
  provenance: 'Provenance',
  feasible: 'Every leg keeps its margins.',
  infeasibleTitle: 'This order does not work',
  infeasibleLeg: 'Leg {n}: {from} → {to}',
  infeasibleLimit: 'Limit: {limit}',
  infeasibleShort: 'Short by {min} min',
  infeasibleShortUnknown: 'Short by — (not reported)',
  infeasibleNote: 'Change the order or drop a station; the route is computed exactly as given.',
  feasibilityUnknown: 'The run record gives no feasibility for this route.',
  failedTitle: 'The route was not computed',
  cancelled: 'Cancelled.',
  stopValid: 'valid',
  stopUnknown: 'not checked here',
  pad: 'Rover pad',
  dockNote: 'Route result on the map: the EVA timeline of the official plan is not shown.',
  dockOpen: 'Open this plan',
  // WP12 (L6 W-1): one compute action; what goes into it
  inputsPadOfficial: 'Rover pad: official',
  inputsPad: 'Rover pad: {pad}',
  inputsPadCustom: 'Rover pad: your spot from Live pad, {lon}°E {lat}°N',
  inputsCrewDefault: 'Crew: default',
  inputsCrewChanged: 'Crew: your changes from the crew panel',
  // WP12 (L6 W-4): why a control is disabled (every disabled control names its reason)
  whyLocked: 'Locked while your route is computed. Cancel to change it.',
  whyStops: 'Fix the stops marked in the list first.',
  whyDragging: 'Drop the station first.',
  // WP12 (L-05, D114): in place of the section while the live planner is unreachable (no controls)
  offlineNote: 'Route editing needs the live planner · it is offline right now',
  // WP12 (L6 W-1): the Live pad card hands the compute to this panel
  cardCompute: 'Compute in Edit route',
  cardRunning: 'Computing in Edit route…',
  cardNote: 'The full plan is computed in Edit route: this spot, your crew changes and the route, as one job.',
  cardNoRoute: 'Edit route is not ready yet.',
  whyPointsAuto: 'Your points take part only in “My order”: press it to edit them.',
} as const

/**
 * WP13 (L6 W-2, 10.7 F2, N5): job progress. Stage names the copy deck has (stepper.stages.nominal,
 * .partner) come from the deck; the rest are here. The expected time is labelled as an expectation.
 */
export const PROGRESS_TEXT = {
  stages: { bands: 'Variant bands', route: 'Route', summary: 'Summary' },
  queued: 'Queued',
  queuedAt: 'Queued · position {n}',
  running: 'Starting',
  runningStage: 'Running: {stage}',
  elapsed: '{t} elapsed',
  expected: 'expected ~{min} min',
  expectedNote: 'From measured stage times on this server; the real time depends on the queue and the route. Not a promise.',
  busy: {
    job_in_progress: { later: 'You already have a plan computing · try again in {s} s', now: 'You already have a plan computing · try again when it is done' },
    queue_full: { later: 'Live planning is full right now · try again in {s} s', now: 'Live planning is full right now · try again in a minute' },
    rate_limited: { later: 'Too many plans in a short time · try again in {s} s', now: 'Too many plans in a short time · try again later' },
  },
} as const

/**
 * N5: a refused submit that only says "not now" (429): one heavy job per visitor (job_in_progress,
 * WP11), the queue is full (queue_full), too many plans (rate_limited). null for any other code.
 */
export function busyText(code: string, retryAfterS: number | null | undefined): string | null {
  const b = (PROGRESS_TEXT.busy as Record<string, { now: string; later: string }>)[code]
  if (!b) return null
  return retryAfterS && retryAfterS > 0 ? fill(b.later, { s: Math.ceil(retryAfterS) }) : b.now
}

/** WP13 (L6 W-6): the two trust badges (Badge in badge.tsx). */
export const BADGE_TEXT = {
  estimate: { label: 'Estimate' },
  computed: { label: 'Computed live' },
} as const

/** WP13 (L6 W-6): a feasible result's tightest margin and the limit that sets it (the result's timeline). */
export const MARGIN_TEXT = {
  tightest: 'Tightest margin {min} min',
  binding: 'binding: {limit}',
  where: 'at {station}',
  unknown: 'Tightest margin: not in this result',
} as const

export const LIMIT_TEXT: Record<RouteLimit, string> = {
  O2: 'O₂ at the effort-cap rate (D45)',
  daylight: 'Daylight',
  'EVA duration': 'EVA length (D28)',
  dose: 'Radiation dose',
}

/**
 * WP12 (D117, team lead's science review): the infeasible answer as one sentence per limit. The O₂
 * shortfall is a DEPARTURE-TIME shortfall. Leg numbers are 1-based for people; minutes are whole.
 */
export const INFEASIBLE_TEXT: Record<RouteLimit, { head: string; short: string; unknown: string }> = {
  O2: { head: 'O₂ limit on leg {n} ({from} → {to})', short: 'you would need to set off {min} min earlier (conservative O₂ rule, D45)', unknown: 'you would need to set off earlier (conservative O₂ rule, D45; minutes not reported)' },
  daylight: { head: 'Daylight limit on leg {n} ({from} → {to})', short: 'the walk would end after dark: set off {min} min earlier', unknown: 'the walk would end after dark (minutes not reported)' },
  'EVA duration': { head: 'EVA length limit on leg {n} ({from} → {to})', short: 'the route exceeds the EVA length: {min} min too long', unknown: 'the route exceeds the EVA length (minutes not reported)' },
  dose: { head: 'Radiation dose limit on leg {n} ({from} → {to})', short: 'the route exceeds the dose allowance on this leg ({min} min short)', unknown: 'the route exceeds the dose allowance on this leg (minutes not reported)' },
}
/** Any other limit the run record names (never guessed). */
export const INFEASIBLE_OTHER = { head: 'Limit {limit} on leg {n} ({from} → {to})', short: 'short by {min} min', unknown: 'minutes not reported' }

/** Short names on the map label "fails: O₂". */
export const LIMIT_SHORT: Record<RouteLimit, string> = { O2: 'O₂', daylight: 'daylight', 'EVA duration': 'EVA length', dose: 'dose' }
export const MAP_TEXT = {
  fails: 'fails: {limit}',
  end: 'route stops here · no way home planned',
} as const

/** "O₂ limit on leg 3 (S7 → S6)" + "you would need to set off 25 min earlier (…)"; shortfall null = not reported. */
export function infeasibleText(f: { leg: number; from: string; to: string; limit: string; shortfallMin: number | null }, name: (s: string) => string = (s) => s): { head: string; short: string } {
  const t = INFEASIBLE_TEXT[f.limit as RouteLimit] ?? INFEASIBLE_OTHER
  const vars = { n: f.leg + 1, from: name(f.from), to: name(f.to), limit: f.limit }
  return { head: fill(t.head, vars), short: f.shortfallMin === null ? t.unknown : fill(t.short, { min: Math.round(f.shortfallMin) }) }
}

export const STOP_PROBLEM_TEXT: Record<StopProblem, string> = {
  unknownStation: 'not a station of this site',
  duplicate: 'already in the route',
  outsideGrid: 'outside the terrain grid',
  unassessed: 'no assessed terrain here',
  notWalkable: 'too steep to walk (20°)',
  unreachable: 'no way home from the rover pad',
  spacing: 'closer than {m} m to another stop or the rover pad',
  tooMany: 'more than {n} stops',
}

export const ROUTE_PROBLEM_TEXT: Record<RouteProblem, string> = {
  noStops: 'Check at least one station.',
  tooManyStops: 'At most {n} stops.',
  tooManyFreePoints: 'At most {n} points of your own.',
}

/** Server error codes of a 422 on a route (draft openapi v1.2.0 Error.stop). */
export const ROUTE_ERROR_TEXT: Record<string, string> = {
  route_too_many_stops: 'too many stops',
  route_too_many_free_points: 'too many points of your own',
  route_stop_spacing: 'two stops, or a stop and the rover pad, are too close',
  route_station_unknown: 'not a station of this site',
  route_station_duplicate: 'a station is in the route twice',
  route_point_outside_grid: 'outside the terrain grid',
  route_point_unassessed: 'no assessed terrain here',
  route_point_not_walkable: 'too steep to walk',
  route_point_unreachable: 'no path from the rover pad',
  route_label_too_long: 'the label is too long',
  route_mode_conflict: 'the route conflicts with the station settings',
  invalid_input: 'the server refused the inputs',
  rate_limited: 'too many plans at once; try again later',
  job_in_progress: 'you already have a plan computing',
  queue_full: 'live planning is full right now',
  heavy_jobs_off: 'live planning is not taking new plans now',
  timeout: 'the plan took too long',
  client_timeout: 'the plan took too long',
  network: 'no answer from the live server',
}

export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{([a-z_]+)\}/g, (_, k: string) => {
    const v = vars[k]
    if (v === undefined) throw new Error(`route text: no value for {${k}} in "${s}"`)
    return String(v)
  })
}

/** "Stop 2 (S4): too steep to walk" for a 422 naming a stop; otherwise the reason alone. */
export function failureText(f: RouteFailure, stopName: (i: number) => string | null): string {
  // N5: a 429 that only says "not now" reads as one plain sentence (never the raw code)
  const busy = f.status === 0 || f.status === 429 ? busyText(f.code, f.retryAfterS) : null
  if (busy) return busy
  const reason = ROUTE_ERROR_TEXT[f.code] ?? f.message
  const head = f.status === 422 && f.stop !== null ? `Stop ${f.stop + 1}${stopName(f.stop) ? ` (${stopName(f.stop)})` : ''}: ` : ''
  const retry = f.retryAfterS ? ` (retry in ${f.retryAfterS} s)` : ''
  return `${head}${reason}${retry}`
}
