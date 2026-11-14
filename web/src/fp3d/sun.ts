// Sun for the 3D lighting (F20 "sun direction from Mars24 at the simulated LMST"). WS4 computes
// the sun with pipeline/conditions/sun.py (Mars24) and publishes the EVA series in
// conditions/clock.json eva.sun_series (columns eva.sun_series_columns: t_eva_min, lmst_h,
// sun_azimuth_deg, sun_elevation_deg). This module only reads and interpolates that series for
// rendering; no sun position is computed in the browser.

export interface SunTrack {
  tMin: number[]
  lmstH: number[]
  azDeg: number[]
  elDeg: number[]
  source: string
  startUtc: string | null
}

export interface SunState {
  azDeg: number
  elDeg: number
  /** LMST (h), interpolated between WS4's samples. */
  lmstH: number
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** conditions/clock.json -> track, or null when absent/malformed (then the labelled placeholder is used). */
export function parseClockSun(raw: unknown): SunTrack | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const eva = o.eva as Record<string, unknown> | undefined
  if (!eva || typeof eva !== 'object') return null
  const cols = eva.sun_series_columns
  const rows = eva.sun_series
  if (!Array.isArray(cols) || !Array.isArray(rows) || rows.length === 0) return null
  const ix = (name: string) => cols.indexOf(name)
  const it = ix('t_eva_min')
  const il = ix('lmst_h')
  const ia = ix('sun_azimuth_deg')
  const ie = ix('sun_elevation_deg')
  if (it < 0 || il < 0 || ia < 0 || ie < 0) return null
  const tr: SunTrack = {
    tMin: [],
    lmstH: [],
    azDeg: [],
    elDeg: [],
    source: typeof o.algorithm === 'string' ? `${o.algorithm} (WS4 conditions/clock.json)` : 'WS4 conditions/clock.json',
    startUtc: typeof eva.start_utc === 'string' ? eva.start_utc : null,
  }
  for (const r of rows) {
    if (!Array.isArray(r)) return null
    const [t, l, a, e] = [r[it], r[il], r[ia], r[ie]]
    if (!fin(t) || !fin(l) || !fin(a) || !fin(e)) return null
    if (tr.tMin.length && t <= tr.tMin[tr.tMin.length - 1]) return null
    tr.tMin.push(t)
    tr.lmstH.push(l)
    tr.azDeg.push(a)
    tr.elDeg.push(e)
  }
  return tr
}

/** Linear interpolation of the track at EVA minute t (azimuth across 0/360), clamped at the ends. */
export function sunAt(tr: SunTrack, tMin: number): SunState {
  const n = tr.tMin.length
  if (n === 1 || tMin <= tr.tMin[0]) return { azDeg: tr.azDeg[0], elDeg: tr.elDeg[0], lmstH: tr.lmstH[0] }
  if (tMin >= tr.tMin[n - 1]) return { azDeg: tr.azDeg[n - 1], elDeg: tr.elDeg[n - 1], lmstH: tr.lmstH[n - 1] }
  let k = 0
  while (k < n - 2 && tr.tMin[k + 1] < tMin) k++
  const f = (tMin - tr.tMin[k]) / (tr.tMin[k + 1] - tr.tMin[k])
  let da = tr.azDeg[k + 1] - tr.azDeg[k]
  if (da > 180) da -= 360
  if (da < -180) da += 360
  const az = (((tr.azDeg[k] + f * da) % 360) + 360) % 360
  let dl = tr.lmstH[k + 1] - tr.lmstH[k]
  if (dl < -12) dl += 24 // across LMST midnight
  return {
    azDeg: az,
    elDeg: tr.elDeg[k] + f * (tr.elDeg[k + 1] - tr.elDeg[k]),
    lmstH: (tr.lmstH[k] + f * dl) % 24,
  }
}

/** Unit vector towards the sun in the Three.js frame (x east, y up, z south). */
export function sunDirection(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180
  const e = (elDeg * Math.PI) / 180
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]
}

/** "HH:MM" for an LMST in hours (presentation of an exported value). */
export function formatLmst(h: number): string {
  const m = Math.floor((((h % 24) + 24) % 24) * 60 + 1e-9)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Brightness factor of sky and lights for a sun elevation (rendering only): 1 with the sun up,
 * fading linearly to `floor` at `nightElDeg`.
 */
export function daylightFactor(elDeg: number, nightElDeg: number, floor: number): number {
  if (elDeg >= 0) return 1
  if (elDeg <= nightElDeg) return floor
  return floor + (1 - floor) * (1 - elDeg / nightElDeg)
}
