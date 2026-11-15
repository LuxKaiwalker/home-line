// L1c: base maps registered (satellite default, nothing added to the map until the user switches), the
// relief raster lands just above `basemap` and hides again on Satellite; legends with their trust note.
// F3 (D146): Topography is not registered and the map-edge switcher is not mounted (code kept, still
// tested directly); Material is a layer of the layers popover (off by default) that replaces the three
// built-in mineral overlays.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installMapExtensions, mapControlsIn, registerBasemap, replacedOverlays, resetMapExtensions, type MapExtensionContext } from '../extensions'
import { OVERLAYS } from '../overlays/catalog'
import { FieldGrid } from '../../hud/fields'
import { all, byClass, byRole, installDom, type FakeNode } from '../../ui/testing/dom'
import copyJson from '../../ui/copy.json'
import { BasemapControl } from './Control'
import { install, MATERIAL_REPLACES } from './install'
import { reliefBasemap, reliefLayerId, reliefSourceId, resetReliefCache, type ReliefDeps } from './layer'
const own = { basemaps: copyJson.route.basemaps }
import { activeBasemap, DEFAULT_BASEMAP, reliefStatus, resetBasemaps, setBasemap } from './store'

function fakeMap(style?: string[]) {
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
    moveLayer: (id: string, before?: string) => void (layers.get(id)!.before = before),
    getStyle: style ? () => ({ layers: [...style, ...layers.keys()].map((id) => ({ id })) }) : undefined,
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
  it('registers satellite (default) and material, not topography; nothing is added to the map by default', () => {
    const d = deps()
    off = install(d)
    const { ctx, layers, sources } = fakeMap()
    const host = installMapExtensions(ctx)
    for (const id of ['satellite', 'material']) expect(host.basemap(id)).toBeDefined()
    expect(host.basemap('topo')).toBeUndefined()
    expect(DEFAULT_BASEMAP).toBe('satellite')
    expect(activeBasemap.peek()).toBe('satellite')
    expect(host.overlay('material')).toBeDefined()
    expect(layers.size).toBe(0)
    expect(sources.size).toBe(0)
    expect(d.loads).toBe(0)
    host.destroy()
  })

  it('material replaces the three mineral overlays (their catalog entries stay)', () => {
    off = install(deps())
    expect([...MATERIAL_REPLACES]).toEqual(['mineralSulfate', 'mineralClay', 'mineralPatches'])
    for (const id of MATERIAL_REPLACES) {
      expect(replacedOverlays.peek().has(id)).toBe(true)
      expect(OVERLAYS.some((o) => o.id === id)).toBe(true)
    }
    off()
    off = () => {}
    expect(replacedOverlays.peek().size).toBe(0)
  })

  it('relief rasters (topography code kept) render once, sit just above the basemap, hide on satellite and show again without re-rendering', async () => {
    const d = deps()
    off = install(d)
    const offTopo = registerBasemap(reliefBasemap('topo', d)) // not registered by install() any more (D146)
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
    offTopo()
    expect(layers.size).toBe(0)
    expect(sources.size).toBe(0)
  })

  it('lands just above the satellite tiles (basemap-*), not at the bottom of the style (F3 fix: "material draws nothing")', async () => {
    off = install(deps())
    const { ctx, layers } = fakeMap(['relief-shading', 'basemap-0', 'basemap-1', 'iso-fill', 'iso-lines'])
    const host = installMapExtensions(ctx)
    setBasemap('material')
    await settle()
    expect(layers.get(reliefLayerId('material'))).toEqual({ layout: { visibility: 'visible' }, before: 'iso-fill' })
    host.destroy()
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

describe('Material in the layers popover (F3, D146)', () => {
  let root: FakeNode
  beforeEach(() => {
    ;({ container: root } = installDom())
  })
  afterEach(() => render(null, root as unknown as Element))

  it('no map-edge switcher; one layers-popover row, off by default; the toggle shows the material map with its legend and trust note', async () => {
    off = install(deps())
    const { ctx, layers } = fakeMap()
    const host = installMapExtensions(ctx)
    expect(mapControlsIn('map-edge')).toEqual([])
    const ctl = mapControlsIn('layers-popover')
    expect(ctl.map((c) => c.id)).toEqual(['l1c-material'])
    act(() => render(<>{ctl[0].render()}</>, root as unknown as Element))
    const sw = () => byRole(root, 'switch')[0]
    expect(sw()).toBeDefined()
    expect(root.textContent).toContain(own.basemaps.material)
    expect(root.textContent).not.toContain(own.basemaps.topo)
    expect(activeBasemap.peek()).toBe('satellite')
    expect(layers.size).toBe(0)
    act(() => void sw().dispatch('click', {}))
    expect(activeBasemap.peek()).toBe('material')
    await act(settle)
    expect(layers.get(reliefLayerId('material'))!.layout.visibility).toBe('visible')
    expect(root.textContent).toContain(own.basemaps.materialTitle)
    expect(root.textContent).toContain('Not a mineral survey')
    expect(all(root, (n) => n.getAttribute('data-overlay') === 'material')).toHaveLength(1)
    expect(byClass(root, 'hl-chip--simulated')).toHaveLength(1)
    act(() => void sw().dispatch('click', {}))
    expect(activeBasemap.peek()).toBe('satellite')
    expect(layers.get(reliefLayerId('material'))!.layout.visibility).toBe('none')
    expect(root.textContent).not.toContain(own.basemaps.materialTitle)
    host.destroy()
  })

  it('the old switcher component still renders (code kept, not mounted)', () => {
    act(() => render(<BasemapControl />, root as unknown as Element))
    expect(byRole(root, 'radio').map((r) => r.textContent)).toEqual([own.basemaps.satellite, own.basemaps.topo, own.basemaps.material])
  })
})
