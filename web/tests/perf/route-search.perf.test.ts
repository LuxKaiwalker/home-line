// Plan-port perf probe (Q1, spec §4 "every edit <= 200 ms"): R2's fast leg search (weighted A*, per-leg
// cap LEG_CAP_MS) on the REAL 1480 x 1480 5 m grid of the official pad, per plan edit:
//   first feedback = the first re-routed leg of the edit is in (the worker posts partial legs at once)
//   final totals   = every leg the edit changed is in (totals and margin can be shown)
// Reports p50 / p95 / max (W0b's probe: median 153 ms but up to 697 ms on ~2.5 km legs with the exact
// router) and asserts p95(first feedback) <= 200 ms in fast mode. The exact router (LegRouter, what the
// Mission Planer runs today) is timed on the same legs for comparison only.
// Skips with a message when R2's search (edit/route/browser/search.ts) is not on this branch yet.
import { beforeAll, describe, expect, it } from 'vitest'
import { gradeModel, scenarioParams, type GradeModel } from '../../src/edit/route/map/physio'
import { LegRouter, type RouteGrid } from '../../src/edit/route/map/router'
import { LEG_CAP_MS } from '../../src/edit/route/browser/worker.types'
import { editLegs, fmtStats, loadRealGrid, stats, type RealGrid } from './realGrid'

const BUDGET_MS = 200
/** The part of R2's search.ts API used here (requests-I1.md "R2"); restated so this file compiles without it. */
interface SearchMod {
  createLegSearch(grid: RouteGrid, model: GradeModel): {
    searchLeg(from: number, to: number, opts?: { weight?: number; capMs?: number }): { leg: unknown | null; ms: number; timedOut: boolean }
  }
}
// import.meta.glob: {} when the file is missing (no failing import while R2 is not merged)
const searchMods = import.meta.glob<SearchMod>('../../src/edit/route/browser/search.ts')
const loadSearch = searchMods['../../src/edit/route/browser/search.ts'] as (() => Promise<SearchMod>) | undefined

if (!loadSearch) console.log('perf: SKIP route-search (fast mode): R2 edit/route/browser/search.ts is not on this branch')

describe.skipIf(!loadSearch)('route core perf: R2 fast search, real grid, per edit', () => {
  let g: RealGrid
  let mod: SearchMod
  beforeAll(async () => {
    const t0 = performance.now()
    ;[g, mod] = await Promise.all([loadRealGrid('nom_104'), loadSearch!()])
    console.log(`perf: real grid ${g.grid.width}x${g.grid.height} @ ${g.grid.resM} m loaded in ${(performance.now() - t0).toFixed(0)} ms; stations with access ${Object.keys(g.stations).join(' ')}`)
  }, 30_000)

  it(`fast mode: first feedback p95 <= ${BUDGET_MS} ms (weighted A*, cap ${LEG_CAP_MS} ms)`, () => {
    const model = gradeModel(scenarioParams('nom_104'))
    const search = mod.createLegSearch(g.grid, model)
    const edits = editLegs(g)
    search.searchLeg(edits[0].legs[0][0], edits[0].legs[0][1]) // warm-up (JIT); fresh legs below (no cache in LegSearch)
    const first: number[] = []
    const final: number[] = []
    const perLeg: number[] = []
    let capped = 0
    let missing = 0
    for (const e of edits) {
      const t0 = performance.now()
      let tFirst = -1
      for (const [a, b] of e.legs) {
        const r = search.searchLeg(a, b, { capMs: LEG_CAP_MS })
        perLeg.push(r.ms)
        if (r.timedOut) capped++
        if (!r.leg) missing++
        if (tFirst < 0) tFirst = performance.now() - t0
      }
      first.push(tFirst)
      final.push(performance.now() - t0)
    }
    console.log(`perf: fast search per edit (${edits.length} edits, ${perLeg.length} legs): first feedback ${fmtStats(first)}; final totals ${fmtStats(final)}; per leg ${fmtStats(perLeg)}; capped ${capped}, no path ${missing}`)
    expect(missing).toBe(0) // every station leg on the official pad's grid has a path
    expect(stats(first).p95).toBeLessThanOrEqual(BUDGET_MS)
  })

  // opt-in (HL_PERF_EXACT=1): up to ~6 s per edit on a loaded box, too slow for check.sh's 60 s
  it.skipIf(!process.env.HL_PERF_EXACT)('exact router (LegRouter, today\'s Mission Planer) on the same edits: reported, not asserted', () => {
    const router = new LegRouter(g.grid, gradeModel(scenarioParams('nom_104')))
    const edits = editLegs(g).slice(0, 8) // keep the suite <= 60 s on a loaded box
    const first: number[] = []
    const final: number[] = []
    for (const e of edits) {
      const t0 = performance.now()
      let tFirst = -1
      for (const [a, b] of e.legs) {
        router.route(a, b)
        if (tFirst < 0) tFirst = performance.now() - t0
      }
      first.push(tFirst)
      final.push(performance.now() - t0)
    }
    console.log(`perf: exact router per edit (${edits.length} edits): first feedback ${fmtStats(first)}; final totals ${fmtStats(final)}`)
    expect(first.length).toBe(edits.length)
  })
})
