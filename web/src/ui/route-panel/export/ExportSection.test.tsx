// PORT U4: the export section with the bridge mocked: one primary button that is "Download mission.json"
// until MARVIS answers, then "Send to MARVIS" (POST, no download); failures say why and offer Download;
// the share link is copied with a confirmation, or shown selected without a clipboard.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlanningStore, makeStop, OFFICIAL_PAD_ID, planningHref } from '../../../state/planning'
import { byTag, installDom, type FakeNode } from '../../testing/dom'
import type { ExportCore } from './core'
import { ExportError } from './core'
import { ExportSection } from './ExportSection'
import type { MarvisDeps } from './marvis'
import { applyPlanLink, clearPlanLinkNotice } from './planLink'

let root: FakeNode
beforeEach(() => {
  ;({ container: root } = installDom())
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  clearPlanLinkNotice()
})

const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
const buttons = () => byTag(root, 'button')
const action = (a: string) => buttons().find((b) => b.getAttribute('data-export-action') === a)
const section = () => byTag(root, 'div').find((n) => n.hasAttribute('data-u4-export'))!
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}
async function click(n: FakeNode | undefined) {
  expect(n).toBeTruthy()
  await act(async () => void n!.dispatch('click'))
  await settle()
}

const ROUTE_DOC = { kind: 'homeline_mission', mission_id: 'm-0123456789ab', origin_label: 'Estimate · browser, 5 m grid · not part of the validated scorecard' }
const OFFICIAL_TEXT = '{"kind": "homeline_mission", "mission_id": "m-d32c8e0e7c20"}'
function fakeCore(fail?: ExportError): ExportCore & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async routeMission(doc) {
      calls.push(`route:${doc.padId}:${doc.route.stops.length}`)
      if (fail) throw fail
      return ROUTE_DOC
    },
    async officialMission(padId) {
      calls.push(`official:${padId}`)
      return { doc: JSON.parse(OFFICIAL_TEXT) as Record<string, unknown>, text: OFFICIAL_TEXT }
    },
  }
}
const marvis = (p: Partial<MarvisDeps> = {}) => ({ detect: vi.fn(async () => false), inViewer: () => false, send: vi.fn(async () => ({ ok: true })), ...p })

function mount(props: Parameters<typeof ExportSection>[0]) {
  act(() => render(<ExportSection {...props} />, root as unknown as Element))
}

describe('ExportSection', () => {
  it('MARVIS not reachable: ONE primary button "Download mission.json"; no route = the official plan, saved under its file name', async () => {
    const store = createPlanningStore()
    const save = vi.fn()
    const core = fakeCore()
    const m = marvis()
    mount({ store, core, marvis: m, save })
    await settle()
    expect(buttons().filter((b) => (b.getAttribute('class') ?? '').includes('hl-btn--primary'))).toHaveLength(1)
    expect(text(action('download')!)).toBe('Download mission.json')
    expect(section().getAttribute('data-source')).toBe('official')
    await click(action('download'))
    expect(core.calls).toEqual([`official:${OFFICIAL_PAD_ID}`])
    expect(save).toHaveBeenCalledWith(OFFICIAL_TEXT, 'homeline-mission-d32c8e0e.json')
    expect(m.send).not.toHaveBeenCalled()
    expect(text(root)).toContain('Saved as homeline-mission-d32c8e0e.json')
  })

  it('the panel does not wait for the probe: Download at once, Send to MARVIS when MARVIS answers', async () => {
    let answer!: (v: boolean) => void
    const m = marvis({ detect: vi.fn(() => new Promise<boolean>((r) => (answer = r))) })
    mount({ store: createPlanningStore(), core: fakeCore(), marvis: m, save: vi.fn() })
    expect(text(action('download')!)).toBe('Download mission.json')
    await act(async () => answer(true))
    await settle()
    expect(action('download')).toBeUndefined()
    expect(text(action('marvis')!)).toBe('Send to MARVIS')
    expect(section().getAttribute('data-target')).toBe('api')
  })

  it('MARVIS available: sends your route (no download) and says MARVIS starts the EVA', async () => {
    const store = createPlanningStore()
    store.addStop({ kind: 'station', station: 'S4' })
    const save = vi.fn()
    const core = fakeCore()
    const m = marvis({ detect: vi.fn(async () => true) })
    mount({ store, core, marvis: m, save })
    await settle()
    expect(section().getAttribute('data-source')).toBe('route')
    await click(action('marvis'))
    expect(core.calls).toEqual([`route:${OFFICIAL_PAD_ID}:1`])
    expect(m.send).toHaveBeenCalledWith(ROUTE_DOC)
    expect(save).not.toHaveBeenCalled()
    expect(text(root)).toContain('Sent: MARVIS starts the EVA.')
  })

  it('MARVIS refuses: the reason, and "Download mission.json instead" still exports', async () => {
    const store = createPlanningStore()
    store.addStop({ kind: 'station', station: 'S4' })
    const save = vi.fn()
    const m = marvis({ detect: vi.fn(async () => true), send: vi.fn(async () => ({ ok: false, error: 'pad mismatch' })) })
    mount({ store, core: fakeCore(), marvis: m, save })
    await settle()
    await click(action('marvis'))
    expect(text(root)).toContain('MARVIS did not start the EVA: pad mismatch')
    await click(action('download-fallback'))
    expect(save).toHaveBeenCalledWith(JSON.stringify(ROUTE_DOC, null, 1), 'homeline-mission-01234567.json')
  })

  it("inside MARVIS's planner window: Send to MARVIS = the download the window catches", async () => {
    const save = vi.fn()
    const m = marvis({ inViewer: () => true, detect: vi.fn(() => new Promise<boolean>(() => {})) })
    mount({ store: createPlanningStore(), core: fakeCore(), marvis: m, save })
    await click(action('marvis'))
    expect(save).toHaveBeenCalledTimes(1)
    expect(m.send).not.toHaveBeenCalled()
    expect(text(root)).toContain('Sent: MARVIS starts the EVA.')
  })

  it('an export error is shown, not thrown', async () => {
    const store = createPlanningStore()
    store.addStop({ kind: 'station', station: 'S99' })
    mount({ store, core: fakeCore(new ExportError('route', 'S99 unknown station')), marvis: marvis(), save: vi.fn() })
    await settle()
    await click(action('download'))
    expect(text(root)).toContain('The route cannot be exported yet: S99 unknown station')
  })

  it('share link: copied with a confirmation; the copied URL is the planning href', async () => {
    const store = createPlanningStore()
    store.addStop(makeStop({ kind: 'station', station: 'S1' }))
    const writeText = vi.fn(async () => {})
    mount({ store, core: fakeCore(), marvis: marvis(), save: vi.fn(), clipboard: { writeText }, loc: { origin: 'https://x.org', pathname: '/', search: '' } })
    await click(action('share'))
    expect(writeText).toHaveBeenCalledWith(`https://x.org/${planningHref(store.doc.peek())}`)
    expect(text(root)).toContain('Link copied')
  })

  it('share link without a clipboard: the link is shown in a read-only field to copy by hand', async () => {
    const store = createPlanningStore()
    mount({ store, core: fakeCore(), marvis: marvis(), save: vi.fn(), clipboard: null, loc: null })
    await click(action('share'))
    const input = byTag(root, 'input').find((n) => n.getAttribute('data-share') === 'select')
    expect(input).toBeTruthy()
    const n = input as unknown as { value?: string; getAttribute(k: string): string | null }
    expect(n.value ?? n.getAttribute('value')).toBe('#/')
  })

  it('an invalid plan link shows its notice in the section', async () => {
    const store = createPlanningStore()
    mount({ store, core: fakeCore(), marvis: marvis(), save: vi.fn() })
    expect(text(root)).not.toContain('This link could not be read')
    // the default IO publishes the notice signal the section shows
    await act(async () => void applyPlanLink('#/?route=WzMsIngiXQ', store))
    expect(text(root)).toContain('This link could not be read')
  })
})

describe('install', () => {
  it("fills U1's 'export' region and unregisters", async () => {
    const { resetRoutePanelSections, useRoutePanelSection } = await import('../sections')
    const { install } = await import('./index')
    let seen: unknown
    const Probe = () => {
      seen = useRoutePanelSection('export')
      return null
    }
    const off = install()
    act(() => render(<Probe />, root as unknown as Element))
    expect(seen).toBe(ExportSection)
    off()
    act(() => render(<Probe />, root as unknown as Element))
    expect(seen).toBeUndefined()
    resetRoutePanelSections()
  })
})
