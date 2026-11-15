// P1: the pad service against the real data tree (public/data) with fetch mocked. fields/index.json is
// served with 2×2 grids and the PNG decoder is faked (node has no canvas); every JSON file is the real
// one, checked against its contract by data/loader as in the app.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPadPlanProducts, padStatusText, setPadService } from './index'
import { isAbortError, PadError } from './load'
import { createPadService, type PadServiceDeps } from './service'
import { OFFICIAL_PAD_ID, PAD_CACHE_SIZE } from './types'

const DATA = resolve(__dirname, '../../public/data')
const raw = new Map<string, string>()
function file(path: string): string | null {
  let s = raw.get(path)
  if (s === undefined) {
    try {
      s = readFileSync(resolve(DATA, path), 'utf8')
    } catch {
      return null
    }
    if (path === 'fields/index.json') {
      const fi = JSON.parse(s)
      fi.width = fi.height = 2
      for (const m of Object.values(fi.fields) as Record<string, unknown>[]) if ('width' in m) m.width = m.height = 2
      s = JSON.stringify(fi)
    }
    raw.set(path, s)
  }
  return s
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await tick()
}

/** fetch over the real tree; `hold(pred)` parks matching requests until `release()`; `fail` answers 500. */
function harness(o: { fail?: (p: string) => boolean } & Omit<PadServiceDeps, 'io'> = {}) {
  const calls: { path: string; low: boolean; signal?: AbortSignal }[] = []
  let parked: { path: string; go: () => void }[] = []
  let holdIf: ((p: string) => boolean) | null = null
  const fetchMock = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^\/data\//, '')
    const signal = init.signal ?? undefined
    calls.push({ path, low: (init as { priority?: string }).priority === 'low', signal })
    if (holdIf?.(path)) {
      await new Promise<void>((go, no) => {
        parked.push({ path, go })
        signal?.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    }
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (o.fail?.(path)) return new Response('boom', { status: 500 })
    const body = path.endsWith('.png') ? (readFileSync(resolve(DATA, path)) ? 'png' : null) : file(path)
    return body === null ? new Response('', { status: 404 }) : new Response(body, { status: 200 })
  }) as unknown as typeof fetch
  const idleQ: (() => void)[] = []
  let t = 1000
  const svc = createPadService({
    io: { fetch: fetchMock, url: (p) => `/data/${p}`, decodePng: async () => ({ rgba: Uint8Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 255 : 0)), width: 2, height: 2 }), mode: 'real' },
    now: () => t++,
    idle: o.idle ?? ((fn) => void idleQ.push(fn)),
    busy: o.busy,
  })
  return {
    svc,
    calls,
    paths: () => calls.map((c) => c.path),
    hold: (p: (path: string) => boolean) => void (holdIf = p),
    release: () => {
      holdIf = null
      const p = parked
      parked = []
      p.forEach((x) => x.go())
    },
    parked: () => parked.map((p) => p.path),
    /** run the queued idle callbacks (one round) */
    idle: async () => {
      const q = idleQ.splice(0)
      q.forEach((f) => f())
      await settle()
    },
    idleQ,
  }
}

const png = (paths: string[]) => paths.filter((p) => p.endsWith('.png'))

describe('pads index', () => {
  it('official first (fields/nom_104, no summary), then the index pads by rank; listPads [] before', async () => {
    const h = harness()
    expect(h.svc.listPads()).toEqual([])
    const pads = await h.svc.loadPadIndex()
    expect(pads.map((p) => p.id)).toEqual([OFFICIAL_PAD_ID, 'rank2', 'rank3', 'rank4', 'pad_default'])
    expect(pads.map((p) => p.label)).toEqual(['Official pad', 'P2', 'P3', 'P4', 'Default pad'])
    expect(h.svc.listPads()).toBe(h.svc.listPads())
    const [off, r2] = pads
    expect(off).toMatchObject({ sourceId: 'rank1', official: true, rank: 1, hasRoutingFields: true, lon: 137.401783, lat: -4.77748 })
    expect(off.files).toEqual({
      fields: { tHome: 'nom_104/t_home', o2Home: 'nom_104/o2_home', pointer: 'nom_104/pointer' },
      summary: null,
      bands: 'scenarios/bands_104.geojson',
      edges: 'scenarios/nom_104/edges.geojson',
      partner: 'scenarios/nom_104/partner.geojson',
      route: 'route_nom_104.geojson',
      timeline: 'timeline_nom_104.json',
    })
    expect(r2.files.fields).toEqual({ tHome: 'pads/rank2/nom_104/t_home', o2Home: 'pads/rank2/nom_104/o2_home', pointer: 'pads/rank2/nom_104/pointer' })
    expect(r2.files.summary).toBe('scenarios/pads/rank2/summary.json')
    expect(pads.find((p) => p.id === 'pad_default')).toMatchObject({ hasRoutingFields: false, files: { fields: null } })
    await h.svc.loadPadIndex()
    expect(h.paths().filter((p) => p === 'scenarios/pads/index.json')).toHaveLength(1)
  })
})

describe('loadPadEnv', () => {
  it('routing fields + summary first; plan products only on planProducts(), once', async () => {
    const h = harness()
    const env = await h.svc.loadPadEnv('rank2')
    expect(png(h.paths()).sort()).toEqual(['fields/pads/rank2/nom_104/o2_home.png', 'fields/pads/rank2/nom_104/pointer.png', 'fields/pads/rank2/nom_104/t_home.png'])
    expect(h.paths().some((p) => p.endsWith('.geojson'))).toBe(false)
    expect(env.routingFields).toMatchObject({ padId: 'rank2', scenario: 'nom_104', pad: { lon: 137.393301, lat: -4.776468, elevM: -3779.5 } })
    expect(env.routingFields.tHome.width).toBe(2)
    expect(env.routingFields.o2Home).not.toBeNull()
    expect(env.routingFields.pointer).not.toBeNull()
    expect(env.summary?.id).toBe('rank2')
    expect(env.summary?.headlines.map((x) => x.budget)).toEqual([30, 60])
    const a = env.planProducts()
    expect(env.planProducts()).toBe(a)
    const p = await a
    expect(p.bands.features.length).toBeGreaterThan(0)
    expect(p.edges.type).toBe('FeatureCollection')
    expect(p.route).not.toBeNull()
    expect(Array.isArray(p.timeline)).toBe(true)
    expect(h.paths().filter((x) => x === 'scenarios/pads/rank2/bands_104.geojson')).toHaveLength(1)
  })

  it('official pad: the scenario fields (fields/nom_104), summary null, products from the main tree', async () => {
    const h = harness()
    const env = await h.svc.loadPadEnv(OFFICIAL_PAD_ID)
    expect(png(h.paths()).sort()).toEqual(['fields/nom_104/o2_home.png', 'fields/nom_104/pointer.png', 'fields/nom_104/t_home.png'])
    expect(env.summary).toBeNull()
    expect(env.info.sourceId).toBe('rank1')
    const p = await env.planProducts()
    expect(h.paths()).toContain('scenarios/bands_104.geojson')
    expect(p.partner).not.toBeNull()
  })

  it('pad_default: no routing fields -> error state; its plan products still load', async () => {
    const h = harness()
    const err = await h.svc.loadPadEnv('pad_default').catch((e) => e)
    expect(err).toBeInstanceOf(PadError)
    expect((err as PadError).kind).toBe('no-routing-fields')
    expect(h.svc.loadState.peek().pad_default).toMatchObject({ state: 'error' })
    const p = await h.svc.planProductsOf('pad_default')
    expect(p.bands.features.length).toBeGreaterThan(0)
    expect(h.paths().some((x) => x.endsWith('.png'))).toBe(false)
    const restore = setPadService(h.svc)
    try {
      expect(await loadPadPlanProducts('pad_default')).toBe(p)
    } finally {
      restore()
    }
  })

  it('unknown pad: error state, rejects', async () => {
    const h = harness()
    await expect(h.svc.loadPadEnv('rank99')).rejects.toMatchObject({ kind: 'unknown' })
    expect(h.svc.loadState.peek().rank99?.state).toBe('error')
  })
})

describe('load states', () => {
  it('loading{since} synchronously (skeleton at once), then ready; cached = synchronous peek, no fetch', async () => {
    const h = harness()
    const states: string[] = []
    h.svc.loadState.subscribe((s) => states.push(s.rank3?.state ?? 'idle'))
    const p = h.svc.loadPadEnv('rank3')
    expect(h.svc.loadState.peek().rank3).toEqual({ state: 'loading', since: 1000 })
    expect(h.svc.peekPadEnv('rank3')).toBeUndefined()
    const env = await p
    await tick()
    expect(states).toEqual(['loading', 'ready'])
    expect(h.svc.loadState.peek().rank3).toEqual({ state: 'ready', env })
    expect(h.svc.peekPadEnv('rank3')).toBe(env)
    const n = h.calls.length
    expect(await h.svc.loadPadEnv('rank3')).toBe(env)
    expect(h.calls.length).toBe(n)
  })

  it('a failed fetch becomes the error state (and a retry can succeed)', async () => {
    let failing = true
    const h = harness({ fail: (p) => failing && p.endsWith('rank4/nom_104/t_home.png') })
    await expect(h.svc.loadPadEnv('rank4')).rejects.toBeTruthy()
    expect(h.svc.loadState.peek().rank4?.state).toBe('error')
    failing = false
    await h.svc.loadPadEnv('rank4')
    expect(h.svc.loadState.peek().rank4?.state).toBe('ready')
  })

  it('status copy: "Loading pad P3…" while loading, an error line after a failure, else null', () => {
    expect(padStatusText({ label: 'P3' }, { state: 'loading', since: 0 })).toBe('Loading pad P3…')
    expect(padStatusText({ label: 'P3' }, { state: 'error', error: new Error('x') })).toMatch(/^Pad P3 could not be loaded/)
    expect(padStatusText({ label: 'P3' }, undefined)).toBeNull()
  })
})

describe('dedupe and abort', () => {
  it('concurrent loads of one pad share one fetch', async () => {
    const h = harness()
    const [a, b] = await Promise.all([h.svc.loadPadEnv('rank2'), h.svc.loadPadEnv('rank2')])
    expect(a).toBe(b)
    expect(png(h.paths())).toHaveLength(3)
  })

  it('abort: the caller rejects with AbortError, the fetch is cancelled, the state returns to idle', async () => {
    const h = harness()
    await h.svc.loadPadIndex()
    h.hold((p) => p.endsWith('.png'))
    const ctl = new AbortController()
    const p = h.svc.loadPadEnv('rank2', { signal: ctl.signal })
    await settle()
    expect(h.parked().length).toBe(3)
    ctl.abort()
    const e = await p.catch((x) => x)
    expect(isAbortError(e)).toBe(true)
    expect(h.calls.filter((c) => c.path.endsWith('.png')).every((c) => c.signal?.aborted)).toBe(true)
    expect(h.svc.loadState.peek().rank2).toBeUndefined()
    h.release()
    await settle()
    expect(h.svc.peekPadEnv('rank2')).toBeUndefined()
    expect(h.svc.loadState.peek().rank2).toBeUndefined()
  })

  it('one waiter aborting leaves the shared load running for the other', async () => {
    const h = harness()
    await h.svc.loadPadIndex()
    h.hold((p) => p.endsWith('.png'))
    const ctl = new AbortController()
    const a = h.svc.loadPadEnv('rank3', { signal: ctl.signal })
    const b = h.svc.loadPadEnv('rank3')
    await settle()
    ctl.abort()
    expect(isAbortError(await a.catch((x) => x))).toBe(true)
    expect(h.svc.loadState.peek().rank3?.state).toBe('loading')
    h.release()
    const env = await b
    expect(h.svc.peekPadEnv('rank3')).toBe(env)
    expect(png(h.paths())).toHaveLength(3)
  })

  it('an already aborted signal rejects at once, no fetch', async () => {
    const h = harness()
    const ctl = new AbortController()
    ctl.abort()
    expect(isAbortError(await h.svc.loadPadEnv('rank2', { signal: ctl.signal }).catch((x) => x))).toBe(true)
    expect(h.calls).toHaveLength(0)
  })
})

describe('abort then reload', () => {
  it('a new load right after an abort keeps its loading state when the old fetch settles', async () => {
    const h = harness()
    await h.svc.loadPadIndex()
    h.hold((p) => p.endsWith('.png'))
    const ctl = new AbortController()
    const a = h.svc.loadPadEnv('rank2', { signal: ctl.signal })
    await settle()
    ctl.abort()
    await a.catch(() => {})
    const b = h.svc.loadPadEnv('rank2')
    await settle()
    expect(h.svc.loadState.peek().rank2?.state).toBe('loading')
    h.release()
    const env = await b
    expect(h.svc.loadState.peek().rank2).toEqual({ state: 'ready', env })
  })
})

describe('LRU cache', () => {
  it(`keeps ${PAD_CACHE_SIZE} pads; loading touches; the least recent is evicted (state back to idle)`, async () => {
    expect(PAD_CACHE_SIZE).toBe(3)
    const h = harness()
    await h.svc.loadPadEnv(OFFICIAL_PAD_ID)
    await h.svc.loadPadEnv('rank2')
    await h.svc.loadPadEnv('rank3')
    await h.svc.loadPadEnv(OFFICIAL_PAD_ID) // touch: rank2 is now the least recent
    expect(h.svc.peekPadEnv('rank2')).toBeDefined() // peek does not touch
    await h.svc.loadPadEnv('rank4')
    expect(h.svc.peekPadEnv('rank2')).toBeUndefined()
    expect(h.svc.loadState.peek().rank2).toBeUndefined()
    for (const id of [OFFICIAL_PAD_ID, 'rank3', 'rank4']) expect(h.svc.peekPadEnv(id)).toBeDefined()
    const n = png(h.paths()).length
    await h.svc.loadPadEnv('rank2') // reloads; rank3 is now the least recent (order rank3, official, rank4)
    expect(png(h.paths()).length).toBe(n + 3)
    expect(h.svc.peekPadEnv('rank3')).toBeUndefined()
    expect(h.svc.peekPadEnv(OFFICIAL_PAD_ID)).toBeDefined()
  })
})

describe('idle prefetch', () => {
  it('in idle time, in the given order, one pad at a time, low priority, no loading state', async () => {
    const h = harness()
    await h.svc.loadPadEnv(OFFICIAL_PAD_ID)
    const before = h.calls.length
    const seen: string[] = []
    h.svc.loadState.subscribe((s) => Object.entries(s).forEach(([k, v]) => v.state === 'loading' && seen.push(k)))
    h.svc.prefetchPads(['rank3', 'rank2', 'rank4'])
    expect(h.calls.length).toBe(before) // nothing before idle time
    await h.idle()
    expect(png(h.paths().slice(before)).map((p) => p.split('/')[2])).toEqual(['rank3', 'rank3', 'rank3'])
    expect(h.calls.slice(before).filter((c) => c.path.endsWith('.png')).every((c) => c.low)).toBe(true)
    expect(h.svc.loadState.peek().rank3?.state).toBe('ready')
    await h.idle()
    expect(png(h.paths().slice(before)).map((p) => p.split('/')[2])).toEqual(['rank3', 'rank3', 'rank3', 'rank2', 'rank2', 'rank2'])
    // cache full (official, rank3, rank2): rank4 is dropped, nothing evicted
    await h.idle()
    expect(h.svc.queued).toEqual([])
    expect(h.svc.peekPadEnv('rank4')).toBeUndefined()
    expect(h.svc.peekPadEnv(OFFICIAL_PAD_ID)).toBeDefined()
    expect(seen).toEqual([])
    expect(h.idleQ).toHaveLength(0)
  })

  it('skips cached pads and pads without routing fields; never during an edit', async () => {
    let editing = true
    const h = harness({ busy: () => editing })
    await h.svc.loadPadEnv('rank2')
    const before = h.calls.length
    h.svc.prefetchPads(['rank2', 'pad_default', 'rank4'])
    await h.idle()
    await h.idle()
    expect(h.calls.length).toBe(before) // editing: waits
    expect(h.idleQ).toHaveLength(1)
    editing = false
    await h.idle()
    expect(png(h.paths().slice(before)).every((p) => p.includes('/rank4/'))).toBe(true)
    expect(h.svc.peekPadEnv('rank4')).toBeDefined()
  })

  it('an active load of a pad being prefetched joins it (loading state, one fetch)', async () => {
    const h = harness()
    await h.svc.loadPadIndex()
    h.hold((p) => p.endsWith('.png'))
    h.svc.prefetchPads(['rank3'])
    await h.idle()
    expect(h.parked()).toHaveLength(3)
    expect(h.svc.loadState.peek().rank3).toBeUndefined()
    const p = h.svc.loadPadEnv('rank3')
    expect(h.svc.loadState.peek().rank3?.state).toBe('loading')
    h.release()
    await p
    expect(png(h.paths())).toHaveLength(3)
    expect(h.svc.loadState.peek().rank3?.state).toBe('ready')
  })

  it('a prefetched pad never evicts a pad the viewer used', async () => {
    const h = harness()
    await h.svc.loadPadIndex()
    h.hold((p) => p.includes('/rank4/'))
    h.svc.prefetchPads(['rank4'])
    await h.idle()
    // while rank4 prefetches, the viewer opens three pads
    await h.svc.loadPadEnv(OFFICIAL_PAD_ID)
    await h.svc.loadPadEnv('rank2')
    await h.svc.loadPadEnv('rank3')
    h.release()
    await settle()
    expect(h.svc.peekPadEnv('rank4')).toBeUndefined()
    for (const id of [OFFICIAL_PAD_ID, 'rank2', 'rank3']) expect(h.svc.peekPadEnv(id)).toBeDefined()
  })
})
