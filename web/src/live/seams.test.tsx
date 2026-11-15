// WP18 (design W-9, D111): the live layer reports through design's state seams (src/state, no
// src/live import there). T2: mountLive's health watch sets liveStatus (ready -> offline -> ready),
// and its cleanup sets 'off'. T9: the pad tool registers an "Official plan" part; with a pad result
// shown, returnToOfficial() calls tool.clear() and the part stops differing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDom, type FakeNode } from '../ui/testing/dom'
import { liveStatus } from '../state/live'
import { differsFromOfficial, resetOfficialParts, returnToOfficial } from '../state/official'
import { createApiClient } from './client'
import { CLIENT, HEALTH_TIMEOUT_MS } from './config'
import type { LiveState } from './health'
import { mountLive } from './index'
import type { MapPort } from './mapPort'
import { HEALTH_WARM } from './mock/fixtures'
import { createMockFetch } from './mock/fetch'
import { MOCK_PAD_VALID } from './mock/pads'
import { mountPadTool } from './padmount'
import type { LonLat } from './types'

/** Mock API whose /health can be made to hang (no answer -> offline after the 2 s timeout). */
function server() {
  const inner = createMockFetch({ health: HEALTH_WARM })
  const ctl = { hang: false }
  const fetch = (input: string, init: RequestInit = {}): Promise<Response> => {
    if (ctl.hang) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
    return inner(input, init)
  }
  return { ctl, client: createApiClient({ base: 'http://api.test', fetch }) }
}

describe('T2: mountLive publishes the health state to liveStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    liveStatus.value = 'off'
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ready -> offline -> ready follows the health poll; cleanup sets off', async () => {
    const s = server()
    vi.stubGlobal('document', { createElement: () => ({ dataset: {}, setAttribute() {}, remove() {} }) })
    const seen: string[] = []
    const off = liveStatus.subscribe((v) => seen.push(v))
    const cleanup = mountLive({ after: () => {} } as unknown as Element, s.client)
    expect(liveStatus.value).toBe('checking')
    await vi.advanceTimersByTimeAsync(0)
    expect(liveStatus.value).toBe('ready')

    s.ctl.hang = true
    await vi.advanceTimersByTimeAsync(CLIENT.healthPollMs + HEALTH_TIMEOUT_MS)
    expect(liveStatus.value).toBe('offline')

    s.ctl.hang = false
    await vi.advanceTimersByTimeAsync(CLIENT.healthPollMs)
    expect(liveStatus.value).toBe('ready')

    cleanup()
    expect(liveStatus.value).toBe('off')
    expect(seen.filter((v, i) => v !== seen[i - 1])).toEqual(['checking', 'ready', 'offline', 'ready', 'off'])
    off()
  })
})

describe('T9: the pad tool registers with the "Official plan" action', () => {
  const READY: LiveState = { kind: 'ready', health: HEALTH_WARM }
  let panel: FakeNode
  beforeEach(() => {
    vi.useRealTimers()
    resetOfficialParts()
    panel = installDom().container
  })
  afterEach(() => {
    resetOfficialParts()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function until(pred: () => boolean, ms = 3000) {
    const t0 = Date.now()
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting')
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  function mount() {
    const fetch = createMockFetch()
    vi.stubGlobal('fetch', fetch)
    let clickCb: ((p: LonLat) => void) | null = null
    const port: MapPort = {
      onClick: (cb) => ((clickCb = cb), () => (clickCb = null)),
      setLivePad() {},
      setScenarioData: async () => {},
      setRoute: async () => {},
      restoreStatic() {},
    }
    const client = createApiClient({ base: 'http://api.test', fetch })
    const ready = (fn: (s: LiveState) => void) => (fn(READY), () => {})
    const m = mountPadTool(panel as unknown as Element, port, { client, onLiveState: ready, crew: false })
    return { ...m, click: (p: LonLat) => clickCb?.(p) }
  }

  it('with a pad result shown, "Official plan" calls tool.clear() and the part stops differing', async () => {
    const m = mount()
    expect(differsFromOfficial.value).toBe(false)
    m.click(MOCK_PAD_VALID)
    expect(differsFromOfficial.value).toBe(true) // a clicked pad differs at once
    await until(() => m.tool.state.preview.kind === 'done')
    expect(differsFromOfficial.value).toBe(true)

    const clear = vi.spyOn(m.tool, 'clear')
    expect(returnToOfficial()).toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(m.tool.state.pad).toBeNull()
    expect(m.tool.state.plan.kind).toBe('idle')
    expect(differsFromOfficial.value).toBe(false) // op.set(false) after clearing
    expect(returnToOfficial()).toBe(false)
    expect(clear).toHaveBeenCalledTimes(1)
    m.cleanup()
  })

  it('cleanup disposes the part: a later "Official plan" no longer reaches the tool', async () => {
    const m = mount()
    m.click(MOCK_PAD_VALID)
    await until(() => m.tool.state.preview.kind === 'done')
    const clear = vi.spyOn(m.tool, 'clear')
    m.cleanup()
    expect(differsFromOfficial.value).toBe(false)
    returnToOfficial()
    expect(clear).not.toHaveBeenCalled()
  })
})
