// PORT I2: the Plan view's planning store (state/planning.ts) on the activity store and on the ONE
// Ctrl/Cmd-Z timeline.
//
//   activity  every real pad / route edit (an undo step, an undo, a redo) stops the running player
//             (flythrough, story intro, timeline replay): noteEdit('planning-edit'). A link loaded with
//             store.replace(doc), a derived `cell` snap and the view toggles are not edits. A drag of the
//             route panel's list is an edit session (activity.ts beginEdit / endEdit): it stops the
//             player when it starts; a player started during it never breaks it.
//   undo      the store plugs into edit/route/undo.ts createSharedUndo through planningUndoSource with
//             the H1 tags (the plan in use when each entry was made), so a newer H1 step (rover pad,
//             scenario, budget) is undone first and route entries after it. Text fields keep their own
//             Ctrl+Z (createSharedUndo checks isTypingTarget). edit/route/undo.ts is reached by import()
//             only (§7b: no static edge from here into edit/route).
//
// installPlanningActivity() is called once per Plan mount (views/planPort.tsx mountPlanPort, I1).
import { beginEdit, endEdit, noteEdit } from './activity'
import { mission } from './mission'
import { planning, planningUndoSource, sameDoc, type PlanningDoc, type PlanningStore } from './planning'
import { computed, signal, type ReadSignal } from './signal'

/** The plan in use as H1 records it (live/route/mount.tsx missionPlanKey, without the catalog defaults). */
export const missionPlanKey = (): string => JSON.stringify([mission.plan.scenario.peek() ?? null, mission.plan.budgetMin.peek(), mission.plan.pad.peek() ?? null])

export interface TrackedUndoSource {
  store: {
    undoTag(): string | undefined
    redoTag(): string | undefined
    canUndo: ReadSignal<boolean>
    canRedo: ReadSignal<boolean>
  }
  compute: ReadSignal<{ kind: string }>
  undo(): boolean
  redo(): boolean
  dispose(): void
}

/**
 * planningUndoSource with real WP12 tags: the app store is created without a tag, so each new entry is
 * tagged here with `planKey()` at the time it was made (undo / redo carry their tag across). Undo and
 * redo must go through this source (or the shared undo built on it), not store.undo() directly.
 */
export function trackedPlanningUndoSource(store: PlanningStore = planning, planKey: () => string = missionPlanKey, busy?: ReadSignal<boolean>): TrackedUndoSource {
  const base = planningUndoSource(store, busy)
  const past: string[] = []
  const future: string[] = []
  let own = false
  let prev: PlanningDoc = store.doc.peek()
  const off = store.doc.subscribe((d) => {
    const p = prev
    prev = d
    if (own || p === d) return
    if (!store.canUndo.peek() && !store.canRedo.peek()) {
      past.length = 0 // replace(doc): history cleared
      future.length = 0
      return
    }
    if (sameDoc(p, d)) return // a derived field (cell) only
    past.push(planKey())
    if (past.length > store.undoMax) past.shift()
    future.length = 0
  })
  const step = (dir: 'undo' | 'redo'): boolean => {
    own = true
    let ok: boolean
    try {
      ok = dir === 'undo' ? base.undo() : base.redo()
    } finally {
      own = false
    }
    if (ok) {
      if (dir === 'undo') future.unshift(past.pop() ?? planKey())
      else past.push(future.shift() ?? planKey())
    }
    return ok
  }
  return {
    store: {
      undoTag: () => (store.canUndo.peek() ? (past.at(-1) ?? planKey()) : undefined),
      redoTag: () => (store.canRedo.peek() ? (future[0] ?? planKey()) : undefined),
      canUndo: store.canUndo,
      canRedo: store.canRedo,
    },
    compute: base.compute,
    undo: () => step('undo'),
    redo: () => step('redo'),
    dispose: off,
  }
}

/**
 * Every real planning edit stops the running player (noteEdit('planning-edit')). Not edits: replace(doc)
 * (a link: history cleared), a derived cell snap, view toggles (not in the doc). Returns unsubscribe.
 */
export function watchPlanningEdits(store: PlanningStore = planning): () => void {
  let prev = store.doc.peek()
  return store.doc.subscribe((d) => {
    const p = prev
    prev = d
    if (p === d || sameDoc(p, d)) return
    if (!store.canUndo.peek() && !store.canRedo.peek()) return // replace(doc) from a link
    noteEdit('planning-edit')
  })
}

/** Route panel list drags (U2 WaypointList: draggable `.rpl-handle` inside `.rpl`) as edit sessions. */
export const ROUTE_PANEL_DRAG_SESSION = 'route-panel-drag'
interface DragTarget {
  closest?: (sel: string) => unknown
}
export function watchRoutePanelDrags(win: Pick<UndoWin, 'addEventListener' | 'removeEventListener'> | null): () => void {
  if (!win) return () => {}
  const inPanel = (t: EventTarget | null) => !!(t as DragTarget | null)?.closest?.('.rpl')
  const onStart = (e: Event) => {
    if (inPanel(e.target)) beginEdit(ROUTE_PANEL_DRAG_SESSION)
  }
  const onEnd = () => endEdit(ROUTE_PANEL_DRAG_SESSION)
  win.addEventListener('dragstart', onStart, true)
  win.addEventListener('dragend', onEnd, true)
  return () => {
    win.removeEventListener('dragstart', onStart, true)
    win.removeEventListener('dragend', onEnd, true)
    endEdit(ROUTE_PANEL_DRAG_SESSION)
  }
}

/** What the panel's Undo / Redo buttons use (null until the shared undo has loaded). */
export interface PlanningUndo {
  canUndo: ReadSignal<boolean>
  canRedo: ReadSignal<boolean>
  undo(): boolean
  redo(): boolean
}
const shared = signal<PlanningUndo | null>(null)
export const planningUndo: ReadSignal<PlanningUndo | null> = shared
/** canUndo / canRedo of the Plan view's timeline (false until loaded). */
export const planningCanUndo = computed(() => shared.value?.canUndo.value ?? false)
export const planningCanRedo = computed(() => shared.value?.canRedo.value ?? false)

/** edit/route/undo.ts UndoWindow, restated (§7b: type it here, load it by import()). */
export interface UndoWin {
  addEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, fn: (e: Event) => void, opts?: boolean | EventListenerOptions): void
  dispatchEvent(e: Event): boolean
}
/** The part of edit/route/undo.ts used here (createSharedUndo; its SharedUndo fits). */
export interface UndoModule {
  createSharedUndo(o: { ctl: TrackedUndoSource; planKey: () => string; win?: UndoWin | null }): PlanningUndo & { planChanged(): void; install(): () => void }
}
export interface PlanningActivityOptions {
  store?: PlanningStore
  /** the window (keys, hl:shortcut, drags); null = none (tests without keys) */
  win?: UndoWin | null
  planKey?: () => string
  /** locks the planning entries (e.g. while an export runs) */
  busy?: ReadSignal<boolean>
  /** tests: the module edit/route/undo.ts (default: import() it, its own chunk) */
  loadUndo?: () => Promise<UndoModule>
}

/**
 * Per Plan mount: planning edits stop players, list drags are edit sessions, and the store sits on the
 * one Ctrl/Cmd-Z timeline (with H1's steps). Resolves the shared undo in `planningUndo`. Returns dispose.
 */
export function installPlanningActivity(o: PlanningActivityOptions = {}): () => void {
  const store = o.store ?? planning
  const win = o.win === undefined ? (typeof window !== 'undefined' ? window : null) : o.win
  const planKey = o.planKey ?? missionPlanKey
  let alive = true
  const offs: (() => void)[] = [watchPlanningEdits(store), watchRoutePanelDrags(win)]
  const src = trackedPlanningUndoSource(store, planKey, o.busy)
  offs.push(src.dispose)
  const load: () => Promise<UndoModule> = o.loadUndo ?? (() => import('../edit/route/undo'))
  const ready = load()
    .then(({ createSharedUndo }) => {
      if (!alive) return
      const u = createSharedUndo({ ctl: src, planKey, win })
      offs.push(u.install())
      // the mission plan (pad drag, scenario, budget) changed: an H1 step on the timeline
      const plan = mission.plan
      for (const s of [plan.pad, plan.scenario, plan.budgetMin, plan.variant] as ReadSignal<unknown>[]) offs.push(s.subscribe(() => u.planChanged()))
      shared.value = u
      offs.push(() => {
        if (shared.peek() === u) shared.value = null
      })
    })
    .catch((e) => console.warn('planning undo unavailable', e))
  const dispose = () => {
    alive = false
    for (const f of offs.splice(0).reverse()) f()
  }
  return Object.assign(dispose, { ready })
}
