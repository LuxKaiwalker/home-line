// I1b (D128, instant browser path): the browser estimate as the Edit-route panel shows it. The compute
// itself is I1a's (edit/route/browser/); adapter.ts is the ONE file that maps I1a's result onto this
// shape, so the panel, the controller and the tests never import I1a directly.
import type { EvaClock } from '../../../ui/route-panel/settings/marstime'
import type { RouteStop } from '../model'

/** The label every browser estimate carries (team lead D128; also mission.json origin_label). */
export const ESTIMATE_LABEL = 'Estimate · browser, 5 m grid · not part of the validated scorecard'

/** One leg as the panel lists it (contract numbering: 0 = pad -> stops[0], len(stops) = last stop -> pad). */
export interface EstimateLeg {
  leg: number
  /** run-record names: 'pad', station id, W1.. */
  from: string
  to: string
  /** walking time (min); null = no path on the browser grid */
  walkMin: number | null
  /** O2 used on the leg (L), null = unknown */
  o2UsedL: number | null
  /** tightest margin on the leg (min) and its binding term, null = unknown */
  marginMin: number | null
  binding: string | null
  /**
   * I1c: the ordered-route check of this leg, the number the "fails first" line quotes (the engine's rule:
   * O2 used before the leg counted at the effort cap). Minutes of slack (negative = short), its term, pass.
   * Absent / null = unknown.
   */
  checkMin?: number | null
  checkBinding?: string | null
  checkOk?: boolean | null
}

export type EstimateFeasibility = { feasible: true } | { feasible: false; leg: number; from: string; to: string; term: string; shortMin: number | null }

export interface EstimateResult {
  legs: EstimateLeg[]
  totals: { walkMin: number | null; evaMin: number | null; o2UsedL: number | null; o2LeftL: number | null }
  /** the tightest margin over the whole route and the term that binds it */
  tightest: { marginMin: number; binding: string; leg: number | null } | null
  feasibility: EstimateFeasibility
  /** I1a's own result (buildBrowserMission reads it); opaque here */
  raw?: unknown
}

/** What the estimate needs from the compute core (adapter.ts gives I1a's; tests give stubs). */
export interface EstimateCore {
  /** load the browser data for a fields URL once (padFields) */
  load(fieldsUrl: string): Promise<unknown>
  /** the whole route in the user's order, synchronous */
  compute(data: unknown, pad: { lon: number; lat: number }, stops: readonly RouteStop[]): EstimateResult
  /** mission.json (schema 1.1.0, origin_label = ESTIMATE_LABEL) from a result */
  mission(result: EstimateResult, ctx: MissionCtx): Promise<Record<string, unknown>> | Record<string, unknown>
  /** I3: the data with the EVA start moved to startMs (null = clock.json's instant: the data as is); absent = no start picker */
  atStart?(data: unknown, startMs: number | null): unknown
  /** I3: the Mars clock at a start (null = clock.json's instant) for the start card */
  clockAt?(data: unknown, startMs: number | null): EvaClock
  /** I3: where the sun is computed (the fields' pad, D21) */
  sunSite?(data: unknown): { lat: number; lon: number }
}

export interface MissionCtx {
  data: unknown
  pad: { lon: number; lat: number }
  padId: string | null
  stops: readonly RouteStop[]
}
