// PORT P2: the numbers of the pad pop-up card (team lead 19:57: the reach numbers move from the removed
// top-centre headline panel into the pad card). Every number is a stored value with the SAME file and
// manifest key the headline strip / console headline used, so the value snapshot keys stay identical:
//   official pad  scenarios/index.json   reachable_pct.{sid}.{budget}, reachable_pct_range.{sid}.{budget}.low|high
//                 scenarios/pads/index.json  pads.{official id}.score (feasible EVAs, D21, frozen D42)
//   picker pad    scenarios/pads/{id}/summary.json  pads.{id}.headline.{budget}.reachable_pct,
//                 pads.{id}.headline.{budget}.range_pct.low|high, pads.{id}.score
// Nothing is computed or rounded here; a missing value stays null (shown as "–" by <Num>).
import { CONFIG } from '../../config'
import { padKey, type PadOption, type PadSummaryView, headlineFor, PADS_INDEX } from '../../data/pads'
import type { ScenarioEntry } from '../../data/types'
import { headline60 } from '../../views/decisions'

export type NumRef = { v: number | null; k: string; file: string }
export interface ReachRow {
  budget: number
  value: NumRef
  /** conservative .. optimistic */
  range: [NumRef, NumRef] | null
}
export interface CardNumbers {
  reach: ReachRow[]
  feasible: NumRef | null
}

/** The two headline budgets (config/crew.yaml walkback_budgets_min: 30 and 60 min). */
export function cardBudgets(): [number, number] {
  return [CONFIG.walkbackBudgetsMin[0], CONFIG.walkbackBudgetsMin[1] ?? 60]
}

/** A picker pad's card numbers from its summary.json (`id` = the index row id, e.g. rank2). */
export function padCardNumbers(id: string, s: PadSummaryView, file: string, [b30, b60] = cardBudgets()): CardNumbers {
  const k = (...p: (string | number)[]) => padKey(id, ...p)
  const rows: ReachRow[] = []
  // the strip's rule: the 30-min row falls back to the first headline, the 60-min row needs its own budget
  const a = headlineFor(s, b30)
  const c = s.headlines.find((h) => h.budget === b60) ?? null
  for (const h of a && c && a.budget === c.budget ? [a] : [a, c]) {
    if (!h) continue
    rows.push({
      budget: h.budget,
      value: { v: h.reachablePct, k: k('headline', h.budget, 'reachable_pct'), file },
      range: h.range ? [{ v: h.range[0], k: k('headline', h.budget, 'range_pct', 'low'), file }, { v: h.range[1], k: k('headline', h.budget, 'range_pct', 'high'), file }] : null,
    })
  }
  return { reach: rows, feasible: { v: s.score, k: k('score'), file } }
}

/** The official pad's card numbers: what the official plan shows (official summary.json does not exist). */
export function officialCardNumbers(entry: ScenarioEntry, official: PadOption | null): CardNumbers {
  const F = 'scenarios/index.json'
  const sid = entry.id
  const row = (budget: number, v: number | null, range: [number | null, number | null] | null): ReachRow => ({
    budget,
    value: { v, k: `reachable_pct.${sid}.${budget}`, file: F },
    range: range ? [{ v: range[0], k: `reachable_pct_range.${sid}.${budget}.low`, file: F }, { v: range[1], k: `reachable_pct_range.${sid}.${budget}.high`, file: F }] : null,
  })
  const h = entry.headline
  const reach = [row(h.budget_min, h.reachable_pct, h.range_pct)]
  const h60 = headline60(entry)
  if (h60 && h60.budget !== h.budget_min) reach.push(row(h60.budget, h60.reachablePct, h60.range))
  return { reach, feasible: official ? { v: official.score, k: padKey(official.id, 'score'), file: PADS_INDEX } : null }
}
