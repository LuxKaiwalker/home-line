// WP6 (D97): validity of a stop from field lookups the browser already has (U15 honesty rule: never
// computed, unknown stays unknown), and the contract codes (v1.2.0 Error.stop) of R5's StopProblem.
//   inGrid     inside the field grid (fields/index.json bounds)
//   assessed   the cell under the stop has measured terrain (cell state not unknown / outside)
//   walkable   that cell is not blocked at the 20° no-go (cell state != blocked)
//   reachable  a walk home exists: T_home of the plan's variant is known there
// The engine (WP2a point_validity) looks for an access cell within 50 m; the browser judges the
// stop's own cell, so a stop the browser refuses may still be accepted by the server, never the
// other way round for codes 1-3 (a refused cell has no valid neighbour only if its neighbours are
// refused too). The 422 of the live job stays the answer.
import type { FieldSample, Variant } from '../../../map/field'
import type { StopProbe, StopProblem } from '../model'

export function probeFromSample(s: FieldSample | null, v: Variant): StopProbe {
  if (!s) return { inGrid: null, assessed: null, walkable: null, reachable: null }
  if (!s.inside) return { inGrid: false, assessed: null, walkable: null, reachable: null }
  return {
    inGrid: true,
    assessed: s.state === null ? null : s.state !== 'unknown' && s.state !== 'outside',
    walkable: s.state === null ? null : s.state !== 'blocked',
    reachable: s.tHome[v] !== null,
  }
}

/** The contract's 422 code for each stop problem (openapi v1.2.0 Error.stop; R5 text.ts ROUTE_ERROR_TEXT). */
export const STOP_PROBLEM_CODE: Record<StopProblem, string> = {
  unknownStation: 'route_station_unknown',
  duplicate: 'route_station_duplicate',
  outsideGrid: 'route_point_outside_grid',
  unassessed: 'route_point_unassessed',
  notWalkable: 'route_point_not_walkable',
  unreachable: 'route_point_unreachable',
  spacing: 'route_stop_spacing',
  tooMany: 'route_too_many_stops',
}
