// PORT U2: waypoint list of the Route panel (interfaces.md §7: ui/route-panel/list/).
// Mounting: U1's registerRoutePanelSection('list', Component) from ui/route-panel/. Until U1 merges,
// register() takes that function as an argument; at rebase I1/U2 switch to the direct import.
import type { ComponentType } from 'preact'
import { WaypointList } from './WaypointList'

export { WaypointList, NOTE_IDLE_MS, type WaypointListProps } from './WaypointList'
export { clampStopMin, displayLabels, legsForStops, STOP_MIN_MAX, toggleTag, type LegView, type ListLegs } from './model'

export type RegisterSection = (name: 'list', component: ComponentType) => () => void

/** Mount the list into the Route panel; returns the unregister function. */
export function register(registerRoutePanelSection: RegisterSection): () => void {
  return registerRoutePanelSection('list', () => <WaypointList />)
}
