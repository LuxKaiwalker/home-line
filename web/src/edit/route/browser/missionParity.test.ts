// R1 (Plan port): the Mission Planer's numbers, proven unchanged on the one route core. mission/ goes
// in wave 2 (I3), so its tests are re-pointed here onto the core:
//   mission/legsRoute.test.ts   -> worker.test.ts (exact mode = LegRouter after structured cloning)
//   mission/margin|budget|export.test.ts -> margin|budget|export.test.ts here (same bodies, I1a ports;
//                                  mission/parity.test.ts proves the code is line-for-line the same)
//   mission/physio.test.ts      -> edit/route/map/physio.test.ts (WP6 port, same body)
//   mission/parity.test.ts      -> this file: one plan through the runner (worker + core) against the
//                                  numbers the Mission tab's own modules gave (pinned below, computed
//                                  20:30 on port/R1 with mission/{router,physio,budget,margin}.ts on
//                                  the published data, exactly as views/mission.tsx wires them).
// Plan: official pad -> S4 (its stations.json dwell) -> W1 (free point 200 m east of the pad, 10 min)
// -> S1 (20 min) -> home on WS2's pointer field. Storm off and on (D39). Exact mode = the parity mode.
/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CONFIG } from '../../../config'
import { createMockPadService } from '../../../pads/mock'
import { createPlanningStore } from '../../../state/planning'
import { resetRouteResults } from '../../../state/routeResults'
import { LegRouter } from '../map/router'
import { buildBrowserMissionDraft } from './compute'
import type { BrowserRouteData } from './data'
import { ORIGIN_LABEL } from './export'
import { startPlanningRunner, type PlanningRunner } from './runner'
import { freePointNear, HAS_DATA, loadFromFiles } from './testData'
import { createRouteWorkerHandler } from './worker'

/** The Mission Planer's numbers for the plan above (mission/ modules, full precision). */
const MISSION = {
  w1: { lon: 137.405152, lat: -4.777447 },
  legsMin: [21.072111151966155, 9.526387469292342, 72.96564555152334],
  legsO2: [28.447350055154313, 8.596399135219848, 98.01705935498164],
  legsDist: [659.718049406836, 557.2793225961532, 2497.4091720107613],
  home: { tHomeMin: 42.300000000000004, o2HomeL: 46.94 },
  evaMin: 205.86414417278183,
  o2UsedL: 185.3015704501177,
  margin: { false: [155.23684728562708, 'O2', 143.56414417278182], true: [44.25167658206478, 'dose', 163.56414417278182] },
} as const

let runner: PlanningRunner | null = null
afterEach(() => {
  runner?.stop()
  runner = null
  resetRouteResults()
})

describe.skipIf(!HAS_DATA)('Mission Planer numbers on the core (runner, exact mode, real data)', () => {
  let d: BrowserRouteData
  beforeAll(async () => {
    d = await loadFromFiles(CONFIG.defaultScenario)
  }, 60_000)

  for (const storm of [false, true]) {
    it(`legs, budget, four-term margin and mission.json (storm ${storm ? 'on' : 'off'})`, async () => {
      const w1 = freePointNear(d, d.fieldsPad.lon, d.fieldsPad.lat, 200, 0)
      expect(w1).toEqual(MISSION.w1)
      const base: BrowserRouteData = { ...d, router: new LegRouter(d.grid, d.model), legCache: new Map(), components: new Map() }
      const store = createPlanningStore()
      store.setStorm(storm)
      runner = startPlanningRunner(store, createMockPadService(), {
        mode: 'exact',
        loadData: async () => base,
        connect: (on) => {
          const h = createRouteWorkerHandler((m) => setTimeout(() => on(structuredClone(m)), 0))
          return { post: (m) => setTimeout(() => h.handle(structuredClone(m)), 0), terminate: () => undefined }
        },
      })
      store.addStop({ kind: 'station', station: 'S4' })
      store.addStop({ kind: 'point', ...w1, stopMin: 10 })
      store.addStop({ kind: 'station', station: 'S1', stopMin: 20 })
      const r = await runner.settled()
      expect(r.status).toBe('ready')
      // legs (worker, exact A*) = the Mission tab's LegRouter legs, to the last bit
      expect(r.legs.slice(0, 3).map((l) => l.minutes)).toEqual(MISSION.legsMin)
      expect(r.legs.slice(0, 3).map((l) => l.o2L)).toEqual(MISSION.legsO2)
      expect(r.legs.slice(0, 3).map((l) => l.distanceM)).toEqual(MISSION.legsDist)
      expect(r.legs[3]).toMatchObject({ minutes: MISSION.home.tHomeMin, o2L: MISSION.home.o2HomeL })
      // budget and the four-term margin (tightest point, binding term, its minute)
      expect(r.totalMinutes).toBe(MISSION.evaMin)
      expect(r.marginMin).toBe(MISSION.margin[`${storm}`][0])
      const full = runner.lastResult()!
      expect(full.result.detail.budget.evaMin).toBe(MISSION.evaMin)
      expect(full.result.detail.budget.o2UsedL).toBe(MISSION.o2UsedL)
      expect(full.result.tightest).toEqual({ marginMin: MISSION.margin[`${storm}`][0], binding: MISSION.margin[`${storm}`][1], tMin: MISSION.margin[`${storm}`][2] })
      // mission.json from the core: the same numbers, the estimate label, the planned stop minutes
      const doc = buildBrowserMissionDraft(full.result, { data: full.data, now: new Date('2026-11-15T20:30:00Z') }) as Record<string, unknown> & { origin_label: string }
      expect(doc.origin_label).toBe(ORIGIN_LABEL)
      const r2 = (x: number, k: number) => Math.round(x * 10 ** k) / 10 ** k
      const json = JSON.stringify(doc)
      expect(json).toContain(`"eva_min":${r2(MISSION.evaMin, 3)}`)
      expect(json).toContain(`"lowest":{"margin_min":${r2(MISSION.margin[`${storm}`][0] as number, 2)},"binding":"${MISSION.margin[`${storm}`][1]}"`)
      expect(json).toContain(`"storm_replay":${storm}`)
      expect(full.result.dwellMin).toEqual([d.stations.find((s) => s.id === 'S4')!.dwellMin, 10, 20])
    }, 60_000)
  }
})
