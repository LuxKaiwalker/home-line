// PORT W0a: the ONE planning state of the Plan view (Notion "Port Mission Planer into Plan" §3).
//
//   { padId, route: { stops[], startUtc, storm, boundary }, view: { showOfficial, showMine } }
//
// Every pad and route change is one undo step on this store's own history, which plugs into the Plan
// view's ONE global undo timeline (edit/route/undo.ts createSharedUndo, via `planningUndoSource`), the
// same way the Edit-route store does. `view` toggles are not undo steps (they change no plan).
// Mutations ONLY through the action creators below (or store.apply / store.replace); never write the
// signals directly. URL sync (#/?route=…, legacy #/mission?plan=… and ?add=) lives in planningUrl.ts
// and is re-exported here, so state + link format are in one place.
//
// Official numbers never come from here: this store only holds the user's choices; the official plan
// stays the precomputed scenario files (value snapshot unchanged).
import { batch, computed, signal, useSignalValue, type ReadSignal } from './signal'

// The route core's shapes (edit/route/model.ts RouteStop / PlanRoute), restated structurally: the static
// bundle must not import edit/route (live/route/route.test.tsx isolation tests); TS checks they fit.
export type RouteStop = { station: string } | { lon: number; lat: number; label?: string }
export type PlanRoute = { mode: 'auto' | 'ordered'; stops: readonly RouteStop[] }

// ---- types ---------------------------------------------------------------------------------------

/** A pad id: OFFICIAL_PAD_ID or a scenarios/pads/index.json row id (rank2, rank3, …). See pads/index.ts. */
export type PadId = string
/** The official pad (pad.json, fields/nom_104, scenarios/nom_104): index row `official: true` (rank1). */
export const OFFICIAL_PAD_ID: PadId = 'official'

/** Quick activity tags (labels only; they change no number). Same list and order as mission/plan.ts
 *  WAYPOINT_TAGS: the link format packs tags as a bit mask in this order. */
export const PLAN_TAGS = ['Sample', 'Drill', 'Photo', 'Survey', 'Install', 'Inspect', 'Repair', 'Rest'] as const
export type PlanTag = (typeof PLAN_TAGS)[number]

/** Stable id of a stop inside this page load (list keys, drag, map feature ids); not in the URL. */
export type StopId = string

interface StopCommon {
  id: StopId
  /** user's name for the stop; undefined = default name (station name, or W1, W2, … among free points) */
  name?: string
  /** free text: what is to be done there ('' = none) */
  note: string
  /** PLAN_TAGS entries, in PLAN_TAGS order (toggleTag keeps it) */
  tags: PlanTag[]
  /** planned time at the stop, minutes (>= 0; 0 = just pass through). Station work uses the station
   *  task rate of the budget (mission/budget.ts stopMinutes semantics). */
  stopMin: number
}
/** A science station (stations.json id); its position is the station's access point in this scenario. */
export interface StationPlanStop extends StopCommon {
  kind: 'station'
  station: string
}
/** A free point on the map. lon/lat is the truth (links store it); `cell` is the routing-grid cell it
 *  snapped to for the current pad env (derived, never stored in a link; undefined = not snapped yet). */
export interface PointPlanStop extends StopCommon {
  kind: 'point'
  lon: number
  lat: number
  cell?: number
}
export type PlanStop = StationPlanStop | PointPlanStop

export interface PlanningRoute {
  /** in walking order: pad -> stops[0] -> … -> pad */
  stops: readonly PlanStop[]
  /** EVA start (ISO 8601 UTC); null = clock.json's start of the scenario (default) */
  startUtc: string | null
  /** D39 storm replay in the margin ("Include storm in the margin"); engine default = false */
  storm: boolean
  /** reachable-area boundary shown (mission/plan.ts boundaryOptions id); undefined / 'none' = none */
  boundary?: string
}

export interface PlanningView {
  /** the pad's precomputed "Official route for this pad" */
  showOfficial: boolean
  /** the user's route ("Your route") */
  showMine: boolean
}

export interface PlanningState {
  padId: PadId
  route: PlanningRoute
  view: PlanningView
}

/** The undoable part (pad + route); one history entry. */
export interface PlanningDoc {
  padId: PadId
  route: PlanningRoute
}

export const EMPTY_ROUTE: PlanningRoute = { stops: [], startUtc: null, storm: false }
export const DEFAULT_VIEW: PlanningView = { showOfficial: true, showMine: true }
export const initialPlanning = (): PlanningState => ({ padId: OFFICIAL_PAD_ID, route: EMPTY_ROUTE, view: DEFAULT_VIEW })

// Route limits: edit/route/model.ts ROUTE_LIMITS (config/backend.yaml route.*); not re-exported here
// (isolation), and the store does not enforce them: the UI refuses with a notice.

// ---- pure reducers (one action = one function; tested in planning.test.ts) -----------------------

export type StopInput = Omit<StationPlanStop, 'id' | 'note' | 'tags' | 'stopMin'> & Partial<Pick<StopCommon, 'note' | 'tags' | 'stopMin' | 'id'>>
export type PointInput = Omit<PointPlanStop, 'id' | 'note' | 'tags' | 'stopMin'> & Partial<Pick<StopCommon, 'note' | 'tags' | 'stopMin' | 'id'>>
/** A new stop: id, note, tags and stopMin are filled with defaults when absent. */
export type NewStop = StopInput | PointInput

let nextId = 1
export const newStopId = (): StopId => `s${nextId++}`

export function makeStop(s: NewStop): PlanStop {
  return { ...s, id: s.id ?? newStopId(), note: s.note ?? '', tags: s.tags ?? [], stopMin: s.stopMin ?? 0 } as PlanStop
}

const clampIndex = (i: number, n: number) => Math.max(0, Math.min(n, Math.trunc(i)))

/** Insert at `at` (default: the end). A station already in the route is not added twice. */
export function addStopTo(r: PlanningRoute, s: NewStop, at?: number): PlanningRoute {
  if (s.kind === 'station' && r.stops.some((x) => x.kind === 'station' && x.station === s.station)) return r
  const stops = [...r.stops]
  stops.splice(at === undefined ? stops.length : clampIndex(at, stops.length), 0, makeStop(s))
  return { ...r, stops }
}
/** Move a free point to a new position (map drag). Station stops do not move. */
export function moveStopIn(r: PlanningRoute, id: StopId, to: { lon: number; lat: number; cell?: number }): PlanningRoute {
  return { ...r, stops: r.stops.map((s) => (s.id === id && s.kind === 'point' ? { ...s, lon: to.lon, lat: to.lat, cell: to.cell } : s)) }
}
export function removeStopFrom(r: PlanningRoute, id: StopId): PlanningRoute {
  return r.stops.some((s) => s.id === id) ? { ...r, stops: r.stops.filter((s) => s.id !== id) } : r
}
/** Move the stop at `from` to index `to` (drag in the list, Alt+Up/Down). Out of range: unchanged. */
export function reorderStopsIn(r: PlanningRoute, from: number, to: number): PlanningRoute {
  const n = r.stops.length
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return r
  const stops = [...r.stops]
  const [s] = stops.splice(from, 1)
  stops.splice(to, 0, s)
  return { ...r, stops }
}
export type StopPatch = Partial<Pick<StopCommon, 'name' | 'note' | 'tags' | 'stopMin'>>
export function updateStopIn(r: PlanningRoute, id: StopId, patch: StopPatch): PlanningRoute {
  return { ...r, stops: r.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

/** Value equality of docs (undo steps are only made for real changes). `cell` is ignored (derived). */
export function sameDoc(a: PlanningDoc, b: PlanningDoc): boolean {
  return a.padId === b.padId && JSON.stringify(a.route, dropCell) === JSON.stringify(b.route, dropCell)
}
const dropCell = (k: string, v: unknown) => (k === 'cell' ? undefined : v)

// ---- bridges to the existing route core (edit/route/model.ts) ------------------------------------

/** The stops as the route core (edit/route/browser/compute.ts computeBrowserRoute) takes them. */
export function toRouteStops(stops: readonly PlanStop[]): RouteStop[] {
  return stops.map((s) => (s.kind === 'station' ? { station: s.station } : { lon: s.lon, lat: s.lat, ...(s.name ? { label: s.name } : {}) }))
}
/** The route as the Edit-route store / POST /jobs see it (ordered; empty = auto). */
export function toPlanRoute(r: PlanningRoute): PlanRoute {
  return r.stops.length ? { mode: 'ordered', stops: toRouteStops(r.stops) } : { mode: 'auto', stops: [] }
}
/** An Edit-route route as planning stops (setRouteDraft / search builder). */
export function fromRouteStops(stops: readonly RouteStop[]): PlanStop[] {
  return stops.map((s) => makeStop('station' in s ? { kind: 'station', station: s.station } : { kind: 'point', lon: s.lon, lat: s.lat, ...(s.label ? { name: s.label } : {}) }))
}

// ---- the store -----------------------------------------------------------------------------------

export interface PlanningStoreOptions {
  initial?: Partial<PlanningState>
  /** config/design.yaml edit.undo_max (edit/store.ts UNDO_MAX); default 50 */
  undoMax?: number
  /** WP12 undo tag (edit/route/undo.ts planKey) stored with each entry; default '' */
  tag?: () => string
}

export function createPlanningStore(opts: PlanningStoreOptions = {}) {
  const init = { ...initialPlanning(), ...opts.initial }
  const undoMax = opts.undoMax ?? 50
  const tagNow = () => opts.tag?.() ?? ''
  const doc = signal<PlanningDoc>({ padId: init.padId, route: init.route })
  const view = signal<PlanningView>(init.view)
  const past = signal<readonly { doc: PlanningDoc; tag: string }[]>([])
  const future = signal<readonly { doc: PlanningDoc; tag: string }[]>([])
  const state = computed<PlanningState>(() => ({ ...doc.value, view: view.value }))

  function apply(next: PlanningDoc): boolean {
    const cur = doc.peek()
    if (sameDoc(cur, next)) {
      if (cur !== next) doc.value = next // a derived field (cell) changed: no undo step
      return false
    }
    batch(() => {
      past.value = [...past.peek(), { doc: cur, tag: tagNow() }].slice(-undoMax)
      future.value = []
      doc.value = next
    })
    return true
  }
  const editRoute = (f: (r: PlanningRoute) => PlanningRoute) => {
    const cur = doc.peek()
    const r = f(cur.route)
    return r === cur.route ? false : apply({ ...cur, route: r })
  }

  return {
    state: state as ReadSignal<PlanningState>,
    doc: doc as ReadSignal<PlanningDoc>,
    view: view as ReadSignal<PlanningView>,
    canUndo: computed(() => past.value.length > 0),
    canRedo: computed(() => future.value.length > 0),
    undoMax,
    /** One undo step for a whole doc (no-op = false). */
    apply,
    /** Replace pad + route without an undo step (initial load from a link). Clears the history. */
    replace(next: PlanningDoc): void {
      batch(() => {
        doc.value = next
        past.value = []
        future.value = []
      })
    },
    setPad: (padId: PadId) => (doc.peek().padId === padId ? false : apply({ ...doc.peek(), padId })),
    addStop: (s: NewStop, at?: number) => editRoute((r) => addStopTo(r, s, at)),
    moveStop: (id: StopId, to: { lon: number; lat: number; cell?: number }) => editRoute((r) => moveStopIn(r, id, to)),
    removeStop: (id: StopId) => editRoute((r) => removeStopFrom(r, id)),
    reorderStops: (from: number, to: number) => editRoute((r) => reorderStopsIn(r, from, to)),
    updateStop: (id: StopId, patch: StopPatch) => editRoute((r) => updateStopIn(r, id, patch)),
    setStartUtc: (iso: string | null) => editRoute((r) => (r.startUtc === iso ? r : { ...r, startUtc: iso })),
    setStorm: (on: boolean) => editRoute((r) => (r.storm === on ? r : { ...r, storm: on })),
    setBoundary: (id: string | undefined) => editRoute((r) => (r.boundary === id ? r : { ...r, boundary: id })),
    /** Whole route in one undo step (search builder, share link opened while editing, clear). */
    replaceRoute: (route: PlanningRoute) => editRoute(() => route),
    /** View toggles (not undo steps). */
    toggleView(key: keyof PlanningView, on?: boolean): void {
      const v = view.peek()
      const next = on ?? !v[key]
      if (v[key] !== next) view.value = { ...v, [key]: next }
    },
    undo(): boolean {
      const p = past.peek()
      if (!p.length) return false
      batch(() => {
        future.value = [{ doc: doc.peek(), tag: p[p.length - 1].tag }, ...future.peek()]
        doc.value = p[p.length - 1].doc
        past.value = p.slice(0, -1)
      })
      return true
    },
    redo(): boolean {
      const f = future.peek()
      if (!f.length) return false
      batch(() => {
        past.value = [...past.peek(), { doc: doc.peek(), tag: f[0].tag }].slice(-undoMax)
        doc.value = f[0].doc
        future.value = f.slice(1)
      })
      return true
    },
    /** WP12 tags (edit/route/undo.ts): the tag of the entry undo / redo would restore. */
    undoTag: (): string | undefined => past.peek().at(-1)?.tag,
    redoTag: (): string | undefined => future.peek()[0]?.tag,
  }
}
export type PlanningStore = ReturnType<typeof createPlanningStore>

/** The app's one planning store (the Plan view). Tests make their own with createPlanningStore(). */
export const planning: PlanningStore = createPlanningStore()

// ---- selectors -----------------------------------------------------------------------------------

export const selectPad = (s: PlanningState): PadId => s.padId
export const selectRoute = (s: PlanningState): PlanningRoute => s.route
export const selectStops = (s: PlanningState): readonly PlanStop[] => s.route.stops
export const selectView = (s: PlanningState): PlanningView => s.view
export const selectHasRoute = (s: PlanningState): boolean => s.route.stops.length > 0
export const selectIsOfficialPad = (s: PlanningState): boolean => s.padId === OFFICIAL_PAD_ID
/** Default names: station id (caller maps to the station name) or W1, W2, … among free points (model.ts stopNames). */
export function stopLabels(stops: readonly PlanStop[]): string[] {
  let w = 0
  return stops.map((s) => s.name ?? (s.kind === 'station' ? s.station : `W${++w}`))
}

// ---- subscribe + hook ----------------------------------------------------------------------------

/** Call fn on every change of the selected value (Object.is), never immediately. Returns unsubscribe. */
export function subscribePlanning<T>(select: (s: PlanningState) => T, fn: (v: T) => void, store: PlanningStore = planning): () => void {
  let last = select(store.state.peek())
  return store.state.subscribe((s) => {
    const v = select(s)
    if (Object.is(v, last)) return
    last = v
    fn(v)
  })
}

/** Preact hook: the selected slice, re-rendering when it changes. */
export function usePlanning<T>(select: (s: PlanningState) => T, store: PlanningStore = planning): T {
  return select(useSignalValue(store.state))
}

// ---- action creators on the app store (bound) ----------------------------------------------------

export const setPad = (padId: PadId) => planning.setPad(padId)
export const addStop = (s: NewStop, at?: number) => planning.addStop(s, at)
export const moveStop = (id: StopId, to: { lon: number; lat: number; cell?: number }) => planning.moveStop(id, to)
export const removeStop = (id: StopId) => planning.removeStop(id)
export const reorderStops = (from: number, to: number) => planning.reorderStops(from, to)
export const updateStop = (id: StopId, patch: StopPatch) => planning.updateStop(id, patch)
export const setStartUtc = (iso: string | null) => planning.setStartUtc(iso)
export const setStorm = (on: boolean) => planning.setStorm(on)
export const setBoundary = (id: string | undefined) => planning.setBoundary(id)
export const toggleView = (key: keyof PlanningView, on?: boolean) => planning.toggleView(key, on)
export const replaceRoute = (route: PlanningRoute) => planning.replaceRoute(route)

// ---- undo bridge ---------------------------------------------------------------------------------

/**
 * The store as an undo source of edit/route/undo.ts createSharedUndo (`ctl`), so the planning edits
 * sit on the Plan view's ONE Ctrl/Cmd-Z timeline. `busy` locks entries (e.g. while an export runs).
 */
export function planningUndoSource(store: PlanningStore = planning, busy: ReadSignal<boolean> = signal(false)) {
  return {
    store,
    compute: computed(() => ({ kind: busy.value ? 'running' : 'idle' })),
    undo: () => store.undo(),
    redo: () => store.redo(),
  }
}

export { decodeLegacyPlan, decodeRouteParam, encodeRouteParam, legacyRedirect, parsePlanningHash, planningHref, ROUTE_PARAM, type PlanningLink } from './planningUrl'
