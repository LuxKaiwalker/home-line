// PORT W0a: mount points of the Plan view (views/console.tsx) for the ported Mission Planer pieces.
// Each slot renders null until a package registers into it, so the Plan view is unchanged until I1
// wires the packages (one `import` each in console.tsx, or a register call from their install()).
//
//   'route-panel'  U1 ui/route-panel/   the Route panel (right Drawer, collapsible)
//   'pad-layer'    P2 map/pads/         non-visual mount with the ConsoleMap (pad markers, env swap);
//                                       may also render the pad pop-up card (MarkerCard)
//   'context-bar'  P3 ui/strip/         the slim one-line context bar (active pad, "Official plan" or
//                                       "Your route · n stops · margin m min · Fast route", scenario chip,
//                                       trust chips; no pop-up). When registered it REPLACES today's
//                                       HeadlineStrip (views/planStrip.tsx), passed as `fallback`
//   'drawer-summary' P3 ui/strip/       the bottom-drawer summary (reach numbers of the active pad);
//                                       replaces today's PlanSummary (views/planSlots.tsx), passed as
//                                       `fallback`; rendered inside the existing <S name="summary"> section
import type { ComponentChildren, VNode } from 'preact'
import { signal, useSignalValue } from '../state/signal'
import type { ConsoleMap } from '../map/consoleMap'

export type PlanPortSlot = 'route-panel' | 'pad-layer' | 'context-bar' | 'drawer-summary'

export interface PlanSlotProps {
  cmap: ConsoleMap
  /** what the slot shows when nothing is registered (context-bar: HeadlineStrip; drawer-summary: PlanSummary) */
  fallback: ComponentChildren
}
export type PlanSlotRender = (p: PlanSlotProps) => VNode | null

const slots = signal<Readonly<Partial<Record<PlanPortSlot, PlanSlotRender>>>>({})

/** Fill a slot (one owner per slot; a second registration replaces the first). Returns unregister. */
export function registerPlanSlot(name: PlanPortSlot, render: PlanSlotRender): () => void {
  slots.value = { ...slots.peek(), [name]: render }
  return () => {
    if (slots.peek()[name] !== render) return
    const next = { ...slots.peek() }
    delete next[name]
    slots.value = next
  }
}

/** The mount point; renders `fallback` (default nothing) until the slot is filled. */
export function PlanSlot({ name, cmap, fallback = null }: { name: PlanPortSlot; cmap: ConsoleMap; fallback?: ComponentChildren }) {
  const R = useSignalValue(slots)[name]
  return R ? <R cmap={cmap} fallback={fallback} /> : <>{fallback}</>
}
