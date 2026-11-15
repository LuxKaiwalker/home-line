// PORT F12: the storm switch (D39 replay) on real data. The margin is the MIN of O2, daylight, dose
// and EVA duration; storm on adds the dose term. Long route S2,S8,S7,S6,S1,S4 (R1: rank2 155 min off /
// 44 min on). Picker pads get rad.json from the shared conditions data (padRouteData keeps base.rad).
import { existsSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONFIG } from '../../../config'
import type { PadFile } from '../../../data/types'
import type { RouteStop } from '../model'
import { computeBrowserRoute } from './compute'
import type { BrowserRouteData } from './data'
import { toRouteResults } from './runner'
import { J, loadFromFiles, PUB } from './testData'

const st = (...ids: string[]): RouteStop[] => ids.map((station) => ({ station }))
const fresh = (d: BrowserRouteData, storm: boolean): BrowserRouteData => ({ ...d, storm, legCache: new Map(), components: new Map() })
const LONG = ['S2', 'S8', 'S7', 'S6', 'S1', 'S4']
const SHORT = ['S1']

function margins(d: BrowserRouteData, ids: string[]) {
  const pad = d.fieldsPad
  const off = computeBrowserRoute(fresh(d, false), pad, st(...ids))
  const on = computeBrowserRoute(fresh(d, true), pad, st(...ids))
  return { off, on }
}

describe.skipIf(!existsSync(PUB))('F12: storm switch changes the dose term (real data)', () => {
  const pads: Record<string, BrowserRouteData> = {}
  beforeAll(async () => {
    const pf = J<PadFile>('pad.json')
    const idx = J<{ pads: { id: string; lon: number; lat: number }[] }>('scenarios/pads/index.json')
    pads.official = await loadFromFiles(CONFIG.defaultScenario)
    for (const id of ['rank2', 'rank3', 'rank4']) {
      const p = idx.pads.find((x) => x.id === id)!
      pads[id] = await loadFromFiles(CONFIG.defaultScenario, `pads/${id}/`, { ...pf, pad: { ...pf.pad, lon: p.lon, lat: p.lat, id } } as PadFile)
    }
  }, 120_000)

  it('rad.json is present for the official pad and every picker pad', () => {
    for (const id of ['official', 'rank2', 'rank3', 'rank4']) expect(pads[id].rad, id).not.toBeNull()
  })

  it.each(['official', 'rank2', 'rank3'])('%s: storm on adds the dose term to the long route; off has none', (id) => {
    const { off, on } = margins(pads[id], LONG)
    const s = margins(pads[id], SHORT)
    // diagnosis numbers (F12 report)
    console.log(`F12 ${id} long off=${off.tightest?.marginMin.toFixed(1)} (${off.tightest?.binding}) on=${on.tightest?.marginMin.toFixed(1)} (${on.tightest?.binding}) dose=${on.detail.margin?.dose?.lowestDoseMarginMin.toFixed(1)}; short off=${s.off.tightest?.marginMin.toFixed(1)} (${s.off.tightest?.binding}) on=${s.on.tightest?.marginMin.toFixed(1)} (${s.on.tightest?.binding}) dose=${s.on.detail.margin?.dose?.lowestDoseMarginMin.toFixed(1)}`)
    expect(off.detail.margin?.terms).not.toContain('dose')
    expect(on.detail.margin?.terms).toContain('dose')
    expect(on.detail.margin?.dose?.lowestDoseMarginMin).toEqual(expect.any(Number))
    expect(on.tightest!.marginMin).toBeLessThanOrEqual(off.tightest!.marginMin)
  })

  it('toRouteResults carries the binding term and the dose term (official, short route: storm moves the margin)', () => {
    const { off, on } = margins(pads.official, SHORT)
    const o = { seq: 1, padId: 'official', stops: [{ id: 's1', kind: 'station' as const, station: 'S1', note: '', tags: [], stopMin: 0 }], modes: () => undefined }
    const rOff = toRouteResults(off, o)
    const rOn = toRouteResults(on, o)
    expect(rOff).toMatchObject({ binding: off.tightest!.binding, doseMarginMin: null })
    expect(rOn).toMatchObject({ binding: 'dose', doseMarginMin: on.detail.margin!.dose!.lowestDoseMarginMin, marginMin: on.tightest!.marginMin })
    expect(rOn.marginMin!).toBeLessThan(rOff.marginMin!)
  })
})
