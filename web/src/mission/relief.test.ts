import { describe, expect, it } from 'vitest'
import {
  BASE_GREY,
  buildUnitField,
  contourInterval,
  coverage,
  RAMP,
  renderRelief,
  ROCKS_FILE,
  UNIT_ALPHA_MAX,
  UNIT_ALPHA_MIN,
  UNIT_CELL_M,
  UNIT_SHARE_FLOOR,
  UNIT_SIGMA_M,
  unitAt,
  UNITS_FILE,
} from './relief'

const flat = (w: number, h: number, z = -4100) => new Float32Array(w * h).fill(z)
/** Plane rising east at grade theta (deg), cell size mpp. */
const ramp = (w: number, h: number, deg: number, mpp: number) => {
  const e = new Float32Array(w * h)
  const t = Math.tan((deg * Math.PI) / 180)
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) e[r * w + c] = -4100 + c * mpp * t
  return e
}

describe('contour interval (Unity MarsElevationMap rule)', () => {
  it('flat ground: the finest interval, 5 m', () => {
    expect(contourInterval(flat(20, 20), 20, 20, 5)).toBe(5)
  })
  it('10 deg everywhere at 5 m cells: 5 m gives 5.67 cells < 6, so 10 m', () => {
    expect(contourInterval(ramp(40, 40, 10, 5), 40, 40, 5)).toBe(10)
  })
  it('30 deg at 5 m cells: 20 m gives 6.9 cells', () => {
    expect(contourInterval(ramp(40, 40, 30, 5), 40, 40, 5)).toBe(20)
  })
})

describe('contour line coverage', () => {
  it('on a level: full; half an interval away: none', () => {
    expect(coverage(3, 5, 1, 1)).toBe(1)
    expect(coverage(3.5, 5, 1, 1)).toBe(0)
    expect(coverage(-3, 5, 1, 1)).toBe(1) // negative elevations (Mars areoid) too
  })
})

describe('mineral units from the rock population (Unity MarsElevationMap)', () => {
  // A 10 x 10 grid of 32 m cells; frame in degrees 0..10 so lon d sits at d * 32 m east.
  const frame = { w: 0, s: 0, e: 10, n: 10 }
  const size = 10 * UNIT_CELL_M
  /** lon/lat of grid node (i, j): node centres sit half a cell in from the corner */
  const node = (i: number, j: number): [number, number] => [i + 0.5, j + 0.5]
  const at = (i: number, j: number) => [(i + 0.5) * UNIT_CELL_M, (j + 0.5) * UNIT_CELL_M] as const

  it('Unity constants: 32 m cells, sigma 70 m, alpha 0.35..0.60, share floor 0.3', () => {
    expect([UNIT_CELL_M, UNIT_SIGMA_M, UNIT_ALPHA_MIN, UNIT_ALPHA_MAX, UNIT_SHARE_FLOOR]).toEqual([32, 70, 0.35, 0.6, 0.3])
  })

  it('one rock: its node weighs exactly 1, the neighbour exp(-32^2 / (2 * 70^2)); full dominance gives alpha 0.60', () => {
    const f = buildUnitField([[...node(4, 4), 0]], ['mirador-sulfate'], frame, size, size)
    expect(f.grid[4 * 10 + 4]).toBeCloseTo(1, 6)
    expect(f.grid[4 * 10 + 5]).toBeCloseTo(Math.exp(-(32 * 32) / (2 * 70 * 70)), 6)
    const p = unitAt(f, ...at(4, 4))
    expect(f.units[p.index].id).toBe('mirador-sulfate')
    expect(p.alpha).toBeCloseTo(UNIT_ALPHA_MAX, 6)
  })

  it('beyond 3 sigma (210 m) nothing is splatted: clear', () => {
    const f = buildUnitField([[...node(0, 0), 0]], ['mirador-sulfate'], frame, size, size)
    expect(f.grid[9 * 10 + 9]).toBe(0)
    expect(unitAt(f, ...at(9, 9)).alpha).toBe(0)
  })

  it('mixed: 2 clay + 1 sulfate on one node: clay wins, alpha from share 2/3', () => {
    const f = buildUnitField(
      [
        [...node(5, 5), 0],
        [...node(5, 5), 0],
        [...node(5, 5), 1],
      ],
      ['glen-torridon-clay', 'mirador-sulfate'],
      frame,
      size,
      size,
    )
    const p = unitAt(f, ...at(5, 5))
    expect(f.units[p.index].id).toBe('glen-torridon-clay')
    const share = (2 / 3 - 0.3) / 0.7
    expect(p.alpha).toBeCloseTo(0.35 + 0.25 * share, 6)
  })

  it('units follow the rock database order, not the order rocks are met', () => {
    const f = buildUnitField(
      [
        [...node(1, 1), 0],
        [...node(2, 2), 1],
        [...node(3, 3), 2],
      ],
      ['iron-meteorite', 'stimson-sandstone', 'glen-torridon-clay'],
      frame,
      size,
      size,
    )
    expect(f.units.map((u) => u.id)).toEqual(['glen-torridon-clay', 'stimson-sandstone', 'iron-meteorite'])
    expect(f.units[2].rgb).toEqual([0xb5, 0xd6, 0x5a]) // Unity lime meteorite
  })

  it('the exported Unity rocks: 2544, every class in the rock database', () => {
    expect(ROCKS_FILE.rocks.length).toBe(2544)
    const known = UNITS_FILE.classes.map((c) => c.id)
    for (const id of ROCKS_FILE.classes) expect(known).toContain(id)
  })
})

describe('relief rendering', () => {
  it('topography on flat ground: the ramp colour at that height, unshaded, opaque', () => {
    const w = 8
    const e = flat(w, w)
    e[0] = -4200 // sets the range so -4100 sits mid-ramp
    e[w * w - 1] = -4000
    const img = renderRelief(e, w, w, 5, 'topo', null)
    const i = (4 * w + 4) * 4
    // t = 0.5 between RAMP stops 0.30 and 0.65; contours: -4100 is a 5 m level, so blend toward contour ink
    expect(img.rgba[i + 3]).toBe(255)
    expect(img.contourM).toBe(5)
  })

  it('material base on flat ground is the neutral grey; a lone rock tints its cell at alpha 0.60', () => {
    const w = 6
    const e = flat(w, w, -4300)
    // 32 m cells = unit grid cells; cell (row 2, col 3) centre is node (3, 6 - 2 - 1)
    const f = buildUnitField([[3.5, 3.5, 0]], ['mirador-sulfate'], { w: 0, s: 0, e: 6, n: 6 }, 6 * 32, 6 * 32)
    const img = renderRelief(e, w, w, 32, 'material', f)
    const i = (2 * w + 3) * 4
    const rgb = f.units[0].rgb
    for (let k = 0; k < 3; k++) expect(img.rgba[i + k]).toBe(Math.round(BASE_GREY + (rgb[k] - BASE_GREY) * 0.6))
    expect(img.unitCells.get('mirador-sulfate')).toBeGreaterThan(0)
    const plain = renderRelief(e, w, w, 32, 'material', null)
    expect(plain.rgba[i]).toBe(BASE_GREY)
  })

  it('edge cells have no slope estimate and stay transparent (as Unity)', () => {
    const img = renderRelief(flat(5, 5), 5, 5, 5, 'topo', null)
    expect(img.rgba[3]).toBe(0)
  })

  it('ramp stops are those of Unity', () => {
    expect(RAMP.map((s) => s.t)).toEqual([0, 0.3, 0.65, 1])
  })
})
