import { describe, expect, it } from 'vitest'
import { href, NAV_ITEMS, parseRoute } from './router'

describe('hash router (SPEC F17 routes; mount slots for WS7/8/9)', () => {
  it.each([
    ['', { name: 'console' }],
    ['#/', { name: 'console' }],
    ['#/station/S1', { name: 'station', id: 'S1' }],
    ['#/trade', { name: 'trade' }],
    ['#/conditions', { name: 'conditions' }],
    ['#/scorecard', { name: 'scorecard' }],
    ['#/scorecard?key=rad.baseline_uGy_day', { name: 'scorecard', key: 'rad.baseline_uGy_day' }],
    ['#/cuff', { name: 'cuff' }],
    ['#/about', { name: 'about' }],
    ['#/hud', { name: 'hud' }],
    ['#/mission', { name: 'mission' }],
    ['#/hud3d', { name: 'hud3d' }],
    ['#/nav', { name: 'nav' }],
    ['#/nope', { name: 'notfound', path: '/nope' }],
    ['#/station', { name: 'notfound', path: '/station' }],
  ])('%s', (hash, want) => expect(parseRoute(hash)).toEqual(want))

  it('href round-trips', () => {
    for (const r of [{ name: 'station', id: 'S 4' } as const, { name: 'scorecard', key: 'a.b' } as const, { name: 'trade' } as const]) {
      expect(parseRoute(href(r))).toEqual(r)
    }
  })

  it('the nav lists every page and slot', () => {
    expect(NAV_ITEMS.map((n) => n.route.name)).toEqual(['console', 'mission', 'trade', 'conditions', 'cuff', 'hud', 'hud3d', 'nav', 'scorecard', 'about'])
  })
})
