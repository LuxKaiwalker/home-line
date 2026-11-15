// Coordinates (search.md §2.2 #1, §2.4): DMS lon/lat (`137°23'36"E 4°46'35"S`, either order) and planner
// metres from the official pad (`x 120 y -40`, `x -300m, y 85m`). Decimal lon/lat stays in search.ts parseCoordinates
// (rank() gives today's coordinate row), so it is not answered here twice. Coordinates are input, not results:
// the row shows the text the user typed and the resulting lon/lat (formatted like today's coordinate row),
// never a RowValue. Choosing selects that cell, the same path as a coordinate result (palette runItem).
import { fromENU, sphereMetric } from '../../../nav/geom'
import { select } from '../../../state/selection'
import { ui } from '../../../state/ui'
import { isMapMode, modeHash, openSidebar } from '../../shell/store'
import { parseCoordinates } from '../search'
import type { QueryContext, QueryPattern, QueryRow, QueryRunEnv } from './types'

export interface LonLatPoint {
  lon: number
  lat: number
}

// one DMS component: deg° min' sec" H (spaces allowed between the parts, decimal seconds, '' for ")
const PART = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*'\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|'')?\s*([ensw])`
const DMS = new RegExp(`^${PART}[\\s,;]+${PART}$`)
const NUM = String.raw`([-+]?\d+(?:\.\d+)?)`
const METRES = new RegExp(String.raw`^x\s*${NUM}\s*(?:m)?[\s,;]+y\s*${NUM}\s*(?:m)?$`)

/** deg + min/60 + sec/3600, negative for S and W; null when a part is out of range. */
export function dmsToDecimal(deg: number, min: number, sec: number, hemi: string): number | null {
  if (min >= 60 || sec >= 60) return null
  const ew = hemi === 'e' || hemi === 'w'
  if (deg > (ew ? 180 : 90)) return null
  const v = deg + min / 60 + sec / 3600
  if (v > (ew ? 180 : 90)) return null
  return hemi === 's' || hemi === 'w' ? -v : v
}

/** A DMS lon/lat pair (one E/W and one N/S letter, either order), or null. */
export function parseDms(q: string): LonLatPoint | null {
  const m = DMS.exec(q.trim().toLowerCase())
  if (!m) return null
  const a = { d: +m[1], m: +m[2], s: +m[3], h: m[4] }
  const b = { d: +m[5], m: +m[6], s: +m[7], h: m[8] }
  const isEW = (h: string) => h === 'e' || h === 'w'
  if (isEW(a.h) === isEW(b.h)) return null
  const [lo, la] = isEW(a.h) ? [a, b] : [b, a]
  const lon = dmsToDecimal(lo.d, lo.m, lo.s, lo.h)
  const lat = dmsToDecimal(la.d, la.m, la.s, la.h)
  return lon === null || lat === null ? null : { lon, lat }
}

/** Planner metres `x E y N` (metres east / north of the pad), or null. */
export function parseMetres(q: string): { x: number; y: number } | null {
  const m = METRES.exec(q.trim().toLowerCase())
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}

/** Planner metres → lon/lat: the local tangent plane at the pad (nav/geom.ts fromENU, Mars sphere). */
export function metresToLonLat(x: number, y: number, pad: LonLatPoint, marsRadiusM: number): LonLatPoint {
  const [lon, lat] = fromENU(x, y, [pad.lon, pad.lat], sphereMetric(pad.lat, marsRadiusM))
  return { lon, lat }
}

/** Any coordinate form (DMS, planner metres, decimal) → a point; `metres` set for the planner form. */
export interface ParsedPoint extends LonLatPoint {
  form: 'dms' | 'metres' | 'decimal'
  /** Beyond config/site.yaml planning_radius_m (planner metres only). */
  outOfRange?: boolean
}

export function parsePoint(q: string, ctx: Pick<QueryContext, 'pad' | 'marsRadiusM' | 'planningRadiusM'>): ParsedPoint | null {
  const d = parseDms(q)
  if (d) return { ...d, form: 'dms' }
  const p = parseMetres(q)
  if (p) {
    if (!Number.isFinite(ctx.pad.lon) || !Number.isFinite(ctx.pad.lat)) return null
    const r = ctx.planningRadiusM
    return { ...metresToLonLat(p.x, p.y, ctx.pad, ctx.marsRadiusM), form: 'metres', outOfRange: r !== undefined && Math.hypot(p.x, p.y) > r }
  }
  const c = parseCoordinates(q)
  return c ? { lon: c.lon, lat: c.lat, form: 'decimal' } : null
}

/** Today's coordinate row text (search.ts rank: `${lon}, ${lat}`), at the cell key's 6 decimals. */
export const lonLatText = (p: LonLatPoint): string => `${+p.lon.toFixed(6)}, ${+p.lat.toFixed(6)}`

/** Choose a cell: the coordinate result's path (palette runItem): PLAN if off the map, select, sidebar. */
export function openCell(p: LonLatPoint, env: QueryRunEnv): void {
  if (!isMapMode(ui.mode.peek() ?? 'plan')) env.navigate(modeHash('plan'))
  select({ kind: 'cell', lon: p.lon, lat: p.lat }, 'search')
  openSidebar()
}

export const coordsPattern: QueryPattern = {
  id: 'coords',
  hint: 'search.coords.hint',
  examples: [`137°23'36"E 4°46'35"S`, `4°46'35"S, 137°23'36"E`, 'x 120 y -40', 'x -300m, y 85m'],
  // §2.3 lists `x ` as a Tab prefix; left out so a lone `x` keeps the default Tab (S3a prefix test).
  prefixes: [],
  parse(q, ctx) {
    const d = parseDms(q)
    const m = d ? null : parseMetres(q)
    if (!d && !m) return null // decimal: search.ts parseCoordinates (today's coordinate row)
    const p = parsePoint(q, ctx)
    if (!p) return [{ id: `coords:${q}`, pattern: 'coords', icon: 'ruler', title: 'search.coords.metresRow', vars: { input: q, lonlat: '—' }, disabledReason: 'search.reason.noPad', run: () => {} }]
    const row: QueryRow = {
      id: `coords:${p.form}:${lonLatText(p)}`,
      pattern: 'coords',
      icon: p.form === 'metres' ? 'ruler' : 'crosshair',
      title: p.form === 'metres' ? 'search.coords.metresRow' : 'search.coords.row',
      vars: { input: q, lonlat: lonLatText(p) },
      disabledReason: p.outOfRange ? 'search.reason.planningRadius' : null,
      run: (env) => openCell(p, env),
    }
    return [row]
  },
}
