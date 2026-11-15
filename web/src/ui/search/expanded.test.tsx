// Search block S1 (interfaces §3, spec rule 5): the expanded "Find" index.
//  - each new group (areas, legs, events, scenarios, report, glossary) is indexed from fixture data and
//    found by realistic queries;
//  - choosing each kind calls the right store function; building, typing and arrowing call none
//    ("nothing changes until a row is chosen");
//  - lazy: nothing is built at import; the idle build waits for the intro to start;
//  - keystroke latency: rank() over ≥ 2,000 items, median of 50 runs < 16 ms;
//  - rows carry no number and have an accessible name; real data reads only files the app already loads.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoader } from '../../data/loader'
import { overlayOn, resetOverlays } from '../../map/overlays/state'
import { mission } from '../../state/mission'
import { resetSelection, selection } from '../../state/selection'
import { ui } from '../../state/ui'
import { t } from '../copy'
import { byRole, installDom, type FakeNode } from '../testing/dom'
import { buildTimelineModel, type TimelineFileRow } from '../timeline/model'
import { buildExpandedIndex, expandedIndexStarted, resetExpandedIndex, scheduleIndexBuild } from './index/lazy'
import { actions, areaItems, eventItems, glossaryItems, legItems, legsFromRoute, reportItems, scenarioItems, type Translate } from './index/sources'
import { Palette, runItem } from './palette'
import { rank, type SearchItem } from './search'

const tr: Translate = (k, v) => t(k, v)
const label = (i: SearchItem) => (i.label ? t(i.label) : i.name)
const top = (items: SearchItem[], q: string, n = 12) => rank(items, q, label, n).map((r) => r.item.id)

// ---- fixtures (shapes of route_{scenario}.geojson, timeline_{scenario}.json, scenarios/index.json)
const ROUTE = {
  features: [
    { properties: { leg: 2, from: 'S7', to: 'S6' } },
    { properties: { leg: 1, from: 'pad', to: 'S7' } },
    { properties: { leg: 3, from: 'S6', to: 'S1' } },
    { properties: { leg: 4, from: 'S1', to: 'pad' } },
    { properties: { station: 'S7' } }, // a station point, not a leg
  ],
}
const TL: TimelineFileRow[] = [
  { t_min: 0, event: 'depart', station: null },
  { t_min: 40, event: 'arrive', station: 'S7' },
  { t_min: 70, event: 'leave', station: 'S7' },
  { t_min: 120, event: 'arrive', station: 'S6' },
  { t_min: 150, event: 'leave', station: 'S6' },
  { t_min: 300, event: 'return', station: null },
  { t_min: 95, event: 'turn_back', station: 'S7' },
  { t_min: 180, event: 'turn_back', station: 'S6' },
]
const MODEL = buildTimelineModel({ scenario: 'nom_104', timeline: TL, tMax: 360, tDarkMin: 330 })
const SCN = [
  { id: 'opt_104', variant: 'optimistic', suit_kg: 104 },
  { id: 'nom_104', variant: 'nominal', suit_kg: 104 },
  { id: 'con_104', variant: 'conservative', suit_kg: 104 },
]
function fixtureIndex(): SearchItem[] {
  return [...areaItems(tr), ...legItems(legsFromRoute(ROUTE), tr), ...eventItems(MODEL, tr), ...scenarioItems(SCN, tr), ...reportItems(tr), ...glossaryItems(tr)]
}

let spies: Record<keyof typeof actions, ReturnType<typeof vi.spyOn>>
const nav = vi.fn()
const env = { navigate: nav }
beforeEach(() => {
  spies = {
    setOverlay: vi.spyOn(actions, 'setOverlay'),
    seekClock: vi.spyOn(actions, 'seekClock'),
    chooseScenario: vi.spyOn(actions, 'chooseScenario'),
    setStorm: vi.spyOn(actions, 'setStorm'),
    scrollTo: vi.spyOn(actions, 'scrollTo'),
  } as never
  nav.mockClear()
  resetSelection()
  resetOverlays()
  mission.conditions.storm.value = false
  mission.clock.t.value = 0
  ui.mode.value = 'plan'
})
afterEach(() => vi.restoreAllMocks())

describe('expanded index: groups from fixture data', () => {
  it('areas: every overlay and highlight layer (ridges, mineral hints, blocked areas) is indexed', () => {
    const a = areaItems(tr)
    expect(a.map((i) => i.id)).toEqual(expect.arrayContaining(['area:ridges', 'area:mineralPatches', 'area:blocked', 'area:contours']))
    for (const i of a) expect(i.group).toBe('areas')
    expect(top(fixtureIndex(), 'ridge')[0]).toBe('area:ridges')
    expect(top(fixtureIndex(), 'blocked area')[0]).toBe('area:blocked')
    expect(top(fixtureIndex(), 'mineral')).toContain('area:mineralPatches')
  })

  it('legs: "leg 3", "S7 S6" and "S7 → S6" find the official route legs', () => {
    const legs = legItems(legsFromRoute(ROUTE), tr)
    expect(legs.map((l) => l.code)).toEqual(['1', '2', '3', '4'])
    expect(legs[0].name).toBe(t('cards.route.titleFromTo', { from: t('cards.pad.title'), to: 'S7' }))
    const all = fixtureIndex()
    expect(top(all, 'leg 3')[0]).toBe('leg:official:3')
    expect(top(all, 'S7 S6')[0]).toBe('leg:official:2')
    expect(top(all, 'S7 → S6')[0]).toBe('leg:official:2')
  })

  it('events: departure, arrivals, turn-backs, return and daylight end; "turn back" finds the turn-backs', () => {
    const ev = eventItems(MODEL, tr)
    expect(ev.map((e) => e.id).sort()).toEqual(['evt:arrive:1', 'evt:arrive:3', 'evt:daylightEnd', 'evt:depart:0', 'evt:return:5', 'evt:turnBack:6', 'evt:turnBack:7'])
    const hits = top(fixtureIndex(), 'turn back')
    expect(hits.slice(0, 2).sort()).toEqual(['evt:turnBack:6', 'evt:turnBack:7'])
    expect(top(fixtureIndex(), 'turn back S6')[0]).toBe('evt:turnBack:7')
    expect(top(fixtureIndex(), 'arrival S7')[0]).toBe('evt:arrive:1')
  })

  it('scenarios: every scenario of the index plus the storm replay; "storm scenario" and "nominal"', () => {
    const all = fixtureIndex()
    expect(top(all, 'storm scenario')[0]).toBe('scn:storm')
    expect(top(all, 'nominal')[0]).toBe('scn:nom_104')
    expect(top(all, 'conservative scenario')[0]).toBe('scn:con_104')
  })

  it('report and evidence sections; glossary terms with their definition', () => {
    const all = fixtureIndex()
    expect(top(all, 'run record')[0]).toBe('report:runRecord')
    expect(top(all, 'licences')[0]).toBe('evidence:licences')
    const g = top(all, 'glossary term', 50)
    expect(g.length).toBeGreaterThan(5)
    expect(g.every((id) => id.startsWith('glossary:'))).toBe(true)
    const margin = glossaryItems(tr).find((i) => i.id === 'glossary:margin')!
    expect(margin.hint).toBe('glossary.marginHint')
    // a definition with a {placeholder} would need a number: no hint
    expect(glossaryItems(tr).find((i) => i.id === 'glossary:homeline')!.hint).toBeUndefined()
  })

  it('rows carry names, codes and kinds only: no measured number in a name, hint or keyword', () => {
    for (const i of fixtureIndex()) {
      const shown = [label(i), i.hint ? t(i.hint) : '', i.keywords ?? '']
      // station codes (S7) inside a leg name are codes, like the badge; anything else digit-free
      for (const s of shown) expect(s.replace(/\bS\d+\b/g, ''), i.id).not.toMatch(/\d/)
      expect(i.group).toBeTruthy()
      expect(i.icon).toBeTruthy()
      expect(i.ref || i.run, i.id).toBeTruthy()
    }
  })
})

describe('nothing changes until a row is chosen', () => {
  it('building, typing and arrowing call no store function', () => {
    const before = { on: overlayOn.peek(), t: mission.clock.t.peek(), scn: mission.plan.scenario.peek() }
    const items = fixtureIndex()
    for (const q of ['r', 'ri', 'ridge', 'leg 3', 'turn back', 'storm scenario', 'glossary term', 'S7']) rank(items, q, label)
    const { container: root } = installDom()
    act(() => render(<Palette items={items} onClose={() => {}} navigate={nav} />, root as unknown as Element))
    const input = byRole(root, 'combobox')[0] as FakeNode & { value: string }
    for (const q of ['tu', 'turn', 'turn back']) {
      act(() => {
        input.value = q
        input.dispatch('input')
      })
      act(() => void input.dispatch('keydown', { key: 'ArrowDown' }))
      act(() => void input.dispatch('keydown', { key: 'ArrowUp' }))
    }
    act(() => render(null, root as unknown as Element))
    for (const s of Object.values(spies)) expect(s).not.toHaveBeenCalled()
    expect(nav).not.toHaveBeenCalled()
    expect(selection.selected.peek()).toBeNull()
    expect(overlayOn.peek()).toEqual(before.on)
    expect(mission.clock.t.peek()).toBe(before.t)
    expect(mission.plan.scenario.peek()).toBe(before.scn)
    expect(mission.conditions.storm.peek()).toBe(false)
  })

  it('choosing each kind calls the right store function', () => {
    const items = fixtureIndex()
    const by = (id: string) => items.find((i) => i.id === id)!

    runItem(by('area:ridges'), env)
    expect(spies.setOverlay).toHaveBeenCalledWith('ridges', true)
    expect(overlayOn.peek().ridges).toBe(true)

    runItem(by('leg:official:3'), env)
    expect(selection.selected.peek()).toEqual({ kind: 'leg', leg: 3 })
    expect(selection.source.peek()).toBe('search')

    runItem(by('evt:turnBack:7'), env)
    expect(spies.seekClock).toHaveBeenCalledWith(180)
    expect(mission.clock.t.peek()).toBe(180)

    runItem(by('scn:con_104'), env)
    expect(spies.chooseScenario).toHaveBeenCalledWith({ id: 'con_104', variant: 'conservative', suit_kg: 104 })
    expect(mission.plan.scenario.peek()).toBe('con_104')

    runItem(by('scn:storm'), env)
    expect(spies.setStorm).toHaveBeenCalledWith(true)
    expect(mission.conditions.storm.peek()).toBe(true)

    nav.mockClear()
    runItem(by('evidence:licences'), env)
    expect(nav).toHaveBeenCalledWith('#/evidence/about')
    expect(spies.scrollTo).toHaveBeenCalledWith(undefined, 'evidence-licences')
    runItem(by('report:runRecord'), env)
    expect(spies.scrollTo).toHaveBeenLastCalledWith(undefined, 'report-runRecord')

    // glossary: shows the term and its definition; choosing changes nothing
    const calls = Object.values(spies).map((s) => s.mock.calls.length)
    const sel = selection.selected.peek()
    nav.mockClear()
    runItem(by('glossary:margin'), env)
    expect(Object.values(spies).map((s) => s.mock.calls.length)).toEqual(calls)
    expect(selection.selected.peek()).toBe(sel)
    expect(nav).not.toHaveBeenCalled()
  })

  it('outside PLAN/FLY a map-bound result (layer, event) opens PLAN first', () => {
    ui.mode.value = 'report'
    const items = fixtureIndex()
    runItem(items.find((i) => i.id === 'area:blocked')!, env)
    expect(nav).toHaveBeenCalledTimes(1)
    runItem(items.find((i) => i.id === 'evt:daylightEnd')!, env)
    expect(nav).toHaveBeenCalledTimes(2)
  })
})

describe('lazy build (spec rule 5, L12)', () => {
  it('importing the palette and the index builds nothing', () => {
    // the modules are imported at the top of this file; no test has asked for the index yet
    expect(expandedIndexStarted()).toBe(false)
  })

  it('the idle build waits for the intro to start, then runs in an idle callback', async () => {
    resetExpandedIndex()
    ui.introSeen.value = false
    const fetcher = vi.fn(async (_p: string): Promise<string | null> => null)
    const L = createLoader(fetcher, 'real')
    const idle: (() => void)[] = []
    const win = { setTimeout: vi.fn(), requestIdleCallback: vi.fn((cb: () => void) => idle.push(cb)) }
    const stop = scheduleIndexBuild(() => L, win as never)
    expect(win.requestIdleCallback).not.toHaveBeenCalled()
    expect(expandedIndexStarted()).toBe(false)
    ui.introSeen.value = true // the intro started (story/attach.ts)
    expect(win.requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(expandedIndexStarted()).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    idle[0]()
    expect(expandedIndexStarted()).toBe(true)
    stop()
    ui.introSeen.value = false
    resetExpandedIndex()
  })
})

describe('keystroke latency', () => {
  it('rank() over ≥ 2,000 items: median of 50 runs < 16 ms per query', () => {
    const base = fixtureIndex()
    const items: SearchItem[] = []
    for (let k = 0; items.length < 2000; k++) for (const i of base) items.push({ ...i, id: `${i.id}#${k}`, code: i.code ? `${i.code}${k}` : '' })
    expect(items.length).toBeGreaterThanOrEqual(2000)
    const queries = ['leg 3', 'S7 S6', 'turn back', 'ridge', 'storm scenario', 'glossary term', 'xqzv', 'm']
    const med = (q: string) => {
      const ms: number[] = []
      for (let r = 0; r < 50; r++) {
        const t0 = performance.now()
        rank(items, q, label)
        ms.push(performance.now() - t0)
      }
      ms.sort((a, b) => a - b)
      return ms[25]
    }
    const res = Object.fromEntries(queries.map((q) => [q, med(q)]))
    console.info(`search latency (${items.length} items, median of 50 ms):`, JSON.stringify(Object.fromEntries(Object.entries(res).map(([q, v]) => [q, +v.toFixed(2)]))))
    for (const [q, v] of Object.entries(res)) expect(v, q).toBeLessThan(16)
  })
})

describe('accessibility', () => {
  it('new rows are options with an accessible name (their text), glossary rows include the definition', () => {
    const { container: root } = installDom()
    act(() => render(<Palette items={fixtureIndex()} onClose={() => {}} navigate={nav} />, root as unknown as Element))
    const input = byRole(root, 'combobox')[0] as FakeNode & { value: string }
    for (const [q, want] of [
      ['ridge', t('layers.ridges.name')],
      ['leg 3', 'S6'],
      ['turn back', t('timeline.turnBack')],
      ['storm', t('storm.title')],
      ['margin', t('glossary.marginHint')],
    ] as const) {
      act(() => {
        input.value = q
        input.dispatch('input')
      })
      const opts = byRole(root, 'option')
      expect(opts.length, q).toBeGreaterThan(0)
      for (const o of opts) expect(o.textContent.trim().length, q).toBeGreaterThan(0)
      expect(opts[0].textContent, q).toContain(want)
    }
    act(() => render(null, root as unknown as Element))
  })
})

const REAL = resolve(__dirname, '../../../public/data')
describe.skipIf(!existsSync(resolve(REAL, 'scenarios/index.json')))('expanded index (real data tree)', () => {
  it('reads only files the app already loads, through the loader; every group is present', async () => {
    const requested: string[] = []
    const L = createLoader(async (p) => {
      requested.push(p)
      try {
        return readFileSync(resolve(REAL, p), 'utf8')
      } catch {
        return null
      }
    }, 'real')
    const items = await buildExpandedIndex(L)
    const groups = new Set(items.map((i) => i.group))
    for (const g of ['areas', 'legs', 'events', 'scenarios', 'report', 'glossary']) expect(groups, g).toContain(g)
    expect([...new Set(requested)].sort()).toEqual(['conditions/clock.json', 'conditions/rad.json', 'route_nom_104.geojson', 'scenarios/index.json', 'timeline_nom_104.json'])
    expect(requested.some((p) => p.startsWith('highlights/'))).toBe(false)
    expect(top(items, 'leg 3')[0]).toBe('leg:official:3')
    expect(top(items, 'S7 S6')[0]).toBe('leg:official:2')
    expect(top(items, 'turn back', 4).every((id) => id.startsWith('evt:turnBack'))).toBe(true)
  })
})
