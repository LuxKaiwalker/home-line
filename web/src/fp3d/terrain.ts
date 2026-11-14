// Terrain model of the 3D view (pure; no Three.js). Heights live on two lattices of pixel centres
// sharing the index's NW corner chunk_grid.origin_xy_m:
//   near: x = x0 + (gc + 0.5) res, y = y0 - (gr + 0.5) res   (global column gc, row gr; row 0 north)
//   far:  same with far.res_m.
// Each near chunk (i, j) is meshed over lattice vertices gc = iP .. iP + P (P = chunk_px), so
// adjacent chunks share their seam; the extra column/row comes from the neighbour chunk, or from
// the far grid where the neighbour is not part of the corridor. Every cell is split along its
// NE-SW diagonal; heightAt() interpolates on exactly those triangles, so the camera height is
// measured against the surface that is drawn.
import type { Fp3dIndex } from './format'

export class HeightGrid {
  readonly west: number
  readonly north: number
  readonly res: number
  readonly cols: number
  readonly rows: number
  readonly data: Float32Array

  constructor(west: number, north: number, res: number, cols: number, rows: number, data: Float32Array) {
    if (data.length !== cols * rows) throw new Error('HeightGrid: data size mismatch')
    this.west = west
    this.north = north
    this.res = res
    this.cols = cols
    this.rows = rows
    this.data = data
  }

  /** Value at lattice (c, r), clamped to the grid. */
  at(c: number, r: number): number {
    const cc = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c
    const rr = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r
    return this.data[rr * this.cols + cc]
  }

  /** Bilinear between pixel centres (clamped at the edges). */
  bilinear(x: number, y: number): number {
    const u = (x - this.west) / this.res - 0.5
    const v = (this.north - y) / this.res - 0.5
    const c = Math.floor(u)
    const r = Math.floor(v)
    const fc = u - c
    const fr = v - r
    return (
      this.at(c, r) * (1 - fc) * (1 - fr) +
      this.at(c + 1, r) * fc * (1 - fr) +
      this.at(c, r + 1) * (1 - fc) * fr +
      this.at(c + 1, r + 1) * fc * fr
    )
  }

  /** Interpolation on the mesh triangles (cell split along the NE-SW diagonal), clamped. */
  triangle(x: number, y: number): number {
    const u = (x - this.west) / this.res - 0.5
    const v = (this.north - y) / this.res - 0.5
    const c = Math.floor(u)
    const r = Math.floor(v)
    return triInterp(this.at(c, r), this.at(c + 1, r), this.at(c, r + 1), this.at(c + 1, r + 1), u - c, v - r)
  }
}

/** a = NW, b = NE, d = SW, e = SE corner; fc east fraction, fr south fraction. */
export function triInterp(a: number, b: number, d: number, e: number, fc: number, fr: number): number {
  if (fc + fr <= 1) return a + fc * (b - a) + fr * (d - a)
  return e + (1 - fc) * (d - e) + (1 - fr) * (b - e)
}

export class Terrain {
  readonly x0: number
  readonly y0: number
  readonly res: number
  readonly chunkPx: number
  readonly nChunks: number
  readonly far: HeightGrid
  private readonly chunks = new Map<number, Float32Array>()

  constructor(index: Pick<Fp3dIndex, 'chunk_grid' | 'far'>, farData: Float32Array) {
    const g = index.chunk_grid
    this.x0 = g.origin_xy_m[0]
    this.y0 = g.origin_xy_m[1]
    this.res = g.res_m
    this.chunkPx = g.chunk_px
    this.nChunks = g.cols
    this.far = new HeightGrid(this.x0, this.y0, index.far.res_m, index.far.width, index.far.height, farData)
  }

  private key(i: number, j: number): number {
    return j * 100003 + i
  }

  setChunk(i: number, j: number, data: Float32Array): void {
    if (data.length !== this.chunkPx * this.chunkPx) throw new Error(`chunk ${i}_${j}: wrong size`)
    this.chunks.set(this.key(i, j), data)
  }

  hasChunk(i: number, j: number): boolean {
    return this.chunks.has(this.key(i, j))
  }

  get chunkCount(): number {
    return this.chunks.size
  }

  /** Analysis-CRS x/y of near lattice point (gc, gr). */
  latticeXY(gc: number, gr: number): [number, number] {
    return [this.x0 + (gc + 0.5) * this.res, this.y0 - (gr + 0.5) * this.res]
  }

  /** Height at near lattice point: its chunk if loaded, else the far grid (bilinear). */
  lattice(gc: number, gr: number): number {
    const P = this.chunkPx
    const i = Math.floor(gc / P)
    const j = Math.floor(gr / P)
    const d = this.chunks.get(this.key(i, j))
    if (d) return d[(gr - j * P) * P + (gc - i * P)]
    const [x, y] = this.latticeXY(gc, gr)
    return this.far.bilinear(x, y)
  }

  /** Which near chunk's mesh covers (x, y), or null when that chunk is not loaded. */
  meshChunkAt(x: number, y: number): [number, number] | null {
    const gc = Math.floor((x - this.x0) / this.res - 0.5)
    const gr = Math.floor((this.y0 - y) / this.res - 0.5)
    const i = Math.floor(gc / this.chunkPx)
    const j = Math.floor(gr / this.chunkPx)
    return this.hasChunk(i, j) ? [i, j] : null
  }

  /** Height of the drawn surface at (x, y): near triangles where loaded, else far triangles. */
  heightAt(x: number, y: number): number {
    if (!this.meshChunkAt(x, y)) return this.far.triangle(x, y)
    const u = (x - this.x0) / this.res - 0.5
    const v = (this.y0 - y) / this.res - 0.5
    const gc = Math.floor(u)
    const gr = Math.floor(v)
    return triInterp(
      this.lattice(gc, gr),
      this.lattice(gc + 1, gr),
      this.lattice(gc, gr + 1),
      this.lattice(gc + 1, gr + 1),
      u - gc,
      v - gr,
    )
  }
}

export interface MeshArrays {
  positions: Float32Array // x east, y up, z south (Three.js), relative to the anchor
  normals: Float32Array
  uvs: Float32Array | null
  index: Uint32Array
  vertsPerSide: number
}

const indexCache = new Map<number, Uint32Array>()

/** Triangle indices for an (m+1) x (m+1) vertex grid, CCW seen from above (+y). */
export function gridIndex(m: number): Uint32Array {
  const hit = indexCache.get(m)
  if (hit) return hit
  const idx = new Uint32Array(m * m * 6)
  let k = 0
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      const a = r * (m + 1) + c
      const b = a + 1
      const d = a + m + 1
      const e = d + 1
      idx[k++] = a
      idx[k++] = d
      idx[k++] = b
      idx[k++] = b
      idx[k++] = d
      idx[k++] = e
    }
  }
  indexCache.set(m, idx)
  return idx
}

export interface Anchor {
  x: number
  y: number
  h: number
}

/** Vertex arrays for near chunk (i, j) at lattice step `step` (1 = full 1 m resolution). */
export function nearChunkMesh(t: Terrain, i: number, j: number, anchor: Anchor, step = 1): MeshArrays {
  const P = t.chunkPx
  if (P % step !== 0) throw new Error(`step ${step} must divide chunk_px ${P}`)
  const m = P / step
  const n = m + 1
  const positions = new Float32Array(n * n * 3)
  const normals = new Float32Array(n * n * 3)
  const uvs = new Float32Array(n * n * 2)
  const res = t.res
  let p = 0
  let q = 0
  for (let r = 0; r < n; r++) {
    const gr = j * P + r * step
    for (let c = 0; c < n; c++) {
      const gc = i * P + c * step
      const [x, y] = t.latticeXY(gc, gr)
      const h = t.lattice(gc, gr)
      positions[p] = x - anchor.x
      positions[p + 1] = h - anchor.h
      positions[p + 2] = -(y - anchor.y)
      const hX = (t.lattice(gc + 1, gr) - t.lattice(gc - 1, gr)) / (2 * res)
      const hY = (t.lattice(gc, gr - 1) - t.lattice(gc, gr + 1)) / (2 * res) // north minus south
      const len = Math.hypot(hX, 1, hY)
      normals[p] = -hX / len
      normals[p + 1] = 1 / len
      normals[p + 2] = hY / len
      p += 3
      uvs[q] = (c * step + 0.5) / P
      uvs[q + 1] = 1 - (r * step + 0.5) / P // texture row 0 = north; Three.js flipY
      q += 2
    }
  }
  return { positions, normals, uvs, index: gridIndex(m), vertsPerSide: n }
}

/**
 * Vertex arrays for the far grid at lattice step `step`. With `skipCovered`, cells whose four
 * corners all lie on loaded near chunks are left out (no overlap, no z-fighting there).
 */
export function farMesh(t: Terrain, anchor: Anchor, step = 1, skipCovered = false): MeshArrays {
  const g = t.far
  const cols = Math.floor((g.cols - 1) / step) + 1
  const rows = Math.floor((g.rows - 1) / step) + 1
  if (cols !== rows) throw new Error('far grid must be square')
  const n = cols
  const positions = new Float32Array(n * n * 3)
  const normals = new Float32Array(n * n * 3)
  let p = 0
  for (let r = 0; r < n; r++) {
    const rr = r * step
    for (let c = 0; c < n; c++) {
      const cc = c * step
      const x = g.west + (cc + 0.5) * g.res
      const y = g.north - (rr + 0.5) * g.res
      positions[p] = x - anchor.x
      positions[p + 1] = g.at(cc, rr) - anchor.h
      positions[p + 2] = -(y - anchor.y)
      const hX = (g.at(cc + 1, rr) - g.at(cc - 1, rr)) / (2 * g.res)
      const hY = (g.at(cc, rr - 1) - g.at(cc, rr + 1)) / (2 * g.res)
      const len = Math.hypot(hX, 1, hY)
      normals[p] = -hX / len
      normals[p + 1] = 1 / len
      normals[p + 2] = hY / len
      p += 3
    }
  }
  let index = gridIndex(n - 1)
  if (skipCovered && t.chunkCount > 0) {
    const m = n - 1
    const covered = new Uint8Array(n * n)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = g.west + (c * step + 0.5) * g.res
        const y = g.north - (r * step + 0.5) * g.res
        covered[r * n + c] = t.meshChunkAt(x, y) ? 1 : 0
      }
    }
    const keep = new Uint32Array(index.length)
    let kept = 0
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) {
        const a = r * n + c
        if (covered[a] && covered[a + 1] && covered[a + n] && covered[a + n + 1]) continue
        const k = (r * m + c) * 6
        for (let q = 0; q < 6; q++) keep[kept++] = index[k + q]
      }
    }
    index = keep.slice(0, kept)
  }
  return { positions, normals, uvs: null, index, vertsPerSide: n }
}

/** Camera position (Three.js frame, relative to the anchor) at eye height above the drawn surface. */
export function cameraPosition(t: Terrain, anchor: Anchor, x: number, y: number, eyeHeightM: number): [number, number, number] {
  return [x - anchor.x, t.heightAt(x, y) + eyeHeightM - anchor.h, -(y - anchor.y)]
}
