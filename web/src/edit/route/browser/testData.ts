// R1 (Plan port): test-only loader of the REAL published route data (web/public/data), shared by the
// runner / worker / Mission-parity tests. Same code as compute.test.ts's fixture (I1a); imported by
// tests only (never by the app, so it stays out of the build).
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PadFile, Rad, Station } from '../../../data/types'
import { decodeRGBA, FieldGrid, fieldGrid } from '../../../hud/fields'
import { readPngRGBA, REPO } from '../../../hud/testutil'
import type { FieldsIndex } from '../../../hud/types'
import { PointerField } from '../../../hud/wayhome'
import { accessCell, cellOf, lonLatOfCell, routeGridOf, sampleElevation } from '../map/grid'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, HeightGrid, lonLatToXY, parseEqc, parseIndex } from '../map/heights'
import { gradeModel, scenarioParams } from '../map/physio'
import { makeBrowserRouteData, type BrowserRouteData } from './data'

export const PUB = resolve(REPO, 'web/public/data')
export const J = <T>(rel: string): T => JSON.parse(readFileSync(resolve(PUB, rel), 'utf8')) as T

export async function loadFromFiles(sid: string, fieldsPrefix = '', padFile: PadFile = J<PadFile>('pad.json')): Promise<BrowserRouteData> {
  const fi = J<FieldsIndex>('fields/index.json')
  const field = (k: string) => {
    const meta = fi.fields[k]
    const { rgba, width, height } = readPngRGBA(resolve(PUB, meta.file))
    return new FieldGrid(fieldGrid(fi, k), decodeRGBA(rgba, width, height, meta.scale), meta.units)
  }
  const key = `${fieldsPrefix}${sid}`
  const tHome = field(`${key}/t_home`)
  const o2Home = field(`${key}/o2_home`)
  const pMeta = fi.fields[`${key}/pointer`]
  const pointer = new PointerField(field(`${key}/pointer`), pMeta.stencil!)
  const fp = parseIndex(J('fp3d/index.json'))
  const raw = readFileSync(resolve(PUB, fp.far.file))
  const buf = await gunzipIfNeeded(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
  const [west, north] = farOrigin(fp)
  const heights = new HeightGrid(west, north, fp.far.res_m, fp.far.width, fp.far.height, decodeHeights(buf, fp.far.width, fp.far.height, codecOf(fp)))
  const eqc = parseEqc(fp.chunk_grid.crs)
  const grid = routeGridOf(tHome, sampleElevation(tHome, heights, (lon, lat) => lonLatToXY(eqc, lon, lat)))
  return makeBrowserRouteData({
    scenario: sid,
    tHome,
    o2Home,
    pointer,
    grid,
    model: gradeModel(scenarioParams(sid)),
    stations: J<Station[]>('stations.json'),
    padFile,
    rad: J<Rad>('conditions/rad.json'),
    clock: J('conditions/clock.json'),
    files: { tHome: fi.fields[`${key}/t_home`].file, o2Home: fi.fields[`${key}/o2_home`].file, pointer: pMeta.file, elevation: fp.far.file },
    elevationResM: fp.far.res_m,
  })
}

/** A walkable cell ~`m` metres east / north of a point (free-point fixture on the real grid). */
export function freePointNear(d: BrowserRouteData, lon: number, lat: number, eastM: number, northM: number): { lon: number; lat: number } {
  const c = accessCell(d.grid, cellOf(d.tHome, lon + eastM / d.tHome.mPerDegLon, lat + northM / d.tHome.mPerDegLat), 50)
  if (c === null) throw new Error('fixture: no walkable cell')
  const [plon, plat] = lonLatOfCell(d.tHome, c)
  return { lon: Math.round(plon * 1e6) / 1e6, lat: Math.round(plat * 1e6) / 1e6 }
}

/** The published data tree is present (tests skip without it). */
export const HAS_DATA = existsSync(resolve(PUB, 'fields/index.json'))
