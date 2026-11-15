// I4 (EVA start picker, instant route planner): the EVA start instant -> the clock values the browser
// estimate and mission.json use. Ported from origin/waypoint-routing d7d80e0 (N0CEO, Mission Planer)
// web/src/mission/StartTime.tsx (DEFAULT_START_MS, MIN/MAX, daylightFor) and views/mission.tsx (the
// export's conditions for a chosen start); the Mars clock itself is marstime.ts (Mars24 port).
//
// Default = clock.json's instant (D31: 09:00 LMST on the sol of eva_sol_ref_utc). At the default the
// estimate takes clock.json's own values (no override), so nothing changes unless the user moves it.
import { CLOCK, evaClock, LEAP_VALID_UNTIL_MS, utcAtLmst, type EvaClock } from './marstime'

/** Default start: 09:00 LMST (D31) on the local sol of eva_sol_ref_utc, exactly as WS4 computes it. */
export const DEFAULT_START_MS = utcAtLmst(Date.parse(CLOCK.evaSolRefUtc), CLOCK.evaStartLmstH, CLOCK.galeLonEastDeg)
/** Earliest pickable start: Curiosity's landing (mission sol 0). */
export const MIN_START_MS = Date.parse(CLOCK.mslLandingUtc)
/** Latest: the end of the leap-second table the Mars24 port trusts. */
export const MAX_START_MS = LEAP_VALID_UNTIL_MS - 24 * 3600 * 1000

/** Shown with every number computed from a moved start (card, estimate provenance, mission.json origin_label). */
export const CUSTOM_START_LABEL = 'custom start · outside the validated scenario'

/** Within a second of the default counts as the default (as StartTime.tsx isDefault). */
export function isDefaultStart(ms: number | null): boolean {
  return ms === null || Math.abs(ms - DEFAULT_START_MS) < 1000
}

export function clampStart(ms: number): number {
  return Math.min(MAX_START_MS, Math.max(MIN_START_MS, ms))
}

/** The clock values that replace clock.json's in the estimate (compute.ts BrowserClock). */
export interface StartClockValues {
  evaStartUtc: string
  evaStartLmst: string
  mslSol: number
  /** minutes to darkness from the start (the margin's daylight term); 0 when the sun is already down */
  tDarkMin: number
}

let memo: { ms: number; lat: number; lon: number; clock: EvaClock } | null = null

/** evaClock at the sun site (the pad, D21 as clock.json), memoised on the last start (the scan is ~1 ms). */
export function startClock(ms: number, site: { lon: number; lat: number }): EvaClock {
  if (!memo || memo.ms !== ms || memo.lat !== site.lat || memo.lon !== site.lon) memo = { ms, lat: site.lat, lon: site.lon, clock: evaClock(ms, site) }
  return memo.clock
}

/** The override for a moved start (views/mission.tsx export conditions: t_dark rounded to 0.01 min, as clock.json). */
export function clockValues(c: EvaClock): StartClockValues {
  const t = c.tDarkMin ?? 0 // StartTime.tsx daylightFor: the sun already down = no daylight left
  return { evaStartUtc: c.startUtc, evaStartLmst: c.lmst, mslSol: c.mslSol, tDarkMin: Math.round(t * 100) / 100 }
}
