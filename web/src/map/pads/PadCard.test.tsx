// PORT P2 known answers for the pad card and the 'pad-layer' slot:
//  - the card lists 30/60-min reach (with range) and feasible EVAs through <Num> (stored values);
//  - "Plan from here" calls planning.setPad(id); the pad on the map says "Shown on the map" instead;
//    a pad without routing fields (pad_default) has no button and says why;
//  - loading / error states are said, never invented numbers;
//  - the slot follows planning.padId into cmap.setPadEnvironment and shows "Loading pad P2…" meanwhile.
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setPadService } from '../../pads'
import { createMockPadService, MOCK_PADS, mockPadInfo } from '../../pads/mock'
import { OFFICIAL_PAD_ID, type PadEnv } from '../../pads/types'
import { createPlanningStore } from '../../state/planning'
import { byClass, byTag, installDom, type FakeNode } from '../../ui/testing/dom'
import { isOpen, resetLayout } from '../../ui/layout'
import type { CardNumbers } from './numbers'
import { PadCardBody, PadLayerSlot } from './PadCard'
import { openPadCard, PAD_CARD_ID, padLayer } from './padLayer'

let root: FakeNode
const mount = (v: VNode): FakeNode => {
  act(() => render(v, root as unknown as Element))
  return root
}
let restore: (() => void) | null = null
beforeEach(() => {
  root = installDom().container
  resetLayout()
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  restore?.()
  restore = null
  padLayer.card.value = null
  padLayer.pads.value = []
  padLayer.shown.value = { id: OFFICIAL_PAD_ID, status: 'ready' }
})

const F = 'scenarios/pads/rank2/summary.json'
const NUMS: CardNumbers = {
  reach: [
    { budget: 30, value: { v: 12.5, k: 'pads.rank2.headline.30.reachable_pct', file: F }, range: [{ v: 10.1, k: 'pads.rank2.headline.30.range_pct.low', file: F }, { v: 14.2, k: 'pads.rank2.headline.30.range_pct.high', file: F }] },
    { budget: 60, value: { v: 40.25, k: 'pads.rank2.headline.60.reachable_pct', file: F }, range: null },
  ],
  feasible: { v: 7, k: 'pads.rank2.score', file: F },
}
const P2 = MOCK_PADS[1]

describe('pad card', () => {
  it('shows the stored numbers and "Plan from here" sets the pad', () => {
    const picked: string[] = []
    mount(<PadCardBody info={P2} load={{ state: 'ok', n: NUMS }} active={false} onPlan={() => picked.push(P2.id)} />)
    const nums = byClass(root, 'num').map((n) => n.textContent)
    expect(nums.join(' ')).toContain('12.5')
    expect(nums.join(' ')).toContain('10.1')
    expect(nums.join(' ')).toContain('14.2')
    expect(nums.join(' ')).toContain('40.25')
    expect(nums.join(' ')).toContain('7')
    expect(root.textContent).toContain('30-min reach')
    expect(root.textContent).toContain('Feasible EVAs')
    const btn = byClass(root, 'hl-padcard__plan')[0]
    expect(btn.textContent).toContain('Plan from here')
    act(() => void btn.dispatch('click'))
    expect(picked).toEqual(['rank2'])
  })

  it('active pad, pad without fields, loading and error say so', () => {
    mount(<PadCardBody info={P2} load={{ state: 'ok', n: NUMS }} active onPlan={() => {}} />)
    expect(byClass(root, 'hl-padcard__plan')).toEqual([])
    expect(root.textContent).toContain('Shown on the map')
    const noFields = { ...mockPadInfo('pad_default', 5, 137.4, -4.78), hasRoutingFields: false }
    mount(<PadCardBody info={noFields} load={{ state: 'none' }} active={false} onPlan={() => {}} />)
    expect(byClass(root, 'hl-padcard__plan')).toEqual([])
    expect(root.textContent).toContain('a route cannot start here')
    expect(root.textContent).toContain('No precomputed numbers')
    mount(<PadCardBody info={P2} load={{ state: 'loading' }} active={false} onPlan={() => {}} />)
    expect(root.textContent).toContain('Loading')
    expect(byClass(root, 'num')).toEqual([])
    mount(<PadCardBody info={P2} load={{ state: 'error' }} active={false} onPlan={() => {}} />)
    expect(root.textContent).toContain('could not be loaded')
  })
})

describe("'pad-layer' slot", () => {
  it('follows planning.padId into the map, shows the loading line, renders the open card', async () => {
    restore = setPadService(createMockPadService({ delayMs: 5 }))
    const store = createPlanningStore()
    const envs: (PadEnv | null)[] = []
    const map = { project: () => ({ x: 10, y: 10 }), on: () => {}, off: () => {}, getContainer: () => root as unknown as HTMLElement }
    const cmap = { map, setPadEnvironment: (e: PadEnv | null) => envs.push(e) }
    padLayer.pads.value = MOCK_PADS
    mount(<PadLayerSlot cmap={cmap} store={store} host={root as unknown as HTMLElement} />)
    expect(envs).toEqual([null])
    act(() => void store.setPad('rank2'))
    expect(byClass(root, 'hl-padstatus')[0]?.textContent).toBe('Loading pad P2…')
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(envs.map((e) => e?.info.id ?? null)).toEqual([null, 'rank2'])
    // the handler marks the env drawn (here by hand: no map handler in this test)
    act(() => void (padLayer.shown.value = { id: 'rank2', status: 'ready' }))
    expect(byClass(root, 'hl-padstatus')).toEqual([])

    act(() => openPadCard('rank3'))
    expect(isOpen(PAD_CARD_ID)).toBe(true)
    const card = byClass(root, 'hl-padcard')[0]
    expect(card.getAttribute('data-pad-card')).toBe('rank3')
    expect(byTag(root, 'h3').map((h) => h.textContent)).toContain('P3')
  })
})
