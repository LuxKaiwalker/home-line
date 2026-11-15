// PORT U3: copy of mission/marstime.test.ts. Known answers: WS4's clock.json (pipeline/conditions/marstime.py + sun.py, Mars24) for the H0
// instant and the simulated EVA (D31). The browser port must reproduce them.
import { describe, expect, it } from 'vitest'
import { CLOCK, evaClock, formatHms, lmstH, ltstH, marsTime, mslSol, sunPosition, sunriseSunset, tDarkMin, utcAtLmst, utcAtSolLmst } from './marstime'

const SUN = { lat: -4.77748, lon: 137.401783 } // clock.json site (D21 pad)
const H0 = Date.parse('2026-11-14T08:00:00Z')
const EVA_ROUNDED = Date.parse('2026-11-14T10:51:18Z')
/** the exact 09:00 LMST instant (clock.json rounds start_utc to the second; t_dark and the sun use the exact one) */
const EVA = utcAtLmst(Date.parse(CLOCK.evaSolRefUtc), CLOCK.evaStartLmstH, CLOCK.galeLonEastDeg)

describe('Mars24 port vs clock.json (WS4)', () => {
  it('H0: sol, LMST, LTST, Ls, Mars year', () => {
    expect(mslSol(H0, CLOCK.galeLonEastDeg)).toBe(5074)
    expect(formatHms(lmstH(H0, CLOCK.galeLonEastDeg))).toBe('06:13:17')
    expect(formatHms(ltstH(H0, CLOCK.galeLonEastDeg))).toBe('05:46:48')
    expect(marsTime(H0).lsDeg).toBeCloseTo(21.7306, 4)
    expect(marsTime(H0).marsYear).toBe(39)
  })
  it('H0: sun azimuth and elevation at the pad', () => {
    const s = sunPosition(H0, SUN.lat, SUN.lon)
    expect(s.azimuthDeg).toBeCloseTo(81.125, 3)
    expect(s.elevationDeg).toBeCloseTo(-4.012, 3)
  })
  it('EVA start = 09:00 LMST on the sol of eva_sol_ref_utc', () => {
    expect(Math.abs(EVA - EVA_ROUNDED)).toBeLessThanOrEqual(500)
  })
  it('sol + LMST inverse lands on the same instant', () => {
    expect(Math.abs(utcAtSolLmst(5074, 9, CLOCK.galeLonEastDeg) - EVA)).toBeLessThan(500)
    expect(mslSol(utcAtSolLmst(4200, 13.5, CLOCK.galeLonEastDeg), CLOCK.galeLonEastDeg)).toBe(4200)
  })
  it('t_dark and sunset on the flat horizon', () => {
    expect(tDarkMin(EVA, SUN.lat, SUN.lon, CLOCK.sunHorizonDeg)!).toBeCloseTo(578.67, 2)
    const rs = sunriseSunset(EVA, SUN.lat, SUN.lon, CLOCK.sunHorizonDeg)!
    expect(new Date(Math.round(rs.sunset / 1000) * 1000).toISOString()).toBe('2026-11-14T20:29:59.000Z')
    expect(new Date(Math.round(rs.sunrise / 1000) * 1000).toISOString()).toBe('2026-11-14T08:16:45.000Z')
  })
  it('EVA sun series row 0 (t = 0): az 74.811, el 36.697', () => {
    const s = sunPosition(EVA, SUN.lat, SUN.lon)
    expect(s.azimuthDeg).toBeCloseTo(74.811, 3)
    expect(s.elevationDeg).toBeCloseTo(36.697, 3)
  })
  it('evaClock bundles it; the sun already down gives t_dark = null', () => {
    const c = evaClock(EVA, SUN)
    expect(c.startUtc).toBe('2026-11-14T10:51:18Z')
    expect(c.lmst).toBe('09:00:00')
    expect(c.mslSol).toBe(5074)
    expect(c.tDarkMin!).toBeCloseTo(578.67, 2)
    expect(evaClock(H0, SUN).tDarkMin).toBeNull()
  })
  it('refuses dates outside the leap-second table', () => {
    expect(() => marsTime(Date.parse('2027-03-01T00:00:00Z'))).toThrow(/leap-second/)
  })
})
