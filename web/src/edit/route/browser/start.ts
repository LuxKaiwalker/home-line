// I3 (instant browser path): the EVA start instant on the browser data. N0CEO's start picker
// (origin/waypoint-routing d7d80e0) recomputes the Mars clock at any instant with the Mars24 port
// (mission/marstime.ts); this applies one instant to the data compute.ts and the mission.json export
// read: t_dark (the margin's daylight term and every leg's latest departure), eva_start_utc,
// eva_start_lmst and msl_sol. null = clock.json's instant (D31): the data is returned AS IS, so the
// default changes nothing. The sun is at the fields' pad (D21, as clock.json: config clock.site).
import { CLOCK, evaClock, isoSecond, utcAtLmst, type EvaClock } from '../../../mission/marstime'
import type { BrowserRouteData } from './data'

/** Shown on the start card, the estimate and mission.json origin_label when the start was moved. */
export const CUSTOM_START_LABEL = 'custom start · outside the validated scenario'

/** clock.json's instant from config: 09:00 LMST (D31) on the local sol of eva_sol_ref_utc, as WS4 computes it. */
export const DEFAULT_START_MS = utcAtLmst(Date.parse(CLOCK.evaSolRefUtc), CLOCK.evaStartLmstH, CLOCK.galeLonEastDeg)

/** A start within a second of the default is the default (clock.json rounds start_utc to the second). */
export const isDefaultStart = (ms: number | null): boolean => ms === null || Math.abs(ms - DEFAULT_START_MS) < 1000

/** Where the sun is computed: the fields' pad (pad.json, D21). */
export const sunSiteOf = (d: Pick<BrowserRouteData, 'fieldsPad'>): { lat: number; lon: number } => ({ lat: d.fieldsPad.lat, lon: d.fieldsPad.lon })

/** The Mars clock at a start instant (null = the default) for the start card. */
export function clockAt(d: Pick<BrowserRouteData, 'fieldsPad'>, startMs: number | null): EvaClock {
  return evaClock(startMs ?? DEFAULT_START_MS, sunSiteOf(d))
}

/**
 * The data with the EVA start moved to startMs. Shallow copy: the grids, the router and its leg cache
 * stay shared (they do not depend on the clock). The sun already down at the start gives t_dark 0
 * (the daylight margin is negative from the first minute, as the picker's daylightFor), never null
 * (null would drop the daylight term).
 */
export function withEvaStart(d: BrowserRouteData, startMs: number | null): BrowserRouteData {
  if (startMs === null || isDefaultStart(startMs)) return d
  const c = evaClock(startMs, sunSiteOf(d))
  return {
    ...d,
    tDarkMin: c.tDarkMin === null ? 0 : Math.round(c.tDarkMin * 100) / 100,
    evaStartUtc: isoSecond(startMs),
    evaStartLmst: c.lmst,
    mslSol: c.mslSol,
    customStart: true,
  }
}
