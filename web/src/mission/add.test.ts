// J1d (team lead 2026-11-15 16:57): "Add to route" -> #/mission?add=<id>; the tab appends the station
// (no duplicate, at most route.max_stops) to its route, the last plan of this page load when the link has none.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRoute } from '../router'
import { addRefusal, addToRouteHref, MAX_STOPS, rememberPad, rememberPlan, startPad, startPlan } from './add'

describe('Add to route', () => {
  it('links to #/mission?add=<id>, which the router reads back', () => {
    expect(addToRouteHref('S4')).toBe('#/mission?add=S4')
    expect(parseRoute(addToRouteHref('S4'))).toEqual({ name: 'mission', add: 'S4' })
  })

  it('at most config/backend.yaml route.max_stops stops; no duplicate', () => {
    const yaml = readFileSync(resolve(__dirname, '../../../config/backend.yaml'), 'utf8')
    expect(MAX_STOPS).toBe(Number(/^\s*max_stops:\s*(\d+)/m.exec(yaml)![1]))
    expect(addRefusal([], 'S1')).toBeNull()
    expect(addRefusal([{ station: 'S1' }, {}], 'S4')).toBeNull()
    expect(addRefusal([{ station: 'S1' }], 'S1')).toBe('S1 is already in the plan.')
    const full = Array.from({ length: MAX_STOPS }, () => ({}))
    expect(addRefusal(full, 'S4')).toMatch(/already has \d+ stops/)
    expect(addRefusal(full.slice(1), 'S4')).toBeNull()
  })

  it('a link without a plan adds to the tab\'s last plan of this page load; a link with a plan keeps its own', () => {
    rememberPlan('')
    expect(startPlan({ add: 'S4' })).toBeUndefined()
    rememberPlan('abc')
    expect(startPlan({ add: 'S4' })).toBe('abc')
    expect(startPlan({ plan: 'xyz', add: 'S4' })).toBe('xyz')
    expect(startPlan({})).toBeUndefined()
    // the pad goes with that plan (a hashchange re-mounts the tab)
    rememberPad('rank3')
    expect(startPad({ add: 'S4' })).toBe('rank3')
    expect(startPad({ plan: 'xyz', add: 'S4' })).toBeNull()
    expect(startPad({})).toBeNull()
    rememberPlan('')
    expect(startPad({ add: 'S4' })).toBeNull()
    rememberPad(null)
  })
})
