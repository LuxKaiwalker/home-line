// Shared helpers and the selector contract of the planning-UI acceptance checks (package L5, D111).
//
// SELECTOR CONTRACT (agreed with L1's container API, web/src/ui/layout/): the tests find containers by
// the layout-store id the caller passes to Drawer / BottomDrawer / MarkerCard / Popover / Collapsible.
// L1 renders each container's element with id `hl-lay-<id>` (store.ts domId) and every opener carries
// aria-controls="hl-lay-<id>" (useOpener, Popover icon button, BottomDrawer grip, Collapsible button).
// So the hook is the id; no extra data-* attribute is needed. The ids L2/L3 must use:
//   edit-route  Drawer (right)        "Edit route" opener at the map edge, live builds only    L3
//   plan-bottom BottomDrawer           tabs `plan-table` and `timeline`; collapsed = slim scrubber L2
//   layers      Popover (map edge)     layer and overlay manager (U7 + console layer groups)     L2
//   legend      Popover (corner chip)  legend                                                    L2
//   station     MarkerCard or Drawer   station card, one at a time                               L2
//   rover       MarkerCard             pad tool / drag readout / delta strip                     L3 (+L7b)
//   crew        Collapsible            inside edit-route, collapsed by default                   L3
//   my-plans    Collapsible            inside edit-route                                         L3
// Other hooks: the headline strip lives in #hl-topbar-plan with one .hl-chip per number (L2); the
// "Official plan" action is a button named copy nav.officialPlan (L7b); "Send to simulator" is named
// copy simulator.sendSlot (A5s, inside edit-route, L3); the live status line is .live-status[data-state].
import { expect, test, type Locator, type Page } from 'playwright/test'
import copy from '../../src/ui/copy.json' with { type: 'json' }

export { copy }
export type Build = 'static' | 'live' | 'livedown'

/** The build the current project runs on (playwright.config.ts metadata). */
export const build = (): Build => test.info().project.metadata.build as Build
export const isLiveBuild = (b: Build = build()): boolean => b !== 'static'

export const IDS = {
  editRoute: 'edit-route',
  bottom: 'plan-bottom',
  planTable: 'plan-table',
  timeline: 'timeline',
  layers: 'layers',
  legend: 'legend',
  station: 'station',
  rover: 'rover',
  crew: 'crew',
  myPlans: 'my-plans',
} as const

/** Same as web/src/ui/layout/store.ts domId (copied: the tests run against the built app). */
export const domId = (id: string, part = ''): string => `hl-lay-${id.replace(/[^A-Za-z0-9_-]/g, '_')}${part ? `-${part}` : ''}`
/** The container element of a layout id (drawer / card / popover panel / bottom drawer body / section body). */
export const container = (page: Page, id: string): Locator => page.locator(`#${domId(id)}`)
/** The visible element that opens / closes it. */
export const opener = (page: Page, id: string): Locator => page.locator(`[aria-controls="${domId(id)}"]`).filter({ visible: true }).first()
/** A tab of the bottom drawer. */
export const bottomTab = (page: Page, tab: string): Locator => page.locator(`#${domId(IDS.bottom, `tab-${tab}`)}`)

export const LAYOUT_KEY = 'hl.layout.v1'
const MAP_SETTLE_MS = 2_000

/**
 * Open the Plan view with the intro off and wait until the map, the rover and (live builds) the live
 * health state are there. Same page as L0's baseline (`/?intro=0#/`).
 */
export async function gotoPlan(page: Page, query = 'intro=0'): Promise<void> {
  await page.goto(`/?${query}#/`)
  await page.locator('.hl-edit-rover').waitFor({ timeout: 60_000 })
  const b = build()
  if (b === 'live') await page.locator('.live-status[data-state="ready"]').waitFor({ state: 'attached', timeout: 30_000 })
  if (b === 'livedown') await page.locator('.live-status[data-state="offline"]').waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(MAP_SETTLE_MS) // late layout (labels, live mounts) as in L0's 6 s settle
}

/** Make every localStorage access throw, as with blocked site data (before any page script runs). */
export async function blockStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, get: blocked })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: blocked })
  })
}

/** Uncaught page errors (collect from the start). */
export function pageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return errors
}

// ------------------------------------------------------------------ map coverage (L0 method)

export interface Coverage {
  /** % of the work area (viewport below the top bar) where the top element is not the map */
  coveredPct: number
  /** covered % by container, for the report */
  by: Record<string, number>
  workArea: [number, number]
}

/**
 * L0's method (/tmp/hl-design/notes/L0-shots.mjs, docs/design/layout-declutter.md §2): a grid of points
 * every 8 px over the work area (viewport below .hl-topbar) is hit-tested with elementFromPoint; a point
 * is map when the top element is a map canvas (.console-map / .maplibregl-map / HUD stage) or a map
 * marker or label, else covered and attributed to its container. Side-by-side asides count the same as
 * overlays. Limit: pointer-events:none elements are invisible to the hit test.
 */
export async function measureCoverage(page: Page): Promise<Coverage> {
  return page.evaluate(() => {
    const top = document.querySelector('.hl-topbar')?.getBoundingClientRect().bottom ?? 0
    const W = innerWidth
    const H = innerHeight
    const step = 8
    const buckets: Record<string, number> = {}
    let n = 0
    let map = 0
    const KNOWN = /^(hl-lay-|hl-rail|hl-sidebar|hl-dock|console-live|console-panel|maplibregl-ctrl-|hl-shell__overlay|dummy-banner|live-status|hl-hud|outlet)/
    const name = (el: Element): string => {
      const k = el.closest('.hl-lay-drawer, .hl-lay-bottom, .hl-lay-card, .hl-lay-pop, .hl-rail, .hl-sidebar, .hl-dock, .console-live, .console-panel, .maplibregl-ctrl-top-left, .maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right, .hl-shell__overlay, .dummy-banner, .live-status, [class*="hud"], .outlet')
      if (!k) return `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className ?? '')}`
      return [...k.classList].find((x) => KNOWN.test(x)) ?? String(k.className)
    }
    for (let y = top + step / 2; y < H; y += step)
      for (let x = step / 2; x < W; x += step) {
        n++
        const el = document.elementFromPoint(x, y)
        if (!el) {
          buckets['(none)'] = (buckets['(none)'] ?? 0) + 1
          continue
        }
        const isMap = (el.tagName === 'CANVAS' && el.closest('.console-map, .maplibregl-map, .hl-hud-stage, [class*="stage"]')) || el.closest('.maplibregl-marker, .hl-label, .maplibregl-canvas-container')
        if (isMap) {
          map++
          continue
        }
        const b = name(el)
        buckets[b] = (buckets[b] ?? 0) + 1
      }
    const pct = (v: number) => Math.round((1000 * v) / n) / 10
    const by = Object.fromEntries(Object.entries(buckets).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v)]))
    return { coveredPct: n ? Math.round(1000 - (1000 * map) / n) / 10 : 100, by, workArea: [W, Math.round(H - top)] as [number, number] }
  })
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The map region: .console-map clipped to the work area. */
export async function mapBox(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const top = document.querySelector('.hl-topbar')?.getBoundingClientRect().bottom ?? 0
    const r = (document.querySelector('.console-map') ?? document.querySelector('.maplibregl-map'))!.getBoundingClientRect()
    const y0 = Math.max(r.top, top)
    const y1 = Math.min(r.bottom, innerHeight)
    const x0 = Math.max(r.left, 0)
    const x1 = Math.min(r.right, innerWidth)
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
  })
}

/**
 * Share of the map width and height left visible by the open layout drawers: the free rectangle from
 * the map's top-left corner to the nearest right-anchored container (.hl-lay-drawer--right) and the
 * nearest bottom-anchored one (.hl-lay-bottom, its collapsed bar included). Pure geometry, see
 * visibleShare() in ./coverage-math.ts (unit-tested).
 */
export async function drawerObstacles(page: Page): Promise<{ right: Box[]; bottom: Box[] }> {
  return page.evaluate(() => {
    const boxes = (sel: string) =>
      [...document.querySelectorAll<HTMLElement>(sel)]
        .filter((e) => !e.hidden && e.offsetParent !== null)
        .map((e) => {
          const r = e.getBoundingClientRect()
          return { x: r.left, y: r.top, width: r.width, height: r.height }
        })
        .filter((b) => b.width > 0 && b.height > 0)
    return { right: boxes('.hl-lay-drawer--right'), bottom: boxes('.hl-lay-bottom') }
  })
}

// ------------------------------------------------------------------ interaction helpers

/** Counts real clicks so a test can assert "≤ 2 clicks". */
export class Clicks {
  n = 0
  async click(target: Locator): Promise<void> {
    await target.click({ timeout: 5_000 })
    this.n++
  }
}

/** Press Tab until `target` has focus (fails after `max` presses). Returns the number of presses. */
export async function tabTo(page: Page, target: Locator, max = 80): Promise<number> {
  await target.waitFor({ state: 'visible', timeout: 10_000 })
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false)) return i
  }
  throw new Error(`not reached by Tab in ${max} presses`)
}

/** Focus is on `target` (or inside it). */
export async function expectFocused(target: Locator): Promise<void> {
  await expect.poll(() => target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)), { timeout: 5_000 }).toBe(true)
}

/** Centre of the rover marker. */
export async function roverAt(page: Page): Promise<{ x: number; y: number }> {
  const b = (await page.locator('.hl-edit-rover').boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/**
 * A plan change the user can undo or leave: drag the rover 60 px with the left button (I1 mapping,
 * D114: left drags objects) and release; the change summary ("What this change costs") follows.
 */
export async function dragRover(page: Page, dx = -60, dy = 10): Promise<void> {
  const at = await roverAt(page)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 })
  await expect(page.locator('.hl-edit-rover')).toHaveClass(/is-dragging/)
  await page.mouse.up()
}

/** The live job's result block of the Edit-route panel (R5). */
export const routeResult = (page: Page): Locator => page.locator('.hl-route__result[data-trust="live"]')

/**
 * Show the Edit-route panel: through the D111 opener once L3 has landed, else the R5 rail section the
 * live build has today (so the "Computed live" check runs before and after L3).
 */
export async function showEditRoute(page: Page): Promise<void> {
  const op = page.locator(`[aria-controls="${domId(IDS.editRoute)}"]`).filter({ visible: true })
  if (await op.count()) {
    if ((await op.first().getAttribute('aria-expanded')) !== 'true') await op.first().click()
  }
  await page.locator('.hl-route__compute').filter({ visible: true }).first().waitFor({ timeout: 15_000 })
}
