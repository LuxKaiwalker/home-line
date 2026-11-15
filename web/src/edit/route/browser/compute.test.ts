// I1a (instant browser path): computeBrowserRoute + buildBrowserMission on the REAL published data
// (web/public/data: the official pad's 5 m fields, the 8 m fp3d heights, stations, WS4 conditions).
// Skips only when web/public/data is absent. The mission object is validated against
// contracts/bundle/mission.schema.json with the repo's Python jsonschema (.venv), as
// tests/e2e/route/check_mission.py (WP8c) does; plus a structural check here.
/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONFIG } from '../../../config'
import type { PadFile, Rad, Station } from '../../../data/types'
import { decodeRGBA, FieldGrid, fieldGrid } from '../../../hud/fields'
import { readPngRGBA, REPO } from '../../../hud/testutil'
import type { FieldsIndex } from '../../../hud/types'
import { PointerField } from '../../../hud/wayhome'
import type { RouteStop } from '../model'
import { accessCell, cellOf, lonLatOfCell, routeGridOf, sampleElevation } from '../map/grid'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, HeightGrid, lonLatToXY, parseEqc, parseIndex } from '../map/heights'
import { gradeModel, scenarioParams } from '../map/physio'
import { buildBrowserMission, buildBrowserMissionDraft, computeBrowserRoute } from './compute'
import { makeBrowserRouteData, type BrowserRouteData } from './data'
import { ORIGIN_LABEL } from './export'
import { clockAt, DEFAULT_START_MS, withEvaStart } from './start'

const PUB = resolve(REPO, 'web/public/data')
const SCHEMA = resolve(REPO, 'contracts/bundle/mission.schema.json')
const PY = resolve(REPO, '.venv/bin/python')
const J = <T>(rel: string): T => JSON.parse(readFileSync(resolve(PUB, rel), 'utf8')) as T

async function loadFromFiles(sid: string): Promise<BrowserRouteData> {
  const fi = J<FieldsIndex>('fields/index.json')
  const field = (k: string) => {
    const meta = fi.fields[k]
    const { rgba, width, height } = readPngRGBA(resolve(PUB, meta.file))
    return new FieldGrid(fieldGrid(fi, k), decodeRGBA(rgba, width, height, meta.scale), meta.units)
  }
  const tHome = field(`${sid}/t_home`)
  const o2Home = field(`${sid}/o2_home`)
  const pMeta = fi.fields[`${sid}/pointer`]
  const pointer = new PointerField(field(`${sid}/pointer`), pMeta.stencil!)
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
    padFile: J<PadFile>('pad.json'),
    rad: J<Rad>('conditions/rad.json'),
    clock: J('conditions/clock.json'),
    files: { tHome: fi.fields[`${sid}/t_home`].file, o2Home: fi.fields[`${sid}/o2_home`].file, pointer: pMeta.file, elevation: fp.far.file },
    elevationResM: fp.far.res_m,
  })
}

/** A walkable cell ~`m` metres east / north of a point (free-point fixture on the real grid). */
function freePointNear(d: BrowserRouteData, lon: number, lat: number, eastM: number, northM: number): { lon: number; lat: number } {
  const c = accessCell(d.grid, cellOf(d.tHome, lon + eastM / d.tHome.mPerDegLon, lat + northM / d.tHome.mPerDegLat), 50)
  if (c === null) throw new Error('fixture: no walkable cell')
  const [plon, plat] = lonLatOfCell(d.tHome, c)
  return { lon: Math.round(plon * 1e6) / 1e6, lat: Math.round(plat * 1e6) / 1e6 }
}

function validateWithPython(doc: unknown): { ok: boolean; out: string } {
  const code = [
    'import json, sys',
    'from jsonschema import Draft202012Validator',
    `schema = json.load(open(${JSON.stringify(SCHEMA)}))`,
    'doc = json.load(sys.stdin)',
    'errs = sorted(Draft202012Validator(schema).iter_errors(doc), key=lambda e: list(e.path))',
    "print('\\n'.join(f'{list(e.path)}: {e.message}' for e in errs[:20]) or 'OK')",
    'sys.exit(1 if errs else 0)',
  ].join('\n')
  const r = spawnSync(PY, ['-I', '-c', code], { input: JSON.stringify(doc), encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }
}

describe.skipIf(!existsSync(PUB))('computeBrowserRoute on the official pad (real data, nom_104)', () => {
  let d: BrowserRouteData
  const st = (...ids: string[]): RouteStop[] => ids.map((station) => ({ station }))
  beforeAll(async () => {
    d = await loadFromFiles(CONFIG.defaultScenario)
  }, 60_000)

  it('stations only, the official order: legs in the given order, way home on the pointer field, feasible', () => {
    const r = computeBrowserRoute(d, d.fieldsPad, st('S7', 'S6', 'S1', 'S4'))
    expect(r.issues).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.legs.map((l) => [l.leg, l.from, l.to, l.kind])).toEqual([
      [0, 'pad', 'S7', 'out'], [1, 'S7', 'S6', 'out'], [2, 'S6', 'S1', 'out'], [3, 'S1', 'S4', 'out'], [4, 'S4', 'pad', 'home'],
    ]) // prettier-ignore
    expect(r.legs.every((l) => l.routed)).toBe(true)
    expect(r.feasibility).toEqual({ feasible: true })
    // dwell: stations.json dwell_min (30) at each stop; clock 09:00 LMST
    expect(r.dwellMin).toEqual([30, 30, 30, 30])
    expect(r.legs[1].dwellBeforeMin).toBe(30)
    expect(r.legs[4].arriveMin).toBeCloseTo(r.totals.evaMin!, 6)
    // the engine's official route takes 325.94 min (pads/index.json route.total_min); the 5 m estimate is close
    expect(Math.abs(r.totals.evaMin! - 325.94)).toBeLessThan(25)
    expect(r.totals.o2LeftL! + r.totals.o2UsedL!).toBeCloseTo(r.totals.o2CapacityL, 9)
    expect(r.tightest).not.toBeNull()
    expect(r.tightest!.marginMin).toBeGreaterThanOrEqual(0)
    expect(['O2', 'daylight', 'dose', 'EVA duration']).toContain(r.tightest!.binding)
  })

  it('an order that breaks a limit: the FIRST failing leg, its limit and the minutes short; never reordered', () => {
    const order = st('S2', 'S8', 'S7', 'S6', 'S1', 'S4')
    const r = computeBrowserRoute(d, d.fieldsPad, order)
    expect(r.names).toEqual(['S2', 'S8', 'S7', 'S6', 'S1', 'S4'])
    expect(r.legs.map((l) => l.to)).toEqual(['S2', 'S8', 'S7', 'S6', 'S1', 'S4', 'pad'])
    expect(r.feasibility!.feasible).toBe(false)
    const f = r.feasibility as Extract<typeof r.feasibility, { feasible: false }>
    expect(f.legs_planned).toBe(f.leg)
    expect(f.from).toBe(['pad', ...r.names][f.leg])
    expect(f.to).toBe([...r.names, 'pad'][f.leg])
    expect(['O2', 'daylight', 'dose', 'EVA duration']).toContain(f.limit)
    expect(f.shortfall_min).toBeGreaterThan(0)
    // first: every leg before it passes on its own prefix (the prefix route is feasible)
    if (f.leg > 0) expect(computeBrowserRoute(d, d.fieldsPad, order.slice(0, f.leg)).feasibility).toEqual({ feasible: true })
    process.stdout.write(`\n[I1a] infeasible S2,S8,S7,S6,S1,S4 on rank1: leg ${f.leg} ${f.from}->${f.to} ${f.limit} ${f.shortfall_min} min\n`)
  })

  it('free points W1..Wn are named in order among the free stops; mixed route computes', () => {
    const w1 = freePointNear(d, d.fieldsPad.lon, d.fieldsPad.lat, 200, 0)
    const w2 = freePointNear(d, d.fieldsPad.lon, d.fieldsPad.lat, 0, -250)
    const r = computeBrowserRoute(d, d.fieldsPad, [w1, { station: 'S7' }, { ...w2, label: 'core' }])
    expect(r.names).toEqual(['W1', 'S7', 'W2'])
    expect(r.issues).toEqual([])
    expect(r.legs.map((l) => l.from)).toEqual(['pad', 'W1', 'S7', 'W2'])
    expect(r.feasibility).not.toBeNull()
  })

  it('a point off the grid is an issue, not a guess', () => {
    const r = computeBrowserRoute(d, d.fieldsPad, [{ lon: 100, lat: 0 }])
    expect(r.issues).toEqual([{ index: 0, code: 'route_point_outside_grid' }])
    expect(r.feasibility).toBeNull()
  })

  it('mission.json: schema 1.1.0, origin mission_planer, the estimate label; validates against contracts/bundle/mission.schema.json', async () => {
    const w1 = freePointNear(d, d.fieldsPad.lon, d.fieldsPad.lat, 200, 0)
    const r = computeBrowserRoute(d, d.fieldsPad, [{ station: 'S7' }, w1, { station: 'S6' }])
    const doc = (await buildBrowserMission(r, { data: d, now: new Date('2026-11-15T14:40:00Z') })) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(doc.schema_version).toBe('1.1.0')
    expect(doc.origin).toBe('mission_planer')
    expect(doc.origin_label).toBe('Estimate · browser, 5 m grid · not part of the validated scorecard')
    expect(ORIGIN_LABEL).toBe(doc.origin_label)
    expect(doc.mission_id).toMatch(/^m-[0-9a-f]{12}$/)
    expect(doc.created_utc).toBe('2026-11-15T14:40:00Z')
    expect(doc.frame.pad).toMatchObject({ kind: 'official', id: 'rank1' })
    expect(doc.waypoints.map((w: { tags: string[] }) => w.tags[0])).toEqual(['S7', 'W1', 'S6'])
    expect(doc.legs.map((l: { kind: string }) => l.kind)).toEqual(['out', 'out', 'out', 'home'])
    expect(doc.conditions.eva_start_lmst).toBe('09:00:00')
    // structural: every required top-level key of the schema
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as { required: string[] }
    for (const k of schema.required) expect(doc, k).toHaveProperty(k)
    if (existsSync(PY)) {
      const v = validateWithPython(doc)
      expect(v.out.trim()).toBe('OK')
      expect(v.ok).toBe(true)
    }
    // the draft is the same document without id / time
    const draft = buildBrowserMissionDraft(r, { data: d })
    expect({ ...draft, mission_id: doc.mission_id, created_utc: doc.created_utc }).toEqual(doc)
  })

  // I3: the EVA start picker's instant feeds t_dark and the export (browser/start.ts)
  it('EVA start: default = clock.json (the data as is); a moved start moves t_dark, the daylight term and mission.json', async () => {
    expect(withEvaStart(d, null)).toBe(d)
    expect(withEvaStart(d, DEFAULT_START_MS)).toBe(d)
    // the Mars24 port at the default instant reproduces clock.json's t_dark at the fields' pad
    expect(clockAt(d, null).tDarkMin!).toBeCloseTo(d.tDarkMin!, 1)
    const stops = st('S7', 'S6', 'S1', 'S4')
    const base = computeBrowserRoute(d, d.fieldsPad, stops)
    // 5 h later (Earth time): darkness 300 min sooner; the same walk now binds on daylight and fails
    const later = withEvaStart(d, DEFAULT_START_MS + 5 * 3600_000)
    expect(later).not.toBe(d)
    expect(later.legCache).toBe(d.legCache) // shared: the walk does not depend on the clock
    expect(later.tDarkMin!).toBeCloseTo(d.tDarkMin! - 300, 0)
    expect(later.customStart).toBe(true)
    expect(later.evaStartUtc).toBe('2026-11-14T15:51:18Z')
    expect(later.evaStartLmst).toMatch(/^13:5\d:\d\d$/)
    const r = computeBrowserRoute(later, later.fieldsPad, stops)
    expect(r.totals.evaMin).toBeCloseTo(base.totals.evaMin!, 6)
    expect(r.feasibility).toMatchObject({ feasible: false, limit: 'daylight' })
    const doc = (await buildBrowserMission(r, { data: later, now: new Date('2026-11-15T15:30:00Z') })) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(doc.origin_label).toBe(`${ORIGIN_LABEL} · custom start · outside the validated scenario`)
    expect(doc.conditions).toMatchObject({ eva_start_utc: '2026-11-14T15:51:18Z', t_dark_min: later.tDarkMin, msl_sol: 5074, eva_start_lmst: later.evaStartLmst })
    if (existsSync(PY)) expect(validateWithPython(doc).out.trim()).toBe('OK')
    // the default export is unchanged: clock.json's values and the plain estimate label
    const def = (await buildBrowserMission(base, { data: d })) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(def.origin_label).toBe(ORIGIN_LABEL)
    expect(def.conditions).toMatchObject({ eva_start_utc: '2026-11-14T10:51:18Z', t_dark_min: 578.67, eva_start_lmst: '09:00:00', msl_sol: 5074 })
    // the sun already down at the start: t_dark 0 (daylight negative from the first minute), never null
    expect(withEvaStart(d, DEFAULT_START_MS + 12 * 3600_000).tDarkMin).toBe(0)
  })

  it('performance: 4 stations + 4 free points, one full recompute with a warm leg cache', () => {
    const p = d.fieldsPad
    const fps = [freePointNear(d, p.lon, p.lat, 300, 0), freePointNear(d, p.lon, p.lat, -300, 0), freePointNear(d, p.lon, p.lat, 0, 300), freePointNear(d, p.lon, p.lat, 0, -300)]
    const stops: RouteStop[] = [{ station: 'S7' }, fps[0], { station: 'S6' }, fps[1], { station: 'S1' }, fps[2], { station: 'S4' }, fps[3]]
    const t0 = performance.now()
    computeBrowserRoute(d, p, stops)
    const cold = performance.now() - t0
    const runs: number[] = []
    for (let k = 0; k < 5; k++) {
      const t = performance.now()
      computeBrowserRoute(d, p, stops)
      runs.push(performance.now() - t)
    }
    const warm = Math.min(...runs)
    const median = [...runs].sort((a, b) => a - b)[2]
    process.stdout.write(`\n[I1a] 4 stations + 4 free points: cold ${cold.toFixed(1)} ms, warm min ${warm.toFixed(1)} ms, warm median ${median.toFixed(1)} ms\n`)
    expect(median).toBeLessThan(150)
  })
})
