// PORT U3 known answers: the EVA start round trip on the planning store (LMST <-> UTC with the
// clock.json fixtures of mission/marstime.test.ts), the storm switch -> setStorm, the boundary list
// (Mission tab's ids and order) -> setBoundary, and the copy (route.settings).
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setPadService } from '../../../pads'
import { createMockPadService } from '../../../pads/mock'
import type { PlanProducts } from '../../../pads/types'
import { fieldUniforms, mission } from '../../../state/mission'
import { createPlanningStore, type PlanningStore } from '../../../state/planning'
import { all, byRole, byTag, installDom, one, type FakeNode } from '../../testing/dom'
import { boundaryFromValue, boundaryOptions, boundaryValue } from './boundary'
import copyDeck from '../../copy.json'
import { CLOCK, formatHms, lmstH, mslSol } from './marstime'
import { useRoutePanelSection, resetRoutePanelSections } from '../sections'
import { BoundarySettings, install, register, RouteSettings, StartTimeSettings, STORM_REPLAY_DATE, StormSettings, sunSiteFor, useBoundaryOptions } from './RouteSettings'
import { DEFAULT_START_MS, fromUtcInput, hoursOf, isDefaultStart, MAX_START_MS, MIN_START_MS, startMsOf, startUtcFor, startUtcForSolLmst, toUtcInput } from './startTime'
const copy = copyDeck.route.settings

/** clock.json: start_utc of the simulated EVA (09:00 LMST, sol 5074; mission/marstime.test.ts) */
const EVA_ROUNDED = '2026-11-14T10:51:18Z'

let root: FakeNode
let restore: () => void
const mount = (v: VNode): FakeNode => {
  act(() => render(v, root as unknown as Element))
  return root
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => void (await Promise.resolve()))
}
const fire = (n: FakeNode, type: string, value?: string) => act(() => void n.dispatch(type, value === undefined ? {} : { target: { value } }))
const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ')
const inputOf = (type: string) => one(all(root, (n) => n.localName === 'input' && n.getAttribute('type') === type), `input[type=${type}]`)

beforeEach(() => {
  root = installDom().container
  restore = setPadService(createMockPadService())
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  restore()
})

describe('EVA start helpers (marstime known answers)', () => {
  it('null is clock.json’s instant: 09:00 LMST, sol 5074, 10:51:18 UTC', () => {
    expect(startMsOf(null)).toBe(DEFAULT_START_MS)
    expect(formatHms(lmstH(DEFAULT_START_MS, CLOCK.galeLonEastDeg))).toBe('09:00:00')
    expect(mslSol(DEFAULT_START_MS, CLOCK.galeLonEastDeg)).toBe(5074)
    expect(Math.abs(DEFAULT_START_MS - Date.parse(EVA_ROUNDED))).toBeLessThanOrEqual(500)
  })
  it('the default instant (and the rounded clock.json UTC) is stored as null', () => {
    expect(startUtcFor(DEFAULT_START_MS)).toBeNull()
    expect(startUtcFor(Date.parse(EVA_ROUNDED))).toBeNull()
    expect(isDefaultStart(startMsOf(EVA_ROUNDED))).toBe(true)
    expect(startUtcForSolLmst(5074, 9)).toBeNull()
  })
  it('sol + LMST -> UTC -> sol + LMST round trip', () => {
    const iso = startUtcForSolLmst(4200, 13.5)!
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    const ms = startMsOf(iso)
    expect(mslSol(ms, CLOCK.galeLonEastDeg)).toBe(4200)
    expect(formatHms(lmstH(ms, CLOCK.galeLonEastDeg))).toBe('13:30:00')
    expect(startUtcFor(ms)).toBe(iso)
  })
  it('UTC field round trip and clamping to [landing, end of the leap-second table]', () => {
    expect(fromUtcInput(toUtcInput(Date.parse('2026-11-15T12:34:00Z')))).toBe(Date.parse('2026-11-15T12:34:00Z'))
    expect(fromUtcInput('')).toBeNaN()
    expect(startUtcFor(Date.parse('2000-01-01T00:00:00Z'))).toBe(new Date(MIN_START_MS).toISOString().replace('.000', ''))
    expect(startMsOf(startUtcFor(Date.parse('2030-01-01T00:00:00Z')))).toBe(MAX_START_MS)
    expect(startUtcForSolLmst(-1, 9)).toBeUndefined()
    expect(startUtcForSolLmst(5074, NaN)).toBeUndefined()
    expect(hoursOf('13:30')).toBe(13.5)
    expect(hoursOf('25:00')).toBeNaN()
  })
})

describe('EVA start card on the planning store', () => {
  let store: PlanningStore
  beforeEach(() => void (store = createPlanningStore()))

  it('shows LMST and UTC of the default start', () => {
    mount(<StartTimeSettings store={store} />)
    const t = text(root)
    expect(t).toContain('Sol 5074, 09:00:00 LMST')
    expect(t).toContain('2026-11-14 10:51:18 UTC')
    expect(t).toContain('Default:')
    expect(inputOf('time').getAttribute('value')).toBe('09:00')
    expect(inputOf('datetime-local').getAttribute('value')).toBe('2026-11-14T10:51')
    expect(inputOf('number').getAttribute('value')).toBe('5074')
    // sun at the official pad (mock = clock.json site): daylight left 578.7 min (clock.json t_dark 578.67)
    expect(t).toContain('578.7 min')
  })
  it('every input is labelled', () => {
    mount(<StartTimeSettings store={store} />)
    for (const i of byTag(root, 'input')) {
      const id = i.getAttribute('id')
      expect(id).toBeTruthy()
      expect(all(root, (n) => n.localName === 'label' && n.getAttribute('for') === id)).toHaveLength(1)
    }
  })
  it('LMST edit -> setStartUtc(iso); UTC display follows; Reset -> null; one undo step each', () => {
    mount(<StartTimeSettings store={store} />)
    fire(inputOf('time'), 'change', '13:30')
    const iso = store.state.peek().route.startUtc!
    expect(iso).not.toBeNull()
    expect(formatHms(lmstH(Date.parse(iso), CLOCK.galeLonEastDeg))).toBe('13:30:00')
    expect(mslSol(Date.parse(iso), CLOCK.galeLonEastDeg)).toBe(5074)
    expect(text(root)).toContain('Sol 5074, 13:30:00 LMST')
    expect(text(root)).toContain(`${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`)
    expect(text(root)).toContain(copy.start.custom)
    const reset = one(all(root, (n) => n.localName === 'button' && n.textContent.trim() === copy.start.reset))
    fire(reset, 'click')
    expect(store.state.peek().route.startUtc).toBeNull()
    store.undo()
    expect(store.state.peek().route.startUtc).toBe(iso)
  })
  it('UTC edit -> sol and LMST follow; sol edit keeps LMST', () => {
    mount(<StartTimeSettings store={store} />)
    fire(inputOf('datetime-local'), 'change', '2026-11-15T12:00')
    expect(store.state.peek().route.startUtc).toBe('2026-11-15T12:00:00Z')
    const ms = Date.parse('2026-11-15T12:00:00Z')
    expect(inputOf('number').getAttribute('value')).toBe(String(mslSol(ms, CLOCK.galeLonEastDeg)))
    expect(inputOf('time').getAttribute('value')).toBe(formatHms(lmstH(ms, CLOCK.galeLonEastDeg)).slice(0, 5))
  })
  it('sol edit on the store keeps the LMST', () => {
    mount(<StartTimeSettings store={store} />)
    fire(inputOf('number'), 'change', '4200')
    const ms = Date.parse(store.state.peek().route.startUtc!)
    expect(mslSol(ms, CLOCK.galeLonEastDeg)).toBe(4200)
    expect(formatHms(lmstH(ms, CLOCK.galeLonEastDeg))).toBe('09:00:00')
  })
  it('invalid input changes nothing', () => {
    mount(<StartTimeSettings store={store} />)
    fire(inputOf('time'), 'change', '')
    fire(inputOf('number'), 'change', '-3')
    fire(inputOf('datetime-local'), 'change', 'nonsense')
    expect(store.state.peek().route.startUtc).toBeNull()
    expect(store.canUndo.peek()).toBe(false)
  })
  it('without a pad list the sun rows are hidden but LMST/UTC still show', () => {
    restore()
    restore = setPadService(createMockPadService({ pads: [] }))
    mount(<StartTimeSettings store={store} />)
    expect(text(root)).toContain('Sol 5074, 09:00:00 LMST')
    expect(text(root)).not.toContain(copy.start.daylight)
  })
  it('sun site = the active pad, else the official one', () => {
    const pads = [{ id: 'official', official: true, lat: 1, lon: 2 }, { id: 'rank2', official: false, lat: 3, lon: 4 }] as never
    expect(sunSiteFor('rank2', pads)).toEqual({ lat: 3, lon: 4 })
    expect(sunSiteFor('rank9', pads)).toEqual({ lat: 1, lon: 2 })
    expect(sunSiteFor('rank2', [])).toBeNull()
  })
})

describe('storm switch', () => {
  it('is a labelled role=switch reflecting the store, and toggles setStorm', () => {
    const store = createPlanningStore()
    mount(<StormSettings store={store} />)
    const sw = one(byRole(root, 'switch'))
    expect(text(sw)).toContain(copy.storm.replace('{date}', STORM_REPLAY_DATE))
    expect(sw.getAttribute('aria-checked')).toBe(String(store.state.peek().route.storm))
    const before = store.state.peek().route.storm
    fire(sw, 'click')
    expect(store.state.peek().route.storm).toBe(!before)
    expect(one(byRole(root, 'switch')).getAttribute('aria-checked')).toBe(String(!before))
    expect(text(root)).toContain(!before ? copy.stormOn : copy.stormOff)
    fire(one(byRole(root, 'switch')), 'click')
    expect(store.state.peek().route.storm).toBe(before)
  })
  it('D143: storm off/on changes only the user route’s storm, never the official plan’s inputs or numbers', async () => {
    restore()
    const svc = createMockPadService()
    restore = setPadService(svc)
    const store = createPlanningStore({ initial: { route: { stops: [], startUtc: null, storm: true } } })
    const officialEnv = await svc.loadPadEnv('official')
    const officialProducts = await officialEnv.planProducts()
    const calls = svc.calls.length
    const officialState = () => ({
      storm: mission.conditions.storm.peek(),
      tauDoseMin: mission.conditions.tauDoseMin.peek(),
      tDarkMin: mission.conditions.tDarkMin.peek(),
      doseAllowMgy: mission.budgets.doseAllowMgy.peek(),
      scenario: mission.plan.scenario.peek(),
      pad: mission.plan.pad.peek(),
      uniforms: fieldUniforms.peek(),
    })
    const before = officialState()
    const docBefore = store.doc.peek()
    mount(<StormSettings store={store} />)
    fire(one(byRole(root, 'switch')), 'click') // off
    expect(store.state.peek().route.storm).toBe(false)
    // the official plan (Plan view's mission state, the pad's precomputed products) is untouched
    expect(officialState()).toEqual(before)
    expect(svc.calls.length).toBe(calls)
    expect(svc.peekPadEnv('official')).toBe(officialEnv)
    expect(await officialEnv.planProducts()).toEqual(officialProducts)
    // the doc differs only in route.storm (pad, stops, start, boundary unchanged)
    const docAfter = store.doc.peek()
    expect({ ...docAfter, route: { ...docAfter.route, storm: true } }).toEqual(docBefore)
    fire(one(byRole(root, 'switch')), 'click') // on again
    expect(store.doc.peek()).toEqual(docBefore)
    expect(officialState()).toEqual(before)
  })
  it('label names the replayed storm (D143)', () => {
    mount(<StormSettings store={createPlanningStore()} />)
    expect(text(one(byRole(root, 'switch')))).toContain('Include solar storm replay (20 May 2024) in the margin')
  })
  it('shows the store value when the store says on', () => {
    const store = createPlanningStore({ initial: { route: { stops: [], startUtc: null, storm: true } } })
    mount(<StormSettings store={store} />)
    expect(one(byRole(root, 'switch')).getAttribute('aria-checked')).toBe('true')
    expect(text(root)).toContain(copy.stormOn)
  })
})

const fc = (props: Record<string, unknown>[]) => ({ type: 'FeatureCollection', features: props.map((p) => ({ type: 'Feature', geometry: null, properties: p })) }) as never

describe('boundary list (Mission tab ids and order)', () => {
  const bands = fc([{ budget: 60, variant: 'nominal' }, { budget: 30, variant: 'optimistic' }, { budget: 30, variant: 'nominal' }, { budget: 30, variant: 'nominal' }])
  const edges = fc([{ budget: 30, cause: 'slope' }, { budget: 30, cause: 'o2' }])
  const iso = { features: [{ properties: { minutes: 4 } }, { properties: { minutes: 2 } }] }

  it('same ids and order as mission/plan.ts boundaryOptions', () => {
    expect(boundaryOptions(bands, edges, iso).map((o) => o.id)).toEqual(['none', 'band:30:nominal', 'band:30:optimistic', 'band:60:nominal', 'edges:30', 'iso:2', 'iso:4'])
    expect(boundaryOptions(bands, edges).map((o) => o.label)).toEqual(['No boundary', '30-min walk home, nominal', '30-min walk home, optimistic', '60-min walk home, nominal', '30-min edge, coloured by cause'])
    expect(boundaryOptions(null, null).map((o) => o.id)).toEqual(['none'])
  })
  it('value mapping: undefined/unknown = none, none = undefined', () => {
    const o = boundaryOptions(bands, edges)
    expect(boundaryValue(o, undefined)).toBe('none')
    expect(boundaryValue(o, 'iso:9')).toBe('none')
    expect(boundaryValue(o, 'edges:30')).toBe('edges:30')
    expect(boundaryFromValue('none')).toBeUndefined()
    expect(boundaryFromValue('band:30:nominal')).toBe('band:30:nominal')
  })
  it('select -> setBoundary; back to none -> undefined', () => {
    const store = createPlanningStore()
    mount(<BoundarySettings store={store} options={boundaryOptions(bands, edges)} />)
    const sel = one(byTag(root, 'select'))
    expect(all(root, (n) => n.localName === 'label' && n.getAttribute('for') === sel.getAttribute('id'))).toHaveLength(1)
    expect(byTag(root, 'option').map((n) => n.getAttribute('value'))).toEqual(['none', 'band:30:nominal', 'band:30:optimistic', 'band:60:nominal', 'edges:30'])
    fire(sel, 'change', 'band:60:nominal')
    expect(store.state.peek().route.boundary).toBe('band:60:nominal')
    fire(sel, 'change', 'none')
    expect(store.state.peek().route.boundary).toBeUndefined()
  })
  it('loads the active pad’s bands and edges from the pad service', async () => {
    restore()
    const products = (): PlanProducts => ({ bands, edges, partner: null, route: null, timeline: null })
    restore = setPadService(createMockPadService({ products }))
    const store = createPlanningStore()
    mount(<BoundarySettings store={store} />)
    await flush()
    expect(byTag(root, 'option').map((n) => n.getAttribute('value'))).toEqual(['none', 'band:30:nominal', 'band:30:optimistic', 'band:60:nominal', 'edges:30'])
  })
  it('renders nothing when the pad has no boundaries (or the pad service fails)', async () => {
    mount(<BoundarySettings store={createPlanningStore()} />)
    await flush()
    expect(byTag(root, 'select')).toHaveLength(0)
    restore()
    restore = setPadService(createMockPadService({ failing: ['official'] }))
    mount(<BoundarySettings store={createPlanningStore()} />)
    await flush()
    expect(byTag(root, 'select')).toHaveLength(0)
    expect(useBoundaryOptions).toBeTypeOf('function')
  })
})

describe('section + registration', () => {
  it('RouteSettings renders start and storm; register passes the section to U1', () => {
    mount(<RouteSettings store={createPlanningStore()} />)
    expect(byRole(root, 'switch')).toHaveLength(1)
    expect(text(root)).toContain(copy.start.title)
    const got: [string, unknown][] = []
    register((name, c) => void got.push([name, c]))
    expect(got).toEqual([['settings', RouteSettings]])
  })
  it('install() fills U1’s settings region; unregister empties it', () => {
    resetRoutePanelSections()
    const Region = ({ store }: { store: PlanningStore }) => {
      const C = useRoutePanelSection('settings')
      return C ? <C store={store} /> : null
    }
    const off = install()
    mount(<Region store={createPlanningStore()} />)
    expect(byRole(root, 'switch')).toHaveLength(1)
    act(() => off())
    expect(byRole(root, 'switch')).toHaveLength(0)
    resetRoutePanelSections()
  })
})

describe('copy (route.settings in ui/copy.json)', () => {
  it('storm label = D143 wording (date via placeholder: copy holds no digits)', () => {
    expect(copy.storm).toBe('Include solar storm replay ({date}) in the margin')
  })
})
