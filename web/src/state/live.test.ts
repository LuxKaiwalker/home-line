// L7b: live-planner status seam (static views read it; the live layer sets it).
import { afterEach, describe, expect, it } from 'vitest'
import { isLiveStatus, listenLiveStatus, LIVE_STATUS_EVENT, liveStatus } from './live'

afterEach(() => void (liveStatus.value = 'off'))

describe('liveStatus seam', () => {
  it("defaults to 'off' (static build, or before the live layer reports)", () => {
    expect(liveStatus.peek()).toBe('off')
  })

  it('follows the window event; unknown details are ignored; dispose stops listening', () => {
    const t = new EventTarget()
    const off = listenLiveStatus(t)
    t.dispatchEvent(new CustomEvent(LIVE_STATUS_EVENT, { detail: 'ready' }))
    expect(liveStatus.peek()).toBe('ready')
    t.dispatchEvent(new CustomEvent(LIVE_STATUS_EVENT, { detail: 'bogus' }))
    expect(liveStatus.peek()).toBe('ready')
    t.dispatchEvent(new CustomEvent(LIVE_STATUS_EVENT, { detail: 'offline' }))
    expect(liveStatus.peek()).toBe('offline')
    off()
    t.dispatchEvent(new CustomEvent(LIVE_STATUS_EVENT, { detail: 'warming' }))
    expect(liveStatus.peek()).toBe('offline')
  })

  it('accepts exactly the LiveState kinds of src/live/health.ts plus off', () => {
    for (const k of ['off', 'checking', 'offline', 'warming', 'ready']) expect(isLiveStatus(k)).toBe(true)
    expect(isLiveStatus('up')).toBe(false)
    expect(isLiveStatus(undefined)).toBe(false)
  })
})
