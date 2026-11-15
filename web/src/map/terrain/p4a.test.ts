// P4a (user: "a default tilt in the map at the beginning"): the app starts tilted. In 3D the first view
// on the Plan map and on the Mission Planer (the landing page, D132) is at the default tilt,
// config/design.yaml plan_view.pitch_deg: on the first load, on a reload, and after the intro whether
// it played out or was skipped. 2D (?view=2d, the viewer's 2D choice) stays at pitch 0. Reduced motion:
// still tilted, only without the ease. CPU only (a fake map that keeps pitch/bearing and clamps to
// maxPitch like MapLibre); the real camera is RR's to judge.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Map as MlMap } from 'maplibre-gl'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPO } from '../../hud/testutil'
import { ui } from '../../state'
import { openPose, PLAN_VIEW, rememberView, resetPlanView } from '../../state/view'
import { introLanding } from '../../story/attach'
import { bindLayoutStorage, resetLayout } from '../../ui/layout/store'
import { installDom, type FakeDocument, type FakeNode } from '../../ui/testing/dom'
import { TERRAIN } from './config'
import { setFpsWatchSuspended } from './fps'
import { TerrainController } from './index'

const design = parse(readFileSync(resolve(REPO, 'config/design.yaml'), 'utf8')) as {
  plan_view: { pitch_deg: number; bearing_deg: number }
  terrain_3d: { max_pitch_deg: number }
  camera: { flythrough: { max_pitch_deg: number } }
}

describe('P4a: the default tilt is a named design setting (config/design.yaml plan_view.pitch_deg)', () => {
  it('a real tilt (40-50 deg), under the 3D tilt cap and the flythrough cap (MapLibre draws no tiles above ~62 deg)', () => {
    expect(PLAN_VIEW.pitch).toBe(design.plan_view.pitch_deg)
    expect(PLAN_VIEW.pitch).toBeGreaterThanOrEqual(40)
    expect(PLAN_VIEW.pitch).toBeLessThanOrEqual(50)
    expect(PLAN_VIEW.pitch).toBeLessThanOrEqual(design.terrain_3d.max_pitch_deg)
    expect(PLAN_VIEW.pitch).toBeLessThanOrEqual(design.camera.flythrough.max_pitch_deg)
  })
  it('openPose: 3D at the default tilt and bearing, 2D flat and north up', () => {
    expect(openPose()).toEqual({ pitch: design.plan_view.pitch_deg, bearing: design.plan_view.bearing_deg })
    expect(openPose('3d')).toEqual({ pitch: PLAN_VIEW.pitch, bearing: PLAN_VIEW.bearing })
    expect(openPose('2d')).toEqual({ pitch: 0, bearing: 0 })
  })
})

describe('P4a: after the intro Plan lands at its default view, played out (eased) or skipped (at once)', () => {
  it('intro: ended -> eased, skipped / failed -> no animation; other stories restore their own camera', () => {
    expect(introLanding('intro', 'end')).toEqual({ animate: true })
    expect(introLanding('intro', 'cancel')).toEqual({ animate: false })
    expect(introLanding('demo', 'end')).toBeNull()
    expect(introLanding('demo', 'cancel')).toBeNull()
    expect(introLanding('capture', 'end')).toBeNull()
  })
})

describe('P4a: the camera the app opens with (TerrainController)', () => {
  function fakeMap(container: FakeNode) {
    const calls: { name: string; args: unknown[] }[] = []
    const rec =
      (name: string) =>
      (...args: unknown[]) =>
        void calls.push({ name, args })
    const handler = { enable: rec('enable'), disable: rec('disable'), enableRotation: rec('enableRotation'), disableRotation: rec('disableRotation') }
    // like MapLibre: maxPitch 0 until 3D lifts it (the map constructors), the pitch clamped to it
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
      on: rec('on'),
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
    return { map: map as unknown as MlMap, calls, camera }
  }

  let doc: FakeDocument
  const html = { dataset: {} as Record<string, string> }
  const stubLocation = (search: string, hash = '#/'): void => void vi.stubGlobal('location', { search, hash })
  beforeEach(() => {
    resetLayout()
    bindLayoutStorage(() => null)
    resetPlanView()
    ui.view.value = '2d'
    ui.mode.value = 'plan'
    ui.reducedMotion.value = false
    doc = installDom().document
    const make = doc.createElement.bind(doc)
    doc.createElement = (name: string) => Object.assign(make(name), name === 'canvas' ? { getContext: () => ({}) } : {})
    html.dataset = {}
    Object.assign(doc, { documentElement: html }) // StoryStage sets html[data-story] while a story plays
    vi.stubGlobal('window', new EventTarget())
    stubLocation('?intro=0')
    const tilesJson = readFileSync(resolve(REPO, 'web/src/map/terrain/fixtures/terrain/tiles.json'), 'utf8')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => (String(u).includes('terrain/tiles.json') ? new Response(tilesJson, { headers: { 'content-type': 'application/json' } }) : new Response('', { status: 404 }))),
    )
  })
  afterEach(() => {
    ui.reducedMotion.value = false
    ui.view.value = '2d'
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setFpsWatchSuspended(false)
  })

  /**
   * 'plan': the Plan map, its framing as ConsoleMap.frameRoute does it with no route box yet (the open
   * pose where the camera is); 'mission': the Mission Planer, no framing of its own (the controller's).
   */
  const mount = (which: 'plan' | 'mission') => {
    const container = doc.createElement('div')
    doc.body.appendChild(container)
    const fm = fakeMap(container)
    const frames: boolean[] = []
    const frame = (animate: boolean): void => {
      frames.push(animate)
      const pose = openPose('3d')
      if (animate) fm.map.easeTo({ ...pose, duration: 1 })
      else fm.map.jumpTo(pose)
    }
    const ctl = new TerrainController(fm.map, 'iso-fill', which === 'plan' ? { planView: true, frame } : { planView: true, position: 'bottom-right' })
    return { container, ...fm, ctl, frames }
  }
  const moves = (calls: { name: string }[]) => calls.filter((c) => c.name === 'easeTo' || c.name === 'jumpTo').map((c) => c.name)
  const terrain = (c: FakeNode) => c.getAttribute('data-terrain')

  it.each(['plan', 'mission'] as const)('%s: the first load opens in 3D at the default tilt, jumped to (no ease a later camera fit could cut short)', async (which) => {
    const { container, calls, camera, ctl } = mount(which)
    expect(camera.pitch).toBe(0) // the map is built flat (maxPitch 0)
    await vi.waitFor(() => expect(terrain(container)).toBe('3d'))
    expect(camera.pitch).toBe(PLAN_VIEW.pitch)
    expect(camera.pitch).toBeGreaterThan(0)
    expect(camera.bearing).toBe(PLAN_VIEW.bearing)
    expect(moves(calls).every((m) => m === 'jumpTo')).toBe(true)
    ctl.destroy()
  })

  it.each(['plan', 'mission'] as const)('%s: ?view=2d stays at pitch 0 with the tilt locked; so does the viewer\'s 2D choice', async (which) => {
    stubLocation('?intro=0&view=2d')
    const a = mount(which)
    await new Promise((r) => setTimeout(r, 10))
    expect(ui.view.value).toBe('2d')
    expect(terrain(a.container)).toBe('off')
    expect(a.camera).toEqual({ pitch: 0, bearing: 0, maxPitch: 0 })
    a.ctl.destroy()
    stubLocation('?intro=0')
    rememberView('2d')
    const b = mount(which)
    await new Promise((r) => setTimeout(r, 10))
    expect(terrain(b.container)).toBe('off')
    expect(b.camera).toEqual({ pitch: 0, bearing: 0, maxPitch: 0 })
    b.ctl.destroy()
  })

  it.each(['plan', 'mission'] as const)('%s: reduced motion: still tilted, without animation', async (which) => {
    ui.reducedMotion.value = true
    const { container, calls, camera, ctl } = mount(which)
    await vi.waitFor(() => expect(terrain(container)).toBe('3d'))
    expect(camera.pitch).toBe(PLAN_VIEW.pitch)
    expect(moves(calls).every((m) => m === 'jumpTo')).toBe(true)
    ctl.openPlanView({ animate: true }) // the end-of-intro hook: no ease under reduced motion either
    expect(camera.pitch).toBe(PLAN_VIEW.pitch)
    expect(moves(calls).every((m) => m === 'jumpTo')).toBe(true)
    ctl.destroy()
  })

  it('a skipped intro: the story restored its flat start camera; the default view puts the tilt back at once', async () => {
    html.dataset.story = 'on' // the intro owns the camera: no opening pose under it
    const { container, ctl, camera, frames, map } = mount('plan')
    await vi.waitFor(() => expect(terrain(container)).toBe('3d'))
    expect(frames).toEqual([])
    map.jumpTo({ pitch: 0, bearing: 0 }) // StoryStage.restore(false): the camera saved before 3D had loaded
    delete html.dataset.story
    ctl.openPlanView(introLanding('intro', 'cancel')!)
    expect(frames).toEqual([false])
    expect(camera.pitch).toBe(PLAN_VIEW.pitch)
    ctl.destroy()
  })

  it('the default view asked for while the 3D terrain is still loading is applied once it is on, and used up', async () => {
    html.dataset.story = 'on'
    const { container, ctl, camera, frames, calls } = mount('plan')
    await vi.waitFor(() => expect(terrain(container)).toBe('3d'))
    ui.view.value = '2d' // the story ended flat
    await vi.waitFor(() => expect(terrain(container)).toBe('flat'))
    delete html.dataset.story
    ui.view.value = '3d' // StoryStage.restore(): back to the saved view, the terrain switching on
    expect(terrain(container)).toBe('loading')
    ctl.openPlanView({ animate: true }) // the end-of-intro hook, before the terrain is on
    await vi.waitFor(() => expect(terrain(container)).toBe('3d'))
    expect(frames).toEqual([true])
    expect(camera.pitch).toBe(PLAN_VIEW.pitch)
    // used up: a later 2D -> 3D switch is an ordinary one (eased tilt, no reframing)
    ui.view.value = '2d'
    await vi.waitFor(() => expect(camera).toEqual({ pitch: 0, bearing: 0, maxPitch: 0 }))
    const n = calls.length
    ui.view.value = '3d'
    await vi.waitFor(() => expect(terrain(container)).toBe('3d'))
    expect(frames).toEqual([true])
    expect(moves(calls.slice(n))).toEqual(['easeTo'])
    expect(camera.pitch).toBe(TERRAIN.pitch3d)
    ctl.destroy()
  })
})
