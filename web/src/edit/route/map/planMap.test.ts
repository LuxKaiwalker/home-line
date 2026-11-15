// PORT R3: the map binding (handles, ghost while dragging, notice, no pan while dragging).
import { describe, expect, it } from 'vitest'
import type { MapExtensionContext, MapPointer } from '../../../map/extensions'
import { createPlanningStore } from '../../../state/planning'
import { createPlanEditor } from './planEdit'
import { bindPlanEditMap, ghostLine, R3_GHOST_LAYER, R3_GHOST_SOURCE } from './planMap'

type Fn = (e: unknown) => void
class El {
  className = ''
  textContent = ''
  title = ''
  hidden = false
  tabIndex = -1
  dataset: Record<string, string> = {}
  attrs = new Map<string, string>()
  children: El[] = []
  parent: El | null = null
  ls = new Map<string, Fn[]>()
  classList = {
    set: new Set<string>(),
    add: (c: string) => void this.classList.set.add(c),
    remove: (c: string) => void this.classList.set.delete(c),
    toggle: (c: string, on?: boolean) => ((on ?? !this.classList.set.has(c)) ? this.classList.set.add(c) : this.classList.set.delete(c), !!on),
    contains: (c: string) => this.classList.set.has(c),
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v)
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null
  }
  appendChild(c: El) {
    c.parent = this
    this.children.push(c)
    return c
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this)
    this.parent = null
  }
  focus() {}
  addEventListener(t: string, f: Fn) {
    this.ls.set(t, [...(this.ls.get(t) ?? []), f])
  }
  removeEventListener(t: string, f: Fn) {
    this.ls.set(t, (this.ls.get(t) ?? []).filter((x) => x !== f))
  }
  fire(t: string, extra: Record<string, unknown> = {}) {
    const e = { type: t, key: undefined, defaultPrevented: false, preventDefault() { e.defaultPrevented = true }, stopPropagation() {}, ...extra }
    for (const f of this.ls.get(t) ?? []) f(e)
    return e
  }
}

function fakeMap() {
  const container = new El()
  const sources = new Map<string, { data: unknown; setData(d: unknown): void }>()
  const layers: { id: string; before?: string }[] = []
  const markers: { el: El; ll: [number, number] | null; added: boolean; removed: boolean }[] = []
  let panOn = true
  const map = {
    getContainer: () => container,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: { data: unknown }) => {
      const src = { data: s.data, setData(d: unknown) { src.data = d } }
      sources.set(id, src)
    },
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: (l: { id: string }, before?: string) => void layers.push({ id: l.id, before }),
    queryRenderedFeatures: () => [{}],
    dragPan: { isEnabled: () => panOn, enable: () => void (panOn = true), disable: () => void (panOn = false) },
  }
  const ctx = {
    map,
    beforeId: (slot: string) => `before-${slot}`,
    marker: (el: El) => {
      const m = { el, ll: null as [number, number] | null, added: false, removed: false, setLngLat: (ll: [number, number]) => ((m.ll = ll), m), addTo: () => ((m.added = true), m), remove: () => void (m.removed = true) }
      markers.push(m)
      return m
    },
    inShell: true,
  } as unknown as MapExtensionContext
  return { ctx, container, sources, layers, markers, pan: () => panOn, live: () => markers.filter((m) => m.added && !m.removed) }
}

const PAD = { lon: 137.4, lat: -4.78 }
const P = (lon: number, x = 0, stop?: string): MapPointer => ({ lon, lat: PAD.lat, x, y: 0, originalEvent: { button: 0, target: { closest: (s: string) => (stop && s.includes('data-r3-stop') ? { getAttribute: () => stop } : null) } } as unknown as MouseEvent })

describe('R3 planMap', () => {
  it('handles follow the free points while editing; ghost and no-pan while dragging; notice; delete', () => {
    const store = createPlanningStore()
    const ed = createPlanEditor({ store, pad: () => PAD, stations: () => [{ id: 'S1', lon: 137.44, lat: PAD.lat }], noticeMs: 0 })
    const win = new El()
    const f = fakeMap()
    f.layers.push({ id: 'access-pts' })
    const off = bindPlanEditMap(ed, f.ctx, { doc: { createElement: () => new El() } as never, win: win as never })
    expect(f.layers).toEqual([{ id: 'access-pts' }, { id: R3_GHOST_LAYER, before: 'before-edit' }])
    ed.addPointAt(137.42, PAD.lat)
    ed.addStation('S1')
    ed.addPointAt(137.46, PAD.lat)
    expect(f.live()).toHaveLength(0) // editing off: no handles
    ed.setEditing(true)
    expect(f.live().map((m) => m.el.getAttribute('data-r3-stop'))).toEqual(store.doc.peek().route.stops.filter((s) => s.kind === 'point').map((s) => s.id))
    expect(f.live().map((m) => m.el.children[0].textContent)).toEqual(['W1', 'W2'])
    // a station feature under the pointer keeps its click
    expect(ed.handlers.click!(P(137.5, 0))).toBe(false)

    const id = store.doc.peek().route.stops[0].id
    ed.handlers.dragStart!(P(137.42, 0, id))
    expect(f.pan()).toBe(false)
    ed.handlers.drag!(P(137.43, 30))
    const ghost = f.sources.get(R3_GHOST_SOURCE)!.data as GeoJSON.FeatureCollection
    expect((ghost.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([[PAD.lon, PAD.lat], [137.43, PAD.lat], [137.44, PAD.lat]])
    expect(f.live()[0].ll).toEqual([137.43, PAD.lat])
    ed.handlers.dragEnd!(P(137.43, 30))
    expect(f.pan()).toBe(true)
    expect((f.sources.get(R3_GHOST_SOURCE)!.data as GeoJSON.FeatureCollection).features).toHaveLength(0)
    const box = f.container.children.find((c) => c.className === 'hl-r3-notice')!
    expect(box.textContent).toContain('W1')
    expect(box.hidden).toBe(false)

    // Delete key on a focused handle, then the remove button
    f.live()[0].el.fire('keydown', { key: 'Delete' })
    expect(store.doc.peek().route.stops.map((s) => s.kind)).toEqual(['station', 'point'])
    const rm = f.live()[0].el.children[1]
    expect(rm.getAttribute('aria-label')).toContain('W1')
    rm.fire('click')
    expect(store.doc.peek().route.stops.map((s) => s.kind)).toEqual(['station'])
    expect(f.live()).toHaveLength(0)

    ed.setEditing(false)
    off()
    expect(f.container.children).toHaveLength(0)
  })

  it('ghostLine: nothing without a drag; refused drag is marked', () => {
    expect(ghostLine(null).features).toHaveLength(0)
    const g = ghostLine({ lon: 1, lat: 2, valid: false, prev: { lon: 0, lat: 0 }, next: null })
    expect(g.features[0].properties).toMatchObject({ valid: false, state: 'estimate' })
  })
})
