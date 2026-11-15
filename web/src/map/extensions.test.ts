import { afterEach, describe, expect, it } from 'vitest'
import { installMapExtensions, registerEditHandlers, registerOverlay, registerPadEnvironment, registerRouteLayer, resetMapExtensions, type MapExtensionContext } from './extensions'
import { createMockPadService } from '../pads/mock'
import { OFFICIAL_PAD_ID } from '../pads'

function fakeCtx() {
  const handlers = new Map<string, (e: unknown) => void>()
  const canvas = { style: { cursor: '' } }
  const map = { on: (t: string, f: (e: unknown) => void) => handlers.set(t, f), off: (t: string) => handlers.delete(t), getCanvas: () => canvas }
  const ctx = { map, beforeId: () => undefined, marker: () => ({}), inShell: true } as unknown as MapExtensionContext
  const fire = (t: string, lng = 1, lat = 2) => handlers.get(t)?.({ lngLat: { lng, lat }, point: { x: 0, y: 0 }, originalEvent: { button: 0 } })
  return { ctx, fire, handlers }
}

afterEach(() => resetMapExtensions())

describe('map extensions', () => {
  it('installs early and late registrations, forwards the pad env, disposes', async () => {
    const log: string[] = []
    registerPadEnvironment({ id: 'p', install: () => () => log.push('pad-off'), setPadEnvironment: (e) => log.push(`env:${e?.info.id ?? 'null'}`) })
    const { ctx } = fakeCtx()
    const host = installMapExtensions(ctx)
    const env = await createMockPadService().loadPadEnv(OFFICIAL_PAD_ID)
    host.setPadEnvironment(env)
    const off = registerRouteLayer({ kind: 'mine', install: () => ({ setVisible: (on) => log.push(`mine:${on}`), destroy: () => log.push('mine-off') }) })
    host.routeLayer('mine')?.setVisible(false)
    off()
    expect(host.routeLayer('mine')).toBeUndefined()
    registerOverlay({ id: 'curiosity', titleKey: 'route.layers.curiosity.title', defaultOn: false, enabled: () => false, install: () => ({ setVisible: () => log.push('never'), destroy: () => {} }) })
    host.destroy()
    expect(log).toEqual([`env:${OFFICIAL_PAD_ID}`, 'mine:false', 'mine-off', 'pad-off'])
  })

  it('edit handlers: priority order, first consumer wins, drag lifecycle', () => {
    const log: string[] = []
    registerEditHandlers({ id: 'low', click: () => (log.push('low'), true) })
    registerEditHandlers({ id: 'high', priority: 1, click: () => (log.push('high'), false), dragStart: () => true, drag: (p) => log.push(`drag:${p.lon}`), dragEnd: () => log.push('end') })
    const { ctx, fire } = fakeCtx()
    const host = installMapExtensions(ctx)
    fire('click')
    fire('mousedown')
    fire('mousemove', 5)
    fire('mouseup')
    expect(log).toEqual(['high', 'low', 'drag:5', 'end'])
    host.destroy()
  })
})
