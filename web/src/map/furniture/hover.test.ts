// L7a (D111, team lead test Sun 12:39, blocking): pointer hover never changes state.
//  1. during the replay, pointer moves over the map leave it running: the clock is not paused, not
//     reset, and the thread stays the crew's (no route from the pointer is computed);
//  2. in Plan mode, a hover shows only a passive tooltip (fieldAt lookup, labelled estimate): no route
//     is computed and no store changes (every signal of mission, ui and selection is spied on);
//  3. the route to the pointer appears only in the explicit mode (the way-home key held), and never
//     while the replay runs.
// The explicit stops (Play / pause, Space, the flythrough's own cancel) are checked on the built app
// (tests/visual/hover-replay.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldSample } from '../field'
import { FakeNode, installDom } from '../../ui/testing/dom'

// the fake DOM has appendChild only (the readout control uses append()) and its textContent setter
// clears the children without writing the text; both completed here, for this file only
;(FakeNode.prototype as unknown as { append(...n: FakeNode[]): void }).append = function (this: FakeNode, ...n: FakeNode[]) {
  for (const c of n) this.appendChild(c)
}
const textDesc = Object.getOwnPropertyDescriptor(FakeNode.prototype, 'textContent')!
Object.defineProperty(FakeNode.prototype, 'textContent', {
  get: textDesc.get,
  set(this: FakeNode, v: string) {
    textDesc.set!.call(this, v)
    if (this.nodeType !== 3 && v) this.appendChild(this.ownerDocument!.createTextNode(v))
  },
})

const markers: { el: FakeNode; at: [number, number] | null; added: boolean }[] = []
vi.mock('maplibre-gl', () => ({
  Marker: class {
    rec: { el: FakeNode; at: [number, number] | null; added: boolean }
    constructor(o: { element: FakeNode }) {
      this.rec = { el: o.element, at: null, added: false }
      markers.push(this.rec)
    }
    setLngLat(p: [number, number]) {
      this.rec.at = p
      return this
    }
    addTo() {
      this.rec.added = true
      return this
    }
    remove() {
      this.rec.added = false
    }
  },
}))
vi.mock('../compass', () => ({
  CompassControl: class {
    setMinute() {}
    setSun() {}
  },
}))
vi.mock('../../data/loader', () => ({ data: () => ({ optional: () => Promise.resolve(null), clock: () => Promise.resolve(null) }) }))

const threadPath = vi.fn((_lon: number, _lat: number, _t: number) => null)
vi.mock('../thread', async (orig) => ({ ...(await orig<typeof import('../thread')>()), threadPath: (lon: number, lat: number, t: number) => threadPath(lon, lat, t) }))

const SAMPLE: FieldSample = {
  lon: 0,
  lat: 0,
  inside: true,
  state: null,
  unknown: false,
  tHome: { nominal: 12.34 } as FieldSample['tHome'],
  o2Home: null,
  noRouteHome: {} as FieldSample['noRouteHome'],
  variant: 'nominal',
} as unknown as FieldSample
vi.mock('../field', async (orig) => ({ ...(await orig<typeof import('../field')>()), fieldAt: (lon: number, lat: number) => ({ ...SAMPLE, lon, lat }) }))

const { threadFrom, hoverTipText, WAY_HOME_KEY } = await import('./hover')
const { MapFurniture } = await import('./index')
const { mission, ui, Signal } = await import('../../state')
const { selection } = await import('../../state/selection')

/** A MapLibre stand-in: events, sources with a setData log, a container that keeps attributes. */
function fakeMap() {
  const on = new Map<string, Set<(e?: unknown) => void>>()
  const container = document.createElement('div') as unknown as FakeNode
  const setData = new Map<string, unknown[]>()
  return {
    setData,
    container,
    on: (ev: string, f: (e?: unknown) => void) => void (on.get(ev) ?? on.set(ev, new Set()).get(ev)!).add(f),
    off: (ev: string, f: (e?: unknown) => void) => void on.get(ev)?.delete(f),
    fire: (ev: string, e?: unknown) => on.get(ev)?.forEach((f) => f(e)),
    getContainer: () => container,
    addSource: (id: string) => void setData.set(id, []),
    addLayer: () => undefined,
    addControl: () => undefined,
    getSource: (id: string) => ({ setData: (d: unknown) => setData.get(id)?.push(d) }),
    getLayer: () => true,
    setPaintProperty: () => undefined,
  }
}

/** Every signal in the mission, ui and selection stores, with a change counter on each. */
function spyStores() {
  const changes: string[] = []
  const offs: (() => void)[] = []
  const walk = (o: unknown, path: string) => {
    if (o instanceof Signal) offs.push(o.subscribe(() => changes.push(path)))
    else if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
  }
  walk(mission, 'mission')
  walk(ui, 'ui')
  walk(selection, 'selection')
  return { changes, count: offs.length, stop: () => offs.forEach((f) => f()) }
}

const move = (lng: number, lat: number, altKey = false) => ({ lngLat: { lng, lat }, originalEvent: { altKey } })

describe('L7a: threadFrom and the passive tooltip (pure)', () => {
  const cursor: [number, number] = [137.4, -4.6]
  const crew: [number, number] = [137.41, -4.59]
  it('the replay keeps the crew thread whatever the pointer does', () => {
    expect(threadFrom({ cursor, wayHome: false, playing: true, crew })).toEqual({ kind: 'crew', at: crew })
    expect(threadFrom({ cursor, wayHome: true, playing: true, crew })).toEqual({ kind: 'crew', at: crew })
    expect(threadFrom({ cursor, wayHome: true, playing: true, crew: null })).toEqual({ kind: 'none', at: null })
  })
  it('a plain hover never starts a thread at the pointer', () => {
    expect(threadFrom({ cursor, wayHome: false, playing: false, crew: null })).toEqual({ kind: 'none', at: null })
    expect(threadFrom({ cursor, wayHome: false, playing: false, crew })).toEqual({ kind: 'crew', at: crew })
  })
  it('the way-home key held (explicit mode) starts it at the pointer, outside the replay', () => {
    expect(threadFrom({ cursor, wayHome: true, playing: false, crew })).toEqual({ kind: 'pointer', at: cursor })
    expect(threadFrom({ cursor: null, wayHome: true, playing: false, crew })).toEqual({ kind: 'crew', at: crew })
    expect(WAY_HOME_KEY).toBe('Alt') // no I1 modifier (Ctrl / Shift belong to right-drag rotate)
  })
  it('the tooltip is the field lookup, labelled as an estimate', () => {
    expect(hoverTipText(SAMPLE)).toBe('Estimate: home in 12.3 min · hold Alt for the way home')
    expect(hoverTipText({ ...SAMPLE, unknown: true } as FieldSample)).toBe('No time home known here')
    expect(hoverTipText({ ...SAMPLE, inside: false } as FieldSample)).toBeNull()
    expect(hoverTipText(null)).toBeNull()
  })
})

describe('L7a: MapFurniture on pointer hover', () => {
  type Win = EventTarget & { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
  let win: Win
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    installDom()
    const g = globalThis as Record<string, unknown>
    win = Object.assign(new EventTarget(), {
      setTimeout: ((f: () => void, ms?: number) => setTimeout(f, ms)) as typeof setTimeout,
      clearTimeout: ((id: number) => clearTimeout(id)) as typeof clearTimeout,
    })
    g.window = win
    g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16)
    g.cancelAnimationFrame = (id: number) => clearTimeout(id)
    ui.reducedMotion.value = true
    markers.length = 0
    threadPath.mockClear()
  })
  afterEach(() => {
    mission.clock.playing.value = false
    mission.clock.t.value = 0
    vi.useRealTimers()
  })

  function setup(playing: boolean, t: number) {
    mission.clock.t.value = t
    mission.clock.playing.value = playing
    const map = fakeMap()
    const f = new MapFurniture(map as never)
    vi.advanceTimersByTime(200)
    threadPath.mockClear()
    return { map, f, threadFrom: () => map.container.getAttribute('data-thread-from') }
  }

  const hoverTip = () => markers.find((m) => (m.el.getAttribute('class') ?? (m.el as unknown as { className: string }).className ?? '').includes('hl-hover-tip'))

  it('during the replay, hover leaves it running: no store change, no route from the pointer', () => {
    const { map, f, threadFrom } = setup(true, 42)
    const spy = spyStores()
    expect(spy.count).toBeGreaterThan(10)
    for (let i = 0; i < 20; i++) {
      map.fire('mousemove', move(137.40 + i * 0.001, -4.6 + i * 0.0005))
      vi.advanceTimersByTime(40)
    }
    map.fire('mouseout')
    vi.advanceTimersByTime(100)
    expect(spy.changes).toEqual([])
    expect(mission.clock.playing.peek()).toBe(true)
    expect(mission.clock.t.peek()).toBe(42)
    // no plan in this stand-in: no crew position, so no thread at all, and never one from the pointer
    expect(threadPath).not.toHaveBeenCalled()
    expect(threadFrom()).toBe('none')
    spy.stop()
    f.destroy()
  })

  it('during the replay, the way-home key does not take the thread away from the crew either', () => {
    const { map, f } = setup(true, 42)
    map.fire('mousemove', move(137.4, -4.6, true))
    win.dispatchEvent(Object.assign(new Event('keydown'), { key: WAY_HOME_KEY }))
    vi.advanceTimersByTime(200)
    expect(threadPath).not.toHaveBeenCalled()
    expect(mission.clock.playing.peek()).toBe(true)
    f.destroy()
  })

  it('in Plan mode a hover is a passive tooltip only: field lookup labelled estimate, no route, no store change', () => {
    const { map, f, threadFrom } = setup(false, 0)
    const spy = spyStores()
    map.fire('mousemove', move(137.4, -4.6))
    vi.advanceTimersByTime(100)
    const tip = hoverTip()
    expect(tip?.added).toBe(true)
    expect(tip?.at).toEqual([137.4, -4.6])
    expect(tip?.el.textContent).toBe('Estimate: home in 12.3 min · hold Alt for the way home')
    expect(tip?.el.getAttribute('data-estimate')).toBe('true')
    expect(tip?.el.getAttribute('data-trust')).toBe('modelled')
    expect(threadPath).not.toHaveBeenCalled()
    expect(threadFrom()).toBe('none')
    // the thread source only ever got the empty collection
    expect(map.setData.get('thread')!.every((d) => (d as { features?: unknown[] }).features?.length === 0)).toBe(true)
    map.fire('mouseout')
    vi.advanceTimersByTime(100)
    expect(hoverTip()?.added).toBe(false)
    expect(spy.changes).toEqual([])
    spy.stop()
    f.destroy()
  })

  it('the route to the pointer appears only with the way-home key held (explicit mode)', () => {
    const { map, f, threadFrom } = setup(false, 0)
    const spy = spyStores()
    map.fire('mousemove', move(137.4, -4.6, true))
    vi.advanceTimersByTime(100)
    expect(threadPath).toHaveBeenCalledWith(137.4, -4.6, 0)
    expect(threadFrom()).toBe('pointer')
    // releasing the key, then a key press over a resting pointer
    win.dispatchEvent(Object.assign(new Event('keyup'), { key: WAY_HOME_KEY }))
    vi.advanceTimersByTime(100)
    expect(threadFrom()).toBe('none')
    threadPath.mockClear()
    win.dispatchEvent(Object.assign(new Event('keydown'), { key: WAY_HOME_KEY }))
    vi.advanceTimersByTime(100)
    expect(threadPath).toHaveBeenCalledWith(137.4, -4.6, 0)
    expect(spy.changes).toEqual([])
    spy.stop()
    f.destroy()
  })
})
