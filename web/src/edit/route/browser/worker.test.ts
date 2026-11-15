// R1 (Plan port): the route worker (worker.ts) against the contract (worker.types.ts) and against the
// Mission Planer's J1h worker it replaces (mission/legsRoute.test.ts, re-pointed onto the core): exact
// mode equals the main-thread LegRouter after structured cloning, as postMessage does.
import { describe, expect, it } from 'vitest'
import { gradeModel, scenarioParams } from '../map/physio'
import { LegRouter, type Leg, type RouteGrid } from '../map/router'
import { createLegSearch, type LegSearch, type SearchResult } from './legSearch'
import { createRouteWorkerHandler, WORKER_PAD_CACHE } from './worker'
import type { RouteWorkerRequest, RouteWorkerResponse, WorkerPadEnv } from './worker.types'

function grid(w: number, h: number): RouteGrid {
  const e = new Float32Array(w * h)
  const p = new Uint8Array(w * h)
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      e[r * w + c] = 3 * Math.sin(r / 7) + 2 * Math.cos(c / 5) + ((r * 31 + c * 17) % 11) * 0.4
      p[r * w + c] = (r === 20 && c > 5 && c < 55) || (c === 30 && r > 30 && r < 58) ? 0 : 1
    }
  return { width: w, height: h, resM: 5, elev: e, passable: p }
}

const env = (padId: string, sid = 'nom_104', g = grid(60, 60)): WorkerPadEnv => ({ padId, scenario: sid, grid: g, params: scenarioParams(sid), padCell: 61 })

/** A synchronous harness: messages are cloned both ways; deferred steps run on flush(). */
function harness(opts: { createSearch?: (g: RouteGrid, m: ReturnType<typeof gradeModel>) => LegSearch } = {}) {
  const out: RouteWorkerResponse[] = []
  const later: (() => void)[] = []
  const h = createRouteWorkerHandler((m) => out.push(structuredClone(m)), { defer: (f) => void later.push(f), createSearch: opts.createSearch })
  return {
    out,
    send: (m: RouteWorkerRequest) => h.handle(structuredClone(m)),
    flush: () => {
      while (later.length) later.shift()!()
    },
    step: () => later.shift()?.(),
    h,
  }
}

const route = (seq: number, cells: number[], extra: Partial<Extract<RouteWorkerRequest, { type: 'route' }>> = {}): RouteWorkerRequest => ({ type: 'route', seq, padId: 'official', cells, mode: 'fast', weight: 1.6, legCapMs: 150, ...extra })

describe('route worker (R1, worker.types.ts)', () => {
  it('exact mode = the main-thread LegRouter (J1h parity, structured clone), incl. no-route legs', () => {
    for (const sid of ['nom_104', 'con_104', 'opt_104']) {
      const g = grid(60, 60)
      const direct = new LegRouter(g, gradeModel(scenarioParams(sid)))
      const w = harness()
      w.send({ type: 'env', env: env('official', sid, { ...g, elev: g.elev.slice(), passable: g.passable.slice() }) })
      const cells = [61, 3540, 5 * 60 + 2, 50 * 60 + 58, 0, 59 * 60 + 59, 100, 100, 20 * 60 + 10, 1, 3540, 61]
      w.send(route(1, cells, { mode: 'exact', weight: 1 }))
      w.flush()
      const fin = w.out.find((m) => m.type === 'legs' && m.final) as Extract<RouteWorkerResponse, { type: 'legs' }>
      expect(fin.legs).toHaveLength(cells.length - 1)
      fin.legs.forEach((l, i) => {
        expect(l.index).toBe(i)
        expect([l.from, l.to]).toEqual([cells[i], cells[i + 1]])
        expect(l.leg).toEqual(direct.route(cells[i], cells[i + 1]))
        expect(l.mode).toBe('exact')
        expect(l.capped).toBe(false)
      })
      expect(fin.legs.some((l) => l.leg === null)).toBe(true) // the blocked start
    }
  })

  it('partial legs first (one per finished leg, shortest first), then final, then timing; cache hits next time', () => {
    const w = harness()
    w.send({ type: 'env', env: env('official') })
    w.send(route(1, [61, 3540, 62, 61 + 120]))
    w.flush()
    const kinds = w.out.map((m) => (m.type === 'legs' ? (m.final ? 'final' : 'partial') : m.type))
    expect(kinds).toEqual(['partial', 'partial', 'timing', 'final'])
    const first = w.out[0] as Extract<RouteWorkerResponse, { type: 'legs' }>
    expect(first.legs[0].index).toBe(2) // 62 -> 181 is the shortest straight line
    const t1 = w.out[2] as Extract<RouteWorkerResponse, { type: 'timing' }>
    expect(t1.perLegMs).toHaveLength(3)
    expect(t1.cacheHits).toBe(0)
    w.out.length = 0
    // move the last stop: two legs cached, one new; the cached ones come in one partial at once
    w.send(route(2, [61, 3540, 62, 61 + 240]))
    w.flush()
    expect(w.out.map((m) => (m.type === 'legs' ? (m.final ? 'final' : 'partial') : m.type))).toEqual(['partial', 'timing', 'final'])
    expect((w.out[0] as Extract<RouteWorkerResponse, { type: 'legs' }>).legs.map((l) => l.index)).toEqual([0, 1])
    expect((w.out[1] as Extract<RouteWorkerResponse, { type: 'timing' }>).cacheHits).toBe(2)
  })

  it('a newer request stops the older one between legs; cancel too; cells < 0 are never routed', () => {
    const w = harness()
    w.send({ type: 'env', env: env('official') })
    w.send(route(1, [61, 3540, 62, 1000, 2000]))
    w.send(route(2, [61, -1, 62]))
    w.flush()
    const seqs = w.out.filter((m) => m.type === 'legs' && m.final).map((m) => (m as { seq: number }).seq)
    expect(seqs).toEqual([2])
    const fin = w.out.find((m) => m.type === 'legs' && m.final) as Extract<RouteWorkerResponse, { type: 'legs' }>
    expect(fin.legs.map((l) => l.leg)).toEqual([null, null])
    w.out.length = 0
    w.send(route(3, [61, 3000, 3100, 3200]))
    w.send({ type: 'cancel', seq: 3 })
    w.flush()
    expect(w.out.some((m) => m.type === 'legs' && m.final)).toBe(false)
  })

  it('no environment → error; env LRU keeps the last pads; drop forgets one', () => {
    const w = harness()
    w.send(route(1, [61, 62]))
    expect(w.out[0]).toMatchObject({ type: 'error', seq: 1 })
    for (const id of ['official', 'rank2', 'rank3', 'rank4']) w.send({ type: 'env', env: env(id) })
    expect(w.h.pads()).toHaveLength(WORKER_PAD_CACHE)
    expect(w.h.pads()).not.toContain('official')
    w.send({ type: 'drop', padId: 'rank3' })
    expect(w.h.pads()).toEqual(['rank2', 'rank4'])
  })

  it('idle refine: a fast (inexact) leg is re-searched exactly and posted as refined when faster', () => {
    // fake fast search: the exact leg made 30 s slower and marked inexact
    const fake = (g: RouteGrid, m: ReturnType<typeof gradeModel>): LegSearch => {
      const exact = createLegSearch(g, m)
      return {
        searchLeg: (a, b, o) => {
          const r = exact.searchLeg(a, b, o)
          const leg: Leg | null = r.leg ? { ...r.leg, timeS: r.leg.timeS + 30 } : null
          return { ...r, leg, cost: leg ? leg.timeS : Infinity, exact: false, weight: 1.6 } as SearchResult
        },
        refineLeg: (a, b, o) => exact.refineLeg(a, b, o),
      }
    }
    const w = harness({ createSearch: fake })
    w.send({ type: 'env', env: env('official') })
    w.send(route(1, [61, 3540, 62]))
    w.flush()
    const fin = w.out.find((m) => m.type === 'legs' && m.final) as Extract<RouteWorkerResponse, { type: 'legs' }>
    expect(fin.legs.every((l) => l.mode === 'fast')).toBe(true)
    const ref = w.out.filter((m) => m.type === 'refined') as Extract<RouteWorkerResponse, { type: 'refined' }>[]
    expect(ref.map((r) => r.leg.index).sort()).toEqual([0, 1])
    for (const r of ref) {
      expect(r.savedS).toBeCloseTo(30, 6)
      expect(r.leg.mode).toBe('exact')
    }
    // after the refine the cache holds exact legs: an exact request is all cache hits
    w.out.length = 0
    w.send(route(2, [61, 3540, 62], { mode: 'exact' }))
    w.flush()
    expect((w.out.find((m) => m.type === 'timing') as { cacheHits: number }).cacheHits).toBe(2)
  })
})
