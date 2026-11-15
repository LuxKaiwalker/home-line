// Plan-port perf probe (W0b, spec §4): one plan edit re-routes one leg in the browser route core
// (edit/route/browser/worker.ts createRouteWorkerHandler, the handler the route worker runs; PORT I3: was
// mission/legsRoute.ts, deleted with the Mission Planer). Budget: <= 200 ms per edit. The grid has the real
// Mission Planer size (fields/index.json: 1480 x 1480 at 5 m) with synthetic relief and walls, so the probe
// needs no data files; legs are typical stop-to-stop lengths (0.5-3 km) incl. detours around walls.
// p50 / p95 / max are printed (Q1). Exact mode, uncapped (= map/router.ts LegRouter, worker parity tests):
// a baseline only: the 200 ms per-edit budget applies to the fast mode the Plan view edits with (R2,
// asserted in route-search.perf.test.ts on the real grid). Q1 20:50: the median assertion was dropped: at
// load avg ~80 (15 agents) the exact median was 256-426 ms, which failed every package's check.sh perf
// step for a router the edit path no longer uses.
import { describe, expect, it } from 'vitest'
import { createRouteWorkerHandler } from '../../src/edit/route/browser/worker'
import type { RouteWorkerResponse } from '../../src/edit/route/browser/worker.types'
import { scenarioParams } from '../../src/edit/route/map/physio'
import type { RouteGrid } from '../../src/edit/route/map/router'
import { fmtStats } from './realGrid'

const W = 1480
const H = 1480
const RES_M = 5
const BUDGET_MS = 200

function grid(): RouteGrid {
  const elev = new Float32Array(W * H)
  const passable = new Uint8Array(W * H)
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const i = r * W + c
      elev[i] = 40 * Math.sin(r / 90) + 25 * Math.cos(c / 70) + 0.02 * r + ((r * 31 + c * 17) % 11) * 0.3
      // walls with gaps, so some legs detour
      const wall = (r % 300 === 150 && c % 400 > 40) || (c % 350 === 175 && r % 500 > 60)
      passable[i] = wall ? 0 : 1
    }
  return { width: W, height: H, resM: RES_M, elev, passable }
}

const at = (r: number, c: number): number => r * W + c

describe('route core perf (plan edit = one leg)', () => {
  it(`routes every leg (exact router baseline; budget ${BUDGET_MS} ms is asserted for fast mode)`, () => {
    // synchronous worker: deferred steps run at once, so one 'route' request returns with its final legs
    const out: RouteWorkerResponse[] = []
    const h = createRouteWorkerHandler((m) => void out.push(m), { defer: (fn) => fn() })
    h.handle({ type: 'env', env: { padId: 'official', scenario: 'nom_104', grid: grid(), params: scenarioParams('nom_104'), padCell: at(700, 700) } })
    let seq = 0
    const routeLeg = (a: number, b: number) => {
      out.length = 0
      h.handle({ type: 'route', seq: ++seq, padId: 'official', cells: [a, b], mode: 'exact', weight: 1, legCapMs: 600_000, refine: false })
      const fin = out.find((m): m is Extract<RouteWorkerResponse, { type: 'legs' }> => m.type === 'legs' && m.final)
      return fin?.legs[0]
    }
    const legs: [number, number][] = [
      [at(700, 700), at(760, 820)], // ~0.7 km
      [at(200, 200), at(420, 520)], // crosses a wall row
      [at(900, 300), at(1100, 700)],
      [at(1300, 1300), at(1000, 900)],
      [at(500, 1200), at(800, 1000)],
      [at(100, 900), at(500, 900)], // ~2 km straight-ish, crosses a wall
      [at(1200, 200), at(1400, 600)],
      [at(600, 600), at(600, 1100)], // ~2.5 km, crosses wall columns
    ]
    routeLeg(legs[0][1], legs[0][0]) // warm-up (JIT); the reverse leg, so the timed one is not a cache hit
    const ms: number[] = []
    let routed = 0
    for (const [a, b] of legs) {
      const t0 = performance.now()
      const leg = routeLeg(a, b)
      ms.push(performance.now() - t0)
      if (leg?.leg && leg.mode === 'exact' && !leg.capped) routed++
    }
    const sorted = [...ms].sort((x, y) => x - y)
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log(`perf: route-leg (exact, synthetic 1480² grid) ${fmtStats(ms)}, all [${ms.map((x) => x.toFixed(0)).join(', ')}] ms`)
    expect(routed).toBe(legs.length)
    if (median > BUDGET_MS) console.log(`perf: NOTE exact router median ${median.toFixed(0)} ms > ${BUDGET_MS} ms (baseline only, not the edit path)`)
  })
})
