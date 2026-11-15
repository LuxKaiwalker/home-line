// The plan-edit store's part of the "Official plan" action (L7b, D111 task T9; seam state/official.ts).
// Differs while a draft is open or the committed plan is not the official one; going back discards
// the draft (rover back on its pad) and commits the official plan through the store's undoable path
// (one undo step: Ctrl+Z brings the previous plan back).
import { OFFICIAL_BUDGET_MIN, registerOfficialPart } from '../state/official'
import { computed } from '../state/signal'
import type { EditCatalog, EditPlan } from './options'
import type { RoverDrag } from './rover'
import type { PlanEditStore } from './store'

/** The official plan: official pad, default scenario, the official walkback budget, catalogue dwell. */
export const officialPlan = (c: EditCatalog): EditPlan => ({ scenario: c.defaultScenario, budgetMin: OFFICIAL_BUDGET_MIN, pad: c.officialPadId, dwell: {} })

export function isOfficialPlan(p: EditPlan, c: EditCatalog): boolean {
  return p.pad === c.officialPadId && p.scenario === c.defaultScenario && p.budgetMin === OFFICIAL_BUDGET_MIN && Object.keys(p.dwell).length === 0
}

/** Register the store (and the rover, when the map has one) with the Official plan action. Returns dispose. */
export function registerEditOfficial(store: PlanEditStore, rover: RoverDrag | null = null): () => void {
  const c = store.catalog
  const differs = computed(() => store.draft.value !== null || !isOfficialPlan(store.committed.value.plan, c))
  return registerOfficialPart({
    id: 'plan-edit',
    differs,
    reset() {
      if (rover) {
        if (rover.state.peek()?.phase === 'dragging') rover.cancel()
        else rover.discard()
      }
      store.cancel()
      if (!isOfficialPlan(store.committed.peek().plan, c)) store.apply(officialPlan(c))
    },
  })
}
