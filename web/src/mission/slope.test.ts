import { describe, expect, it } from 'vitest'
import { CITED } from '../config'
import { renderSlope, SLOPE_ALPHA, SLOPE_CLASSES, slopeClassOf } from './slope'

describe('slope classes follow config/site.yaml', () => {
  it('edges are the siting, tested and no-go limits, ascending', () => {
    expect(SLOPE_CLASSES.map((c) => c.maxDeg)).toEqual([CITED.sitingMaxSlopeDeg.value, CITED.flagBeyondTestedDeg.value, CITED.nogoNominalDeg.value, CITED.nogoOptimisticDeg.value, Infinity])
  })
  it('an edge value belongs to the class above it', () => {
    expect(slopeClassOf(0)).toBe(0)
    expect(slopeClassOf(CITED.sitingMaxSlopeDeg.value - 0.01)).toBe(0)
    expect(slopeClassOf(CITED.sitingMaxSlopeDeg.value)).toBe(1)
    expect(slopeClassOf(CITED.nogoNominalDeg.value)).toBe(3)
    expect(slopeClassOf(89)).toBe(4)
  })
})

describe('renderSlope', () => {
  it('colours known cells, leaves unknown transparent; counts × scale = degrees', () => {
    // 0.01 deg per count (fields/index.json slope): 300 = 3 deg, 2100 = 21 deg
    const rgba = renderSlope([300, 2100, 0], [1, 1, 0], 0.01)
    expect([...rgba.slice(0, 4)]).toEqual([...SLOPE_CLASSES[0].rgb, SLOPE_ALPHA])
    expect([...rgba.slice(4, 8)]).toEqual([...SLOPE_CLASSES[3].rgb, SLOPE_ALPHA])
    expect(rgba[11]).toBe(0)
  })
})
