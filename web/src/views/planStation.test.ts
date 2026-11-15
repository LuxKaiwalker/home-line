// L2d (D111) known answers for the Plan map cards' wiring (views/planStation.tsx wirePlanCards):
//  - a station selection opens the 'station' card for it; a map click reopens it; another kind closes it;
//  - closing the station card by hand clears the station selection (Esc did that in the sidebar);
//  - the rover strip opens the 'rover' card; closing it by hand = Discard (dismiss); Keep (strip gone)
//    closes it without a Discard;
//  - one card at a time: a station card opened during a draft closes the rover card without a Discard,
//    and the rover card comes back when the station card closes.
// L2e: every other selection kind opens the 'selection' card (one card at a time with 'station');
//    closing it by hand clears the selection; with a draft open the strip sits on top of it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { roverStrip, setRoverStrip } from '../state/roverCard'
import { resetSelection, select, selection } from '../state/selection'
import { closeContainer, isOpen, registerContainer, resetLayout } from '../ui/layout'
import { ROVER_CARD, SELECTION_CARD, STATION_CARD, wirePlanCards } from './planStation'

let off: () => void
let shown: string | null
let click: ((id: string) => void) | null
const strip = () => ({ render: () => null, lngLat: [0, 0] as [number, number], dismiss: vi.fn() })

beforeEach(() => {
  resetLayout()
  resetSelection()
  setRoverStrip(null)
  registerContainer({ id: STATION_CARD, kind: 'card' })
  registerContainer({ id: SELECTION_CARD, kind: 'card' })
  registerContainer({ id: ROVER_CARD, kind: 'card' })
  shown = null
  click = null
  off = wirePlanCards(
    (r) => (shown = r.kind === 'station' ? r.id : r.kind),
    (fn) => (click = fn),
  )
})
afterEach(() => {
  off()
  setRoverStrip(null)
})

describe('station card', () => {
  it('opens on a station selection, reopens on a map click, closes on another kind', () => {
    expect(isOpen(STATION_CARD)).toBe(false)
    select({ kind: 'station', id: 'S7' }, 'search')
    expect(shown).toBe('S7')
    expect(isOpen(STATION_CARD)).toBe(true)
    closeContainer(STATION_CARD)
    expect(selection.selected.peek()).toBeNull() // closed by hand: the selection goes too
    select({ kind: 'station', id: 'S7' }, 'map')
    closeContainer(STATION_CARD)
    click!('S3') // the console's map click: select (no page) + this handler
    expect(shown).toBe('S3')
    expect(isOpen(STATION_CARD)).toBe(true)
    select({ kind: 'pad', id: 'pad' }, 'map')
    expect(isOpen(STATION_CARD)).toBe(false)
    expect(isOpen(SELECTION_CARD)).toBe(true) // L2e: the pad's card replaces it
    expect(shown).toBe('pad')
  })
})

describe('selection card (L2e)', () => {
  it('every kind opens it; one card at a time with the station card; × / Esc clears the selection', () => {
    for (const r of [
      { kind: 'pad', id: 'rank2' },
      { kind: 'landmark', code: 'GDV' },
      { kind: 'cell', lon: 137.4, lat: -4.6 },
      { kind: 'leg', leg: 2 },
      { kind: 'edge', cause: 'slope', budget: 30 },
    ] as const) {
      select(r, 'map')
      expect(shown).toBe(r.kind)
      expect(isOpen(SELECTION_CARD)).toBe(true)
      expect(isOpen(STATION_CARD)).toBe(false)
    }
    select({ kind: 'station', id: 'S7' }, 'map')
    expect(isOpen(STATION_CARD)).toBe(true)
    expect(isOpen(SELECTION_CARD)).toBe(false)
    expect(selection.selected.peek()).toEqual({ kind: 'station', id: 'S7' }) // the handover is no close by hand
    select({ kind: 'landmark', code: 'GDV' }, 'map')
    closeContainer(SELECTION_CARD)
    expect(selection.selected.peek()).toBeNull()
    expect(isOpen(SELECTION_CARD)).toBe(false)
  })

  it('a draft open: the strip sits on the selection card; closing it brings the rover card back, no discard', () => {
    const a = strip()
    setRoverStrip(a)
    select({ kind: 'pad', id: 'rank1' }, 'map')
    expect(isOpen(SELECTION_CARD)).toBe(true)
    expect(isOpen(ROVER_CARD)).toBe(false)
    closeContainer(SELECTION_CARD)
    expect(isOpen(ROVER_CARD)).toBe(true)
    expect(a.dismiss).not.toHaveBeenCalled()
  })
})

describe('rover card (delta strip)', () => {
  it('opens with the strip; closing it by hand discards; Keep closes it without a discard', () => {
    const a = strip()
    setRoverStrip(a)
    expect(isOpen(ROVER_CARD)).toBe(true)
    closeContainer(ROVER_CARD)
    expect(a.dismiss).toHaveBeenCalledTimes(1)
    const b = strip()
    setRoverStrip(b)
    expect(isOpen(ROVER_CARD)).toBe(true)
    setRoverStrip(null) // Keep: the draft is gone
    expect(isOpen(ROVER_CARD)).toBe(false)
    expect(b.dismiss).not.toHaveBeenCalled()
  })

  it('one card at a time: a station card takes over without a discard, the rover card comes back', () => {
    const a = strip()
    setRoverStrip(a)
    select({ kind: 'station', id: 'S7' }, 'map')
    expect(isOpen(STATION_CARD)).toBe(true)
    expect(isOpen(ROVER_CARD)).toBe(false)
    expect(a.dismiss).not.toHaveBeenCalled()
    closeContainer(STATION_CARD)
    expect(isOpen(ROVER_CARD)).toBe(true)
    expect(roverStrip.peek()).toBe(a)
    expect(a.dismiss).not.toHaveBeenCalled()
    closeContainer(ROVER_CARD) // the card that came back: closing it by hand still discards
    expect(a.dismiss).toHaveBeenCalledTimes(1)
  })
})

// J1d (team lead 2026-11-15 16:57): the station card's "Add to route" goes to #/mission?add=<id>.
describe('station card: Add to route', () => {
  it('links to the Mission Planer with ?add=<id>, plus icon, copy text', async () => {
    const { StationAddToRoute } = await import('./planStation')
    const v = StationAddToRoute({ id: 'S4' }) as unknown as { props: { href: string; title: string; children: unknown[] } }
    expect(v.props.href).toBe('#/mission?add=S4')
    expect(v.props.title).toBe('Add this station to your route (estimate)')
    expect(JSON.stringify(v.props.children)).toContain('Add to route')
    expect((v.props.children[0] as { props: { name: string } }).props.name).toBe('plus')
  })
})
