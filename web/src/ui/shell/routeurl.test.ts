// D131 known answers: the Edit-route drawer's open state in the URL (#/?panel=route).
//  - opening the drawer pushes ?panel=route; closing it (Esc, ×) goes Back over that entry;
//  - Back (hash without the panel) closes the drawer; loading the URL opens it once the drawer exists;
//  - a drawer that opens remembered (no panel in the URL) replaces the hash, it does not push;
//  - the mode tab's remembered hash drops the panel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bindLayoutStorage, closeContainer, isOpen, openContainer, registerContainer, resetLayout } from '../layout'
import { EDIT_ROUTE_ID, syncEditRouteUrl } from './editroute'
import { applyRoute, panelOf, PLAN_ROUTE_HASH, shell, withPanel } from './store'

/** A window with a hash history: pushState/replaceState/back, hashchange on back (async in browsers). */
function fakeWin(start: string) {
  const entries = [start]
  let i = 0
  const listeners = new Set<() => void>()
  const loc = { get hash() { return entries[i] } }
  const fire = () => listeners.forEach((f) => f())
  const win = {
    location: loc,
    history: {
      state: null,
      pushState: (_s: unknown, _t: string, url: string) => void (entries.splice(i + 1), entries.push(url), i++),
      replaceState: (_s: unknown, _t: string, url: string) => void (entries[i] = url),
      back: () => void (i > 0 && (i--, fire())),
    },
    addEventListener: (_: string, f: () => void) => void listeners.add(f),
    removeEventListener: (_: string, f: () => void) => void listeners.delete(f),
  }
  /** user follows a link / forward: a new entry, then hashchange */
  const go = (hash: string) => (win.history.pushState(null, '', hash), fire())
  return { win: win as unknown as Window, entries, go, index: () => i }
}
const tick = () => new Promise<void>((r) => queueMicrotask(r))

describe('Edit-route drawer ↔ URL (D131)', () => {
  let stop: () => void = () => {}
  beforeEach(() => {
    resetLayout()
    bindLayoutStorage(() => null)
  })
  afterEach(() => stop())

  it('panel helpers', () => {
    expect(PLAN_ROUTE_HASH).toBe('#/?panel=route')
    expect(panelOf('#/?panel=route')).toBe('route')
    expect(panelOf('#/')).toBeNull()
    expect(withPanel('#/station/a?x=1', 'route')).toBe('#/station/a?x=1&panel=route')
    expect(withPanel('#/?panel=route', null)).toBe('#/')
    expect(withPanel('', null)).toBe('#/')
  })

  it('opening pushes ?panel=route; closing goes Back; Back closes the drawer', async () => {
    const f = fakeWin('#/')
    stop = syncEditRouteUrl(f.win)
    registerContainer({ id: EDIT_ROUTE_ID, kind: 'drawer', side: 'right' })
    openContainer(EDIT_ROUTE_ID, null)
    expect(f.entries).toEqual(['#/', '#/?panel=route'])
    expect(f.index()).toBe(1)
    closeContainer(EDIT_ROUTE_ID) // Esc / ×
    expect(f.index()).toBe(0)
    expect(f.win.location.hash).toBe('#/')
    // open again, then the browser's Back
    openContainer(EDIT_ROUTE_ID, null)
    expect(f.win.location.hash).toBe('#/?panel=route')
    f.win.history.back()
    expect(isOpen(EDIT_ROUTE_ID)).toBe(false)
    expect(f.win.location.hash).toBe('#/')
    await tick()
  })

  it('the header link (a hash change) opens it; closing then goes Back', () => {
    const f = fakeWin('#/')
    stop = syncEditRouteUrl(f.win)
    registerContainer({ id: EDIT_ROUTE_ID, kind: 'drawer', side: 'right' })
    f.go(PLAN_ROUTE_HASH)
    expect(isOpen(EDIT_ROUTE_ID)).toBe(true)
    expect(f.entries).toEqual(['#/', '#/?panel=route'])
    closeContainer(EDIT_ROUTE_ID)
    expect(f.index()).toBe(0)
  })

  it('loading the URL opens the drawer once it has rendered; closing replaces the hash', async () => {
    const f = fakeWin(PLAN_ROUTE_HASH)
    stop = syncEditRouteUrl(f.win)
    expect(isOpen(EDIT_ROUTE_ID)).toBe(false)
    registerContainer({ id: EDIT_ROUTE_ID, kind: 'drawer', side: 'right' })
    registerContainer({ id: 'crew', kind: 'section' }) // other containers change the open map meanwhile
    await tick()
    expect(isOpen(EDIT_ROUTE_ID)).toBe(true)
    expect(f.win.location.hash).toBe(PLAN_ROUTE_HASH)
    closeContainer(EDIT_ROUTE_ID)
    expect(f.entries).toEqual(['#/']) // nothing to go back to inside the app: replaced
  })

  it('a drawer remembered open is reflected by replacing the hash', () => {
    bindLayoutStorage(() => ({ getItem: () => JSON.stringify({ open: { [EDIT_ROUTE_ID]: true }, tabs: {} }), setItem: () => {} }))
    const f = fakeWin('#/')
    stop = syncEditRouteUrl(f.win)
    registerContainer({ id: EDIT_ROUTE_ID, kind: 'drawer', side: 'right' })
    expect(isOpen(EDIT_ROUTE_ID)).toBe(true)
    expect(f.entries).toEqual(['#/?panel=route'])
  })

  it('the Plan tab does not return to an open panel', () => {
    applyRoute({ name: 'console' }, PLAN_ROUTE_HASH)
    expect(shell.lastHash.peek().plan).toBe('#/')
  })
})
