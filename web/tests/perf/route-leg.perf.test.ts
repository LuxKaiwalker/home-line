// Plan-port perf probe (W0b, spec §4): one plan edit re-routes one leg in the browser route core
// (mission/legsRoute.ts handler -> router.ts LegRouter, the code the legs worker runs). Budget:
// <= 200 ms per edit. The grid has the real Mission Planer size (fields/index.json: 1480 x 1480 at
// 5 m) with synthetic relief and walls, so the probe needs no data files; legs are typical stop-to-stop
// lengths (0.5-3 km) incl. detours around walls. p50 / p95 / max are printed (Q1). This is the exact
// router of today's Mission Planer, a baseline only: the 200 ms per-edit budget applies to the fast
// mode the Plan view edits with (R2, asserted in route-search.perf.test.ts on the real grid). Q1 20:50:
// the median assertion was dropped: at load avg ~80 (15 agents) the exact median was 256-426 ms, which
// failed every package's check.sh perf step for a router the edit path no longer uses.
import { describe, expect, it } from 'vitest'
import { handleLegsMessage, type LegsRequest, type LegsState } from '../../src/mission/legsRoute'
import { scenarioParams } from '../../src/mission/physio'
import type { RouteGrid } from '../../src/mission/router'
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
    const state: LegsState = { router: null }
    handleLegsMessage(state, { type: 'init', grid: grid(), params: scenarioParams('nom_104') } as LegsRequest)
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
    handleLegsMessage(state, { type: 'route', a: legs[0][0], b: legs[0][1] }) // warm-up (JIT)
    const ms: number[] = []
    let routed = 0
    for (const [a, b] of legs) {
      const t0 = performance.now()
      const out = handleLegsMessage(state, { type: 'route', a, b })
      ms.push(performance.now() - t0)
      if (out?.leg) routed++
    }
    const sorted = [...ms].sort((x, y) => x - y)
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log(`perf: route-leg (exact, synthetic 1480² grid) ${fmtStats(ms)}, all [${ms.map((x) => x.toFixed(0)).join(', ')}] ms`)
    expect(routed).toBe(legs.length)
    if (median > BUDGET_MS) console.log(`perf: NOTE exact router median ${median.toFixed(0)} ms > ${BUDGET_MS} ms (baseline only, not the edit path)`)
  })
})
