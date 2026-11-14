// Real data tree (web/public/data, committed by C's make web): every file the app reads loads
// through the loader (contract check, no dummy flag), and the G1 numbers the console shows are the
// ones WS2/WS4 reported. Skipped when the real tree is not there.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { basemapSources } from '../map/basemap'
import { isochroneMinutes, uniformStep } from '../map/slider'
import { leashSteps } from '../views/leash'
import { routeSummary } from '../views/route'
import { f22Rows, f22Verdict } from '../views/f22'
import { accessFor } from './access'
import { createLoader, type TextFetcher } from './loader'
import type { Localisation, ManifestEntry } from './types'

const REAL = resolve(__dirname, '../../public/data')
const fsFetcher: TextFetcher = async (path) => {
  try {
    return await readFile(resolve(REAL, path), 'utf8')
  } catch {
    return null
  }
}
const has = existsSync(resolve(REAL, 'scenarios/index.json'))

describe.skipIf(!has)('real data tree (web/public/data)', () => {
  const L = createLoader(fsFetcher, 'real')

  it('every scenario file loads; isochrone steps come from the data (2-min fallback)', async () => {
    const idx = await L.scenarios()
    expect(idx.dummy).toBe(false)
    for (const s of idx.scenarios) {
      const mins = isochroneMinutes(await L.isochrones(s))
      expect(mins.length).toBeGreaterThan(0)
      await L.bands(s)
      await L.edges(s)
      await L.partner(s)
    }
    const nom = idx.scenarios.find((s) => s.id === 'nom_104')!
    const step = uniformStep(isochroneMinutes(await L.isochrones(nom)))
    const m = await L.manifest()
    expect(step).toBe((m['isochrone_step_min.nom_104'] as ManifestEntry).value)
  }, 60_000)

  it('headline nom_104: 12.4 % reachable, range [pending V1, 17.5 %]', async () => {
    const h = (await L.scenarios()).scenarios.find((s) => s.id === 'nom_104')!.headline
    expect(h.reachable_pct).toBe(12.4)
    expect(h.range_pct[1]).toBe(17.5)
    // con end: null until WS6 V1 lands (the console then says "pending V1"); a number once it does.
    expect(h.range_pct[0] === null || typeof h.range_pct[0] === 'number').toBe(true)
  })

  it('route nom_104: pad -> S4 -> S2 -> pad, end = manifest route total (209.74 min)', async () => {
    const r = routeSummary(await L.route('nom_104'))!
    expect(r.stops).toEqual(['pad', 'S4', 'S2', 'pad'])
    const m = await L.manifest()
    expect(r.endMin).toBe((m['route.nom_104.total_min'] as ManifestEntry).value)
    expect(r.endMin).toBeCloseTo(209.7, 1)
    await L.timeline('nom_104')
  })

  it('stations and cards: S1 has no access cell (reason from the data); S2/S4 access within the radius', async () => {
    const st = await L.stations()
    for (const s of st) {
      const card = await L.card(s)
      const a = accessFor(s, 'nom_104', card)
      if (s.id === 'S1') {
        expect(a.state).toBe('none')
        expect(a.reason).toMatch(/within 50 m/)
        expect(card.margin_binding).toBeNull()
      } else {
        expect(a.state).toBe('access')
        expect(a.dist_m!).toBeLessThanOrEqual(CONFIG.accessRadiusM)
      }
    }
  })

  it('S2 card shows no landmark, with WS3 note', async () => {
    const s2 = (await L.stations()).find((s) => s.id === 'S2')!
    const c = await L.card(s2)
    expect(c.landmarks).toEqual([])
    expect(c.landmarks_note).toBeTruthy()
  })

  it('D9: every config slider step has a rad.json leash.table row', async () => {
    const rad = await L.rad()
    const steps = leashSteps(CONFIG.dAllowRangeMgy, CONFIG.dAllowStepMgy, rad.leash.table)
    expect(steps.every((s) => s.row !== null)).toBe(true)
    expect(steps.find((s) => s.d === rad.leash.D_allow_mGy)!.row!.tau_min_at_peak).toBe(rad.leash.tau_min_at_peak)
  })

  it('basemap tilejson and cell states load; cell-state PNG named by the json exists', async () => {
    const tj = await L.tilejson()
    expect(basemapSources(tj, (p) => p).length).toBeGreaterThan(0)
    const cs = await L.cellstate()
    expect(existsSync(resolve(REAL, cs.image))).toBe(true)
  })

  it('F22: no station frame passes the gate (C 11:58); VO drift loads', async () => {
    const st = await L.stations()
    const frames = []
    const locs: Record<string, Localisation | null> = {}
    for (const s of st) {
      const id = (await L.card(s)).navcam.image_id
      frames.push({ station: s.id, image_id: id })
      if (id) locs[id] = await L.optional(() => L.localisation(id))
    }
    const v = f22Verdict(f22Rows(frames, locs, CONFIG.skylineFixGate.toleranceM))
    expect(v.kind).toBe('none-pass')
    expect((await L.voDrift()).length).toBeGreaterThan(0)
    expect((await L.fixes()).some((f) => f.type === 'station')).toBe(true)
  })
})
