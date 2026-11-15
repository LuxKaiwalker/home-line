// PORT U3: the EVA start's pure helpers (port of mission/StartTime.tsx and edit/route/browser/start.ts).
// The planning store keeps the start as `startUtc: string | null`: null = clock.json's instant (D31:
// 09:00 LMST on the local sol of eva_sol_ref_utc); a moved start is an ISO string to the second.
// A start within a second of the default is stored as null, so picking the default back is "no
// custom start" (the core's isDefaultStart, browser/start.ts) and the URL stays short.
import { CLOCK, isoSecond, LEAP_VALID_UNTIL_MS, utcAtLmst, utcAtSolLmst } from './marstime'

/** clock.json's instant from config: 09:00 LMST (D31) on the local sol of eva_sol_ref_utc. */
export const DEFAULT_START_MS = utcAtLmst(Date.parse(CLOCK.evaSolRefUtc), CLOCK.evaStartLmstH, CLOCK.galeLonEastDeg)
/** A start within a second of the default is the default (clock.json rounds start_utc to the second). */
export const isDefaultStart = (ms: number | null): boolean => ms === null || Math.abs(ms - DEFAULT_START_MS) < 1000
/** Earliest pickable start: Curiosity's landing (mission sol 0). */
export const MIN_START_MS = Date.parse(CLOCK.mslLandingUtc)
/** Latest: one day before the end of the leap-second table the Mars24 port trusts. */
export const MAX_START_MS = LEAP_VALID_UNTIL_MS - 24 * 3600 * 1000

export const clampStart = (ms: number): number => Math.min(MAX_START_MS, Math.max(MIN_START_MS, ms))

/** The store's startUtc as an instant (null or unparsable = the default). */
export function startMsOf(startUtc: string | null): number {
  if (startUtc === null) return DEFAULT_START_MS
  const ms = Date.parse(startUtc)
  return Number.isFinite(ms) ? ms : DEFAULT_START_MS
}

/** An instant as the store's startUtc: clamped, null for the default, else ISO to the second. */
export function startUtcFor(ms: number): string | null {
  if (!Number.isFinite(ms)) return null
  const c = clampStart(ms)
  return isDefaultStart(c) ? null : isoSecond(c)
}

/** Mission sol + LMST hours -> the store's startUtc (null when invalid input or the default). */
export function startUtcForSolLmst(sol: number, lmstHours: number): string | null | undefined {
  if (!Number.isInteger(sol) || sol < 0 || !Number.isFinite(lmstHours) || lmstHours < 0 || lmstHours >= 24) return undefined
  return startUtcFor(utcAtSolLmst(sol, lmstHours, CLOCK.galeLonEastDeg))
}

/** "YYYY-MM-DDTHH:MM" in UTC, for <input type="datetime-local"> used as a UTC field. */
export const toUtcInput = (ms: number): string => new Date(Math.round(ms / 60000) * 60000).toISOString().slice(0, 16)
/** The UTC field's value back to an instant (NaN when empty or invalid). */
export const fromUtcInput = (v: string): number => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? Date.parse(`${v}:00Z`) : NaN)
/** "HH:MM" from an <input type="time"> to hours (NaN when invalid). */
export function hoursOf(v: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v)
  if (!m) return NaN
  const h = Number(m[1]) + Number(m[2]) / 60 + Number(m[3] ?? 0) / 3600
  return h >= 0 && h < 24 ? h : NaN
}
