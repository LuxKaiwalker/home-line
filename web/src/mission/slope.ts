// Slope overlay for the Mission Planer: WS1's cell slope (fields/shared/slope.png, degrees) coloured
// in classes whose edges are the project's own slope limits (config/site.yaml), so the colours
// say what the engine does with that ground:
//   < siting.max_slope_deg        flat enough for a pad (F8)
//   < slope.flag_beyond_tested_deg walkable, inside the tested range
//   < slope.nogo_deg.nominal       walkable, beyond the tested range (flagged)
//   < slope.nogo_deg.optimistic    no-go in the nominal case, walkable only when optimistic
//   >= optimistic                  no-go in every case
// Unknown cells stay transparent (unknown stays unknown).
import { CITED } from '../config'

export interface SlopeClass {
  /** upper edge in degrees (exclusive); Infinity for the last class */
  maxDeg: number
  label: string
  rgb: [number, number, number]
  source: string
}

export const SLOPE_CLASSES: SlopeClass[] = [
  { maxDeg: CITED.sitingMaxSlopeDeg.value, label: `< ${CITED.sitingMaxSlopeDeg.value}° pad-flat`, rgb: [46, 160, 90], source: CITED.sitingMaxSlopeDeg.source },
  { maxDeg: CITED.flagBeyondTestedDeg.value, label: `< ${CITED.flagBeyondTestedDeg.value}° walkable`, rgb: [196, 214, 74], source: CITED.flagBeyondTestedDeg.source },
  { maxDeg: CITED.nogoNominalDeg.value, label: `< ${CITED.nogoNominalDeg.value}° beyond tested`, rgb: [240, 170, 50], source: CITED.nogoNominalDeg.source },
  { maxDeg: CITED.nogoOptimisticDeg.value, label: `< ${CITED.nogoOptimisticDeg.value}° no-go (nominal)`, rgb: [226, 92, 52], source: CITED.nogoOptimisticDeg.source },
  { maxDeg: Infinity, label: `≥ ${CITED.nogoOptimisticDeg.value}° no-go`, rgb: [140, 30, 90], source: CITED.nogoOptimisticDeg.source },
]

/** Alpha (0..255) baked into a known cell; the see-through amount is the layer opacity below. */
export const SLOPE_ALPHA = 255
/** Default layer opacity (0..1), adjustable in the Layers panel, so the map stays visible below. */
export const SLOPE_OPACITY = 0.4

export function slopeClassOf(deg: number): number {
  for (let i = 0; i < SLOPE_CLASSES.length; i++) if (deg < SLOPE_CLASSES[i].maxDeg) return i
  return SLOPE_CLASSES.length - 1
}

/** RGBA (row-major) for a slope field given as counts × scale with a known mask. */
export function renderSlope(counts: ArrayLike<number>, known: ArrayLike<number>, scale: number): Uint8ClampedArray {
  const n = counts.length
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (!known[i]) continue
    const [r, g, b] = SLOPE_CLASSES[slopeClassOf(counts[i] * scale)].rgb
    out[j] = r
    out[j + 1] = g
    out[j + 2] = b
    out[j + 3] = SLOPE_ALPHA
  }
  return out
}
