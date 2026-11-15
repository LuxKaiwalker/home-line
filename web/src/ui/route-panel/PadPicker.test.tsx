// PORT F9 known answers for the pad picker's map focus:
//  - a click on a pad: setPad (one undo step), the camera flies to the pad (close-up zoom, centred in the map
//    area the Route panel leaves free), the pad card opens with the button as opener;
//  - a click on the active pad flies and opens the card again (no setPad);
//  - arrow keys switch the pad without flying or opening the card;
//  - reduced motion: a jump (easeTo, duration 0) instead of a fly;
//  - a disabled pad (no walk-home fields) does nothing; without an installed map nothing flies or opens.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockPadService, MOCK_PADS } from '../../pads/mock'
import { setPadService, type PadInfo } from '../../pads'
import { createPlanningStore, type PlanningStore } from '../../state/planning'
import { ui } from '../../state/ui'
import { all, installDom, one, type FakeNode } from '../testing/dom'
import { bindLayoutStorage, isOpen, reportInset, resetLayout } from '../layout'
import { PAD_CARD_ID, padLayer } from '../../map/pads/padLayer'
import { PAD_FOCUS_ZOOM, padCamera } from '../../map/pads/focus'
import { PadPicker } from './PadPicker'

const opened = vi.hoisted(() => [] as { id: string; opener: unknown }[])
vi.mock('../../map/pads/padLayer', async (orig) => {
  const real = await orig<typeof import('../../map/pads/padLayer')>()
  return {
    ...real,
    openPadCard: (id: string, opener: HTMLElement | null) => {
      opened.push({ id, opener })
      real.openPadCard(id, opener) // the real layout-store open: the card's open state is checked below
    },
  }
})

let root: FakeNode
let restorePads: () => void
let store: PlanningStore
let map: { getZoom: () => number; getMaxZoom: () => number; flyTo: ReturnType<typeof vi.fn>; easeTo: ReturnType<typeof vi.fn> }

const attr = (a: string, v?: string) => all(root, (n) => n.hasAttribute(a) && (v === undefined || n.getAttribute(a) === v))
const pad = (id: string) => one(attr('data-pad', id), `pad ${id}`)
const click = (n: FakeNode) => act(() => void n.dispatch('click', {}))
const group = () => one(all(root, (n) => n.getAttribute('role') === 'radiogroup'), 'radiogroup')
const mount = () => act(() => render(<PadPicker store={store} />, root as unknown as Element))

beforeEach(() => {
  const { document: doc } = installDom()
  root = doc.createElement('div')
  doc.body.appendChild(root)
  bindLayoutStorage(() => null)
  resetLayout()
  const noFields = { ...MOCK_PADS[3], id: 'pad_default', label: 'Default', hasRoutingFields: false } as PadInfo
  restorePads = setPadService(createMockPadService({ pads: [...MOCK_PADS, noFields] }))
  store = createPlanningStore()
  opened.length = 0
  map = { getZoom: () => 15, getMaxZoom: () => 20, flyTo: vi.fn(), easeTo: vi.fn() }
  padLayer.map.value = map as never
  ui.reducedMotion.value = false
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  restorePads()
  padLayer.map.value = null
  reportInset('hl-f9-test', undefined)
  ui.reducedMotion.value = false
})

describe('PadPicker: click flies to the pad and opens its card', () => {
  it('a click calls setPad, flies the camera to the pad and opens the pad card', () => {
    mount()
    const p2 = MOCK_PADS.find((p) => p.id === 'rank2')!
    click(pad('rank2'))
    expect(store.state.peek().padId).toBe('rank2')
    expect(store.canUndo.peek()).toBe(true)
    expect(map.flyTo).toHaveBeenCalledTimes(1)
    const cam = map.flyTo.mock.calls[0][0]
    expect(cam.center).toEqual([p2.lon, p2.lat])
    expect(cam.zoom).toBe(PAD_FOCUS_ZOOM)
    expect(cam.duration).toBeGreaterThan(0)
    expect(map.easeTo).not.toHaveBeenCalled()
    expect(opened).toEqual([{ id: 'rank2', opener: expect.anything() }])
    // the active pad again: no new undo step, but the camera and the card come back
    store.undo()
    store.setPad('rank2')
    const undoable = store.canUndo.peek()
    click(pad('rank2'))
    expect(store.canUndo.peek()).toBe(undoable)
    expect(map.flyTo).toHaveBeenCalledTimes(2)
    expect(opened.map((o) => o.id)).toEqual(['rank2', 'rank2'])
  })

  it('the card stays open after the fly and through the pad switch (user 23:06)', () => {
    mount()
    click(pad('rank3'))
    expect(isOpen(PAD_CARD_ID)).toBe(true)
    expect(padLayer.card.peek()).toBe('rank3')
    // the fly's camera moves and the planning change that follows the switch do not close it
    act(() => void store.setPad('rank3'))
    expect(isOpen(PAD_CARD_ID)).toBe(true)
    // another pad from the picker: the same card follows it
    click(pad('rank4'))
    expect(isOpen(PAD_CARD_ID)).toBe(true)
    expect(padLayer.card.peek()).toBe('rank4')
    expect(store.state.peek().padId).toBe('rank4')
  })

  it('arrow keys switch the pad without flying or opening the card', () => {
    mount()
    act(() => void group().dispatch('keydown', { key: 'ArrowRight' }))
    expect(store.state.peek().padId).toBe('rank2')
    act(() => void group().dispatch('keydown', { key: 'ArrowRight' }))
    expect(store.state.peek().padId).toBe('rank3')
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(map.easeTo).not.toHaveBeenCalled()
    expect(opened).toHaveLength(0)
  })

  it('a disabled pad does nothing', () => {
    mount()
    const b = pad('pad_default')
    expect(b.hasAttribute('disabled')).toBe(true)
    click(b)
    expect(store.state.peek().padId).toBe('official')
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(opened).toHaveLength(0)
  })

  it('reduced motion jumps (easeTo, duration 0) instead of flying', () => {
    ui.reducedMotion.value = true
    mount()
    click(pad('rank3'))
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(map.easeTo).toHaveBeenCalledTimes(1)
    expect(map.easeTo.mock.calls[0][0].duration).toBe(0)
    expect(opened.map((o) => o.id)).toEqual(['rank3'])
  })

  it('without an installed map the click only switches the pad', () => {
    padLayer.map.value = null
    mount()
    click(pad('rank4'))
    expect(store.state.peek().padId).toBe('rank4')
    expect(opened).toHaveLength(0)
  })
})

describe('padCamera', () => {
  it('centres the pad in the map area the drawers leave free and never zooms out', () => {
    const p = { lon: 137.39, lat: -4.77 }
    expect(padCamera(p, 15, { right: 400, bottom: 120 })).toEqual({ center: [137.39, -4.77], zoom: PAD_FOCUS_ZOOM, offset: [-200, -60], duration: 0 })
    expect(padCamera(p, 18, { right: 0, bottom: 0 }).zoom).toBe(18)
    expect(padCamera(p, 15, { right: 0, bottom: 0 }, 16).zoom).toBe(16)
  })
})
