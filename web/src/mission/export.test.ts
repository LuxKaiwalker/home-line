// Known answers for the mission.json export (contracts/bundle/mission.schema.json): a 10 m leg due
// east of the pad on a 5 m grid, a 5-min stop, and the way home back along the same cells.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { lonLatToXY, parseEqc, xyToLonLat } from '../fp3d/geo'
import { BUDGET_CONSTANTS, missionBudget } from './budget'
import { REPO } from '../hud/testutil'
import { buildMission, CUSTOM_START_LABEL, finalizeMission, ORIGIN_LABEL, originLabel, type MissionExportInput } from './export'
import { buildTrack, doseTimingFromRad, legProfile, missionMargin } from './margin'
import type { Rad } from '../data/types'
import type { LonLat, Waypoint } from './plan'
import type { Leg } from './router'

const eqc = parseEqc(CONFIG.analysisProj)
const PAD: LonLat = [137.39, -4.8]
const [PX, PY] = lonLatToXY(eqc, PAD[0], PAD[1])
const PAD_ELEV = -3700
const W = 3
/** cell = row * 3 + col; cell 0 is the pad, cols go east in 5 m steps */
const cellLonLat = (c: number): LonLat => xyToLonLat(eqc, PX + (c % W) * 5, PY - Math.floor(c / W) * 5)
const xOf = (lon: number, lat: number) => lonLatToXY(eqc, lon, lat)[0] - PX
const homeAt = (lon: number, lat: number) => ({ tHomeMin: (xOf(lon, lat) / 5) * 0.1, o2HomeL: xOf(lon, lat) * 0.01 })
const elevAt = (lon: number, lat: number) => PAD_ELEV + xOf(lon, lat) / 10

const LEG: Leg = { cells: [0, 1, 2], timeS: 12, o2L: 0.2, distM: 10, tauS: [0, 6, 12], o2CumL: [0, 0.1, 0.2] }
const [WLON, WLAT] = cellLonLat(2)
const WP: Waypoint = { id: 7, lon: WLON, lat: WLAT, cell: 2, note: 'core sample', tags: ['Drill'], stopMin: 5 }

function input(legs: (Leg | null)[]): MissionExportInput {
  const home = homeAt(WLON, WLAT)
  const budget = missionBudget(legs.map((l) => (l ? { timeMin: l.timeS / 60, o2L: l.o2L } : null)), home, [WP.stopMin])
  const cellHome = (c: number) => homeAt(...cellLonLat(c))
  const track = legs.every((l) => l) ? buildTrack(legs.map((l) => legProfile(l!, cellHome)), [WP.stopMin]) : null
  return {
    proj: CONFIG.analysisProj,
    pad: { kind: 'official', id: 'rank1', lon: PAD[0], lat: PAD[1], elevM: PAD_ELEV, source: 'test' },
    scenario: { id: 'nom_104', variant: 'nominal', suit_kg: 104 },
    planner: { gridResM: 5, elevationResM: 8, files: {} },
    constants: { ...BUDGET_CONSTANTS, marginAmberMin: CONFIG.marginAmberMin },
    conditions: { evaStartLmst: '09:00:00', tDarkMin: 500, storm: false },
    wps: [WP],
    legs,
    homePath: [cellLonLat(2), cellLonLat(1), cellLonLat(0)],
    homeReachesPad: true,
    budget,
    margin: missionMargin(track, { tDarkMin: 500, rad: null, storm: false }),
    cellLonLat,
    elevAt,
    homeAt,
    label: CONFIG.simulatedLabel,
    dummy: false,
  }
}

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('buildMission', () => {
  const doc = buildMission(input([LEG])) as Doc

  it('puts the pad at the origin of the pad-local frame', () => {
    expect(doc.frame.projection.pad_xy_m).toEqual([Math.round(PX * 1e4) / 1e4, Math.round(PY * 1e4) / 1e4])
    expect(doc.path.rows[0]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(doc.world.plan_bundle_id).toBe('rank1.nom_104')
  })

  it('converts the out leg to metres, minutes and litres', () => {
    expect(doc.legs[0]).toMatchObject({ leg: 1, kind: 'out', from: 'pad', to: 'wp1', routed: true, length_m: 10, time_min: 0.2, o2_l: 0.2, t_start_min: 0, t_end_min: 0.2, first_row: 0, n_rows: 3 })
    expect(doc.path.rows[2]).toEqual([1, 10, 10, 0, 1, 0.2, 0.2, 0.2, 0.1])
  })

  it('times the waypoint stop at the station task rate', () => {
    const w = doc.waypoints[0]
    expect(w).toMatchObject({ index: 1, id: 7, x_m: 10, y_m: 0, z_m: 1, note: 'core sample', tags: ['Drill'], stop_min: 5, arrive_t_min: 0.2, leave_t_min: 5.2, t_home_min: 0.2, o2_home_l: 0.1 })
    expect(w.o2_used_at_leave_l).toBeCloseTo(0.2 + 5 * BUDGET_CONSTANTS.stationRateLMin, 3)
  })

  it('times the way home from T_home and O2_home along the pointer path', () => {
    expect(doc.legs[1]).toMatchObject({ leg: 2, kind: 'home', from: 'wp1', to: 'pad', routed: true, length_m: 10, time_min: 0.2, t_start_min: 5.2, t_end_min: 5.4, first_row: 3, n_rows: 3 })
    const last = doc.path.rows[5]
    expect(last.slice(0, 6)).toEqual([2, 10, 0, 0, 0, 5.4])
    expect(last[6]).toBeCloseTo(doc.waypoints[0].o2_used_at_leave_l + 0.1, 3)
  })

  it('carries the planned margin and calls the mission feasible', () => {
    expect(doc.timeline.rows[0].slice(0, 3)).toEqual([0, 'depart', null])
    expect(doc.timeline.rows.at(-1)[1]).toBe('return')
    expect(doc.timeline.rows.find((r: unknown[]) => r[1] === 'arrive')[2]).toBe(1) // 1-based waypoint
    expect(doc.summary.feasible).toBe(true)
    expect(doc.conditions).toEqual({
      eva_start_lmst: '09:00:00', t_dark_min: 500, storm_replay: false, t_star_min: null, eva_start_utc: null, msl_sol: null, dose: null,
    })
  })

  it('marks an unrouted leg: nulls, no timeline, not feasible', () => {
    const bad = buildMission(input([null])) as Doc
    expect(bad.legs[0]).toMatchObject({ routed: false, time_min: null, first_row: null, n_rows: 0 })
    expect(bad.waypoints[0].arrive_t_min).toBeNull()
    expect(bad.timeline).toBeNull()
    expect(bad.summary.feasible).toBe(false)
  })
})

describe('EVA clock and storm replay for the simulator', () => {
  const rad = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/conditions/rad.json'), 'utf8')) as Rad

  it('passes the EVA start instant and MSL sol through', () => {
    const inp = input([LEG])
    inp.conditions = { ...inp.conditions, evaStartUtc: '2026-11-14T10:51:18Z', mslSol: 5074 }
    const c = (buildMission(inp) as Doc).conditions
    expect(c.eva_start_utc).toBe('2026-11-14T10:51:18Z')
    expect(c.msl_sol).toBe(5074)
  })

  it('exports the D39 dose series on the EVA clock only with the storm switch on', () => {
    const inp = input([LEG])
    const legs = [LEG]
    const cellHome = (c: number) => homeAt(...cellLonLat(c))
    const track = buildTrack(legs.map((l) => legProfile(l, cellHome)), [WP.stopMin])
    const stormy = { ...inp, margin: missionMargin(track, { tDarkMin: 500, rad, storm: true }), conditions: { ...inp.conditions, storm: true, rad } }
    const c = (buildMission(stormy) as Doc).conditions
    const dt = doseTimingFromRad(c.t_star_min, rad)
    expect(c.storm_replay).toBe(true)
    expect(c.dose.d_allow_mgy).toBe(dt.dAllowMgy)
    expect(c.dose.series.length).toBe(dt.evaMin.length)
    expect(c.dose.series[0][0]).toBeCloseTo(dt.evaMin[0], 3)
    expect(c.dose.series[0][1]).toBeCloseTo(dt.rateMgyH[0], 6)
    // same mission, switch off: no series
    expect((buildMission({ ...stormy, conditions: { ...stormy.conditions, storm: false } }) as Doc).conditions.dose).toBeNull()
  })
})

describe('finalizeMission', () => {
  it('gives the same plan the same id at any time', async () => {
    const doc = buildMission(input([LEG]))
    const a = await finalizeMission(doc, new Date('2026-11-15T10:00:00.123Z'))
    const b = await finalizeMission(doc, new Date('2026-11-15T11:30:00Z'))
    expect(a.mission_id).toMatch(/^m-[0-9a-f]{12}$/)
    expect(a.mission_id).toBe(b.mission_id)
    expect(a.created_utc).toBe('2026-11-15T10:00:00Z')
  })
})

// J1 (D132, waypoint orchestrator): the tab's mission.json: schema 1.1.0, origin mission_planer, its own
// provenance label (I3's custom-start label added for a moved start); validates against
// contracts/bundle/mission.schema.json (the repo .venv's jsonschema, as browser/compute.test.ts; HL_PYTHON
// overrides the interpreter). Same numbers as the Edit-route estimate: parity.test.ts.
describe('the tab\'s mission.json: schema, origin, provenance label', () => {
  const SCHEMA = resolve(REPO, 'contracts/bundle/mission.schema.json')
  const PY = process.env.HL_PYTHON ?? resolve(REPO, '.venv/bin/python')
  const validate = (doc: unknown) => {
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
    return `${r.stdout}${r.stderr}`.trim()
  }

  it('schema 1.1.0, origin mission_planer, the honesty label; a moved EVA start adds I3\'s custom-start label; validates', async () => {
    const doc = (await finalizeMission(buildMission(input([LEG])), new Date('2026-11-15T16:00:00Z'))) as Doc
    expect(doc.schema_version).toBe('1.1.0')
    expect(doc.origin).toBe('mission_planer')
    expect(doc.origin_label).toBe('Mission Planer: browser estimate on the 5 m grid, not part of the validated scorecard')
    expect(doc.label).toBe(CONFIG.simulatedLabel)
    const custom = (await finalizeMission(buildMission(input([LEG]), { customStart: true }))) as Doc
    expect(custom.origin_label).toBe(`${ORIGIN_LABEL} · ${CUSTOM_START_LABEL}`)
    expect(originLabel(true)).toBe('Mission Planer: browser estimate on the 5 m grid, not part of the validated scorecard · custom start · outside the validated scenario')
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as { required: string[] }
    for (const k of schema.required) expect(doc, k).toHaveProperty(k)
    if (existsSync(PY)) {
      expect(validate(doc)).toBe('OK')
      expect(validate(custom)).toBe('OK')
      expect(validate(await finalizeMission(buildMission(input([null]))))).toBe('OK')
    }
  })

  it('waypoint notes, tags and stop times stay in the tab\'s mission.json: no plan_inputs, no route hash', () => {
    const doc = buildMission(input([LEG])) as Doc
    expect(doc.waypoints[0]).toMatchObject({ note: 'core sample', tags: ['Drill'], stop_min: 5 })
    expect(JSON.stringify(doc)).not.toMatch(/plan_inputs|route=/)
  })
})
