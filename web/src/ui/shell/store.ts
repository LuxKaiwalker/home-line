// Shell state and extension points (DESIGN §4.3, §5.2; WS15 task 4, package A4).
// Panel sizes live in the UI store (state/ui.ts: ui.panels); the shell writes the collapsed sizes there.
// What the UI store does not hold (sidebar open, focus mode, help open, last route per mode) is here.
// Later packages plug into the shell through the registries below instead of editing the shell:
//   A5 (selection sidebar)  setSidebarContent(render), openSidebar()
//   A6 (view migrations)    registerRailSection({ id, modes, title, icon, render })
//   U5 (timeline dock)      setDockContent(render)
import type { ComponentChildren } from 'preact'
import { canonicalHref, type Route } from '../../router'
import { signal } from '../../state/signal'
import { MODES, ROUTE_MODE, ui, type Mode } from '../../state/ui'
import type { CopyKey } from '../copy'
import type { IconName } from '../icons/icons'
import { TOKENS } from '../tokens'

export type Breakpoint = 'phone' | 'tablet' | 'desktop'

/** DESIGN §4.3 breakpoints from tokens.json (tablet 768, desktop 1280). */
export function breakpointFor(width: number): Breakpoint {
  const bp = TOKENS.layout.breakpoints
  return width >= bp.desktop ? 'desktop' : width >= bp.tablet ? 'tablet' : 'phone'
}

/** The mode a route belongs to (§4.2). Unknown routes (not found, #/plan/{hash}) keep the current mode. */
export function modeOf(route: Route, current: Mode | undefined = ui.mode.peek()): Mode {
  return ROUTE_MODE[route.name] ?? current ?? 'plan'
}

/** Views listed in the left rail per mode (labels from copy.json; icons from the sprite). */
export interface ModeView {
  route: Route
  label: CopyKey
  icon: IconName
}
export const MODE_VIEWS: Readonly<Record<Mode, readonly ModeView[]>> = {
  plan: [
    // Mission Planer first: the landing page and where the PLAN tab leads by default (user, 2026-11-15)
    { route: { name: 'mission' }, label: 'nav.views.mission', icon: 'mountain' },
    { route: { name: 'console' }, label: 'modes.plan.label', icon: 'map' },
  ],
  fly: [
    { route: { name: 'hud' }, label: 'nav.views.hud', icon: 'gauge' },
    { route: { name: 'conditions' }, label: 'nav.views.conditions', icon: 'sun' },
  ],
  // L2 (D111, L0 Q2): the trade table is document content, so it lives in Report
  report: [
    { route: { name: 'cuff' }, label: 'nav.views.cuff', icon: 'printer' },
    { route: { name: 'trade' }, label: 'nav.views.trade', icon: 'file-text' },
  ],
  evidence: [
    { route: { name: 'scorecard' }, label: 'nav.views.scorecard', icon: 'shield-check' },
    { route: { name: 'about' }, label: 'nav.views.about', icon: 'info' },
  ],
}
export const MODE_ICON: Readonly<Record<Mode, IconName>> = { plan: 'map', fly: 'compass', report: 'file-text', evidence: 'shield-check' }
/** Single-key shortcuts of the modes (§4.4: P, Y, R, E). */
export const MODE_KEY: Readonly<Record<Mode, string>> = { plan: 'P', fly: 'Y', report: 'R', evidence: 'E' }

/** Map modes get the timeline dock and the selection sidebar; REPORT and EVIDENCE are documents (D7 mockups 05, 06). */
export const isMapMode = (m: Mode): boolean => m === 'plan' || m === 'fly'
/** Map views without the EVA-time dock: the Mission Planer has its own times and margins panel. */
const NO_DOCK_ROUTES: ReadonlySet<Route['name']> = new Set(['mission'])
/** Whether the timeline dock shows: map modes, except the views in NO_DOCK_ROUTES. */
export const hasDock = (m: Mode, r: Route): boolean => isMapMode(m) && !NO_DOCK_ROUTES.has(r.name)

export const shell = {
  route: signal<Route>({ name: 'console' }),
  breakpoint: signal<Breakpoint>('desktop'),
  /** §4.3 "opens on selection": closed until A5 selects something or the user opens it. */
  sidebarOpen: signal<boolean>(false),
  focusMode: signal<boolean>(false),
  helpOpen: signal<boolean>(false),
  /** Tablet (768–1279) only: the rail is a 56 px icon column; its toggle opens the full rail as an
   *  overlay sheet over the map. Kept apart from ui.panels.leftRail so the desktop preference stays. */
  railSheet: signal<boolean>(false),
  /** L2 (D111): what the Plan map view (views/console.tsx, shell frame) shows itself, by id:
   *  'timeline' = the timeline is in its bottom drawer (the shell dock stays empty in Plan);
   *  'station'  = station selections open its station card (no sidebar, no Details toggle in Plan);
   *  any rail section id (e.g. 'layers') = that Plan rail section is drawn in a map popover instead.
   *  Add with hostIn(id) from the mount that does it; its cleanup removes it again. */
  hosted: signal<readonly string[]>([]),
  /** Last hash visited per mode, so a mode tab returns to where the user was (e.g. a station). */
  lastHash: signal<Readonly<Record<Mode, string>>>(Object.fromEntries(MODES.map((m) => [m, canonicalHref(MODE_VIEWS[m][0].route)])) as Record<Mode, string>),
}

/** L2 (D111): the rail is a 56 px icon column whose toggle opens a sheet over the map: on a tablet, and
 *  on desktop in the map modes (Plan, Fly), so the map keeps the width. Report and Evidence keep the
 *  desktop rail (documents). */
export const railSheetMode = (): boolean => {
  const bp = shell.breakpoint.value
  return bp === 'tablet' || (bp === 'desktop' && isMapMode(ui.mode.value ?? 'plan'))
}
/** Mark `id` as hosted by the Plan map view (shell.hosted); returns the undo. */
export function hostIn(id: string): () => void {
  shell.hosted.value = [...shell.hosted.peek().filter((x) => x !== id), id]
  return () => void (shell.hosted.value = shell.hosted.peek().filter((x) => x !== id))
}
/** In Plan, whether the map view hosts `id` (see shell.hosted). */
export const hostedInPlan = (id: string): boolean => (ui.mode.value ?? 'plan') === 'plan' && shell.hosted.value.includes(id)
/** Whether the Plan map view shows the timeline (its bottom drawer) instead of the shell dock. */
export const dockHosted = (): boolean => hostedInPlan('timeline')

export const railCollapsed = (): boolean => ui.panels.leftRail.value === TOKENS.layout.leftRailCollapsed
/** Whether the rail shows as icons only: on a tablet unless its sheet is open, on desktop when collapsed. */
export const railIconOnly = (): boolean => {
  const bp = shell.breakpoint.value
  return railSheetMode() ? !shell.railSheet.value : bp === 'desktop' && railCollapsed()
}
export function setRailCollapsed(c: boolean): void {
  ui.panels.leftRail.value = c ? TOKENS.layout.leftRailCollapsed : TOKENS.layout.leftRail
}
export const dockCollapsed = (): boolean => ui.panels.timeline.value === TOKENS.layout.timelineCollapsed
export function setDockCollapsed(c: boolean): void {
  ui.panels.timeline.value = c ? TOKENS.layout.timelineCollapsed : TOKENS.layout.timeline
}
export function openSidebar(): void {
  shell.sidebarOpen.value = true
}
export function closeSidebar(): void {
  shell.sidebarOpen.value = false
}

/** Called by the router loop on every rendered route: sets ui.mode (§5.2) and remembers the hash. */
export function applyRoute(route: Route, hash: string): Mode {
  const mode = modeOf(route)
  shell.route.value = route
  shell.railSheet.value = false // a rail link was followed (or the route changed): the sheet closes
  ui.mode.value = mode
  if (route.name !== 'notfound') shell.lastHash.value = { ...shell.lastHash.peek(), [mode]: hash.startsWith('#') ? hash : `#${hash}` }
  return mode
}

/** Hash a mode tab or its key leads to: the last place visited in that mode, else its first view. */
export const modeHash = (m: Mode): string => shell.lastHash.peek()[m]

// ---------------------------------------------------------------- extension points

export type Render = () => ComponentChildren
export interface RailSection {
  id: string
  /** Modes the section shows in. */
  modes: readonly Mode[]
  title: CopyKey
  icon: IconName
  render: Render
}
/** Rail sections (A6 moves view panels here); shown under the view list, in registration order. */
export const railSections = signal<readonly RailSection[]>([])
export function registerRailSection(s: RailSection): () => void {
  railSections.value = [...railSections.peek().filter((x) => x.id !== s.id), s]
  return () => void (railSections.value = railSections.peek().filter((x) => x !== s))
}
/** Sidebar body (A5: selection cards). undefined = the "nothing selected" empty state. */
export const sidebarContent = signal<Render | undefined>(undefined)
export function setSidebarContent(r: Render | undefined): void {
  sidebarContent.value = r
}
/** Timeline dock body (U5). undefined = the placeholder. */
export const dockContent = signal<Render | undefined>(undefined)
export function setDockContent(r: Render | undefined): void {
  dockContent.value = r
}
