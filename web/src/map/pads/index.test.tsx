// PORT P2: install() registers the pad-environment handler and fills the 'pad-layer' slot; dispose undoes both.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { installMapExtensions, resetMapExtensions, type MapExtensionContext } from '../extensions'
import { setPadService } from '../../pads'
import { createMockPadService } from '../../pads/mock'
import { PlanSlot } from '../../views/planPortSlots'
import type { ConsoleMap } from '../consoleMap'
import { installDom } from '../../ui/testing/dom'
import { fakeSwapMap } from './fakes'
import { install } from '.'

afterEach(() => resetMapExtensions())

describe('map/pads install', () => {
  it('registers the handler and the slot; dispose removes both', () => {
    const restore = setPadService(createMockPadService())
    const { container } = installDom()
    const off = install({ fadeMs: () => 0 })
    const f = fakeSwapMap()
    const placed: unknown[] = []
    const marker = () => {
      const m = { setLngLat: () => m, setOffset: () => m, addTo: () => (placed.push(m), m), remove: () => {} }
      return m
    }
    const host = installMapExtensions({ map: { ...f.map, on: () => {}, off: () => {}, getCanvas: () => ({ style: {} }) }, beforeId: () => undefined, marker, inShell: true } as unknown as MapExtensionContext)
    const envs: unknown[] = []
    const cmap = { map: { project: () => ({ x: 0, y: 0 }), on: () => {}, off: () => {}, getContainer: () => container }, setPadEnvironment: (e: unknown) => envs.push(e) } as unknown as ConsoleMap
    act(() => render(<PlanSlot name="pad-layer" cmap={cmap} />, container as unknown as Element))
    expect(envs).toEqual([null]) // the slot is live: it set the official pad
    off()
    act(() => render(<PlanSlot name="pad-layer" cmap={cmap} />, container as unknown as Element))
    act(() => render(null, container as unknown as Element))
    host.destroy()
    restore()
  })
})
