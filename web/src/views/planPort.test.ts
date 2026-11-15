import { describe, expect, it } from 'vitest'
import { createPlanningStore, encodeRouteParam } from '../state/planning'
import { registerOverlay, replacedOverlays, resetMapExtensions } from '../map/extensions'
import { syncedHash } from './planPort'

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

  it('an overlay with `replaces` hides the built-in one while registered', () => {
    const off = registerOverlay({ id: 'x', titleKey: 'route.layers.slope.title', defaultOn: false, replaces: 'slopeClass', install: () => ({ setVisible() {}, destroy() {} }) } as never)
    expect(replacedOverlays.peek().has('slopeClass')).toBe(true)
    off()
    expect(replacedOverlays.peek().has('slopeClass')).toBe(false)
    resetMapExtensions()
  })
})
