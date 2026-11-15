// PORT L1a acceptance (written first): slope classes from config (fixture + the real site.yaml),
// unknown → transparent, replaces wiring (registerOverlay replaces 'slopeClass', one slope layer),
// opacity clamp (tokens overlayOpacity), default = Plan's slopeClass default, lazy load, the control
// standalone (toggle, legend, trust chip, slider), copy rules, colour tokens in CSS = raster colours.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { parse as parseYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CITED } from '../../../config'
import { color, TOKENS } from '../../../ui/tokens'
import { byClass, installDom, type FakeNode } from '../../../ui/testing/dom'
import { installMapExtensions, mapControlsIn, resetMapExtensions, type MapExtensionContext } from '../../extensions'
import { DEFAULT_ON, OPACITY, OVERLAYS } from '../catalog'
import {
  clampSlopeOpacity,
  recipeRgb,
  renderSlope,
  REPLACES,
  SLOPE_CLASS_IDS,
  SLOPE_COLORS,
  SLOPE_DEFAULT_ON,
  SLOPE_DEFAULT_OPACITY,
  SLOPE_OPACITY,
  slopeClasses,
  slopeClassOf,
  slopeColorVar,
  type SlopeLimits,
} from './classes'
import copyDeck from '../../../ui/copy.json'
import { install } from './index'
import { corners, installSlopeLayer, SLOPE_LAYER_ID, SLOPE_OVERLAY_ID, SLOPE_SOURCE_ID, SLOPE_TITLE_KEY, slopeFieldKey, slopeOverlaySpec, type SlopeDeps, type SlopeRaster } from './layer'
import { rangeText, SlopeControl } from './SlopeControl'
import { resetSlope, setSlopeOn, setSlopeOpacity, slopeError, slopeFile, slopeOn, slopeOpacity, slopeStatus } from './state'

const HERE = dirname(fileURLToPath(import.meta.url))
const copyJson = copyDeck.route.layers.slope
const REPO = join(HERE, '..', '..', '..', '..', '..')

/** Fixture limits (not the real ones) so the test proves edges come from the limits passed in. */
const FIXTURE: SlopeLimits = {
  sitingMaxSlopeDeg: { value: 3, source: 'fixture: siting.max_slope_deg' },
  flagBeyondTestedDeg: { value: 11, source: 'fixture: slope.flag_beyond_tested_deg' },
  nogoNominalDeg: { value: 14, source: 'fixture: slope.nogo_deg.nominal' },
  nogoOptimisticDeg: { value: 30, source: 'fixture: slope.nogo_deg.optimistic' },
}

afterEach(() => {
  resetMapExtensions()
  resetSlope()
})

describe('slope classes come from config', () => {
  it('fixture limits: edges, sources, ascending', () => {
    const c = slopeClasses(FIXTURE)
    expect(c.map((x) => x.id)).toEqual(SLOPE_CLASS_IDS)
    expect(c.map((x) => [x.minDeg, x.maxDeg])).toEqual([
      [0, 3],
      [3, 11],
      [11, 14],
      [14, 30],
      [30, Infinity],
    ])
    expect(c.map((x) => x.source)).toEqual([FIXTURE.sitingMaxSlopeDeg.source, FIXTURE.flagBeyondTestedDeg.source, FIXTURE.nogoNominalDeg.source, FIXTURE.nogoOptimisticDeg.source, FIXTURE.nogoOptimisticDeg.source])
  })

  it('default limits are config/site.yaml as read by the app config loader (CITED)', () => {
    const site = parseYaml(readFileSync(join(REPO, 'config', 'site.yaml'), 'utf8'))
    const c = slopeClasses()
    expect(c.map((x) => x.maxDeg)).toEqual([site.siting.max_slope_deg, site.slope.flag_beyond_tested_deg, site.slope.nogo_deg.nominal, site.slope.nogo_deg.optimistic, Infinity])
    expect(c.map((x) => x.maxDeg).slice(0, 4)).toEqual([CITED.sitingMaxSlopeDeg.value, CITED.flagBeyondTestedDeg.value, CITED.nogoNominalDeg.value, CITED.nogoOptimisticDeg.value])
    expect(c[0].source).toBe('config/site.yaml: siting.max_slope_deg')
  })

  it('rejects limits that are not ascending', () => {
    expect(() => slopeClasses({ ...FIXTURE, nogoNominalDeg: { value: 9, source: 'x' } })).toThrow(/ascending/)
  })

  it('an edge value belongs to the class above; NaN is unknown', () => {
    const c = slopeClasses(FIXTURE)
    expect(slopeClassOf(0, c)).toBe(0)
    expect(slopeClassOf(2.99, c)).toBe(0)
    expect(slopeClassOf(3, c)).toBe(1)
    expect(slopeClassOf(14, c)).toBe(3)
    expect(slopeClassOf(30, c)).toBe(4)
    expect(slopeClassOf(89, c)).toBe(4)
    expect(slopeClassOf(NaN, c)).toBe(-1)
  })
})

describe('renderSlope', () => {
  it('colours known cells by class, leaves unknown transparent; counts × scale = degrees', () => {
    const c = slopeClasses(FIXTURE)
    const rgb = c.map((x) => recipeRgb(SLOPE_COLORS[x.id]))
    // scale 0.01: 200 = 2° (pad-flat), 1200 = 12° (beyond tested), 3100 = 31° (no-go always), last unknown
    const out = renderSlope([200, 1200, 3100, 500], [1, 1, 1, 0], 0.01, c)
    expect([...out.slice(0, 4)]).toEqual([...rgb[0], 255])
    expect([...out.slice(4, 8)]).toEqual([...rgb[2], 255])
    expect([...out.slice(8, 12)]).toEqual([...rgb[4], 255])
    expect([...out.slice(12, 16)]).toEqual([0, 0, 0, 0])
  })

  it('all-unknown field is fully transparent', () => {
    expect(renderSlope([100, 2000], [0, 0], 0.01).every((v) => v === 0)).toBe(true)
  })
})

describe('colours are tokens', () => {
  it('recipes use token names only; mixes match CSS color-mix in srgb', () => {
    for (const id of SLOPE_CLASS_IDS) {
      const r = SLOPE_COLORS[id]
      const toks = 'token' in r ? [r.token] : r.mix
      for (const tk of toks) expect(Object.keys(TOKENS.color)).toContain(tk)
    }
    const hex = color('safe')
    expect(recipeRgb({ token: 'safe' })).toEqual([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))
    const fake = (tk: string) => (tk === 'safe' ? '#000000' : '#ff6400')
    expect(recipeRgb({ mix: ['safe', 'caution'], pct: 50 }, fake as never)).toEqual([128, 50, 0])
  })

  it('slope.css defines one custom property per class with the same recipe', () => {
    const css = readFileSync(join(HERE, 'slope.css'), 'utf8')
    for (const id of SLOPE_CLASS_IDS) {
      const name = slopeColorVar(id).slice(4, -1)
      const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css)
      expect(m, name).not.toBeNull()
      const r = SLOPE_COLORS[id]
      const kebab = (s: string) => s.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)
      const want = 'token' in r ? `var(--color-${kebab(r.token)})` : `color-mix(in srgb, var(--color-${kebab(r.mix[0])}) ${r.pct}%, var(--color-${kebab(r.mix[1])}))`
      expect(m![1].trim()).toBe(want)
    }
  })
})

describe('opacity and default', () => {
  // spec change (team lead 22:03): the slope layer keeps the Mission Planer's 10-100 % range, default 45 %
  it('opacity clamps to 10-100 % (Mission Planer range), default 45 %', () => {
    expect(SLOPE_OPACITY.min).toBe(0.1)
    expect(SLOPE_OPACITY.max).toBe(1)
    expect(clampSlopeOpacity(2)).toBe(1)
    expect(clampSlopeOpacity(0)).toBe(0.1)
    expect(clampSlopeOpacity(-1)).toBe(0.1)
    expect(clampSlopeOpacity(0.8)).toBe(0.8)
    expect(clampSlopeOpacity(0.2)).toBe(0.2)
    expect(clampSlopeOpacity(NaN)).toBe(SLOPE_DEFAULT_OPACITY)
    expect(SLOPE_DEFAULT_OPACITY).toBe(0.45)
    // the other Plan overlays keep the tokens range
    expect(OPACITY.min).toBe(TOKENS.overlayOpacity.min)
    expect(OPACITY.max).toBe(TOKENS.overlayOpacity.max)
    setSlopeOpacity(5)
    expect(slopeOpacity.peek()).toBe(1)
  })

  it('default on/off = Plan slopeClass default', () => {
    expect(SLOPE_DEFAULT_ON).toBe(DEFAULT_ON.slopeClass)
    expect(slopeOn.peek()).toBe(DEFAULT_ON.slopeClass)
  })
})

// ---- map side --------------------------------------------------------------------------------

function fakeMap() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, { spec: Record<string, unknown>; before?: string; layout: Record<string, unknown>; paint: Record<string, unknown> }>()
  const handlers = new Map<string, unknown>()
  const map = {
    addSource: (id: string, spec: unknown) => void sources.set(id, spec),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (spec: Record<string, unknown>, before?: string) =>
      void layers.set(spec.id as string, { spec, before, layout: { ...(spec.layout as object) }, paint: { ...(spec.paint as object) } }),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => void layers.delete(id),
    setLayoutProperty: (id: string, k: string, v: unknown) => void (layers.get(id)!.layout[k] = v),
    setPaintProperty: (id: string, k: string, v: unknown) => void (layers.get(id)!.paint[k] = v),
    on: (t: string, f: unknown) => void handlers.set(t, f),
    off: (t: string) => void handlers.delete(t),
    getCanvas: () => ({ style: { cursor: '' } }),
  }
  const ctx = { map, beforeId: (slot: string) => (slot === 'overlay' ? 'iso-lines' : undefined), marker: () => ({}), inShell: true } as unknown as MapExtensionContext
  return { ctx, sources, layers }
}

const RASTER: SlopeRaster = { width: 2, height: 1, counts: [100, 2600], known: [1, 0], scale: 0.01, w: 137.3, s: -4.7, e: 137.4, n: -4.6, file: 'fields/shared/slope.png' }

function fakeDeps(over: Partial<SlopeDeps> = {}) {
  const calls = { load: 0, urls: [] as string[], revoked: [] as string[], rgba: [] as Uint8ClampedArray[] }
  const deps: SlopeDeps = {
    loadRaster: async () => (calls.load++, RASTER),
    toImageUrl: async (rgba) => {
      calls.rgba.push(rgba)
      const u = `blob:slope-${calls.urls.length}`
      calls.urls.push(u)
      return u
    },
    revokeUrl: (u) => void calls.revoked.push(u),
    limits: FIXTURE,
    ...over,
  }
  return { deps, calls }
}

describe('slope layer on the map', () => {
  it('lazy: nothing is fetched while off; first on loads once, adds the image source under the overlay slot', async () => {
    const { ctx, sources, layers } = fakeMap()
    const { deps, calls } = fakeDeps()
    const h = installSlopeLayer(ctx, deps)
    expect(calls.load).toBe(0)
    expect(sources.size).toBe(0)
    h.setVisible(true)
    expect(slopeStatus.peek()).toBe('loading')
    await h.settled()
    expect(calls.load).toBe(1)
    expect(slopeStatus.peek()).toBe('ready')
    expect(slopeFile.peek()).toBe(RASTER.file)
    expect(sources.get(SLOPE_SOURCE_ID)).toEqual({ type: 'image', url: 'blob:slope-0', coordinates: corners(RASTER) })
    const l = layers.get(SLOPE_LAYER_ID)!
    expect(l.before).toBe('iso-lines')
    expect(l.layout.visibility).toBe('visible')
    // unknown cell transparent in what reached the map
    expect([...calls.rgba[0].slice(4, 8)]).toEqual([0, 0, 0, 0])
    expect(calls.rgba[0][3]).toBe(255)
    h.setVisible(false)
    expect(l.layout.visibility).toBe('none')
    h.setVisible(true)
    expect(calls.load).toBe(1)
    h.setOpacity!(9)
    expect(l.paint['raster-opacity']).toBe(SLOPE_OPACITY.max) // the slope layer's own 10-100 % range (team lead 22:03)
    h.destroy()
    expect(layers.size + sources.size).toBe(0)
    expect(calls.revoked).toEqual(['blob:slope-0'])
  })

  it('a failed load reports the error (never invents a layer) and retries on the next on', async () => {
    const { ctx, layers } = fakeMap()
    let fail = true
    const { deps } = fakeDeps({ loadRaster: async () => (fail ? Promise.reject(new Error('HTTP 404')) : RASTER) })
    const h = installSlopeLayer(ctx, deps)
    setSlopeOn(true)
    await h.settled()
    expect(slopeStatus.peek()).toBe('error')
    expect(slopeError.peek()).toBe('HTTP 404')
    expect(layers.size).toBe(0)
    fail = false
    setSlopeOn(false)
    setSlopeOn(true)
    await h.settled()
    expect(slopeStatus.peek()).toBe('ready')
    expect(slopeError.peek()).toBeNull()
    h.destroy()
  })

  it('finds the slope field key in fields/index.json', () => {
    expect(slopeFieldKey({ fields: { slope: {}, 'nom_104/t_home': {} } })).toBe('slope')
    expect(slopeFieldKey({ fields: { 'shared/slope': {} } })).toBe('shared/slope')
    expect(slopeFieldKey({ fields: { t_home: {} } })).toBeUndefined()
  })
})

describe('replaces wiring', () => {
  it('the spec replaces the built-in slopeClass overlay (which exists in the catalogue)', () => {
    const s = slopeOverlaySpec(fakeDeps().deps)
    expect(s.replaces).toBe('slopeClass')
    expect(REPLACES).toBe('slopeClass')
    expect(OVERLAYS.some((o) => o.id === s.replaces)).toBe(true)
    expect(s.id).toBe(SLOPE_OVERLAY_ID)
    expect(s.titleKey).toBe(SLOPE_TITLE_KEY)
    expect(s.defaultOn).toBe(DEFAULT_ON.slopeClass)
  })

  it('install() registers one overlay + one layers-popover control; the host installs it with the default', async () => {
    const { deps, calls } = fakeDeps()
    const off = install(deps)
    expect(install(deps)).toBe(off) // idempotent: one slope layer only
    expect(mapControlsIn('layers-popover').map((c) => c.id)).toEqual(['l1a-slope'])
    const { ctx } = fakeMap()
    const host = installMapExtensions(ctx)
    const handle = host.overlay(SLOPE_OVERLAY_ID)!
    expect(handle).toBeDefined()
    expect(slopeOn.peek()).toBe(DEFAULT_ON.slopeClass)
    expect(calls.load).toBe(0)
    handle.setVisible(true)
    expect(slopeOn.peek()).toBe(true)
    host.destroy()
    off()
    expect(mapControlsIn('layers-popover')).toEqual([])
  })
})

// ---- control (standalone: nothing renders mapControls until I1) -------------------------------

describe('SlopeControl', () => {
  let root: FakeNode
  beforeEach(() => {
    ;({ container: root } = installDom())
  })
  afterEach(() => act(() => render(null, root as unknown as Element)))

  it('toggle, trust chip, legend with config edges, slider only while on', () => {
    act(() => render(<SlopeControl limits={FIXTURE} />, root as unknown as Element))
    expect(byClass(root, 'hl-chip')).toHaveLength(1)
    expect(byClass(root, 'hl-chip--modelled')).toHaveLength(1)
    const rows = byClass(root, 'hl-legend-row')
    expect(rows.map((r) => r.getAttribute('data-slope-class'))).toEqual([...SLOPE_CLASS_IDS, 'unknown'])
    expect(rows[0].textContent).toContain(copyJson.classes.padFlat)
    expect(rows[0].textContent).toContain('3°')
    expect(rows[2].textContent).toContain('11°')
    expect(rows[4].textContent).toContain('30°')
    expect(rows[0].getAttribute('title')).toContain(FIXTURE.sitingMaxSlopeDeg.source)
    const sw = byClass(rows[1], 'hl-swatch')[0]
    expect(sw.style['--sw']).toBe('var(--hl-slope-walkable)')
    expect(byClass(rows[5], 'hl-swatch--none')).toHaveLength(1)
    expect(root.textContent).toContain('config/site.yaml')
    expect(root.textContent).toContain('fields/shared/slope.png')
    expect(byClass(root, 'hl-slider')).toHaveLength(0)
    act(() => void byClass(root, 'hl-toggle')[0].dispatch('click', {}))
    expect(slopeOn.peek()).toBe(true)
    expect(byClass(root, 'hl-slider')).toHaveLength(1)
  })

  it('shows the error text when the layer could not load', () => {
    slopeError.value = 'HTTP 404'
    act(() => render(<SlopeControl limits={FIXTURE} />, root as unknown as Element))
    expect(byClass(root, 'hl-slope__error')[0].textContent).toContain('HTTP 404')
  })

  it('range text formats config numbers with units', () => {
    const c = slopeClasses(FIXTURE)
    expect(rangeText(c[0])).toBe('under 3°')
    expect(rangeText(c[1])).toBe('3° to 11°')
    expect(rangeText(c[4])).toBe('30° and steeper')
  })
})

describe('copy (route.layers.slope in ui/copy.json)', () => {
  it('title is the seed "Slope"', () => {
    expect(copyJson.title).toBe('Slope')
  })
})
