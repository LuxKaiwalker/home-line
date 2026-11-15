// S3a route adapter (search.md §4.2 route, interfaces.md §4): the only call is setRouteDraft(stops,
// 'ordered') from edit/route/store.ts (WP12). Present (module mocked) → called once with the stops;
// missing (static build, or a store without it) → 'missing' / null, never a throw.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeRouteDraft, runRouteDraft, setRouteImporter } from './routeAdapter'

const setRouteDraft = vi.fn(() => ({ ok: true, problems: [] }))
vi.mock('../../../edit/route/store', () => ({ setRouteDraft }))

afterEach(() => {
  vi.unstubAllEnvs()
  setRouteImporter(null)
  setRouteDraft.mockClear()
})

describe('route adapter', () => {
  it('live build with WP12: setRouteDraft is called once with the station stops, ordered', async () => {
    vi.stubEnv('VITE_LIVE', '1')
    expect(await probeRouteDraft()).toBe('ready')
    expect(setRouteDraft).not.toHaveBeenCalled() // probing never drafts
    const r = await runRouteDraft([{ station: 'S4' }, { station: 'S1' }, { station: 'S6' }])
    expect(setRouteDraft).toHaveBeenCalledTimes(1)
    expect(setRouteDraft).toHaveBeenCalledWith([{ station: 'S4' }, { station: 'S1' }, { station: 'S6' }], 'ordered')
    expect(r).toEqual({ ok: true, problems: [] })
  })

  it('static build: the edit code is never loaded → missing, nothing called', async () => {
    vi.stubEnv('VITE_LIVE', '')
    expect(await probeRouteDraft()).toBe('missing')
    expect(await runRouteDraft([{ station: 'S4' }])).toBeNull()
    expect(setRouteDraft).not.toHaveBeenCalled()
  })

  it('a store without setRouteDraft (before WP12), or a failing import → missing, no throw', async () => {
    setRouteImporter(async () => ({ createRouteStore: () => ({}) }))
    expect(await probeRouteDraft()).toBe('missing')
    await expect(runRouteDraft([{ station: 'S4' }])).resolves.toBeNull()
    setRouteImporter(async () => {
      throw new Error('chunk failed')
    })
    expect(await probeRouteDraft()).toBe('missing')
    await expect(runRouteDraft([{ station: 'S4' }])).resolves.toBeNull()
  })
})
