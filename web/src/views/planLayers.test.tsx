// L2c (D111) known answers for the Plan layers popover, the legend corner chip and the map-edge tools:
//  - the mount claims the console's 'layers' and 'legend' sections, sets their reveal openers, hosts the U7
//    rail section ('layers' in shell.hosted) and undoes all of it on cleanup;
//  - popover ids are the L5 contract: opener aria-controls="hl-lay-layers" / "hl-lay-legend";
//  - the layers popover holds the map view group, the console layer checkboxes (first layer group, L0 Q3)
//    and the U7 layer manager; the legend popover holds the console legend; one popover at a time;
//  - <Borrow> re-parents a MapLibre control (waits for it to appear) and puts it back where it was;
//  - Flythrough and Storm replay keep their label as the accessible name next to the icon.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { t } from '../ui/copy'
import { resetLayout } from '../ui/layout'
import { shell } from '../ui/shell/store'
import { all, byClass, installDom, one, type FakeDocument, type FakeNode } from '../ui/testing/dom'
import { Borrow, EDGE_CONTROLS, LAYERS_ID, LEGEND_ID, mountPlanEdge } from './planLayers'
import { SECTION_NAMES, type PlanMountCtx, type SectionName, type Sections } from './planSlots'

let doc: FakeDocument
let root: FakeNode

/** Minimal selector support for the fake DOM: one class name ('.x'). */
function withQuery(n: FakeNode): FakeNode {
  ;(n as unknown as { querySelectorAll: (s: string) => FakeNode[] }).querySelectorAll = (s: string) => byClass(n, s.replace(/^\./, ''))
  return n
}
function connected(n: FakeNode): boolean {
  let p: FakeNode | null = n
  while (p && p !== doc.body) p = p.parentNode
  return p === doc.body
}
const el = (cls: string, parent?: FakeNode): FakeNode => {
  const e = doc.createElement('div')
  e.setAttribute('class', cls)
  parent?.appendChild(e)
  return e
}
const fire = (n: FakeNode, type: string) => act(() => void n.dispatch(type))
const opener = (id: string) => one(all(root, (n) => n.localName === 'button' && n.getAttribute('aria-controls') === `hl-lay-${id}`), `opener ${id}`)
const panel = (id: string) => one(all(root, (n) => n.getAttribute('id') === `hl-lay-${id}`), `#hl-lay-${id}`)
const hidden = (n: FakeNode) => n.hasAttribute('hidden') && n.getAttribute('hidden') !== 'false'

beforeEach(() => {
  ;({ document: doc, container: root } = installDom())
  Object.defineProperty(Object.getPrototypeOf(root), 'isConnected', { configurable: true, get(this: FakeNode) { return connected(this) } })
  resetLayout()
  shell.hosted.value = []
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  delete (globalThis as Record<string, unknown>).MutationObserver
})

function fakeCtx() {
  const mapEl = withQuery(el('console-map', root))
  const corner = el('maplibregl-ctrl-top-right', mapEl)
  const compass = el('maplibregl-ctrl hl-compass', corner)
  const fly = el('maplibregl-ctrl hl-fly', corner)
  const edge = el('plan-layout__edge', mapEl)
  const panelEl = el('panel-body', root)
  const stash = el('plan-stash', root)
  const sec = {} as Record<SectionName, FakeNode>
  for (const n of SECTION_NAMES) sec[n] = el(`plan-section plan-section--${n}`, panelEl)
  const sections = { el: sec, stash, panel: panelEl, claimed: new Set<SectionName>(['summary']) } as unknown as Sections
  const claims: string[][] = []
  const ctx = {
    el: { edge, bottom: el('b', mapEl), card: el('c', mapEl), live: el('l', mapEl), strip: null },
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
    reveal: (n: SectionName, s: readonly string[]) => sec[n].setAttribute('data-hl-reveal', JSON.stringify(s)),
    onStationClick: () => undefined,
  } as unknown as PlanMountCtx
  return { ctx, mapEl, corner, compass, fly, edge, sec, stash, claims }
}

describe('Plan mount (L2c)', () => {
  it('claims layers + legend, sets reveal openers, hosts the U7 rail section; cleanup undoes it', () => {
    const f = fakeCtx()
    let stop!: () => void
    act(() => void (stop = mountPlanEdge(f.ctx)))
    expect(f.claims).toEqual([['layers', 'legend']])
    expect(JSON.parse(f.sec.layers.getAttribute('data-hl-reveal')!)).toEqual(['[aria-controls="hl-lay-layers"][aria-expanded="false"]'])
    expect(JSON.parse(f.sec.legend.getAttribute('data-hl-reveal')!)).toEqual(['[aria-controls="hl-lay-legend"][aria-expanded="false"]'])
    expect(shell.hosted.value).toContain('layers')
    // map-edge tools: the compass left the MapLibre corner for the tools column; the flythrough is not
    // borrowed while FLY is hidden (D145)
    const tools = one(byClass(f.edge, 'plan-tools'))
    expect(tools.contains(f.compass)).toBe(true)
    expect(tools.contains(f.fly)).toBe(false)
    expect(f.corner.childNodes).toEqual([f.fly])
    act(() => stop())
    expect(shell.hosted.value).not.toContain('layers')
    expect(f.corner.childNodes).toEqual([f.compass, f.fly]) // back, in order
    expect(f.edge.childNodes).toEqual([])
  })

  it('layers popover: map view, console layer list (first layer group), U7 manager; legend popover: the legend; one at a time', () => {
    const f = fakeCtx()
    act(() => void mountPlanEdge(f.ctx))
    expect(opener(LAYERS_ID).getAttribute('aria-label')).toBe(t('layers.manager.label'))
    expect(opener(LEGEND_ID).getAttribute('aria-label')).toBe(t('layers.manager.legend'))
    expect(hidden(panel(LAYERS_ID))).toBe(true)
    fire(opener(LAYERS_ID), 'click')
    const p = panel(LAYERS_ID)
    expect(hidden(p)).toBe(false)
    expect(opener(LAYERS_ID).getAttribute('aria-expanded')).toBe('true')
    expect(p.contains(f.sec.layers)).toBe(true)
    expect(byClass(p, 'hl-ovl')).toHaveLength(1) // U7 LayerPanel
    const groups = byClass(p, 'plan-layers__group')
    expect(groups.map((g) => g.textContent)).toEqual([expect.stringContaining(t('layers.manager.view')), expect.stringContaining(t('layers.groups.planning'))])
    // the console list comes before the U7 groups (L0 Q3: first group)
    const order = all(p, (n) => n === f.sec.layers || byClass(p, 'hl-ovl').includes(n))
    expect(order[0]).toBe(f.sec.layers)
    fire(opener(LEGEND_ID), 'click')
    expect(hidden(panel(LAYERS_ID))).toBe(true)
    expect(opener(LAYERS_ID).getAttribute('aria-expanded')).toBe('false')
    expect(panel(LEGEND_ID).contains(f.sec.legend)).toBe(true)
    expect(f.stash.contains(f.sec.layers)).toBe(true) // back in the stash while its popover is closed
  })
})

describe('<Borrow>', () => {
  it('waits for the control, re-parents it, and returns it on unmount', () => {
    const obs: { cb: () => void; on: boolean }[] = []
    ;(globalThis as Record<string, unknown>).MutationObserver = class {
      private readonly r: { cb: () => void; on: boolean }
      constructor(cb: () => void) {
        this.r = { cb, on: false }
        obs.push(this.r)
      }
      observe() {
        this.r.on = true
      }
      disconnect() {
        this.r.on = false
      }
    }
    const mapEl = withQuery(el('console-map', root))
    const corner = el('maplibregl-ctrl-top-left', mapEl)
    const before = el('maplibregl-ctrl zoom', corner)
    const host = el('host', root)
    act(() => render(<Borrow root={mapEl as unknown as HTMLElement} sel={EDGE_CONTROLS.view} />, host as unknown as Element))
    const box = one(byClass(host, 'plan-borrow'))
    expect(box.childNodes).toEqual([])
    expect(obs.filter((o) => o.on)).toHaveLength(1)
    const ctrl = el('maplibregl-ctrl hl-terrain-ctrl', corner) // the map loads: TerrainController adds it
    const after = el('maplibregl-ctrl other', corner)
    act(() => obs[0].cb())
    expect(box.childNodes).toEqual([ctrl])
    expect(obs[0].on).toBe(false)
    act(() => render(null, host as unknown as Element))
    expect(corner.childNodes).toEqual([before, ctrl, after])
  })

  it('leaves a control its owner removed meanwhile (map destroyed)', () => {
    const mapEl = withQuery(el('console-map', root))
    const ctrl = el('maplibregl-ctrl hl-storm-ctrl', el('corner', mapEl))
    const host = el('host', root)
    act(() => render(<Borrow root={mapEl as unknown as HTMLElement} sel={EDGE_CONTROLS.storm} />, host as unknown as Element))
    act(() => ctrl.remove())
    act(() => render(null, host as unknown as Element))
    expect(ctrl.parentNode).toBe(null)
  })
})

describe('Flythrough and Storm replay buttons (icon + label)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')
  it('keep the label text as the accessible name; the icon shows only in the map-edge tools', () => {
    for (const [file, icon] of [['../map/flythrough/control.ts', 'camera'], ['../map/storm/index.ts', 'radiation']] as const) {
      const s = src(file)
      expect(s, file).toContain(`iconSvg('${icon}', { className: 'hl-ctrl-icon' })`)
      expect(s, file).toContain('hl-ctrl-text')
      expect(s, file).not.toMatch(/(go|btn)\.textContent =/)
    }
    expect(src('../map/flythrough/flythrough.css')).toMatch(/\.hl-fly-btn \.hl-ctrl-icon \{ display: none; \}/)
    expect(src('../map/storm/storm.css')).toMatch(/\.hl-storm-btn \.hl-ctrl-icon \{ display: none; \}/)
    expect(src('./planLayers.css')).toMatch(/\.plan-tools \.plan-borrow \.hl-ctrl-icon \{ display: block;/)
  })
})
