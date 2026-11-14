// Way-home path from the pointer field (F18 drag-anywhere, F4; contracts v1.1 "{scenario}/pointer").
// The pointer PNG holds, per pixel of WS2's native route grid, the index k of the next move;
// stencil[k] = [drow, dcol] (rows grow southwards) from fields/index.json. A = 0 = no move
// (the pad pixel, unreached or unknown): the path ends there. The browser follows the pointer
// pixel to pixel; it never routes. Must agree with pipeline/export/fields_png.py follow_pointer.
import { fieldGrid, loadFieldRGBA, decodeRGBA, FieldGrid } from './fields'
import type { FieldsIndex, LonLat } from './types'

export type PathEnd = 'stop' | 'outside' | 'cycle' | 'limit'

export interface PixelPath {
  pixels: [number, number][] // [row, col] on the pointer grid, start included
  end: PathEnd
}

export interface WayHome extends PixelPath {
  /** Position first, then the centre of every following pointer pixel. */
  coords: LonLat[]
  /** false = the start pixel has no move and is not the pad (unknown / unreached ground). */
  startKnown: boolean
  /** true = the path ends in the pixel that holds the pad. */
  reachesPad: boolean
}

export class PointerField {
  readonly grid: FieldGrid
  readonly stencil: readonly (readonly [number, number])[]

  constructor(grid: FieldGrid, stencil: readonly (readonly number[])[]) {
    if (!stencil.length) throw new Error('pointer field without a stencil')
    this.stencil = stencil.map((s) => {
      if (s.length !== 2 || !s.every(Number.isInteger)) throw new Error(`bad stencil row ${JSON.stringify(s)}`)
      return [s[0], s[1]] as const
    })
    const { counts, known } = grid.data
    for (let i = 0; i < counts.length; i++) {
      if (known[i] && counts[i] >= this.stencil.length) {
        throw new Error(`pointer pixel ${i} holds move ${counts[i]}, stencil has ${this.stencil.length}`)
      }
    }
    this.grid = grid
  }

  /** Follow from pixel (row, col). maxSteps defaults to width * height (never reached when valid). */
  followPixels(row: number, col: number, maxSteps = this.grid.width * this.grid.height): PixelPath {
    const { width: W, height: H } = this.grid
    const { counts, known } = this.grid.data
    const pixels: [number, number][] = [[row, col]]
    const seen = new Set<number>([row * W + col])
    let r = row
    let c = col
    for (let step = 0; step < maxSteps; step++) {
      const i = r * W + c
      if (!known[i]) return { pixels, end: 'stop' }
      const [dr, dc] = this.stencil[counts[i]]
      r += dr
      c += dc
      if (r < 0 || c < 0 || r >= H || c >= W) return { pixels, end: 'outside' }
      const j = r * W + c
      if (seen.has(j)) return { pixels, end: 'cycle' }
      seen.add(j)
      pixels.push([r, c])
    }
    return { pixels, end: 'limit' }
  }

  /** Way home from (lon, lat); null when the position is outside the pointer grid. */
  pathFrom(lon: number, lat: number, pad: LonLat): WayHome | null {
    const p = this.grid.pixelOf(lon, lat)
    if (!p) return null
    const path = this.followPixels(p.row, p.col)
    const last = path.pixels[path.pixels.length - 1]
    const padPx = this.grid.pixelOf(pad[0], pad[1])
    const reachesPad = path.end === 'stop' && padPx !== null && padPx.row === last[0] && padPx.col === last[1]
    const startIsPad = padPx !== null && padPx.row === p.row && padPx.col === p.col
    return {
      ...path,
      coords: [[lon, lat], ...path.pixels.slice(1).map(([r, c]) => this.grid.lonLatOf(r, c))],
      startKnown: this.grid.data.known[p.row * this.grid.width + p.col] === 1 || startIsPad,
      reachesPad,
    }
  }
}

/** Load {scenario}/pointer from fields/index.json (own grid + stencil). */
export async function loadPointer(index: FieldsIndex, key: string, dataUrl: (p: string) => string): Promise<PointerField> {
  const meta = index.fields[key]
  if (!meta) throw new Error(`fields/index.json has no field ${key}`)
  if (!meta.stencil) throw new Error(`${key} has no stencil in fields/index.json`)
  const { rgba, width, height } = await loadFieldRGBA(dataUrl(meta.file))
  return new PointerField(new FieldGrid(fieldGrid(index, key), decodeRGBA(rgba, width, height, meta.scale), meta.units), meta.stencil)
}
