// L2b (D111) known answers for the Plan bottom drawer (views/planBottom.tsx):
//  - registered as a Plan mount; it claims the plan-table sections (+ the summary line) and names the
//    openers that reveal them (tools/values_snapshot.ts), in the old side-panel order;
//  - while mounted the Plan map view hosts the timeline (shell dock empty in Plan); cleanup undoes it;
//  - collapsed: one line with the route summary section and the slim scrubber (Play = .hl-tl__play,
//    the shared mission clock; a trust chip on the EVA time); the L5 ids #hl-lay-plan-bottom and
//    #hl-lay-plan-bottom-tab-{plan-table,timeline};
//  - expanded: the plan-table tab shows the claimed section elements themselves (numbers unchanged: the
//    same nodes move), the timeline tab shows the dock body (dockContent), one timeline at a time;
//  - L7c: the slim Play is the replay player of the activity store (as the full timeline's Play): it
//    stops a running flythrough / intro, is pressed only while the replay runs, disabled during a job;
//  - the shell root gets the drawer height (--hl-plan-bottom) so an overlay side panel ends above it.
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activity, beginJob, endJob, resetActivity, start } from '../state/activity'
import { missionClock } from '../state/mission'
import { ui } from '../state/ui'
import { all, byClass, installDom, one, type FakeDocument, type FakeNode } from '../ui/testing/dom'
import { bindLayoutStorage, closeContainer, openContainer, reportInset, resetLayout, setActiveTab } from '../ui/layout'
import { dockContent, setDockContent, shell } from '../ui/shell/store'
import { mountPlanBottom, PLAN_BOTTOM, TAB_TABLE, TAB_TIMELINE, TABLE_SECTIONS } from './planBottom'
import type { PlanMountCtx, SectionName, Sections } from './planSlots'

let doc: FakeDocument
let shellEl: FakeNode
let mapEl: FakeNode
let bottom: FakeNode
let claimed: SectionName[]
let reveals: Map<SectionName, readonly string[]>
let sections: Sections

const byId = (id: string) => one(all(doc.body, (n) => n.getAttribute('id') === id), `#${id}`)
const section = (n: SectionName) => sections.el[n] as unknown as FakeNode

function makeCtx(): PlanMountCtx {
  const el = {} as Record<SectionName, HTMLElement>
  const stash = doc.createElement('div')
  for (const n of [...TABLE_SECTIONS, 'summary'] as SectionName[]) {
    const e = doc.createElement('div')
    e.setAttribute('class', 'plan-section')
    e.setAttribute('data-section', n)
    e.appendChild(doc.createTextNode(`${n} body`))
    stash.appendChild(e)
    el[n] = e as unknown as HTMLElement
  }
  sections = { el, stash: stash as unknown as HTMLElement, panel: doc.createElement('div') as unknown as HTMLElement, claimed: new Set() }
  const h = (x: FakeNode) => x as unknown as HTMLElement
  return {
    el: { bottom: h(bottom), edge: h(doc.createElement('div')), card: h(doc.createElement('div')), live: h(doc.createElement('div')), strip: null },
    cmap: {} as PlanMountCtx['cmap'],
    mapEl: h(mapEl),
    consoleEl: h(doc.createElement('div')),
    sections,
    claim: (names) => {
      claimed.push(...names)
      for (const n of names) sections.claimed.add(n)
    },
    reveal: (n, sel) => void reveals.set(n, sel),
    onStationClick: () => undefined,
  }
}

let stop: () => void = () => {}
beforeEach(() => {
  ;({ document: doc } = installDom())
  shellEl = doc.createElement('div')
  mapEl = doc.createElement('div')
  ;(mapEl as unknown as { closest: (s: string) => FakeNode | null }).closest = (s) => (s === '.hl-shell' ? shellEl : null)
  bottom = doc.createElement('div')
  shellEl.appendChild(mapEl)
  mapEl.appendChild(bottom)
  doc.body.appendChild(shellEl)
  bindLayoutStorage(() => null)
  resetLayout()
  ui.reducedMotion.value = false
  shell.hosted.value = []
  claimed = []
  reveals = new Map()
  missionClock.pause()
  missionClock.seek(0)
  resetActivity()
  act(() => void (stop = mountPlanBottom(makeCtx())))
})
afterEach(() => {
  act(() => stop())
  setDockContent(undefined)
  missionClock.pause()
  resetActivity()
})

describe('plan-bottom drawer (L2b)', () => {
  it('claims the plan-table sections and the summary; each table section names its openers', () => {
    expect(TABLE_SECTIONS).toEqual(['headline', 'padpicker', 'route', 'siting', 'stations'])
    expect(claimed).toEqual([...TABLE_SECTIONS, 'summary'])
    for (const n of TABLE_SECTIONS)
      expect(reveals.get(n)).toEqual([`[aria-controls="hl-lay-${PLAN_BOTTOM}"][aria-expanded="false"]`, `#hl-lay-${PLAN_BOTTOM}-tab-${TAB_TABLE}[aria-selected="false"]`])
  })

  it('hosts the timeline while mounted (the shell dock leaves Plan) and gives it back on cleanup', () => {
    expect(shell.hosted.value).toContain('timeline')
    act(() => stop())
    stop = () => {}
    expect(shell.hosted.value).not.toContain('timeline')
    expect(byClass(bottom, 'hl-lay-bottom')).toHaveLength(0)
  })

  it('collapsed: one line with the route summary and the slim scrubber on the shared mission clock', () => {
    const drawer = one(byClass(bottom, 'hl-lay-bottom'))
    expect(drawer.getAttribute('data-open')).toBe('false')
    const line = one(byClass(drawer, 'plan-bottom__line'))
    expect(section('summary').parentNode?.parentNode).toBe(one(byClass(line, 'plan-bottom__summary')))
    const play = one(byClass(line, 'hl-tl__play'))
    expect(byClass(line, 'hl-chip').length + byClass(line, 'hl-trust').length).toBeGreaterThan(0) // trust chip on the EVA time
    act(() => void play.dispatch('click'))
    expect(missionClock.playing).toBe(true)
    act(() => void play.dispatch('click'))
    expect(missionClock.playing).toBe(false)
    const range = one(all(line, (n) => n.localName === 'input' && n.getAttribute('type') === 'range'))
    expect(range.getAttribute('aria-label')).toBe('Mission timeline')
  })

  it('L7c: the slim Play is the replay player (stops the flythrough; pressed only for the replay; disabled during a job)', () => {
    const play = () => one(byClass(one(byClass(bottom, 'plan-bottom__line')), 'hl-tl__play'))
    const scrub = () => one(byClass(bottom, 'plan-scrub'))
    // the flythrough drives the clock: the clock plays, the slim Play is not pressed
    let flyStops = 0
    act(() => {
      start('flythrough', () => {
        flyStops++
        missionClock.pause()
      })
      missionClock.play()
    })
    expect(scrub().getAttribute('data-state')).toBe('playing')
    expect(play().getAttribute('aria-pressed')).toBe('false')
    // Play stops the flythrough and starts the replay (it does not just pause the clock)
    act(() => void play().dispatch('click'))
    expect(flyStops).toBe(1)
    expect(activity.current.peek()).toBe('replay')
    expect(missionClock.playing).toBe(true)
    expect(play().getAttribute('aria-pressed')).toBe('true')
    act(() => void play().dispatch('click'))
    expect(activity.current.peek()).toBe(null)
    expect(missionClock.playing).toBe(false)
    expect(scrub().getAttribute('data-state')).toBe('paused')
    // a compute job runs: Play is disabled with the store's reason and starts nothing
    act(() => void beginJob('probe'))
    expect(play().getAttribute('disabled')).not.toBe(null)
    expect(play().getAttribute('data-activity-reason')).toBe('activity.reason.jobRunning')
    act(() => void play().dispatch('click'))
    expect(missionClock.playing).toBe(false)
    act(() => endJob('probe'))
    expect(play().getAttribute('data-activity-reason')).toBe(null)
  })

  it('expanded: the plan table shows the claimed section nodes; the timeline tab shows the dock body', () => {
    setDockContent(() => <div class="probe-dock">dock</div>)
    act(() => openContainer(PLAN_BOTTOM, null))
    const drawer = one(byClass(bottom, 'hl-lay-bottom'))
    expect(drawer.getAttribute('data-open')).toBe('true')
    expect(byId(`hl-lay-${PLAN_BOTTOM}-tab-${TAB_TABLE}`).getAttribute('aria-selected')).toBe('true') // default tab
    expect(byId(`hl-lay-${PLAN_BOTTOM}-tab-${TAB_TIMELINE}`).getAttribute('aria-selected')).toBe('false')
    const table = one(byClass(drawer, 'plan-table'))
    for (const n of TABLE_SECTIONS) expect(table.contains(section(n))).toBe(true)
    expect(byClass(drawer, 'hl-tl__play')).toHaveLength(0) // the collapsed line is gone while expanded
    act(() => setActiveTab(PLAN_BOTTOM, TAB_TIMELINE))
    expect(byClass(drawer, 'plan-table')).toHaveLength(0)
    expect(one(byClass(drawer, 'plan-timeline')).contains(one(byClass(drawer, 'probe-dock')))).toBe(true)
    expect(dockContent.value).toBeDefined()
    act(() => closeContainer(PLAN_BOTTOM))
    expect(drawer.getAttribute('data-open')).toBe('false')
    expect(byClass(drawer, 'hl-tl__play')).toHaveLength(1)
  })

  it('writes the drawer height to the shell root for overlay side panels (RR1 issue 1)', () => {
    // the drawer's measured height (offsetHeight in a browser; 0 in the fake DOM)
    act(() => reportInset(PLAN_BOTTOM, { bottom: 40 }))
    expect(shellEl.style['--hl-plan-bottom']).toBe('40px')
    act(() => reportInset(PLAN_BOTTOM, { bottom: 0 }))
    act(() => stop())
    stop = () => {}
    expect(shellEl.style['--hl-plan-bottom'] ?? '').toBe('')
  })
})
