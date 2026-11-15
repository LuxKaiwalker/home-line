// PORT I1: wiring of the Plan port packages into the Plan view (views/console.tsx calls these two).
//   installPlanPort()  once per app: registers the packages (Route panel, route layers, overlays, …)
//                      into the W0a seams (views/planPortSlots.tsx, map/extensions.ts)
//   mountPlanPort()    per Plan mount: starts the planning runner (route core, lazy chunk), applies the
//                      `#/?route=` link and keeps the address in step with the planning state (the ONE
//                      place that writes the planning state into the URL)
// §7b (decision I1, 21:20): the route core under edit/route/** is reached ONLY by import() inside
// functions here (a lazy chunk); live/route/route.test.tsx allow-lists these entry modules.
import { data } from '../data/loader'
import type { Station } from '../data/types'
import { install as installBasemaps } from '../map/basemaps'
import { install as installCuriosity } from '../map/overlays/curiosity'
import { install as installSlope } from '../map/overlays/slope'
import { overlayOn, setOverlay } from '../map/overlays/state'
import { install as installRoutes } from '../map/routes'
import { loadPadIndex, padService, prefetchPads } from '../pads'
import { encodeRouteParam, parsePlanningHash, planning, ROUTE_PARAM, type PlanningDoc, type PlanningStore } from '../state/planning'
import { installRoutePanel, registerRoutePanelSection } from '../ui/route-panel'
import { RouteSettings } from '../ui/route-panel/settings/RouteSettings'
import { install as installExport } from '../ui/route-panel/export'

let installed = false
const stationById = new Map<string, Station>()

/** Register every merged Plan-port package once (idempotent). */
export function installPlanPort(): void {
  if (installed) return
  installed = true
  installRoutePanel() // U1: slot 'route-panel'
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
  registerRoutePanelSection('settings', RouteSettings) // U3: EVA start, storm (D143 default on), boundary
  installExport() // U4: Send to MARVIS / Download mission.json + share link (Route panel section)
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

/**
 * Load the plan named by the address (`#/?route=…`) into the store. A link that already encodes the plan
 * on screen changes nothing (Back from #/trade keeps the undo history, D142). Returns true if it loaded.
 */
export function applyRouteLink(hash: string, store: PlanningStore = planning): boolean {
  const link = parsePlanningHash(hash)
  if (!link || link.legacy || !link.doc) return false
  if (encodeRouteParam(link.doc) === encodeRouteParam(store.doc.peek())) return false
  store.replace(link.doc)
  return true
}

/** Per Plan mount: route link in, runner on, planning state → address. Returns cleanup. */
export function mountPlanPort(store: PlanningStore = planning): () => void {
  let alive = true
  applyRouteLink(location.hash, store)
  const onHash = () => applyRouteLink(location.hash, store)
  window.addEventListener('hashchange', onHash)
  // URL sync: replaceState only (no hashchange, no history entry); the Plan page only
  const write = (doc: PlanningDoc) => {
    const next = syncedHash(location.hash, doc)
    if (next !== null && next !== (location.hash || '#/')) history.replaceState(history.state, '', next)
  }
  write(store.doc.peek())
  const offSync = store.doc.subscribe(write)
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
    window.removeEventListener('hashchange', onHash)
    offSync()
    stopRunner?.()
  }
}
