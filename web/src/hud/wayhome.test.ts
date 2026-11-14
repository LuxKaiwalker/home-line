// Way-home path from the pointer field (F18 drag-anywhere; {scenario}/pointer is a proposal, not
// in contracts v1.1.0). The browser follows the pointer pixel to pixel; it never routes. Same
// cases as tests/test_fields_png.py test_pointer_values_and_follow.
import { describe, expect, it } from 'vitest'
import { decodeRGBA, FieldGrid } from './fields'
import { PointerField } from './wayhome'

const STENCIL: [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
  [-2, -1], [-2, 1], [2, -1], [2, 1],
  [-1, -2], [-1, 2], [1, -2], [1, 2],
]

/** Synthetic pointer field: move index per pixel, null = A = 0. 1 m pixels. */
function synth(rows: (number | null)[][]): FieldGrid {
  const H = rows.length
  const W = rows[0].length
  const rgba = new Uint8Array(W * H * 4)
  rows.forEach((r, i) =>
    r.forEach((v, j) => {
      const k = (i * W + j) * 4
      if (v === null) return
      rgba[k] = v >> 8
      rgba[k + 1] = v & 255
      rgba[k + 3] = 255
    }),
  )
  return new FieldGrid({ bounds: [0, 0, W, H], width: W, height: H, res_m: 1 }, decodeRGBA(rgba, W, H, 1), 'move')
}

describe('PointerField', () => {
  it('follows moves to a no-move pixel (as fields_png.follow_pointer)', () => {
    const g = synth([
      [null, null, null],
      [null, null, null],
      [3, 5, null], // (2,0) east -> (2,1) north-east -> (1,2) stop
    ])
    const pf = new PointerField(g, STENCIL)
    expect(pf.followPixels(2, 0)).toEqual({ pixels: [[2, 0], [2, 1], [1, 2]], end: 'stop' })
  })
  it('reports cycles and moves off the grid', () => {
    expect(new PointerField(synth([[3, 2]]), STENCIL).followPixels(0, 0).end).toBe('cycle')
    expect(new PointerField(synth([[0]]), STENCIL).followPixels(0, 0)).toEqual({ pixels: [[0, 0]], end: 'outside' })
  })
  it('pathFrom: starts at the position, reaches the pad pixel', () => {
    const g = synth([
      [null, null, null],
      [null, null, null],
      [3, 5, null],
    ])
    const pf = new PointerField(g, STENCIL)
    const start = g.lonLatOf(2, 0)
    const w = pf.pathFrom(start[0], start[1], g.lonLatOf(1, 2))!
    expect(w.coords[0]).toEqual(start)
    expect(w.coords.length).toBe(3)
    expect(w.reachesPad).toBe(true)
    expect(w.startKnown).toBe(true)
    const u = pf.pathFrom(...g.lonLatOf(0, 0), g.lonLatOf(1, 2))!
    expect(u.startKnown).toBe(false)
    expect(pf.pathFrom(-5, -5, g.lonLatOf(1, 2))).toBeNull()
  })
  it('refuses a move index beyond the stencil', () => {
    expect(() => new PointerField(synth([[16]]), STENCIL)).toThrow()
  })
})
