// I4 known answers: a moved EVA start (Mars24 port, marstime.ts) feeds the browser estimate's daylight term
// and mission.json; the default start (clock.json's instant, D31) changes nothing. Real published data
// (web/public/data, the official pad's 5 m fields); skips only when it is absent. The loader is the one in
// compute.test.ts (copied, so this file does not re-run I1a's tests).
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
import { routeGridOf, sampleElevation } from '../map/grid'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, HeightGrid, lonLatToXY, parseEqc, parseIndex } from '../map/heights'
import { gradeModel, scenarioParams } from '../map/physio'
import { buildBrowserMission, buildBrowserMissionDraft, computeBrowserRoute, type BrowserRouteResult } from './compute'
import { makeBrowserRouteData, type BrowserRouteData } from './data'
import { ORIGIN_LABEL } from './export'
import { clockValues, CUSTOM_START_LABEL, DEFAULT_START_MS, isDefaultStart, startClock } from './start'

const PUB = resolve(REPO, 'web/public/data')
const SCHEMA = resolve(REPO, 'contracts/bundle/mission.schema.json')
const PY = resolve(REPO, '.venv/bin/python')
const J = <T>(rel: string): T => JSON.parse(readFileSync(resolve(PUB, rel), 'utf8')) as T
const MIN = 60_000

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

/** The result without the leg cache objects (structural comparison). */
const plain = (r: BrowserRouteResult) => JSON.parse(JSON.stringify({ ...r, detail: { ...r.detail, routerLegs: null } }))

describe('EVA start clock (no data)', () => {
  it('the default start is clock.json’s instant (D31): 10:51:18Z, 09:00:00 LMST, sol 5074, t_dark 578.67', () => {
    const v = clockValues(startClock(DEFAULT_START_MS, { lat: -4.77748, lon: 137.401783 }))
    expect(v).toEqual({ evaStartUtc: '2026-11-14T10:51:18Z', evaStartLmst: '09:00:00', mslSol: 5074, tDarkMin: 578.67 })
    expect(isDefaultStart(null)).toBe(true)
    expect(isDefaultStart(DEFAULT_START_MS + 999)).toBe(true)
    expect(isDefaultStart(DEFAULT_START_MS + 2 * 3600_000)).toBe(false)
  })
  it('+2 h on the same sol: 2 h less daylight; after sunset: no daylight (0 min)', () => {
    const site = { lat: -4.77748, lon: 137.401783 }
    const later = clockValues(startClock(DEFAULT_START_MS + 120 * MIN, site))
    expect(later.tDarkMin).toBeCloseTo(578.67 - 120, 1)
    expect(later.mslSol).toBe(5074)
    expect(clockValues(startClock(DEFAULT_START_MS + 600 * MIN, site)).tDarkMin).toBe(0)
  })
})

describe.skipIf(!existsSync(PUB))('EVA start in the browser estimate (real data, nom_104, rank1)', () => {
  let d: BrowserRouteData
  const st = (...ids: string[]): RouteStop[] => ids.map((station) => ({ station }))
  const OFFICIAL = st('S7', 'S6', 'S1', 'S4')
  const at = (ms: number) => clockValues(startClock(ms, d.fieldsPad))
  beforeAll(async () => {
    d = await loadFromFiles(CONFIG.defaultScenario)
  }, 60_000)

  it('default start: no override, the estimate and mission.json are clock.json’s; the Mars24 clock at the default instant gives the same numbers', () => {
    const base = computeBrowserRoute(d, d.fieldsPad, OFFICIAL)
    expect('clock' in base).toBe(false)
    const draft = buildBrowserMissionDraft(base, { data: d }) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(draft.origin_label).toBe(ORIGIN_LABEL)
    expect(draft.conditions).toMatchObject({ eva_start_lmst: '09:00:00', t_dark_min: 578.67, eva_start_utc: '2026-11-14T10:51:18Z', msl_sol: 5074 })
    // an explicit override at the default instant reproduces every number (only the label would differ)
    const same = computeBrowserRoute(d, d.fieldsPad, OFFICIAL, at(DEFAULT_START_MS))
    const { clock: _c, ...rest } = plain(same)
    expect(rest).toEqual(plain(base))
    const d2 = buildBrowserMissionDraft(same, { data: d })
    expect({ ...d2, origin_label: ORIGIN_LABEL }).toEqual(draft)
  })

  it('a start 2 h later shrinks the daylight term by 120 min at every point of the track', () => {
    const base = computeBrowserRoute(d, d.fieldsPad, OFFICIAL)
    const later = computeBrowserRoute(d, d.fieldsPad, OFFICIAL, at(DEFAULT_START_MS + 120 * MIN))
    const p0 = base.detail.margin!.points
    const p1 = later.detail.margin!.points
    expect(p1).toHaveLength(p0.length)
    for (let k = 0; k < p0.length; k++) expect(p0[k].terms.daylight! - p1[k].terms.daylight!).toBeCloseTo(120, 1)
    // walking is the same; only the clock moved
    expect(later.totals).toEqual(base.totals)
    expect(later.tightest!.marginMin).toBeLessThanOrEqual(base.tightest!.marginMin)
  })

  it('a late enough start flips the route to infeasible on daylight (first failing leg named); after sunset it fails at once', () => {
    const base = computeBrowserRoute(d, d.fieldsPad, OFFICIAL)
    expect(base.feasibility).toEqual({ feasible: true })
    const eva = base.totals.evaMin!
    // darkness 60 min before the walk back ends
    const late = computeBrowserRoute(d, d.fieldsPad, OFFICIAL, at(DEFAULT_START_MS + (578.67 - (eva - 60)) * MIN))
    expect(late.feasibility!.feasible).toBe(false)
    const f = late.feasibility as Extract<BrowserRouteResult['feasibility'], { feasible: false }>
    expect(f.limit).toBe('daylight')
    expect(f.shortfall_min).toBeGreaterThan(0)
    expect(late.tightest!.binding).toBe('daylight')
    expect(late.tightest!.marginMin).toBeLessThan(0)
    const dark = computeBrowserRoute(d, d.fieldsPad, OFFICIAL, at(DEFAULT_START_MS + 600 * MIN))
    expect(dark.feasibility).toMatchObject({ feasible: false, leg: 0, limit: 'daylight' })
    process.stdout.write(`\n[I4] S7,S6,S1,S4 start +${(578.67 - (eva - 60)).toFixed(0)} min: leg ${f.leg} ${f.from}->${f.to} ${f.limit} ${f.shortfall_min} min short\n`)
  })

  it('mission.json from a custom start: the label, the moved start fields; validates against mission.schema.json', async () => {
    const ms = DEFAULT_START_MS + 120 * MIN
    const r = computeBrowserRoute(d, d.fieldsPad, OFFICIAL, at(ms))
    const doc = (await buildBrowserMission(r, { data: d, now: new Date('2026-11-15T15:30:00Z') })) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(doc.origin).toBe('mission_planer')
    expect(doc.origin_label).toBe(`${ORIGIN_LABEL} · ${CUSTOM_START_LABEL}`)
    expect(doc.origin_label).toContain('custom start · outside the validated scenario')
    expect(doc.conditions.eva_start_utc).toBe('2026-11-14T12:51:18Z')
    expect(doc.conditions.eva_start_lmst).toBe('10:56:47') // 2 Earth hours = 1 h 56 min 47 s of Mars time
    expect(doc.conditions.msl_sol).toBe(5074)
    expect(doc.conditions.t_dark_min).toBeCloseTo(458.67, 1)
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as { required: string[] }
    for (const k of schema.required) expect(doc, k).toHaveProperty(k)
    if (existsSync(PY)) {
      const v = validateWithPython(doc)
      expect(v.out.trim()).toBe('OK')
      expect(v.ok).toBe(true)
    }
  })
})
