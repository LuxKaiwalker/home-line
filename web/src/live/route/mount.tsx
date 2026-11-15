// Mount of the Edit-route panel (R5, D97 §3.1): a Plan rail section in live builds only. Started from
// the live pad-tool hook of the console view (index.ts padTool, behind VITE_LIVE), so it exists only
// while the Plan console is open and has the console map; with VITE_LIVE off none of this is in the
// bundle path (isolation.test.ts). Text: edit/route/text.ts.
//
//   store    route store (edit/route/store.ts): every edit one undo step; the plan (pad, scenario)
//            is the one the console shows (mission state), read at every step
//   jobs     live/route/jobs.ts (startJob + loadStage + run record feasibility)
//   map      live/route/map.ts over the console map (staged layers, failing leg)
//   validity fieldAt at each stop (published field of the plan shown) + stations.json
import { h } from 'preact'
import { createRouteController, type RouteController } from '../../edit/route/controller'
import type { StationGeo, StopProbe } from '../../edit/route/model'
import { RoutePanel } from '../../edit/route/panel'
import { createRouteStore } from '../../edit/route/store'
import { ROUTE_TEXT } from '../../edit/route/text'
import { identityOf } from '../../edit/live'
import { loadEditCatalog, planAvailability, type EditCatalog, type EditPlan } from '../../edit/options'
import { data } from '../../data/loader'
import type { Station } from '../../data/types'
import { fieldAt, VARIANT_OF } from '../../map/field'
import { mission } from '../../state/mission'
import { effect, signal } from '../../state/signal'
import { registerRailSection } from '../../ui/shell/store'
import type { ApiClient } from '../client'
import { bannerFor, type LiveState } from '../health'
import type { LoaderFor } from '../stage'
import { consoleRouteMap, type RouteConsoleMap } from './map'
import { createRouteJobs, type RouteJobsOptions } from './jobs'

export const ROUTE_SECTION_ID = 'edit-route'

export interface MountRouteOptions {
  client: ApiClient
  onLiveState: (fn: (s: LiveState) => void) => () => void
  loaderFor?: LoaderFor
  /** poll timing overrides (tests) */
  job?: RouteJobsOptions['job']
  /** the console map (null: the panel works without drawing) */
  cmap?: RouteConsoleMap | null
  /** put the console's static plan back (default: reload it from the static tree) */
  restore?: (cm: RouteConsoleMap) => Promise<void>
  /** test seams */
  catalog?: EditCatalog
  stations?: readonly StationGeo[]
  probe?: (lon: number, lat: number) => StopProbe
  register?: typeof registerRailSection
}

/** The plan the console shows now (mission state), if the catalog has it; else the default plan. */
export function missionPlan(c: EditCatalog): EditPlan {
  const p: EditPlan = { scenario: mission.plan.scenario.peek() ?? c.defaultScenario, budgetMin: mission.plan.budgetMin.peek(), pad: mission.plan.pad.peek() ?? c.officialPadId, dwell: {} }
  return planAvailability(p, c, true).ok ? p : { scenario: c.defaultScenario, budgetMin: c.bandBudgetsMin[0], pad: c.officialPadId, dwell: {} }
}

/** Validity lookups at a stop from the published field (null where the browser has no field). */
export function fieldProbe(lon: number, lat: number): StopProbe {
  const s = fieldAt(lon, lat)
  if (!s) return { inGrid: null, assessed: null, walkable: null, reachable: null }
  if (!s.inside) return { inGrid: false, assessed: null, walkable: null, reachable: null }
  const v = VARIANT_OF[mission.plan.variant.peek() ?? 'nominal'] ?? 'nom'
  return {
    inGrid: true,
    assessed: s.state === null ? null : s.state !== 'unknown' && s.state !== 'outside',
    walkable: s.state === null ? null : s.state !== 'blocked',
    reachable: s.tHome[v] !== null,
  }
}

/** Put the console's own static plan back after a live result (bands, isochrones, edges, partner, route). */
async function restoreStatic(cm: RouteConsoleMap): Promise<void> {
  const L = data()
  const idx = await L.scenarios()
  const s = idx.scenarios.find((x) => x.id === mission.plan.scenario.peek()) ?? idx.scenarios.find((x) => x.id === idx.default)
  if (!s) return
  const [bands, isochrones, edges, partner, route] = await Promise.all([L.bands(s), L.isochrones(s), L.edges(s), L.partner(s), L.route(s.id).catch(() => null)])
  await cm.setScenarioData({ bands, isochrones, edges, partner, variant: s.variant })
  await cm.setRoute(route)
}

/** Register the panel once its catalog is loaded; returns cleanup (also before the load finishes). */
export function mountRoutePanel(o: MountRouteOptions): () => void {
  let alive = true
  const offs: (() => void)[] = []
  const live = signal(false)
  const reason = signal<string | null>(ROUTE_TEXT.checkingLive)
  let ctl: RouteController | null = null

  void (async () => {
    const L = data()
    const [catalog, rows] = await Promise.all([o.catalog ?? loadEditCatalog((p) => L.json(p)), o.stations ?? L.stations()])
    if (!alive) return
    const stations: StationGeo[] = (rows as readonly (StationGeo & Partial<Pick<Station, 'name'>> & { access_lon?: number; access_lat?: number })[]).map((s) => ({
      id: s.id,
      name: s.name,
      lon: s.access_lon ?? s.lon,
      lat: s.access_lat ?? s.lat,
    }))
    const store = createRouteStore({ catalog, plan: () => missionPlan(catalog) })
    const padOf = () => {
      const p = store.step.peek().inputs.pad
      return { lon: p.lon, lat: p.lat }
    }
    let asking = false
    function askIdentity(): void {
      if (asking) return
      asking = true
      o.client
        .engineVersion()
        .then((v) => alive && store.setIdentity(identityOf(v)))
        .catch(() => alive && store.setIdentity(null))
        .finally(() => (asking = false))
    }
    askIdentity()
    const c = (ctl = createRouteController({
      store,
      jobs: createRouteJobs({ client: o.client, loaderFor: o.loaderFor, job: o.job }),
      stations,
      pad: padOf,
      probe: o.probe ?? fieldProbe,
      map: o.cmap ? consoleRouteMap(o.cmap, () => (o.restore ?? restoreStatic)(o.cmap!).catch((e) => console.warn('edit route: static plan not restored:', e))) : null,
      canCompute: live,
    }))
    // the console's plan (pad drag, scenario) changes the inputs and the hash, not the route history
    let first = true
    offs.push(
      effect(() => {
        void mission.plan.pad.value
        void mission.plan.scenario.value
        void mission.plan.variant.value
        if (first) first = false
        else store.planChanged()
      }),
    )
    offs.push(
      o.onLiveState((s) => {
        const b = bannerFor(s)
        live.value = b.controls && b.heavyJobs
        reason.value = b.controls ? (b.heavyJobs ? null : ROUTE_TEXT.heavyJobsOff) : (b.text ?? ROUTE_TEXT.checkingLive)
        if (!b.controls) c.reset()
        // the engine identity (plan hash) is asked again once the server is back
        else if (!store.identity.peek()) askIdentity()
      }),
    )
    offs.push((o.register ?? registerRailSection)({ id: ROUTE_SECTION_ID, modes: ['plan'], title: 'nav.rail.stationsRoute', icon: 'station', render: () => h(RoutePanel, { ctl: c, live, reason, key: ROUTE_TEXT.title }) }))
  })().catch((e) => console.warn('edit route unavailable:', e))

  return () => {
    alive = false
    ctl?.dispose()
    for (const f of offs.reverse()) f()
  }
}
