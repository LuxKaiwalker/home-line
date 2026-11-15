// J1 (D132, waypoint orchestrator): the Mission Planer tab keeps its own copies of the planner modules,
// because edit/route/ is live-only and must stay out of the static build (edit/route/map/map.test.tsx,
// live/route/route.test.tsx), while the tab ships in it. Those copies must give the same numbers as the
// Edit-route estimate's ports (I1a/WP6: "numbers unchanged, import paths only"):
//   - the code is the same, line for line, once comments and import lines are set aside;
//   - the same inputs give the same outputs (margin profile, budget, mission.json except origin_label);
//   - the EVA start constants are I3's (#177, edit/route/browser/start.ts).
// Read-only: this test imports edit/route/ (tests are not in the build); it never edits it.
// Scope (waypoint orchestrator, 17:0x): the byte copies only: margin, budget, router, physio, export (and
// marstime, which has no copy: edit/route/browser/start.ts imports mission/marstime.ts). NOT compute.ts:
// the tab has no copy of it, and I1c (#182) changes it and its leg rows on its own.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import * as sharedBudget from '../edit/route/browser/budget'
import * as sharedExport from '../edit/route/browser/export'
import * as sharedMargin from '../edit/route/browser/margin'
import * as sharedStart from '../edit/route/browser/start'
import { lonLatToXY, parseEqc, xyToLonLat } from '../fp3d/geo'
import * as budget from './budget'
import * as exp from './export'
import * as margin from './margin'
import type { LonLat, Waypoint } from './plan'
import type { Leg } from './router'
import { DEFAULT_START_MS, isDefaultStart } from './StartTime'

const SRC = resolve(__dirname, '..')
/** The code without comment lines, import lines and the one self-naming error message. */
const code = (rel: string): string[] =>
  readFileSync(resolve(SRC, rel), 'utf8')
    .split('\n')
    .map((l) => l.replace(/; update (mission|edit\/route\/browser)\/margin\.ts`/, '`'))
    .filter((l) => !/^\s*\/\//.test(l) && !/^import /.test(l) && l.trim() !== '')

describe('the tab\'s planner modules are the Edit-route estimate\'s code', () => {
  it.each([
    ['mission/margin.ts', 'edit/route/browser/margin.ts'],
    ['mission/budget.ts', 'edit/route/browser/budget.ts'],
    ['mission/router.ts', 'edit/route/map/router.ts'],
    ['mission/physio.ts', 'edit/route/map/physio.ts'],
  ])('%s = %s (comments and import paths aside)', (a, b) => {
    expect(code(a)).toEqual(code(b))
  })

  it('mission/export.ts builds the same document as edit/route/browser/export.ts except origin_label', () => {
    // the shared port defines Waypoint/LonLat itself, allows pad kind 'picker' and has the estimate label
    const strip = (rel: string) =>
      code(rel).filter((l) => !/ORIGIN_LABEL|CUSTOM_START_LABEL|originLabel|^export type LonLat|^export interface Waypoint/.test(l)).join('\n')
    const body = (s: string) => s.slice(s.indexOf('export const MISSION_SCHEMA_VERSION'))
    const norm = (s: string) => s.replace(/(export function buildMission\(inp: MissionExportInput)(, o: \{ customStart\?: boolean \} = \{\})?\)/, '$1)').replace(" 'picker' |", '')
    const shared = body(strip('edit/route/browser/export.ts'))
    expect(norm(body(strip('mission/export.ts')))).toBe(norm(shared.slice(shared.indexOf('export const MISSION_SCHEMA_VERSION'))).replace(/\n {2}id: number[\s\S]*?\n\}\n/, '\n'))
  })
})

// The same plan through both: a 10 m leg east of the pad and back (export.test.ts's fixture).
const eqc = parseEqc(CONFIG.analysisProj)
const PAD: LonLat = [137.39, -4.8]
const [PX, PY] = lonLatToXY(eqc, PAD[0], PAD[1])
const W = 3
const cellLonLat = (c: number): LonLat => xyToLonLat(eqc, PX + (c % W) * 5, PY - Math.floor(c / W) * 5)
const xOf = (lon: number, lat: number) => lonLatToXY(eqc, lon, lat)[0] - PX
const homeAt = (lon: number, lat: number) => ({ tHomeMin: (xOf(lon, lat) / 5) * 0.1, o2HomeL: xOf(lon, lat) * 0.01 })
const LEG: Leg = { cells: [0, 1, 2], timeS: 12, o2L: 0.2, distM: 10, tauS: [0, 6, 12], o2CumL: [0, 0.1, 0.2] }
const [WLON, WLAT] = cellLonLat(2)
const WP: Waypoint = { id: 7, lon: WLON, lat: WLAT, cell: 2, note: 'core sample', tags: ['Drill'], stopMin: 5 }
const rad = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/conditions/rad.json'), 'utf8'))

describe('the same plan gives the same numbers in the tab and in the Edit-route estimate', () => {
  for (const storm of [false, true]) {
    it(`budget, track, margin profile and mission.json (storm ${storm ? 'on' : 'off'})`, () => {
      const home = homeAt(WLON, WLAT)
      const cellHome = (c: number) => homeAt(...cellLonLat(c))
      const b1 = budget.missionBudget([{ timeMin: 0.2, o2L: 0.2 }], home, [5])
      expect(b1).toEqual(sharedBudget.missionBudget([{ timeMin: 0.2, o2L: 0.2 }], home, [5]))
      expect(budget.BUDGET_CONSTANTS).toEqual(sharedBudget.BUDGET_CONSTANTS)
      const t1 = margin.buildTrack([margin.legProfile(LEG, cellHome)], [5])
      const t2 = sharedMargin.buildTrack([sharedMargin.legProfile(LEG, cellHome)], [5])
      expect(t1).toEqual(t2)
      const cond = { tDarkMin: 500, rad, storm }
      const m1 = margin.missionMargin(t1, cond)
      expect(m1).toEqual(sharedMargin.missionMargin(t2, cond))
      const inp = {
        proj: CONFIG.analysisProj,
        pad: { kind: 'official' as const, id: 'rank1', lon: PAD[0], lat: PAD[1], elevM: -3700, source: 'test' },
        scenario: { id: 'nom_104', variant: 'nominal', suit_kg: 104 },
        planner: { gridResM: 5, elevationResM: 8, files: {} },
        constants: { ...budget.BUDGET_CONSTANTS, marginAmberMin: CONFIG.marginAmberMin },
        conditions: { evaStartLmst: '09:00:00', tDarkMin: 500, storm, rad, evaStartUtc: '2026-11-14T10:51:18Z', mslSol: 5074 },
        wps: [WP],
        legs: [LEG],
        homePath: [cellLonLat(2), cellLonLat(1), cellLonLat(0)],
        homeReachesPad: true,
        budget: b1,
        margin: m1,
        cellLonLat,
        elevAt: (lon: number, lat: number) => -3700 + xOf(lon, lat) / 10,
        homeAt,
        label: CONFIG.simulatedLabel,
        dummy: false,
      }
      const tab = exp.buildMission(inp)
      const est = sharedExport.buildMission(inp)
      expect({ ...tab, origin_label: est.origin_label }).toEqual(est)
      expect(Object.keys(tab)).toEqual(Object.keys(est))
      expect(tab.origin_label).toBe(exp.ORIGIN_LABEL)
      expect(exp.MISSION_SCHEMA_VERSION).toBe(sharedExport.MISSION_SCHEMA_VERSION)
    })
  }
})

describe('EVA start: I3\'s behaviour (#177)', () => {
  it('the same default instant, the same "default" test, the same custom-start label', () => {
    expect(DEFAULT_START_MS).toBe(sharedStart.DEFAULT_START_MS)
    expect(exp.CUSTOM_START_LABEL).toBe(sharedStart.CUSTOM_START_LABEL)
    for (const ms of [null, DEFAULT_START_MS, DEFAULT_START_MS + 999, DEFAULT_START_MS - 1000, DEFAULT_START_MS + 5 * 3600_000]) expect(isDefaultStart(ms)).toBe(sharedStart.isDefaultStart(ms))
  })
})
