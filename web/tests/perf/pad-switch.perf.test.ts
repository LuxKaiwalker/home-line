// Plan-port perf probe (Q1, spec §4): pad switch with P1's pad service (pads/service.ts) over the real
// data tree with a mocked fetch latency (every request answers after LATENCY_MS, as a slow link would):
//   skeleton  loadPadEnv() puts the pad in the 'loading' state (the map / picker skeleton) <= 100 ms
//   cached    switching back to a pad already loaded resolves <= 1.5 s (LRU of PAD_CACHE_SIZE)
//   cold      a first load is reported (latency bound, not asserted)
// The PNG fields are served as 2 x 2 grids with a fake decoder (node has no canvas; same as P1's tests):
// the probe times the service, not the PNG decode. Skips with a message when P1's service is not on
// this branch yet.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PadEnv, PadId, PadLoadState } from '../../src/pads/types'
import type { ReadSignal } from '../../src/state/signal'

const SKELETON_MS = 100
const CACHED_MS = 1500
const LATENCY_MS = 150

/** The part of P1's service.ts used here (restated so this file compiles without it). */
interface ServiceMod {
  createPadService(deps: {
    io?: { fetch?: typeof fetch; url?: (p: string) => string; decodePng?: (b: Blob) => Promise<{ rgba: Uint8Array; width: number; height: number }>; mode?: string }
    idle?: (fn: () => void) => void
  }): { loadPadIndex(): Promise<unknown[]>; loadPadEnv(id: PadId): Promise<PadEnv>; loadState: ReadSignal<Readonly<Record<PadId, PadLoadState>>> }
}
const mods = import.meta.glob<ServiceMod>('../../src/pads/service.ts')
const loadService = mods['../../src/pads/service.ts'] as (() => Promise<ServiceMod>) | undefined
if (!loadService) console.log('perf: SKIP pad-switch: P1 pads/service.ts is not on this branch')

const DATA = resolve(__dirname, '../../public/data')
const files = new Map<string, string | null>()
function file(path: string): string | null {
  if (files.has(path)) return files.get(path)!
  let s: string | null
  try {
    s = readFileSync(resolve(DATA, path), 'utf8')
  } catch {
    s = null
  }
  if (s && path === 'fields/index.json') {
    const fi = JSON.parse(s)
    fi.width = fi.height = 2
    for (const m of Object.values(fi.fields) as Record<string, unknown>[]) if ('width' in m) m.width = m.height = 2
    s = JSON.stringify(fi)
  }
  files.set(path, s)
  return s
}

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((ok, no) => {
    const t = setTimeout(ok, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      no(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
  })

describe.skipIf(!loadService)('pad switch perf: P1 service, mocked fetch latency', () => {
  it(`skeleton <= ${SKELETON_MS} ms, cached switch <= ${CACHED_MS} ms (fetch latency ${LATENCY_MS} ms)`, async () => {
    const { createPadService } = await loadService!()
    let requests = 0
    const fetchMock = (async (url: string, init: RequestInit = {}) => {
      requests++
      await sleep(LATENCY_MS, init.signal)
      const path = String(url).replace(/^\/data\//, '')
      const body = path.endsWith('.png') ? 'png' : file(path)
      return body === null ? new Response('', { status: 404 }) : new Response(body, { status: 200 })
    }) as unknown as typeof fetch
    const svc = createPadService({
      io: { fetch: fetchMock, url: (p) => `/data/${p}`, decodePng: async () => ({ rgba: Uint8Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 255 : 0)), width: 2, height: 2 }), mode: 'real' },
      idle: () => {}, // no idle prefetch: every load below is the viewer's own
    })
    await svc.loadPadIndex()
    const state = svc.loadState

    const switchTo = async (id: PadId) => {
      const t0 = performance.now()
      const p = svc.loadPadEnv(id)
      // skeleton: the loading state is set synchronously by an active load (or the env is cached: ready)
      const st = state.peek()[id]?.state
      const skeleton = st === 'loading' || st === 'ready' ? performance.now() - t0 : Infinity
      const env = await p
      return { skeleton, total: performance.now() - t0, env }
    }

    const cold2 = await switchTo('rank2')
    const cold3 = await switchTo('rank3')
    const n0 = requests
    const back2 = await switchTo('rank2') // cached (LRU 3)
    const back3 = await switchTo('rank3')
    const cachedRequests = requests - n0
    console.log(
      `perf: pad switch (latency ${LATENCY_MS} ms/request): skeleton ${[cold2, cold3, back2, back3].map((x) => x.skeleton.toFixed(1)).join('/')} ms; ` +
        `cold ${cold2.total.toFixed(0)}/${cold3.total.toFixed(0)} ms; cached ${back2.total.toFixed(1)}/${back3.total.toFixed(1)} ms (${cachedRequests} requests)`,
    )
    expect(cold2.env.info.id).toBe('rank2')
    expect(back2.env).toBe(cold2.env)
    for (const x of [cold2, cold3, back2, back3]) expect(x.skeleton).toBeLessThanOrEqual(SKELETON_MS)
    expect(Math.max(back2.total, back3.total)).toBeLessThanOrEqual(CACHED_MS)
    expect(cachedRequests).toBe(0)
  })
})
