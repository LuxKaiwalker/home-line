// S3b palette queries (docs/design/search.md §2.2 #1/#5/#6, §2.4, §4.2, §6):
//  - patterns: DMS (both orders, hemisphere letters, spaces, decimal seconds) → known decimal answers and a
//    round trip within 1e-6°; planner metres `x 0 y 0` = the pad, beyond planning_radius_m disabled;
//    `time home here` / `time home <coords>`; `margin below N`; near-misses fall back to fuzzy search;
//  - value integrity: time home at a point is an "estimate" RowValue from fieldAt (label "estimate", no chip);
//    no value → "unknown" / "no route home" and no number; margin values are the timeline file's margin_min
//    (manifest key exists and equals it, no arithmetic) rendered by <Num> with the trust chip mark;
//  - nothing changes until chosen: typing and arrowing never selects or seeks; Enter calls exactly one;
//  - a11y: aria-label carries the value and "estimate" / the trust label;
//  - latency: runQueries + rank over 2,000+ items, median of 50 keystrokes < 16 ms.
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoader, type TextFetcher } from '../../../data/loader'
import type { Manifest } from '../../../data/types'
import type { FieldSample } from '../../../map/field/decode'
import { toENU, sphereMetric } from '../../../nav/geom'
import { setManifest } from '../../../prov/store'
import { missionClock } from '../../../state/mission'
import { resetSelection, select, selection } from '../../../state/selection'
import { ui } from '../../../state/ui'
import { t } from '../../copy'
import { shell } from '../../shell/store'
import { byClass, byRole, installDom, type FakeNode } from '../../testing/dom'
import { buildTimelineModel, fmtEva, type TimelineFileRow } from '../../timeline/model'
import { Palette } from '../palette'
import { rank, type SearchItem } from '../search'
import { dmsToDecimal, metresToLonLat, parseDms, parseMetres } from './coords'
import { completePrefix, hereOf, loadQueryContext, PATTERNS, runQueries, type QueryContext } from './index'
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

const R = 3389500
const PAD = { id: 'rank1', lon: 137.4, lat: -4.7 }
const V3 = <T,>(v: T) => ({ opt: v, nom: v, con: v })
/** A FieldSample as fieldAt gives it (only the fields time home reads matter). */
function sample(over: Partial<FieldSample> & { tHome?: FieldSample['tHome'] }): FieldSample {
  return {
    lon: 0,
    lat: 0,
    inside: true,
    state: null,
    unknown: false,
    tHome: V3<number | null>(null),
    o2Home: null,
    noRouteHome: V3(false),
    drawn: V3<number | null>(null),
    o2Drawn: null,
    variant: 'nom',
    t: null,
    flat: null,
    k: 1,
    margin: null,
    binding: null,
    cls: 'unknown',
    ...over,
  } as FieldSample
}
// field: west of 137 unknown (hatch), lat > 0 no route home, else nom 23.5 (opt/con differ: the plan's variant is used)
const FIELD = (lon: number, lat: number): FieldSample | null =>
  lon < 137 ? sample({ unknown: true, inside: false }) : lat > 0 ? sample({ noRouteHome: V3(true) }) : sample({ tHome: { opt: 20.25, nom: 23.5, con: 30 } })

const TL: TimelineFileRow[] = [
  { t_min: 0, event: 'depart', station: null, margin_min: 327.27 },
  { t_min: 44.39, event: 'arrive', station: 'S7', margin_min: 8.26 },
  { t_min: 60, event: 'o2_checkpoint', station: null, margin_min: 4.12 },
  { t_min: 74.39, event: 'leave', station: 'S7', margin_min: 10 },
  { t_min: 90, event: 'o2_checkpoint', station: null, margin_min: null },
  { t_min: 344.58, event: 'turn_back', station: 'S7', margin_min: 0 },
]
const ST = (id: string, name: string, nom: number | null) => ({ id, name, lon: 137.41, lat: -4.71, t_home_min: { nom_104: nom } })
const CTX: QueryContext = {
  stations: [ST('S1', 'Boxwork', 42.29), ST('S4', 'Gediz', 11.36), ST('S7', 'Ridge far', null)],
  scenario: 'nom_104',
  pad: PAD,
  tMaxMin: 240,
  live: false,
  marsRadiusM: R,
  planningRadiusM: 3700,
  fieldAt: FIELD,
  timeline: buildTimelineModel({ scenario: 'nom_104', timeline: TL, tMax: 400 }),
  here: { lon: 137.5, lat: -4.8, ref: { kind: 'cell', lon: 137.5, lat: -4.8 } },
}
const rows = (q: string, c = CTX) => runQueries(q, c)
const est = (r: ReturnType<typeof rows>[number]) => r.values?.[0]

describe('coords (§2.2 #1, §2.4)', () => {
  it('DMS → decimal known answers, both orders, hemisphere letters, spaces and decimal seconds', () => {
    const lon = 137 + 23 / 60 + 36 / 3600
    const lat = -(4 + 46 / 60 + 35 / 3600)
    expect(lon).toBeCloseTo(137.393333, 6)
    expect(lat).toBeCloseTo(-4.776389, 6)
    for (const q of [`137°23'36"E 4°46'35"S`, `4°46'35"S, 137°23'36"E`, `137° 23' 36" e; 4° 46' 35" s`, `4°46'35s 137°23'36e`, `137°23′36″E 4°46′35″S`]) {
      const r = rows(q)
      expect(r, q).toHaveLength(1)
      expect(r[0].pattern).toBe('coords')
      expect(r[0].values).toBeUndefined() // coordinates are input, not results
      const p = parseDms(q.replace(/′/g, "'").replace(/″/g, '"'))!
      expect(p.lon).toBeCloseTo(lon, 9)
      expect(p.lat).toBeCloseTo(lat, 9)
    }
    expect(parseDms(`4°46'35.5"N 137°23'36.25"W`)).toEqual({ lon: -(137 + 23 / 60 + 36.25 / 3600), lat: 4 + 46 / 60 + 35.5 / 3600 })
  })

  it('DMS round trip within 1e-6°', () => {
    for (const v of [137.39, -4.77, 0.0001, 179.999, -89.5]) {
      const a = Math.abs(v)
      const d = Math.floor(a)
      const m = Math.floor((a - d) * 60)
      const s = (a - d - m / 60) * 3600
      const h = v < 0 ? 'w' : 'e'
      expect(Math.abs(dmsToDecimal(d, m, s, h)! - v)).toBeLessThan(1e-6)
    }
  })

  it('the row shows the typed text and the resulting lon/lat (today’s coordinate format), no RowValue', () => {
    const r = rows(`137°23'36"E 4°46'35"S`)[0]
    expect(r.vars?.input).toBe(`137°23'36"e 4°46'35"s`)
    expect(r.vars?.lonlat).toBe('137.393333, -4.776389')
    expect(r.icon).toBe('crosshair')
  })

  it('near-misses: one component, two longitudes, out-of-range minutes, decimal (left to parseCoordinates) → no answer row', () => {
    for (const q of [`137°23'e`, `137°23'36"E`, `137°23'36"E 4°46'35"W`, `4°46'35"N 5°1'1"S`, `137°61'36"E 4°46'35"S`, `137°23'36"E 95°46'35"S`, '137.39, -4.77', '-4.77 137.39'])
      expect(rows(q), q).toEqual([])
  })

  it('planner metres: x 0 y 0 = the pad; east/north on the pad tangent plane (nav/geom); beyond 3,700 m disabled', () => {
    expect(parseMetres('x 120 y -40')).toEqual({ x: 120, y: -40 })
    expect(parseMetres('x -300m, y 85m')).toEqual({ x: -300, y: 85 })
    const o = metresToLonLat(0, 0, PAD, R)
    expect(o.lon).toBeCloseTo(PAD.lon, 12)
    expect(o.lat).toBeCloseTo(PAD.lat, 12)
    const p = metresToLonLat(120, -40, PAD, R)
    const [e, n] = toENU([p.lon, p.lat], [PAD.lon, PAD.lat], sphereMetric(PAD.lat, R))
    expect(e).toBeCloseTo(120, 6)
    expect(n).toBeCloseTo(-40, 6)
    const r = rows('x 120 y -40')[0]
    expect(r.icon).toBe('ruler')
    expect(t(r.title, r.vars)).toContain('from the official pad')
    expect(r.disabledReason).toBeNull()
    expect(rows('x 0 y 0')[0].vars?.lonlat).toBe('137.4, -4.7')
    expect(rows('x 3000 y 3000')[0].disabledReason).toBe('search.reason.planningRadius')
    expect(rows('x 120 y -40', { ...CTX, pad: { id: 'rank1', lon: NaN, lat: NaN } })[0].disabledReason).toBe('search.reason.noPad')
    for (const q of ['x 120', 'y 40 x 120', 'x120y', 'x a y b']) expect(rows(q), q).toEqual([])
  })
})

describe('time home (§2.2 #5, §4.2)', () => {
  it('a point: the fieldAt value of the plan’s variant as an estimate RowValue (never manifest, never rounded)', () => {
    for (const q of ['time home 137.39, -4.77', 'time home -4.77 137.39', `time home 137°23'36"E 4°46'35"S`, 'time home x 120 y -40']) {
      const r = rows(q)
      expect(r, q).toHaveLength(1)
      expect(r[0].pattern).toBe('timeHome')
      expect(r[0].values).toEqual([{ kind: 'estimate', value: 23.5, unit: 'min', source: 'fieldAt' }])
      expect(rowLabel(r[0])).toContain(t('tags.estimate.label'))
    }
    const sp = rows('time home 137.39, -4.77', { ...CTX, fieldAt: (lo, la) => ({ ...FIELD(lo, la)!, variant: 'con' }) })[0]
    expect(est(sp)).toEqual({ kind: 'estimate', value: 30, unit: 'min', source: 'fieldAt' })
  })

  it('no value is never a number: hatched/outside → unknown, no route home, no field loaded → unknown', () => {
    const u = rows('time home 136.5, -4.77')[0]
    expect(u.values).toBeUndefined()
    expect(t(u.title, u.vars)).toMatch(/unknown$/)
    const n = rows('time home 137.39, 4.77')[0]
    expect(n.values).toBeUndefined()
    expect(t(n.title, n.vars)).toMatch(/no route home$/)
    const z = rows('time home 137.39, -4.77', { ...CTX, fieldAt: () => null })[0]
    expect(z.values).toBeUndefined()
    expect(z.title).toBe('search.timeHome.unknown')
    const none = rows('time home 137.39, -4.77', { ...CTX, fieldAt: undefined })[0]
    expect(none.title).toBe('search.timeHome.unknown')
    for (const r of [u, n, z]) expect(rowLabel(r)).not.toMatch(/\d+(\.\d+)? min/)
  })

  it('here: a cell → estimate; a station → its stations.json value (manifest, the card key); nothing selected → disabled', () => {
    expect(est(rows('time home here')[0])).toEqual({ kind: 'estimate', value: 23.5, unit: 'min', source: 'fieldAt' })
    const s = rows('time home here', { ...CTX, here: hereOf({ kind: 'station', id: 'S4' }, CTX.stations, PAD) })[0]
    expect(est(s)).toEqual({ kind: 'manifest', key: 't_home_min.S4.nom_104', v: 11.36, file: 'stations.json', units: 'min', chip: 'modelled' })
    expect(t(s.title, s.vars)).toBe('Time home at S4 Gediz')
    const s7 = rows('time home here', { ...CTX, here: hereOf({ kind: 'station', id: 'S7' }, CTX.stations, PAD) })[0]
    expect(s7.values).toBeUndefined()
    expect(s7.title).toBe('search.timeHome.unknown')
    const none = rows('time home here', { ...CTX, here: null })[0]
    expect(none.disabledReason).toBe('search.reason.nothingSelected')
    // reads the selection lazily (index.ts hereNow), only when asked
    const hereNow = vi.fn(() => hereOf({ kind: 'pad', id: 'rank1' }, CTX.stations, PAD))
    const p = rows('time home here', { ...CTX, here: undefined, hereNow })[0]
    expect(hereNow).toHaveBeenCalledTimes(1)
    expect(est(p)?.kind).toBe('estimate')
    rows('time home 137.39, -4.77', { ...CTX, here: undefined, hereNow })
    expect(hereNow).toHaveBeenCalledTimes(1)
    expect(hereOf({ kind: 'landmark', code: 'GDV' }, CTX.stations, PAD)).toBeNull()
  })

  it('near-misses: bare `time home` and a non-place tail fall back to fuzzy (glossary term); Tab prefix', () => {
    for (const q of ['time home', 'time home ridge', 'time homes here', 'time home 137.39', 'timehome here']) expect(rows(q), q).toEqual([])
    expect(completePrefix('ti')).toBe('time home ')
    expect(completePrefix('time h')).toBe('time home ')
  })
})

describe('margin below (§2.2 #6, §4.2)', () => {
  it('rows of the plan’s timeline with margin_min ≤ N, in time order, the file value itself; then the map note', () => {
    for (const q of ['margin below 10 min', 'margin below 10', 'margin under 10', 'margin < 10', 'margin<10min']) {
      const r = rows(q)
      expect(r.map((x) => x.id), q).toEqual(['margin:10:1', 'margin:10:2', 'margin:10:3', 'margin:10:note'])
      expect(r.slice(0, 3).map((x) => est(x))).toEqual(
        [1, 2, 3].map((i) => ({ kind: 'manifest', key: `timeline.nom_104.${i}.margin_min`, v: TL[i].margin_min, file: 'timeline_nom_104.json', units: 'min', chip: 'modelled' })),
      )
      expect(r[3].disabledReason).toBe('search.reason.mapLater')
      expect(t(r[3].title)).toBe('Map highlight comes later')
    }
    expect(t(rows('margin < 5')[0].title, rows('margin < 5')[0].vars)).toBe(`${fmtEva(60)} Oxygen checkpoint: margin`)
    expect(t(rows('margin < 9')[0].title, rows('margin < 9')[0].vars)).toBe(`00:44 Arrival S7: margin`)
  })

  it('none at or under N, or no timeline → a disabled row with its reason (and the note); near-misses → fuzzy', () => {
    const n = rows('margin below 3')
    expect(n[0].disabledReason).toBe('search.reason.nothingToOpen')
    expect(n[0].values).toBeUndefined()
    expect(rows('margin below 10', { ...CTX, timeline: null })[0].disabledReason).toBe('search.reason.noTimeline')
    for (const q of ['margin', 'margin below', 'margin below x', 'margin below 1000', 'margin above 10', 'margins below 10']) expect(rows(q), q).toEqual([])
    expect(completePrefix('m')).toBe('margin below ')
  })
})

describe('precedence and purity', () => {
  it('PATTERNS order: coords first; every example parses to its own pattern', () => {
    expect(PATTERNS.map((p) => p.id)).toEqual(['coords', 'time', 'route', 'within', 'timeHome', 'marginBelow'])
    for (const p of PATTERNS) for (const ex of p.examples) expect(rows(ex)[0]?.pattern, ex).toBe(p.id)
  })

  it('parse is pure: no select or seek while parsing the S3b patterns', () => {
    const seek = vi.spyOn(missionClock, 'seek')
    vi.mocked(select).mockClear()
    for (const q of [`137°23'36"E 4°46'35"S`, 'x 120 y -40', 'time home here', 'time home 137.39, -4.77', 'margin below 10', 'margin < 999']) rows(q)
    expect(seek).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    seek.mockRestore()
  })
})

// ---------------------------------------------------------------- palette (fake DOM)
let root: FakeNode
const mount = (v: VNode) => act(() => render(v, root as unknown as Element))
const input = () => byRole(root, 'combobox')[0] as FakeNode & { value: string }
const options = () => byRole(root, 'option')
function type(q: string): void {
  act(() => {
    input().value = q
    input().dispatch('input')
  })
}
const key = (k: string) => act(() => void input().dispatch('keydown', { key: k }))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

describe('palette: S3b rows', () => {
  beforeEach(() => {
    ;({ container: root } = installDom())
    resetSelection()
    ui.mode.value = 'plan'
    shell.sidebarOpen.value = false
    vi.mocked(select).mockClear()
  })
  afterEach(() => act(() => render(null, root as unknown as Element)))

  it('nothing changes until chosen; Enter: time home selects the cell once, margin seeks the clock once, DMS selects once', async () => {
    const seek = vi.spyOn(missionClock, 'seek')
    const t0 = missionClock.t
    const onClose = vi.fn()
    const nav = vi.fn()
    mount(<Palette items={[]} queryContext={CTX} onClose={onClose} navigate={nav} />)
    const qs = ['time home here', 'time home 137.39, -4.77', 'time home x 120 y -40', 'margin below 10 min', 'margin < 5', `137°23'36"E 4°46'35"S`, 'x 120 y -40', 'x 9000 y 0', 'margin below 3', 'time home 136, -4']
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
    expect(nav).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    type('time home 137.39, -4.77')
    const o = options()[0]
    expect(o.getAttribute('aria-label')).toBe(`Time home at 137.39, -4.77, 23.5 min ${t('tags.estimate.label')}`)
    expect(byClass(o, 'hl-chip__mark')).toHaveLength(0) // an estimate has no trust chip
    expect(o.textContent).toContain(t('tags.estimate.label'))
    key('Enter')
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith({ kind: 'cell', lon: 137.39, lat: -4.77 }, 'search')
    expect(shell.sidebarOpen.value).toBe(true)
    expect(seek).not.toHaveBeenCalled()

    type('margin below 10')
    key('ArrowDown')
    key('Enter')
    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek).toHaveBeenCalledWith(60)
    expect(select).toHaveBeenCalledTimes(1)

    type(`4°46'35"S, 137°23'36"E`)
    key('Enter')
    expect(select).toHaveBeenCalledTimes(2)
    const c = vi.mocked(select).mock.calls[1][0] as { kind: string; lon: number; lat: number }
    expect(c.kind).toBe('cell')
    expect(c.lon).toBeCloseTo(137.393333, 6)
    expect(c.lat).toBeCloseTo(-4.776389, 6)
    expect(onClose).toHaveBeenCalledTimes(3)
    seek.mockRestore()
    missionClock.seek(0)
  })

  it('the map note and the none row are disabled; an unknown time home shows no number', async () => {
    const onClose = vi.fn()
    mount(<Palette items={[]} queryContext={CTX} onClose={onClose} />)
    type('margin below 3')
    for (const o of options().filter((x) => x.getAttribute('data-pattern') === 'marginBelow')) expect(o.getAttribute('aria-disabled')).toBe('true')
    key('Enter')
    type('time home 136, -4')
    const u = options()[0]
    expect(u.getAttribute('aria-label')).toBe('Time home at 136, -4: unknown')
    expect(byClass(u, 'num-derived')).toHaveLength(0)
    await flush()
    expect(onClose).not.toHaveBeenCalled() // the disabled rows do nothing
    expect(select).not.toHaveBeenCalled()
  })
})

describe.skipIf(!HAVE)('value integrity (real data)', () => {
  let manifest: Manifest
  let ctx: QueryContext
  let file: TimelineFileRow[]
  beforeAll(async () => {
    manifest = JSON.parse(readFileSync(resolve(REAL, 'manifest.json'), 'utf8')) as Manifest
    setManifest(manifest)
    resetSelection()
    ctx = await loadQueryContext(L, false)
    file = JSON.parse(readFileSync(resolve(REAL, `timeline_${ctx.scenario}.json`), 'utf8')) as TimelineFileRow[]
  })
  beforeEach(() => {
    ;({ container: root } = installDom())
  })
  afterEach(() => act(() => render(null, root as unknown as Element)))

  it('context: the plan’s timeline, fieldAt, the selection reader and the planning radius', () => {
    expect(ctx.timeline?.scenario).toBe(ctx.scenario)
    expect(ctx.timeline?.file).toBe(`timeline_${ctx.scenario}.json`)
    expect(typeof ctx.fieldAt).toBe('function')
    expect(ctx.hereNow?.()).toBeNull() // nothing selected
    expect(ctx.planningRadiusM).toBe(3700)
  })

  it('every margin number is a manifest RowValue whose key exists and equals the timeline file value', () => {
    const entries = (manifest as unknown as { entries?: Record<string, { value: unknown; file: string }> }).entries ?? (manifest as unknown as Record<string, { value: unknown; file: string }>)
    const r = runQueries('margin below 999', ctx).filter((x) => x.values)
    const flown = file.filter((e) => e.event !== 'turn_back' && typeof e.margin_min === 'number')
    expect(r).toHaveLength(flown.length)
    for (const row of r) {
      const v = row.values![0]
      if (v.kind !== 'manifest') throw new Error('margin must be manifest-backed')
      const i = Number(v.key.split('.')[2])
      expect(v.key).toBe(`timeline.${ctx.scenario}.${i}.margin_min`)
      expect(v.v).toBe(file[i].margin_min) // the file value itself: no arithmetic
      expect(entries[v.key], v.key).toBeDefined()
      expect(entries[v.key].value).toBe(v.v)
      expect(entries[v.key].file).toBe(`timeline_${ctx.scenario}.json`)
    }
  })

  it('rendered by <Num> (backed, scorecard link) with the trust chip mark; aria-label has value + trust label', () => {
    mount(<Palette items={[]} queryContext={ctx} onClose={() => {}} />)
    type('margin below 999')
    const opts = options().filter((o) => o.getAttribute('data-pattern') === 'marginBelow' && !o.getAttribute('aria-disabled'))
    expect(opts.length).toBeGreaterThan(0)
    for (const o of opts) {
      const i = Number(o.getAttribute('data-id')!.split(':')[2])
      const v = file[i].margin_min as number
      const num = byClass(o, 'num-ok')
      expect(num).toHaveLength(1)
      expect(num[0].getAttribute('href')).toContain(`key=timeline.${ctx.scenario}.${i}.margin_min`)
      expect(byClass(o, 'hl-chip__mark--modelled')).toHaveLength(1)
      expect(o.getAttribute('aria-label')).toContain(`${v} min ${t('chips.modelled.label')}`)
    }
  })
})

describe('latency (spec rule 5)', () => {
  it('runQueries + rank over 2,000+ items with S3b patterns: median of 50 keystrokes < 16 ms', () => {
    const items: SearchItem[] = Array.from({ length: 2400 }, (_, i) => ({
      id: `x:${i}`,
      group: i % 2 ? 'sites' : 'landmarks',
      code: `X${i}`,
      name: `ridge site ${i} sulfate ${i % 7} clay`,
      icon: 'scored-site',
      priority: 9,
    }))
    const label = (i: SearchItem) => i.name
    const qs = ['time home h', 'time home here', 'time home 137.39, -4.7', `137°23'36"E 4°4`, `137°23'36"E 4°46'35"S`, 'x 120 y -4', 'margin below 1', 'margin < 10', 'ridge', 'margin']
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
    console.log(`S3b latency: median ${ms[25].toFixed(2)} ms, max ${ms[49].toFixed(2)} ms over ${items.length} items`)
    expect(ms[25]).toBeLessThan(16)
  })
})
