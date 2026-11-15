/**
 * Plan-port e2e helpers (Q1): selectors of the new planning flow and small page drivers.
 *
 * Selectors are the data-* / BEM hooks the wave-1 packages already render (read from their branches,
 * 20:40), so I1 only has to wire the pieces; the few hooks that do not exist yet are marked
 * "TODO(I1)" / "TODO(I4)" and listed in /tmp/hl-port/requests-I1.md under "Q1 test ids".
 * Share links are built with the app's own codec (web/src/state/planningUrl.ts), so the tests follow
 * the v2 format instead of restating it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Locator, type Page } from 'playwright/test'
import { EMPTY_ROUTE, makeStop, OFFICIAL_PAD_ID, type NewStop, type PadId, type PlanningDoc } from '../../../web/src/state/planning'
import { planningHref } from '../../../web/src/state/planningUrl'

export { OFFICIAL_PAD_ID }

const DATA = resolve(__dirname, '../../../web/public/data')

/** Picker pads with routing fields (interfaces.md §2: rank2..rank4 only). */
export const PICKER_PAD: PadId = 'rank2'

/** The pad label as the context bar / picker show it: the index label ("#2"), or P3's fallback ("P2"). */
export const padLabel = (id: PadId): RegExp => {
  const n = /^rank(\d+)$/.exec(id)?.[1]
  return n ? new RegExp(`(#|P)${n}\\b`) : /Official pad/
}

/** Station positions (public/data/stations.json): for v1 links and checks. */
export function stationsLonLat(): Record<string, { lon: number; lat: number }> {
  const raw = JSON.parse(readFileSync(resolve(DATA, 'stations.json'), 'utf8')) as unknown
  const list = (Array.isArray(raw) ? raw : (raw as { stations: unknown[] }).stations) as { id: string; lon: number; lat: number }[]
  return Object.fromEntries(list.map((s) => [s.id, { lon: s.lon, lat: s.lat }]))
}

/** The share-link hash of a pad + stops, by the app's codec ('#/?route=…'). */
export function routeHash(padId: PadId, stops: NewStop[], extra: Partial<PlanningDoc['route']> = {}): string {
  return planningHref({ padId, route: { ...EMPTY_ROUTE, ...extra, stops: stops.map((s) => makeStop(s)) } })
}
export const station = (id: string): NewStop => ({ kind: 'station', station: id })
export const point = (lon: number, lat: number): NewStop => ({ kind: 'point', lon, lat })

/** A legacy Mission Planer link value (mission/share.ts format v1: base64url JSON [1, [[lon, lat, stopMin, tagMask, note, station?]…]]).
 *  Restated here on purpose: mission/ is deleted at the end of wave 2, the old links must keep working. */
export function legacyPlanParam(stations: string[]): string {
  const at = stationsLonLat()
  const rows = stations.map((id) => [at[id].lon, at[id].lat, 0, 0, '', id])
  return Buffer.from(JSON.stringify([1, rows]), 'utf8').toString('base64url')
}

/** Selectors (owner package in brackets). */
export const S = {
  map: '.maplibregl-map canvas.maplibregl-canvas',
  camera: '[data-camera-center]', // map/input: data-camera-* on the map container
  modeTab: '.hl-modes__tab[aria-current="page"]',
  // pads [P2]
  padMark: (id: PadId) => `[data-pad-mark="${id}"]`, // pad marker button (is-active / is-loading, aria-current)
  padCard: (id: PadId) => `.hl-padcard[data-pad-card="${id}"]`,
  padCardPlan: '.hl-padcard__plan', // "Plan from here"
  padStatus: '.hl-padstatus', // "Loading pad …" over the map
  // context bar [P3]
  ctx: '.hl-ctx',
  ctxPad: '.hl-ctx__padname',
  ctxWhat: '.hl-ctx__what', // "Official plan" | "Your route"
  ctxPlanRoute: '.hl-ctx__plan', // "Plan a route" (hidden until I1 calls setPlanRouteAction)
  ctxEditRoute: '.hl-ctx__edit', // "Edit route": the same opener while a route of your own is shown (I5)
  ctxBad: '.hl-ctx__bad',
  // Route panel [U1]
  panel: '#hl-lay-route-panel',
  panelBody: '[data-route-panel]',
  padRadio: (id: PadId) => `[data-pad-picker] [role="radio"][data-pad="${id}"]`,
  estimates: '[data-estimates]', // TODO(I1): data-status="<RouteResults.status>" on this element (Q1 test ids)
  infeasibleCallout: '[data-infeasible-leg]',
  fastRoute: '[data-fast-route]',
  section: (n: 'list' | 'settings' | 'export') => `[data-route-section="${n}"]`,
  // waypoint list [U2]
  stopRows: '.rpl-list > li.rpl-row',
  stopRow: (stopId: string) => `.rpl-list > li.rpl-row[data-stop-id="${stopId}"]`,
  stopLabel: '.rpl-label',
  legBad: '.rpl-leg--bad',
  // map editing [R3]
  addToRoute: (st: string) => `[data-add-to-route="${st}"]`, // in the station card; [data-in-route] once added
  handles: '.hl-r3-handle[data-r3-stop]',
  handle: (stopId: string) => `.hl-r3-handle[data-r3-stop="${stopId}"]`,
  editNotice: '.hl-r3-notice',
  // route on the map [R4]
  mineStops: '.hl-r4-stop[data-route="mine"]',
  mineStopBad: '.hl-r4-stop[data-route="mine"][data-state="infeasible"]',
  // export / share [U4]
  exportBox: '[data-u4-export]',
  exportAction: (a: 'marvis' | 'download' | 'download-fallback' | 'share') => `[data-export-action="${a}"]`,
  shareSelect: '[data-share="select"]',
  // station marker + card (L2d)
  stationCard: '#hl-lay-station',
  // bottom drawer (L5) + D142
  bottom: '#hl-lay-plan-bottom',
  comparePlans: '[data-testid="plan-compare-plans"]', // TODO(I1): D142 "Compare plans" link -> #/trade (Q1 test ids)
} as const

/** Open the Plan page (#/ or a share-link hash) of the built app and wait for its map. */
export async function openPlan(page: Page, hash = '#/', query = 'intro=0'): Promise<void> {
  await page.goto(`/?${query}${hash}`)
  await expect(page.locator(S.map).first()).toBeVisible({ timeout: 60_000 })
}

/** Collect page errors (uncaught exceptions) for the whole test. */
export function pageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

/** MARVIS unreachable: its bridge probe (/marvis/api/hello) answers 503, so the export target stays "download". */
export async function marvisUnreachable(page: Page): Promise<void> {
  await page.route('**/marvis/api/**', (r) => r.fulfill({ status: 503, body: '' }))
}

/** The Route panel, open (via the context bar's "Plan a route", or "Edit route" with a route of your own, when it is closed). */
export async function openRoutePanel(page: Page): Promise<Locator> {
  const panel = page.locator(S.panel)
  if (!(await panel.isVisible())) await page.locator(`${S.ctxPlanRoute}, ${S.ctxEditRoute}`).click()
  await expect(panel).toBeVisible()
  return panel
}

/** Station names as the list shows them (config/stations.yaml `name`; U2 shows a station's name when it has one). */
export function stationNames(): Map<string, string> {
  const yaml = readFileSync(resolve(__dirname, '../../../config/stations.yaml'), 'utf8')
  const out = new Map<string, string>()
  for (const m of yaml.matchAll(/^\s*- id: (\S+)\s*\n\s+name: "([^"]+)"/gm)) out.set(m[2], m[1])
  return out
}

/** Stop labels in list order (U2), station names mapped back to their ids (S1, …), W1… as shown. */
export async function stopLabels(page: Page): Promise<string[]> {
  const byName = stationNames()
  return (await page.locator(`${S.stopRows} ${S.stopLabel}`).allInnerTexts()).map((l) => byName.get(l.trim()) ?? l)
}

/** The Plan bottom drawer (plan table + timeline), expanded. */
export async function openBottomDrawer(page: Page): Promise<void> {
  const grip = page.locator(`button[aria-controls="${S.bottom.slice(1)}"]`) // the drawer's grip (ui/layout/BottomDrawer)
  if ((await grip.getAttribute('aria-expanded')) === 'false') await grip.click()
  await expect(grip).toHaveAttribute('aria-expanded', 'true')
}

/** Wait until the route results are final (U1 estimates card; needs the data-status hook). */
export async function routeReady(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.locator(S.estimates)).toHaveAttribute('data-status', 'ready', { timeout })
}

/** The station marker pill on the map (button "S7: …"). */
export const stationMarker = (page: Page, id: string): Locator => page.getByRole('button', { name: new RegExp(`^${id}: `) })

/** A spot on the map with nothing on it (no marker, pill or control under the pointer); from tests/visual/map-input.spec.ts. */
export async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator(S.map).first().boundingBox())!
  for (const [fx, fy] of [
    [0.45, 0.6],
    [0.55, 0.45],
    [0.4, 0.4],
    [0.6, 0.6],
    [0.5, 0.7],
    [0.35, 0.55],
  ]) {
    const x = box.x + box.width * fx
    const y = box.y + box.height * fy
    const free = await page.evaluate(
      ([x, y]) => {
        for (let dx = -40; dx <= 40; dx += 10)
          for (let dy = -30; dy <= 30; dy += 10) {
            const el = document.elementFromPoint(x + dx, y + dy)
            if (!el?.classList.contains('maplibregl-canvas')) return false
          }
        return true
      },
      [x, y],
    )
    if (free) return { x, y }
  }
  throw new Error('no empty spot on the map')
}

/** Left drag with intermediate moves (MapLibre and R3 need mousemove events between down and up). */
export async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8)
  await page.mouse.up()
}

/** Ctrl+Z / Cmd+Z (and the redo pair) as the platform has it. */
export const UNDO = 'ControlOrMeta+z'
export const REDO = 'ControlOrMeta+Shift+z'
