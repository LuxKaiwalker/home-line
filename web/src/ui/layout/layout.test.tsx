// L1 (D111) known answers for the layout containers and their store:
//  - Esc closes the topmost open container and focus returns to the element that opened it;
//  - at most one drawer per side, one marker card and one map-edge popover at a time;
//  - drawers, the bottom drawer (expanded + tab) and sections survive a (simulated) reload through the
//    bound storage; cards and popovers do not; with storage that throws (or no storage) the defaults hold;
//  - every storage access in store.ts sits inside try (the privacy rule for sanctioned storage users);
//  - reduced motion turns the open animation off; aria-expanded / aria-controls follow the state;
//  - the open drawers report the map insets they cover (onLayoutChange) and a card flips to stay inside.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ui } from '../../state/ui'
import { all, byClass, byRole, byTag, installDom, one, type FakeDocument, type FakeNode } from '../testing/dom'
import { BottomDrawer } from './BottomDrawer'
import { Collapsible } from './Collapsible'
import { Drawer } from './Drawer'
import { MarkerCard, placeCard } from './MarkerCard'
import { Popover } from './Popover'
import * as store from './store'
import { bindLayoutStorage, closeTopmost, installLayoutKeys, isOpen, LAYOUT_KEY, layoutInsets, onLayoutChange, openContainer, reportInset, resetLayout, useOpener, type StorageLike } from './store'

let doc: FakeDocument
let root: FakeNode
const mount = (v: VNode): FakeNode => {
  act(() => render(v, root as unknown as Element))
  return root
}
const fire = (n: FakeNode, type: string, init: Record<string, unknown> = {}) => act(() => void n.dispatch(type, init))
const byId = (id: string) => one(all(doc.body, (n) => n.getAttribute('id') === id), `#${id}`)
const btn = (name: string) => one(all(root, (n) => n.localName === 'button' && (n.getAttribute('aria-label') === name || n.textContent.trim() === name)), `button "${name}"`)
const hidden = (n: FakeNode) => n.hasAttribute('hidden') && n.getAttribute('hidden') !== 'false'

/** A window stand-in that records listeners and can dispatch a key. */
function fakeWin() {
  const ls = new Map<string, Set<(e: unknown) => void>>()
  return {
    addEventListener: (k: string, f: (e: unknown) => void) => void (ls.get(k) ?? ls.set(k, new Set()).get(k)!).add(f),
    removeEventListener: (k: string, f: (e: unknown) => void) => void ls.get(k)?.delete(f),
    key(key: string, prevented = false) {
      const e = { key, defaultPrevented: prevented, isComposing: false, preventDefault: () => void (e.defaultPrevented = true) }
      act(() => ls.get('keydown')?.forEach((f) => f(e)))
      return e
    },
  }
}

/** Map-backed Web Storage. */
function memStorage() {
  const m = new Map<string, string>()
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } satisfies StorageLike }
}
const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

function Opener({ id, label }: { id: string; label: string }) {
  return (
    <button type="button" {...useOpener(id)}>
      {label}
    </button>
  )
}

beforeEach(() => {
  ;({ document: doc } = installDom())
  root = doc.createElement('div')
  doc.body.appendChild(root)
  bindLayoutStorage(() => null)
  resetLayout()
  ui.reducedMotion.value = false
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
})

describe('Esc closes the topmost container; focus returns to the opener', () => {
  it('popover over drawer: Esc closes the popover first, then the drawer, then nothing', () => {
    const win = fakeWin()
    const off = installLayoutKeys(win)
    mount(
      <div>
        <Opener id="edit" label="Edit route" />
        <Drawer id="edit" title="Edit route">
          <p>stops</p>
        </Drawer>
        <Popover id="layers" icon="layers" label="Layers">
          <button type="button">Relief</button>
        </Popover>
      </div>,
    )
    const opener = btn('Edit route')
    opener.focus()
    fire(opener, 'click')
    expect(isOpen('edit')).toBe(true)
    expect(doc.activeElement?.getAttribute('aria-label')).toBe('Close') // focus moved into the drawer

    const layersBtn = btn('Layers')
    layersBtn.focus()
    fire(layersBtn, 'click')
    expect(isOpen('layers')).toBe(true)
    expect(doc.activeElement?.textContent).toBe('Relief')

    let e = win.key('Escape')
    expect(e.defaultPrevented).toBe(true)
    expect(isOpen('layers')).toBe(false)
    expect(isOpen('edit')).toBe(true)
    expect(doc.activeElement).toBe(layersBtn)

    e = win.key('Escape')
    expect(isOpen('edit')).toBe(false)
    expect(hidden(byId('hl-lay-edit'))).toBe(true)
    expect(doc.activeElement).toBe(opener)

    e = win.key('Escape')
    expect(e.defaultPrevented).toBe(false) // nothing open: left to the shell (focus mode, help)
    off()
  })

  it('a reopened container becomes the topmost again; handled or blocked keys are left alone', () => {
    const win = fakeWin()
    let blocked = false
    installLayoutKeys(win, { blocked: () => blocked })
    mount(
      <div>
        <Drawer id="a" title="A">
          x
        </Drawer>
        <MarkerCard id="card" title="Rover" at={{ x: 10, y: 10 }}>
          y
        </MarkerCard>
      </div>,
    )
    act(() => openContainer('a', null))
    act(() => openContainer('card', null))
    act(() => openContainer('a', null))
    expect(store.layout.stack.peek()).toEqual(['card', 'a'])
    blocked = true
    expect(win.key('Escape').defaultPrevented).toBe(false)
    blocked = false
    expect(win.key('Escape', true).defaultPrevented).toBe(true) // already handled by someone else
    expect(isOpen('a')).toBe(true)
    win.key('Escape')
    expect(isOpen('a')).toBe(false)
    expect(isOpen('card')).toBe(true)
  })

  it('sections are not closed by Esc; unmounted containers are skipped', () => {
    mount(
      <Collapsible id="crew" title="Crew: default" defaultOpen>
        crew
      </Collapsible>,
    )
    expect(isOpen('crew')).toBe(true)
    expect(closeTopmost()).toBe(false)
    expect(isOpen('crew')).toBe(true)
    store.registerContainer({ id: 'ghost', kind: 'drawer', side: 'right' })
    act(() => openContainer('ghost', null))
    expect(closeTopmost()).toBe(false) // never rendered: nothing to close on screen
  })
})

describe('one drawer per side, one card, one popover', () => {
  it('opening a second right drawer closes the first; the bottom drawer is another side', () => {
    mount(
      <div>
        <Drawer id="edit" title="Edit route">
          a
        </Drawer>
        <Drawer id="station" title="Station">
          b
        </Drawer>
        <BottomDrawer id="bottom" label="Plan details" tabs={[{ id: 'table', label: 'Key numbers', render: () => 'table' }]} collapsed={() => 'summary'} expandLabel="Show" collapseLabel="Hide" />
      </div>,
    )
    act(() => openContainer('bottom', null))
    act(() => openContainer('edit', null))
    act(() => openContainer('station', null))
    expect([isOpen('edit'), isOpen('station'), isOpen('bottom')]).toEqual([false, true, true])
    expect(hidden(byId('hl-lay-edit'))).toBe(true)
    expect(hidden(byId('hl-lay-station'))).toBe(false)
  })

  it('opening a second marker card closes the first (closed cards render nothing)', () => {
    mount(
      <div>
        <MarkerCard id="card:rover" title="Rover" at={{ x: 100, y: 100 }}>
          pad
        </MarkerCard>
        <MarkerCard id="card:S1" title="Station S1" at={{ x: 200, y: 100 }}>
          s1
        </MarkerCard>
      </div>,
    )
    act(() => openContainer('card:rover', null))
    expect(byClass(root, 'hl-lay-card')).toHaveLength(1)
    act(() => openContainer('card:S1', null))
    const cards = byClass(root, 'hl-lay-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('id')).toBe('hl-lay-card_S1')
    expect(isOpen('card:rover')).toBe(false)
  })

  it('one map-edge popover at a time', () => {
    mount(
      <div>
        <Popover id="layers" icon="layers" label="Layers">
          l
        </Popover>
        <Popover id="legend" icon="info" label="Legend" edge="bottom-left">
          g
        </Popover>
      </div>,
    )
    fire(btn('Layers'), 'click')
    fire(btn('Legend'), 'click')
    expect([isOpen('layers'), isOpen('legend')]).toEqual([false, true])
  })

  it('remembered state that breaks the rule: the first drawer keeps the side', () => {
    const { s, m } = memStorage()
    m.set(LAYOUT_KEY, JSON.stringify({ open: { a: true, b: true }, tabs: {} }))
    bindLayoutStorage(() => s)
    resetLayout()
    mount(
      <div>
        <Drawer id="a" title="A">
          a
        </Drawer>
        <Drawer id="b" title="B">
          b
        </Drawer>
      </div>,
    )
    expect([isOpen('a'), isOpen('b')]).toEqual([true, false])
  })
})

describe('persistence per viewer', () => {
  const app = (S: typeof import('./index')) => (
    <div>
      <S.Drawer id="edit" title="Edit route">
        a
      </S.Drawer>
      <S.MarkerCard id="card:rover" title="Rover" at={{ x: 1, y: 1 }}>
        c
      </S.MarkerCard>
      <S.Collapsible id="crew" title="Crew">
        crew
      </S.Collapsible>
      <S.BottomDrawer
        id="bottom"
        label="Plan details"
        tabs={[
          { id: 'table', label: 'Key numbers', render: () => 'table' },
          { id: 'timeline', label: 'Timeline', render: () => 'timeline' },
        ]}
        collapsed={({ tab }) => `summary ${tab}`}
        expandLabel="Show"
        collapseLabel="Hide"
      />
    </div>
  )

  it('open/closed state and the bottom tab survive a reload; cards do not', async () => {
    const { s, m } = memStorage()
    bindLayoutStorage(() => s)
    resetLayout()
    mount(app(await import('./index')))
    act(() => openContainer('edit', null))
    act(() => openContainer('bottom', null))
    act(() => store.setActiveTab('bottom', 'timeline'))
    fire(byTag(root, 'button').find((b) => b.textContent.trim() === 'Crew')!, 'click')
    act(() => openContainer('card:rover', null))
    expect(JSON.parse(m.get(LAYOUT_KEY)!)).toEqual({ open: { edit: true, bottom: true, crew: true }, tabs: { bottom: 'timeline' } })

    // reload: fresh modules, fresh DOM, same storage
    act(() => render(null, root as unknown as Element))
    vi.resetModules()
    ;({ document: doc } = installDom())
    root = doc.createElement('div')
    doc.body.appendChild(root)
    const S = await import('./index')
    S.bindLayoutStorage(() => s)
    mount(app(S))
    expect([S.isOpen('edit'), S.isOpen('bottom'), S.isOpen('crew'), S.isOpen('card:rover')]).toEqual([true, true, true, false])
    expect(hidden(byId('hl-lay-edit'))).toBe(false)
    expect(one(byRole(root, 'tabpanel')).textContent).toBe('timeline')
  })

  it.each([
    ['getItem and setItem throw (private mode, quota)', () => throwing],
    ['the accessor itself throws (blocked site data)', () => {
      throw new Error('SecurityError')
    }],
    ['no storage at all', () => null],
    ['unreadable JSON', () => ({ getItem: () => '{not json', setItem: () => {} })],
  ] as [string, () => StorageLike | null][])('%s: the defaults hold and the containers still work', async (_, get) => {
    bindLayoutStorage(get)
    resetLayout()
    mount(app(await import('./index')))
    expect([isOpen('edit'), isOpen('bottom'), isOpen('crew')]).toEqual([false, false, false])
    act(() => openContainer('edit', null))
    expect(isOpen('edit')).toBe(true)
    expect(one(byClass(root, 'hl-lay-bottom__summary')).textContent).toBe('summary table')
  })

  it('every storage access in store.ts sits inside try (rule for a sanctioned storage user)', () => {
    const src = readFileSync(resolve(__dirname, 'store.ts'), 'utf8')
    const body = src.replace(/\/\/.*$/gm, '').replace(/\/\*\*?[\s\S]*?\*\//g, '')
    const uses = [...body.matchAll(/localStorage|sessionStorage|\.getItem\(|\.setItem\(|getStorage\(\)/g)]
    expect(uses.length).toBeGreaterThanOrEqual(4)
    for (const m of uses) {
      const before = body.slice(0, m.index)
      const opened = (before.match(/\btry \{/g) ?? []).length
      const closed = (before.match(/\} catch\b/g) ?? []).length
      expect(opened - closed, `${m[0]} at offset ${m.index} is not inside try`).toBe(1)
    }
  })
})

describe('reduced motion', () => {
  it('ui.reducedMotion marks every container data-motion=reduce; the CSS turns the animation off there and under the media query', () => {
    ui.reducedMotion.value = true
    mount(
      <div>
        <Drawer id="d" title="D" defaultOpen>
          d
        </Drawer>
        <MarkerCard id="c" title="C" at={{ x: 1, y: 1 }} defaultOpen>
          c
        </MarkerCard>
        <Popover id="p" icon="layers" label="Layers" defaultOpen>
          p
        </Popover>
        <BottomDrawer id="b" label="B" tabs={[{ id: 't', label: 'T', render: () => 't' }]} collapsed={() => 's'} expandLabel="Show" collapseLabel="Hide" />
        <Collapsible id="s" title="S">
          s
        </Collapsible>
      </div>,
    )
    for (const c of ['hl-lay-drawer', 'hl-lay-card', 'hl-lay-pop', 'hl-lay-bottom', 'hl-lay-sec']) expect(one(byClass(root, c)).getAttribute('data-motion'), c).toBe('reduce')
    act(() => void (ui.reducedMotion.value = false))
    expect(one(byClass(root, 'hl-lay-drawer')).getAttribute('data-motion')).toBeNull()

    const css = readFileSync(resolve(__dirname, 'layout.css'), 'utf8')
    const animated = [...css.matchAll(/([^{}]+)\{[^}]*\banimation:\s*hl-lay[^;]*var\(--motion-panel-min\)/g)].map((m) => m[1].trim())
    expect(animated.length).toBe(4) // every animation uses the motion token (0 ms under reduced motion, tokens.css)
    expect(css).toMatch(/\[data-motion=reduce\]\.hl-lay-drawer[^{]*\{ animation: none; \}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hl-lay-drawer, \.hl-lay-bottom__panel, \.hl-lay-card, \.hl-lay-pop__panel \{ animation: none; \}/)
    expect(css).not.toMatch(/transition\s*:/)
  })
})

describe('aria-expanded and aria-controls follow the state', () => {
  it('opener button, popover, bottom drawer and section', () => {
    mount(
      <div>
        <Opener id="edit" label="Edit route" />
        <Drawer id="edit" title="Edit route">
          a
        </Drawer>
        <Popover id="layers" icon="layers" label="Layers" title="Map layers">
          l
        </Popover>
        <BottomDrawer id="bottom" label="Plan details" tabs={[{ id: 'table', label: 'Key numbers', render: () => 'table' }]} collapsed={() => 'summary'} expandLabel="Show details" collapseLabel="Hide details" />
        <Collapsible id="crew" title="Crew: default" hint="Edit">
          crew
        </Collapsible>
      </div>,
    )
    const check = (b: FakeNode, open: boolean) => {
      expect(b.getAttribute('aria-expanded')).toBe(open ? 'true' : 'false')
      const target = byId(b.getAttribute('aria-controls')!)
      expect(hidden(target)).toBe(!open)
    }
    const opener = btn('Edit route')
    check(opener, false)
    fire(opener, 'click')
    check(opener, true)
    expect(one(byRole(root, 'dialog').filter((d) => d.getAttribute('id') === 'hl-lay-edit')).getAttribute('aria-modal')).toBeNull() // non-modal: the map stays usable
    fire(opener, 'click')
    check(opener, false)

    const layers = btn('Layers')
    expect(layers.getAttribute('aria-haspopup')).toBe('dialog')
    check(layers, false)
    fire(layers, 'click')
    check(layers, true)
    expect(byId(layers.getAttribute('aria-controls')!).getAttribute('aria-labelledby')).toBe('hl-lay-layers-title')

    const grip = btn('Show details')
    check(grip, false)
    fire(grip, 'click')
    expect(grip.getAttribute('aria-label')).toBe('Hide details')
    check(grip, true)
    const tab = one(byRole(root, 'tab'))
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(byId(tab.getAttribute('aria-controls')!).getAttribute('role')).toBe('tabpanel')

    const sec = one(all(root, (n) => n.localName === 'button' && n.textContent.includes('Crew: default')))
    expect(sec.parentNode?.localName).toBe('h3')
    check(sec, false)
    fire(sec, 'click')
    check(sec, true)
  })

  it('every button has a name; the drawer title names its dialog', () => {
    mount(
      <div>
        <Drawer id="d" title="Edit route" defaultOpen>
          a
        </Drawer>
        <MarkerCard id="c" title="Rover" at={{ x: 1, y: 1 }} defaultOpen>
          c
        </MarkerCard>
        <BottomDrawer id="b" label="Plan details" tabs={[{ id: 't', label: 'T', render: () => 't' }]} collapsed={() => 's'} expandLabel="Show" collapseLabel="Hide" />
      </div>,
    )
    for (const b of byTag(root, 'button')) expect((b.getAttribute('aria-label') ?? b.textContent).trim(), b.getAttribute('class') ?? '').not.toBe('')
    for (const d of byRole(root, 'dialog')) expect(byId(d.getAttribute('aria-labelledby')!).textContent.length).toBeGreaterThan(0)
    expect(byId('hl-lay-d-title').localName).toBe('h2')
  })
})

describe('bottom drawer', () => {
  const tabs = [
    { id: 'table', label: 'Key numbers', render: () => 'the table' },
    { id: 'timeline', label: 'Timeline', render: () => 'the dock' },
  ]
  it('collapsed: the render prop (summary or slim scrubber) and expand(); expanded: tabs with arrow keys', () => {
    mount(<BottomDrawer id="b" label="Plan details" tabs={tabs} collapsed={({ tab, expand }) => <button type="button" onClick={expand}>{`scrub ${tab}`}</button>} expandLabel="Show" collapseLabel="Hide" />)
    expect(byRole(root, 'tablist')).toHaveLength(0)
    fire(btn('scrub table'), 'click')
    expect(isOpen('b')).toBe(true)
    const [t1, t2] = byRole(root, 'tab')
    expect([t1.getAttribute('tabindex'), t2.getAttribute('tabindex')]).toEqual(['0', '-1'])
    fire(t1, 'keydown', { key: 'ArrowRight' })
    expect(one(byRole(root, 'tabpanel')).textContent).toBe('the dock')
    expect(doc.activeElement).toBe(byRole(root, 'tab')[1])
  })

  it('drag the grip up expands, down collapses; the click after a drag does not toggle back', () => {
    mount(<BottomDrawer id="b" label="Plan details" tabs={tabs} collapsed={() => 'sum'} expandLabel="Show" collapseLabel="Hide" />)
    const grip = btn('Show')
    fire(grip, 'pointerdown', { clientY: 500, pointerId: 1 })
    fire(grip, 'pointermove', { clientY: 496 })
    expect(isOpen('b')).toBe(false) // under the drag threshold
    fire(grip, 'pointermove', { clientY: 440 })
    expect(isOpen('b')).toBe(true)
    fire(grip, 'click')
    expect(isOpen('b')).toBe(true)
    fire(grip, 'pointerdown', { clientY: 300, pointerId: 1 })
    fire(grip, 'pointermove', { clientY: 380 })
    fire(grip, 'click')
    expect(isOpen('b')).toBe(false)
  })
})

describe('map insets and card placement', () => {
  it('onLayoutChange reports the covered right and bottom insets, once per change', () => {
    const seen: unknown[] = []
    const off = onLayoutChange((v) => seen.push(v))
    store.registerContainer({ id: 'r', kind: 'drawer', side: 'right' })
    store.registerContainer({ id: 'b', kind: 'drawer', side: 'bottom' })
    act(() => reportInset('b', { bottom: 40 })) // collapsed bar: counts while closed
    act(() => reportInset('r', { right: 360 }))
    expect(layoutInsets.peek()).toEqual({ right: 0, bottom: 40 }) // the right drawer is closed
    act(() => openContainer('r', null))
    act(() => reportInset('r', { right: 360 }))
    expect(seen).toEqual([
      { right: 0, bottom: 40 },
      { right: 360, bottom: 40 },
    ])
    act(() => store.closeContainer('r'))
    expect(seen.at(-1)).toEqual({ right: 0, bottom: 40 })
    off()
  })

  it('placeCard: above-right by default, flips left at the right edge and below at the top edge, stays inside', () => {
    const card = { w: 200, h: 100 }
    const box = { w: 1000, h: 600 }
    expect(placeCard({ x: 300, y: 300 }, card, box, 8)).toEqual({ left: 308, top: 192, flipX: false, flipY: false })
    expect(placeCard({ x: 900, y: 300 }, card, box, 8)).toEqual({ left: 692, top: 192, flipX: true, flipY: false })
    expect(placeCard({ x: 300, y: 40 }, card, box, 8)).toEqual({ left: 308, top: 48, flipX: false, flipY: true })
    expect(placeCard({ x: 990, y: 5 }, card, box, 8)).toEqual({ left: 782, top: 13, flipX: true, flipY: true })
    const tiny = placeCard({ x: 50, y: 50 }, card, { w: 120, h: 80 }, 8)
    expect([tiny.left, tiny.top]).toEqual([0, 0])
  })

  it('a card anchored to a lngLat follows the map (project on move) and unsubscribes on close', () => {
    const fns = new Map<string, () => void>()
    let x = 100
    const map = {
      project: () => ({ x, y: 200 }),
      on: (k: string, f: () => void) => void fns.set(k, f),
      off: (k: string) => void fns.delete(k),
    }
    mount(
      <MarkerCard id="c" title="Rover" at={{ lngLat: [137.4, -4.6], map }} defaultOpen>
        c
      </MarkerCard>,
    )
    const card = one(byClass(root, 'hl-lay-card'))
    expect(card.style.left).toBe('0px') // fake DOM: no size, box 0 → clamped to the corner
    expect([...fns.keys()].sort()).toEqual(['move', 'resize'])
    x = 300
    act(() => fns.get('move')!())
    act(() => store.closeContainer('c'))
    expect(fns.size).toBe(0)
    expect(byClass(root, 'hl-lay-card')).toHaveLength(0)
  })
})
