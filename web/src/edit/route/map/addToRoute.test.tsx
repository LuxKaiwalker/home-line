// PORT R3: station card "Add to route" and the ?add= link on the planning state.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { byTag, installDom } from '../../../ui/testing/dom'
import { createPlanningStore, encodeRouteParam, parsePlanningHash, OFFICIAL_PAD_ID, EMPTY_ROUTE } from '../../../state/planning'
import { ROUTE_LIMITS, type StationGeo } from '../model'
import { addStationToRoute, AddToRouteButton, applyAddParam } from './addToRoute'
import { createPlanEditor } from './planEdit'

const PAD = { lon: 137.4, lat: -4.78 }
const STATIONS: StationGeo[] = Array.from({ length: ROUTE_LIMITS.maxStops + 1 }, (_, i) => ({ id: `S${i + 1}`, name: `Station ${i + 1}`, lon: PAD.lon - 0.02 * (i + 1), lat: PAD.lat }))
const editor = () => createPlanEditor({ store: createPlanningStore(), pad: () => PAD, stations: () => STATIONS, noticeMs: 0 })

let unmount: (() => void) | null = null
afterEach(() => {
  unmount?.()
  unmount = null
})

describe('R3 add a station from its card', () => {
  it('the button appends the station (one undo step) and then says "In your route"', () => {
    const { container } = installDom()
    const ed = editor()
    const added: string[] = []
    act(() => render(<AddToRouteButton station="S3" editor={ed} onAdded={(s) => added.push(s)} />, container as never))
    unmount = () => render(null, container as never)
    const btn = byTag(container, 'button')[0]
    expect(btn.getAttribute('data-add-to-route')).toBe('S3')
    expect(btn.textContent).toContain('Add to route')
    act(() => void btn.dispatch('click'))
    expect(ed.store.doc.peek().route.stops).toMatchObject([{ kind: 'station', station: 'S3' }])
    expect(ed.store.canUndo.peek()).toBe(true)
    expect(added).toEqual(['S3'])
    expect(byTag(container, 'button')).toHaveLength(0)
    expect(container.textContent).toContain('In your route')
    expect(ed.notice.peek()?.text).toContain('Station 3')
  })

  it('refuses beyond the stop limit, twice, or an unknown station, with a notice', () => {
    const ed = editor()
    for (let i = 0; i < ROUTE_LIMITS.maxStops; i++) expect(addStationToRoute(STATIONS[i].id, ed)).toBe('added')
    expect(addStationToRoute(STATIONS[ROUTE_LIMITS.maxStops].id, ed)).toBe('tooManyStops')
    expect(ed.notice.peek()?.kind).toBe('refused')
    expect(addStationToRoute('S1', ed)).toBe('already')
    expect(addStationToRoute('S99', ed)).toBe('unknownStation')
    expect(addStationToRoute('<script>', ed)).toBe('invalid')
    expect(ed.store.doc.peek().route.stops).toHaveLength(ROUTE_LIMITS.maxStops)
  })
})

describe('R3 ?add=<station>', () => {
  it('applies parsePlanningHash().add on the Plan and the legacy Mission hash', () => {
    const ed = editor()
    expect(applyAddParam(parsePlanningHash('#/?add=S2'), ed)).toBe(true)
    expect(applyAddParam(parsePlanningHash('#/mission?add=S4'), ed)).toBe(true)
    expect(ed.store.doc.peek().route.stops.map((s) => (s.kind === 'station' ? s.station : '?'))).toEqual(['S2', 'S4'])
    expect(applyAddParam(parsePlanningHash('#/?add=S2'), ed)).toBe(false) // already there: no-op
    expect(applyAddParam(parsePlanningHash('#/'), ed)).toBe(false)
    expect(applyAddParam(parsePlanningHash('#/station/S1'), ed)).toBe(false)
    expect(applyAddParam(null, ed)).toBe(false)
  })

  it('appends to the route a link loads (doc replaced first, then add)', () => {
    const ed = editor()
    const doc = { padId: OFFICIAL_PAD_ID, route: { ...EMPTY_ROUTE, stops: [{ id: 'x', kind: 'point' as const, lon: PAD.lon + 0.05, lat: PAD.lat, note: '', tags: [], stopMin: 0 }] } }
    const link = parsePlanningHash(`#/?route=${encodeRouteParam(doc)}&add=S1`)
    expect(link?.doc).not.toBeNull()
    ed.store.replace(link!.doc!)
    expect(applyAddParam(link, ed)).toBe(true)
    expect(ed.store.doc.peek().route.stops.map((s) => s.kind)).toEqual(['point', 'station'])
  })
})
