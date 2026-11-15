// PORT U1: the Route panel's three slot regions, filled by the sub-packages from their own folders so
// nobody edits the shell:  U2 'list' (ui/route-panel/list/), U3 'settings' (settings/), U4 'export'
// (export/). One component per region; a second registration replaces the first. Nothing registered =
// the region is not rendered.
//
//   import { registerRoutePanelSection } from '../sections'
//   export const install = () => registerRoutePanelSection('list', StopList)
import type { ComponentType } from 'preact'
import type { PlanningStore } from '../../state/planning'
import { signal, useSignalValue } from '../../state/signal'

export const ROUTE_PANEL_SECTIONS = ['list', 'settings', 'export'] as const
export type RoutePanelSectionName = (typeof ROUTE_PANEL_SECTIONS)[number]

export interface RoutePanelSectionProps {
  /** the planning store the panel shows (the app's `planning` singleton; tests pass their own) */
  store: PlanningStore
}
export type RoutePanelSection = ComponentType<RoutePanelSectionProps>

const sections = signal<Readonly<Partial<Record<RoutePanelSectionName, RoutePanelSection>>>>({})

/** Fill a region of the Route panel. Returns unregister (no-op if replaced meanwhile). */
export function registerRoutePanelSection(name: RoutePanelSectionName, component: RoutePanelSection): () => void {
  if (!ROUTE_PANEL_SECTIONS.includes(name)) throw new Error(`route panel: no section "${name}"`)
  sections.value = { ...sections.peek(), [name]: component }
  return () => {
    if (sections.peek()[name] !== component) return
    const next = { ...sections.peek() }
    delete next[name]
    sections.value = next
  }
}

/** The registered component of a region (render-time read). */
export function useRoutePanelSection(name: RoutePanelSectionName): RoutePanelSection | undefined {
  return useSignalValue(sections)[name]
}

/** Tests: forget every registration. */
export function resetRoutePanelSections(): void {
  sections.value = {}
}
