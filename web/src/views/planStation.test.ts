// L2d (D111) known answers for the Plan map cards' wiring (views/planStation.tsx wirePlanCards):
//  - a station selection opens the 'station' card for it; a map click reopens it; another kind closes it;
//  - closing the station card by hand clears the station selection (Esc did that in the sidebar);
//  - the rover strip opens the 'rover' card; closing it by hand = Discard (dismiss); Keep (strip gone)
//    closes it without a Discard;
//  - one card at a time: a station card opened during a draft closes the rover card without a Discard,
//    and the rover card comes back when the station card closes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { roverStrip, setRoverStrip } from '../state/roverCard'
import { resetSelection, select, selection } from '../state/selection'
import { closeContainer, isOpen, registerContainer, resetLayout } from '../ui/layout'
import { ROVER_CARD, STATION_CARD, wirePlanCards } from './planStation'

let off: () => void
let shown: string | null
let click: ((id: string) => void) | null
const strip = () => ({ render: () => null, lngLat: [0, 0] as [number, number], dismiss: vi.fn() })

beforeEach(() => {
  resetLayout()
  resetSelection()
  setRoverStrip(null)
  registerContainer({ id: STATION_CARD, kind: 'card' })
  registerContainer({ id: ROVER_CARD, kind: 'card' })
  shown = null
  click = null
  off = wirePlanCards(
    (id) => (shown = id),
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
    expect(v.props.title).toBe('Add this station to the route in the Mission Planer')
    expect(JSON.stringify(v.props.children)).toContain('Add to route')
    expect((v.props.children[0] as { props: { name: string } }).props.name).toBe('plus')
  })
})
