// PORT P3 known answers for the context bar / drawer summary logic (ui/strip/model.ts).
import { h } from 'preact'
import { describe, expect, it } from 'vitest'
import type { PadSummaryView } from '../../data/pads'
import { MOCK_PADS } from '../../pads/mock'
import type { StripProps } from '../../views/planStrip'
import { activePadId, officialMargin, padName, reachItems, shownFor, stripPropsOf } from './model'
import { MOCK_ROUTE_RESULTS, type RouteResults } from './routeResults'

const summary = (id: string): PadSummaryView => ({
  id,
  rank: 2,
  score: 38,
  lon: null,
  lat: null,
  elevM: null,
  headlines: [
    { budget: 30, reachablePct: 21.5, range: null, inDataPct: null, inData: false },
    { budget: 60, reachablePct: 22.7, range: null, inDataPct: 80.3, inData: true },
  ],
  route: null,
  excluded: null,
})

const strip = (o: Partial<StripProps> = {}): StripProps => ({
  h30: { v: 23, k: 'reachable_pct.nom_104.30', file: 'scenarios/index.json', budget: 30 },
  h60: { budget: 60, reachablePct: 31.5, range: null, inDataPct: 75.8, inData: true },
  sid: 'nom_104',
  pad: null,
  route: {
    timeline: [
      { t_min: 0, event: 'depart', margin_min: 90 },
      { t_min: 40, event: 'arrive', station: 'S4', margin_min: 41.21, margin_binding: 'o2' },
      { t_min: 50, event: 'turn_back', margin_min: 5 },
    ] as never,
    file: 'timeline_nom_104.json',
    key: 'timeline.nom_104',
  },
  scenarioText: 'nominal · 104 kg',
  budget: 30,
  ...o,
})

describe('stripPropsOf', () => {
  it('reads the console values from the fallback <HeadlineStrip …/> element', () => {
    const p = strip()
    const Fake = (_: StripProps) => null
    expect(stripPropsOf(h(Fake, p))).toMatchObject({ sid: 'nom_104', budget: 30, scenarioText: 'nominal · 104 kg' })
  })
  it('null for anything else', () => {
    expect(stripPropsOf(null)).toBeNull()
    expect(stripPropsOf('text')).toBeNull()
    expect(stripPropsOf(h('span', { class: 'x' }))).toBeNull()
  })
})

describe('active pad', () => {
  it('console parking option wins, official planning pad = null', () => {
    expect(activePadId(strip(), 'official')).toBeNull()
    expect(activePadId(strip(), 'rank3')).toBe('rank3')
    expect(activePadId(strip({ pad: { id: 'rank2', summary: null, file: 'f' } }), 'official')).toBe('rank2')
  })
  it('names: index label, else derived from the id', () => {
    expect(padName('rank2', MOCK_PADS)).toBe(MOCK_PADS.find((p) => p.id === 'rank2')!.label)
    expect(padName('rank4', [])).toBe('P4')
    expect(padName('pad_default', [])).toBe('pad_default')
  })
})

describe('officialMargin', () => {
  it('tightest non-turn-back margin with its manifest key (same as the old strip)', () => {
    expect(officialMargin(strip())).toMatchObject({ v: 41.21, k: 'timeline.nom_104.1.margin_min', file: 'timeline_nom_104.json' })
  })
  it('null without a route', () => {
    expect(officialMargin(strip({ route: null }))).toBeNull()
    expect(officialMargin(null)).toBeNull()
  })
})

describe('shownFor', () => {
  const ready: RouteResults = { ...MOCK_ROUTE_RESULTS, padId: 'official', firstInfeasibleLeg: null, marginMin: 41.4, fastRoute: true }
  it('no stops = the official plan', () => {
    expect(shownFor(0, ready, 'official')).toEqual({ kind: 'official' })
  })
  it('your route: stops, rounded margin, fast label', () => {
    expect(shownFor(4, ready, 'official')).toEqual({ kind: 'mine', stops: 4, marginMin: 41, computing: false, fast: true, unreachableStop: null })
  })
  it('results of another pad or idle count as computing (no stale margin)', () => {
    expect(shownFor(2, { ...ready, padId: 'rank2' }, 'official')).toMatchObject({ marginMin: null, computing: true, fast: false })
    expect(shownFor(2, { ...ready, status: 'idle' }, 'official')).toMatchObject({ marginMin: null, computing: true })
  })
  it('first infeasible leg names the unreachable stop', () => {
    expect(shownFor(3, MOCK_ROUTE_RESULTS, 'official')).toMatchObject({ unreachableStop: 3 })
  })
})

describe('reachItems (value snapshot: same keys as the console in that view state)', () => {
  it('official: the 30-min headline and the 60-min headline, keyed reachable_pct.<sid>.<budget>', () => {
    expect(reachItems(strip())).toEqual([
      { budget: 30, v: 23, k: 'reachable_pct.nom_104.30', file: 'scenarios/index.json' },
      { budget: 60, v: 31.5, k: 'reachable_pct.nom_104.60', file: 'scenarios/index.json' },
    ])
  })
  it('parking option: only its headline at the walkback budget (as PadHeadline shows it)', () => {
    const f = 'scenarios/pads/rank2/summary.json'
    expect(reachItems(strip({ h30: null, h60: null, budget: 60, pad: { id: 'rank2', summary: summary('rank2'), file: f } }))).toEqual([{ budget: 60, v: 22.7, k: 'pads.rank2.headline.60.reachable_pct', file: f }])
    expect(reachItems(strip({ h30: null, h60: null, budget: 30, pad: { id: 'rank2', summary: summary('rank2'), file: f } }))).toEqual([{ budget: 30, v: 21.5, k: 'pads.rank2.headline.30.reachable_pct', file: f }])
  })
  it('parking option still loading: nothing (never a Loading… text or an unknown number)', () => {
    expect(reachItems(strip({ h30: null, h60: null, pad: { id: 'rank2', summary: null, file: 'f' } }))).toEqual([])
  })
  it('null values are left out (no num-unknown key)', () => {
    expect(reachItems(strip({ h30: { v: null, k: 'k', file: 'f', budget: 30 }, h60: null }))).toEqual([])
  })
  it('planning-store pad from the pad service when the console has no parking option', () => {
    const env = { summary: summary('rank3'), info: { ...MOCK_PADS[0], files: { ...MOCK_PADS[0].files, summary: 'scenarios/pads/rank3/summary.json' } } }
    expect(reachItems(strip(), env)).toEqual([{ budget: 30, v: 21.5, k: 'pads.rank3.headline.30.reachable_pct', file: 'scenarios/pads/rank3/summary.json' }])
  })
  it('no console values yet: nothing', () => {
    expect(reachItems(null)).toEqual([])
  })
})
