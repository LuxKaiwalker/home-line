// Mount of the Edit-route panel (R5, D97 §3.1): a Plan rail section in live builds only. Started from
// the live pad-tool hook of the console view (index.ts padTool, behind VITE_LIVE), so it exists only
// while the Plan console is open and has the console map; with VITE_LIVE off none of this is in the
// bundle path (isolation.test.ts). Text: edit/route/text.ts.
//
//   store    route store (edit/route/store.ts): every edit one undo step; the plan (pad, scenario)
//            is the one the console shows (mission state), read at every step
//   jobs     live/route/jobs.ts (startJob + loadStage + run record feasibility)
//   map      live/route/map.ts over the console map (staged layers, failing leg)
//   validity the published field of the plan shown, over each stop's access disc (WP6) + stations.json
//   WP12     ONE compute action (L6 W-1): the job's plan_inputs = the pad tool's valid spot (else the
//            plan in use) + the crew panel's changed fields + the route; the Live pad card calls
//            `compute()` of the handle given to onReady (opens this section, same controller action).
//            One undo (W-5, edit/route/undo.ts) behind the global Ctrl/Cmd-Z and the panel buttons.
//            I1b (D128, instant browser path): the panel is shown whatever /health says; every route
//            edit recomputes the whole route in the browser (edit/route/instant, next animation frame,
//            no server call) and "Send to simulator" exports that estimate. Offline only the server's
//            Compute plan is unavailable (a small note next to it, L-05's text).
import { h } from 'preact'
import { createRouteController, type RouteController } from '../../edit/route/controller'
import type { StationGeo, StopProbe } from '../../edit/route/model'
import { RoutePanel, type ResultSlot } from '../../edit/route/panel'
import { createRouteStore, registerRouteDraftTarget } from '../../edit/route/store'
import { createSharedUndo, type SharedUndo, type UndoWindow } from '../../edit/route/undo'
import type { LonLat, PlanInputs } from '../types'
import { installWaypointMap } from '../../edit/route/map'
import { discProbe } from '../../edit/route/map/validity'
import { ROUTE_TEXT } from '../../edit/route/text'
import { identityOf } from '../../edit/live'
import { loadEditCatalog, planAvailability, type EditCatalog, type EditPlan } from '../../edit/options'
import { data } from '../../data/loader'
import type { Station } from '../../data/types'
import { activeField, VARIANT_OF } from '../../map/field'
import { mission } from '../../state/mission'
import { officialPart } from '../../state/official'
import { effect, signal } from '../../state/signal'
import { offlineNoteText } from '../../edit/route/offline'
import { createRouteEstimate, type RouteEstimateOptions } from '../../edit/route/instant/estimate'
import { dockContent, registerRailSection, setDockContent, setRailCollapsed, shell, type Render } from '../../ui/shell/store'
import { planUrl } from '../plan'
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
  /** WP12: the Live pad tool's spot while it is a valid pad (null: the plan in use); subscribe = changes */
  pad?: { pad(): LonLat | null; subscribe(fn: () => void): () => void } | null
  /** WP12: the crew panel: inputs it adds ({crew: changed fields}; null = a field is not a number) and why */
  crew?: { jobInputs(): PlanInputs | null; blocked(): string | null; subscribe(fn: () => void): () => void } | null
  /** WP12: the handle the Live pad card uses (one compute action), once the panel exists */
  onReady?: (h: RouteHandle) => void
  /** S1: content of the route result box (Send to simulator); default: the S1 control when enabled */
  resultSlot?: ResultSlot | null
  /** WP12: the window for the one undo (default: window; null: none) */
  win?: UndoWindow | null
  /** I1b test seams of the browser estimate (compute core, frame scheduler, download) */
  estimate?: Pick<RouteEstimateOptions, 'core' | 'raf' | 'now' | 'save'>
}

/** What the Live pad card may do with the route panel (W-1). */
export interface RouteHandle {
  /** open the section and run the panel's Compute plan (a job already running: focus its progress) */
  compute(): void
  /** 'unavailable' (offline, or the route cannot be computed now), 'ready', 'running' */
  status(): 'unavailable' | 'ready' | 'running'
  subscribe(fn: () => void): () => void
  readonly ctl: RouteController
  readonly undo: SharedUndo
}

/**
 * The plan key H1 records (bind.ts followMission: scenario, budget, pad of mission.plan), with the
 * defaults filled in (an unset scenario or pad IS the default one), so the same plan has one key.
 */
export const missionPlanKey = (c: Pick<EditCatalog, 'defaultScenario' | 'officialPadId'>) => (): string =>
  JSON.stringify([mission.plan.scenario.peek() ?? c.defaultScenario, mission.plan.budgetMin.peek(), mission.plan.pad.peek() ?? c.officialPadId])

/** Open the Plan rail so the section is on screen (desktop: expanded rail; tablet: the rail sheet). */
function revealRail(): void {
  if (shell.breakpoint.peek() === 'tablet') shell.railSheet.value = true
  else setRailCollapsed(false)
}

/** The plan the console shows now (mission state), if the catalog has it; else the default plan. */
export function missionPlan(c: EditCatalog, spot: LonLat | null = null): EditPlan {
  const pad: EditPlan['pad'] = spot ? { lon: spot.lon, lat: spot.lat } : (mission.plan.pad.peek() ?? c.officialPadId)
  const p: EditPlan = { scenario: mission.plan.scenario.peek() ?? c.defaultScenario, budgetMin: mission.plan.budgetMin.peek(), pad, dwell: {} }
  if (planAvailability(p, c, true).ok) return p
  // W-1: a spot of the pad tool is computed at the pads index scenario and a band budget (D81 / D21),
  // never dropped for the official pad
  if (spot) {
    const q: EditPlan = { scenario: c.padScenario, budgetMin: c.bandBudgetsMin.includes(p.budgetMin) ? p.budgetMin : c.bandBudgetsMin[0], pad, dwell: {} }
    if (planAvailability(q, c, true).ok) return q
  }
  return { scenario: c.defaultScenario, budgetMin: c.bandBudgetsMin[0], pad: c.officialPadId, dwell: {} }
}

/** Validity lookups at a stop from the published field (null where the browser has no field). */
export function fieldProbe(lon: number, lat: number): StopProbe {
  // WP6: judged over the access disc (variants.yaml route.access_radius_m, D27) as the engine does
  // (edit/route/map/validity.ts, KATs on a synthetic field there), so the browser never refuses a
  // stop the engine accepts
  return discProbe(activeField(), lon, lat, VARIANT_OF[mission.plan.variant.peek() ?? 'nominal'] ?? 'nom')
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

/**
 * The dock while a route result (or its staged part) is on the map: the official timeline would be the
 * wrong plan, so the dock shows a note with a link to the result instead; the previous dock comes back
 * when the result is cleared.
 */
export function routeDock(c: RouteController): () => void {
  let prev: Render | undefined
  let mine: Render | null = null
  const put = (hash: string | null) => {
    if (!mine) prev = dockContent.peek()
    mine = () => h(RouteDockNote, { hash })
    setDockContent(mine)
  }
  const back = () => {
    if (mine && dockContent.peek() === mine) setDockContent(prev)
    mine = null
  }
  const off = effect(() => {
    const s = c.compute.value
    if ((s.kind === 'running' && s.stage) || s.kind === 'done' || (s.kind === 'failed' && s.stage)) put(s.kind === 'done' ? s.result.hash : (s.job?.hash ?? null))
    else back()
  })
  return () => {
    off()
    back()
  }
}

function RouteDockNote({ hash }: { hash: string | null }) {
  return (
    <p class="hl-route__docknote" role="status">
      {ROUTE_TEXT.dockNote}
      {hash ? (
        <>
          {' '}
          <a href={planUrl(hash)}>{ROUTE_TEXT.dockOpen}</a>
        </>
      ) : null}
    </p>
  )
}

/** Register the panel once its catalog is loaded; returns cleanup (also before the load finishes). */
export function mountRoutePanel(o: MountRouteOptions): () => void {
  let alive = true
  const offs: (() => void)[] = []
  const live = signal(false)
  const reason = signal<string | null>(ROUTE_TEXT.checkingLive)
  let ctl: RouteController | null = null
  const subs = new Set<() => void>()
  const emit = () => {
    for (const fn of [...subs]) fn()
  }

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
    const store = createRouteStore({
      catalog,
      plan: () => missionPlan(catalog, o.pad?.pad() ?? null),
      // the crew panel's changed fields go with the same job (W-1); a field that is not a number blocks it
      extra: () => o.crew?.jobInputs() ?? null,
      tag: missionPlanKey(catalog),
    })
    const blocked = signal<string | null>(o.crew?.blocked() ?? null)
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
      // after unmount the console map is gone: never restore or draw into it (R5-B)
      map: o.cmap ? consoleRouteMap(o.cmap, () => (alive ? (o.restore ?? restoreStatic)(o.cmap!).catch((e) => void (alive && console.warn('edit route: static plan not restored:', e))) : undefined), () => alive) : null,
      canCompute: live,
      blocked,
    }))
    // I1b (D128): the instant browser estimate, recomputed on every route / plan edit (no API involved)
    const est = createRouteEstimate({ store, pad: padOf, ...o.estimate })
    offs.push(() => est.dispose())
    // W-9 (L7b, T9): the top bar's "Official plan" clears a shown route result or a running job
    const op = officialPart('live-route', () => c.reset())
    offs.push(
      effect(() => op.set(c.compute.value.kind !== 'idle')),
      op.dispose,
    )
    // WP12: setRouteDraft (edit/route/store.ts, for the search route builder) writes to this panel
    offs.push(registerRouteDraftTarget(c.draftTarget()))
    const undo = createSharedUndo({ ctl: c, planKey: missionPlanKey(catalog), win: o.win === undefined ? (typeof window !== 'undefined' ? window : null) : o.win })
    offs.push(undo.install())
    // the pad tool's spot and the crew panel change the inputs and the hash, not the route history
    if (o.pad) offs.push(o.pad.subscribe(() => store.planChanged()))
    if (o.crew) {
      const crew = o.crew
      offs.push(
        crew.subscribe(() => {
          blocked.value = crew.blocked()
          store.planChanged()
        }),
      )
    }
    // the console's plan (pad drag, scenario) changes the inputs and the hash, not the route history
    let first = true
    offs.push(
      effect(() => {
        void mission.plan.pad.value
        void mission.plan.scenario.value
        void mission.plan.variant.value
        void mission.plan.budgetMin.value
        if (first) first = false
        else {
          store.planChanged()
          undo.planChanged()
        }
      }),
    )
    // I1b (D128): the section is registered once and stays, API up or down: the browser estimate and
    // Send to simulator need no server. Kit rule 4 / F23 now covers the server's Compute plan only:
    // disabled with the offline note (L-05's text) as its reason; a running job is dropped.
    let unregister: (() => void) | null = null
    const section = () => {
      const off = (o.register ?? registerRailSection)({
        id: ROUTE_SECTION_ID,
        modes: ['plan'],
        title: 'nav.rail.stationsRoute',
        icon: 'station',
        render: () => h(RoutePanel, { ctl: c, live, reason, undo, resultSlot: o.resultSlot ?? null, estimate: est, key: ROUTE_TEXT.title }),
      })
      // WP6: free waypoints (markers, click to add) and the ghost route (estimate) on the console map
      const offMap = installWaypointMap(c, o.cmap)
      return () => {
        offMap()
        off()
      }
    }
    if (alive) unregister = section()
    offs.push(() => {
      unregister?.()
      unregister = null
    })
    offs.push(
      o.onLiveState((s) => {
        const b = bannerFor(s)
        live.value = b.controls && b.heavyJobs
        reason.value = b.controls ? (b.heavyJobs ? null : ROUTE_TEXT.heavyJobsOff) : offlineNoteText(s, b.text)
        if (!b.controls) c.reset()
        emit()
        // the engine identity (plan hash) is asked again once the server is back
        if (b.controls && !store.identity.peek()) askIdentity()
      }),
    )
    // R5-C: while a route result is shown, the EVA-time dock must not show the official plan's timeline
    offs.push(routeDock(c))
    // W-1: the Live pad card's handle (one compute action, one job, one progress)
    offs.push(effect(() => {
      void c.compute.value
      void c.check.value
      void live.value
      void blocked.value
      emit()
    }))
    o.onReady?.({
      ctl: c,
      undo,
      status: () => (c.compute.peek().kind === 'running' ? 'running' : unregister && live.peek() ? 'ready' : 'unavailable'),
      subscribe(fn) {
        subs.add(fn)
        return () => void subs.delete(fn)
      },
      compute() {
        if (!unregister) return
        revealRail()
        if (!c.computePlan() && c.compute.peek().kind !== 'running') c.requestFocus()
      },
    })
  })().catch((e) => console.warn('edit route unavailable:', e))

  return () => {
    alive = false
    ctl?.dispose()
    for (const f of offs.reverse()) f()
  }
}
