// Scorecard helpers for V1 (WS6 validation/v1.json) and the KAT list (validation/kats.json).
// Structure only: every number shown still goes through <Num> with its manifest key.

export interface Confusion {
  tp: number
  fp: number
  fn: number
  tn: number
}

/** Threshold keys of a confusion block ("10", "20"), in numeric order. */
export function confusionThresholds(conf: unknown): string[] {
  if (!conf || typeof conf !== 'object') return []
  return Object.keys(conf).sort((a, b) => Number(a) - Number(b))
}

const SENS_LABEL: Record<string, string> = {
  footprint_5m: '5 m footprint',
  imu_roll_pitch: 'IMU tilt from roll and pitch',
  all_in_dem: 'every drive end on the DEM (no focus filter)',
}

export interface V1Sens {
  name: string
  label: string
  keyPrefix: string
  n: number | null
  bias_deg: number | null
  rmse_deg: number | null
  r: number | null
  confusion: Record<string, Confusion>
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The V1 sensitivity runs (WS6), in file order. */
export function v1Sensitivities(v: Record<string, unknown>): V1Sens[] {
  const s = v.sensitivity
  if (!s || typeof s !== 'object') return []
  return Object.entries(s as Record<string, Record<string, unknown>>).map(([name, x]) => ({
    name,
    label: typeof x.set === 'string' ? x.set : (SENS_LABEL[name] ?? name.replace(/_/g, ' ')),
    keyPrefix: `v1.sensitivity.${name}`,
    n: num(x.n),
    bias_deg: num(x.bias_deg),
    rmse_deg: num(x.rmse_deg),
    r: num(x.r),
    confusion: (x.confusion && typeof x.confusion === 'object' ? x.confusion : {}) as Record<string, Confusion>,
  }))
}

export interface KatTest {
  id: string
  area: string
  features: string[]
  outcome: string
  reason: string | null
}

export interface KatArea {
  area: string
  total: number
  passed: number
  failed: number
  skipped: number
}

/** Outcome counts per SPEC §9 area, largest area first. */
export function katAreas(tests: KatTest[]): KatArea[] {
  const m = new Map<string, KatArea>()
  for (const t of tests) {
    let a = m.get(t.area)
    if (!a) m.set(t.area, (a = { area: t.area, total: 0, passed: 0, failed: 0, skipped: 0 }))
    a.total++
    if (t.outcome === 'passed') a.passed++
    else if (t.outcome === 'skipped') a.skipped++
    else a.failed++
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.area.localeCompare(b.area))
}

// D7 (user 2026-11-14 15:01, SPEC §11): automatic sky detection only, no manual review. Near and mid
// V2 errors are quoted as they are; the far class is shown but labelled not validated. The wording
// follows SPEC §11 D7; the rim distances and frame count stay in SPEC/WS3 STATUS until the data
// carries them (no number is typed into the app).
export const FAR_NOT_VALIDATED =
  'Not validated: the far rim is hidden by haze in the north-facing frames; the automatic detector finds nearer terrain instead (D7: automatic detection only, no manual review).'

export interface V2Class {
  cls: string
  keyPrefix: string
  validated: boolean
  n: number | null
  median_deg: number | null
  median_abs_deg: number | null
  p90_abs_deg: number | null
}

const V2_ORDER = ['near', 'mid', 'far']

/** V2 summary rows in near/mid/far order; the far class is not validated (D7). */
export function v2Classes(summary: Record<string, unknown>): V2Class[] {
  const keys = [...V2_ORDER.filter((k) => k in summary), ...Object.keys(summary).filter((k) => !V2_ORDER.includes(k))]
  return keys
    .filter((k) => summary[k] && typeof summary[k] === 'object')
    .map((k) => {
      const x = summary[k] as Record<string, unknown>
      return { cls: k, keyPrefix: `v2.${k}`, validated: k !== 'far', n: num(x.n), median_deg: num(x.median_deg), median_abs_deg: num(x.median_abs_deg), p90_abs_deg: num(x.p90_abs_deg) }
    })
}

/** Card skyline_error_scope without the clause D7 superseded ("…far class pending the D7 manual check"). */
export function scopeText(s: string | undefined | null): string | null {
  if (!s) return null
  return s.replace(/;\s*far class pending the D7 manual check/i, '').replace(/\s*\(far class pending the D7 manual check\)/i, '')
}
