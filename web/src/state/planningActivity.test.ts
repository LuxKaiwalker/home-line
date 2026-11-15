// PORT I2: planning edits on the one Ctrl/Cmd-Z timeline and on the activity store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as undoModule from '../edit/route/undo'
import { FakeWindow, keydown } from '../edit/route/testing'
import { activity, beginEdit, endEdit, lastStop, resetActivity, start } from './activity'
import { createPlanningStore, OFFICIAL_PAD_ID, type PlanningStore } from './planning'
import { installPlanningActivity, planningUndo, trackedPlanningUndoSource, watchPlanningEdits } from './planningActivity'

const outside = { localName: 'canvas' }
const ctrlZ = (target: unknown = outside) => keydown({ key: 'z', ctrlKey: true, target })
const ctrlShiftZ = (target: unknown = outside) => keydown({ key: 'z', ctrlKey: true, shiftKey: true, target })

let offs: (() => void)[] = []
beforeEach(() => resetActivity())
afterEach(() => {
  for (const f of offs.splice(0)) f()
  resetActivity()
})

async function mount(store: PlanningStore, planKey: () => string = () => 'p0') {
  const win = new FakeWindow()
  const off = installPlanningActivity({ store, win, planKey, loadUndo: async () => undoModule }) as (() => void) & { ready: Promise<void> }
  offs.push(off)
  await off.ready
  return { win, undo: planningUndo.peek()! }
}

/** Every route and pad action, from a store with two stops (st1, a free point). */
const ACTIONS: [string, (s: PlanningStore) => boolean][] = [
  ['addStop', (s) => s.addStop({ kind: 'station', station: 'st9' })],
  ['moveStop', (s) => s.moveStop(s.doc.peek().route.stops[1].id, { lon: 137.5, lat: -4.7 })],
  ['removeStop', (s) => s.removeStop(s.doc.peek().route.stops[0].id)],
  ['reorderStops', (s) => s.reorderStops(0, 1)],
  ['updateStop', (s) => s.updateStop(s.doc.peek().route.stops[0].id, { note: 'core sample', tags: ['Drill'], stopMin: 12 })],
  ['setPad', (s) => s.setPad('rank2')],
  ['setStartUtc', (s) => s.setStartUtc('2026-03-01T08:00:00Z')],
  ['setStorm', (s) => s.setStorm(true)],
  ['setBoundary', (s) => s.setBoundary('b60')],
  ['replaceRoute', (s) => s.replaceRoute({ stops: [], startUtc: null, storm: true, boundary: 'b30' })],
]
const seeded = () => {
  const s = createPlanningStore()
  s.replace({ padId: OFFICIAL_PAD_ID, route: { stops: [], startUtc: null, storm: false } })
  s.addStop({ kind: 'station', station: 'st1' })
  s.addStop({ kind: 'point', lon: 137.4, lat: -4.78 })
  return s
}

describe('Ctrl/Cmd-Z: every route and pad action is exactly one undo step', () => {
  for (const [name, act] of ACTIONS) {
    it(name, async () => {
      const s = seeded()
      const { win } = await mount(s)
      const before = s.doc.peek()
      expect(act(s)).toBe(true)
      const after = s.doc.peek()
      expect(after).not.toBe(before)
      const e = ctrlZ()
      win.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(true)
      expect(s.doc.peek()).toBe(before) // one key = the whole action
      win.dispatchEvent(ctrlShiftZ())
      expect(s.doc.peek()).toBe(after) // redo
      win.dispatchEvent(ctrlZ())
      win.dispatchEvent(ctrlZ()) // the seed's second stop
      expect(s.doc.peek().route.stops).toHaveLength(1)
    })
  }

  it('ten actions = ten steps; view toggles and replace(doc) are none', async () => {
    const s = seeded()
    const { win, undo } = await mount(s)
    s.toggleView('showOfficial', false)
    for (const [, act] of ACTIONS) act(s)
    s.toggleView('showMine')
    let n = 0
    while (undo.canUndo.peek()) {
      win.dispatchEvent(ctrlZ())
      n++
      if (n > 20) break
    }
    expect(n).toBe(ACTIONS.length + 2) // + the two seed stops
    expect(s.view.peek()).toEqual({ showOfficial: false, showMine: false }) // toggles untouched by undo
    s.replace({ padId: 'rank3', route: { stops: [], startUtc: null, storm: false } }) // a link
    expect(undo.canUndo.peek()).toBe(false)
    expect(undo.canRedo.peek()).toBe(false)
  })

  it('a no-op action makes no step', async () => {
    const s = seeded()
    const { undo } = await mount(s)
    expect(s.addStop({ kind: 'station', station: 'st1' })).toBe(false)
    expect(s.setPad(OFFICIAL_PAD_ID)).toBe(false)
    s.undo() // the seed (direct)
    s.redo()
    expect(undo.canUndo.peek()).toBe(true)
  })
})

describe('Ctrl/Cmd-Z in a text field stays the field', () => {
  for (const target of [{ localName: 'input', type: 'text' }, { localName: 'textarea' }, { localName: 'div', isContentEditable: true }, { localName: 'input', type: 'number' }]) {
    it(`${target.localName}${'type' in target ? `[${target.type}]` : ''}`, async () => {
      const s = seeded()
      const { win } = await mount(s)
      const before = s.doc.peek()
      const e = ctrlZ(target)
      win.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(false)
      expect(s.doc.peek()).toBe(before)
      // the shell's announcement of that same key is not ours either
      const ev = new CustomEvent('hl:shortcut', { detail: { action: 'undo' }, cancelable: true })
      win.dispatchEvent(ev)
      expect(s.doc.peek()).toBe(before)
    })
  }
  it('a checkbox is not a text field', async () => {
    const s = seeded()
    const { win } = await mount(s)
    win.dispatchEvent(ctrlZ({ localName: 'input', type: 'checkbox' }))
    expect(s.doc.peek().route.stops).toHaveLength(1)
  })
})

describe('one timeline with H1 (the plan in use)', () => {
  it('a newer H1 step is undone first (announced), then the route entry', async () => {
    let key = 'A'
    const s = seeded()
    const { win } = await mount(s, () => key)
    s.setStorm(true) // route entry on plan A
    const h1: string[] = []
    win.addEventListener('hl:shortcut', (e) => {
      const a = (e as CustomEvent<{ action: string }>).detail.action
      h1.push(a)
      if (a === 'undo') key = 'A'
      e.preventDefault()
    })
    key = 'B'
    const { mission } = await import('./mission')
    const pad = mission.plan.pad.peek()
    mission.plan.pad.value = 'h1-test-pad' // the shared undo counts an H1 step
    await Promise.resolve()
    win.dispatchEvent(ctrlZ())
    expect(h1).toEqual(['undo'])
    expect(s.doc.peek().route.storm).toBe(true)
    win.dispatchEvent(ctrlZ())
    expect(s.doc.peek().route.storm).toBe(false)
    mission.plan.pad.value = pad
  })

  it('tags follow undo / redo', () => {
    let key = 'A'
    const s = createPlanningStore()
    const src = trackedPlanningUndoSource(s, () => key)
    s.setStorm(true)
    key = 'B'
    s.setPad('rank2')
    expect(src.store.undoTag()).toBe('B')
    expect(src.undo()).toBe(true)
    expect(src.store.undoTag()).toBe('A')
    expect(src.store.redoTag()).toBe('B')
    expect(src.redo()).toBe(true)
    expect(src.store.undoTag()).toBe('B')
    s.replace(s.doc.peek())
    expect(src.store.undoTag()).toBe(undefined)
    src.dispose()
  })

  it('existing undo users: a RouteController-shaped source still fits createSharedUndo', () => {
    const s = createPlanningStore()
    const u = undoModule.createSharedUndo({ ctl: trackedPlanningUndoSource(s, () => ''), planKey: () => '', win: null })
    s.setPad('rank4')
    expect(u.undo()).toBe(true)
    expect(s.doc.peek().padId).toBe(OFFICIAL_PAD_ID)
  })
})

describe('activity: editing stops players (planning-edit)', () => {
  const play = (kind: 'flythrough' | 'replay' | 'intro' = 'flythrough') => {
    const halt = vi.fn()
    expect(start(kind, halt).ok).toBe(true)
    return halt
  }

  for (const [name, act] of ACTIONS) {
    it(`${name} stops the running player`, () => {
      const s = seeded()
      offs.push(watchPlanningEdits(s))
      const halt = play()
      act(s)
      expect(halt).toHaveBeenCalledTimes(1)
      expect(activity.current.peek()).toBe(null)
      expect(lastStop.peek()).toEqual({ kind: 'flythrough', by: 'planning-edit' })
    })
  }

  it('the timeline replay and the story intro stop too; undo is an edit', async () => {
    const s = seeded()
    const { win } = await mount(s)
    let halt = play('replay')
    s.setStorm(true)
    expect(halt).toHaveBeenCalledTimes(1)
    halt = play('intro')
    win.dispatchEvent(ctrlZ())
    expect(halt).toHaveBeenCalledTimes(1)
    expect(lastStop.peek()?.by).toBe('planning-edit')
  })

  it('not edits: view toggles, a link (replace), a derived cell snap, a no-op', () => {
    const s = seeded()
    offs.push(watchPlanningEdits(s))
    const halt = play()
    s.toggleView('showMine', false)
    s.replace({ padId: 'rank2', route: { stops: [], startUtc: null, storm: false } })
    s.addStop({ kind: 'point', lon: 137.4, lat: -4.78 })
    halt.mockClear()
    // the store refuses a cell-only change as an undo step; the doc object changes
    const p = s.doc.peek().route.stops[0]
    s.apply({ ...s.doc.peek(), route: { ...s.doc.peek().route, stops: [{ ...p, cell: 42 } as typeof p] } })
    s.setPad('rank2')
    expect(halt).not.toHaveBeenCalled()
  })

  it('a route panel drag: starts as an edit, a player started during it keeps playing and never breaks it', async () => {
    const s = seeded()
    const { win } = await mount(s)
    const first = play()
    const handle = { closest: (sel: string) => (sel === '.rpl' ? {} : null) }
    const dragstart = new Event('dragstart')
    Object.defineProperty(dragstart, 'target', { value: handle })
    win.dispatchEvent(dragstart)
    expect(first).toHaveBeenCalledTimes(1) // editing stops players
    expect(activity.editing.peek()).toBe('planning-edit')
    // the viewer starts the flythrough mid-drag: allowed, the drag session stays open
    const fly = play()
    expect(activity.current.peek()).toBe('flythrough')
    expect(activity.editing.peek()).toBe('planning-edit')
    // the drop (U2: onDrop → reorderStops, then dragend)
    expect(s.reorderStops(0, 1)).toBe(true)
    win.dispatchEvent(new Event('dragend'))
    expect(fly).not.toHaveBeenCalled()
    expect(activity.editing.peek()).toBe(null)
    await Promise.resolve()
    // a later edit stops it as usual
    s.setStorm(true)
    expect(fly).toHaveBeenCalledTimes(1)
  })

  it('a drag outside the route panel is no edit session', async () => {
    const s = seeded()
    const { win } = await mount(s)
    const halt = play()
    const e = new Event('dragstart')
    Object.defineProperty(e, 'target', { value: { closest: () => null } })
    win.dispatchEvent(e)
    expect(halt).not.toHaveBeenCalled()
    expect(activity.editing.peek()).toBe(null)
  })

  it('beginEdit / endEdit directly (map handle drags)', () => {
    const halt = play()
    const end = beginEdit('r3-handle')
    expect(halt).toHaveBeenCalledTimes(1)
    expect(lastStop.peek()).toEqual({ kind: 'flythrough', by: 'planning-edit' })
    end()
    endEdit('r3-handle') // twice: no-op
    expect(activity.editing.peek()).toBe(null)
  })
})

describe('isolation (§7b)', () => {
  it('state/planningActivity.ts has no static import of edit/route', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./planningActivity.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/(?:^|\s)import\s[^(]*from\s+['"][^'"]*edit\/route/m)
    expect([...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])).toEqual(['../edit/route/undo'])
  })
})
