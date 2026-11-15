// One undo for the Plan view (L6 W-5, D111): route edits and the H1 plan edits (rover pad, scenario,
// budget; edit/store.ts + edit/bind.ts, installed by edit/roverMap.ts) behind the one global Ctrl/Cmd-Z
// of the shell (ui/shell/keys.ts shortcutFor), from anywhere on the page, and behind the panel's
// Undo / Redo buttons.
//
// Why a timeline in front of H1 and not a push onto H1's stack: edit/store.ts and edit/bind.ts ship in
// the static build, which must stay byte-identical (waypoint rule 4), so H1 cannot take foreign steps
// yet. Instead every route entry remembers the plan it was made on (route store `tag` = planKey, the
// fields H1 records: scenario, budget, pad of mission.plan). Undo then picks the most recent edit:
//   route entry made on the plan in use  -> the route edit is newer: undo it here
//   otherwise                            -> an H1 step is newer: announce the shell's `hl:shortcut`
//                                           undo, which H1's own listener takes (bind.ts); if nobody
//                                           takes it, the route's own entry is undone
// Redo mirrors it. The keyboard is read in the window's CAPTURE phase, before keys.ts's listener, so
// the order never depends on which listener was registered first; a key that is used here is
// preventDefault()-ed and keys.ts then leaves it alone (it checks defaultPrevented). Typing in a field
// keeps Ctrl+Z for the field. While a route job runs, route entries are locked (the panel says so).
import { computed, signal, type ReadSignal } from '../../state/signal'
import { isTypingTarget, shortcutFor, type ShortcutAction } from '../../ui/shell/keys'
import type { RouteController } from './controller'

export type UndoDir = 'undo' | 'redo'

/** The window (or a test double): keydown in the capture phase, `hl:shortcut` events. */
export interface UndoWindow {
  addEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, fn: (e: Event) => void, opts?: boolean | EventListenerOptions): void
  dispatchEvent(e: Event): boolean
}

export interface SharedUndoOptions {
  ctl: RouteController
  /** the plan in use as H1 records it (mission.plan: scenario | budget | pad) */
  planKey: () => string
  win?: UndoWindow | null
}

export interface SharedUndo {
  /** something to undo / redo on the one timeline (route entries, or H1 plan steps seen here) */
  canUndo: ReadSignal<boolean>
  canRedo: ReadSignal<boolean>
  undo(): boolean
  redo(): boolean
  /** which side the next undo / redo goes to ('route', 'plan' or null = nothing) */
  next(dir: UndoDir): 'route' | 'plan' | null
  /** the plan in use changed (mission.plan): a new H1 step unless our own undo / redo caused it */
  planChanged(): void
  /** listen to the window (keydown capture + hl:shortcut); returns dispose */
  install(): () => void
}

const isMod = (a: ShortcutAction | null): a is { action: UndoDir } => !!a && (a.action === 'undo' || a.action === 'redo')

export function createSharedUndo(o: SharedUndoOptions): SharedUndo {
  const { ctl } = o
  const store = ctl.store
  /** H1 steps this timeline has seen and not undone (an estimate: corrected when H1 declines) */
  const planPast = signal(0)
  const planFuture = signal(0)
  let lastKey = o.planKey()
  let dispatching = false
  let queued = false
  /** the key just pressed belongs to a text field: the shell's announcement of it is not ours */
  let fieldKey = false

  const running = () => ctl.compute.peek().kind === 'running'

  function next(dir: UndoDir): 'route' | 'plan' | null {
    const tag = dir === 'undo' ? store.undoTag() : store.redoTag()
    const plan = (dir === 'undo' ? planPast : planFuture).peek() > 0
    if (tag !== undefined && (!plan || tag === o.planKey())) return 'route'
    if (plan) return 'plan'
    return tag !== undefined ? 'route' : null
  }

  /** The route's own entry (locked while a job runs: the panel names the reason). */
  const routeStep = (dir: UndoDir): boolean => !running() && (dir === 'undo' ? ctl.undo() : ctl.redo())

  /** Hand the step to H1 through the shell's own announcement; true when a listener took it. */
  function announce(dir: UndoDir): boolean {
    const w = o.win
    if (!w || typeof CustomEvent === 'undefined') return false
    const ev = new CustomEvent('hl:shortcut', { detail: { action: dir }, cancelable: true })
    dispatching = true
    try {
      w.dispatchEvent(ev)
    } finally {
      dispatching = false
    }
    lastKey = o.planKey()
    const [from, to] = dir === 'undo' ? [planPast, planFuture] : [planFuture, planPast]
    if (ev.defaultPrevented) {
      from.value = Math.max(0, from.peek() - 1)
      to.value = to.peek() + 1
      return true
    }
    from.value = 0 // H1 has nothing on that side: forget the estimate
    return false
  }

  function run(dir: UndoDir): boolean {
    const side = next(dir)
    if (side === 'route') return routeStep(dir)
    if (side === 'plan') return announce(dir) || routeStep(dir)
    return false
  }

  function planChanged(): void {
    // our own announcement settles the counts itself; a burst of mission writes (scenario, then pad)
    // is one step: counted once, after the burst
    if (dispatching || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      const k = o.planKey()
      if (k === lastKey) return
      lastKey = k
      planPast.value = planPast.peek() + 1
      planFuture.value = 0
    })
  }

  function install(): () => void {
    const w = o.win
    if (!w) return () => {}
    const onKey = (e: Event) => {
      const k = e as KeyboardEvent
      if (k.defaultPrevented || k.isComposing) return
      const a = shortcutFor(k)
      if (!isMod(a)) return
      if (isTypingTarget(k.target)) {
        fieldKey = true
        queueMicrotask(() => (fieldKey = false))
        return
      }
      const side = next(a.action)
      if (side === null) return // nothing here: the shell announces it as usual
      e.preventDefault()
      if (side === 'route') routeStep(a.action)
      else if (!announce(a.action)) routeStep(a.action)
    }
    // other sources of the action (the search palette runs shortcuts through the same event)
    const onShortcut = (e: Event) => {
      if (dispatching || fieldKey) return
      if (typeof document !== 'undefined' && isTypingTarget(document.activeElement)) return
      const a = (e as CustomEvent<ShortcutAction>).detail
      if (!isMod(a) || next(a.action) !== 'route') return
      routeStep(a.action)
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    w.addEventListener('keydown', onKey, { capture: true })
    w.addEventListener('hl:shortcut', onShortcut, { capture: true })
    return () => {
      w.removeEventListener('keydown', onKey, { capture: true })
      w.removeEventListener('hl:shortcut', onShortcut, { capture: true })
    }
  }

  return {
    canUndo: computed(() => store.canUndo.value || planPast.value > 0),
    canRedo: computed(() => store.canRedo.value || planFuture.value > 0),
    undo: () => run('undo'),
    redo: () => run('redo'),
    next,
    planChanged,
    install,
  }
}
