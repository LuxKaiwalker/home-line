// L2f (D111) known answers for the Plan map chrome (views/planChrome.tsx):
//  - the mount claims the last console section ('notes'), adds the 'chrome' slot with the notes banner
//    and the cursor chip (the readout re-parented from MapLibre's corner), and undoes it on cleanup;
//  - the Rover button is the rover card's opener (L5 contract: aria-controls="hl-lay-rover");
//  - no section is left for a side panel: every SECTION_NAME is claimed by some Plan mount.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { t } from '../ui/copy'
import { resetLayout } from '../ui/layout'
import { all, byClass, installDom, one, type FakeDocument, type FakeNode } from '../ui/testing/dom'
import { mountPlanChrome, RoverButton } from './planChrome'
import { SECTION_NAMES, type PlanMountCtx, type SectionName, type Sections } from './planSlots'

let doc: FakeDocument
let root: FakeNode

function withQuery(n: FakeNode): FakeNode {
  ;(n as unknown as { querySelectorAll: (s: string) => FakeNode[] }).querySelectorAll = (s: string) => byClass(n, s.replace(/^\./, ''))
  ;(n as unknown as { querySelector: (s: string) => FakeNode | null }).querySelector = (s: string) => byClass(n, s.replace(/^\./, ''))[0] ?? null
  return n
}
const el = (cls: string, parent?: FakeNode): FakeNode => {
  const e = doc.createElement('div')
  e.setAttribute('class', cls)
  parent?.appendChild(e)
  return e
}

beforeEach(() => {
  ;({ document: doc, container: root } = installDom())
  Object.defineProperty(Object.getPrototypeOf(root), 'isConnected', { configurable: true, get: () => true })
  resetLayout()
})
afterEach(() => act(() => render(null, root as unknown as Element)))

describe('Plan chrome mount (L2f)', () => {
  it('claims notes, shows them and the cursor chip in the chrome slot; cleanup undoes it', () => {
    const mapEl = withQuery(el('console-map', root))
    const corner = el('maplibregl-ctrl-bottom-right', mapEl)
    const readout = el('maplibregl-ctrl hl-cursor-readout', corner)
    const layout = el('plan-layout', mapEl)
    const edge = withQuery(el('plan-layout__edge', layout))
    const panelEl = el('panel-body', root)
    const stash = el('plan-stash', root)
    const sec = {} as Record<SectionName, FakeNode>
    for (const n of SECTION_NAMES) sec[n] = el(`plan-section plan-section--${n}`, panelEl)
    const sections = { el: sec, stash, panel: panelEl, claimed: new Set<SectionName>(['summary']) } as unknown as Sections
    const claims: string[][] = []
    const ctx = {
      el: { edge, bottom: el('b', layout), card: el('c', layout), live: el('l', layout), strip: null },
      cmap: {},
      mapEl,
      consoleEl: root,
      sections,
      claim: (names: readonly SectionName[]) => {
        claims.push([...names])
        for (const n of names) {
          sections.claimed.add(n)
          stash.appendChild(sec[n])
        }
      },
      reveal: () => undefined,
      onStationClick: () => undefined,
    } as unknown as PlanMountCtx
    let stop!: () => void
    act(() => void (stop = mountPlanChrome(ctx)))
    expect(claims).toEqual([['notes']])
    const slot = one(all(layout, (n) => n.getAttribute('data-plan-slot') === 'chrome'))
    expect(one(byClass(slot, 'plan-notes')).contains(sec.notes)).toBe(true)
    expect(one(byClass(slot, 'plan-cursor')).contains(readout)).toBe(true)
    act(() => stop())
    expect(slot.parentNode).toBe(null)
    expect(corner.childNodes).toEqual([readout])
    expect(stash.contains(sec.notes)).toBe(true)
  })

  it('the Rover button opens the rover card (aria-controls hl-lay-rover)', () => {
    act(() => render(<RoverButton />, root as unknown as Element))
    const b = one(all(root, (n) => n.localName === 'button'))
    expect(b.getAttribute('aria-controls')).toBe('hl-lay-rover')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(b.getAttribute('aria-label')).toBe(t('planChrome.rover'))
  })

  it('every console section is claimed by a Plan mount (no side panel left in the shell frame)', () => {
    const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')
    const claimed = new Set<string>(['summary'])
    for (const f of ['planStrip.tsx', 'planBottom.tsx', 'planLayers.tsx', 'planStation.tsx', 'planChrome.tsx']) {
      for (const m of src(f).matchAll(/claim\(\[([^\]]*)\]/g)) for (const n of m[1].matchAll(/'(\w+)'/g)) claimed.add(n[1])
    }
    claimed.add('scenario').add('budget') // planStrip claims STRIP_POPOVERS
    for (const n of src('planBottom.tsx').match(/TABLE_SECTIONS: readonly SectionName\[\] = \[([^\]]*)\]/)![1].matchAll(/'(\w+)'/g)) claimed.add(n[1])
    expect([...SECTION_NAMES].filter((n) => !claimed.has(n))).toEqual([])
  })
})
