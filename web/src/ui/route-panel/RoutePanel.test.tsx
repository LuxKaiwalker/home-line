// PORT U1 known answers for the Route panel shell:
//  - renders with the mock pad service, a test planning store and a fake scenarios index: header (title,
//    collapse, close), pad picker, Estimates card (empty-route hint, reach numbers), slot regions;
//  - openRoutePanel / closeRoutePanel / Esc: open state signal, focus into the drawer, back to the opener;
//  - collapse hides the cards (aria-expanded follows), opening again expands;
//  - a pad click calls setPad (one undo step) and starts the pad load; loading / error states show;
//  - estimates from §9 route results: "Estimate" labels, fast-route label, first infeasible leg, status;
//  - U2/U3/U4 regions render what registerRoutePanelSection registered (with the store), nothing otherwise;
//  - installRoutePanel fills the Plan view's 'route-panel' slot.
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScenarioEntry, ScenariosIndex } from '../../data/types'
import type { PadSummaryView } from '../../data/pads'
import { createMockPadService, MOCK_PADS, mockPadEnv } from '../../pads/mock'
import { setPadService, type PadInfo } from '../../pads'
import { createPlanningStore, type PlanningStore } from '../../state/planning'
import { PlanSlot } from '../../views/planPortSlots'
import type { ConsoleMap } from '../../map/consoleMap'
import { all, installDom, one, type FakeDocument, type FakeNode } from '../testing/dom'
import { bindLayoutStorage, installLayoutKeys, resetLayout } from '../layout'
import { legEnds, legsO2, marginTone } from './Estimates'
import { closeRoutePanel, isRoutePanelOpen, openRoutePanel, routePanelCollapsed, routePanelOpen, setRoutePanelCollapsed } from './panelState'
import { officialReach, padReach } from './Reach'
import { MOCK_ROUTE_RESULTS, publishRouteResults, resetRouteResults } from './results'
import { installRoutePanel, RoutePanel } from './RoutePanel'
import { registerRoutePanelSection, resetRoutePanelSections, type RoutePanelSectionProps } from './sections'

let doc: FakeDocument
let root: FakeNode
let restorePads: () => void
let svc: ReturnType<typeof createMockPadService>
let store: PlanningStore

const SCENARIO = {
  id: 'nom_104',
  variant: 'nominal',
  suit_kg: 104,
  headline: { budget_min: 30, reachable_pct: 23, range_pct: [20, 26] },
  headline_60: { budget_min: 60, reachable_pct: 51.5, range_pct: [48, 55], basis: 'assessed' },
} as unknown as ScenarioEntry
const INDEX = { dummy: false, default: 'nom_104', scenarios: [SCENARIO] } as ScenariosIndex
const loader = { scenarios: () => Promise.resolve(INDEX) }

const mount = (v: VNode): FakeNode => {
  act(() => render(v, root as unknown as Element))
  return root
}
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const fire = (n: FakeNode, type: string) => act(() => void n.dispatch(type, {}))
const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
const attr = (a: string, v?: string) => all(root, (n) => n.hasAttribute(a) && (v === undefined || n.getAttribute(a) === v))
const btn = (name: string) => one(all(root, (n) => n.localName === 'button' && (n.getAttribute('aria-label') === name || n.textContent.trim() === name)), `button "${name}"`)
const drawer = () => one(attr('id', 'hl-lay-route-panel'), 'drawer')
const hidden = (n: FakeNode) => n.hasAttribute('hidden') && n.getAttribute('hidden') !== 'false'

function fakeWin() {
  const ls = new Set<(e: unknown) => void>()
  return {
    addEventListener: (_k: string, f: (e: unknown) => void) => void ls.add(f),
    removeEventListener: (_k: string, f: (e: unknown) => void) => void ls.delete(f),
    key(key: string) {
      const e = { key, defaultPrevented: false, isComposing: false, preventDefault: () => void (e.defaultPrevented = true) }
      act(() => ls.forEach((f) => f(e)))
      return e
    },
  }
}

beforeEach(() => {
  ;({ document: doc } = installDom())
  root = doc.createElement('div')
  doc.body.appendChild(root)
  bindLayoutStorage(() => null)
  resetLayout()
  resetRoutePanelSections()
  setRoutePanelCollapsed(false)
  resetRouteResults()
  svc = createMockPadService()
  restorePads = setPadService(svc)
  store = createPlanningStore()
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  restorePads()
})

describe('Route panel: render with mocks', () => {
  it('shows the header, the pad picker, the empty-route hint and the official reach numbers', async () => {
    openRoutePanel()
    mount(<RoutePanel store={store} loader={loader} />)
    await flush()
    const d = drawer()
    expect(hidden(d)).toBe(false)
    expect(d.getAttribute('role')).toBe('dialog')
    expect(text(one(attr('id', d.getAttribute('aria-labelledby')!)))).toBe('Route')
    btn('Collapse the route panel')
    btn('Close')
    const radios = all(root, (n) => n.getAttribute('role') === 'radio')
    expect(radios.map(text)).toEqual(['Official pad', 'P2', 'P3', 'P4'])
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(one(all(root, (n) => n.getAttribute('role') === 'radiogroup')).getAttribute('aria-labelledby')).toBeTruthy()
    expect(text(one(attr('data-empty')))).toBe('Click the map or a station to add a stop')
    // reach numbers: the strip's values and keys (backed <Num>, unbacked here: no manifest in the test)
    const reach = text(one(attr('data-reach')))
    expect(reach).toContain('30-min reach')
    expect(reach).toContain('23')
    expect(reach).toContain('60-min reach')
    expect(reach).toContain('51.5')
    // closed: the reach numbers leave the DOM (the hidden drawer stays mounted)
    act(() => closeRoutePanel())
    expect(attr('data-reach')).toHaveLength(0)
    // no sub-package registered: no slot regions
    expect(attr('data-route-section')).toHaveLength(0)
  })

  it('officialReach / padReach use the headline strip keys and files', () => {
    expect(officialReach(SCENARIO)).toEqual([
      { budget: 30, v: 23, k: 'reachable_pct.nom_104.30', file: 'scenarios/index.json' },
      { budget: 60, v: 51.5, k: 'reachable_pct.nom_104.60', file: 'scenarios/index.json' },
    ])
    const info = MOCK_PADS[2] as PadInfo
    const summary = { id: 'rank3', headlines: [{ budget: 30, reachablePct: 12, range: null, inDataPct: null, inData: false }, { budget: 60, reachablePct: 30, range: null, inDataPct: null, inData: false }] } as unknown as PadSummaryView
    expect(padReach({ ...mockPadEnv(info), summary })).toEqual([
      { budget: 30, v: 12, k: 'pads.rank3.headline.30.reachable_pct', file: 'scenarios/pads/rank3/summary.json' },
      { budget: 60, v: 30, k: 'pads.rank3.headline.60.reachable_pct', file: 'scenarios/pads/rank3/summary.json' },
    ])
    expect(padReach(mockPadEnv(info))).toEqual([]) // no summary: nothing invented
  })
})

describe('Route panel: open, close, Esc, collapse', () => {
  it('openRoutePanel moves focus in; Esc and closeRoutePanel close it and focus returns to the opener', () => {
    const win = fakeWin()
    const off = installLayoutKeys(win)
    mount(
      <div>
        <button type="button">Plan a route</button>
        <RoutePanel store={store} loader={loader} />
      </div>,
    )
    expect(hidden(drawer())).toBe(true)
    expect(routePanelOpen.peek()).toBe(false)

    const opener = btn('Plan a route')
    opener.focus()
    act(() => openRoutePanel())
    expect(routePanelOpen.peek()).toBe(true)
    expect(isRoutePanelOpen()).toBe(true)
    expect(hidden(drawer())).toBe(false)
    expect(doc.activeElement?.getAttribute('aria-label')).toBe('Close')

    win.key('Escape')
    expect(routePanelOpen.peek()).toBe(false)
    expect(hidden(drawer())).toBe(true)
    expect(doc.activeElement).toBe(opener)

    act(() => openRoutePanel(opener as unknown as HTMLElement))
    expect(routePanelOpen.peek()).toBe(true)
    act(() => closeRoutePanel())
    expect(routePanelOpen.peek()).toBe(false)
    expect(doc.activeElement).toBe(opener)
    off()
  })

  it('open before the panel renders (P3 / station card call it first)', () => {
    openRoutePanel(null)
    mount(<RoutePanel store={store} loader={loader} />)
    expect(hidden(drawer())).toBe(false)
  })

  it('collapse hides the cards; opening again expands', () => {
    openRoutePanel()
    mount(<RoutePanel store={store} loader={loader} />)
    const body = one(attr('data-route-panel'))
    const c = btn('Collapse the route panel')
    expect(c.getAttribute('aria-expanded')).toBe('true')
    expect(c.getAttribute('aria-controls')).toBe(body.getAttribute('id'))
    fire(c, 'click')
    expect(routePanelCollapsed.peek()).toBe(true)
    expect(hidden(one(attr('data-route-panel')))).toBe(true)
    expect(drawer().getAttribute('class')).toContain('hl-rp--collapsed')
    const e = btn('Expand the route panel')
    expect(e.getAttribute('aria-expanded')).toBe('false')
    fire(e, 'click')
    expect(hidden(one(attr('data-route-panel')))).toBe(false)
    act(() => setRoutePanelCollapsed(true))
    act(() => openRoutePanel())
    expect(routePanelCollapsed.peek()).toBe(false)
  })
})

describe('Route panel: pad picker', () => {
  it('a pad click calls setPad (one undo step) and starts the load; the same pad again is a no-op', async () => {
    openRoutePanel()
    mount(<RoutePanel store={store} loader={loader} />)
    fire(one(attr('data-pad', 'rank3')), 'click')
    expect(store.state.peek().padId).toBe('rank3')
    expect(store.canUndo.peek()).toBe(true)
    expect(svc.calls).toContain('rank3')
    await flush()
    expect(one(attr('data-pad', 'rank3')).getAttribute('aria-checked')).toBe('true')
    const n = svc.calls.length
    fire(one(attr('data-pad', 'rank3')), 'click')
    expect(svc.calls.length).toBe(n)
    store.undo()
    await flush()
    expect(one(attr('data-pad', 'official')).getAttribute('aria-checked')).toBe('true')
  })

  it('shows "Loading pad …" while the pad loads, and the error when it fails', async () => {
    restorePads()
    svc = createMockPadService({ delayMs: 20, failing: ['rank4'] })
    restorePads = setPadService(svc)
    openRoutePanel()
    mount(<RoutePanel store={store} loader={loader} />)
    fire(one(attr('data-pad', 'rank2')), 'click')
    expect(text(one(attr('data-pad-loading')))).toBe('Loading pad P2…')
    await act(async () => void (await new Promise((r) => setTimeout(r, 40))))
    expect(attr('data-pad-loading')).toHaveLength(0)
    fire(one(attr('data-pad', 'rank4')), 'click')
    await act(async () => void (await new Promise((r) => setTimeout(r, 40))))
    expect(root.textContent).toContain('Pad P4 could not be loaded')
  })

  it('a pad without walk-home fields is shown but disabled with its reason', () => {
    restorePads()
    const noFields = { ...MOCK_PADS[3], id: 'pad_default', label: 'Default', hasRoutingFields: false } as PadInfo
    svc = createMockPadService({ pads: [...MOCK_PADS, noFields] })
    restorePads = setPadService(svc)
    openRoutePanel()
    mount(<RoutePanel store={store} loader={loader} />)
    const b = one(attr('data-pad', 'pad_default'))
    expect(b.hasAttribute('disabled')).toBe(true)
    expect(b.getAttribute('title')).toContain('No walk-home fields')
    fire(b, 'click')
    expect(store.state.peek().padId).toBe('official')
  })
})

describe('Route panel: estimates from the route results (§9)', () => {
  const withStops = () => {
    // R1's mock: pad → w1 → s3 → pad, the last leg over the budget
    store.addStop({ kind: 'point', lon: 137.396, lat: -4.772, id: 'w1' })
    store.addStop({ kind: 'station', station: 'S3', id: 's3' })
  }

  it('labels every number "Estimate", says "Fast route", and calls out the first infeasible leg', () => {
    withStops()
    publishRouteResults({ ...MOCK_ROUTE_RESULTS, totalMinutes: 41.25, marginMin: 12.5 })
    openRoutePanel()
    mount(<RoutePanel store={store} loader={loader} />)
    const est = one(attr('data-estimates'))
    expect(all(est, (n) => (n.getAttribute('class') ?? '').includes('hl-rp__estlabel')).map(text)).toEqual(['Estimate', 'Estimate', 'Estimate'])
    expect(text(est)).toContain('41.3 min')
    expect(text(est)).toContain('12.5 min')
    expect(text(one(attr('data-fast-route')))).toBe('Fast route · may not be the fastest')
    expect(text(one(attr('data-infeasible-leg', '2')))).toBe('Leg 3 (S3 → pad) cannot be walked: over the budget')
    expect(attr('data-empty')).toHaveLength(0)
  })

  it('shows computing / partial / error status and hides another pad’s numbers', () => {
    withStops()
    openRoutePanel()
    mount(<RoutePanel store={store} loader={loader} />)
    act(() => publishRouteResults({ ...MOCK_ROUTE_RESULTS, status: 'computing' }))
    expect(text(one(attr('data-status', 'computing')))).toBe('Computing the route…')
    act(() => publishRouteResults({ ...MOCK_ROUTE_RESULTS, status: 'partial', legs: MOCK_ROUTE_RESULTS.legs.slice(0, 1), firstInfeasibleLeg: null }))
    expect(text(one(attr('data-status', 'partial')))).toBe('1 of 3 legs in; the rest follow…')
    act(() => publishRouteResults({ ...MOCK_ROUTE_RESULTS, status: 'error', error: 'worker failed' }))
    expect(text(one(attr('data-status', 'error')))).toBe('The route could not be computed: worker failed')
    act(() => publishRouteResults({ ...MOCK_ROUTE_RESULTS, padId: 'rank2', totalMinutes: 99 }))
    expect(one(attr('data-status', 'computing'))).toBeTruthy()
    expect(text(one(attr('data-estimates')))).not.toContain('99')
    expect(attr('data-infeasible-leg')).toHaveLength(0)
  })

  it('pure helpers: O₂ only when every leg has it; margin tone; leg ends', () => {
    expect(legsO2(MOCK_ROUTE_RESULTS.legs)).toBeNull()
    expect(legsO2(MOCK_ROUTE_RESULTS.legs.slice(0, 2))).toBeCloseTo(23.1)
    expect(legsO2([])).toBeNull()
    expect(marginTone(null)).toBeNull()
    expect(marginTone(-1)).toBe('limit')
    expect(marginTone(1e6)).toBe('safe')
    withStops()
    const stops = store.state.peek().route.stops
    expect(legEnds(MOCK_ROUTE_RESULTS.legs[0], stops)).toEqual({ from: 'pad', to: 'W1' })
  })
})

describe('Route panel: sub-package regions and the Plan slot', () => {
  it('renders what U2/U3/U4 registered, in order, with the store; unregister removes it', () => {
    const seen: PlanningStore[] = []
    const List = ({ store: s }: RoutePanelSectionProps) => (seen.push(s), <p>list here</p>)
    const offList = registerRoutePanelSection('list', List)
    registerRoutePanelSection('export', () => <p>export here</p>)
    registerRoutePanelSection('settings', () => <p>settings here</p>)
    openRoutePanel()
    mount(<RoutePanel store={store} loader={loader} />)
    const regions = attr('data-route-section')
    expect(regions.map((n) => n.getAttribute('data-route-section'))).toEqual(['list', 'settings', 'export'])
    expect(regions.map((n) => n.getAttribute('aria-label'))).toEqual(['Stops', 'EVA settings', 'Export and share'])
    expect(seen[0]).toBe(store)
    act(() => offList())
    expect(attr('data-route-section', 'list')).toHaveLength(0)
    expect(() => registerRoutePanelSection('nope' as 'list', List)).toThrow()
  })

  it('installRoutePanel fills the route-panel slot; uninstall empties it', () => {
    const cmap = {} as ConsoleMap
    mount(<PlanSlot name="route-panel" cmap={cmap} />)
    expect(attr('id', 'hl-lay-route-panel')).toHaveLength(0)
    let off = () => {}
    act(() => void (off = installRoutePanel()))
    expect(attr('id', 'hl-lay-route-panel')).toHaveLength(1)
    act(() => off())
    expect(attr('id', 'hl-lay-route-panel')).toHaveLength(0)
  })
})
