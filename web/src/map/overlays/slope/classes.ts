// PORT L1a: the Mission Planer's slope classes (mission/slope.ts) on the Plan map. WS1's cell slope
// (fields/shared/slope.png, degrees) is coloured in classes whose edges are the engine's own limits
// in config/site.yaml (read through the app's config loader, CITED), so a colour says what the
// engine does with that ground:
//   < siting.max_slope_deg          pad-flat (F8 siting)
//   < slope.flag_beyond_tested_deg  walkable, inside the tested range
//   < slope.nogo_deg.nominal        walkable, beyond the tested range (flagged)
//   < slope.nogo_deg.optimistic     no-go in the nominal case (walkable only when optimistic)
//   >= slope.nogo_deg.optimistic    no-go always
// Unknown cells stay transparent (unknown stays unknown). Colours are tokens (DESIGN §3.1): the
// recipe below is mirrored as CSS custom properties in slope.css (the test checks both agree).
import { CITED, type CfgValue } from '../../../config'
import { color, type ColorToken } from '../../../ui/tokens'
import { DEFAULT_ON, DEFAULT_OPACITY, OPACITY } from '../catalog'

export type SlopeClassId = 'padFlat' | 'walkable' | 'beyondTested' | 'nogoNominal' | 'nogoAlways'
export const SLOPE_CLASS_IDS: readonly SlopeClassId[] = ['padFlat', 'walkable', 'beyondTested', 'nogoNominal', 'nogoAlways']

/** The four config limits that make the class edges (each with its config source). */
export interface SlopeLimits {
  sitingMaxSlopeDeg: CfgValue<number>
  flagBeyondTestedDeg: CfgValue<number>
  nogoNominalDeg: CfgValue<number>
  nogoOptimisticDeg: CfgValue<number>
}

/** The limits as the app's config loader reads them from config/site.yaml. */
export const SITE_LIMITS: SlopeLimits = {
  sitingMaxSlopeDeg: CITED.sitingMaxSlopeDeg,
  flagBeyondTestedDeg: CITED.flagBeyondTestedDeg,
  nogoNominalDeg: CITED.nogoNominalDeg,
  nogoOptimisticDeg: CITED.nogoOptimisticDeg,
}

export interface SlopeClass {
  id: SlopeClassId
  /** lower edge in degrees (inclusive); 0 for the first class */
  minDeg: number
  /** upper edge in degrees (exclusive); Infinity for the last class */
  maxDeg: number
  /** config source of the upper edge (the lower one for the last class) */
  source: string
}

/** The five classes from config limits; throws if the limits are not strictly ascending. */
export function slopeClasses(l: SlopeLimits = SITE_LIMITS): SlopeClass[] {
  const edges = [l.sitingMaxSlopeDeg, l.flagBeyondTestedDeg, l.nogoNominalDeg, l.nogoOptimisticDeg]
  for (let i = 0; i < edges.length; i++) {
    const v = edges[i].value
    if (typeof v !== 'number' || !Number.isFinite(v) || (i > 0 && !(v > edges[i - 1].value))) throw new Error(`slope limits not ascending at ${edges[i].source}`)
  }
  return SLOPE_CLASS_IDS.map((id, i) => ({
    id,
    minDeg: i === 0 ? 0 : edges[i - 1].value,
    maxDeg: i < edges.length ? edges[i].value : Infinity,
    source: (edges[i] ?? edges[edges.length - 1]).source,
  }))
}

/** Index of the class for `deg`; an edge value belongs to the class above it. NaN → -1 (unknown). */
export function slopeClassOf(deg: number, classes: readonly SlopeClass[]): number {
  if (!Number.isFinite(deg)) return -1
  for (let i = 0; i < classes.length; i++) if (deg < classes[i].maxDeg) return i
  return classes.length - 1
}

// ---- colours (tokens) --------------------------------------------------------------------------

/** A class colour: a token, or an sRGB mix of two tokens (`pct` % of the first), as CSS color-mix(). */
export type ColorRecipe = { token: ColorToken } | { mix: [ColorToken, ColorToken]; pct: number }

/** DESIGN §3.1: green = fine, orange = caution, red = limit; the steepest class is the darker red. */
export const SLOPE_COLORS: Readonly<Record<SlopeClassId, ColorRecipe>> = {
  padFlat: { token: 'safe' },
  walkable: { mix: ['safe', 'caution'], pct: 50 },
  beyondTested: { token: 'caution' },
  nogoNominal: { token: 'limit' },
  nogoAlways: { mix: ['limit', 'bg'], pct: 55 },
}

/** CSS custom property that holds a class colour (defined in slope.css). */
export const slopeColorVar = (id: SlopeClassId): string => `var(--hl-slope-${id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`

function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`slope colour token is not #rrggbb: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** RGB of a recipe from the token values (same arithmetic as CSS color-mix(in srgb, …)). */
export function recipeRgb(r: ColorRecipe, tok: (t: ColorToken) => string = color): [number, number, number] {
  if ('token' in r) return hexRgb(tok(r.token))
  const a = hexRgb(tok(r.mix[0]))
  const b = hexRgb(tok(r.mix[1]))
  const p = r.pct / 100
  return [0, 1, 2].map((i) => Math.round(a[i] * p + b[i] * (1 - p))) as [number, number, number]
}

/** Alpha baked into a known cell; the see-through amount is the layer opacity. */
const OPAQUE = 255

/** RGBA (row-major) for a slope field given as counts × scale with a known mask; unknown = transparent. */
export function renderSlope(
  counts: ArrayLike<number>,
  known: ArrayLike<number>,
  scale: number,
  classes: readonly SlopeClass[] = slopeClasses(),
  rgb: readonly [number, number, number][] = classes.map((c) => recipeRgb(SLOPE_COLORS[c.id])),
): Uint8ClampedArray {
  const n = counts.length
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (!known[i]) continue
    const k = slopeClassOf(counts[i] * scale, classes)
    if (k < 0) continue
    const c = rgb[k]
    out[j] = c[0]
    out[j + 1] = c[1]
    out[j + 2] = c[2]
    out[j + 3] = OPAQUE
  }
  return out
}

// ---- opacity and default -----------------------------------------------------------------------

/** Opacity range of the slope layer: 10-100 %, the Mission Planer's (team lead 22:03), not the 35-55 % of
 *  the other Plan overlays (tokens overlayOpacity); default 45 % as before. */
export const SLOPE_OPACITY = { min: 0.1, max: 1, step: OPACITY.step } as const
export const SLOPE_DEFAULT_OPACITY = DEFAULT_OPACITY
export const clampSlopeOpacity = (v: number): number => Math.min(SLOPE_OPACITY.max, Math.max(SLOPE_OPACITY.min, Number.isFinite(v) ? v : SLOPE_DEFAULT_OPACITY))
/** Same default as the built-in slope-classes overlay it replaces. */
export const SLOPE_DEFAULT_ON: boolean = DEFAULT_ON.slopeClass
/** The built-in overlay this layer replaces (map/overlays/catalog.ts). */
export const REPLACES = 'slopeClass' as const
