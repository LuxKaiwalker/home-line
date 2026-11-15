// PORT U1: open / close / collapse of the Route panel, callable from anywhere (P3's "Plan a route",
// the station card's "Add to route", R3's map clicks). The open state lives in the layout store (one
// right drawer at a time, Esc closes the topmost, focus returns to the opener); this file only names it.
import { closeContainer, isOpen, layout, openContainer, registerContainer } from '../layout'
import { computed, signal, type ReadSignal } from '../../state/signal'

/** Layout store id of the Route panel (DOM id hl-lay-route-panel). */
export const ROUTE_PANEL_ID = 'route-panel'

/** The spec the panel's Drawer registers with (same here, so either may register first). */
export const ROUTE_PANEL_SPEC = { id: ROUTE_PANEL_ID, kind: 'drawer', side: 'right' } as const

/** true while the Route panel is open (collapsed counts as open). */
export const routePanelOpen: ReadSignal<boolean> = computed(() => layout.open.value[ROUTE_PANEL_ID] ?? false)

const collapsed = signal(false)
/** true while the panel shows its header only. */
export const routePanelCollapsed: ReadSignal<boolean> = collapsed

/**
 * Open the Route panel (expanded). `opener` gets the focus back when it closes (default: the focused
 * element). Closes any other right drawer. Safe before the panel has rendered.
 */
export function openRoutePanel(opener?: HTMLElement | null): void {
  registerContainer(ROUTE_PANEL_SPEC)
  collapsed.value = false
  if (opener === undefined) openContainer(ROUTE_PANEL_ID)
  else openContainer(ROUTE_PANEL_ID, opener)
}

/** Close the Route panel; focus returns to the element that opened it. */
export function closeRoutePanel(): void {
  closeContainer(ROUTE_PANEL_ID)
}

export function isRoutePanelOpen(): boolean {
  return isOpen(ROUTE_PANEL_ID)
}

export function setRoutePanelCollapsed(on: boolean): void {
  collapsed.value = on
}
