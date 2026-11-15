// L1c: three base maps registered (satellite default, nothing added to the map until the user
// switches), the map-edge switcher changes the active base map, the relief raster lands just above
// `basemap` and hides again on Satellite; legends with their trust note; strings from copy.L1c.json.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installMapExtensions, mapControlsIn, resetMapExtensions, type MapExtensionContext } from '../extensions'
import { FieldGrid } from '../../hud/fields'
import { byRole, installDom, type FakeNode } from '../../ui/testing/dom'
import own from './copy.L1c.json'
import { install } from './install'
import { reliefLayerId, reliefSourceId, resetReliefCache, type ReliefDeps } from './layer'
import { activeBasemap, DEFAULT_BASEMAP, reliefStatus, resetBasemaps, setBasemap } from './store'

function fakeMap() {
  const layers = new Map<string, { layout: Record<string, unknown>; before?: string }>()
  const sources = new Map<string, unknown>()
  const map = {
    on() {},
    off() {},
    getCanvas: () => ({ style: {} }),
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: unknown) => void sources.set(id, s),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string; layout?: Record<string, unknown> }, before?: string) => void layers.set(l.id, { layout: { ...(l.layout ?? {}) }, before }),
    removeLayer: (id: string) => void layers.delete(id),
    setLayoutProperty: (id: string, k: string, v: unknown) => void (layers.get(id)!.layout[k] = v),
  }
  const ctx = { map, beforeId: (slot: string) => (slot === 'basemap' ? 'above-basemap' : undefined), marker: () => ({}), inShell: true } as unknown as MapExtensionContext
  return { ctx, layers, sources }
}

/** 8×8 cells of 5 m rising east at about 11 deg, inside the Unity rocks' bounds. */
function deps(): ReliefDeps & { loads: number } {
  const w = 8
  const h = 8
  const grid = new FieldGrid({ bounds: [137.35, -4.82, 137.36, -4.81], width: w, height: h, res_m: 5 }, { width: w, height: h, scale: 1, counts: new Uint16Array(w * h), known: new Uint8Array(w * h) })
  const elev = new Float32Array(w * h)
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) elev[r * w + c] = -4100 + c
  const d = { loads: 0, load: async () => (d.loads++, { grid, elev, resM: 5, elevationResM: 8 }), toUrl: async () => 'blob:relief' }
  return d
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 25))
}

let off: () => void = () => {}
afterEach(() => {
  off()
  resetMapExtensions()
  resetBasemaps()
  resetReliefCache()
})

describe('L1c base maps', () => {
  it('registers satellite (default), topography and material; nothing is added to the map by default', () => {
    const d = deps()
    off = install(d)
    const { ctx, layers, sources } = fakeMap()
    const host = installMapExtensions(ctx)
    for (const id of ['satellite', 'topo', 'material']) expect(host.basemap(id)).toBeDefined()
    expect(DEFAULT_BASEMAP).toBe('satellite')
    expect(activeBasemap.peek()).toBe('satellite')
    expect(layers.size).toBe(0)
    expect(sources.size).toBe(0)
    expect(d.loads).toBe(0)
    host.destroy()
  })

  it('topography renders once, sits just above the basemap, hides on satellite and shows again without re-rendering', async () => {
    const d = deps()
    off = install(d)
    const { ctx, layers, sources } = fakeMap()
    const host = installMapExtensions(ctx)
    setBasemap('topo')
    expect(reliefStatus.peek().topo.kind).toBe('rendering')
    await settle()
    expect(reliefStatus.peek().topo.kind).toBe('ready')
    expect(sources.has(reliefSourceId('topo'))).toBe(true)
    expect(layers.get(reliefLayerId('topo'))).toEqual({ layout: { visibility: 'visible' }, before: 'above-basemap' })
    setBasemap('satellite')
    expect(layers.get(reliefLayerId('topo'))!.layout.visibility).toBe('none')
    setBasemap('material')
    await settle()
    expect(layers.get(reliefLayerId('material'))!.layout.visibility).toBe('visible')
    setBasemap('topo')
    await settle()
    expect(layers.get(reliefLayerId('topo'))!.layout.visibility).toBe('visible')
    expect(layers.get(reliefLayerId('material'))!.layout.visibility).toBe('none')
    expect(d.loads).toBe(2) // one raster per type, never re-rendered
    host.destroy()
    expect(layers.size).toBe(0)
    expect(sources.size).toBe(0)
  })

  it('a failed load reports an error and keeps satellite usable', async () => {
    off = install({ load: async () => Promise.reject(new Error('offline')), toUrl: async () => '' })
    const { ctx, layers } = fakeMap()
    const host = installMapExtensions(ctx)
    setBasemap('material')
    await settle()
    expect(reliefStatus.peek().material).toEqual({ kind: 'error', message: 'offline' })
    expect(layers.size).toBe(0)
    host.destroy()
  })
})

describe('L1c switcher (map-edge control)', () => {
  let root: FakeNode
  beforeEach(() => {
    ;({ container: root } = installDom())
  })
  afterEach(() => render(null, root as unknown as Element))

  it('is one map-edge control; clicking a choice changes the active base map; legends carry the trust note', async () => {
    off = install(deps())
    const { ctx } = fakeMap()
    const host = installMapExtensions(ctx)
    const ctl = mapControlsIn('map-edge')
    expect(ctl.map((c) => c.id)).toEqual(['basemaps'])
    expect(mapControlsIn('layers-popover')).toEqual([])
    act(() => render(<>{ctl[0].render()}</>, root as unknown as Element))
    const radios = () => byRole(root, 'radio')
    expect(radios().map((r) => r.textContent)).toEqual([own.basemaps.satellite, own.basemaps.topo, own.basemaps.material])
    expect(radios()[0].getAttribute('aria-checked')).toBe('true')
    act(() => void radios()[1].dispatch('click', {}))
    expect(activeBasemap.peek()).toBe('topo')
    await act(settle)
    expect(root.textContent).toContain('Contours every')
    expect(root.textContent).toContain('not a survey')
    act(() => void radios()[2].dispatch('click', {}))
    expect(activeBasemap.peek()).toBe('material')
    await act(settle)
    expect(root.textContent).toContain(own.basemaps.materialTitle)
    expect(root.textContent).toContain('Not a mineral survey')
    act(() => void radios()[0].dispatch('click', {}))
    expect(activeBasemap.peek()).toBe('satellite')
    expect(root.textContent).not.toContain('Contours every')
    host.destroy()
  })
})
