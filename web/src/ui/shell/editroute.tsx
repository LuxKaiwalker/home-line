// Edit-route drawer and its map-edge opener (L3, D111; Notion plan §4, §7). Where the live panels are
// MOUNTED in live builds: the Edit-route panel (R5, edit/route/panel.tsx), the crew panel (F26,
// live/crewview.tsx), "My plans" (R7, live/plans/view.tsx) and the "Send to simulator" slot (S1).
// Mount only: every panel, its props and its logic stay in web/src/live/ and web/src/edit/route/
// (waypoint block); this file only decides the container they render in.
//
//   live/route/mount.tsx   registers the route panel here (registerEditRoute) instead of the Plan rail;
//                          it registers only while /health says the live controls are on, so the
//                          "Edit route" button and the drawer exist only then (kit rule 4)
//   live/padmount.tsx      puts the crew panel into the drawer (setEditRouteCrew) while a host is mounted
//   views/console.tsx      mounts the host inside the console map (mountEditRoute), live builds only
//
// Loaded only through the VITE_LIVE dynamic import in views/console.tsx (and the live chunks), so
// the static build does not contain it. It imports nothing from src/live/ (isolation.test.ts): the
// "My plans" store and list come in through mountEditRoute (MyPlansDeps), from the guarded import. Layout store ids (L5 selector contract): edit-route (Drawer),
// crew and my-plans (Collapsible inside it).
import { render, type ComponentType } from 'preact'
import { useState } from 'preact/hooks'
import { signal, useSignalValue } from '../../state/signal'
import { Button } from '../components'
import { Collapsible, Drawer, useLayoutInsets, useOpener } from '../layout'
import type { RailSection, Render } from './store'
import './editroute.css'

export const EDIT_ROUTE_ID = 'edit-route'
export const CREW_ID = 'crew'
export const MY_PLANS_ID = 'my-plans'
export const EDIT_ROUTE_TITLE = 'Edit route'
export const MY_PLANS_SECTION_TITLE = 'My plans'

// D116 (WP14, #142): VITE_ROUTE_EDIT=0 hides route editing; the button and the drawer go with it.
// TODO(L3, WP14): local fallback until #142 merges, then import ROUTE_EDIT_ENABLED from
// live/config.ts (same parsing: '0' or 'false' turns it off; anything else, or unset, is on).
export function isRouteEditFlag(value: string | boolean | undefined): boolean {
  return !(value === false || value === '0' || value === 'false')
}
export const ROUTE_EDIT_ENABLED: boolean = isRouteEditFlag(import.meta.env.VITE_ROUTE_EDIT as string | boolean | undefined)

/** The route panel (R5) while its live controls are on; undefined = offline / checking / not loaded. */
const routeRender = signal<Render | undefined>(undefined)
/** The crew panel (F26) and whether its fields differ from the defaults ("Crew: default · Edit"). */
export interface CrewSlot {
  summary: 'default' | 'changed'
  render: Render
}
const crewSlot = signal<CrewSlot | undefined>(undefined)
let hosts = 0

/**
 * Same call shape as registerRailSection (live/route/mount.tsx passes it the rail section it used to
 * register); only `render` is used: the drawer has its own id and title. Returns unregister.
 */
export function registerEditRoute(s: Pick<RailSection, 'render'>): () => void {
  routeRender.value = s.render
  return () => {
    if (routeRender.peek() === s.render) routeRender.value = undefined
  }
}

/** True while a host is mounted (the console map in a live build with route editing on). */
export const editRouteHosted = (): boolean => hosts > 0

/** The crew panel into the drawer (undefined removes it). */
export function setEditRouteCrew(c: CrewSlot | undefined): void {
  crewSlot.value = c
}

/** "Edit route" at the map edge: opens and closes the drawer (aria-expanded / aria-controls). */
function EditRouteButton() {
  const opener = useOpener(EDIT_ROUTE_ID)
  return (
    <Button variant="primary" icon="thread-home" class="hl-editroute__open" {...opener}>
      {EDIT_ROUTE_TITLE}
    </Button>
  )
}

/**
 * SLOT (W-7, waypoint WP12): the offline note "Route editing needs the live planner" goes here, where
 * the Edit-route button is while live planning is unreachable. WP12 exports the component (rendering
 * only while live is unreachable); it is mounted here once its PR is up. Empty until then.
 */
function EditRouteOfflineNoteSlot() {
  return null
}

/**
 * SLOT (S1, branch ws15-design-system-S1): "Send to simulator", next to export in the drawer. Mounted
 * here once S1's PR has merged; WP12 mounts the same component in the route result box. Empty until then.
 */
function EditRouteSimSlot() {
  return null
}

type PlansResult = { ok: true } | { ok: false; error: string }
/** "My plans" from src/live/plans (passed in: this file may not import src/live/). */
export interface MyPlansDeps<Snap = unknown> {
  /** live/plans/store.ts createPlansStore() (this browser's storage) */
  store: { list(): Snap; rename(id: string, title: string): PlansResult; remove(id: string): PlansResult }
  /** live/plans/view.tsx MyPlans, rendered unchanged */
  View: ComponentType<{ snap: Snap; error: string | null; onSave: (hash: string) => void; onRename: (id: string, title: string) => void; onRemove: (id: string) => void }>
}

/** The "My plans" list on the plan store; redrawn after each action (as planmount.tsx does). */
function MyPlansSection<Snap>({ deps: { store, View } }: { deps: MyPlansDeps<Snap> }) {
  const [error, setError] = useState<string | null>(null)
  const [, redraw] = useState(0)
  const act = (r: PlansResult) => {
    setError(r.ok ? null : r.error)
    redraw((n) => n + 1)
  }
  // saving happens on the plan page (#/plan/{hash}); the list here opens, renames, exports and deletes
  return <View snap={store.list()} error={error} onSave={() => {}} onRename={(id, title) => act(store.rename(id, title))} onRemove={(id) => act(store.remove(id))} />
}

export function EditRouteHost<Snap>({ plans }: { plans: MyPlansDeps<Snap> }) {
  const route = useSignalValue(routeRender)
  const crew = useSignalValue(crewSlot)
  const { bottom } = useLayoutInsets()
  const edgeStyle = { marginBottom: `${bottom}px` }
  if (!route)
    return (
      <div class="hl-editroute__edge" style={edgeStyle}>
        <EditRouteOfflineNoteSlot />
      </div>
    )
  return (
    <>
      <div class="hl-editroute__edge" style={edgeStyle}>
        <EditRouteButton />
      </div>
      <Drawer id={EDIT_ROUTE_ID} title={EDIT_ROUTE_TITLE}>
        {route()}
        <EditRouteSimSlot />
        {crew ? (
          <Collapsible id={CREW_ID} title={`Crew: ${crew.summary}`} hint="Edit">
            {crew.render()}
          </Collapsible>
        ) : null}
        <Collapsible id={MY_PLANS_ID} title={MY_PLANS_SECTION_TITLE}>
          <MyPlansSection deps={plans} />
        </Collapsible>
      </Drawer>
    </>
  )
}

export interface MountEditRouteOptions {
  /** D116: VITE_ROUTE_EDIT (default ROUTE_EDIT_ENABLED); false mounts nothing. */
  enabled?: boolean
}

/** Mount the host inside the map container `mapEl` (position: relative); returns cleanup. */
export function mountEditRoute<Snap>(mapEl: Element, plans: MyPlansDeps<Snap>, o: MountEditRouteOptions = {}): () => void {
  if (!(o.enabled ?? ROUTE_EDIT_ENABLED)) return () => {}
  const el = mapEl.appendChild(document.createElement('div'))
  el.setAttribute('class', 'hl-editroute')
  hosts++
  render(<EditRouteHost plans={plans} />, el)
  let done = false
  return () => {
    if (done) return
    done = true
    hosts--
    render(null, el)
    el.remove()
  }
}
