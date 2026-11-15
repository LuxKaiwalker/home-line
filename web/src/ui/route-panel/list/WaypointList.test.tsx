// U2 waypoint list on a test planning store (never the app singleton) with §9 route results passed in.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlanningStore, makeStop, PLAN_TAGS, type PlanningStore } from '../../../state/planning'
import { all, byClass, byTag, hasClass, installDom, one, type FakeDocument, type FakeNode } from '../../testing/dom'
import { STOP_MIN_MAX } from './model'
import { MOCK_ROUTE_RESULTS, publishRouteResults, type RouteResults } from './routeResults'
import { resetRouteResults } from '../../../state/routeResults'
import { tl, WaypointList } from './WaypointList'
import { register } from './index'

let doc: FakeDocument
let root: FakeNode
let store: PlanningStore

const names = (id: string) => ({ S3: 'Nodule census' })[id]
const W1 = () => makeStop({ id: 'w1', kind: 'point', lon: 137.39, lat: -4.776 })
const S3 = () => makeStop({ id: 's3', kind: 'station', station: 'S3' })
const P2 = () => makeStop({ id: 'p2', kind: 'point', lon: 137.4, lat: -4.77 })

function mount(results: RouteResults = MOCK_ROUTE_RESULTS, noteIdleMs = 600): FakeNode {
  act(() => render(<WaypointList store={store} results={results} stationName={names} noteIdleMs={noteIdleMs} />, root as unknown as Element))
  return root
}
const fire = (n: FakeNode, type: string, init: Record<string, unknown> = {}) => act(() => void n.dispatch(type, init))
const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
const rows = () => byClass(root, 'rpl-row')
const order = () => store.doc.peek().route.stops.map((s) => s.id)
const btn = (label: string) => one(all(root, (n) => n.localName === 'button' && n.getAttribute('aria-label') === label), label)
const status = () => text(one(all(root, (n) => n.getAttribute('role') === 'status'), 'live region'))
const undoDepth = () => {
  let n = 0
  while (store.canUndo.peek()) (store.undo(), n++)
  for (let i = 0; i < n; i++) store.redo()
  return n
}

beforeEach(() => {
  ;({ document: doc, container: root } = installDom())
  store = createPlanningStore({ initial: { route: { stops: [W1(), S3(), P2()], startUtc: null, storm: false } } })
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  vi.useRealTimers()
})

describe('list semantics', () => {
  it('an <ol> of stops with labels, kinds, numbers and named buttons; a status live region', () => {
    mount()
    const ol = one(byTag(root, 'ol'))
    expect(ol.getAttribute('aria-label')).toBe(tl('listLabel'))
    expect(rows().map((r) => r.localName)).toEqual(['li', 'li', 'li'])
    expect(byClass(root, 'rpl-label').map(text)).toEqual(['W1', 'Nodule census', 'W2'])
    expect(byClass(root, 'rpl-kind').map(text)).toEqual([tl('kind.point'), tl('kind.station'), tl('kind.point')])
    for (const b of byTag(root, 'button')) expect(b.getAttribute('aria-label') || text(b), 'every button is named').toBeTruthy()
    const live = one(all(root, (n) => n.getAttribute('role') === 'status'))
    expect(live.getAttribute('aria-live')).toBe('polite')
  })
  it('empty route: the empty hint, no list', () => {
    store.replaceRoute({ stops: [], startUtc: null, storm: false })
    mount()
    expect(byTag(root, 'ol')).toHaveLength(0)
    expect(text(one(byClass(root, 'rpl-empty')))).toBe(tl('empty'))
  })
})

describe('reorder', () => {
  it('Alt+ArrowDown / Alt+ArrowUp on a row move it (one undo step each), announce, keep focus', () => {
    mount()
    const handle = btn(tl('handle', { name: 'W1' }))
    fire(handle, 'keydown', { key: 'ArrowDown', altKey: true })
    expect(order()).toEqual(['s3', 'w1', 'p2'])
    expect(status()).toBe(tl('announce.moved', { name: 'W1', n: 2, total: 3 }))
    expect(doc.activeElement).toBe(btn(tl('handle', { name: 'W1' })))
    expect(store.canUndo.peek()).toBe(true)
    fire(btn(tl('handle', { name: 'W1' })), 'keydown', { key: 'ArrowUp', altKey: true })
    expect(order()).toEqual(['w1', 's3', 'p2'])
    store.undo()
    expect(order()).toEqual(['s3', 'w1', 'p2'])
    store.undo()
    expect(order()).toEqual(['w1', 's3', 'p2'])
    expect(store.canUndo.peek()).toBe(false)
  })
  it('without Alt the arrows do nothing; at the ends the move is refused and announced', () => {
    mount()
    fire(btn(tl('handle', { name: 'W1' })), 'keydown', { key: 'ArrowDown' })
    expect(order()).toEqual(['w1', 's3', 'p2'])
    fire(btn(tl('handle', { name: 'W1' })), 'keydown', { key: 'ArrowUp', altKey: true })
    expect(order()).toEqual(['w1', 's3', 'p2'])
    expect(status()).toBe(tl('announce.first', { name: 'W1' }))
    expect(store.canUndo.peek()).toBe(false)
  })
  it('up/down buttons: disabled at the ends; focus falls back to the handle when its button disables', () => {
    mount()
    expect(btn(tl('moveUp', { name: 'W1' })).hasAttribute('disabled')).toBe(true)
    expect(btn(tl('moveDown', { name: 'W2' })).hasAttribute('disabled')).toBe(true)
    fire(btn(tl('moveDown', { name: 'Nodule census' })), 'click')
    expect(order()).toEqual(['w1', 'p2', 's3'])
    expect(doc.activeElement).toBe(btn(tl('handle', { name: 'Nodule census' })))
    fire(btn(tl('moveUp', { name: 'W2' })), 'click')
    expect(order()).toEqual(['p2', 'w1', 's3'])
    // labels follow the order (W1, W2 among points)
    expect(byClass(root, 'rpl-label').map(text)).toEqual(['W1', 'W2', 'Nodule census'])
  })
  it('drag the handle onto another row: one reorder', () => {
    mount()
    fire(btn(tl('handle', { name: 'W2' })), 'dragstart', { dataTransfer: { setData() {}, effectAllowed: '' } })
    const first = rows()[0]
    const over = first.dispatch('dragover')
    expect(over.defaultPrevented).toBe(true)
    fire(first, 'drop')
    expect(order()).toEqual(['p2', 'w1', 's3'])
    expect(status()).toBe(tl('announce.moved', { name: 'W2', n: 1, total: 3 }))
  })
  it('an edit renders well within 200 ms (8 stops)', () => {
    store.replaceRoute({ stops: Array.from({ length: 8 }, (_, i) => makeStop({ id: `x${i}`, kind: 'point', lon: 137.38 + i / 1000, lat: -4.77 })), startUtc: null, storm: false })
    mount()
    const t0 = performance.now()
    fire(btn(tl('moveDown', { name: 'W1' })), 'click')
    expect(performance.now() - t0).toBeLessThan(200)
  })
})

describe('tags', () => {
  it('toggle is one undo step, aria-pressed follows, order is PLAN_TAGS', () => {
    mount()
    const group = one(all(root, (n) => n.getAttribute('aria-label') === tl('tagsLabel', { name: 'W1' })))
    const tag = (name: string) => one(all(group, (n) => n.localName === 'button' && text(n) === name), name)
    expect(all(group, (n) => n.localName === 'button').map(text)).toEqual([...PLAN_TAGS])
    fire(tag('Photo'), 'click')
    fire(tag('Sample'), 'click')
    expect(store.doc.peek().route.stops[0].tags).toEqual(['Sample', 'Photo'])
    expect(tag('Photo').getAttribute('aria-pressed')).toBe('true')
    expect(hasClass(tag('Photo'), 'is-on')).toBe(true)
    fire(tag('Photo'), 'click')
    expect(store.doc.peek().route.stops[0].tags).toEqual(['Sample'])
    expect(tag('Photo').getAttribute('aria-pressed')).toBe('false')
    expect(undoDepth()).toBe(3)
  })
})

describe('stop time', () => {
  const input = () => one(all(root, (n) => n.localName === 'input' && n.getAttribute('aria-label') === tl('stopTimeLabel', { name: 'W1', max: STOP_MIN_MAX })))
  const set = (v: string) => {
    const el = input() as FakeNode & { value: string }
    el.value = v
    fire(el, 'change')
    return el
  }
  it('bounds 0 … max (config), committed on change as one undo step', () => {
    mount()
    expect(input().getAttribute('min')).toBe('0')
    expect(input().getAttribute('max')).toBe(String(STOP_MIN_MAX))
    set('15')
    expect(store.doc.peek().route.stops[0].stopMin).toBe(15)
    expect(String(set('99999').value)).toBe(String(STOP_MIN_MAX))
    expect(store.doc.peek().route.stops[0].stopMin).toBe(STOP_MIN_MAX)
    expect(String(set('-5').value)).toBe('0')
    expect(store.doc.peek().route.stops[0].stopMin).toBe(0)
    set('abc')
    expect(store.doc.peek().route.stops[0].stopMin).toBe(0)
    expect(undoDepth()).toBe(3)
  })
})

describe('note', () => {
  it('typing is debounced: one undo step per idle pause, blur commits at once', () => {
    vi.useFakeTimers()
    mount()
    const ta = one(all(root, (n) => n.localName === 'textarea' && n.getAttribute('aria-label') === tl('noteLabel', { name: 'W1' }))) as FakeNode & { value: string }
    for (const v of ['S', 'Sa', 'Sam', 'Samp']) {
      ta.value = v
      fire(ta, 'input')
    }
    expect(store.doc.peek().route.stops[0].note).toBe('')
    act(() => void vi.advanceTimersByTime(600))
    expect(store.doc.peek().route.stops[0].note).toBe('Samp')
    expect(undoDepth()).toBe(1)
    ta.value = 'Samp here'
    fire(ta, 'input')
    fire(ta, 'blur')
    expect(store.doc.peek().route.stops[0].note).toBe('Samp here')
    act(() => void vi.advanceTimersByTime(1000))
    expect(undoDepth()).toBe(2)
  })
})

describe('delete', () => {
  it('removes the stop (one undo step), announces, focuses the next row; last one → empty hint', () => {
    mount()
    fire(btn(tl('remove', { name: 'Nodule census' })), 'click')
    expect(order()).toEqual(['w1', 'p2'])
    expect(status()).toBe(tl('announce.removed', { name: 'Nodule census' }))
    expect(doc.activeElement).toBe(btn(tl('handle', { name: 'W2' })))
    store.undo()
    expect(order()).toEqual(['w1', 's3', 'p2'])
    store.replaceRoute({ stops: [W1()], startUtc: null, storm: false })
    mount()
    fire(btn(tl('remove', { name: 'W1' })), 'click')
    expect(order()).toEqual([])
    expect(doc.activeElement).toBe(one(byClass(root, 'rpl-empty')))
  })
})

describe('route results (§9)', () => {
  it('MOCK_ROUTE_RESULTS: estimates on w1 and s3, the walk home marked unreachable', () => {
    store.replaceRoute({ stops: [W1(), S3()], startUtc: null, storm: false })
    mount()
    const [a, b] = rows()
    expect(text(a)).toContain(tl('estimate', { minutes: '18.5' }))
    expect(text(b)).toContain(tl('estimate', { minutes: '26.0' }))
    expect(rows().some((r) => hasClass(r, 'is-infeasible'))).toBe(false)
    const home = one(byClass(root, 'rpl-home'))
    expect(hasClass(home, 'is-infeasible')).toBe(true)
    expect(text(home)).toContain(tl('unreachable.budget'))
  })
  it('the stop whose incoming leg is infeasible gets the marker', () => {
    store.replaceRoute({ stops: [W1(), S3()], startUtc: null, storm: false })
    const r: RouteResults = { ...MOCK_ROUTE_RESULTS, legs: MOCK_ROUTE_RESULTS.legs.map((g) => (g.index === 1 ? { ...g, feasible: false, minutes: null, reason: 'unreachable' } : g)), firstInfeasibleLeg: 1 }
    mount(r)
    const [a, b] = rows()
    expect(hasClass(a, 'is-infeasible')).toBe(false)
    expect(hasClass(b, 'is-infeasible')).toBe(true)
    expect(text(b)).toContain(tl('unreachable.unreachable'))
  })
})

describe('app route results (no prop)', () => {
  it('reads what the runner publishes (state/routeResults)', () => {
    store.replaceRoute({ stops: [W1(), S3()], startUtc: null, storm: false })
    publishRouteResults(MOCK_ROUTE_RESULTS)
    try {
      act(() => render(<WaypointList store={store} stationName={names} />, root as unknown as Element))
      expect(hasClass(one(byClass(root, 'rpl-home')), 'is-infeasible')).toBe(true)
      expect(text(rows()[0])).toContain(tl('estimate', { minutes: '18.5' }))
    } finally {
      resetRouteResults()
    }
  })
})

describe('register()', () => {
  it('hands the list to the Route panel registry as section "list"', () => {
    const reg = vi.fn(() => () => {})
    register(reg)
    expect(reg).toHaveBeenCalledWith('list', expect.any(Function))
  })
})
