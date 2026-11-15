// PORT U4: export target from the bridge's detection (mocked): never blocks, Download until MARVIS answers.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarvisTarget, type MarvisDeps } from './marvis'

const deps = (p: Partial<MarvisDeps>): MarvisDeps => ({ detect: async () => false, inViewer: () => false, send: async () => ({ ok: true }), ...p })
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => vi.useRealTimers())

describe('createMarvisTarget', () => {
  it('MARVIS not reachable (published site): Download, settled once the probe says no', async () => {
    const t = createMarvisTarget(deps({ detect: async () => false }))
    expect(t.target.peek()).toBe('download')
    await flush()
    expect(t.target.peek()).toBe('download')
    expect(t.settled.peek()).toBe(true)
    t.dispose()
  })

  it('MARVIS answers on the loopback address: Download first (never blocks), then Send to MARVIS', async () => {
    let answer!: (v: boolean) => void
    const t = createMarvisTarget(deps({ detect: () => new Promise((r) => (answer = r)) }))
    expect(t.target.peek()).toBe('download')
    expect(t.settled.peek()).toBe(false)
    answer(true)
    await flush()
    expect(t.target.peek()).toBe('api')
    expect(t.settled.peek()).toBe(true)
    t.dispose()
  })

  it("inside MARVIS's planner window: Send to MARVIS at once (the window catches the download)", () => {
    const t = createMarvisTarget(deps({ inViewer: () => true, detect: () => new Promise(() => {}) }))
    expect(t.target.peek()).toBe('viewer')
    t.dispose()
  })

  it('a slow probe: settled after the short timeout, still Download; a late yes still upgrades', async () => {
    vi.useFakeTimers()
    let answer!: (v: boolean) => void
    const t = createMarvisTarget(deps({ detect: () => new Promise((r) => (answer = r)) }), 1500)
    vi.advanceTimersByTime(1500)
    expect(t.settled.peek()).toBe(true)
    expect(t.target.peek()).toBe('download')
    answer(true)
    await vi.runAllTimersAsync()
    expect(t.target.peek()).toBe('api')
    t.dispose()
  })

  it('a throwing or rejecting probe is a no (Download)', async () => {
    const a = createMarvisTarget(deps({ detect: () => Promise.reject(new Error('x')) }))
    const b = createMarvisTarget(
      deps({
        detect: () => {
          throw new Error('sync')
        },
      }),
    )
    await flush()
    expect(a.target.peek()).toBe('download')
    expect(b.target.peek()).toBe('download')
    a.dispose()
    b.dispose()
  })

  it('after dispose a late answer changes nothing', async () => {
    let answer!: (v: boolean) => void
    const t = createMarvisTarget(deps({ detect: () => new Promise((r) => (answer = r)) }))
    t.dispose()
    answer(true)
    await flush()
    expect(t.target.peek()).toBe('download')
  })
})
