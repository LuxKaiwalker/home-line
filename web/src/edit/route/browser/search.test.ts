// PORT R2: weighted A* + per-leg cap + idle refine (search.ts).
// 1. exact mode (w = 1) = WP6's LegRouter, bit for bit, on synthetic grids and on the REAL grids
//    (official pad nom_104 + the picker pads' routing fields), incl. the long 2.4-3.4 km legs (D137);
// 2. w > 1: cost <= w x fastest (weighted A* bound), and it expands fewer nodes;
// 3. the cap: a path is still returned (greedy finish, timedOut), refine gives null when capped,
//    abort stops at once;
// 4. timings fast vs exact on the long legs (printed; the fast leg stays inside the 150 ms cap).
/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { Station } from '../../../data/types'
import { decodeRGBA, FieldGrid, fieldGrid } from '../../../hud/fields'
import { readPngRGBA, REPO } from '../../../hud/testutil'
import type { FieldsIndex } from '../../../hud/types'
import { copyFrom } from '../../../ui/copy'
import { accessCell, cellOf, routeGridOf, sampleElevation } from '../map/grid'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, HeightGrid, lonLatToXY, parseEqc, parseIndex } from '../map/heights'
import { gradeModel, scenarioParams, type GradeModel } from '../map/physio'
import { LegRouter, type RouteGrid } from '../map/router'
import copyR2 from './copy.R2.json'
import {
  createLegSearch,
  GREEDY_WEIGHT,
  HEURISTIC_WEIGHT,
  heuristicWeightOf,
  isBetterLeg,
  LegSearch,
  refineLeg,
  savedSeconds,
  searchLeg,
  type SearchResult,
} from './search'
import { DEFAULT_HEURISTIC_WEIGHT, LEG_CAP_MS } from './worker.types'

const EPS = 1e-9

function synthGrid(w: number, h: number, seed = 1): RouteGrid {
  const e = new Float32Array(w * h)
  const p = new Uint8Array(w * h)
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      e[r * w + c] = 3 * Math.sin(r / 7 + seed) + 2 * Math.cos(c / 5) + ((r * 31 + c * 17 * seed) % 11) * 0.4
      p[r * w + c] = (r === 20 && c > 5 && c < 55) || (c === 30 && r > 30 && r < 58) ? 0 : 1
    }
  return { width: w, height: h, resM: 5, elev: e, passable: p }
}

/** A fake clock that advances `stepMs` per call (deterministic cap tests). */
function fakeClock(stepMs: number): () => number {
  let t = 0
  return () => (t += stepMs)
}

describe('config and label', () => {
  it('route.heuristic_weight is in config/design.yaml (1.6, assumed) and equals the worker default', () => {
    const design = parse(readFileSync(resolve(REPO, 'config/design.yaml'), 'utf8')) as { route: { heuristic_weight: number; assumed: string[] } }
    expect(design.route.heuristic_weight).toBe(1.6)
    expect(design.route.assumed).toContain('heuristic_weight')
    expect(HEURISTIC_WEIGHT).toBe(design.route.heuristic_weight)
    expect(HEURISTIC_WEIGHT).toBe(DEFAULT_HEURISTIC_WEIGHT)
  })

  it('a missing key falls back to the worker default; a bad value throws', () => {
    expect(heuristicWeightOf({ route: {} })).toBe(DEFAULT_HEURISTIC_WEIGHT)
    expect(() => heuristicWeightOf({ route: { heuristic_weight: 0.5 } })).toThrow()
    expect(() => heuristicWeightOf({ route: { heuristic_weight: 'x' } })).toThrow()
  })

  it('the UI label is the honesty label (copy.R2.json fast = seed route.panel.fast)', () => {
    expect(copyFrom(copyR2)('fast')).toBe('Fast route · may not be the fastest')
  })
})

describe('exact mode (w = 1) equals LegRouter on synthetic grids', () => {
  it('same legs (cells, times, O2, tau) for every scenario, incl. blocked and trivial legs', () => {
    for (const sid of ['nom_104', 'con_104', 'opt_104']) {
      for (const seed of [1, 2, 3]) {
        const g = synthGrid(60, 60, seed)
        const model = gradeModel(scenarioParams(sid))
        const ref = new LegRouter(g, model)
        const s = new LegSearch(g, model)
        const pairs: [number, number][] = [
          [61, 3540],
          [5 * 60 + 2, 50 * 60 + 58],
          [0, 59 * 60 + 59],
          [100, 100],
          [20 * 60 + 10, 1], // blocked start: null
          [3540, 61],
          [59, 59 * 60],
        ]
        for (const [a, b] of pairs) {
          const r = s.searchLeg(a, b, { weight: 1, capMs: 1e9 })
          expect(r.leg).toEqual(ref.route(a, b))
          expect(r.exact).toBe(true)
          expect(r.timedOut).toBe(false)
          const q = s.refineLeg(a, b)
          expect(q.leg).toEqual(r.leg)
          expect(q.exact).toBe(true)
        }
      }
    }
  })

  it('an unreachable target gives null, not timed out (definitive)', () => {
    const g = synthGrid(40, 40)
    for (let c = 0; c < 40; c++) g.passable[10 * 40 + c] = 0 // wall across the grid
    const s = new LegSearch(g, gradeModel(scenarioParams('nom_104')))
    for (const w of [1, 1.6, 3]) {
      const r = s.searchLeg(0, 39 * 40 + 39, { weight: w })
      expect(r.leg).toBeNull()
      expect(r.timedOut).toBe(false)
      expect(r.cost).toBe(Infinity)
    }
  })

  it('refuses a weight below 1', () => {
    const g = synthGrid(10, 10)
    expect(() => searchLeg(g, gradeModel(scenarioParams('nom_104')), 0, 99, { weight: 0.9 })).toThrow()
  })
})

describe('weighted A* (w > 1) on synthetic grids', () => {
  it('cost <= w x fastest, never below the fastest, a valid path', () => {
    const model = gradeModel(scenarioParams('nom_104'))
    for (const seed of [1, 2, 3]) {
      const g = synthGrid(80, 80, seed)
      const ref = new LegRouter(g, model)
      for (const w of [1.2, HEURISTIC_WEIGHT, 2.5, 5]) {
        for (const [a, b] of [
          [81, 79 * 80 + 78],
          [79, 79 * 80],
          [40 * 80 + 2, 3 * 80 + 70],
        ] as [number, number][]) {
          const best = ref.route(a, b)!
          const r = searchLeg(g, model, a, b, { weight: w, capMs: 1e9 })
          expect(r.leg).not.toBeNull()
          expect(r.leg!.cells[0]).toBe(a)
          expect(r.leg!.cells.at(-1)).toBe(b)
          expect(r.cost).toBeGreaterThanOrEqual(best.timeS - EPS)
          expect(r.cost).toBeLessThanOrEqual(w * best.timeS + EPS)
          expect(r.exact).toBe(false)
          expect(r.weight).toBe(w)
        }
      }
    }
  })
})

describe('per-leg cap, refine and abort', () => {
  const model = gradeModel(scenarioParams('nom_104'))
  const g = synthGrid(120, 120)
  const a = 121
  const b = 119 * 120 + 118

  it('after the cap the search finishes greedily: a path, timedOut, bound = GREEDY_WEIGHT', () => {
    // every clock read advances 1 ms; cap 1 ms → the first check (512 expansions) is over the cap
    const best = new LegRouter(g, model).route(a, b)!
    const r = searchLeg(g, model, a, b, { weight: 1, capMs: 1, now: fakeClock(1), fallback: true })
    expect(r.timedOut).toBe(true)
    expect(r.exact).toBe(false)
    expect(r.leg).not.toBeNull()
    expect(r.leg!.cells.at(-1)).toBe(b)
    expect(r.weight).toBe(GREEDY_WEIGHT)
    expect(r.cost).toBeLessThanOrEqual(GREEDY_WEIGHT * best.timeS + EPS)
  })

  it('the greedy finish gives up after GREEDY_EXTRA caps more (null, timedOut = unknown, not unreachable)', () => {
    // a cup that traps the greedy search: a wall across the grid with a gap at the far end
    const t = synthGrid(200, 200)
    t.passable.fill(1)
    for (let c = 0; c < 195; c++) t.passable[150 * 200 + c] = 0
    const r = searchLeg(t, model, 201, 199 * 200 + 2, { weight: 1, capMs: 1, now: fakeClock(100) })
    expect(r.leg).toBeNull()
    expect(r.timedOut).toBe(true)
  })

  it('refine (w = 1) gives null when capped (nothing to replace) and the full exact leg otherwise', () => {
    const capped = refineLeg(g, model, a, b, { capMs: 1, now: fakeClock(1) })
    expect(capped.leg).toBeNull()
    expect(capped.timedOut).toBe(true)
    expect(isBetterLeg(null, capped)).toBe(false)
    const full = refineLeg(g, model, a, b)
    expect(full.leg).toEqual(new LegRouter(g, model).route(a, b))
  })

  it('an aborted signal stops the search; the result is flagged aborted', () => {
    const ctl = new AbortController()
    ctl.abort()
    const r = searchLeg(g, model, a, b, { signal: ctl.signal })
    expect(r.aborted).toBe(true)
    expect(r.leg).toBeNull()
    let checks = 0
    const sig = {
      get aborted() {
        return ++checks > 1
      },
    }
    const r2 = searchLeg(g, model, a, b, { weight: 1, signal: sig, capMs: 1e9 })
    expect(r2.aborted).toBe(true)
    expect(r2.exact).toBe(false)
  })

  it('isBetterLeg / savedSeconds: replace only with a finished exact leg that is faster', () => {
    const fast = searchLeg(g, model, a, b, { weight: 5, capMs: 1e9 })
    const exact = refineLeg(g, model, a, b)
    expect(exact.cost).toBeLessThanOrEqual(fast.cost)
    expect(isBetterLeg(fast.leg, exact)).toBe(exact.cost < fast.cost)
    expect(isBetterLeg(exact.leg, exact)).toBe(false) // same leg: not faster
    expect(isBetterLeg(fast.leg, fast)).toBe(false) // not exact
    expect(isBetterLeg(fast.leg, exact, 1e9)).toBe(false) // under the minimum saving
    expect(isBetterLeg(null, exact)).toBe(true)
    expect(savedSeconds(fast.leg, exact)).toBeCloseTo(Math.max(0, fast.cost - exact.cost), 9)
  })

  it('createLegSearch reuses one searcher per grid and model', () => {
    expect(createLegSearch(g, model)).toBe(createLegSearch(g, model))
    expect(createLegSearch(g, gradeModel(scenarioParams('con_104')))).not.toBe(createLegSearch(g, model))
  })
})

// ---- the real grids ---------------------------------------------------------------------------

const PUB = resolve(REPO, 'web/public/data')
const J = <T>(rel: string): T => JSON.parse(readFileSync(resolve(PUB, rel), 'utf8')) as T

interface RealGrid {
  name: string
  tHome: FieldGrid
  grid: RouteGrid
  model: GradeModel
  pad: number
}

let heightsCache: Promise<{ heights: HeightGrid; eqc: ReturnType<typeof parseEqc> }> | null = null
function heights() {
  heightsCache ??= (async () => {
    const fp = parseIndex(J('fp3d/index.json'))
    const raw = readFileSync(resolve(PUB, fp.far.file))
    const buf = await gunzipIfNeeded(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
    const [west, north] = farOrigin(fp)
    const h = new HeightGrid(west, north, fp.far.res_m, fp.far.width, fp.far.height, decodeHeights(buf, fp.far.width, fp.far.height, codecOf(fp)))
    return { heights: h, eqc: parseEqc(fp.chunk_grid.crs) }
  })()
  return heightsCache
}

/** The routing grid as loadRouteGrid builds it, from a T_home field key ('nom_104' or 'pads/rank2/nom_104'). */
async function loadReal(name: string, key: string, padLonLat: { lon: number; lat: number }): Promise<RealGrid> {
  const fi = J<FieldsIndex>('fields/index.json')
  const meta = fi.fields[`${key}/t_home`]
  if (!meta) throw new Error(`fields/index.json has no ${key}/t_home`)
  const { rgba, width, height } = readPngRGBA(resolve(PUB, meta.file))
  const tHome = new FieldGrid(fieldGrid(fi, `${key}/t_home`), decodeRGBA(rgba, width, height, meta.scale), meta.units)
  const { heights: hg, eqc } = await heights()
  const grid = routeGridOf(tHome, sampleElevation(tHome, hg, (lon, lat) => lonLatToXY(eqc, lon, lat)))
  const pad = accessCell(grid, cellOf(tHome, padLonLat.lon, padLonLat.lat), 50)
  if (pad === null) throw new Error(`${name}: no walkable pad cell`)
  return { name, tHome, grid, model: gradeModel(scenarioParams('nom_104')), pad }
}

/** Walkable cell nearest to (lon, lat), or null. */
function cellNear(r: RealGrid, lon: number, lat: number): number | null {
  return accessCell(r.grid, cellOf(r.tHome, lon, lat), 50)
}

function distKm(r: RealGrid, a: number, b: number): number {
  const W = r.grid.width
  return (Math.hypot(Math.floor(a / W) - Math.floor(b / W), (a % W) - (b % W)) * r.grid.resM) / 1000
}

/** Long legs (D137): walkable targets 2.4-3.4 km from the pad, eight bearings, reachable from the pad. */
function longTargets(r: RealGrid): number[] {
  const W = r.grid.width
  const pr = Math.floor(r.pad / W)
  const pc = r.pad % W
  const out: number[] = []
  for (const km of [2.4, 2.9, 3.4]) {
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4 + km
      const rr = Math.round(pr - (Math.cos(ang) * km * 1000) / r.grid.resM)
      const cc = Math.round(pc + (Math.sin(ang) * km * 1000) / r.grid.resM)
      if (rr < 0 || cc < 0 || rr >= r.grid.height || cc >= W) continue
      const c = accessCell(r.grid, rr * W + cc, 60)
      if (c !== null) out.push(c)
    }
  }
  return out
}

interface Timing {
  grid: string
  km: number
  exactMs: number
  fastMs: number
  exactExp: number
  fastExp: number
  ratio: number
}

describe.skipIf(!existsSync(PUB))('real grids: parity, bound and timing (official pad + picker pads)', () => {
  const grids: RealGrid[] = []
  const timings: Timing[] = []

  beforeAll(async () => {
    const pad = J<{ pad: { lon: number; lat: number } }>('pad.json').pad
    grids.push(await loadReal('official nom_104', 'nom_104', pad))
    const fi = J<FieldsIndex>('fields/index.json')
    const idx = J<{ pads?: { id: string; lon: number; lat: number }[] } | { id: string; lon: number; lat: number }[]>('scenarios/pads/index.json')
    const list = Array.isArray(idx) ? idx : (idx.pads ?? [])
    for (const id of ['rank2', 'rank3', 'rank4']) {
      const p = list.find((x) => x.id === id)
      if (p && fi.fields[`pads/${id}/nom_104/t_home`]) grids.push(await loadReal(`${id} nom_104`, `pads/${id}/nom_104`, p))
    }
  }, 120_000)

  it('the fixtures are there: official grid + the three picker pads', () => {
    expect(grids.map((g) => g.name)).toEqual(['official nom_104', 'rank2 nom_104', 'rank3 nom_104', 'rank4 nom_104'])
  })

  it('exact mode equals LegRouter on pad <-> station legs and every long leg (cells, time, O2, tau)', () => {
    const stations = J<Station[]>('stations.json')
    let n = 0
    for (const r of grids) {
      const ref = new LegRouter(r.grid, r.model)
      const s = createLegSearch(r.grid, r.model)
      const pts = [r.pad, ...stations.map((st) => cellNear(r, st.lon, st.lat)).filter((c): c is number => c !== null)]
      const pairs: [number, number][] = []
      for (let i = 1; i < pts.length; i++) pairs.push([r.pad, pts[i]], [pts[i], r.pad])
      for (let i = 1; i + 1 < pts.length; i++) pairs.push([pts[i], pts[i + 1]])
      for (const t of longTargets(r)) pairs.push([r.pad, t])
      for (const [a, b] of pairs) {
        const want = ref.route(a, b)
        const got = s.searchLeg(a, b, { weight: 1, capMs: 1e9 })
        expect(got.leg, `${r.name} ${a}->${b}`).toEqual(want)
        expect(got.exact).toBe(true)
        n++
      }
    }
    expect(n).toBeGreaterThan(60)
  }, 300_000)

  it('fast mode (w = 1.6) on the long 2.4-3.4 km legs: cost <= w x fastest, within the cap, fewer expansions; timings', () => {
    const maxExact = { ms: 0 }
    for (const r of grids) {
      const s = createLegSearch(r.grid, r.model)
      for (const t of longTargets(r)) {
        const km = distKm(r, r.pad, t)
        expect(km).toBeGreaterThan(2.3)
        expect(km).toBeLessThan(3.5)
        s.searchLeg(r.pad, t, { weight: 1, capMs: 1e9 }) // warm-up (JIT), not timed
        const ex = s.searchLeg(r.pad, t, { weight: 1, capMs: 1e9 })
        const fa = s.searchLeg(r.pad, t, { weight: HEURISTIC_WEIGHT, capMs: 1e9 })
        if (!ex.leg) {
          expect(fa.leg).toBeNull()
          continue
        }
        expect(fa.leg).not.toBeNull()
        expect(fa.cost).toBeGreaterThanOrEqual(ex.cost - EPS)
        expect(fa.cost).toBeLessThanOrEqual(HEURISTIC_WEIGHT * ex.cost + EPS)
        expect(fa.expanded).toBeLessThanOrEqual(ex.expanded)
        maxExact.ms = Math.max(maxExact.ms, ex.ms)
        timings.push({ grid: r.name, km: Math.round(km * 100) / 100, exactMs: ex.ms, fastMs: fa.ms, exactExp: ex.expanded, fastExp: fa.expanded, ratio: fa.cost / ex.cost })
      }
    }
    expect(timings.length).toBeGreaterThan(20)
    // with the default cap (150 ms, real clock) every reachable long leg gets a path; how many needed
    // the greedy finish depends on the machine's load, so it is printed, not asserted
    let capped = 0
    for (const r of grids) {
      const s = createLegSearch(r.grid, r.model)
      for (const t of longTargets(r)) {
        const ex = s.refineLeg(r.pad, t, { capMs: 1e9 })
        const fa = s.searchLeg(r.pad, t)
        if (ex.leg === null) expect(fa.leg).toBeNull()
        else if (!fa.timedOut) expect(fa.leg, `${r.name} -> ${t}`).not.toBeNull()
        if (fa.timedOut) capped++
      }
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const sum = {
      legs: timings.length,
      exactMedMs: med(timings.map((x) => x.exactMs)),
      exactMaxMs: Math.max(...timings.map((x) => x.exactMs)),
      fastMedMs: med(timings.map((x) => x.fastMs)),
      fastMaxMs: Math.max(...timings.map((x) => x.fastMs)),
      expansionsMed: `${med(timings.map((x) => x.exactExp))} -> ${med(timings.map((x) => x.fastExp))}`,
      costRatioMed: med(timings.map((x) => x.ratio)),
      costRatioMax: Math.max(...timings.map((x) => x.ratio)),
      cappedAtDefaultCap: capped,
    }
    if (process.env.R2_TIMING_OUT) writeFileSync(process.env.R2_TIMING_OUT, JSON.stringify({ sum, timings }, null, 1))
    console.log(`[R2 timing] long legs 2.4-3.4 km, cap ${LEG_CAP_MS} ms, w = ${HEURISTIC_WEIGHT}: ${JSON.stringify(sum)}`)
  }, 300_000)

  it('a real long leg cut by the cap still returns a path (greedy finish), flagged timedOut', () => {
    const r = grids[0]
    const t = longTargets(r)[0]
    const res: SearchResult = createLegSearch(r.grid, r.model).searchLeg(r.pad, t, { weight: 1, capMs: 1, now: fakeClock(1) })
    expect(res.timedOut).toBe(true)
    expect(res.leg).not.toBeNull()
    expect(res.leg!.cells.at(-1)).toBe(t)
  })
})
