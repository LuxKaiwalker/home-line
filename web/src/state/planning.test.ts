import { describe, expect, it } from 'vitest'
import { createPlanningStore, decodeLegacyPlan, decodeRouteParam, encodeRouteParam, legacyRedirect, OFFICIAL_PAD_ID, parsePlanningHash, planningHref, planningUndoSource, subscribePlanning, toPlanRoute, type PlanningDoc } from './planning'
import { createSharedUndo } from '../edit/route/undo'
import { copyFrom } from '../ui/copy'
import type { PlanRoute as CorePlanRoute } from '../edit/route/model'

// PORT I3: mission/ is deleted; its v1 plan-link encoder (mission/share.ts encodePlan) restated verbatim for
// the legacy-link fixture (WAYPOINT_TAGS = PLAN_TAGS, stopMinutes = finite and > 0, else 0).
const LEGACY_TAGS = ['Sample', 'Drill', 'Photo', 'Survey', 'Install', 'Inspect', 'Repair', 'Rest']
function encodePlan(wps: { lon: number; lat: number; stopMin: number; tags: string[]; note: string; station?: string }[]): string {
  if (!wps.length) return ''
  const round6 = (v: number) => Math.round(v * 1e6) / 1e6
  const stopMinutes = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)
  const rows = wps.map((w) => {
    const mask = LEGACY_TAGS.reduce((m, t, i) => (w.tags.includes(t) ? m | (1 << i) : m), 0)
    const row: (number | string)[] = [round6(w.lon), round6(w.lat), stopMinutes(w.stopMin), mask, w.note]
    if (w.station) row.push(w.station)
    return row
  })
  let bin = ''
  for (const b of new TextEncoder().encode(JSON.stringify([1, rows]))) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const strip = (d: PlanningDoc) => ({ ...d, route: { ...d.route, stops: d.route.stops.map(({ id: _id, ...s }) => s) } })

describe('planning store actions', () => {
  it('each change is one undo step; no-ops make none', () => {
    const s = createPlanningStore()
    expect(s.addStop({ kind: 'station', station: 'st1' })).toBe(true)
    expect(s.addStop({ kind: 'station', station: 'st1' })).toBe(false) // no duplicate station
    s.addStop({ kind: 'point', lon: 137.4, lat: -4.78 })
    const id = s.state.peek().route.stops[1].id
    s.moveStop(id, { lon: 137.41, lat: -4.79 })
    s.updateStop(id, { note: 'drill', tags: ['Drill'], stopMin: 10 })
    s.reorderStops(1, 0)
    s.setPad('rank2')
    expect(s.setPad('rank2')).toBe(false)
    s.setStorm(true)
    s.setStartUtc('2026-01-01T10:00:00Z')
    s.setBoundary('b30')
    const st = s.state.peek()
    expect(st.padId).toBe('rank2')
    expect(st.route.stops.map((x) => x.kind)).toEqual(['point', 'station'])
    expect(st.route.stops[0]).toMatchObject({ lon: 137.41, lat: -4.79, note: 'drill', tags: ['Drill'], stopMin: 10 })
    for (let i = 0; i < 9; i++) expect(s.undo()).toBe(true)
    expect(s.undo()).toBe(false)
    expect(s.state.peek().route.stops).toEqual([])
    expect(s.state.peek().padId).toBe(OFFICIAL_PAD_ID)
    expect(s.redo()).toBe(true)
    expect(s.state.peek().route.stops).toHaveLength(1)
  })

  it('view toggles are not undo steps; removeStop and replaceRoute are', () => {
    const s = createPlanningStore()
    s.toggleView('showOfficial')
    expect(s.view.peek().showOfficial).toBe(false)
    expect(s.canUndo.peek()).toBe(false)
    s.addStop({ kind: 'station', station: 'a' })
    s.removeStop(s.state.peek().route.stops[0].id)
    s.replaceRoute({ stops: [], startUtc: null, storm: true })
    expect(s.canUndo.peek()).toBe(true)
    expect(s.state.peek().route.storm).toBe(true)
  })

  it('subscribePlanning fires on a selected change only', () => {
    const s = createPlanningStore()
    const seen: string[] = []
    const off = subscribePlanning((x) => x.padId, (v) => seen.push(v), s)
    s.toggleView('showMine')
    s.setPad('rank3')
    off()
    s.setPad('rank4')
    expect(seen).toEqual(['rank3'])
  })

  it('maps onto the route core shapes', () => {
    const s = createPlanningStore()
    const core: CorePlanRoute = toPlanRoute(s.state.peek().route) // the restated shape fits the core's
    expect(core).toEqual({ mode: 'auto', stops: [] })
    s.addStop({ kind: 'station', station: 'a' })
    s.addStop({ kind: 'point', lon: 1, lat: 2, name: 'Rock' })
    expect(toPlanRoute(s.state.peek().route)).toEqual({ mode: 'ordered', stops: [{ station: 'a' }, { lon: 1, lat: 2, label: 'Rock' }] })
  })

  it('plugs into the shared undo timeline (edit/route/undo.ts)', () => {
    const s = createPlanningStore()
    const u = createSharedUndo({ ctl: planningUndoSource(s), planKey: () => '', win: null })
    s.setPad('rank2')
    expect(u.canUndo.peek()).toBe(true)
    expect(u.undo()).toBe(true)
    expect(s.state.peek().padId).toBe(OFFICIAL_PAD_ID)
  })
})

describe('planning URL codec', () => {
  it('round-trips pad, stops, start, storm, boundary', () => {
    const s = createPlanningStore()
    s.setPad('rank3')
    s.addStop({ kind: 'station', station: 'st2', stopMin: 15, tags: ['Sample', 'Photo'], note: 'core', name: 'Ridge' })
    s.addStop({ kind: 'point', lon: 137.1234567, lat: -4.7654321, note: 'ünïcode' })
    s.setStorm(true)
    s.setStartUtc('2026-03-01T08:00:00Z')
    s.setBoundary('b60')
    const doc = s.doc.peek()
    const back = decodeRouteParam(encodeRouteParam(doc))!
    expect(strip(back)).toEqual(strip({ ...doc, route: { ...doc.route, stops: doc.route.stops.map((x) => (x.kind === 'point' ? { ...x, lon: 137.123457, lat: -4.765432 } : x)) } }))
  })

  it('default doc encodes to #/ and bad values decode to null', () => {
    expect(planningHref({ padId: OFFICIAL_PAD_ID, route: { stops: [], startUtc: null, storm: false } })).toBe('#/')
    expect(decodeRouteParam('not-base64!')).toBeNull()
    expect(decodeRouteParam('')).toMatchObject({ padId: OFFICIAL_PAD_ID })
    expect(parsePlanningHash('#/?route=garbage')).toMatchObject({ doc: null, invalid: true, legacy: false })
    expect(parsePlanningHash('#/fly/hud')).toBeNull()
  })

  it('reads legacy #/mission?plan= (mission/share.ts v1) and ?add=', () => {
    const v1 = encodePlan([
      { lon: 137.4, lat: -4.78, stopMin: 5, tags: ['Drill'], note: 'n' },
      { lon: 137.39, lat: -4.77, stopMin: 0, tags: [], note: '', station: 'st1' },
    ])
    const stops = decodeLegacyPlan(v1)!
    expect(stops.map((x) => x.kind)).toEqual(['point', 'station'])
    expect(stops[0]).toMatchObject({ lon: 137.4, lat: -4.78, stopMin: 5, tags: ['Drill'], note: 'n' })
    const link = parsePlanningHash(`#/mission?plan=${v1}&add=st9`)!
    expect(link.legacy).toBe(true)
    expect(link.add).toBe('st9')
    expect(link.canonical.startsWith('#/?route=')).toBe(true)
    expect(legacyRedirect('#/mission?add=st9')).toBe('#/?add=st9')
    expect(legacyRedirect('#/')).toBeNull()
  })
})

describe('copyFrom (package copy files)', () => {
  it('reads nested keys and fills placeholders', () => {
    const tt = copyFrom({ a: { b: 'Pad {pad}' } })
    expect(tt('a.b', { pad: 'P2' })).toBe('Pad P2')
    expect(() => tt('a.b')).toThrow()
  })
})
