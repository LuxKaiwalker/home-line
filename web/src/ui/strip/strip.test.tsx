// PORT P3 known answers for the rendered context bar and drawer summary (fake DOM, ui/testing/dom.ts):
//  - one group with an accessible name; pad, what is shown, scenario + budget chips (openers of the
//    console sections the snapshot reveals: aria-controls hl-lay-scenario / hl-lay-budget);
//  - no reach number in the bar; the official route's margin as a manifest-backed number;
//  - your route: "Your route · n stops · margin m min Estimate · Fast route"; unreachable stop named;
//  - "Plan a route" only with a handler and only on the official plan;
//  - drawer summary: reach numbers (manifest keys) before the fallback route line;
//  - installStrip fills both slots and unregisters them.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MOCK_PADS } from '../../pads/mock'
import { createPlanningStore } from '../../state/planning'
import type { StripProps } from '../../views/planStrip'
import { SECTION_NAMES, SectionsCtx, type SectionName, type Sections } from '../../views/planSlots'
import { PlanSlot } from '../../views/planPortSlots'
import { resetLayout } from '../layout'
import { all, byClass, installDom, type FakeDocument, type FakeNode } from '../testing/dom'
import { ContextLine } from './ContextBar'
import { t } from '../copy'
import { DrawerSummary } from './DrawerSummary'
import { installStrip } from './index'
import { shownFor } from './model'
import { MOCK_ROUTE_RESULTS } from './routeResults'

let doc: FakeDocument
let root: FakeNode

beforeEach(() => {
  ;({ document: doc, container: root } = installDom())
  Object.defineProperty(Object.getPrototypeOf(root), 'isConnected', { configurable: true, get: () => true })
  resetLayout()
})
afterEach(() => act(() => render(null, root as unknown as Element)))

const strip: StripProps = {
  h30: { v: 23, k: 'reachable_pct.nom_104.30', file: 'scenarios/index.json', budget: 30 },
  h60: { budget: 60, reachablePct: 31.5, range: null, inDataPct: 75.8, inData: true },
  sid: 'nom_104',
  pad: null,
  route: { timeline: [{ t_min: 40, event: 'arrive', station: 'S4', margin_min: 41.21, margin_binding: 'o2' }] as never, file: 'timeline_nom_104.json', key: 'timeline.nom_104' },
  scenarioText: 'nominal · 104 kg',
  budget: 30,
}

function fakeSections(): Sections {
  const panel = doc.createElement('div')
  const stash = doc.createElement('div')
  const el = {} as Record<SectionName, FakeNode>
  for (const n of SECTION_NAMES) {
    el[n] = doc.createElement('div')
    stash.appendChild(el[n])
  }
  return { el, stash, panel, claimed: new Set<SectionName>(['summary', 'scenario', 'budget']) } as unknown as Sections
}

const draw = (vnode: preact.VNode) => act(() => render(vnode, root as unknown as Element))
const text = () => root.textContent.replace(/\s+/g, ' ')
const attr = (n: FakeNode, a: string) => n.getAttribute(a)
const buttons = () => all(root, (n) => n.localName === 'button')

describe('ContextLine', () => {
  it('official pad: one named group, Official plan, backed margin, chips; no reach number', () => {
    const sections = fakeSections()
    draw(
      <SectionsCtx.Provider value={sections}>
        <ContextLine strip={strip} padId={null} pads={MOCK_PADS} shown={{ kind: 'official' }} sections={sections} onPlanRoute={null} />
      </SectionsCtx.Provider>,
    )
    const group = byClass(root, 'hl-ctx')
    expect(group).toHaveLength(1)
    expect(attr(group[0], 'role')).toBe('group')
    expect(attr(group[0], 'aria-label')).toBe(t('route.strip.label'))
    const s = text()
    expect(s).toContain(t('route.strip.officialPad'))
    expect(s).toContain(t('route.strip.officialPlan'))
    expect(s).not.toContain('%')
    const nums = byClass(root, 'num')
    expect(nums).toHaveLength(1)
    expect(nums[0].textContent).toContain('41.21')
    // a11y (I5): the margin's reason is text for screen readers too, not only a hover title
    const margin = byClass(root, 'hl-ctx__margin')[0]
    const why = byClass(margin, 'hl-ctx__sr')
    expect(why).toHaveLength(1)
    expect(why[0].textContent).toBe(attr(margin, 'title'))
    expect(why[0].textContent!.startsWith(`${t('route.strip.marginTitle')}: `)).toBe(true)
    expect(why[0].textContent!.length).toBeGreaterThan(t('route.strip.marginTitle').length + 2)
    const chips = buttons().filter((b) => (attr(b, 'class') ?? '').includes('hl-ctx__chip'))
    expect(chips.map((b) => attr(b, 'aria-controls'))).toEqual(['hl-lay-scenario', 'hl-lay-budget'])
    expect(chips.map((b) => attr(b, 'aria-label'))).toEqual([`${t('route.strip.scenario')}: nominal · 104 kg`, `${t('route.strip.budget')}: ${t('route.strip.budgetValue', { budget: 30 })}`])
    expect(chips.every((b) => attr(b, 'aria-expanded') === 'false')).toBe(true)
    // no Plan a route without a handler
    expect(byClass(root, 'hl-ctx__plan')).toHaveLength(0)
  })

  it('your route: stops, margin estimate, fast route label; Plan a route hidden', () => {
    const shown = shownFor(4, { ...MOCK_ROUTE_RESULTS, firstInfeasibleLeg: null, marginMin: 41.4 }, 'rank2')
    draw(<ContextLine strip={strip} padId="rank2" pads={MOCK_PADS} shown={{ ...shown, kind: 'mine', computing: false, marginMin: 41, fast: true } as never} sections={null} onPlanRoute={() => {}} />)
    const s = text()
    expect(s).toContain(t('route.strip.pad', { pad: 'P2' }))
    expect(s).toContain(t('route.strip.yourRoute'))
    expect(s).toContain(t('route.strip.stops', { n: 4 }))
    expect(s).toContain(t('route.strip.marginValue', { value: 41 }))
    expect(s).toContain(t('route.strip.estimate'))
    expect(s).toContain(t('route.strip.fast'))
    expect(attr(byClass(root, 'hl-ctx__fast')[0], 'title')).toBe('Fast route · may not be the fastest')
    expect(byClass(root, 'hl-ctx__plan')).toHaveLength(0)
  })

  it('names the unreachable stop or the way home', () => {
    draw(<ContextLine strip={strip} padId={null} pads={[]} shown={shownFor(3, MOCK_ROUTE_RESULTS, 'official')} sections={null} onPlanRoute={null} />)
    expect(text()).toContain(t('route.strip.unreachable', { n: 3 }))
    draw(<ContextLine strip={strip} padId={null} pads={[]} shown={shownFor(2, MOCK_ROUTE_RESULTS, 'official')} sections={null} onPlanRoute={null} />)
    expect(text()).toContain(t('route.strip.unreachableHome'))
  })

  it('your route: an "Edit route" button reopens the Route panel (share link, or after closing it)', () => {
    let n = 0
    const shown = shownFor(4, { ...MOCK_ROUTE_RESULTS, firstInfeasibleLeg: null, marginMin: 41.4 }, 'rank2')
    draw(<ContextLine strip={strip} padId="rank2" pads={MOCK_PADS} shown={{ ...shown, kind: 'mine', computing: false, marginMin: 41, fast: false } as never} sections={null} onPlanRoute={() => n++} />)
    expect(byClass(root, 'hl-ctx__plan')).toHaveLength(0)
    const b = byClass(root, 'hl-ctx__edit')
    expect(b).toHaveLength(1)
    expect(attr(b[0], 'aria-label')).toBe(t('route.strip.editRoute'))
    act(() => void b[0].dispatch('click'))
    expect(n).toBe(1)
    draw(<ContextLine strip={strip} padId="rank2" pads={MOCK_PADS} shown={{ ...shown, kind: 'mine', computing: false, marginMin: 41, fast: false } as never} sections={null} onPlanRoute={null} />)
    expect(byClass(root, 'hl-ctx__edit')).toHaveLength(0)
  })

  it('Plan a route calls the handler (named button)', () => {
    let n = 0
    draw(<ContextLine strip={strip} padId={null} pads={[]} shown={{ kind: 'official' }} sections={null} onPlanRoute={() => n++} />)
    const b = byClass(root, 'hl-ctx__plan')
    expect(b).toHaveLength(1)
    expect(attr(b[0], 'aria-label')).toBe(t('route.strip.planRoute'))
    act(() => void b[0].dispatch('click'))
    expect(n).toBe(1)
  })
})

describe('DrawerSummary', () => {
  it('reach numbers (manifest keys) before the fallback route line', () => {
    draw(<DrawerSummary strip={strip} store={createPlanningStore()} fallback={<span class="route-line">Pad → S4</span>} />)
    const nums = byClass(root, 'num').map((n) => n.textContent)
    expect(nums).toHaveLength(2)
    expect(nums[0]).toContain('23')
    expect(nums[1]).toContain('31.5')
    expect(text()).toContain(t('route.strip.summary.reach', { budget: 30 }))
    expect(text()).toContain('Pad → S4')
    expect(text()).not.toMatch(/Loading[^…]{0,80}…/)
  })
  it('without console values only the fallback', () => {
    draw(<DrawerSummary strip={null} store={createPlanningStore()} fallback={<span>route</span>} />)
    expect(byClass(root, 'num')).toHaveLength(0)
    expect(text()).toBe('route')
  })
})

describe('installStrip', () => {
  it('fills both slots, fallbacks come back on unregister', () => {
    const cmap = {} as never
    const off = installStrip()
    draw(<PlanSlot name="drawer-summary" cmap={cmap} fallback={<span class="fb">fallback summary</span>} />)
    expect(byClass(root, 'hl-dsum')).toHaveLength(1)
    expect(text()).toContain('fallback summary')
    act(() => off())
    expect(byClass(root, 'hl-dsum')).toHaveLength(0)
    expect(text()).toBe('fallback summary')
  })
})
