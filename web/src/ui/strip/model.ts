// PORT P3: pure logic of the slim context bar and the drawer summary (no DOM, no number logic of its
// own: every number is the console's value or the route core's estimate, passed through).
import { isValidElement, type ComponentChildren } from 'preact'
import { headlineFor, padKey, type PadSummaryView } from '../../data/pads'
import type { PadEnv, PadInfo } from '../../pads/types'
import { OFFICIAL_PAD_ID, type PadId } from '../../state/planning'
import { marginLabel, tightestMargin } from '../../views/decisions'
import type { StripProps } from '../../views/planStrip'
import type { RouteResults } from './routeResults'

/** A manifest-backed value as the headline strip passed it (rendered with <Num> + trust chip). */
export interface BackedValue {
  v: number
  k: string
  file: string
}

/**
 * The console's headline values. Today they reach the slot only as the props of its fallback
 * (<HeadlineStrip …/>, views/console.tsx); read them from there (I1 may pass them explicitly later).
 */
export function stripPropsOf(fallback: ComponentChildren): StripProps | null {
  if (!isValidElement(fallback)) return null
  const p = fallback.props as Partial<StripProps> | null
  if (!p || typeof p.sid !== 'string' || typeof p.budget !== 'number' || typeof p.scenarioText !== 'string') return null
  return p as StripProps
}

/**
 * The active pad: the console's parking option (D21 picker) when one is selected, else the planning
 * store's pad; null = the official pad.
 */
export function activePadId(strip: StripProps | null, planningPad: PadId): PadId | null {
  if (strip?.pad) return strip.pad.id
  return planningPad === OFFICIAL_PAD_ID ? null : planningPad
}

/** Short pad name ("P2"): the pad index label when loaded, else derived from the index id. */
export function padName(id: PadId, pads: readonly PadInfo[]): string {
  const info = pads.find((p) => p.id === id)
  if (info) return info.label
  const m = /^rank(\d+)$/.exec(id)
  return m ? `P${m[1]}` : id
}

/** The official route's tightest margin (the strip's third number), with why it binds. */
export function officialMargin(strip: StripProps | null): (BackedValue & { why: string }) | null {
  const r = strip?.route
  const tight = r ? tightestMargin(r.timeline) : null
  if (!r || !tight || typeof tight.e.margin_min !== 'number') return null
  return { v: tight.e.margin_min, k: `${r.key}.${tight.i}.margin_min`, file: r.file, why: `${marginLabel(tight.e.margin_binding)}${tight.e.station ? `, ${tight.e.event} ${tight.e.station}` : ''}` }
}

export type Shown =
  | { kind: 'official' }
  | {
      kind: 'mine'
      stops: number
      /** whole minutes; null while computing or when no margin is known */
      marginMin: number | null
      computing: boolean
      fast: boolean
      /** the first infeasible leg's target: a 1-based stop, 'home' (the return leg to the pad), else null */
      unreachable: number | 'home' | null
    }

/** What the map shows: the official plan, or the user's route with its estimate (§9 route results). */
export function shownFor(stops: number, r: RouteResults, padId: PadId): Shown {
  if (stops <= 0) return { kind: 'official' }
  const current = r.padId === padId && r.status !== 'idle' && r.status !== 'error'
  const computing = !current || r.status === 'computing'
  // legs run pad → stop 1 → … → stop n → pad: leg i ends at stop i+1, leg n is the way home
  const bad = current && r.firstInfeasibleLeg !== null ? r.firstInfeasibleLeg : null
  return {
    kind: 'mine',
    stops,
    marginMin: current && r.marginMin !== null && Number.isFinite(r.marginMin) ? Math.round(r.marginMin) : null,
    computing,
    fast: current && r.fastRoute,
    unreachable: bad === null ? null : bad < stops ? bad + 1 : 'home',
  }
}

export interface ReachItem extends BackedValue {
  budget: number
}

/**
 * Reach of the active pad for the drawer summary, only as the console already shows it in this view
 * state (value snapshot: same manifest keys, same formatting, nothing extra):
 *   - official pad: the scenario's headline (30 min) and the 60-min headline (D43), keys reachable_pct.<sid>.<budget>;
 *   - a parking option: its summary.json headline at the walkback budget (PadHeadline's choice), keys
 *     pads.<id>.headline.<budget>.reachable_pct;
 *   - a planning-store pad the console does not know yet (P1 env, before I1 wires the picker): the same
 *     from that pad's summary.
 */
export function reachItems(strip: StripProps | null, env?: Pick<PadEnv, 'summary' | 'info'> | null): ReachItem[] {
  if (!strip) return []
  if (strip.pad) return padReach(strip.pad.id, strip.pad.summary, strip.pad.file, strip.budget)
  if (env?.summary && env.info.files.summary) return padReach(env.summary.id, env.summary, env.info.files.summary, strip.budget)
  const out: ReachItem[] = []
  if (strip.h30 && typeof strip.h30.v === 'number') out.push({ budget: strip.h30.budget, v: strip.h30.v, k: strip.h30.k, file: strip.h30.file })
  const h60 = strip.h60
  if (h60 && typeof h60.reachablePct === 'number' && h60.budget !== strip.h30?.budget) out.push({ budget: h60.budget, v: h60.reachablePct, k: `reachable_pct.${strip.sid}.${h60.budget}`, file: 'scenarios/index.json' })
  return out
}

function padReach(id: string, s: PadSummaryView | null, file: string, budget: number): ReachItem[] {
  const h = s ? headlineFor(s, budget) : null
  if (!h || typeof h.reachablePct !== 'number') return []
  return [{ budget: h.budget, v: h.reachablePct, k: padKey(id, 'headline', h.budget, 'reachable_pct'), file }]
}
