// L3 (D111) known answers for the Edit-route host (mount only):
//  - D116: with route editing off (VITE_ROUTE_EDIT=0) nothing is mounted: no button, no drawer;
//  - the "Edit route" button and the drawer exist only while the route panel is registered (live
//    controls on); unregistering (offline) removes both and leaves the empty edge slot;
//  - the drawer holds the route panel, the crew Collapsible ("Crew: default", hint "Edit") and the
//    "My plans" Collapsible with the list rendered by the passed view, on the passed store;
//  - layout store ids: edit-route, crew, my-plans (DOM ids hl-lay-<id>, openers aria-controls them).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ui } from '../../state/ui'
import { t } from '../copy'
import { bindLayoutStorage, resetLayout } from '../layout'
import { all, byClass, installDom, one, type FakeDocument, type FakeNode } from '../testing/dom'
import { editRouteHosted, mountEditRoute, registerEditRoute, registerEditRouteNote, setEditRouteCrew, type MyPlansDeps } from './editroute'

let doc: FakeDocument
let mapEl: FakeNode
const byId = (id: string) => all(doc.body, (n) => n.getAttribute('id') === id)
const openerOf = (id: string) => all(doc.body, (n) => n.localName === 'button' && n.getAttribute('aria-controls') === `hl-lay-${id}`)
const click = (n: FakeNode) => act(() => void n.dispatch('click'))
const hidden = (n: FakeNode) => n.hasAttribute('hidden') && n.getAttribute('hidden') !== 'false'

interface Snap {
  titles: string[]
}
function fakePlans(): MyPlansDeps<Snap> & { titles: string[] } {
  const titles = ['Plan A']
  return {
    titles,
    store: {
      list: () => ({ titles: [...titles] }),
      rename: (_id, title) => (title.trim() ? ((titles[0] = title), { ok: true }) : { ok: false, error: 'empty title' }),
      remove: () => (titles.splice(0, 1), { ok: true }),
    },
    View: ({ snap, error, onRename, onRemove }) => (
      <div class="fake-plans">
        <p class="fake-plans__list">{snap.titles.join(',')}</p>
        {error && <p class="fake-plans__error">{error}</p>}
        <button type="button" class="fake-plans__rename" onClick={() => onRename('a', 'Plan B')} />
        <button type="button" class="fake-plans__bad" onClick={() => onRename('a', ' ')} />
        <button type="button" class="fake-plans__remove" onClick={() => onRemove('a')} />
      </div>
    ),
  }
}

let offs: (() => void)[] = []
const mount = (o: { enabled: boolean; simMode?: 'off' | 'official' | 'all' } = { enabled: true }) => {
  let off = () => {}
  act(() => void (off = mountEditRoute(mapEl as unknown as Element, fakePlans(), o)))
  offs.push(off)
  return off
}
const registerRoute = () => {
  let off = () => {}
  act(() => void (off = registerEditRoute({ render: () => <p class="fake-route">route panel</p> })))
  offs.push(off)
  return off
}

beforeEach(() => {
  ;({ document: doc } = installDom())
  mapEl = doc.createElement('div')
  doc.body.appendChild(mapEl)
  bindLayoutStorage(() => null)
  resetLayout()
  ui.reducedMotion.value = false
})
afterEach(() => {
  act(() => {
    for (const f of offs.reverse()) f()
    setEditRouteCrew(undefined)
  })
  offs = []
  render(null, mapEl as unknown as Element)
})

describe('VITE_ROUTE_EDIT (D116): the Edit-route button and drawer are absent when route editing is off', () => {
  it('the gate is live/config.ts ROUTE_EDIT_ENABLED (WP14), passed in by views/console.tsx', () => {
    // (this file may not import src/live/: isolation.test.ts; WP14's routeedit.test.tsx covers the parsing)
    const consoleSrc = readFileSync(resolve(__dirname, '../../views/console.tsx'), 'utf8')
    expect(consoleSrc).toContain('{ enabled: m.ROUTE_EDIT_ENABLED, simMode: m.SIM_EXPORT_MODE }')
  })

  it('enabled: false mounts nothing, even with the route panel registered', () => {
    mount({ enabled: false })
    registerRoute()
    expect(mapEl.childNodes.length).toBe(0)
    expect(editRouteHosted()).toBe(false)
    expect(openerOf('edit-route')).toHaveLength(0)
    expect(byId('hl-lay-edit-route')).toHaveLength(0)
  })
})

describe('Edit-route host (live builds, route editing on)', () => {
  it('no route panel registered (offline, checking): no button, no drawer, only the empty edge slot', () => {
    mount()
    expect(editRouteHosted()).toBe(true)
    expect(openerOf('edit-route')).toHaveLength(0)
    expect(byId('hl-lay-edit-route')).toHaveLength(0)
    const edge = one(byClass(mapEl, 'hl-editroute__edge'), 'edge slot')
    expect(edge.childNodes.length).toBe(0)
  })

  it('the offline note (WP12) takes the button\'s place while no route panel is registered', () => {
    mount()
    let offNote = () => {}
    act(() => void (offNote = registerEditRouteNote({ render: () => <p class="fake-note">Route editing needs the live planner</p> })))
    offs.push(offNote)
    const edge = one(byClass(mapEl, 'hl-editroute__edge'), 'edge slot')
    expect(byClass(edge, 'fake-note')).toHaveLength(1)
    expect(openerOf('edit-route')).toHaveLength(0)
    registerRoute()
    expect(byClass(mapEl, 'fake-note')).toHaveLength(0)
    expect(openerOf('edit-route')).toHaveLength(1)
  })

  it('route panel registered: "Edit route" opens the drawer with the panel, crew and My plans; unregister removes them', () => {
    mount()
    const off = registerRoute()
    const btn = one(openerOf('edit-route'), 'Edit route button')
    expect(btn.textContent).toContain('Edit route')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    const drawer = one(byId('hl-lay-edit-route'), 'drawer')
    expect(hidden(drawer)).toBe(true)
    click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(hidden(drawer)).toBe(false)
    expect(byClass(drawer, 'fake-route')).toHaveLength(1)
    // My plans: a Collapsible inside the drawer, the passed list inside its body
    const plansBtn = one(openerOf('my-plans'), 'My plans section button')
    expect(plansBtn.textContent).toContain('My plans')
    expect(drawer.contains(plansBtn)).toBe(true)
    const plansBody = one(byId('hl-lay-my-plans'), 'My plans body')
    expect(one(byClass(plansBody, 'fake-plans__list')).textContent).toBe('Plan A')
    // offline again: the panel unregisters, button and drawer go
    act(() => off())
    expect(openerOf('edit-route')).toHaveLength(0)
    expect(byId('hl-lay-edit-route')).toHaveLength(0)
  })

  it('the crew panel is a Collapsible "Crew: default · Edit" inside the drawer', () => {
    mount()
    registerRoute()
    expect(openerOf('crew')).toHaveLength(0)
    act(() => setEditRouteCrew({ summary: 'default', render: () => <p class="fake-crew">crew</p> }))
    const crewBtn = one(openerOf('crew'), 'crew section button')
    expect(crewBtn.textContent).toContain('Crew: default')
    expect(crewBtn.textContent).toContain('Edit')
    expect(crewBtn.getAttribute('aria-expanded')).toBe('false') // collapsed by default
    expect(one(byId('hl-lay-edit-route')).contains(crewBtn)).toBe(true)
    expect(byClass(one(byId('hl-lay-crew')), 'fake-crew')).toHaveLength(1)
    act(() => setEditRouteCrew({ summary: 'changed', render: () => <p class="fake-crew">crew</p> }))
    expect(one(openerOf('crew')).textContent).toContain('Crew: changed')
  })

  it('"Send to simulator" (S1) sits in the drawer next to the route panel when VITE_SIM_EXPORT is on; off: none', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in tests')))
    try {
      const off = mount({ enabled: true, simMode: 'official' })
      registerRoute()
      const drawer = one(byId('hl-lay-edit-route'))
      const slot = one(byClass(drawer, 'hl-simslot'), 'sim slot')
      expect(slot.getAttribute('aria-label')).toBe(t('simulator.sendSlot'))
      act(() => off())
      mount({ enabled: true, simMode: 'off' })
      expect(byClass(one(byId('hl-lay-edit-route')), 'hl-simslot')).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('My plans actions go to the store and redraw the list; a refused action shows its error', () => {
    mount()
    registerRoute()
    const body = one(byId('hl-lay-my-plans'))
    click(one(byClass(body, 'fake-plans__rename')))
    expect(one(byClass(body, 'fake-plans__list')).textContent).toBe('Plan B')
    click(one(byClass(body, 'fake-plans__bad')))
    expect(one(byClass(body, 'fake-plans__error')).textContent).toBe('empty title')
    click(one(byClass(body, 'fake-plans__remove')))
    expect(one(byClass(body, 'fake-plans__list')).textContent).toBe('')
    expect(byClass(body, 'fake-plans__error')).toHaveLength(0)
  })

  it('cleanup removes the host from the map', () => {
    const off = mount()
    registerRoute()
    act(() => off())
    expect(mapEl.childNodes.length).toBe(0)
    expect(editRouteHosted()).toBe(false)
  })
})
