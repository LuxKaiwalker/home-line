// L7a (D111): in the flythrough, hover does nothing that affects playback; only an explicit input
// (pointer press, wheel, touch, key) stops it (DESIGN §3.4). Unit test on startFlythrough (fly.ts):
// the 3D flight in software GL is too slow for real pointer moves in CI (hover-replay.spec.ts keeps the
// Plan and Fly checks on the built app).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./route', () => ({ loadFlightPath: () => Promise.resolve({ plan: { tEnd: 1e6 }, poseAt: () => ({}) }) }))
vi.mock('./camera', () => ({ jumpToPose: () => undefined }))
vi.mock('../terrain/state', () => ({ setView: () => undefined, exaggeration: () => 1 }))

const { startFlythrough } = await import('./fly')
const { missionClock } = await import('../../state')

const ev = (type: string, init: Record<string, unknown> = {}) => Object.assign(new Event(type), init)

describe('L7a: the flythrough survives hover', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const g = globalThis as Record<string, unknown>
    g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16)
    g.cancelAnimationFrame = (id: number) => clearTimeout(id)
    missionClock.pause()
    missionClock.seek(0)
  })
  afterEach(() => {
    missionClock.pause()
    missionClock.seek(0)
    vi.useRealTimers()
  })

  async function fly() {
    const el = new EventTarget()
    const onEnd = vi.fn()
    const flight = await startFlythrough({ getContainer: () => el } as never, onEnd)
    expect(flight).not.toBeNull()
    expect(missionClock.playing).toBe(true)
    vi.advanceTimersByTime(500)
    return { el, onEnd, flight: flight! }
  }

  it('pointer moves over the map leave it flying, the clock advancing', async () => {
    const { el, onEnd, flight } = await fly()
    let last = missionClock.t
    expect(last).toBeGreaterThan(0)
    for (let i = 0; i < 30; i++) {
      for (const type of ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mousemove', 'pointerout', 'mouseout']) el.dispatchEvent(ev(type, { clientX: i, clientY: i }))
      vi.advanceTimersByTime(100)
      expect(missionClock.playing).toBe(true)
      expect(missionClock.t).toBeGreaterThan(last)
      last = missionClock.t
    }
    expect(onEnd).not.toHaveBeenCalled()
    flight.stop()
  })

  it('an explicit key or press stops it, as designed', async () => {
    for (const type of ['keydown', 'pointerdown', 'wheel']) {
      const { el, onEnd } = await fly()
      el.dispatchEvent(ev(type, { key: 'Escape', button: 0 }))
      expect(onEnd).toHaveBeenCalledOnce()
      expect(missionClock.playing).toBe(false)
      const t = missionClock.t
      vi.advanceTimersByTime(500)
      expect(missionClock.t).toBe(t)
    }
  })
})
