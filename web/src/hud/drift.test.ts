// F19 fallback drift and the storm switch (brief WS7 tests: "sigma monotonic between fixes,
// reset at fixes"; "alarms fire at the times predicted").
import { describe, expect, it } from 'vitest'
import { driftPosition, driftSigma, lastFixAt, planFixes } from './drift'
import { Plan } from './plan'
import { computeReadout, type HudContext } from './readout'
import { radiationInput, stormReplay, stormState } from './storm'
import { dummyGrid, loadConfig, readJson } from './testutil'
import type { Rad, RouteFC, TimelineEvent } from './types'

const cfg = loadConfig()
const route = readJson<RouteFC>('route_nom_104.geojson')
const timeline = readJson<TimelineEvent[]>('timeline_nom_104.json')
const tHome = dummyGrid('nom_104/t_home')
const plan = new Plan(route, timeline, tHome)
const fixes = planFixes(plan, cfg)

describe('fallback drift (D12, config/hud.yaml)', () => {
  it('fixes: rover at the start, one per station arrival', () => {
    expect(fixes.map((f) => [f.t_eva_min, f.source, f.sigma_m])).toEqual([
      [0, 'rover', cfg.fixSigmaM.rover],
      [11.1, 'station', cfg.fixSigmaM.station],
      [61.1, 'station', cfg.fixSigmaM.station],
      [122, 'station', cfg.fixSigmaM.station],
    ])
    expect(lastFixAt(fixes, 30).station).toBe('S1')
  })
  it('sigma = pct of distance since the fix, floor, fix sigma at the fix', () => {
    const pct = cfg.fallbackDrift.pctOfDistance / 100
    expect(driftSigma(cfg, 2, 0)).toBe(2)
    expect(driftSigma(cfg, 2, 10)).toBe(cfg.fallbackDrift.sigmaFloorM)
    expect(driftSigma(cfg, 2, 1000)).toBeCloseTo(1000 * pct, 9)
    // 600 m walked to S1 at 2% -> 12 m just before the S1 fix
    expect(driftPosition(plan, cfg, fixes, 11.09).sigma_m).toBeCloseTo(600 * pct * (11.09 / 11.1), 1)
  })
  it('sigma is monotonic between fixes and resets at each fix', () => {
    let prev = -1
    let prevFix = fixes[0].t_eva_min
    for (let t = 0; t <= plan.tEnd; t += 0.1) {
      const p = driftPosition(plan, cfg, fixes, t)
      const fix = lastFixAt(fixes, t)
      if (fix.t_eva_min !== prevFix) {
        expect(p.sigma_m).toBe(fix.sigma_m) // reset exactly at the fix
        prevFix = fix.t_eva_min
      } else {
        expect(p.sigma_m).toBeGreaterThanOrEqual(prev - 1e-12)
      }
      expect(p.last_fix?.t_eva_min).toBe(fix.t_eva_min)
      prev = p.sigma_m
    }
  })
  it('during a station dwell sigma stays at the station fix', () => {
    const p = driftPosition(plan, cfg, fixes, 30) // S1 dwell
    expect(p.sigma_m).toBe(cfg.fixSigmaM.station)
    expect(p.source).toBe('fix')
  })
  it('the drift readout uses the worst case within sigma (>= point value)', () => {
    const fields = {
      tHome,
      worst: new Map(cfg.worstCaseRadiiM.map((r) => [r, { tHome: dummyGrid(`nom_104/t_home_worst_${r}`) }])),
    }
    const ctx: HudContext = { cfg, fields, plan, budgetMin: cfg.walkbackBudgetsMin[0], pad: plan.start }
    for (const t of [5, 50, 100, 170]) {
      const d = driftPosition(plan, cfg, fixes, t)
      const point = computeReadout({ ...d, sigma_m: 0 }, ctx)
      const r = computeReadout(d, ctx)
      if (r.tHomeMin !== null) expect(r.tHomeMin).toBeGreaterThanOrEqual(point.tHomeMin!)
    }
  })
})

describe('storm switch (F18)', () => {
  const rad = readJson<Rad>('conditions/rad.json')
  const delay = (Date.parse(rad.storm_2024!.tripwire_utc!) - Date.parse(rad.storm_2024!.onset_utc!)) / 60000
  it('places the onset on the EVA clock; the tripwire fires after the real delay', () => {
    const rep = stormReplay(rad, 30)!
    expect(rep.tripDelayMin).toBe(delay)
    expect(stormState(rep, 30 + delay - 0.01).fired).toBe(false)
    const s = stormState(rep, 30 + delay + 10)
    expect(s.fired).toBe(true)
    expect(s.doseLeftMin).toBeCloseTo(rad.leash.tau_min_at_peak! - 10, 9)
    expect(stormState(null, 100).on).toBe(false)
    expect(stormReplay({ ...rad, storm_2024: undefined }, 0)).toBeNull()
  })
  it('alarm 2 fires exactly when T_home >= dose budget left (after the tripwire)', () => {
    const ctx: HudContext = { cfg, fields: { tHome }, plan, budgetMin: cfg.walkbackBudgetsMin[0], pad: plan.start }
    const rep = stormReplay(rad, 0)!
    const tau = rad.leash.tau_min_at_peak!
    // at S1 (T_home 11.1) during its dwell: fires when tau - (t - tFire) <= 11.1, if margin >= 0
    const tFire = delay
    const tPred = tFire + tau - 11.1
    const at = (t: number) => computeReadout({ ...{ lon: plan.stateAt(30).lon, lat: plan.stateAt(30).lat }, sigma_m: 0, source: 'playback', t_eva_min: t, last_fix: null }, { ...ctx, radiation: radiationInput(stormState(rep, t)) })
    expect(at(tPred - 0.05).alarm?.rule).not.toBe(2)
    expect(at(tPred + 0.05).alarm?.rule).toBe(2)
    expect(at(tPred + 0.05).alarm?.text).toBe('RADIATION: HEAD HOME')
  })
})
