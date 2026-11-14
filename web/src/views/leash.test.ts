import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { Rad } from '../data/types'
import { sliderStops, tauMin, uGyDayToMGyH } from './leash'

const conditions = parse(readFileSync(resolve(__dirname, '../../../config/conditions.yaml'), 'utf8'))
const rad = JSON.parse(readFileSync(resolve(__dirname, '../../public/data-dummy/conditions/rad.json'), 'utf8')) as Rad

describe('dose leash tau = 60 * D_allow / Ddot (config/conditions.yaml leash.formula)', () => {
  it('the config formula is the one implemented', () => {
    expect(conditions.leash.formula).toBe('tau_dose_min = 60 * D_allow / Ddot_mGy_per_h')
  })
  it('SPEC F14 example: 0.35 mGy/h peak, 0.5 mGy -> about 85.7 min', () => {
    expect(uGyDayToMGyH(8400)).toBeCloseTo(0.35, 12)
    expect(tauMin(0.5, 8400)).toBeCloseTo(85.714, 3)
  })
  it('recomputes the pipeline value in rad.json at its own D_allow (to its 0.1-min rounding)', () => {
    const t = tauMin(rad.leash.D_allow_mGy!, rad.storm_2024.peak_uGy_day)
    expect(Math.abs(t! - rad.leash.tau_min_at_peak!)).toBeLessThanOrEqual(0.05)
  })
  it('the default allowance in rad.json is the config default (D9)', () => {
    expect(rad.leash.D_allow_mGy).toBe(conditions.leash.d_allow_mgy)
  })
  it('linear in D_allow; unknown or zero rate gives null', () => {
    expect(tauMin(1, 8400)! / tauMin(0.25, 8400)!).toBeCloseTo(4, 12)
    expect(tauMin(0.5, null)).toBeNull()
    expect(tauMin(0.5, 0)).toBeNull()
  })
  it('slider stops', () => {
    expect(sliderStops(0.25, 1, 0.05)).toHaveLength(16)
    expect(sliderStops(0.25, 1, 0.05)[5]).toBe(0.5)
  })
})
