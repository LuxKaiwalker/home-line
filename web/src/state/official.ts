// "Official plan" seam (L7b, D111 task T9): one action returns everything to the official plan.
// Each layer that can move the plan away from it registers a part: whether it differs now, and how
// it goes back. The shell's Plan top bar shows the action (enabled only while something differs)
// and calls returnToOfficial().
//
//   mission (built in)   mission.plan: parking option, live result hash, walkback budget
//   plan edit (edit/)    the plan-edit store: draft discarded, the official plan committed as one
//                        undo step (its undoable path), rover back on the official pad
//   live (src/live)      a live result on the map (route result, pad tool): registers the same way,
//                        e.g. officialPart('live-route', () => c.reset()).set(<result shown>)
//
// The selection is cleared too. Nothing here imports src/live (kit rule 6).
import { CONFIG } from '../config'
import { mission } from './mission'
import { clearSelection } from './selection'
import { batch, computed, signal, type ReadSignal } from './signal'

export interface OfficialPart {
  id: string
  /** true while this part shows something other than the official plan */
  differs: ReadSignal<boolean>
  /** go back to the official plan (called inside one batch, parts in registration order) */
  reset(): void
}

const parts = signal<readonly OfficialPart[]>([])

/** Register a part (same id replaces). Returns dispose. */
export function registerOfficialPart(p: OfficialPart): () => void {
  parts.value = [...parts.peek().filter((x) => x.id !== p.id), p]
  return () => void (parts.value = parts.peek().filter((x) => x !== p))
}

/** Convenience for layers that track "differs" themselves: set(true / false), dispose(). */
export function officialPart(id: string, reset: () => void): { set(differs: boolean): void; dispose(): void } {
  const differs = signal(false)
  const dispose = registerOfficialPart({ id, differs, reset })
  return { set: (d) => void (differs.value = d), dispose }
}

/** The official walkback budget: config/crew.yaml walkback_budgets_min[0] (mission.plan default). */
export const OFFICIAL_BUDGET_MIN: number = CONFIG.walkbackBudgetsMin[0]

/** mission.plan away from the official plan in a way every view shares (no catalog needed). */
export const missionDiffers = computed(() => mission.plan.pad.value !== null || mission.plan.hash.value !== undefined || mission.plan.budgetMin.value !== OFFICIAL_BUDGET_MIN)

/** Whether anything differs from the official plan now. */
export const differsFromOfficial = computed(() => missionDiffers.value || parts.value.some((p) => p.differs.value))

/** Return everything to the official plan and clear the selection. Returns false when nothing differed. */
export function returnToOfficial(): boolean {
  const changed = differsFromOfficial.peek()
  batch(() => {
    for (const p of parts.peek()) if (p.differs.peek()) p.reset()
    // whatever no part covered (e.g. no plan-edit store mounted on this view)
    if (missionDiffers.peek()) {
      mission.plan.pad.value = null
      mission.plan.hash.value = undefined
      mission.plan.resultBase.value = undefined
      mission.plan.budgetMin.value = OFFICIAL_BUDGET_MIN
    }
    clearSelection()
  })
  return changed
}

/** Test helper: drop every registered part. */
export function resetOfficialParts(): void {
  parts.value = []
}
