// fp3d/index.json and the height binaries (contracts/README.md "3D files", contract
// fp3d_index.schema.json v1.0.0: dummy, bounds, chunk_grid, height_scale). The layout is written by
// pipeline/export/terrain_chunks.py (real) and tools/make_dummy.py (dummy) and recorded in the
// index: chunk_grid {cols, rows, chunk_px, res_m, origin_xy_m (NW corner), crs, chunks[]},
// height {dtype, byte_order, row_order, offset_m, units}, height_scale, far {...}.

export interface Fp3dChunk {
  i: number
  j: number
  file: string
  tex?: string
  bounds: [number, number, number, number]
  bytes?: number
  tex_bytes?: number
}

export interface Fp3dHeight {
  dtype: string
  byte_order: 'little' | 'big'
  row_order: 'north_to_south' | 'south_to_north'
  offset_m: number
  units: string
  datum?: string
}

export interface Fp3dIndex {
  dummy: boolean
  bounds: [number, number, number, number]
  chunk_grid: {
    cols: number
    rows: number
    chunk_px: number
    res_m: number
    origin_xy_m: [number, number] // NW corner, analysis CRS
    crs: string
    chunks: Fp3dChunk[]
  }
  /** metres per stored unit */
  height_scale: number
  height: Fp3dHeight
  far: { file: string; res_m: number; width: number; height: number; bytes?: number }
  horizon_ring?: string
  eye_height_m?: number
  download_bytes?: number
}

/** Check the fields the viewer relies on (the contract fixes only dummy/bounds/chunk_grid/height_scale). */
export function parseIndex(raw: unknown): Fp3dIndex {
  const fail = (m: string): never => {
    throw new Error(`fp3d/index.json: ${m}`)
  }
  if (!raw || typeof raw !== 'object') fail('not an object')
  const o = raw as Partial<Fp3dIndex>
  if (typeof o.dummy !== 'boolean') fail('missing boolean "dummy"')
  if (typeof o.height_scale !== 'number' || !(o.height_scale > 0)) fail('missing positive "height_scale"')
  const g = o.chunk_grid
  if (!g || typeof g !== 'object') return fail('missing "chunk_grid"')
  if (typeof g.crs !== 'string') fail('chunk_grid.crs')
  if (!Array.isArray(g.origin_xy_m) || g.origin_xy_m.length !== 2) fail('chunk_grid.origin_xy_m')
  if (!(g.chunk_px > 0) || !(g.res_m > 0) || !(g.cols > 0) || !(g.rows > 0)) fail('chunk_grid size')
  if (g.cols !== g.rows) fail('chunk_grid must be square')
  if (!Array.isArray(g.chunks)) fail('chunk_grid.chunks')
  const h = o.height
  if (!h || h.dtype !== 'float32') return fail('height.dtype must be float32')
  if (h.units !== 'm') fail('height.units must be m')
  if (h.byte_order !== 'little' && h.byte_order !== 'big') fail('height.byte_order')
  if (h.row_order !== 'north_to_south' && h.row_order !== 'south_to_north') fail('height.row_order')
  if (typeof h.offset_m !== 'number') fail('height.offset_m')
  const f = o.far
  if (!f || typeof f.file !== 'string' || !(f.width > 0) || !(f.height > 0) || !(f.res_m > 0)) fail('far grid')
  return o as Fp3dIndex
}

/** gunzip when the bytes start with the gzip magic (servers may already have decoded it). */
export async function gunzipIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u8 = new Uint8Array(buf)
  if (u8.length < 2 || u8[0] !== 0x1f || u8[1] !== 0x8b) return buf
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).arrayBuffer()
}

export interface HeightCodec {
  byte_order: 'little' | 'big'
  row_order: 'north_to_south' | 'south_to_north'
  scale: number
  offset_m: number
}

export function codecOf(idx: Fp3dIndex): HeightCodec {
  return {
    byte_order: idx.height.byte_order,
    row_order: idx.height.row_order,
    scale: idx.height_scale,
    offset_m: idx.height.offset_m,
  }
}

/**
 * Decode a float32 height grid into row-major Float32Array with row 0 = north, applying the
 * index's scale/offset (metres = raw * height_scale + offset_m).
 */
export function decodeHeights(buf: ArrayBuffer, cols: number, rows: number, h: HeightCodec): Float32Array {
  const n = cols * rows
  if (buf.byteLength !== 4 * n) {
    throw new Error(`height grid: expected ${4 * n} bytes for ${cols}x${rows}, got ${buf.byteLength}`)
  }
  const dv = new DataView(buf)
  const little = h.byte_order === 'little'
  const flip = h.row_order === 'south_to_north'
  const out = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    const src = (flip ? rows - 1 - r : r) * cols
    const dst = r * cols
    for (let c = 0; c < cols; c++) {
      out[dst + c] = dv.getFloat32(4 * (src + c), little) * h.scale + h.offset_m
    }
  }
  return out
}
