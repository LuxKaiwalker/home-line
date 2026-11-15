// PORT P2 known answers for the pad layer (through the real extension host, a fake map):
//  - one marker per pad of the index (official + P2–P4), short labels, at the pad positions;
//  - a marker click opens the pad card (layout store) for that pad and does not reach the map;
//  - setPadEnvironment(pad): marker "is-loading" until the lazy products arrive, then the pad's products
//    are drawn; null restores the official plan; a late answer for an older pad is dropped;
//  - planning.setPad -> the env reaches the map (cached at once; else loading first); failing load = error,
//    the map keeps the previous plan; dispose removes markers and restores the sources.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installMapExtensions, registerPadEnvironment, resetMapExtensions, type MapExtensionContext } from '../extensions'
import { setPadService } from '../../pads'
import { createMockPadService, MOCK_PADS } from '../../pads/mock'
import { OFFICIAL_PAD_ID, type PadEnv, type PlanProducts } from '../../pads/types'
import { createPlanningStore } from '../../state/planning'
import { installDom, type FakeNode } from '../../ui/testing/dom'
import { isOpen, resetLayout } from '../../ui/layout'
import { createPadEnvironmentHandler, PAD_CARD_ID, padLayer } from './padLayer'
import { syncPadEnvironment } from './sync'
import { fakeSwapMap } from './fakes'

const tick = () => new Promise((r) => setTimeout(r, 0))

function fakeCtx() {
  const f = fakeSwapMap()
  const placed: { el: FakeNode; at: [number, number] | null; removed: boolean }[] = []
  const map = { ...f.map, on: () => {}, off: () => {}, getCanvas: () => ({ style: {} }), project: () => ({ x: 0, y: 0 }) }
  const ctx = {
    map,
    beforeId: () => undefined,
    inShell: true,
    marker(el: FakeNode) {
      const rec = { el, at: null as [number, number] | null, removed: false }
      placed.push(rec)
      const m = {
        setLngLat: (ll: [number, number]) => ((rec.at = ll), m),
        addTo: () => m,
        remove: () => void (rec.removed = true),
      }
      return m
    },
  } as unknown as MapExtensionContext
  return { ctx, f, placed }
}

let restore: () => void
beforeEach(() => {
  installDom()
  resetLayout()
})
afterEach(() => {
  restore?.()
  resetMapExtensions()
  padLayer.card.value = null
})

const prods = (tag: string): PlanProducts => ({ bands: { type: 'FeatureCollection', features: [], tag } as never, edges: { type: 'FeatureCollection', features: [] }, partner: null, route: null, timeline: null })

describe('pad layer', () => {
  it('draws a labelled marker per pad; a click opens that pad card', async () => {
    restore = setPadService(createMockPadService())
    registerPadEnvironment(createPadEnvironmentHandler({ fadeMs: () => 0 }))
    const { ctx, placed } = fakeCtx()
    const host = installMapExtensions(ctx)
    await tick()
    expect(placed.map((p) => p.el.textContent)).toEqual(['Official pad', 'P2', 'P3', 'P4'])
    expect(placed.map((p) => p.at)).toEqual(MOCK_PADS.map((p) => [p.lon, p.lat]))
    expect(placed[0].el.getAttribute('class')).toContain('hl-padmark--official')
    expect(placed[0].el.getAttribute('class')).toContain('is-active') // the official plan is on the map
    const ev = placed[2].el.dispatch('click')
    expect(padLayer.card.peek()).toBe('rank3')
    expect(isOpen(PAD_CARD_ID)).toBe(true)
    expect(ev.defaultPrevented).toBe(false)
    host.destroy()
    expect(placed.every((p) => p.removed)).toBe(true)
  })

  it('swaps to the pad products with a loading state, back to official; drops stale answers', async () => {
    let release!: (p: PlanProducts) => void
    const svc = createMockPadService({ products: (id) => prods(id) })
    restore = setPadService(svc)
    registerPadEnvironment(createPadEnvironmentHandler({ fadeMs: () => 0 }))
    const { ctx, f, placed } = fakeCtx()
    const host = installMapExtensions(ctx)
    await tick()
    ;(f.sources.bands as unknown as { setData(d: unknown): void }).setData({ tag: 'official' })

    const slow: PadEnv = { ...(await svc.loadPadEnv('rank2')), planProducts: () => new Promise((r) => (release = r)) }
    host.setPadEnvironment(slow)
    expect(padLayer.shown.peek()).toEqual({ id: 'rank2', status: 'loading' })
    expect(placed[1].el.getAttribute('class')).toContain('is-loading')
    expect(f.drawn.bands).toEqual({ tag: 'official' }) // never blank: the previous plan stays

    host.setPadEnvironment(await svc.loadPadEnv('rank4'))
    await tick()
    expect((f.drawn.bands as { tag: string }).tag).toBe('rank4')
    release(prods('rank2'))
    await tick()
    expect((f.drawn.bands as { tag: string }).tag).toBe('rank4') // the late rank2 answer is dropped
    expect(padLayer.shown.peek()).toEqual({ id: 'rank4', status: 'ready' })
    expect(placed[3].el.getAttribute('class')).toContain('is-active')

    host.setPadEnvironment(null)
    expect(f.drawn.bands).toEqual({ tag: 'official' })
    expect(padLayer.shown.peek().id).toBe(OFFICIAL_PAD_ID)
    host.destroy()
  })

  it('follows planning.setPad: loading first, then the env; official = null; failure keeps the map', async () => {
    const svc = createMockPadService({ delayMs: 5, failing: ['rank3'] })
    restore = setPadService(svc)
    const store = createPlanningStore()
    const got: (string | null)[] = []
    const stop = syncPadEnvironment({ setPadEnvironment: (e) => got.push(e?.info.id ?? null) }, store)
    expect(got).toEqual([null]) // opens on the official pad
    store.setPad('rank2')
    expect(padLayer.shown.peek()).toEqual({ id: 'rank2', status: 'loading' })
    await new Promise((r) => setTimeout(r, 20))
    expect(got).toEqual([null, 'rank2'])
    store.setPad(OFFICIAL_PAD_ID)
    store.setPad('rank2') // cached now: at once
    expect(got).toEqual([null, 'rank2', null, 'rank2'])
    store.setPad('rank3')
    await new Promise((r) => setTimeout(r, 20))
    expect(got).toEqual([null, 'rank2', null, 'rank2'])
    expect(padLayer.shown.peek()).toEqual({ id: 'rank3', status: 'error' })
    stop()
  })
})
