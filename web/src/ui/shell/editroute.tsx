// Edit-route drawer and its map-edge opener (L3, D111; Notion plan §4, §7). Where the live panels are
// MOUNTED in live builds: the Edit-route panel (R5, edit/route/panel.tsx), the crew panel (F26,
// live/crewview.tsx), "My plans" (R7, live/plans/view.tsx) and "Send to simulator" (S1,
// ui/cards/simslot-export.tsx).
// Mount only: every panel, its props and its logic stay in web/src/live/ and web/src/edit/route/
// (waypoint block); this file only decides the container they render in.
//
//   live/route/mount.tsx   registers the route panel here (registerEditRoute) instead of the Plan rail;
//                          I1b (D128, instant browser path): it registers whatever /health says (the
//                          browser estimate and Send to simulator need no server), so the "Edit route"
//                          button and the drawer stay with the API down; the offline note
//                          (RouteOfflineNote, registerEditRouteNote) then sits inside the drawer and says
//                          only the server's Compute plan is unavailable
//   live/padmount.tsx      puts the crew panel into the drawer (setEditRouteCrew) while a host is mounted
//   views/console.tsx      mounts the host inside the console map (mountEditRoute), live builds only
//
// Loaded only through the VITE_LIVE dynamic import in views/console.tsx (and the live chunks), so
// the static build does not contain it. It imports nothing from src/live/ (isolation.test.ts): the
// D116 gate (live/config.ts ROUTE_EDIT_ENABLED) and the "My plans" store and list come in through
// mountEditRoute, from the guarded import in views/console.tsx. Layout store ids (L5 selector
// contract): edit-route (Drawer), crew and my-plans (Collapsible inside it).
import { render, type ComponentType } from 'preact'
import { useState } from 'preact/hooks'
import { signal, useSignalValue, type ReadSignal } from '../../state/signal'
import { SendToSimulator, type SendToSimulatorProps } from '../cards/simslot-export'
import { Button } from '../components'
import { Collapsible, Drawer, useLayoutInsets, useOpener } from '../layout'
import type { RailSection, Render } from './store'
import './editroute.css'

export const EDIT_ROUTE_ID = 'edit-route'
export const CREW_ID = 'crew'
export const MY_PLANS_ID = 'my-plans'
export const EDIT_ROUTE_TITLE = 'Edit route'
export const MY_PLANS_SECTION_TITLE = 'My plans'

/** The route panel (R5); undefined = not loaded (I1b: registered with the API up or down). */
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

/** The registered route panel render (read-only; tests and the host). */
export const editRouteSection: ReadSignal<Render | undefined> = routeRender

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

/** The note in the button's place while live planning is unreachable (WP12 RouteOfflineNote, W-7). */
const noteRender = signal<Render | undefined>(undefined)

/**
 * SLOT (W-7, waypoint WP12 #152): the offline note "Route editing needs the live planner" takes the
 * Edit-route button's place while live planning is unreachable. The route mount registers WP12's
 * edit/route/offline.tsx RouteOfflineNote here (registerEditRouteNote) once #152 is in; until then
 * nothing registers and the edge stays empty (the offline banner covers it, kit rule 4).
 */
export function registerEditRouteNote(s: Pick<RailSection, 'render'>): () => void {
  noteRender.value = s.render
  return () => {
    if (noteRender.peek() === s.render) noteRender.value = undefined
  }
}

function EditRouteOfflineNoteSlot() {
  const note = useSignalValue(noteRender)
  return note ? <>{note()}</> : null
}

/**
 * "Send to simulator" (S1 #144, D110): the plan's mission.json, next to the route panel's export. The
 * drawer offers the official plan's file (origin precomputed; mode 'all' tries the API copy first);
 * a live result's file is in the route panel's result box (WP12). Mode 'off' (VITE_SIM_EXPORT unset)
 * renders nothing.
 */
function EditRouteSimSlot({ mode }: { mode: SimMode }) {
  return mode === 'off' ? null : <SendToSimulator origin="precomputed" mode={mode} />
}

/** live/config.ts SIM_EXPORT_MODE (VITE_SIM_EXPORT). */
export type SimMode = NonNullable<SendToSimulatorProps['mode']>

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

export function EditRouteHost<Snap>({ plans, simMode = 'off' }: { plans: MyPlansDeps<Snap>; simMode?: SimMode }) {
  const route = useSignalValue(routeRender)
  const crew = useSignalValue(crewSlot)
  const { bottom } = useLayoutInsets()
  const edgeStyle = { marginBottom: `${bottom}px` }
  if (!route)
    return (
      <div class="hl-ui hl-editroute__edge" style={edgeStyle}>
        <EditRouteOfflineNoteSlot />
      </div>
    )
  return (
    <>
      <div class="hl-ui hl-editroute__edge" style={edgeStyle}>
        <EditRouteButton />
      </div>
      <Drawer id={EDIT_ROUTE_ID} title={EDIT_ROUTE_TITLE} class="hl-ui hl-editroute__drawer">
        <EditRouteOfflineNoteSlot />
        {route()}
        <EditRouteSimSlot mode={simMode} />
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
  /** D116: live/config.ts ROUTE_EDIT_ENABLED (VITE_ROUTE_EDIT); false mounts nothing (no button, no drawer). */
  enabled: boolean
  /** S1: live/config.ts SIM_EXPORT_MODE (default 'off': no "Send to simulator"). */
  simMode?: SimMode
}

/** Mount the host inside the map container `mapEl` (position: relative); returns cleanup. */
export function mountEditRoute<Snap>(mapEl: Element, plans: MyPlansDeps<Snap>, o: MountEditRouteOptions): () => void {
  if (!o.enabled) return () => {}
  const el = mapEl.appendChild(document.createElement('div'))
  el.setAttribute('class', 'hl-editroute')
  hosts++
  render(<EditRouteHost plans={plans} simMode={o.simMode} />, el)
  let done = false
  return () => {
    if (done) return
    done = true
    hosts--
    render(null, el)
    el.remove()
  }
}
