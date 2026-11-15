// PORT U4: share link round trip and the Plan link redirects (#/mission?plan=, ?add=, #/?route=, invalid).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlanningStore, decodeRouteParam, EMPTY_ROUTE, encodeRouteParam, makeStop, OFFICIAL_PAD_ID, parsePlanningHash, planningHref, type PlanningDoc, type PlanStop } from '../../../state/planning'
import { applyPlanLink, clearPlanLinkNotice, planLinkNotice, resolvePlanLink, type PlanLinkIO, type PlanLinkNotice } from './planLink'
import { copyText, shareUrl } from './share'

/** mission/share.ts v1 encoder (the old Mission Planer link format), restated for the fixture. */
function encodeV1(rows: unknown[]): string {
  const json = JSON.stringify([1, rows])
  let bin = ''
  for (const b of new TextEncoder().encode(json)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const io = () => {
  const hashes: string[] = []
  const notices: PlanLinkNotice[] = []
  const v: PlanLinkIO & { hashes: string[]; notices: PlanLinkNotice[] } = { hashes, notices, replaceHash: (h) => void hashes.push(h), notify: (n) => void notices.push(n) }
  return v
}
const stripIds = (stops: readonly PlanStop[]) => stops.map(({ id: _id, ...s }) => s)
const sample = (): PlanningDoc => ({
  padId: 'rank3',
  route: {
    ...EMPTY_ROUTE,
    stops: [makeStop({ kind: 'station', station: 'S4', note: 'core sample', tags: ['Sample', 'Photo'], stopMin: 25 }), makeStop({ kind: 'point', lon: 137.391234, lat: -4.775678, name: 'Ridge', stopMin: 5 })],
    startUtc: '2026-11-16T15:00:00Z',
    storm: true,
    boundary: 'b60',
  },
})

afterEach(() => clearPlanLinkNotice())

describe('share link', () => {
  it('round trip: the copied URL loads the same pad + route (new stop ids)', () => {
    const doc = sample()
    const url = shareUrl(doc, { origin: 'https://example.org', pathname: '/home-line/', search: '' })
    expect(url.startsWith('https://example.org/home-line/#/?route=')).toBe(true)
    const hash = url.slice(url.indexOf('#'))
    expect(hash).toBe(planningHref(doc))
    const store = createPlanningStore()
    expect(applyPlanLink(hash, store, io())).toBe('loaded')
    const got = store.doc.peek()
    expect(got.padId).toBe('rank3')
    expect(stripIds(got.route.stops)).toEqual(stripIds(doc.route.stops))
    expect(got.route.startUtc).toBe(doc.route.startUtc)
    expect(got.route.storm).toBe(true)
    expect(got.route.boundary).toBe('b60')
    expect(encodeRouteParam(got)).toBe(encodeRouteParam(doc))
  })

  it('the default plan shares as #/', () => {
    expect(shareUrl({ padId: OFFICIAL_PAD_ID, route: EMPTY_ROUTE }, null)).toBe('#/')
  })

  it('copy: clipboard -> copied; none or refused -> select (the link is shown selected)', async () => {
    const writeText = vi.fn(async () => {})
    expect(await copyText('x', { writeText })).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('x')
    expect(await copyText('x', null)).toBe('select')
    expect(await copyText('x', { writeText: async () => Promise.reject(new Error('denied')) })).toBe('select')
  })
})

describe('resolvePlanLink', () => {
  it('other views and a bare #/ ask nothing', () => {
    for (const h of ['#/station/S1', '#/trade', '#/fly/hud', '#/', '', '#/evidence/scorecard?key=k']) expect(resolvePlanLink(h)).toEqual({ kind: 'none' })
  })
  it('legacy #/mission?plan=… -> redirect to #/?route=… (official pad, same stops)', () => {
    const v1 = encodeV1([
      [137.4, -4.78, 10, 1, 'look', null],
      [137.39, -4.77, 30, 0, '', 'S4'],
    ])
    const r = resolvePlanLink(`#/mission?plan=${v1}`)
    expect(r.kind).toBe('redirect')
    if (r.kind !== 'redirect') return
    expect(r.invalid).toBe(false)
    expect(r.to.startsWith('#/?route=')).toBe(true)
    const doc = parsePlanningHash(r.to)!.doc!
    expect(doc.padId).toBe(OFFICIAL_PAD_ID)
    expect(stripIds(doc.route.stops)).toEqual([
      { kind: 'point', lon: 137.4, lat: -4.78, stopMin: 10, tags: ['Sample'], note: 'look' },
      { kind: 'station', station: 'S4', stopMin: 30, tags: [], note: '' },
    ])
  })
  it('legacy plan + add, and add alone', () => {
    const v1 = encodeV1([[137.4, -4.78, 10, 0, '', null]])
    const r = resolvePlanLink(`#/mission?plan=${v1}&add=S6`)
    expect(r.kind === 'redirect' && /^#\/\?route=[^&]+&add=S6$/.test(r.to)).toBe(true)
    expect(resolvePlanLink('#/mission?add=S2')).toEqual({ kind: 'redirect', to: '#/?add=S2', invalid: false })
    expect(resolvePlanLink('#/mission')).toEqual({ kind: 'redirect', to: '#/', invalid: false })
  })
  it('unreadable links are invalid, never a throw', () => {
    expect(resolvePlanLink('#/?route=%%%not-base64')).toEqual({ kind: 'invalid' })
    expect(resolvePlanLink('#/?route=WzMsIngiXQ')).toEqual({ kind: 'invalid' }) // [3,"x"]: wrong version
    expect(resolvePlanLink('#/mission?plan=garbage!!')).toMatchObject({ kind: 'redirect', invalid: true })
  })
})

describe('applyPlanLink', () => {
  it('#/?route=… replaces the plan without an undo step (history cleared)', () => {
    const store = createPlanningStore()
    store.addStop({ kind: 'station', station: 'S1' })
    expect(store.canUndo.peek()).toBe(true)
    const o = io()
    expect(applyPlanLink(planningHref(sample()), store, o)).toBe('loaded')
    expect(store.doc.peek().padId).toBe('rank3')
    expect(store.canUndo.peek()).toBe(false)
    expect(o.hashes).toEqual([]) // a plain share link stays in the address
  })

  it('the address already shows the plan on screen: nothing replaced, undo history kept', () => {
    const store = createPlanningStore()
    store.addStop({ kind: 'station', station: 'S1' })
    expect(applyPlanLink(planningHref(store.doc.peek()), store, io())).toBe('loaded')
    expect(store.canUndo.peek()).toBe(true)
  })

  it('legacy #/mission?plan=…&add=S6: redirected, loaded with S6 appended, canonical hash without add', () => {
    const v1 = encodeV1([[137.4, -4.78, 10, 0, 'a', null]])
    const store = createPlanningStore()
    const o = io()
    expect(applyPlanLink(`#/mission?plan=${v1}&add=S6`, store, o)).toBe('loaded')
    const stops = store.doc.peek().route.stops
    expect(stops.map((s) => (s.kind === 'station' ? s.station : 'pt'))).toEqual(['pt', 'S6'])
    expect(store.canUndo.peek()).toBe(false)
    expect(o.hashes.at(-1)).toBe(planningHref(store.doc.peek()))
    expect(o.hashes.at(-1)).not.toMatch(/add=/)
  })

  it('#/mission?add=S2 adds S2 to the plan on screen as one undo step; the hash drops add', () => {
    const store = createPlanningStore()
    store.replace({ padId: 'rank2', route: { ...EMPTY_ROUTE, stops: [makeStop({ kind: 'station', station: 'S1' })] } })
    const o = io()
    expect(applyPlanLink('#/mission?add=S2', store, o)).toBe('added')
    expect(store.doc.peek().padId).toBe('rank2')
    expect(store.doc.peek().route.stops.map((s) => (s.kind === 'station' ? s.station : ''))).toEqual(['S1', 'S2'])
    expect(store.canUndo.peek()).toBe(true)
    expect(o.hashes).toEqual(['#/?add=S2', planningHref(store.doc.peek())])
    // a reload of the canonical hash adds nothing more
    applyPlanLink(o.hashes.at(-1)!, store, io())
    expect(store.doc.peek().route.stops).toHaveLength(2)
  })

  it('an invalid link: a notice, the plan unchanged, the address back to the plan on screen', () => {
    const store = createPlanningStore()
    store.addStop({ kind: 'station', station: 'S4' })
    const before = store.doc.peek()
    const o = io()
    expect(() => applyPlanLink('#/?route=%%%', store, o)).not.toThrow()
    expect(applyPlanLink('#/?route=WzMsIngiXQ', store, o)).toBe('invalid')
    expect(store.doc.peek()).toBe(before)
    expect(o.notices.at(-1)?.kind).toBe('error')
    expect(o.notices.at(-1)?.text).toMatch(/could not be read/)
    expect(o.hashes.at(-1)).toBe(planningHref(before))
    expect(applyPlanLink('#/mission?plan=garbage!!', store, o)).toBe('invalid')
    expect(store.doc.peek()).toBe(before)
  })

  it('the default IO publishes the notice signal', () => {
    const store = createPlanningStore()
    expect(applyPlanLink('#/station/S1', store)).toBe('none')
    expect(planLinkNotice.peek()).toBeNull()
    applyPlanLink('#/?route=WzMsIngiXQ', store)
    expect(planLinkNotice.peek()?.kind).toBe('error')
    clearPlanLinkNotice()
    expect(planLinkNotice.peek()).toBeNull()
  })

  it('decodeRouteParam of the canonical hash equals the loaded plan (no drift)', () => {
    const store = createPlanningStore()
    applyPlanLink(planningHref(sample()), store, io())
    const again = decodeRouteParam(encodeRouteParam(store.doc.peek()))!
    expect(encodeRouteParam(again)).toBe(encodeRouteParam(sample()))
  })
})
