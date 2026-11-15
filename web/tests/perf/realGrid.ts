// Plan-port perf probe (Q1): the REAL route grid of the official pad (public/data: fields nom_104/t_home
// 1480 x 1480 at 5 m + the fp3d far heights), built the way the browser core builds it
// (edit/route/map/grid.ts routeGridOf; same recipe as R1's edit/route/browser/testData.ts), and the
// legs of typical plan edits on it (pad and stations, 0.5-3 km). Test-only: node fs.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeRGBA, FieldGrid, fieldGrid } from '../../src/hud/fields'
import { readPngRGBA, REPO } from '../../src/hud/testutil'
import type { FieldsIndex } from '../../src/hud/types'
import { reachableFrom } from '../../src/edit/route/browser/compute'
import type { BrowserRouteData } from '../../src/edit/route/browser/data'
import { accessCell, cellOf, lonLatOfCell, routeGridOf, sampleElevation } from '../../src/edit/route/map/grid'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, HeightGrid, lonLatToXY, parseEqc, parseIndex } from '../../src/edit/route/map/heights'
import { gradeModel, scenarioParams } from '../../src/edit/route/map/physio'
import type { RouteGrid } from '../../src/edit/route/map/router'

const PUB = resolve(REPO, 'web/public/data')
const J = <T>(rel: string): T => JSON.parse(readFileSync(resolve(PUB, rel), 'utf8')) as T

export interface RealGrid {
  grid: RouteGrid
  tHome: FieldGrid
  /** access cell (<= 50 m) of a lon/lat in the pad's reachable component (compute.ts snapCell); throws if none */
  cell(lon: number, lat: number): number
  lonLatOf(cell: number): [number, number]
  pad: number
  stations: Record<string, number>
}

export async function loadRealGrid(sid = 'nom_104'): Promise<RealGrid> {
  const fi = J<FieldsIndex>('fields/index.json')
  const meta = fi.fields[`${sid}/t_home`]
  const { rgba, width, height } = readPngRGBA(resolve(PUB, meta.file))
  const tHome = new FieldGrid(fieldGrid(fi, `${sid}/t_home`), decodeRGBA(rgba, width, height, meta.scale), meta.units)
  const fp = parseIndex(J('fp3d/index.json'))
  const raw = readFileSync(resolve(PUB, fp.far.file))
  const buf = await gunzipIfNeeded(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
  const [west, north] = farOrigin(fp)
  const heights = new HeightGrid(west, north, fp.far.res_m, fp.far.width, fp.far.height, decodeHeights(buf, fp.far.width, fp.far.height, codecOf(fp)))
  const eqc = parseEqc(fp.chunk_grid.crs)
  const grid = routeGridOf(tHome, sampleElevation(tHome, heights, (lon, lat) => lonLatToXY(eqc, lon, lat)))
  const padFile = J<{ pad: { lon: number; lat: number } }>('pad.json')
  const padCell = accessCell(grid, cellOf(tHome, padFile.pad.lon, padFile.pad.lat), ACCESS_M)
  if (padCell === null) throw new Error('pad: no walkable cell')
  // the cells the router can reach from the pad (browser grid pockets excluded, as the app does)
  const comp = reachableFrom({ grid, model: gradeModel(scenarioParams(sid)), components: new Map() } as unknown as BrowserRouteData, padCell)
  const cell = (lon: number, lat: number): number => {
    const c = nearestIn(grid, comp, cellOf(tHome, lon, lat), ACCESS_M)
    if (c === null) throw new Error(`no reachable cell near ${lon},${lat}`)
    return c
  }
  const stations: Record<string, number> = {}
  type St = { id: string; lon: number; lat: number; access?: Record<string, { lon?: number; lat?: number }> }
  for (const s of J<St[]>('stations.json')) {
    const a = s.access?.[sid]
    try {
      stations[s.id] = cell(a?.lon ?? s.lon, a?.lat ?? s.lat) // the scenario's access point (data.ts browserStations)
    } catch {
      /* no reachable access cell in this scenario: not used */
    }
  }
  return { grid, tHome, cell, lonLatOf: (c) => lonLatOfCell(tHome, c), pad: padCell, stations }
}

const ACCESS_M = 50

/** Nearest cell of `comp` within radiusM of `cell` (own cell first), or null (compute.ts nearestIn). */
function nearestIn(g: RouteGrid, comp: Uint8Array, cell: number | null, radiusM: number): number | null {
  if (cell === null) return null
  if (comp[cell]) return cell
  const R = Math.floor(radiusM / g.resM)
  const r0 = Math.floor(cell / g.width)
  const c0 = cell - r0 * g.width
  let best: number | null = null
  let bestD = Infinity
  for (let dr = -R; dr <= R; dr++)
    for (let dc = -R; dc <= R; dc++) {
      const r = r0 + dr
      const c = c0 + dc
      const q = dr * dr + dc * dc
      if (r < 0 || c < 0 || r >= g.height || c >= g.width || q > R * R || q >= bestD) continue
      if (comp[r * g.width + c]) {
        best = r * g.width + c
        bestD = q
      }
    }
  return best
}

/**
 * Plan edits on the real grid as the legs each one re-routes (the leg cache keeps the others):
 * adding a stop at the end = [prev -> new, new -> pad]; inserting / moving a stop = [prev -> it, it -> next].
 */
export function editLegs(g: RealGrid): { name: string; legs: [number, number][] }[] {
  const { pad, stations: st } = g
  const ids = Object.keys(st)
  const out: { name: string; legs: [number, number][] }[] = []
  // build the route stop by stop from the pad (each edit appends a station)
  let prev = pad
  for (const id of ids) {
    out.push({ name: `add ${id}`, legs: [[prev, st[id]], [st[id], pad]] })
    prev = st[id]
  }
  // reorder edits: swap neighbours (two new legs each)
  for (let i = 0; i + 1 < ids.length; i += 2) out.push({ name: `swap ${ids[i]}/${ids[i + 1]}`, legs: [[st[ids[i + 1]], st[ids[i]]], [st[ids[i]], pad]] })
  // free-point drags: a waypoint after each station dropped 150-400 m away (prev station -> point -> pad)
  for (const id of ids)
    for (const [eastM, northM] of [
      [250, -150],
      [-300, 250],
      [150, 350],
    ]) {
      const [lon, lat] = g.lonLatOf(st[id])
      let p: number
      try {
        p = g.cell(lon + eastM / g.tHome.mPerDegLon, lat + northM / g.tHome.mPerDegLat)
      } catch {
        continue // no reachable cell there: the editor refuses such a drop
      }
      out.push({ name: `drag W1 near ${id}`, legs: [[st[id], p], [p, pad]] })
    }
  return out
}

/** p-quantile (nearest rank) of a sample. */
export function quantile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
}

export const stats = (xs: readonly number[]) => ({ n: xs.length, p50: quantile(xs, 0.5), p95: quantile(xs, 0.95), max: Math.max(...xs) })
export const fmtStats = (xs: readonly number[]) => {
  const s = stats(xs)
  return `n ${s.n} p50 ${s.p50.toFixed(0)} ms, p95 ${s.p95.toFixed(0)} ms, max ${s.max.toFixed(0)} ms`
}
