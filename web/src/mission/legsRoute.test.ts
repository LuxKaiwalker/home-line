// J1h: legs routed by the worker's handler equal LegRouter.route on the main thread (same code, same
// model), after the grid and the scenario Params have gone through structured cloning as postMessage does.
import { describe, expect, it } from 'vitest'
import { handleLegsMessage, type LegsRequest, type LegsState } from './legsRoute'
import { gradeModel, scenarioParams } from './physio'
import { LegRouter, type RouteGrid } from './router'

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

describe('legs worker handler (J1h)', () => {
  it('routes exactly as the main-thread LegRouter, including no-route legs', () => {
    for (const sid of ['nom_104', 'con_104', 'opt_104']) {
      const g = grid(60, 60)
      const direct = new LegRouter(g, gradeModel(scenarioParams(sid)))
      const state: LegsState = { router: null }
      const init = structuredClone({ type: 'init', grid: { ...g, elev: g.elev.slice(), passable: g.passable.slice() }, params: scenarioParams(sid) }) as LegsRequest
      expect(handleLegsMessage(state, init)).toBeNull()
      const pairs: [number, number][] = [
        [61, 3540],
        [5 * 60 + 2, 50 * 60 + 58],
        [0, 59 * 60 + 59],
        [100, 100],
        [20 * 60 + 10, 1], // blocked start: null
        [3540, 61],
      ]
      for (const [a, b] of pairs) {
        const out = handleLegsMessage(state, structuredClone({ type: 'route', a, b }) as LegsRequest)
        expect(out).toEqual({ a, b, leg: direct.route(a, b) })
      }
    }
  })

  it('refuses to route before init', () => {
    expect(() => handleLegsMessage({ router: null }, { type: 'route', a: 0, b: 1 })).toThrow()
  })
})
