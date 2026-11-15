// PORT P2 known answers for the env swap:
//  - a pad's products go into ConsoleMap's own sources (bands, edges, partner cart-only, route; iso empty),
//    the GPU field is hidden and the polygon bands shown;
//  - ConsoleMap's setData while a pad is shown is held (recorded, not drawn); the official pad restores
//    ConsoleMap's LATEST data and the GPU field;
//  - fade: opacity 0 at once, then the layer's own opacity with a transition of fadeMs; 0 ms = no paint calls;
//  - dispose restores and unhooks the sources.
import { describe, expect, it } from 'vitest'
import type { PlanProducts } from '../../pads/types'
import { createEnvSwap, FIELD_LAYER } from './swap'
import { fakeSwapMap } from './fakes'

const fc = (tag: string) => ({ type: 'FeatureCollection', features: [], tag }) as never

const products = (tag: string): PlanProducts => ({
  bands: fc(`${tag}-bands`),
  edges: fc(`${tag}-edges`),
  partner: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { case: 'drag' }, geometry: null }, { type: 'Feature', properties: { case: 'cart' }, geometry: null }] } as never,
  route: fc(`${tag}-route`),
  timeline: null,
})

describe('env swap', () => {
  it('draws a pad, holds ConsoleMap updates, restores the latest official data', () => {
    const f = fakeSwapMap()
    const s = createEnvSwap(f.map, { fadeMs: () => 0 })
    // ConsoleMap loads the official plan (through the hooked sources)
    ;(f.sources.bands as unknown as { setData(d: unknown): void }).setData(fc('off-bands'))
    ;(f.sources.iso as unknown as { setData(d: unknown): void }).setData(fc('off-iso'))
    expect(f.drawn.bands).toEqual(fc('off-bands'))

    s.show(products('p2'))
    expect(s.active).toBe(true)
    expect(f.drawn.bands).toEqual(fc('p2-bands'))
    expect(f.drawn.edges).toEqual(fc('p2-edges'))
    expect(f.drawn.route).toEqual(fc('p2-route'))
    expect((f.drawn.iso as { features: unknown[] }).features).toEqual([])
    // D20: the drag line is never drawn
    expect((f.drawn.partner as { features: { properties: { case: string } }[] }).features.map((x) => x.properties.case)).toEqual(['cart'])
    expect(f.layout[`${FIELD_LAYER}|visibility`]).toBe('none')
    expect(f.layout['band-opt|visibility']).toBe('visible')

    // a scenario change arrives while P2 is shown: not drawn, kept as the official data
    ;(f.sources.bands as unknown as { setData(d: unknown): void }).setData(fc('off2-bands'))
    expect(f.drawn.bands).toEqual(fc('p2-bands'))

    s.show(null)
    expect(s.active).toBe(false)
    expect(f.drawn.bands).toEqual(fc('off2-bands'))
    expect(f.drawn.iso).toEqual(fc('off-iso'))
    expect(f.layout[`${FIELD_LAYER}|visibility`]).toBe('visible')
    expect(f.layout['band-opt|visibility']).toBe('none')
  })

  it('fades the swapped layers in from 0 to their own opacity', () => {
    const f = fakeSwapMap()
    const s = createEnvSwap(f.map, { fadeMs: () => 300 })
    s.show(products('p3'))
    expect(f.calls).toContain('band-opt|fill-opacity=0')
    expect(f.calls).toContain('band-opt|fill-opacity-transition={"duration":300,"delay":0}')
    expect(f.paint['band-opt|fill-opacity']).toBe(0.35)
    expect(f.paint['edges-line|line-opacity']).toBe(1)
    const g = fakeSwapMap()
    createEnvSwap(g.map, { fadeMs: () => 0 }).show(products('p3'))
    expect(g.calls).toEqual([])
  })

  it('official before any pad is a no-op; dispose restores and unhooks', () => {
    const f = fakeSwapMap()
    const s = createEnvSwap(f.map, { fadeMs: () => 0 })
    s.show(null)
    expect(f.drawn).toEqual({})
    ;(f.sources.edges as unknown as { setData(d: unknown): void }).setData(fc('off-edges'))
    s.show(products('p4'))
    s.dispose()
    expect(f.drawn.edges).toEqual(fc('off-edges'))
    expect(Object.prototype.hasOwnProperty.call(f.sources.edges, 'setData')).toBe(false)
    ;(f.sources.edges as unknown as { setData(d: unknown): void }).setData(fc('later'))
    expect(f.drawn.edges).toEqual(fc('later'))
  })

  it('takes the official data from getData when registered after ConsoleMap drew it', async () => {
    const f = fakeSwapMap()
    ;(f.sources.route as unknown as { getData(): Promise<unknown> }).getData = () => Promise.resolve(fc('off-route'))
    const s = createEnvSwap(f.map, { fadeMs: () => 0 })
    await Promise.resolve()
    await Promise.resolve()
    s.show(products('p2'))
    s.show(null)
    expect(f.drawn.route).toEqual(fc('off-route'))
  })
})
