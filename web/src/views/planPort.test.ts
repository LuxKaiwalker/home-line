import { describe, expect, it } from 'vitest'
import { createPlanningStore, encodeRouteParam, OFFICIAL_PAD_ID } from '../state/planning'
import { registerOverlay, replacedOverlays, resetMapExtensions } from '../map/extensions'
import { applyRouteLink, syncedHash } from './planPort'

describe('PORT I1: planning state <-> address', () => {
  it('writes #/?route= for a non-default plan, #/ for the default, keeps other params, leaves other views alone', () => {
    const s = createPlanningStore()
    expect(syncedHash('#/', s.doc.peek())).toBe('#/')
    expect(syncedHash('', s.doc.peek())).toBe('#/')
    s.setPad('rank2')
    const v = encodeRouteParam(s.doc.peek())
    expect(syncedHash('#/', s.doc.peek())).toBe(`#/?route=${v}`)
    expect(syncedHash('#/?story=intro', s.doc.peek())).toBe(`#/?story=intro&route=${v}`)
    expect(syncedHash('#/trade', s.doc.peek())).toBeNull()
    expect(syncedHash('#/mission?plan=x', s.doc.peek())).toBeNull()
  })

  it('applies a #/?route= link once; the same link again keeps the undo history (Back from #/trade, D142)', () => {
    const src = createPlanningStore()
    src.setPad('rank3')
    src.addStop({ kind: 'station', station: 'S1' })
    const hash = syncedHash('#/', src.doc.peek())!
    const s = createPlanningStore()
    expect(applyRouteLink(hash, s)).toBe(true)
    expect(s.state.peek().padId).toBe('rank3')
    s.addStop({ kind: 'station', station: 'S2' })
    expect(applyRouteLink(syncedHash('#/', s.doc.peek())!, s)).toBe(false)
    expect(s.canUndo.peek()).toBe(true)
    expect(applyRouteLink('#/trade', s)).toBe(false)
    expect(applyRouteLink('#/', s)).toBe(false)
    expect(s.state.peek().padId).not.toBe(OFFICIAL_PAD_ID)
  })

  it('an overlay with `replaces` hides the built-in one while registered', () => {
    const off = registerOverlay({ id: 'x', titleKey: 'route.layers.slope.title', defaultOn: false, replaces: 'slopeClass', install: () => ({ setVisible() {}, destroy() {} }) } as never)
    expect(replacedOverlays.peek().has('slopeClass')).toBe(true)
    off()
    expect(replacedOverlays.peek().has('slopeClass')).toBe(false)
    resetMapExtensions()
  })
})
