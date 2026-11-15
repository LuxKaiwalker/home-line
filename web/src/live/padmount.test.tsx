// L3c (team lead 17:02, mount only): with the Edit-route drawer mounted (console map, live build, route
// editing on), mountPadTool renders the pad tool (PadToolPanel, "Live pad") into the drawer's collapsed
// "Custom pad" section through setEditRoutePad, next to the crew section; the live panel element stays
// empty. Without a drawer host, the pad tool and the crew panel stay in the panel element, as before.
// Cleanup removes the section.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOfficialParts } from '../state/official'
import { ui } from '../state/ui'
import { bindLayoutStorage, resetLayout } from '../ui/layout'
import { mountEditRoute, registerEditRoute, setEditRouteCrew, setEditRoutePad, CUSTOM_PAD_ID, CUSTOM_PAD_TITLE } from '../ui/shell/editroute'
import { all, byClass, installDom, one, type FakeDocument, type FakeNode } from '../ui/testing/dom'
import { createApiClient } from './client'
import type { LiveState } from './health'
import type { MapPort } from './mapPort'
import { HEALTH_WARM } from './mock/fixtures'
import { createMockFetch } from './mock/fetch'
import { mountPadTool } from './padmount'

const READY: LiveState = { kind: 'ready', health: HEALTH_WARM }

let doc: FakeDocument
let panel: FakeNode
let mapEl: FakeNode
let offs: (() => void)[] = []
const byId = (id: string) => all(doc.body, (n) => n.getAttribute('id') === id)
const openerOf = (id: string) => all(doc.body, (n) => n.localName === 'button' && n.getAttribute('aria-controls') === `hl-lay-${id}`)

const port: MapPort = {
  onClick: () => () => {},
  setLivePad() {},
  setScenarioData: async () => {},
  setRoute: async () => {},
  restoreStatic() {},
}

function host() {
  const plans = { store: { list: () => null, rename: () => ({ ok: true as const }), remove: () => ({ ok: true as const }) }, View: () => null }
  act(() => {
    offs.push(mountEditRoute(mapEl as unknown as Element, plans, { enabled: true }))
    offs.push(registerEditRoute({ render: () => <p class="fake-route">route panel</p> }))
  })
}

function padTool() {
  const fetch = createMockFetch()
  vi.stubGlobal('fetch', fetch)
  const client = createApiClient({ base: 'http://api.test', fetch })
  let m: ReturnType<typeof mountPadTool> | undefined
  act(() => void (m = mountPadTool(panel as unknown as Element, port, { client, onLiveState: (fn) => (fn(READY), () => {}) })))
  return m!
}

beforeEach(() => {
  ;({ document: doc, container: panel } = installDom())
  mapEl = doc.createElement('div')
  doc.body.appendChild(mapEl)
  bindLayoutStorage(() => null)
  resetLayout()
  resetOfficialParts()
  ui.reducedMotion.value = false
})
afterEach(() => {
  act(() => {
    for (const f of offs.reverse()) f()
    setEditRouteCrew(undefined)
    setEditRoutePad(undefined)
  })
  offs = []
  render(null, mapEl as unknown as Element)
  resetOfficialParts()
  vi.unstubAllGlobals()
})

describe('L3c: the pad tool in the Edit-route drawer', () => {
  it('with a drawer host: "Custom pad" section (collapsed) holds the pad tool; the panel element stays empty', () => {
    host()
    const m = padTool()
    const btn = one(openerOf(CUSTOM_PAD_ID), 'Custom pad section button')
    expect(btn.textContent).toContain(CUSTOM_PAD_TITLE)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    const drawer = one(byId('hl-lay-edit-route'), 'drawer')
    expect(drawer.contains(btn)).toBe(true)
    const body = one(byId(`hl-lay-${CUSTOM_PAD_ID}`), 'Custom pad body')
    expect(one(byClass(body, 'live-pad'), 'pad tool').getAttribute('aria-label')).toBe('Live pad tool')
    expect(byClass(panel, 'live-pad')).toHaveLength(0)
    // crew stays its own section in the same drawer (L3)
    expect(drawer.contains(one(openerOf('crew'), 'crew section button'))).toBe(true)
    expect(panel.childNodes.length).toBe(0)
    act(() => m.cleanup())
    expect(openerOf(CUSTOM_PAD_ID)).toHaveLength(0)
  })

  it('the section follows the pad tool state (redrawn on change)', () => {
    host()
    const m = padTool()
    const body = () => one(byId(`hl-lay-${CUSTOM_PAD_ID}`))
    expect(byClass(body(), 'live-pad-pos')).toHaveLength(0)
    act(() => m.tool.click({ lon: 137.4, lat: -4.75 }))
    expect(byClass(body(), 'live-pad-pos')).toHaveLength(1)
    act(() => m.cleanup())
  })

  it('without a drawer host: the pad tool and the crew panel stay in the panel element; no section', () => {
    const m = padTool()
    expect(byClass(panel, 'live-pad')).toHaveLength(1)
    expect(openerOf(CUSTOM_PAD_ID)).toHaveLength(0)
    act(() => m.cleanup())
    expect(byClass(panel, 'live-pad')).toHaveLength(0)
  })
})
