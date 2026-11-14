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
import { dragFinding, drawnPartner, partnerLabel } from './partner'
import { padInUse, padMarker, padProposal } from '../map/pad'
import { allScienceZero } from '../views/trade'
import { katAreas, v2Classes } from '../views/validation'
import { createLoader, type TextFetcher } from './loader'
import { schemaFor } from './contracts'
import { loadPadsIndex, padFiles, padKey, PADS_INDEX, parsePadSummary } from './pads'
import type { Localisation, ManifestEntry } from './types'

// HOMELINE_REAL_DATA points the checks at another real tree (e.g. a scratch `make web` output).
const REAL = process.env.HOMELINE_REAL_DATA ? resolve(process.env.HOMELINE_REAL_DATA) : resolve(__dirname, '../../public/data')
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

  it('headline nom_104: 12.4 % reachable, optimistic end 17.5 %', async () => {
    const h = (await L.scenarios()).scenarios.find((s) => s.id === 'nom_104')!.headline
    expect(h.reachable_pct).toBe(12.4)
    expect(h.range_pct[1]).toBe(17.5)
  })

  it('route nom_104: pad -> S4 -> S2 -> pad, end = manifest route total', async () => {
    const r = routeSummary(await L.route('nom_104'))!
    expect(r.stops).toEqual(['pad', 'S4', 'S2', 'pad'])
    const m = await L.manifest()
    expect(r.endMin).toBe((m['route.nom_104.total_min'] as ManifestEntry).value)
    expect(r.endMin).toBeGreaterThan(0) // value pinned by the manifest, not hard-coded (it moved 209.74 -> 210.10 with the 15:35 S answers)
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

// Session-3 tree (C's make web after WS2 session 4 + WS6 V1): con_*, D20 partner, pad proposal, V1, KATs.
const S3 = has && existsSync(resolve(REAL, 'validation/v1.json'))

describe.skipIf(!S3)('real data tree, session-3 publish (D19, D20, V1, F8)', () => {
  const L = createLoader(fsFetcher, 'real')
  const entry = async (k: string) => (await L.manifest())[k] as ManifestEntry | undefined

  it('headline range complete: 12.4 % [4.6, 17.5] at 30 min, both ends manifest-backed', async () => {
    const h = (await L.scenarios()).scenarios.find((s) => s.id === 'nom_104')!.headline
    expect([h.budget_min, h.reachable_pct, ...h.range_pct]).toEqual([30, 12.4, 4.6, 17.5])
    expect((await entry('reachable_pct_range.nom_104.30.low'))?.value).toBe(4.6)
  })

  it('D20: partner line is cart only, labelled from the file; drag finding 398 N vs 351 N, max 157 kg (manifest)', async () => {
    const idx = await L.scenarios()
    const nom = idx.scenarios.find((s) => s.id === idx.default)!
    const p = await L.partner(nom)
    expect(partnerLabel(p)).toBe('Partner line (cart haul, 60 min)')
    expect(p.features.every((f) => f.properties?.case !== 'drag')).toBe(true)
    expect(drawnPartner(p).features.length).toBe(p.features.length)
    const d = dragFinding(p)!
    expect(d.feasible).toBe(false)
    expect(d.force_N).toBeGreaterThan(d.traction_limit_N!)
    for (const f of ['force_N', 'traction_limit_N', 'max_mass_kg'] as const) {
      const e = (await entry(`haul.drag.flat.${f}`))!
      expect(e.value).toBe(d[f])
      expect(e.file).toBe(nom.files.partner)
    }
    expect(Math.round(d.force_N!)).toBe(398)
    expect(Math.round(d.traction_limit_N!)).toBe(351)
    expect(Math.round(d.max_mass_kg!)).toBe(158) // 157.5 kg
  })

  it('cards carry the D20 drag note', async () => {
    for (const s of await L.stations()) expect((await L.card(s)).drag_note).toMatch(/cannot drag a suited crewmate/)
  })

  it('trade: science value 0 in every cell; S4 conservative walk home > 60 min, S1/S2 no access cell (con_104)', async () => {
    const t = await L.trade()
    expect(allScienceZero(t)).toBe(true)
    const st = await L.stations()
    const s4 = st.find((s) => s.id === 'S4')!
    expect(s4.t_home_min.con_104!).toBeGreaterThan(Math.max(...t.rows))
    for (const id of ['S1', 'S2']) expect(accessFor(st.find((s) => s.id === id)!, 'con_104').state).toBe('none')
  })

  it('F8 (C 14:58): pad.json, when published, is the pad in use (pad_default); siting heatmap is a proposal', async () => {
    const pf = await L.optional(() => L.pad())
    const m = padMarker(pf, CONFIG.padDefault)
    expect([m.lon, m.lat]).toEqual([CONFIG.padDefault.lon, CONFIG.padDefault.lat])
    expect(padProposal(pf)?.lon ?? null).not.toBe(m.lon)
    const sp = await L.sitingPng()
    expect(existsSync(resolve(REAL, sp.image))).toBe(true)
  })

  it('D7: V2 has near/mid/far; far is reported (not validated) with manifest keys', async () => {
    const v = await L.v2()
    const rows = v2Classes(v.summary)
    expect(rows.map((r) => r.cls)).toEqual(['near', 'mid', 'far'])
    for (const r of rows) expect((await entry(`${r.keyPrefix}.median_abs_deg`))?.value).toBe(r.median_abs_deg)
  })

  it('route legs: every displayed leg number has its route.nom_104.leg.{i}.* key', async () => {
    const r = routeSummary(await L.route('nom_104'))!
    for (const l of r.legs)
      for (const f of ['t_min', 'length_m', 'o2_L'] as const) expect((await entry(`route.nom_104.leg.${l.leg}.${f}`))?.value, `leg ${l.leg} ${f}`).toBe(l[f])
    for (const l of r.legs.filter((x) => x.to !== 'pad')) expect((await entry(`route.nom_104.leg.${l.leg}.to_access_dist_m`))?.value).toBe(l.to_access_dist_m)
  })

  it('station values keyed stations.{S}.value on stations.json (WS1 fix)', async () => {
    for (const s of await L.stations()) {
      const e = await entry(`stations.${s.id}.value`)
      expect(e?.value).toBe(s.value)
      expect(e?.file).toBe('stations.json')
    }
  })

  it('V1: n 290, bias +1.31, RMSE 5.45, r 0.50; conservative no-go 14.55 deg', async () => {
    const v = await L.v1()
    expect(v.n).toBe(290)
    expect(v.bias_deg!.toFixed(2)).toBe('1.31')
    expect(v.rmse_deg!.toFixed(2)).toBe('5.45')
    expect(v.r!.toFixed(2)).toBe('0.50')
    expect(((v.conservative_nogo as { nogo_deg: number }).nogo_deg).toFixed(2)).toBe('14.55')
    expect(existsSync(resolve(REAL, 'validation/v1.svg'))).toBe(true)
  })

  it('KAT list loads; area counts add up to the summary total', async () => {
    const k = await L.json<{ summary: { total: number }; tests: { id: string; area: string; features: string[]; outcome: string; reason: string | null }[] }>('validation/kats.json')
    expect(katAreas(k.tests).reduce((a, b) => a + b.total, 0)).toBe(k.summary.total)
  })
})

// Session-5 tree (C 15:31: pad.json released after WS2 session 5, contract pad v1.1.2).
const S5 = has && existsSync(resolve(REAL, 'pad.json'))

describe.skipIf(!S5)('real data tree, pad.json v1.1.2 (F8, C 15:31)', () => {
  const L = createLoader(fsFetcher, 'real')
  const entry = async (k: string) => (await L.manifest())[k] as ManifestEntry | undefined

  it('pad in use = pad_default and fails the F8 rule; every shown number has its manifest key', async () => {
    const pf = await L.pad()
    const u = padInUse(pf)!
    expect([pf.pad.lon, pf.pad.lat]).toEqual([CONFIG.padDefault.lon, CONFIG.padDefault.lat])
    expect([u.score, u.rulePassed]).toEqual([0, false])
    expect(u.maxSlopeDeg!).toBeGreaterThan(5)
    for (const [k, v] of [
      ['pad.score', u.score],
      ['pad.checks.max_slope_deg', u.maxSlopeDeg],
      ['pad.checks.assessed_pct_30min', u.assessedPct],
    ] as const)
      expect((await entry(k))?.value).toBe(v)
  })

  it('proposal read from proposal.pad.*: not adopted, tie and alternatives keyed', async () => {
    const pf = await L.pad()
    expect(pf.proposal?.adopted).toBe(false)
    const p = padProposal(pf)!
    expect(p).not.toBeNull()
    expect((await entry('pad.proposal.lon'))?.value).toBe(p.lon)
    expect((await entry('pad.proposal.score'))?.value).toBe(p.score)
    expect((await entry('pad.proposal.checks.max_slope_deg'))?.value).toBe(p.maxSlopeDeg)
    expect((await entry('pad.proposal.tie.n_blocks_at_top_score'))?.value).toBe(p.tie!.nAtTop)
    expect((await entry('pad.proposal.tie.n_candidate_blocks'))?.value).toBe(p.tie!.nCandidates)
    for (const a of p.ranked) for (const f of ['lon', 'lat', 'score'] as const) expect((await entry(`pad.proposal.alternatives.${a.rank}.${f}`))?.value).toBe(a[f])
    if (p.assessedPct === null) expect(p.checksNote).toBeTruthy()
  })
})

// D21 parking options (C 16:17 layout): on once WS2 publishes scenarios/pads/ and C's contract rows cover it.
const hasPads = has && existsSync(resolve(REAL, PADS_INDEX)) && !!schemaFor(PADS_INDEX)
describe.skipIf(!hasPads)('real tree: D21 rover parking options', () => {
  const L = createLoader(fsFetcher, 'real')

  it('index: one official row = pad.json; every option loads its files; numbers keyed pads.{id}.*', async () => {
    const r = await loadPadsIndex(L)
    expect(r.state).toBe('ok')
    if (r.state !== 'ok') return
    const pf = await L.pad()
    expect([r.index.official.lon, r.index.official.lat]).toEqual([pf.pad.lon, pf.pad.lat])
    expect(Math.max(...r.index.options.map((o) => o.score ?? -1))).toBe(r.index.official.score)
    const m = await L.manifest()
    const idx = await L.scenarios()
    const nominal = idx.scenarios.find((s) => s.id === idx.default)!
    for (const o of r.index.options) {
      expect((m[padKey(o.id, 'score')] as ManifestEntry | undefined)?.value).toBe(o.score)
      if (o.official) continue
      const f = padFiles(o.id, nominal)
      const s = parsePadSummary(await L.json(f.summary), o.id)
      expect(s.score).toBe(o.score)
      expect(s.headlines.map((h) => h.budget)).toEqual(expect.arrayContaining(CONFIG.bandBudgetsMin))
      await L.json(f.bands)
      await L.json(f.edges)
      await L.json(f.partner)
      await L.json(f.route)
      await L.json(f.timeline)
    }
  }, 60_000)
})
