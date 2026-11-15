// Mars clock and sun in the browser: a line-by-line port of WS4's pipeline/conditions/marstime.py
// and sun.py (Mars24, Allison & McEwen 2000, steps A-1 .. D-6 of the GISS algorithm page), so the
// Mission Planer can move the EVA start and recompute LMST, the mission sol, the sun and the
// minutes to darkness. The known-answer test (marstime.test.ts) checks it against clock.json,
// which the Python produced. Site constants come from config/conditions.yaml clock.
//
// Longitudes are planetocentric EAST; LMST = MST + lon_E/15 (as marstime.py).
import conditionsRaw from '../../../config/conditions.yaml'
import { cfg } from '../config'

/** conditions.yaml clock values used here (rule 2: every constant from config/). */
export const CLOCK = {
  galeLonEastDeg: cfg<number>(conditionsRaw, 'clock.gale_lon_east_deg'),
  mslLandingUtc: cfg<string>(conditionsRaw, 'clock.msl_landing_utc'),
  marsYearEpochUtc: cfg<string>(conditionsRaw, 'clock.mars_year_epoch_utc'),
  evaStartLmstH: cfg<number>(conditionsRaw, 'clock.eva_start_lmst_h'),
  evaSolRefUtc: cfg<string>(conditionsRaw, 'clock.eva_sol_ref_utc'),
  sunHorizonDeg: cfg<number>(conditionsRaw, 'clock.sun_horizon_elevation_deg'),
}

// TAI - UTC (s) from each date: IERS Bulletin C (as marstime.py). Valid until 2027-01-01.
const TAI_MINUS_UTC: [number, number][] = (
  [
    [1972, 1, 10], [1972, 7, 11], [1973, 1, 12], [1974, 1, 13], [1975, 1, 14], [1976, 1, 15], [1977, 1, 16], [1978, 1, 17],
    [1979, 1, 18], [1980, 1, 19], [1981, 7, 20], [1982, 7, 21], [1983, 7, 22], [1985, 7, 23], [1988, 1, 24], [1990, 1, 25],
    [1991, 1, 26], [1992, 7, 27], [1993, 7, 28], [1994, 7, 29], [1996, 1, 30], [1997, 7, 31], [1999, 1, 32], [2006, 1, 33],
    [2009, 1, 34], [2012, 7, 35], [2015, 7, 36], [2017, 1, 37],
  ] as const
).map(([y, m, s]) => [Date.UTC(y, m - 1, 1), s])
/** First instant the leap-second table no longer covers (marstime.py _LEAP_VALID_UNTIL). */
export const LEAP_VALID_UNTIL_MS = Date.UTC(2027, 0, 1)
const TT_MINUS_TAI_S = 32.184
export const SOL_IN_DAYS = 1.0274912517
const UNIX_JD = 2440587.5
const J2000 = 2451545.0
const PBS: [number, number, number][] = [
  [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704], [0.002, 2.4694, 95.528], [0.0018, 32.8493, 49.095],
]

const D2R = Math.PI / 180
const sin = (x: number) => Math.sin(x * D2R)
const cos = (x: number) => Math.cos(x * D2R)
const mod = (a: number, n: number) => ((a % n) + n) % n

/** A-4: TT - UTC in seconds; throws outside the leap-second table (1972 .. 2026). */
export function ttMinusUtcS(ms: number): number {
  if (!(ms >= TAI_MINUS_UTC[0][0]) || ms >= LEAP_VALID_UNTIL_MS) throw new Error(`${new Date(ms).toISOString()} is outside the leap-second table (1972-2026)`)
  let s = TAI_MINUS_UTC[0][1]
  for (const [start, v] of TAI_MINUS_UTC) if (ms >= start) s = v
  return s + TT_MINUS_TAI_S
}

function orbit(dt: number): { m: number; alpha: number; nuM: number } {
  const m = 19.3871 + 0.52402073 * dt // B-1
  const alpha = 270.3871 + 0.524038496 * dt // B-2
  let pbs = 0
  for (const [a, tau, phi] of PBS) pbs += a * cos((0.985626 * dt) / tau + phi) // B-3
  const nuM = (10.691 + 3.0e-7 * dt) * sin(m) + 0.623 * sin(2 * m) + 0.05 * sin(3 * m) + 0.005 * sin(4 * m) + 0.0005 * sin(5 * m) + pbs // B-4
  return { m, alpha, nuM }
}

/** dt days since J2000 (TT) for a UTC instant in ms. */
function dtJ2000(ms: number): { dt: number; ttUtc: number } {
  const ttUtc = ttMinusUtcS(ms)
  const unixD = ms / 86400000
  return { dt: unixD + ttUtc / 86400 + (UNIX_JD - J2000), ttUtc }
}

let myOffset: number | null = null
function marsYearOffset(): number {
  if (myOffset === null) {
    const dt = Date.parse(CLOCK.marsYearEpochUtc) / 86400000 + (UNIX_JD - J2000)
    const { alpha, nuM } = orbit(dt)
    myOffset = 1 - Math.round((alpha + nuM) / 360)
  }
  return myOffset
}

export interface MarsTime {
  ms: number
  ttMinusUtcS: number
  lsDeg: number
  marsYear: number
  eotDeg: number
  msd: number
  /** MST at the prime meridian (Coordinated Mars Time), hours */
  mtcH: number
  subsolarLonWestDeg: number
  declinationDeg: number
}

export function marsTime(ms: number): MarsTime {
  const { dt, ttUtc } = dtJ2000(ms)
  const { alpha, nuM } = orbit(dt)
  const lsU = alpha + nuM // B-5
  const ls = mod(lsU, 360)
  const eot = 2.861 * sin(2 * ls) - 0.071 * sin(4 * ls) + 0.002 * sin(6 * ls) - nuM // C-1
  const msd = (dt - 4.5) / SOL_IN_DAYS + 44796.0 - 0.0009626 // C-2
  const mtc = mod(24 * msd, 24)
  const subsolarW = mod(mtc * 15 + eot + 180, 360) // C-5
  const dec = Math.asin(0.42565 * sin(ls)) / D2R + 0.25 * sin(ls) // D-1
  return { ms, ttMinusUtcS: ttUtc, lsDeg: ls, marsYear: Math.floor(lsU / 360) + marsYearOffset(), eotDeg: eot, msd, mtcH: mtc, subsolarLonWestDeg: subsolarW, declinationDeg: dec }
}

/** C-3: local mean solar time, hours in [0, 24). */
export function lmstH(ms: number, lonE: number): number {
  return mod(marsTime(ms).mtcH + lonE / 15, 24)
}

/** C-4: local true solar time, hours in [0, 24). */
export function ltstH(ms: number, lonE: number): number {
  const mt = marsTime(ms)
  return mod(mt.mtcH + lonE / 15 + mt.eotDeg / 15, 24)
}

function localMsd(ms: number, lonE: number): number {
  return marsTime(ms).msd + lonE / 360
}

/** Curiosity mission sol at lonE (landing = sol 0, config clock.msl_landing_utc). */
export function mslSol(ms: number, lonE: number): number {
  return Math.floor(localMsd(ms, lonE)) - Math.floor(localMsd(Date.parse(CLOCK.mslLandingUtc), lonE))
}

/** UTC (ms) at which the local sol containing refMs reaches lmstHours (exact inverse of C-2/C-3). */
export function utcAtLmst(refMs: number, lmstHours: number, lonE: number): number {
  const ref = marsTime(refMs)
  const target = Math.floor(ref.msd + lonE / 360) + lmstHours / 24 - lonE / 360
  const dt = (target - 44796.0 + 0.0009626) * SOL_IN_DAYS + 4.5
  return ((dt - (UNIX_JD - J2000)) * 86400 - ref.ttMinusUtcS) * 1000
}

/** UTC (ms) when mission sol `sol` reaches lmstHours at lonE. */
export function utcAtSolLmst(sol: number, lmstHours: number, lonE: number): number {
  const landing = Date.parse(CLOCK.mslLandingUtc)
  const base = Math.floor(localMsd(landing, lonE))
  // A reference instant inside the wanted local sol (its local noon), then the exact inverse.
  const msdNoon = base + sol + 0.5 - lonE / 360
  const dt = (msdNoon - 44796.0 + 0.0009626) * SOL_IN_DAYS + 4.5
  const approx = (dt - (UNIX_JD - J2000)) * 86400000 - 69184 // TT-UTC < 70 s; noon leaves ample room
  return utcAtLmst(approx, lmstHours, lonE)
}

export interface SunPosition {
  azimuthDeg: number
  elevationDeg: number
}

/** D-5 / D-6: sun's centre (no refraction), azimuth clockwise from north. */
export function sunPosition(ms: number, latDeg: number, lonE: number): SunPosition {
  const mt = marsTime(ms)
  const dLam = (-lonE - mt.subsolarLonWestDeg) * D2R
  const phi = latDeg * D2R
  const dec = mt.declinationDeg * D2R
  const cosZ = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(dLam)
  const z = Math.acos(Math.max(-1, Math.min(1, cosZ))) / D2R
  const a = Math.atan2(Math.sin(dLam), Math.cos(phi) * Math.tan(dec) - Math.sin(phi) * Math.cos(dLam)) / D2R
  return { azimuthDeg: mod(a, 360), elevationDeg: 90 - z }
}

function bisect(f: (ms: number) => number, a: number, b: number): number {
  let fa = f(a)
  while (b - a > 1) {
    const m = a + (b - a) / 2
    const fm = f(m)
    if (fm > 0 === fa > 0) {
      a = m
      fa = fm
    } else b = m
  }
  return a + (b - a) / 2
}

/** Minutes from startMs until the sun's centre is below a flat horizon at horizonDeg (sun.t_dark_min,
 *  flat-horizon form): 1-min scan then bisection to 1 ms; null if the sun is already down at the
 *  start or does not set within maxMin. */
export function tDarkMin(startMs: number, latDeg: number, lonE: number, horizonDeg: number, maxMin = 24 * 60): number | null {
  const f = (ms: number) => sunPosition(ms, latDeg, lonE).elevationDeg - horizonDeg
  if (f(startMs) <= 0) return null
  for (let m = 0; m < maxMin; m++) {
    const a = startMs + m * 60000
    const b = a + 60000
    if (f(b) <= 0) return (bisect(f, a, b) - startMs) / 60000
  }
  return null
}

/** Sunrise and sunset (UTC ms) on the local sol containing refMs, flat horizon (sun.sunrise_sunset). */
export function sunriseSunset(refMs: number, latDeg: number, lonE: number, horizonDeg: number): { sunrise: number; sunset: number } | null {
  const start = utcAtLmst(refMs, 0, lonE)
  const solMs = SOL_IN_DAYS * 86400000
  const f = (ms: number) => sunPosition(ms, latDeg, lonE).elevationDeg - horizonDeg
  const n = 96
  let rise: number | null = null
  let set: number | null = null
  let prevT = start
  let prevV = f(start)
  for (let i = 1; i <= n; i++) {
    const t = start + (solMs * i) / n
    const v = f(t)
    if (prevV <= 0 && v > 0 && rise === null) rise = bisect(f, prevT, t)
    else if (prevV > 0 && v <= 0 && set === null) set = bisect(f, prevT, t)
    prevT = t
    prevV = v
  }
  return rise === null || set === null ? null : { sunrise: rise, sunset: set }
}

/** Hours -> "HH:MM:SS" (rounded to the second, wraps at 24 h), as marstime.format_hms. */
export function formatHms(hours: number): string {
  const s = mod(Math.round(hours * 3600), 86400)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}

/** "YYYY-MM-DDTHH:MM:SSZ" (whole seconds, rounded). */
export function isoSecond(ms: number): string {
  return new Date(Math.round(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Everything the planner shows and exports for one EVA start instant at the sun site (D21 pad). */
export interface EvaClock {
  startUtc: string
  startMs: number
  mslSol: number
  lmst: string
  lmstH: number
  ltst: string
  lsDeg: number
  marsYear: number
  sun: SunPosition
  tDarkMin: number | null
  sunrise: number | null
  sunset: number | null
}

/** startMs is used exactly (the pipeline computes from the unrounded 09:00 LMST instant); only
 *  startUtc is rounded to the second for display and export. */
export function evaClock(startMs: number, sunSite: { lat: number; lon: number }): EvaClock {
  const ms = startMs
  const mt = marsTime(ms)
  const lm = lmstH(ms, CLOCK.galeLonEastDeg)
  const rs = sunriseSunset(ms, sunSite.lat, sunSite.lon, CLOCK.sunHorizonDeg)
  return {
    startUtc: isoSecond(ms),
    startMs: ms,
    mslSol: mslSol(ms, CLOCK.galeLonEastDeg),
    lmst: formatHms(lm),
    lmstH: lm,
    ltst: formatHms(ltstH(ms, CLOCK.galeLonEastDeg)),
    lsDeg: mt.lsDeg,
    marsYear: mt.marsYear,
    sun: sunPosition(ms, sunSite.lat, sunSite.lon),
    tDarkMin: tDarkMin(ms, sunSite.lat, sunSite.lon, CLOCK.sunHorizonDeg),
    sunrise: rs?.sunrise ?? null,
    sunset: rs?.sunset ?? null,
  }
}
