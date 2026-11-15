// S3a palette queries (docs/design/search.md §2.2 grammar, §4.2 store map, §6 test plan):
//  - patterns: every example parses; near-misses fall back to fuzzy search (no answer rows); out of range
//    gives a disabled row with its reason; Tab prefixes complete (§2.3);
//  - value integrity: every number in a "within" row is a manifest RowValue whose key exists in
//    manifest.json and equals the stations.json value (no arithmetic), rendered by <Num> with a chip mark;
//    unknown times are listed as "unknown", not dropped;
//  - nothing changes until chosen: typing and arrowing through 50 queries never seeks the clock, selects
//    or drafts a route; Enter calls exactly one of them once;
//  - live / offline: the route row is disabled with its reason offline, enabled when live;
//  - keyboard + a11y: Tab completes, Enter runs, role=option rows with value + trust label in aria-label;
//  - latency: runQueries + rank over 2,000+ items, median of 50 keystrokes < 16 ms.
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createLoader, type TextFetcher } from '../../../data/loader'
import type { Manifest, Station } from '../../../data/types'
import { setManifest } from '../../../prov/store'
import { missionClock } from '../../../state/mission'
import { resetSelection, select, selection } from '../../../state/selection'
import { ui } from '../../../state/ui'
import { t } from '../../copy'
import { shell } from '../../shell/store'
import { byClass, byRole, installDom, type FakeNode } from '../../testing/dom'
import { Palette } from '../palette'
import { rank, type SearchItem } from '../search'
import { completePrefix, loadQueryContext, normalizeQuery, PATTERNS, runQueries, type QueryContext } from './index'
import { MAX_STOPS } from './route'
import { setRouteImporter } from './routeAdapter'
import { rowLabel } from './row'

vi.mock('../../../state/selection', async (orig) => {
  const m = await orig<typeof import('../../../state/selection')>()
  return { ...m, select: vi.fn(m.select) }
})

const REAL = resolve(__dirname, '../../../../public/data')
const HAVE = existsSync(resolve(REAL, 'manifest.json'))
const fetcher: TextFetcher = async (p) => {
  try {
    return await readFile(resolve(REAL, p), 'utf8')
  } catch {
    return null
  }
}
const L = createLoader(fetcher, 'real')

const ST = (id: string, name: string, nom: number | null) => ({ id, name, lon: 137.4, lat: -4.7, t_home_min: { nom_104: nom } })
const CTX: QueryContext = {
  stations: [ST('S1', 'Boxwork', 42.29), ST('S4', 'Gediz', 11.36), ST('S6', 'Ridge near', 41.23), ST('S7', 'Ridge far', null)],
  scenario: 'nom_104',
  pad: { id: 'rank1', lon: 137.4, lat: -4.7 },
  tMaxMin: 240,
  live: false,
  marsRadiusM: 3389500,
  routeEdit: true,
  routeDraft: 'ready',
}
const LIVE: QueryContext = { ...CTX, live: true }
const rows = (q: string, c = CTX) => runQueries(q, c)

describe('patterns (§2.2)', () => {
  it('PATTERNS are in precedence order and every example parses to its own pattern', () => {
    expect(PATTERNS.map((p) => p.id)).toEqual(['time', 'route', 'within'])
    for (const p of PATTERNS) for (const ex of p.examples) expect(rows(ex)[0]?.pattern, ex).toBe(p.id)
  })

  it('time: minutes or h:mm, formatted hh:mm in the title (the user minute, not a validated number)', () => {
    const cases: [string, number, string][] = [
      ['t 45', 45, '00:45'],
      ['t45', 45, '00:45'],
      ['T 45 min', 45, '00:45'],
      ['t +30', 30, '00:30'],
      ['t 1:20', 80, '01:20'],
      ['at 01:20', 80, '01:20'],
      ['  AT   2:05 ', 125, '02:05'],
    ]
    for (const [q, min, txt] of cases) {
      const r = rows(q)
      expect(r, q).toHaveLength(1)
      expect(r[0].id).toBe(`time:${min}`)
      expect(r[0].vars).toEqual({ time: txt })
      expect(t(r[0].title, r[0].vars)).toBe(`Jump to mission time ${txt}`)
      expect(r[0].values).toBeUndefined()
      expect(r[0].disabledReason).toBeNull()
    }
  })

  it('time: out of range gives a disabled row with its reason; near-misses fall back to fuzzy', () => {
    expect(rows('t 241')[0].disabledReason).toBe('search.reason.timeRange')
    expect(rows('t 240')[0].disabledReason).toBeNull()
    for (const q of ['t', 'at', 'at45', 't 1:75', 't 1234', 'time', 'tx 45', 't 4 5']) expect(rows(q), q).toEqual([])
  })

  it('route: codes case-insensitive, commas and arrows; unknown codes and too many stops are disabled with the reason', () => {
    for (const q of ['route S4 S1 S6', 'route s4, s1 → s6', 'route s4,s1->s6', 'ROUTE S4 – > S1 S6'.replace('– >', '->')]) {
      const r = rows(q, LIVE)
      expect(r, q).toHaveLength(1)
      expect(r[0].vars).toEqual({ stops: 'S4 → S1 → S6' })
      expect(r[0].live).toBe(true)
      expect(r[0].disabledReason).toBeNull()
    }
    const u = rows('route S4 S9 S1', LIVE)[0]
    expect(u.disabledReason).toBe('search.reason.unknownStop')
    expect(t(u.title, u.vars)).toContain('S9')
    expect(MAX_STOPS).toBe(8)
    expect(rows(`route ${Array(MAX_STOPS + 1).fill('S1').join(' ')}`, LIVE)[0].disabledReason).toBe('search.reason.tooManyStops')
    for (const q of ['route', 'route ', 'routes4', 'reroute S4']) expect(rows(q, LIVE), q).toEqual([])
  })

  it('within: forms of the doc; > 999 is a disabled row; near-misses fall back to fuzzy', () => {
    for (const q of ['stations within 30 min', 'within 45', 'station within 30 minutes', 'within 30min']) expect(rows(q)[0]?.pattern, q).toBe('within')
    expect(rows('within 1000')[0].disabledReason).toBe('search.reason.withinRange')
    for (const q of ['within x', 'within', 'stations', 'stations within', 'within -5']) expect(rows(q), q).toEqual([])
  })

  it('within: stations with time home ≤ N ascending, then unknown ones (never dropped); none → a disabled row', () => {
    const r = rows('within 42')
    expect(r.map((x) => x.vars?.code)).toEqual(['S4', 'S6', 'S7'])
    expect(r.map((x) => (x.values?.[0].kind === 'manifest' ? x.values[0].v : 'x'))).toEqual([11.36, 41.23, null])
    expect(rows('within 50').map((x) => x.vars?.code)).toEqual(['S4', 'S6', 'S1', 'S7'])
    const none = rows('within 5', { ...CTX, stations: CTX.stations.slice(0, 3) })
    expect(none).toHaveLength(1)
    expect(none[0].disabledReason).toBe('search.reason.nothingToOpen')
  })

  it('normalisation (§2.1) and Tab prefixes (§2.3)', () => {
    expect(normalizeQuery('  Route  S4->S1 –> S6 ')).toBe('route s4 → s1 → s6')
    expect(completePrefix('sta')).toBe('stations within ')
    expect(completePrefix('st')).toBe('stations within ')
    expect(completePrefix('a')).toBe('at ')
    expect(completePrefix('t')).toBe('t ')
    expect(completePrefix('r')).toBe('route ')
    expect(completePrefix('w')).toBe('within ')
    for (const q of ['', 'route ', 'route s4', 'stations within ', 'x', 'zz']) expect(completePrefix(q), q).toBeNull()
  })

  it('parse is pure: no store, clock or route call while parsing', () => {
    const seek = vi.spyOn(missionClock, 'seek')
    const imp = vi.fn(async (): Promise<Record<string, unknown>> => ({}))
    setRouteImporter(imp)
    for (const q of ['t 45', 'at 01:20', 'route S4 S1 S6', 'within 30', 'stations within 999']) rows(q, LIVE)
    expect(seek).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(imp).not.toHaveBeenCalled()
    seek.mockRestore()
    setRouteImporter(null)
  })
})

describe('live / offline (spec rule 4)', () => {
  it('route row: offline → disabled with the reason; live → enabled; flag off or setRouteDraft missing → its reason', () => {
    expect(rows('route S4 S1 S6', CTX)[0].disabledReason).toBe('search.reason.offline')
    expect(rows('route S4 S1 S6', LIVE)[0].disabledReason).toBeNull()
    expect(rows('route S4 S1 S6', { ...LIVE, routeEdit: false })[0].disabledReason).toBe('search.reason.routeEditOff')
    expect(rows('route S4 S1 S6', { ...LIVE, routeDraft: 'missing' })[0].disabledReason).toBe('search.route.unavailable')
    expect(rows('route S4 S1 S6', { ...LIVE, routeDraft: 'unknown' })[0].disabledReason).toBeNull()
  })
})

// ---------------------------------------------------------------- palette (fake DOM)
let root: FakeNode
function mount(v: VNode): void {
  act(() => render(v, root as unknown as Element))
}
const input = () => byRole(root, 'combobox')[0] as FakeNode & { value: string }
const options = () => byRole(root, 'option')
function type(q: string): void {
  act(() => {
    input().value = q
    input().dispatch('input')
  })
}
const key = (k: string, init: Record<string, unknown> = {}) => act(() => void input().dispatch('keydown', { key: k, ...init }))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

describe('palette answer rows', () => {
  const items: SearchItem[] = [{ id: 'station:S4', group: 'stations', code: 'S4', name: 'Gediz', icon: 'station', priority: 1, ref: { kind: 'station', id: 'S4' } }]
  let draft: Mock<(stops: unknown, mode: string) => { ok: boolean; problems: unknown[] }>
  let imp: Mock<() => Promise<Record<string, unknown>>>
  beforeEach(() => {
    ;({ container: root } = installDom())
    resetSelection()
    ui.mode.value = 'plan'
    shell.sidebarOpen.value = false
    vi.mocked(select).mockClear()
    draft = vi.fn((_stops: unknown, _mode: string) => ({ ok: true, problems: [] as unknown[] }))
    imp = vi.fn(async (): Promise<Record<string, unknown>> => ({ setRouteDraft: draft }))
    setRouteImporter(imp)
  })
  afterEach(() => {
    act(() => render(null, root as unknown as Element))
    setRouteImporter(null)
  })

  it('nothing changes until chosen: 50 queries typed and arrowed → no seek, select or route call; Enter → exactly one', async () => {
    const seek = vi.spyOn(missionClock, 'seek')
    const t0 = missionClock.t
    const onClose = vi.fn()
    const nav = vi.fn()
    mount(<Palette items={items} queryContext={LIVE} onClose={onClose} navigate={nav} />)
    const qs = ['t 45', 'at 01:20', 'route S4 S1 S6', 'within 30', 'stations within 45 min', 't 999', 'route S9', 'within 1000', 's', 'ridge']
    for (let i = 0; i < 50; i++) {
      type(qs[i % qs.length])
      key('ArrowDown')
      key('ArrowUp')
    }
    await flush()
    expect(seek).not.toHaveBeenCalled()
    expect(missionClock.t).toBe(t0)
    expect(select).not.toHaveBeenCalled()
    expect(selection.selected.value).toBeNull()
    expect(imp).not.toHaveBeenCalled()
    expect(draft).not.toHaveBeenCalled()
    expect(nav).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    type('t 1:20')
    key('Enter')
    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek).toHaveBeenCalledWith(80)
    expect(missionClock.t).toBe(80)
    expect(onClose).toHaveBeenCalledTimes(1)

    type('within 30')
    key('Enter')
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith({ kind: 'station', id: 'S4' }, 'search')
    expect(shell.sidebarOpen.value).toBe(true)

    type('route S4 S1 S6')
    key('Enter')
    await flush()
    expect(draft).toHaveBeenCalledTimes(1)
    expect(draft).toHaveBeenCalledWith([{ station: 'S4' }, { station: 'S1' }, { station: 'S6' }], 'ordered')
    expect(seek).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)
    seek.mockRestore()
    missionClock.seek(0)
  })

  it('time outside a map mode navigates to FLY first', () => {
    ui.mode.value = 'report'
    const nav = vi.fn()
    mount(<Palette items={items} queryContext={CTX} onClose={() => {}} navigate={nav} />)
    type('t 45')
    key('Enter')
    expect(nav).toHaveBeenCalledTimes(1)
    expect(missionClock.t).toBe(45)
    missionClock.seek(0)
  })

  it('offline: the route row is disabled with its reason; Enter does nothing and the palette stays open', async () => {
    const onClose = vi.fn()
    mount(<Palette items={items} queryContext={CTX} onClose={onClose} />)
    type('route S4 S1 S6')
    const o = options()[0]
    expect(o.getAttribute('aria-disabled')).toBe('true')
    expect(o.getAttribute('aria-label')).toContain(t('search.disabled', { reason: t('search.reason.offline') }))
    expect(o.textContent).toContain(t('search.reason.offline'))
    key('Enter')
    act(() => void o.dispatch('click'))
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect(imp).not.toHaveBeenCalled()
  })

  it('keyboard: Tab completes a prefix (no focus move), answer rows come first, aria-activedescendant follows', () => {
    mount(<Palette items={items} queryContext={CTX} onClose={() => {}} />)
    type('sta')
    key('Tab')
    expect(input().value).toBe('stations within ')
    type('stations within 45')
    const opts = options()
    expect(opts.length).toBeGreaterThan(1)
    expect(opts[0].getAttribute('data-pattern')).toBe('within')
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[0].getAttribute('id'))
    key('ArrowDown')
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[1].getAttribute('id'))
    // Tab with nothing to complete keeps the default focus move (never traps)
    type('ridge')
    key('Tab')
    expect(input().value).toBe('ridge')
  })
})

describe.skipIf(!HAVE)('value integrity (real data)', () => {
  let manifest: Manifest
  let stations: Station[]
  let ctx: QueryContext
  beforeAll(async () => {
    manifest = JSON.parse(readFileSync(resolve(REAL, 'manifest.json'), 'utf8')) as Manifest
    setManifest(manifest)
    stations = JSON.parse(readFileSync(resolve(REAL, 'stations.json'), 'utf8')) as Station[]
    ctx = await loadQueryContext(L, false)
  })
  beforeEach(() => {
    ;({ container: root } = installDom())
  })
  afterEach(() => act(() => render(null, root as unknown as Element)))

  it('context from the loaded files: the scenario is the index default; every station is there', () => {
    expect(ctx.scenario).toBe('nom_104')
    expect(ctx.stations.map((s) => s.id)).toEqual(stations.map((s) => s.id))
    expect(ctx.live).toBe(false)
    expect(ctx.routeEdit).toBe(false) // static build
  })

  it('every "within" number is a manifest RowValue whose key exists and equals the stations.json value', () => {
    const entries = (manifest as unknown as { entries?: Record<string, { value: unknown; file: string }> }).entries ?? (manifest as unknown as Record<string, { value: unknown; file: string }>)
    for (const scenario of ['nom_104', 'con_104', 'opt_80']) {
      const r = runQueries('within 999', { ...ctx, scenario })
      expect(r).toHaveLength(stations.length) // nobody dropped: unknown ones are listed too
      for (const row of r) {
        expect(row.values).toHaveLength(1)
        const v = row.values![0]
        expect(v.kind).toBe('manifest')
        if (v.kind !== 'manifest') continue
        const s = stations.find((x) => x.id === row.vars?.code)!
        expect(v.key).toBe(`t_home_min.${s.id}.${scenario}`)
        expect(v.file).toBe('stations.json')
        expect(v.v).toBe(s.t_home_min[scenario] ?? null) // the file value itself: no arithmetic
        if (v.v === null) continue // unknown: no number shown (the pipeline records no manifest entry for a null)
        expect(entries[v.key], v.key).toBeDefined()
        expect(entries[v.key].value).toBe(v.v)
        expect(entries[v.key].file).toBe('stations.json')
      }
    }
  })

  it('rendered by <Num> (backed, scorecard link) with the trust chip mark; unknown says unknown, no chip', () => {
    mount(<Palette items={[]} queryContext={{ ...ctx, scenario: 'con_104' }} onClose={() => {}} />)
    type('stations within 999 min')
    const opts = options()
    expect(opts.length).toBe(stations.length)
    for (const o of opts) {
      const s = stations.find((x) => o.getAttribute('data-id')!.endsWith(`:${x.id}`))!
      const v = s.t_home_min.con_104 ?? null
      if (v === null) {
        expect(byClass(o, 'num-unknown')).toHaveLength(1)
        expect(byClass(o, 'hl-chip__mark')).toHaveLength(0)
        expect(o.getAttribute('aria-label')).toContain('unknown')
        continue
      }
      const num = byClass(o, 'num-ok')
      expect(num, s.id).toHaveLength(1)
      expect(num[0].getAttribute('href')).toContain(`key=t_home_min.${s.id}.con_104`)
      expect(num[0].textContent).toBe(`${v} min`)
      expect(byClass(o, 'hl-chip__mark--modelled')).toHaveLength(1)
      expect(o.getAttribute('aria-label')).toBe(`${s.id} ${s.name}: time home, ${v} min ${t('chips.modelled.label')}`)
    }
    expect(opts.some((o) => byClass(o, 'num-unknown').length)).toBe(true) // S7 has no con_104 time
  })

  it('rowLabel gives title, value with trust label, and the disabled reason', () => {
    const r = runQueries('route S4 S1 S6', ctx)[0]
    expect(rowLabel(r)).toBe(`${t('search.route.row', { stops: 'S4 → S1 → S6' })}, ${t('search.disabled', { reason: t('search.reason.offline') })}`)
  })
})

describe('latency (spec rule 5)', () => {
  it('runQueries + rank over 2,000+ items: median of 50 keystrokes < 16 ms', () => {
    const items: SearchItem[] = Array.from({ length: 2400 }, (_, i) => ({
      id: `x:${i}`,
      group: i % 2 ? 'sites' : 'landmarks',
      code: `X${i}`,
      name: `ridge site ${i} sulfate ${i % 7} clay`,
      icon: 'scored-site',
      priority: 9,
    }))
    const label = (i: SearchItem) => i.name
    const qs = ['t 4', 't 45', 'at 01:2', 'route s4 s1', 'route S4 S1 S6', 'stations within 3', 'within 45', 'ridge', 'sulf', 'x12']
    for (let i = 0; i < 20; i++) runQueries(qs[i % qs.length], CTX), rank(items, qs[i % qs.length], label)
    const ms: number[] = []
    for (let i = 0; i < 50; i++) {
      const q = qs[i % qs.length]
      const a = performance.now()
      runQueries(q, CTX)
      rank(items, q, label)
      ms.push(performance.now() - a)
    }
    ms.sort((a, b) => a - b)
    const median = ms[25]
    console.log(`S3a latency: median ${median.toFixed(2)} ms, max ${ms[49].toFixed(2)} ms over ${items.length} items`)
    expect(median).toBeLessThan(16)
  })
})
