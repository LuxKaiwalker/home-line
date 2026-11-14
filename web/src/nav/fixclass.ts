// Fix-interval (D_max) field: decode the RG-encoded PNG (contracts/README.md "Field PNGs") and
// colour it by class. Bins as the pipeline (np.digitize, left-closed, on config/nav.yaml
// fix_interval.classes_m); labels identical to fix_interval_summary's keys.

/** A decoded field: counts per pixel (R*256 + G), known = A > 0, value = counts * scale. */
export interface DecodedField {
  width: number
  height: number
  scale: number
  counts: Uint16Array
  known: Uint8Array
}

/** Decode RGBA bytes (row-major, as from canvas getImageData). */
export function decodeRGBA(rgba: ArrayLike<number>, width: number, height: number, scale: number): DecodedField {
  const n = width * height
  if (rgba.length !== n * 4) throw new Error(`decodeRGBA: ${rgba.length} bytes for ${width} x ${height}`)
  const counts = new Uint16Array(n)
  const known = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    counts[i] = rgba[j] * 256 + rgba[j + 1]
    known[i] = rgba[j + 3] > 0 ? 1 : 0
  }
  return { width, height, scale, counts, known }
}

/** Value at pixel (col, row), or null when unknown / off the grid. */
export function valueAtPixel(f: DecodedField, col: number, row: number): number | null {
  if (col < 0 || row < 0 || col >= f.width || row >= f.height) return null
  const i = row * f.width + col
  return f.known[i] ? f.counts[i] * f.scale : null
}

/** Value at lon/lat on a north-up grid with bounds [w, s, e, n] (pixel-edge bounds). */
export function valueAt(f: DecodedField, bounds: readonly [number, number, number, number], lon: number, lat: number): number | null {
  const [w, s, e, n] = bounds
  const col = Math.floor(((lon - w) / (e - w)) * f.width)
  const row = Math.floor(((n - lat) / (n - s)) * f.height)
  return valueAtPixel(f, col, row)
}

/** ["<100", "100-300", "300-1000", ">1000"] for edges [100, 300, 1000]. */
export function classLabels(edges: readonly number[]): string[] {
  const out = [`<${edges[0]}`]
  for (let i = 1; i < edges.length; i++) out.push(`${edges[i - 1]}-${edges[i]}`)
  out.push(`>${edges[edges.length - 1]}`)
  return out
}

/** Class index 0..edges.length, as np.digitize(v, edges). */
export function classOf(v: number, edges: readonly number[]): number {
  let i = 0
  while (i < edges.length && v >= edges[i]) i++
  return i
}

/**
 * RGBA image of the D_max classes. Unknown cells and D_max = 0 (outside the homeline, SPEC F21)
 * stay transparent, so only the homeline area is coloured.
 */
export function classifyRGBA(field: DecodedField, edges: readonly number[], colours: readonly [number, number, number][], alpha: number): Uint8ClampedArray {
  if (colours.length !== edges.length + 1) throw new Error(`need ${edges.length + 1} colours`)
  const n = field.width * field.height
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    if (!field.known[i] || field.counts[i] === 0) continue
    const c = colours[classOf(field.counts[i] * field.scale, edges)]
    const j = i * 4
    out[j] = c[0]
    out[j + 1] = c[1]
    out[j + 2] = c[2]
    out[j + 3] = alpha
  }
  return out
}
