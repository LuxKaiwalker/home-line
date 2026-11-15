// PORT P3: install the slim context bar and the drawer summary into the Plan slots
// (views/planPortSlots.tsx). I1 calls installStrip() once (console.tsx); until then the Plan view keeps
// today's HeadlineStrip and PlanSummary (the slots' fallbacks).
import { registerPlanSlot } from '../../views/planPortSlots'
import { ContextBar } from './ContextBar'
import { DrawerSummary } from './DrawerSummary'

export { ContextBar, ContextLine, setPlanRouteAction, stripData } from './ContextBar'
export { DrawerSummary, ReachLine } from './DrawerSummary'

/** Register both slots; returns unregister. `onPlanRoute` opens the Route panel (U1). */
export function installStrip(o: { onPlanRoute?: () => void } = {}): () => void {
  const offBar = registerPlanSlot('context-bar', (p) => <ContextBar fallback={p.fallback} onPlanRoute={o.onPlanRoute ?? null} />)
  const offSum = registerPlanSlot('drawer-summary', (p) => <DrawerSummary fallback={p.fallback} />)
  return () => {
    offSum()
    offBar()
  }
}
