// PORT I6: the route-core chunk fails to load → Plan keeps working, the Route panel says so.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../edit/route/browser/runner', () => {
  throw new Error('chunk load failed (test)')
})

import { createPlanningStore } from '../state/planning'
import { createMockPadService } from '../pads/mock'
import { setPadService } from '../pads'
import { installDom, all } from '../ui/testing/dom'
import { bindLayoutStorage, resetLayout } from '../ui/layout'
import { openRoutePanel, routeCoreUnavailable, setRouteCoreUnavailable } from '../ui/route-panel/panelState'
import { RoutePanel } from '../ui/route-panel/RoutePanel'
import { mountPlanPort } from './planPort'

describe('PORT I6: route-core load failure', () => {
  afterEach(() => setRouteCoreUnavailable(false))

  it('route core chunk failure: no throw, no unhandled rejection, Route panel shows "Route planning unavailable"', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => void unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const restorePads = setPadService(createMockPadService())
    const { document: doc } = installDom()
    const root = doc.createElement('div')
    doc.body.appendChild(root)
    bindLayoutStorage(() => null)
    resetLayout()
    vi.stubGlobal('location', { hash: '#/' })
    vi.stubGlobal('history', { state: null, replaceState: () => {} })
    const store = createPlanningStore()
    let stop: () => void = () => {}
    expect(() => (stop = mountPlanPort(store))).not.toThrow()
    for (let i = 0; i < 5 && !routeCoreUnavailable.peek(); i++) await new Promise((r) => setTimeout(r, 10))
    expect(routeCoreUnavailable.peek()).toBe(true)
    openRoutePanel()
    act(() => render(<RoutePanel store={store} loader={{ scenarios: () => new Promise(() => {}) }} />, root as unknown as Element))
    const msg = all(root, (n) => n.hasAttribute('data-route-unavailable'))
    expect(msg.map((n) => n.textContent.trim())).toEqual(['Route planning unavailable'])
    expect(() => stop()).not.toThrow()
    act(() => render(null, root as unknown as Element))
    await new Promise((r) => setTimeout(r, 10))
    process.off('unhandledRejection', onUnhandled)
    restorePads()
    warn.mockRestore()
    vi.unstubAllGlobals()
    expect(unhandled).toEqual([])
  })
})
