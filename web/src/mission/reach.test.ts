// J1i: station access on the REAL published data (web/public/data), the Mission Planer's own modules:
// the pad's reachable component (reach.ts, once per pad), stops snapped to its nearest cell within the
// access radius (as I1a), legs by the tab's LegRouter (= the worker's). Before J1i, the stops' own cells
// of S6 / S1 / S8 sat in pockets the router cannot reach from the official pad (A* ran ~2 s for nothing).
// The official route S7 -> S6 -> S1 -> S4 now routes, with the numbers of the app's instant estimate
// (edit/route/browser/compute.ts, read-only here; tests are not in the static build).
// Skips only when web/public/data is absent.
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import type { PadFile, Rad, Station } from '../data/types'
import { computeBrowserRoute, reachableFrom as sharedReach } from '../edit/route/browser/compute'
import { makeBrowserRouteData, type BrowserRouteData } from '../edit/route/browser/data'
import { routeGridOf } from '../edit/route/map/grid'
import { gradeModel as sharedGradeModel, scenarioParams as sharedParams } from '../edit/route/map/physio'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, parseIndex } from '../fp3d/format'
import { lonLatToXY, parseEqc } from '../fp3d/geo'
import { HeightGrid } from '../fp3d/terrain'
import { decodeRGBA, FieldGrid, fieldGrid } from '../hud/fields'
import { readPngRGBA, REPO } from '../hud/testutil'
import type { FieldsIndex } from '../hud/types'
import { PointerField } from '../hud/wayhome'
import { missionBudget } from './budget'
import { sampleElevation } from './data'
import { fieldKeys, type MissionPad } from './pads'
import { gradeModel, scenarioParams } from './physio'
import { ACCESS_RADIUS_M, legInComponent, padCellOf, reachableFrom, stopCell, type ReachData, type StopCell } from './reach'
import { LegRouter, type Leg } from './router'
import { stationWaypoint } from './stations'

const PUB = resolve(REPO, 'web/public/data')
const J = <T>(rel: string): T => JSON.parse(readFileSync(resolve(PUB, rel), 'utf8')) as T
const SID = CONFIG.defaultScenario

interface Tab extends ReachData {
  tHome: FieldGrid
  o2Home: FieldGrid | null
  padCell: number
  comp: Uint8Array
  compMs: number
  router: LegRouter
}

const fi = existsSync(PUB) ? J<FieldsIndex>('fields/index.json') : null
const field = (k: string) => {
  const meta = fi!.fields[k]
  const { rgba, width, height } = readPngRGBA(resolve(PUB, meta.file))
  return new FieldGrid(fieldGrid(fi!, k), decodeRGBA(rgba, width, height, meta.scale), meta.units)
}
let elevCache: { tHome: FieldGrid; elev: Float32Array } | null = null
async function elevationFor(tHome: FieldGrid): Promise<Float32Array> {
  const fp = parseIndex(J('fp3d/index.json'))
  const raw = readFileSync(resolve(PUB, fp.far.file))
  const buf = await gunzipIfNeeded(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
  const [west, north] = farOrigin(fp)
  const heights = new HeightGrid(west, north, fp.far.res_m, fp.far.width, fp.far.height, decodeHeights(buf, fp.far.width, fp.far.height, codecOf(fp)))
  const eqc = parseEqc(fp.chunk_grid.crs)
  return sampleElevation(tHome, heights, (lon, lat) => lonLatToXY(eqc, lon, lat))
}

/** The tab's data for a pad, as mission/data.ts loadMissionData builds it (grid, model, components). */
async function loadTab(pad: MissionPad): Promise<Tab> {
  const keys = fieldKeys(pad, SID)
  const tHome = field(keys.tHome)
  const o2Home = fi!.fields[keys.o2Home] ? field(keys.o2Home) : null
  const elev = await elevationFor(tHome)
  elevCache = { tHome, elev }
  const passable = new Uint8Array(tHome.width * tHome.height)
  passable.set(tHome.data.known)
  const grid = { width: tHome.width, height: tHome.height, resM: tHome.resM, elev, passable }
  const model = gradeModel(scenarioParams(SID))
  const padLL = pad === null ? J<PadFile>('pad.json').pad : J<{ pads: { id: string; lon: number; lat: number }[] }>('scenarios/pads/index.json').pads.find((r) => r.id === pad)!
  const p = tHome.pixelOf(padLL.lon, padLL.lat)
  const padCell = padCellOf(grid, p ? p.row * tHome.width + p.col : null)
  const d = { grid, model, components: new Map<number, Uint8Array>() }
  const t0 = performance.now()
  const comp = reachableFrom(d, padCell)
  const compMs = performance.now() - t0
  return { ...d, tHome, o2Home, padCell, comp, compMs, router: new LegRouter(grid, model) }
}

const stations = existsSync(PUB) ? J<Station[]>('stations.json') : []
const ownCell = (tab: Tab, lon: number, lat: number): number | null => {
  const p = tab.tHome.pixelOf(lon, lat)
  return p ? p.row * tab.tHome.width + p.col : null
}
/** A station's stop as the tab adds it (stations.ts stationWaypoint): its own cell and its routing cell. */
function stationStop(tab: Tab, id: string): { own: number | null; cell: StopCell; stopMin: number; ms: number } {
  const w = stationWaypoint(stations.find((s) => s.id === id)!, SID)!
  const own = ownCell(tab, w.lon, w.lat)
  const t0 = performance.now()
  const cell = stopCell(tab, tab.comp, own)
  return { own, cell, stopMin: w.stopMin, ms: performance.now() - t0 }
}
/** The tab's legs (pad -> stops) with the J1i guard, as views/mission.tsx legsNow. */
const routeAll = (tab: Tab, cells: number[]): (Leg | null)[] => {
  let prev = tab.padCell
  return cells.map((c) => {
    const leg = legInComponent(tab.comp, prev, c) ? tab.router.route(prev, c) : null
    prev = c
    return leg
  })
}
const homeOf = (tab: Tab, cell: number) => {
  const r = Math.floor(cell / tab.tHome.width)
  const c = cell % tab.tHome.width
  return { tHomeMin: tab.tHome.valueAtPixel(r, c), o2HomeL: tab.o2Home ? tab.o2Home.valueAtPixel(r, c) : null }
}

async function loadEstimate(tHome: FieldGrid, elev: Float32Array): Promise<BrowserRouteData> {
  const pMeta = fi!.fields[`${SID}/pointer`]
  return makeBrowserRouteData({
    scenario: SID,
    tHome,
    o2Home: field(`${SID}/o2_home`),
    pointer: new PointerField(field(`${SID}/pointer`), pMeta.stencil!),
    grid: routeGridOf(tHome, elev),
    model: sharedGradeModel(sharedParams(SID)),
    stations,
    padFile: J<PadFile>('pad.json'),
    rad: J<Rad>('conditions/rad.json'),
    clock: J('conditions/clock.json'),
  })
}

describe.skipIf(!existsSync(PUB))('J1i: stops snap into the pad\'s reachable component (real data, official pad)', () => {
  let tab: Tab
  let est: BrowserRouteData
  beforeAll(async () => {
    tab = await loadTab(null)
    est = await loadEstimate(elevCache!.tHome, elevCache!.elev)
  }, 120_000)

  it('the component is the estimate\'s (I1a reachableFrom on the same grid), computed once per pad', () => {
    expect(tab.padCell).toBeGreaterThanOrEqual(0)
    expect(tab.comp[tab.padCell]).toBe(1)
    expect(sharedReach(est, tab.padCell)).toEqual(tab.comp)
    // cached: the second call returns the same array
    expect(reachableFrom(tab, tab.padCell)).toBe(tab.comp)
    console.info(`[J1i] official pad component: ${tab.comp.reduce((s, v) => s + v, 0)} cells, flood fill ${tab.compMs.toFixed(0)} ms`)
  })

  it('before J1i, S6, S1 and S8 were routed from their own cells, which are outside the pad component', () => {
    for (const id of ['S6', 'S1', 'S8']) {
      const s = stationStop(tab, id)
      expect(s.own).not.toBeNull()
      expect(tab.comp[s.own!]).toBe(0)
    }
  })

  it('official route S7 -> S6 -> S1 -> S4: every leg routes, with the instant estimate\'s cells, legs and totals', () => {
    const ids = ['S7', 'S6', 'S1', 'S4']
    const stops = ids.map((id) => stationStop(tab, id))
    const cells = stops.map((s) => s.cell)
    expect(cells.every((c) => typeof c === 'number')).toBe(true)
    const legs = routeAll(tab, cells as number[])
    expect(legs.every((l) => l !== null)).toBe(true)
    const b = missionBudget(legs.map((l) => ({ timeMin: l!.timeS / 60, o2L: l!.o2L })), homeOf(tab, cells[cells.length - 1] as number), stops.map((s) => s.stopMin))

    const r = computeBrowserRoute(est, est.fieldsPad, ids.map((station) => ({ station })))
    expect(r.issues).toEqual([])
    expect(r.detail.padCell).toBe(tab.padCell)
    expect(r.detail.cells).toEqual(cells)
    r.detail.routerLegs.forEach((l, i) => {
      expect(legs[i]!.timeS).toBeCloseTo(l!.timeS, 6)
      expect(legs[i]!.o2L).toBeCloseTo(l!.o2L, 6)
      expect(legs[i]!.distM).toBeCloseTo(l!.distM, 6)
    })
    expect(b.walkMin!).toBeCloseTo(r.totals.outWalkMin!, 6)
    expect(b.stopMin).toBe(r.totals.dwellMin)
    // way home: the tab takes T_home at the last stop, the estimate times WS2's pointer path; both WS2's field
    expect(Math.abs(b.evaMin! - r.totals.evaMin!)).toBeLessThan(5)
    // the tab's O2 used is up to the last stop; the estimate's is back at the pad (+ the way home)
    expect(Math.abs(b.o2UsedL! + b.o2HomeL! - r.totals.o2UsedL!)).toBeLessThan(5)
    console.info(
      `[J1i] official S7,S6,S1,S4: tab walk out ${b.walkMin!.toFixed(2)} min, home ${b.tHomeMin!.toFixed(2)}, stops ${b.stopMin}, EVA ${b.evaMin!.toFixed(2)} min, O2 used at the pad ${(b.o2UsedL! + b.o2HomeL!).toFixed(2)} L | ` +
        `estimate walk out ${r.totals.outWalkMin!.toFixed(2)}, home ${r.totals.homeWalkMin?.toFixed(2)}, dwell ${r.totals.dwellMin}, EVA ${r.totals.evaMin!.toFixed(2)} min, O2 used at the pad ${r.totals.o2UsedL!.toFixed(2)} L; ` +
        `legs km ${legs.map((l) => (l!.distM / 1000).toFixed(2)).join('/')}`,
    )
  })

  it('every station either routes from the pad or is not reachable at once (S8 included)', () => {
    for (const s of stations) {
      const st = stationStop(tab, s.id)
      expect(st.ms).toBeLessThan(50)
      if (typeof st.cell === 'number') {
        expect(routeAll(tab, [st.cell])[0]).not.toBeNull()
        console.info(`[J1i] official ${s.id}: routes (cell ${st.cell}${st.cell === st.own ? '' : `, snapped from ${st.own}`})`)
      } else console.info(`[J1i] official ${s.id}: ${st.cell} (${st.ms.toFixed(2)} ms)`)
    }
    expect(typeof stationStop(tab, 'S8').cell === 'number' || stationStop(tab, 'S8').cell === 'unreachable').toBe(true)
  })

  it('a walkable free point outside the component answers "unreachable" in < 50 ms, and its leg is null without A*', () => {
    const { width: W, passable } = tab.grid
    const R = Math.floor(ACCESS_RADIUS_M / tab.grid.resM)
    let found = -1
    // a walkable cell with no component cell within the radius (scan from the pad outwards in rows)
    for (let i = 0; i < passable.length && found < 0; i += 7) {
      if (!passable[i] || tab.comp[i]) continue
      const r0 = Math.floor(i / W)
      const c0 = i % W
      let near = false
      for (let dr = -R; dr <= R && !near; dr++) for (let dc = -R; dc <= R && !near; dc++) if (dr * dr + dc * dc <= R * R && tab.comp[(r0 + dr) * W + c0 + dc]) near = true
      if (!near) found = i
    }
    expect(found).toBeGreaterThanOrEqual(0)
    const t0 = performance.now()
    const c = stopCell(tab, tab.comp, found)
    const legOk = legInComponent(tab.comp, tab.padCell, found)
    const ms = performance.now() - t0
    expect(c).toBe('unreachable')
    expect(legOk).toBe(false)
    expect(ms).toBeLessThan(50)
    console.info(`[J1i] unreachable free point (cell ${found}): answered in ${ms.toFixed(3)} ms`)
  })

  it('a spot outside the grid is "outside"; a spot with no walkable cell within the radius is "blocked"', () => {
    expect(stopCell(tab, tab.comp, null)).toBe('outside')
    const { passable, width: W, height: H } = tab.grid
    const R = Math.floor(ACCESS_RADIUS_M / tab.grid.resM)
    let blocked = -1
    for (let r = R; r < H - R && blocked < 0; r += 13)
      for (let c = R; c < W - R && blocked < 0; c += 13) {
        let any = false
        for (let dr = -R; dr <= R && !any; dr++) for (let dc = -R; dc <= R && !any; dc++) if (dr * dr + dc * dc <= R * R && passable[(r + dr) * W + c + dc]) any = true
        if (!any) blocked = r * W + c
      }
    expect(blocked).toBeGreaterThanOrEqual(0)
    expect(stopCell(tab, tab.comp, blocked)).toBe('blocked')
  })
})

describe.skipIf(!existsSync(PUB) || !fi?.fields[fieldKeys('rank4', SID).tHome])('J1i: the same on pad P4 (rank4, real data)', () => {
  let tab: Tab
  beforeAll(async () => {
    tab = await loadTab('rank4')
  }, 120_000)

  it('every station either routes from P4 or is not reachable at once (S8 included)', () => {
    console.info(`[J1i] P4 component: ${tab.comp.reduce((s, v) => s + v, 0)} cells, flood fill ${tab.compMs.toFixed(0)} ms`)
    for (const s of stations) {
      const st = stationStop(tab, s.id)
      expect(st.ms).toBeLessThan(50)
      if (typeof st.cell === 'number') {
        const t0 = performance.now()
        expect(routeAll(tab, [st.cell])[0]).not.toBeNull()
        console.info(`[J1i] P4 ${s.id}: routes (${(performance.now() - t0).toFixed(0)} ms A*)`)
      } else {
        expect(st.cell).toBe('unreachable')
        console.info(`[J1i] P4 ${s.id}: unreachable (${st.ms.toFixed(2)} ms)`)
      }
    }
  })
})
