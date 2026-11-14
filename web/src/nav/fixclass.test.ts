// KATs for the fix-interval (D_max) classes: same bins as pipeline/navigation/fixinterval.py
// (np.digitize on config/nav.yaml fix_interval.classes_m) and the same labels as the contract.
import { describe, expect, it } from 'vitest'
import summarySchema from '../../../contracts/fix_interval_summary.schema.json'
import { classifyRGBA, classLabels, classOf, decodeRGBA, valueAt } from './fixclass'
import { NAV } from './config'

describe('D_max classes', () => {
  it('labels from config/nav.yaml equal the contract keys of class_area_pct, in order', () => {
    const keys = (summarySchema as { properties: { class_area_pct: { required: string[] } } }).properties.class_area_pct.required
    expect(classLabels(NAV.classesM)).toEqual(keys)
  })
  it('bins like np.digitize (left-closed): edge values go to the upper class', () => {
    const e = [100, 300, 1000]
    expect([0.5, 99.9, 100, 299.99, 300, 999, 1000, 5000].map((v) => classOf(v, e))).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })
  it('classifies a decoded field: unknown and 0 (outside the homeline) stay transparent', () => {
    // 4 pixels: unknown, 0 m, 150 m, 2000 m (1 m per count)
    const f = { width: 4, height: 1, scale: 1, counts: new Uint16Array([0, 0, 150, 2000]), known: new Uint8Array([0, 1, 1, 1]) }
    const colours: [number, number, number][] = [
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
      [4, 4, 4],
    ]
    const out = classifyRGBA(f, [100, 300, 1000], colours, 200)
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...out.slice(4, 8)]).toEqual([0, 0, 0, 0])
    expect([...out.slice(8, 12)]).toEqual([2, 2, 2, 200])
    expect([...out.slice(12, 16)]).toEqual([4, 4, 4, 200])
  })
})

describe('D_max field decoding (contracts/README.md "Field PNGs": value = (R*256 + G) * scale, A = 0 unknown)', () => {
  it('round-trips counts and unknowns, and looks up lon/lat on pixel-edge bounds', () => {
    // 2 x 2: 0 m, 1234 m, unknown, 65535 m
    const rgba = [0, 0, 0, 255, 4, 210, 0, 255, 9, 9, 0, 0, 255, 255, 0, 255]
    const f = decodeRGBA(rgba, 2, 2, 1)
    expect([...f.counts]).toEqual([0, 1234, 2313, 65535])
    expect([...f.known]).toEqual([1, 1, 0, 1])
    const b: [number, number, number, number] = [10, 20, 12, 22] // w, s, e, n
    expect(valueAt(f, b, 10.5, 21.5)).toBe(0) // NW pixel
    expect(valueAt(f, b, 11.5, 21.5)).toBe(1234) // NE
    expect(valueAt(f, b, 10.5, 20.5)).toBeNull() // SW unknown
    expect(valueAt(f, b, 11.5, 20.5)).toBe(65535)
    expect(valueAt(f, b, 9.9, 21)).toBeNull() // off the grid
  })
  it('refuses a byte count that does not match the size', () => {
    expect(() => decodeRGBA([0, 0, 0, 255], 2, 2, 1)).toThrow()
  })
})
