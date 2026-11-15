// Topography and material-composition rasters for the Mission Planer "Maps" switcher, ported from
// the team's Unity map (Nasa-Space-App, Assets/Mars/Scripts/HUD/MarsElevationMap.cs and MapView.cs
// MapPalette, origin/main ba3c1a5; unit layer as of d19e9bf) so both apps draw the same map:
//   topo:     muted ochre hypsometric tint (min..max of the grid) x soft multi-directional hillshade,
//             contour lines (interval from the median slope, index contour every 5th);
//   material: the same hillshade on neutral grey, tinted by the regional dominant rock class of
//             the Unity scene's rock population (unityRocks.json: every RockSample, Gaussian splat,
//             see buildUnitField / unitAt). Not a mineral survey.
// Pure functions on a row-major elevation grid (row 0 north, square cells of mpp metres).
import unitsFile from './mountSharpUnits.json'

import rocksFile from './unityRocks.json'

export const UNITS_FILE = unitsFile as {
  source: string
  classes: { id: string; name: string; unitSymbol: string | null; abundance: number; setting: string | null; summary?: string }[]
}

/** The Unity scene's rocks: [lon, lat, index into classes] (web/scripts/unity_rocks.py). */
export const ROCKS_FILE = rocksFile as unknown as { source: string; classes: string[]; rocks: [number, number, number][] }

// ---------------------------------------------------------------- Unity constants (MarsElevationMap)
const INTERVALS = [5, 10, 20, 50, 100, 200, 500]
const INDEX_EVERY = 5
const MIN_CONTOUR_SPACING_CELLS = 6
const SHADE_EXAGGERATION = 1.25
const SHADE_STRENGTH = 0.9
const MINOR_STRENGTH = 0.22
const INDEX_STRENGTH = 0.5
export const BASE_GREY = 70
export const RAMP: { t: number; rgb: [number, number, number] }[] = [
  { t: 0, rgb: [30, 25, 22] },
  { t: 0.3, rgb: [52, 40, 31] },
  { t: 0.65, rgb: [78, 60, 44] },
  { t: 1, rgb: [106, 90, 72] },
]
const CONTOUR_RGB: [number, number, number] = [226, 214, 196]
const LIGHT_AZ_DEG = [315, 270, 0]
const LIGHT_W = [0.5, 0.25, 0.25]
const LIGHT_ALT_DEG = 45
// Unity MarsElevationMap unit-map constants and MapPalette.UnitAlphaMin/Max (perceptual; blended in sRGB here).
export const UNIT_CELL_M = 32
export const UNIT_SIGMA_M = 70
const UNIT_CUTOFF_SIGMAS = 3
export const UNIT_WEIGHT_FLOOR = 0.05
export const UNIT_SHARE_FLOOR = 0.3
export const UNIT_ALPHA_MIN = 0.35
export const UNIT_ALPHA_MAX = 0.6
const UNIT_MAX = 16

/** Unity MapPalette.ClassColor and ClassLabel. */
const CLASS_STYLE: Record<string, { hex: number; label: string }> = {
  'murray-mudstone': { hex: 0x8fa6bf, label: 'Mm mudstone' },
  'vera-rubin-ridge': { hex: 0xb8705e, label: 'Mvr hematite' },
  'glen-torridon-clay': { hex: 0x5e93d9, label: 'Cs clay' },
  'mirador-sulfate': { hex: 0xb394e6, label: 'Msu sulfate' },
  'amapari-iron': { hex: 0xe07fb8, label: 'Ma Fe bed' },
  'stimson-sandstone': { hex: 0xd9b77e, label: 'Ss sandstone' },
  'silica-alteration': { hex: 0xa6e0c8, label: 'Si silica' },
  'iron-meteorite': { hex: 0xb5d65a, label: 'Fe meteorite' },
}
const FALLBACK_HEX = [0x8fbf6a, 0xd9906a, 0xa0a0e0, 0xc0c070]

function classStyle(id: string, unitSymbol: string | null): { rgb: [number, number, number]; label: string } {
  let hex = CLASS_STYLE[id]?.hex
  if (hex === undefined) {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
    hex = FALLBACK_HEX[(h & 0x7fffffff) % FALLBACK_HEX.length]
  }
  return { rgb: [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255], label: CLASS_STYLE[id]?.label ?? unitSymbol ?? id }
}

// ---------------------------------------------------------------- units

export interface Unit {
  id: string
  name: string
  label: string
  rgb: [number, number, number]
}

/** Lon/lat to metres east of the west edge and north of the south edge of the raster. */
export interface UnitFrame {
  w: number
  s: number
  e: number
  n: number
}

export interface UnitField {
  /** classes present, in Unity RockDatabase order (unknown ids after, as met) */
  units: Unit[]
  gridW: number
  gridH: number
  /** class-weight planes, unit-major: grid[u * gridW * gridH + j * gridW + i], j = 0 at the south edge */
  grid: Float32Array
}

/**
 * Unity GatherRocks + SplatRocks: every rock adds a Gaussian (sigma UNIT_SIGMA_M, cut at 3 sigma per
 * axis) to its own class plane of a UNIT_CELL_M grid anchored at the raster's south-west corner, so
 * each plane is the kernel-smoothed local rock count of that class.
 */
export function buildUnitField(
  rocks: readonly (readonly [number, number, number])[],
  classIds: readonly string[],
  frame: UnitFrame,
  widthM: number,
  heightM: number,
): UnitField {
  const order = UNITS_FILE.classes.map((c) => c.id)
  const used = [...new Set(rocks.map((r) => classIds[r[2]]).filter((id): id is string => !!id))]
  const key = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + used.indexOf(id))
  const ids = used.sort((a, b) => key(a) - key(b)).slice(0, UNIT_MAX)
  const units: Unit[] = ids.map((id) => {
    const c = UNITS_FILE.classes.find((x) => x.id === id)
    const st = classStyle(id, c?.unitSymbol ?? null)
    return { id, name: c?.name ?? id, label: st.label, rgb: st.rgb }
  })
  const gridW = Math.max(1, Math.ceil(widthM / UNIT_CELL_M))
  const gridH = Math.max(1, Math.ceil(heightM / UNIT_CELL_M))
  const cells = gridW * gridH
  const grid = new Float32Array(units.length * cells)
  const inv2s2 = 1 / (2 * UNIT_SIGMA_M * UNIT_SIGMA_M)
  const reach = (UNIT_CUTOFF_SIGMAS * UNIT_SIGMA_M) / UNIT_CELL_M
  const kx = new Float32Array(2 * Math.ceil(reach) + 2)
  for (const [lon, lat, ci] of rocks) {
    const u = ids.indexOf(classIds[ci])
    if (u < 0) continue
    const fx = (((lon - frame.w) / (frame.e - frame.w)) * widthM) / UNIT_CELL_M - 0.5
    const fz = (((lat - frame.s) / (frame.n - frame.s)) * heightM) / UNIT_CELL_M - 0.5
    const ia = Math.max(0, Math.ceil(fx - reach))
    const ib = Math.min(gridW - 1, Math.floor(fx + reach))
    const ja = Math.max(0, Math.ceil(fz - reach))
    const jb = Math.min(gridH - 1, Math.floor(fz + reach))
    if (ia > ib || ja > jb) continue // off the map
    for (let i = ia; i <= ib; i++) {
      const dx = (i - fx) * UNIT_CELL_M
      kx[i - ia] = Math.exp(-dx * dx * inv2s2)
    }
    for (let j = ja; j <= jb; j++) {
      const dz = (j - fz) * UNIT_CELL_M
      const wz = Math.exp(-dz * dz * inv2s2)
      const row = u * cells + j * gridW
      for (let i = ia; i <= ib; i++) grid[row + i] += kx[i - ia] * wz
    }
  }
  return { units, gridW, gridH, grid }
}

/**
 * Unity UnitTexel at metres (x east of the west edge, z north of the south edge): dominant class of
 * the bilinearly interpolated weights; alpha UNIT_ALPHA_MIN..MAX with the dominance share, faded out
 * where the summed weight is negligible (no rock near). index -1 / alpha 0: draw nothing.
 */
export function unitAt(f: UnitField, xM: number, zM: number): { index: number; alpha: number } {
  const fx = xM / UNIT_CELL_M - 0.5
  const fz = zM / UNIT_CELL_M - 0.5
  const i0 = Math.floor(fx)
  const j0 = Math.floor(fz)
  const tx = fx - i0
  const tz = fz - j0
  const cl = (v: number, n: number) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v)
  const ia = cl(i0, f.gridW)
  const ib = cl(i0 + 1, f.gridW)
  const ja = cl(j0, f.gridH) * f.gridW
  const jb = cl(j0 + 1, f.gridH) * f.gridW
  const w00 = (1 - tx) * (1 - tz)
  const w10 = tx * (1 - tz)
  const w01 = (1 - tx) * tz
  const w11 = tx * tz
  const cells = f.gridW * f.gridH
  let total = 0
  let best = 0
  let bu = -1
  for (let u = 0, o = 0; u < f.units.length; u++, o += cells) {
    const w = f.grid[o + ja + ia] * w00 + f.grid[o + ja + ib] * w10 + f.grid[o + jb + ia] * w01 + f.grid[o + jb + ib] * w11
    total += w
    if (w > best) {
      best = w
      bu = u
    }
  }
  if (bu < 0) return { index: -1, alpha: 0 }
  const presence = (total - UNIT_WEIGHT_FLOOR) / UNIT_WEIGHT_FLOOR
  if (presence <= 0) return { index: bu, alpha: 0 }
  const share = Math.min(1, Math.max(0, (best / total - UNIT_SHARE_FLOOR) / (1 - UNIT_SHARE_FLOOR)))
  return { index: bu, alpha: (UNIT_ALPHA_MIN + (UNIT_ALPHA_MAX - UNIT_ALPHA_MIN) * share) * Math.min(1, presence) }
}

// ---------------------------------------------------------------- relief

/** Contour interval: the finest of INTERVALS whose spacing at the median slope is >= 6 cells. */
export function contourInterval(elev: Float32Array, w: number, h: number, mpp: number): number {
  const hist = new Uint32Array(91)
  let count = 0
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 8192)))
  for (let r = 1; r < h - 1; r += step)
    for (let c = 1; c < w - 1; c += step) {
      const i = r * w + c
      const gx = (elev[i + 1] - elev[i - 1]) / (2 * mpp)
      const gz = (elev[i - w] - elev[i + w]) / (2 * mpp)
      const deg = Math.round((Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI)
      if (!Number.isFinite(deg)) continue
      hist[deg]++
      count++
    }
  let median = 0
  for (let d = 0, acc = 0; d <= 90; d++) {
    acc += hist[d]
    if (acc > count / 2) {
      median = d
      break
    }
  }
  const slope = Math.tan((Math.min(median, 85) * Math.PI) / 180)
  for (const k of INTERVALS) if (slope <= 1e-4 || k / slope / mpp >= MIN_CONTOUR_SPACING_CELLS) return k
  return INTERVALS[INTERVALS.length - 1]
}

/** Line coverage of the nearest contour level (Unity Coverage): q = h / interval. */
export function coverage(q: number, interval: number, cellsPerMetre: number, width: number): number {
  const fr = q - Math.floor(q)
  const dm = (fr < 0.5 ? fr : 1 - fr) * interval
  const c = width - dm * cellsPerMetre
  return c < 0 ? 0 : c > 1 ? 1 : c
}

export type ReliefMode = 'topo' | 'material'

export interface Relief {
  rgba: Uint8ClampedArray
  width: number
  height: number
  minE: number
  maxE: number
  contourM: number
  /** cells drawn per unit with alpha > 0 (Unity unitTexels), by unit id */
  unitCells: Map<string, number>
}

const clamp255 = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v))

export function renderRelief(elev: Float32Array, w: number, h: number, mpp: number, mode: ReliefMode, units: UnitField | null): Relief {
  let minE = Infinity
  let maxE = -Infinity
  for (const v of elev)
    if (Number.isFinite(v)) {
      if (v < minE) minE = v
      if (v > maxE) maxE = v
    }
  const range = maxE - minE || 1
  const ci = contourInterval(elev, w, h, mpp)
  const idx = ci * INDEX_EVERY
  const alt = (LIGHT_ALT_DEG * Math.PI) / 180
  const lz = Math.sin(alt)
  const lx = LIGHT_AZ_DEG.map((a) => Math.cos(alt) * Math.sin((a * Math.PI) / 180))
  const ly = LIGHT_AZ_DEG.map((a) => Math.cos(alt) * Math.cos((a * Math.PI) / 180))
  const lut = new Float32Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let s = 0
    while (s < RAMP.length - 2 && t > RAMP[s + 1].t) s++
    const f = (t - RAMP[s].t) / (RAMP[s + 1].t - RAMP[s].t)
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = RAMP[s].rgb[k] + (RAMP[s + 1].rgb[k] - RAMP[s].rgb[k]) * Math.min(1, Math.max(0, f))
  }

  const rgba = new Uint8ClampedArray(w * h * 4)
  const unitCells = new Map<string, number>()
  const inv2 = 0.5 / mpp
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c
      const e = elev[i]
      if (!Number.isFinite(e)) continue
      const nb = (j: number) => (Number.isFinite(elev[j]) ? elev[j] : e)
      const gx = (nb(i + 1) - nb(i - 1)) * inv2 // east
      const gz = (nb(i - w) - nb(i + w)) * inv2 // north (row 0 is north)
      const ex = gx * SHADE_EXAGGERATION
      const ez = gz * SHADE_EXAGGERATION
      const invLen = 1 / Math.sqrt(ex * ex + ez * ez + 1)
      let shade = 0
      for (let l = 0; l < lx.length; l++) {
        const d = (lz - ex * lx[l] - ez * ly[l]) * invLen
        if (d > 0) shade += d * LIGHT_W[l]
      }
      let f = 1 + SHADE_STRENGTH * (shade / lz - 1)
      f = f < 0.3 ? 0.3 : f > 1.45 ? 1.45 : f
      const o = i * 4
      let cr: number, cg: number, cb: number
      if (mode === 'topo') {
        const ti = Math.min(255, Math.max(0, Math.floor(((e - minE) * 255) / range)))
        cr = lut[ti * 3] * f
        cg = lut[ti * 3 + 1] * f
        cb = lut[ti * 3 + 2] * f
        const g = Math.hypot(gx, gz)
        if (g > 1e-4) {
          const cpm = 1 / (g * mpp)
          let a = coverage(e / ci, ci, cpm, 1)
          const fade = (ci * cpm - 2.5) * 0.5
          a *= (fade < 0 ? 0 : fade > 1 ? 1 : fade) * MINOR_STRENGTH
          const ai = coverage(e / idx, idx, cpm, 1.25) * INDEX_STRENGTH
          if (ai > a) a = ai
          if (a > 0) {
            cr += (CONTOUR_RGB[0] - cr) * a
            cg += (CONTOUR_RGB[1] - cg) * a
            cb += (CONTOUR_RGB[2] - cb) * a
          }
        }
      } else {
        cr = cg = cb = BASE_GREY * f
        if (units && units.units.length) {
          const p = unitAt(units, (c + 0.5) * mpp, (h - r - 0.5) * mpp)
          if (p.index >= 0 && p.alpha > 0) {
            const u = units.units[p.index]
            cr += (u.rgb[0] - cr) * p.alpha
            cg += (u.rgb[1] - cg) * p.alpha
            cb += (u.rgb[2] - cb) * p.alpha
            unitCells.set(u.id, (unitCells.get(u.id) ?? 0) + 1)
          }
        }
      }
      rgba[o] = clamp255(cr)
      rgba[o + 1] = clamp255(cg)
      rgba[o + 2] = clamp255(cb)
      rgba[o + 3] = 255
    }
  }
  return { rgba, width: w, height: h, minE, maxE, contourM: ci, unitCells }
}
