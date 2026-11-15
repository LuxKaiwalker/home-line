// L13 (team lead Sun 12:54, D111): 3D is the default view in Plan mode; T toggles 2D/3D and the choice
// is remembered (layout store, L1); automatic 2D fallback below 20 fps (D38) with a short dismissible
// note, never during a story (M10d) and never under ?view=3d; ?view=2d|3d forces the view; reduced
// motion = no camera animation; the open pose comes from config/design.yaml plan_view with the route
// in view. Written before the implementation. CPU only (the 3D interactions run in Playwright:
// web/tests/visual/plan-3d.spec.ts).
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Map as MlMap } from 'maplibre-gl'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPO } from '../../hud/testutil'
import { ui } from '../../state'
import { noteFallback, PLAN_VIEW, planView, rememberedView, rememberView, resetPlanView, VIEW_PREF_ID, viewOverride } from '../../state/view'
import { bindLayoutStorage, LAYOUT_KEY, resetLayout, type StorageLike } from '../../ui/layout/store'
import { installShortcuts } from '../../ui/shell/keys'
import { byTag, installDom, type FakeDocument, type FakeNode } from '../../ui/testing/dom'
import { COPY_PENDING, TERRAIN, TERRAIN_PENDING } from './config'
import { FPS_WATCH, setFpsWatchSuspended } from './fps'
import { framePoints, pitchedCamera, type FrameMap } from './frame'
import { TerrainController } from './index'

const design = parse(readFileSync(resolve(REPO, 'config/design.yaml'), 'utf8')) as {
  performance: { fps_3d_min: number }
  terrain_3d: { fallback_window_s: number; max_pitch_deg: number; assumed: string[] }
  plan_view: { default: string; pitch_deg: number; bearing_deg: number; assumed: string[] }
}

class KeyEv extends Event {
  readonly key: string
  readonly ctrlKey = false
  readonly metaKey = false
  readonly altKey = false
  readonly shiftKey = false
  readonly repeat = false
  private readonly tgt: unknown
  constructor(key: string, target: unknown) {
    super('keydown', { cancelable: true })
    this.key = key
    this.tgt = target
  }
  override get target(): EventTarget | null {
    return this.tgt as EventTarget
  }
}

function memStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

const stubLocation = (search: string, hash = '#/'): void => void vi.stubGlobal('location', { search, hash })

beforeEach(() => {
  resetLayout()
  bindLayoutStorage(() => null)
  resetPlanView()
})
afterEach(() => {
  vi.unstubAllGlobals()
  setFpsWatchSuspended(false)
})

// ---- config ----------------------------------------------------------------------------------------------
describe('L13: config/design.yaml', () => {
  it('plan_view.default is 3d; the open pitch and bearing are read from plan_view (assumed), the pitch under the 3D cap', () => {
    expect(design.plan_view.default).toBe('3d')
    expect(PLAN_VIEW).toEqual({ default: '3d', pitch: design.plan_view.pitch_deg, bearing: design.plan_view.bearing_deg })
    expect(design.plan_view.assumed).toEqual(['pitch_deg', 'bearing_deg'])
    expect(PLAN_VIEW.pitch).toBeGreaterThan(0)
    expect(PLAN_VIEW.pitch).toBeLessThanOrEqual(design.terrain_3d.max_pitch_deg)
    expect(PLAN_VIEW.pitch).toBeLessThanOrEqual(55) // MapLibre zero-tile bug above ~62 deg (T1): keep a margin
  })
  it('D38 / team lead 12:54: the automatic 2D fallback is below 20 fps for 3 s', () => {
    expect(design.performance.fps_3d_min).toBe(20)
    expect(TERRAIN.fps3dMin).toBe(20)
    expect(FPS_WATCH.minFps).toBe(20)
    expect(design.terrain_3d.fallback_window_s).toBe(3)
    expect(TERRAIN_PENDING.slowWindowMs).toBe(3000)
  })
})

// ---- view resolution -------------------------------------------------------------------------------------
describe('L13: the view Plan mode opens with (state/view.ts)', () => {
  it.each([
    ['?view=2d', '#/', '2d'],
    ['?intro=0&view=2d', '#/', '2d'],
    ['?view=3d', '#/', '3d'],
    ['', '#/?view=2d', '2d'],
    ['', '#/trade?legacy=1&view=3d', '3d'],
    ['?view=flat', '#/', null],
    ['?intro=0', '#/', null],
    ['', '', null],
  ] as const)('?view= override: search %j hash %j -> %j', (search, hash, want) => {
    expect(viewOverride(search, hash)).toBe(want)
  })

  it('order: URL > this session fell back > the viewer\'s choice > config default (3d)', () => {
    expect(planView('', '#/')).toBe('3d')
    rememberView('2d')
    expect(planView('', '#/')).toBe('2d')
    expect(planView('?view=3d', '#/')).toBe('3d')
    rememberView('3d')
    noteFallback()
    expect(planView('', '#/')).toBe('2d')
    expect(planView('?view=3d', '#/')).toBe('3d')
    expect(rememberedView()).toBe('3d') // the fallback is not the viewer's choice
    rememberView('3d') // the viewer asks for 3D again
    expect(planView('', '#/')).toBe('3d')
  })

  it('remembered per viewer through the layout store (L1): written under its key, read back after a reload', () => {
    const s = memStorage()
    bindLayoutStorage(() => s)
    rememberView('2d')
    expect(JSON.parse(s.data.get(LAYOUT_KEY)!).tabs[VIEW_PREF_ID]).toBe('2d')
    resetLayout() // a new page
    bindLayoutStorage(() => s)
    expect(rememberedView()).toBe('2d')
    expect(planView('', '#/')).toBe('2d')
  })

  it('storage that throws or holds junk: the default holds (3d), nothing breaks', () => {
    bindLayoutStorage(() => {
      throw new Error('blocked')
    })
    rememberView('2d') // in memory for this page
    expect(planView('', '#/')).toBe('2d')
    resetLayout()
    const s = memStorage()
    s.data.set(LAYOUT_KEY, JSON.stringify({ open: {}, tabs: { [VIEW_PREF_ID]: 'sideways' } }))
    bindLayoutStorage(() => s)
    expect(rememberedView()).toBeNull()
    expect(planView('', '#/')).toBe('3d')
  })

  it('a forced view (?view=) is not remembered: a CI or shared URL never overwrites the viewer\'s choice', () => {
    const s = memStorage()
    bindLayoutStorage(() => s)
    stubLocation('?view=2d')
    rememberView('3d')
    expect(s.data.has(LAYOUT_KEY)).toBe(false)
  })

  it('no new storage module: state/view.ts and the terrain code never name browser storage themselves', () => {
    for (const f of ['web/src/state/view.ts', 'web/src/map/terrain/index.ts', 'web/src/map/terrain/state.ts', 'web/src/map/terrain/controls.ts'])
      expect(readFileSync(resolve(REPO, f), 'utf8'), f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
  })
})

// ---- the controller on the Plan map --------------------------------------------------------------------
describe('L13: TerrainController on the Plan map', () => {
  function fakeMap(container: FakeNode) {
    const calls: { name: string; args: unknown[] }[] = []
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
    const rec =
      (name: string) =>
      (...args: unknown[]) =>
        void calls.push({ name, args })
    const handler = { enable: rec('enable'), disable: rec('disable'), enableRotation: rec('enableRotation'), disableRotation: rec('disableRotation') }
    // RR1: a camera that keeps pitch/bearing (clamped to maxPitch like MapLibre); eases land at once,
    // their 'moveend' fires a microtask later
    const camera = { pitch: 0, bearing: 0, maxPitch: 0 }
    const once: (() => void)[] = []
    const move = (name: string) => (o: { pitch?: number; bearing?: number }) => {
      calls.push({ name, args: [o] })
      if (o.pitch !== undefined) camera.pitch = Math.min(o.pitch, camera.maxPitch)
      if (o.bearing !== undefined) camera.bearing = o.bearing
      queueMicrotask(() => once.splice(0).forEach((f) => f()))
    }
    const map = {
      addControl: (c: { onAdd: (m: unknown) => unknown }) => container.appendChild(c.onAdd(map) as FakeNode),
      removeControl: (c: { onRemove: () => void }) => c.onRemove(),
      getContainer: () => container,
      on: (ev: string, f: (...a: unknown[]) => void) => void (handlers[ev] ??= []).push(f),
      off: rec('off'),
      once: (ev: string, f: () => void) => void (ev === 'moveend' && once.push(f)),
      getPitch: () => camera.pitch,
      getBearing: () => camera.bearing,
      stop: rec('stop'),
      getSource: rec('getSource'),
      addSource: rec('addSource'),
      getLayer: rec('getLayer'),
      addLayer: rec('addLayer'),
      setTerrain: rec('setTerrain'),
      setMaxPitch: (p: number) => {
        calls.push({ name: 'setMaxPitch', args: [p] })
        camera.maxPitch = p
        camera.pitch = Math.min(camera.pitch, p)
      },
      setPaintProperty: rec('setPaintProperty'),
      triggerRepaint: rec('triggerRepaint'),
      easeTo: move('easeTo'),
      jumpTo: move('jumpTo'),
      dragRotate: handler,
      touchZoomRotate: handler,
      keyboard: handler,
    }
    return { map: map as unknown as MlMap, calls, camera, render: () => handlers.render?.forEach((f) => f()) }
  }

  let doc: FakeDocument
  let win: EventTarget
  let now = 0
  let fetched: string[]
  beforeEach(() => {
    ui.view.value = '2d'
    ui.mode.value = 'plan'
    ui.reducedMotion.value = false
    doc = installDom().document
    const make = doc.createElement.bind(doc)
    doc.createElement = (name: string) => Object.assign(make(name), name === 'canvas' ? { getContext: () => ({}) } : {})
    win = new EventTarget()
    vi.stubGlobal('window', win)
    stubLocation('?intro=0')
    fetched = []
    const tilesJson = readFileSync(resolve(REPO, 'web/src/map/terrain/fixtures/terrain/tiles.json'), 'utf8')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        fetched.push(String(u))
        return String(u).includes('terrain/tiles.json') ? new Response(tilesJson, { headers: { 'content-type': 'application/json' } }) : new Response('', { status: 404 })
      }),
    )
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    ui.reducedMotion.value = false
    ui.view.value = '2d'
    vi.restoreAllMocks()
  })

  const mount = (opts: { planView?: boolean } = { planView: true }) => {
    const container = doc.createElement('div')
    doc.body.appendChild(container)
    const fm = fakeMap(container)
    const frames: boolean[] = []
    const ctl = new TerrainController(fm.map, 'iso-fill', opts.planView ? { planView: true, frame: (a) => void frames.push(a) } : {})
    return { container, ...fm, ctl, frames }
  }
  const moves = (calls: { name: string }[]) => calls.filter((c) => c.name === 'easeTo' || c.name === 'jumpTo').map((c) => c.name)
  /** Render at `fps` for `forMs` (performance.now advances with the frames). */
  const framesAt = (render: () => void, fps: number, forMs: number): void => {
    const end = now + forMs
    for (; now <= end; now += 1000 / fps) render()
  }
  const hidden = (n: FakeNode): boolean => (n as unknown as { hidden: boolean }).hidden
  const notice = (container: FakeNode): FakeNode => byTag(container, 'div').find((n) => n.getAttribute('class') === 'hl-terrain-notice' || (n as unknown as { className: string }).className === 'hl-terrain-notice')!

  it('opens in 3D by default: no tilt animation on the opening, then the open pose with the route framed', async () => {
    const { container, calls, ctl, frames } = mount()
    expect(ui.view.value).toBe('3d')
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    expect(moves(calls)).toEqual(['jumpTo'])
    expect(frames).toEqual([false])
    expect(ctl.is3d).toBe(true)
    ctl.destroy()
  })

  it('without planView (fly/legacy maps, the existing callers) nothing changes: stays 2D', async () => {
    const { container, ctl, frames } = mount({ planView: false })
    expect(ui.view.value).toBe('2d')
    await Promise.resolve()
    expect(container.getAttribute('data-terrain')).toBe('off')
    expect(frames).toEqual([])
    ctl.destroy()
  })

  it('?view=2d forces 2D: no 3D code or tiles requested', async () => {
    stubLocation('?intro=0&view=2d')
    const { container, ctl } = mount()
    expect(ui.view.value).toBe('2d')
    await new Promise((r) => setTimeout(r, 10))
    expect(container.getAttribute('data-terrain')).toBe('off')
    expect(fetched.filter((u) => u.includes('terrain'))).toEqual([])
    ctl.destroy()
  })

  it('the remembered 2D choice opens in 2D', async () => {
    rememberView('2d')
    const { container, ctl } = mount()
    expect(ui.view.value).toBe('2d')
    await Promise.resolve()
    expect(container.getAttribute('data-terrain')).toBe('off')
    ctl.destroy()
  })

  it('T toggles 2D/3D and the choice is remembered; reduced motion: no camera animation either way', async () => {
    ui.reducedMotion.value = true
    const { container, calls, ctl } = mount()
    const uninstall = installShortcuts(win as Window, () => undefined)
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    win.dispatchEvent(new KeyEv('t', doc.body))
    expect(ui.view.value).toBe('2d')
    expect(rememberedView()).toBe('2d')
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('flat'))
    win.dispatchEvent(new KeyEv('t', doc.body))
    expect(rememberedView()).toBe('3d')
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    expect(moves(calls).every((m) => m === 'jumpTo')).toBe(true)
    expect(moves(calls).length).toBe(3)
    uninstall()
    ctl.destroy()
  })

  it('the 2D/3D buttons remember the choice too', async () => {
    const { container, ctl } = mount()
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    byTag(container, 'button')[0].dispatch('click') // 2D
    expect(ui.view.value).toBe('2d')
    expect(rememberedView()).toBe('2d')
    ctl.destroy()
  })

  it('below 20 fps for 3 s: 2D with the short dismissible note, not remembered as the choice; dismiss hides it; T retries 3D', async () => {
    const { container, render, ctl } = mount()
    const uninstall = installShortcuts(win as Window, () => undefined)
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    framesAt(render, 25, 5000) // 25 fps: above the D38 threshold, stays 3D
    expect(container.getAttribute('data-terrain')).toBe('3d')
    framesAt(render, 15, 3600)
    await vi.waitFor(() => expect(container.getAttribute('data-terrain-fallback')).toBe('slow3d'))
    expect(ui.view.value).toBe('2d')
    const n = notice(container)
    expect(hidden(n)).toBe(false)
    expect(COPY_PENDING.slow3dNote).toBe('Switched to 2D: low frame rate · T to try 3D')
    expect((n as unknown as { title: string }).title).toBe(COPY_PENDING.slow3dNote) // the fake DOM keeps no textContent; title = the text
    expect(n.getAttribute('data-dismissible')).toBe('true')
    expect(rememberedView()).toBeNull() // automatic, not the viewer's choice
    expect(planView()).toBe('2d') // this session: later mounts open flat
    const close = byTag(n, 'button')[0]
    expect(hidden(close)).toBe(false)
    expect(close.getAttribute('aria-label')).toBeTruthy()
    close.dispatch('click')
    expect(hidden(n)).toBe(true)
    win.dispatchEvent(new KeyEv('t', doc.body)) // "T to try 3D"
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    expect(rememberedView()).toBe('3d')
    expect(planView()).toBe('3d')
    uninstall()
    ctl.destroy()
  })

  it('RR1: the fallback with the camera tilted 60° and turned 16° cuts to pitch 0 / bearing 0 (moves stopped, tilt locked); T restores the 3D camera; T again: pitch 0, bearing 0', async () => {
    const { container, render, ctl, camera, calls, map } = mount()
    const uninstall = installShortcuts(win as Window, () => undefined)
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    map.jumpTo({ pitch: 60, bearing: 16 }) // preset 3 and a rotate, say
    expect(camera).toMatchObject({ pitch: 60, bearing: 16 })
    framesAt(render, 10, 3600)
    await vi.waitFor(() => expect(container.getAttribute('data-terrain-fallback')).toBe('slow3d'))
    expect(calls.some((c) => c.name === 'stop')).toBe(true)
    expect(camera).toEqual({ pitch: 0, bearing: 0, maxPitch: 0 })
    win.dispatchEvent(new KeyEv('t', doc.body)) // "T to try 3D"
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    expect(camera.pitch).toBe(TERRAIN.pitch3d)
    expect(camera.maxPitch).toBe(TERRAIN.maxPitch3d)
    map.jumpTo({ pitch: 55, bearing: 16 })
    win.dispatchEvent(new KeyEv('t', doc.body))
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('flat'))
    await vi.waitFor(() => expect(camera).toEqual({ pitch: 0, bearing: 0, maxPitch: 0 }))
    uninstall()
    ctl.destroy()
  })

  it('RR1: 2D asked for while the map is already flat but something left it turned: back to north up, untilted', async () => {
    stubLocation('?intro=0&view=2d')
    const { ctl, camera, map } = mount()
    map.jumpTo({ bearing: 16 })
    ui.view.value = '3d'
    ui.view.value = '2d'
    await vi.waitFor(() => expect(camera).toEqual({ pitch: 0, bearing: 0, maxPitch: 0 }))
    ctl.destroy()
  })

  it('no fallback during a story (M10d)', async () => {
    const { container, render, ctl } = mount()
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    setFpsWatchSuspended(true)
    framesAt(render, 5, 10000)
    expect(container.getAttribute('data-terrain')).toBe('3d')
    expect(container.getAttribute('data-terrain-fallback')).toBeNull()
    ctl.destroy()
  })

  it('?view=3d forces 3D: no automatic fallback', async () => {
    stubLocation('?intro=0&view=3d')
    rememberView('2d')
    const { container, render, ctl } = mount()
    expect(ui.view.value).toBe('3d')
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    framesAt(render, 5, 10000)
    expect(container.getAttribute('data-terrain')).toBe('3d')
    ctl.destroy()
  })

  it('end-of-intro hook openPlanView(): back to the default view; in 3D already, only the pose/framing (eased unless reduced)', async () => {
    const { container, ctl, frames } = mount()
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('3d'))
    ctl.openPlanView({ animate: true })
    expect(frames).toEqual([false, true])
    ui.reducedMotion.value = true
    ctl.openPlanView({ animate: true })
    expect(frames).toEqual([false, true, false])
    ui.reducedMotion.value = false
    ui.view.value = '2d' // e.g. a story ended flat
    await vi.waitFor(() => expect(container.getAttribute('data-terrain')).toBe('flat'))
    ctl.openPlanView({ animate: false })
    expect(ui.view.value).toBe('3d')
    await vi.waitFor(() => expect(frames.length).toBe(4))
    expect(frames[3]).toBe(false)
    ctl.destroy()
  })
})

// ---- framing ----------------------------------------------------------------------------------------------
describe('L13: the open pose frames the box at the tilt (map/terrain/frame.ts)', () => {
  /** A flat-earth stand-in: x/y in px scale with 2^zoom; tilt stretches the near (south) half by 1.6. */
  function fakeFrameMap(): FrameMap & { cam: { center: [number, number]; zoom: number; pitch: number; bearing: number } } {
    const cam = { center: [0, 0] as [number, number], zoom: 10, pitch: 0, bearing: 0 }
    const W = 1000
    const H = 600
    return {
      cam,
      cameraForBounds: (b) => ({ center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], zoom: Math.log2(Math.min((W - 100) / (b[1][0] - b[0][0]), (H - 100) / (b[1][1] - b[0][1]))) }),
      jumpTo: (o) => Object.assign(cam, o),
      easeTo: (o) => Object.assign(cam, o),
      project: ([x, y]) => {
        const s = 2 ** cam.zoom
        const dy = (cam.center[1] - y) * s
        return { x: W / 2 + (x - cam.center[0]) * s, y: H / 2 + (cam.pitch > 0 && dy > 0 ? dy * 1.6 : dy) }
      },
      getCanvas: () => ({ clientWidth: W, clientHeight: H }),
      getCenter: () => ({ lng: cam.center[0], lat: cam.center[1] }),
      getZoom: () => cam.zoom,
      getPitch: () => cam.pitch,
      getBearing: () => cam.bearing,
    }
  }

  it('flat: the plain fit; tilted: zooms out until every corner and edge midpoint is inside the padding; the probe leaves the camera as it was', () => {
    const m = fakeFrameMap()
    const box: [number, number, number, number] = [-1, -1, 1, 1]
    const flat = pitchedCamera(m, box, { pitch: 0, bearing: 0 }, 50)!
    expect(flat.zoom).toBeCloseTo(Math.log2(250))
    expect(m.cam.zoom).toBe(10) // probe restored
    const tilted = pitchedCamera(m, box, { pitch: 45, bearing: 0 }, 50)!
    expect(tilted.zoom).toBeLessThan(flat.zoom)
    expect(tilted).toMatchObject({ pitch: 45, bearing: 0 })
    m.jumpTo(tilted)
    for (const p of framePoints(box)) {
      const q = m.project(p)
      expect(q.y).toBeLessThanOrEqual(600 - 50 + 0.5)
      expect(q.y).toBeGreaterThanOrEqual(50 - 0.5)
    }
  })
})
