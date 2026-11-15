// P1 (plan port): the pad environment service behind pads/index.ts.
//   cache     LRU of PAD_CACHE_SIZE envs (Map insertion order = recency; loadPadEnv touches, peek does not).
//             An idle prefetch only fills free slots: it never evicts a pad the viewer used.
//   dedupe    one fetch per pad however many callers wait; each caller's signal aborts only its own
//             wait, the fetch is cancelled when every waiter has gone (a waiter without a signal stays).
//   states    loading{since} is set synchronously by an active load (skeleton at once), ready on success,
//             error on failure, removed (= idle) on abort or eviction. Prefetches never report loading.
//   prefetch  prefetchPads(ids) queues; one pad at a time in idle time (requestIdleCallback, else a
//             timeout), never while the viewer edits (busy()), stops when the cache is full.
// Never blocks the map: nothing here runs synchronously beyond bookkeeping; decoding is per field.
import { signal } from '../state/signal'
import { abortError, buildPadIndex, defaultIo, isAbortError, lazyProducts, loadPadEnvData, padLoader, PadError, type PadIndexData, type PadIo } from './load'
import { PAD_CACHE_SIZE, type LoadPadOptions, type PadEnv, type PadId, type PadInfo, type PadLoadState, type PadService, type PlanProducts } from './types'

export interface PadServiceDeps {
  io?: Partial<PadIo>
  now?: () => number
  /** run fn in idle time (default requestIdleCallback, else setTimeout) */
  idle?: (fn: () => void) => void
  /** true while the viewer edits: prefetch waits */
  busy?: () => boolean
  cacheSize?: number
}

interface Flight {
  ctrl: AbortController
  promise: Promise<PadEnv>
  waiters: number
  /** only prefetch waiters so far: no loading state, no error state, inserted as least recent */
  prefetchOnly: boolean
  done: boolean
}

export interface RealPadService extends PadService {
  /** plan products of any pad, also one without routing fields (pad_default); cached with the env when there is one */
  planProductsOf(id: PadId): Promise<PlanProducts>
  /** the prefetch queue (tests) */
  readonly queued: readonly PadId[]
}

export function defaultIdle(fn: () => void): void {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 5000 })
  else setTimeout(fn, 200)
}

export function createPadService(deps: PadServiceDeps = {}): RealPadService {
  const io: PadIo = { ...defaultIo(), ...deps.io }
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const idle = deps.idle ?? defaultIdle
  const busy = deps.busy ?? (() => false)
  const size = Math.max(1, deps.cacheSize ?? PAD_CACHE_SIZE)

  const cache = new Map<PadId, PadEnv>()
  const flights = new Map<PadId, Flight>()
  const loadState = signal<Readonly<Record<PadId, PadLoadState>>>({})
  /** pads without routing fields (pad_default): their lazy products (one pad today) */
  const productsOnly = new Map<PadId, () => Promise<PlanProducts>>()
  let indexP: Promise<PadIndexData> | null = null
  let index: PadIndexData | null = null
  let list: PadInfo[] = []
  const queue: PadId[] = []
  let pumping = false

  const setState = (id: PadId, s: PadLoadState | null) => {
    const cur = loadState.peek()
    if (s === null && !(id in cur)) return
    const next = { ...cur }
    if (s === null) delete next[id]
    else next[id] = s
    loadState.value = next
  }

  function indexData(): Promise<PadIndexData> {
    if (!indexP) {
      const p = buildPadIndex(padLoader(io)).then((d) => {
        index = d
        list = d.pads
        return d
      })
      p.catch(() => {
        if (indexP === p) indexP = null // retry on the next call
      })
      indexP = p
    }
    return indexP
  }

  function insert(id: PadId, env: PadEnv, leastRecent: boolean): void {
    cache.delete(id)
    if (leastRecent) {
      const rest = [...cache]
      cache.clear()
      cache.set(id, env)
      for (const [k, v] of rest) cache.set(k, v)
    } else cache.set(id, env)
    while (cache.size > size) {
      const oldest = cache.keys().next().value as PadId
      cache.delete(oldest)
      setState(oldest, null)
    }
  }

  function start(id: PadId, prefetch: boolean): Flight {
    const ctrl = new AbortController()
    const f: Flight = { ctrl, waiters: 0, prefetchOnly: prefetch, done: false, promise: null as unknown as Promise<PadEnv> }
    f.promise = (async () => {
      const idx = await indexData()
      if (ctrl.signal.aborted) throw abortError()
      const info = idx.pads.find((p) => p.id === id)
      if (!info) throw new PadError(id, 'unknown', `no pad ${id} in the pads index`)
      return loadPadEnvData(io, idx, info, { signal: ctrl.signal, low: prefetch })
    })()
    f.promise.then(
      (env) => {
        f.done = true
        if (flights.get(id) === f) flights.delete(id)
        if (ctrl.signal.aborted) return
        const inCache = cache.has(id)
        insert(id, env, f.prefetchOnly && !inCache)
        // inserted as least recent and over capacity: dropped again at once (prefetch never evicts)
        if (cache.has(id)) setState(id, { state: 'ready', env })
      },
      (error) => {
        f.done = true
        if (flights.get(id) === f) flights.delete(id)
        // aborted: release() already cleared the state (a newer load of this pad may own it now)
        if (ctrl.signal.aborted) return
        if (isAbortError(error)) return setState(id, null)
        if (f.prefetchOnly) return
        setState(id, { state: 'error', error })
      },
    )
    flights.set(id, f)
    return f
  }

  function release(id: PadId, f: Flight): void {
    f.waiters--
    if (f.waiters > 0 || f.done) return
    f.ctrl.abort()
    if (flights.get(id) === f) flights.delete(id)
    setState(id, null)
  }

  const svc: RealPadService = {
    loadState,
    get queued() {
      return [...queue]
    },
    loadPadIndex: () => indexData().then((d) => d.pads),
    listPads: () => list,
    peekPadEnv: (id) => cache.get(id),

    loadPadEnv(id: PadId, opts: LoadPadOptions = {}): Promise<PadEnv> {
      const { signal: sig, prefetch = false } = opts
      if (sig?.aborted) return Promise.reject(abortError())
      const hit = cache.get(id)
      if (hit) {
        if (!prefetch) insert(id, hit, false) // touch
        if (loadState.peek()[id]?.state !== 'ready') setState(id, { state: 'ready', env: hit })
        return Promise.resolve(hit)
      }
      const f = flights.get(id) ?? start(id, prefetch)
      if (!prefetch && f.prefetchOnly) f.prefetchOnly = false
      if (!prefetch && loadState.peek()[id]?.state !== 'loading') setState(id, { state: 'loading', since: now() })
      f.waiters++
      return new Promise<PadEnv>((resolve, reject) => {
        let settled = false
        const onAbort = () => {
          if (settled) return
          settled = true
          reject(abortError())
          release(id, f)
        }
        sig?.addEventListener('abort', onAbort, { once: true })
        f.promise.then(
          (env) => {
            if (settled) return
            settled = true
            sig?.removeEventListener('abort', onAbort)
            f.waiters--
            resolve(env)
          },
          (e) => {
            if (settled) return
            settled = true
            sig?.removeEventListener('abort', onAbort)
            f.waiters--
            reject(e)
          },
        )
      })
    },

    prefetchPads(ids: readonly PadId[]): void {
      for (const id of ids) if (!queue.includes(id)) queue.push(id)
      schedule()
    },

    planProductsOf(id: PadId): Promise<PlanProducts> {
      const env = cache.get(id)
      if (env) return env.planProducts()
      return indexData().then((idx) => {
        const info = idx.pads.find((x) => x.id === id)
        if (!info) throw new PadError(id, 'unknown', `no pad ${id} in the pads index`)
        // a pad with fields: through its env (cached, LRU); without (pad_default): the products alone
        if (info.files.fields) return svc.loadPadEnv(id).then((e) => e.planProducts())
        let lazy = productsOnly.get(id)
        if (!lazy) productsOnly.set(id, (lazy = lazyProducts(io, info.files)))
        return lazy()
      })
    },
  }

  function schedule(): void {
    if (pumping || !queue.length) return
    pumping = true
    idle(pump)
  }

  function pump(): void {
    if (busy()) {
      idle(pump) // the viewer edits: try again in the next idle slot
      return
    }
    void (async () => {
      try {
        const idx = index ?? (await indexData().catch(() => null))
        if (!idx) return void (queue.length = 0)
        while (queue.length) {
          const id = queue[0]
          const info = idx.pads.find((p) => p.id === id)
          if (!info?.files.fields || cache.has(id) || flights.has(id)) {
            queue.shift()
            continue
          }
          if (cache.size + flights.size >= size) {
            queue.length = 0 // the cache is full: prefetch never evicts
            return
          }
          queue.shift()
          await svc.loadPadEnv(id, { prefetch: true }).catch(() => {})
          break
        }
      } finally {
        pumping = false
        schedule()
      }
    })()
  }

  return svc
}
