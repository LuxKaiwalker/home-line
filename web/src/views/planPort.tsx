// PORT I1: wiring of the Plan port packages into the Plan view (views/console.tsx calls these two).
//   installPlanPort()  once per app: registers the packages (Route panel, route layers, overlays, …)
//                      into the W0a seams (views/planPortSlots.tsx, map/extensions.ts)
//   mountPlanPort()    per Plan mount: starts the planning runner (route core, lazy chunk) and keeps the
//                      address in step with the planning state (the ONE place that writes the planning
//                      state into the URL). Reading a link (#/?route=, ?add=, old #/mission links) is U4's
//                      applyPlanLink, called by main.ts on load and on every hashchange (I3).
// §7b (decision I1, 21:20): the route core under edit/route/** is reached ONLY by import() inside
// functions here (a lazy chunk); live/route/route.test.tsx allow-lists these entry modules.
import { data } from '../data/loader'
import type { Station } from '../data/types'
import { install as installBasemaps } from '../map/basemaps'
import { install as installCuriosity } from '../map/overlays/curiosity'
import { install as installSlope } from '../map/overlays/slope'
import { overlayOn, setOverlay } from '../map/overlays/state'
import { install as installPads } from '../map/pads'
import { install as installRoutes } from '../map/routes'
import { loadPadIndex, padService, prefetchPads } from '../pads'
import { mission } from '../state/mission'
import { installPlanningActivity } from '../state/planningActivity'
import { encodeRouteParam, OFFICIAL_PAD_ID, planning, ROUTE_PARAM, type PlanningDoc, type PlanningStore } from '../state/planning'
import { effect } from '../state/signal'
import { Banner } from '../ui/components'
import { installRoutePanel, openRoutePanel, registerRoutePanelSection, routePanelOpen } from '../ui/route-panel'
import { browserLinkIO, clearPlanLinkNotice, planLinkNotice } from '../ui/route-panel/export/planLink'
import { WaypointList } from '../ui/route-panel/list'
import { StartTimeSettings, StormSettings, type SettingsProps } from '../ui/route-panel/settings/RouteSettings'
import { t } from '../ui/copy'
import { installStrip } from '../ui/strip'
import { useSignalValue } from '../state/signal'
import { install as installExport } from '../ui/route-panel/export'

import './planPort.css'

let installed = false

// R3: `?add=<station>` (U4's applyPlanLink, main.ts) appends through R3's helper (route limits + notice);
// the R3 chunk loads on demand, so the stop may land a moment after the link is read (the URL sync follows)
type R3Add = { addStationToRoute(station: string): unknown }
let r3Add: R3Add | null = null
const loadR3Add = (): Promise<R3Add> => import('../edit/route/map/addToRoute').then((m) => (r3Add = m))
browserLinkIO.addStation = (station, store) => {
  if (store !== planning) return void store.addStop({ kind: 'station', station })
  if (r3Add) r3Add.addStationToRoute(station)
  else void loadR3Add().then((m) => m.addStationToRoute(station)).catch(() => planning.addStop({ kind: 'station', station }))
}
const stationById = new Map<string, Station>()

/** Register every merged Plan-port package once (idempotent). */
export function installPlanPort(): void {
  if (installed) return
  installed = true
  installRoutePanel() // U1: slot 'route-panel'
  installPads() // P2: pad markers + pad card ("Plan from here"), env swap; slot 'pad-layer'
  installStrip({ onPlanRoute: () => openRoutePanel() }) // P3: one-line context bar + drawer summary
  // R4: 'official' + 'mine' route layers and their legend (layers popover); station positions from the station list
  installRoutes({
    stationAt: (id) => {
      const s = stationById.get(id)
      return s ? [s.lon, s.lat] : null
    },
    stationName: (id) => stationById.get(id)?.name ?? null,
  })
  installCuriosity() // L1b: off by default, no request until turned on
  installSlope() // L1a: replaces the U7 slope-classes overlay (its row is hidden, it stays off)
  if (overlayOn.peek().slopeClass) setOverlay('slopeClass', false)
  installBasemaps() // L1c: satellite (default) / topography / material, map-edge switcher
  registerRoutePanelSection('list', WaypointList) // U2: waypoint list
  registerRoutePanelSection('settings', PlanRouteSettings) // U3 (EVA start + storm; boundary: see below): EVA start, storm (D143 default on), boundary
  installExport() // U4: Send to MARVIS / Download mission.json + share link (Route panel section)
  // R3: map editing (click = free point, drag, delete, ghost), live only while the Route panel is open
  void import('../edit/route/map/plan')
    .then((m) => {
      m.install()
      effect(() => m.setEditing(routePanelOpen.value))
    })
    .catch((e) => console.warn('map editing unavailable', e))
  void loadR3Add().catch(() => {})
  void data()
    .stations()
    .then((list) => list.forEach((s) => stationById.set(s.id, s)))
    .catch(() => {}) // R4 falls back to the result paths' ends
}

/** The Plan page hash? ('#/' or '#/?…'; other views are left alone.) */
function planQuery(hash: string): URLSearchParams | null {
  const [path, query = ''] = hash.replace(/^#/, '').split('?', 2)
  if (path.split('/').filter(Boolean).length) return null
  return new URLSearchParams(query)
}

/** The Plan hash for `doc`, keeping any other parameter of the current hash (story, collapse, …). */
export function syncedHash(hash: string, doc: PlanningDoc): string | null {
  const q = planQuery(hash)
  if (!q) return null
  const v = encodeRouteParam(doc)
  if (v) q.set(ROUTE_PARAM, v)
  else q.delete(ROUTE_PARAM)
  const s = q.toString()
  return s ? `#/?${s}` : '#/'
}

/** Per Plan mount: runner on, pad sync, planning state → address. Returns cleanup. */
export function mountPlanPort(store: PlanningStore = planning): () => void {
  let alive = true
  // URL sync: replaceState only (no hashchange, no history entry); the Plan page only
  const write = (doc: PlanningDoc) => {
    const next = syncedHash(location.hash, doc)
    if (next !== null && next !== (location.hash || '#/')) history.replaceState(history.state, '', next)
  }
  write(store.doc.peek())
  const offSync = store.doc.subscribe(write)
  // One active pad (P3 note 4): the planning store's padId (Route panel picker, P2 "Plan from here", the
  // link) and the console's D21 pad (mission.plan.pad: plan table picker; the drawer/strip numbers) follow
  // each other. On mount the planning store wins (it carries the link).
  const consolePad = (id: string) => (id === OFFICIAL_PAD_ID ? null : id)
  const toConsole = (id: string) => {
    if (mission.plan.pad.peek() !== consolePad(id)) mission.plan.pad.value = consolePad(id)
  }
  toConsole(store.state.peek().padId)
  const offPadA = store.state.subscribe((s) => toConsole(s.padId))
  const offPadB = mission.plan.pad.subscribe((p) => {
    const want = p ?? OFFICIAL_PAD_ID
    if (store.state.peek().padId !== want) store.setPad(want)
  })
  // I2: planning edits stop players; one Ctrl/Cmd-Z timeline over the planning store (undo.ts, lazy)
  const offActivity = installPlanningActivity({ store })
  // R1: the planning runner (worker + route results). Lazy: the route core is its own chunk (§7b).
  let stopRunner: (() => void) | null = null
  // P1: after first paint, prefetch the picker pads with routing fields in idle time (never evicts a used pad)
  const prefetch = setTimeout(() => {
    void loadPadIndex()
      .then((pads) => alive && prefetchPads(pads.filter((p) => !p.official && p.hasRoutingFields).map((p) => p.id)))
      .catch(() => {})
  }, 0)
  void import('../edit/route/browser/runner')
    .then(({ startPlanningRunner }) => {
      if (alive) stopRunner = startPlanningRunner(store, padService()).stop
    })
    .catch((e) => console.warn('planning runner unavailable', e))
  return () => {
    alive = false
    clearTimeout(prefetch)
    offSync()
    offPadA()
    offActivity()
    offPadB()
    stopRunner?.()
  }
}

/**
 * U3's settings without the boundary selector: nothing draws route.boundary on the Plan map yet (the
 * Mission Planer drew it), and a selector that does nothing is worse than none (orchestrator 21:19; cut
 * list). Mount U3's RouteSettings again once a boundary layer exists.
 */
function PlanRouteSettings({ store = planning }: SettingsProps) {
  return (
    <section class="rp-settings" aria-label={t('route.settings.title')}>
      <StartTimeSettings store={store} />
      <StormSettings store={store} />
    </section>
  )
}

/** U4 note 3: a link that could not be read says so over the Plan map (the Route panel is closed by default). */
export function PlanLinkNotice() {
  const n = useSignalValue(planLinkNotice)
  if (!n) return null
  return (
    <div class="plan-linknotice">
      <Banner kind={n.kind === 'error' ? 'caution' : 'info'} title={n.text} onDismiss={clearPlanLinkNotice} />
    </div>
  )
}
