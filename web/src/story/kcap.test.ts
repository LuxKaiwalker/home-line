// Kcap: capture readiness (notes/Kcap.md). A capture frame is "drawn" once the map has rendered the
// new state with its style and in-view tiles loaded. map.loaded() cannot say that: the station pulse
// (map furniture) sets a paint property on every animation frame, so the map's style and sources stay
// flagged dirty and loaded() never holds; settle() then ran into its cap on every frame.
/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('maplibre-gl', () => ({
  Marker: class {
    setLngLat() {
      return this
    }
    addTo() {
      return this
    }
    remove() {}
  },
  LngLat: class {
    lng: number
    lat: number
    constructor(lng: number, lat: number) {
      this.lng = lng
      this.lat = lat
    }
  },
}))

/** A map that renders on every repaint request and, like the real one under the pulse, never reports loaded(). */
function fakeMap(o: { tilesAfter: number; terrain?: string }) {
  const handlers = new Set<() => void>()
  const once = new Set<() => void>()
  let renders = 0
  const attrs: Record<string, string> = { 'data-terrain': o.terrain ?? '3d' }
  const map = {
    renders: () => renders,
    setTerrain: (v: string) => void (attrs['data-terrain'] = v),
    loaded: () => false,
    isStyleLoaded: () => true,
    areTilesLoaded: () => renders >= o.tilesAfter,
    getContainer: () => ({ getAttribute: (k: string) => attrs[k] ?? null }),
    on: (_e: string, f: () => void) => void handlers.add(f),
    off: (_e: string, f: () => void) => {
      handlers.delete(f)
      once.delete(f)
    },
    once: (_e: string, f: () => void) => void once.add(f),
    triggerRepaint: () =>
      void setTimeout(() => {
        renders++
        const fs = [...handlers, ...once]
        once.clear()
        for (const h of fs) h()
      }, 1),
  }
  return map
}

describe('capture settle (Kcap)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(0), 1))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('settled() reads the style, the in-view tiles and the terrain, not the dirty flags of map.loaded()', async () => {
    const { settled } = await import('./attach')
    const m = (s: boolean, t: boolean, terrain: string) => ({ isStyleLoaded: () => s, areTilesLoaded: () => t, getContainer: () => ({ getAttribute: () => terrain }) }) as never
    expect(settled(m(true, true, '3d'))).toBe(true)
    expect(settled(m(true, true, 'off'))).toBe(true)
    expect(settled(m(false, true, '3d'))).toBe(false)
    expect(settled(m(true, false, '3d'))).toBe(false)
    expect(settled(m(true, true, 'loading'))).toBe(false)
  })

  it('a frame settles once its tiles are in, although the pulse keeps map.loaded() false', async () => {
    const { settle, SETTLE_MAX_RENDERS } = await import('./attach')
    const map = fakeMap({ tilesAfter: 3 })
    await settle({ map: map as never, pending: Promise.resolve() })
    expect(map.renders()).toBeGreaterThanOrEqual(3)
    expect(map.renders()).toBeLessThan(10)
    expect(SETTLE_MAX_RENDERS).toBeGreaterThan(10)
  })

  it('it waits for at least one render after the state was applied', async () => {
    const { settle } = await import('./attach')
    const map = fakeMap({ tilesAfter: 0 })
    await settle({ map: map as never, pending: Promise.resolve() })
    expect(map.renders()).toBeGreaterThanOrEqual(1)
  })

  it('a loading terrain holds the frame until it has loaded', async () => {
    const { settle } = await import('./attach')
    const map = fakeMap({ tilesAfter: 0, terrain: 'loading' })
    const t = settle({ map: map as never, pending: Promise.resolve() })
    // never resolves early: still pending after many renders
    let done = false
    void t.then(() => (done = true))
    await new Promise((r) => setTimeout(r, 60))
    expect(done).toBe(false)
    expect(map.renders()).toBeGreaterThan(5)
    map.setTerrain('3d')
    await t
    expect(done).toBe(true)
  }, 2000)
})

describe('story caption (Kcap)', () => {
  const html = { dataset: {} as Record<string, string> }
  const made: { className: string; hidden: boolean; textContent: string }[] = []
  const el = () => {
    const e = { className: '', hidden: false, textContent: '', style: {} as Record<string, string>, setAttribute() {}, remove() {}, append() {} }
    made.push(e)
    return e
  }
  beforeEach(() => {
    made.length = 0
    ;(globalThis as { document?: unknown }).document = { documentElement: html, createElement: el }
  })
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document
  })

  it('stays hidden in a storyboard without captions (no empty caption card on the flythrough frames)', async () => {
    const { StoryStage } = await import('./stage')
    const map = { getCenter: () => ({ lng: 137.4, lat: -4.8 }), getZoom: () => 13, getBearing: () => 0, getPitch: () => 0, getContainer: () => el(), getCanvasContainer: () => el(), jumpTo: vi.fn(), easeTo: vi.fn() }
    const cmap = { map, layerVisible: () => true, setVisible: () => undefined, setStoryPaused: () => undefined }
    const stage = new StoryStage(cmap as never, 'hidden')
    const caption = made.find((e) => e.className === 'hl-story-caption')
    expect(caption?.hidden).toBe(true)
    stage.apply({ t: 10, camera: null, layers: {}, field: {}, clock: null, selection: undefined, caption: undefined, captionAge: 10, ui: 'hide', uiAge: 10, done: false })
    expect(caption?.hidden).toBe(true)
    expect(caption?.textContent).toBe('')
    stage.restore(false)
  })
})
