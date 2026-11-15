// PORT R3: entry of waypoint editing on the Plan map. I1 calls `install()` once (views/console.tsx)
// and wires `setEditing(on)` to the route panel / "Plan a route" mode. Everything reads and writes
// the app's ONE planning store (state/planning.ts); the active pad's routing field (pads/, P1) judges
// validity once it is loaded (never awaited: unknown never refuses).
//
// Map access: EditHandlers has no install hook, so the handles / ghost / notice are installed through
// a pad-environment handler (map/extensions.ts registerPadEnvironment; it also keeps the env of the
// active pad at hand). One `install()` registers both; the returned Dispose removes both.
import { registerEditHandlers, registerPadEnvironment, type Dispose } from '../../../map/extensions'
import { listPads, loadPadEnv, peekPadEnv, type PadEnv, type RoutingFields } from '../../../pads'
import { planning, subscribePlanning, selectPad, type PlanningStore } from '../../../state/planning'
import { data } from '../../../data/loader'
import type { StationGeo } from '../model'
import { createPlanEditor, UNKNOWN_POINT, type PlanEditor, type PointProbe } from './planEdit'
import { bindPlanEditMap } from './planMap'
import { ACCESS_RADIUS_M } from './validity'

/** Validity from a pad's routing field: outside its extent, or no known walk home within the access disc. */
export function fieldProbe(rf: Pick<RoutingFields, 'tHome'> | null | undefined, radiusM = ACCESS_RADIUS_M): (lon: number, lat: number) => PointProbe {
  if (!rf?.tHome) return () => UNKNOWN_POINT
  const g = rf.tHome
  return (lon, lat) => {
    if (!g.pixelOf(lon, lat)) return { inGrid: false, reachable: null }
    return { inGrid: true, reachable: g.valueAt(lon, lat) !== null || g.discMax(lon, lat, radiusM) !== null }
  }
}

export interface PlanEditEnv {
  store?: PlanningStore
  /** the env of a pad if loaded (default pads/ peekPadEnv); never awaited */
  env?: (padId: string) => PadEnv | undefined
  stations?: () => readonly StationGeo[]
}

/** An editor bound to a planning store, its active pad's env and the stations. */
export function createPlanEditorFor(e: PlanEditEnv = {}): PlanEditor {
  const store = e.store ?? planning
  const envOf = e.env ?? safePeek
  const padId = () => store.doc.peek().padId
  return createPlanEditor({
    store,
    probe: (lon, lat) => fieldProbe(envOf(padId())?.routingFields)(lon, lat),
    pad: () => {
      const env = envOf(padId())
      if (env) return env.routingFields?.pad ?? { lon: env.info.lon, lat: env.info.lat }
      const info = safeList().find((p) => p.id === padId())
      return info ? { lon: info.lon, lat: info.lat } : null
    },
    stations: e.stations ?? appStations,
  })
}

function safePeek(id: string): PadEnv | undefined {
  try {
    return peekPadEnv(id)
  } catch {
    return undefined
  }
}
function safeList() {
  try {
    return listPads()
  } catch {
    return []
  }
}
/** Warm the active pad's env in the background (P1 caches it); errors leave validity unknown. */
function warm(id: string): void {
  try {
    void loadPadEnv(id).catch(() => {})
  } catch {
    /* no pad service yet */
  }
}

let stationsCache: StationGeo[] = []
let stationsAsked = false
/** stations.json as StationGeo (loaded once, in the background; empty until then). */
function appStations(): readonly StationGeo[] {
  if (!stationsAsked && typeof window !== 'undefined') {
    stationsAsked = true
    void data()
      .stations()
      .then((rows) => (stationsCache = rows.map((s) => ({ id: s.id, name: s.name, lon: s.lon, lat: s.lat }))))
      .catch(() => {})
  }
  return stationsCache
}

let app: PlanEditor | null = null
/** The Plan view's editor (on the app planning store). */
export function planEditor(): PlanEditor {
  return (app ??= createPlanEditorFor())
}

/** Editing on the map is live only while this is on (route panel open / "Plan a route"). */
export function setEditing(on: boolean): void {
  const ed = planEditor()
  if (on && !ed.editing.peek()) warm(ed.store.doc.peek().padId)
  ed.setEditing(on)
}

/** Register the edit handlers and the map binding of `ed` (default: the app editor). */
export function install(ed: PlanEditor = planEditor()): Dispose {
  const offHandlers = registerEditHandlers(ed.handlers)
  const offMap = registerPadEnvironment({ id: 'r3-edit-map', install: (ctx) => bindPlanEditMap(ed, ctx), setPadEnvironment: () => {} })
  const offPad = subscribePlanning(selectPad, (id) => ed.editing.peek() && warm(id), ed.store)
  appStations()
  return () => {
    offPad()
    offMap()
    offHandlers()
  }
}
