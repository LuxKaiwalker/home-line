/**
 * L7b (D111): blocking usability fixes, checked on the built app (both viewport projects).
 *   T9  one visible "Official plan" action in the Plan top bar: disabled with its reason while the
 *       official plan is shown; after a rover move (kept, or a draft left open) it returns the rover
 *       to the official pad, discards the draft and clears the selection.
 *   T2  the rover drag readout is truthful about the live planner (seam: the `hl:live-status`
 *       window event of src/state/live.ts, which the live layer sets): live off = the static snap
 *       text; live ready = "Release to snap to a parking option · for a custom spot, click the map
 *       (live planner)"; never a "computing…" row that never computes.
 *   T2  dropping next to P5 (pad_default) says why P5 is refused (the browser spot check) while
 *       snapping elsewhere, as before.
 * L2d (D111): the delta strip ("What this change costs") is in the rover card on the map (#hl-lay-rover).
 * Not a screenshot test. Run: cd web && npm run build && npx playwright test tests/visual/official-plan.spec.ts
 */
import { expect, test, type Page } from 'playwright/test'

type Pt = { x: number; y: number }

const OFFICIAL_BTN = '.hl-topbar__plan .hl-officialplan button'
const STATIC_SNAP = 'Live planning is offline: the rover snaps between the precomputed parking options'
const LIVE_SNAP = 'Release to snap to a parking option · for a custom spot, click the map (live planner)'

const roverEl = (page: Page) => page.locator('.hl-edit-rover')
const card = (page: Page) => page.locator('.hl-sidebar__body')
/** L2d (D111): the delta strip shows in the rover card on the map (#hl-lay-rover), not the sidebar */
const strip = (page: Page) => page.locator('#hl-lay-rover')
const noStrip = (page: Page, timeout = 5_000) => expect(page.locator('.hl-edit-delta')).toHaveCount(0, { timeout })

async function center(page: Page): Promise<Pt> {
  const b = (await roverEl(page).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Screen point of a labels.json label (PAD = the official pad, P5 = pad_default): its 0 × 0 marker
 * element sits exactly on the label's lon/lat (MapLibre's translate, read even while the pill is hidden).
 */
async function pointOf(page: Page, code: string): Promise<Pt> {
  return page.evaluate((c) => {
    const el = document.querySelector<HTMLElement>(`.hl-label[data-code="${c}"]`)
    const map = el?.closest('.maplibregl-map')
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el?.style.transform ?? '')
    if (!el || !map || !m) throw new Error(`no label ${c}`)
    const r = map.getBoundingClientRect()
    return { x: r.left + Number(m[1]), y: r.top + Number(m[2]) }
  }, code)
}

async function open(page: Page): Promise<Pt> {
  await page.goto('/?intro=0#/')
  await roverEl(page).waitFor({ timeout: 60_000 })
  await expect(roverEl(page)).toHaveAttribute('data-select-pad', 'rank1')
  return settled(page)
}

/** The rover's screen position once the map has stopped moving (first camera ease, layout). */
async function settled(page: Page): Promise<Pt> {
  let last = await center(page)
  let same = 0
  for (let i = 0; i < 80 && same < 4; i++) {
    await page.waitForTimeout(250)
    const now = await center(page)
    same = dist(now, last) < 0.5 ? same + 1 : 0
    last = now
  }
  return last
}

/** Press on the rover and move it to `to` without releasing (the readout shows while held). */
async function hold(page: Page, from: Pt, to: Pt): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 16 })
  await expect(roverEl(page)).toHaveClass(/is-dragging/)
  await expect(page.locator('.hl-edit-drag')).toBeVisible({ timeout: 5_000 })
}

test('T9: "Official plan" is disabled with its reason on the official plan, and brings a kept rover move back', async ({ page }) => {
  const at = await open(page)
  expect(dist(at, await pointOf(page, 'PAD')), 'rover on the official pad').toBeLessThan(3)
  const btn = page.locator(OFFICIAL_BTN)
  await expect(btn).toBeVisible()
  await expect(btn).toHaveText('Official plan')
  await expect(btn).toBeDisabled()
  await expect(btn).toHaveAttribute('title', 'Already showing the official plan')
  await expect(page.locator('.hl-officialplan')).toHaveAttribute('title', 'Already showing the official plan')

  // move the rover and keep it (Enter)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x - 60, at.y + 10, { steps: 12 })
  await page.mouse.up()
  await expect(strip(page)).toContainText('What this change costs', { timeout: 10_000 })
  await expect(btn).toBeEnabled() // an open draft already differs
  await page.keyboard.press('Enter')
  await noStrip(page)
  await expect(roverEl(page)).not.toHaveAttribute('data-select-pad', 'rank1')
  await expect(btn).toBeEnabled()
  await expect(btn).toHaveAttribute('title', /^Back to the official plan/)
  expect(dist(await settled(page), await pointOf(page, 'PAD'))).toBeGreaterThan(5)

  // select something, then return to the official plan
  await roverEl(page).click()
  await expect(card(page)).toContainText('Parking option', { timeout: 5_000 })
  await btn.click()
  await expect(roverEl(page)).toHaveAttribute('data-select-pad', 'rank1')
  await expect(btn).toBeDisabled()
  // the rover sits on the official pad again (the camera may have moved with the selection)
  await expect.poll(async () => dist(await settled(page), await pointOf(page, 'PAD')), { timeout: 10_000 }).toBeLessThan(3)
  await expect(card(page)).not.toContainText('Parking option')
  await noStrip(page)
})

test('T9: "Official plan" discards a released draft that was not kept', async ({ page }) => {
  const at = await open(page)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x - 60, at.y + 10, { steps: 12 })
  await page.mouse.up()
  await expect(strip(page)).toContainText('What this change costs', { timeout: 10_000 })
  await page.locator(OFFICIAL_BTN).click()
  await noStrip(page)
  await expect(page.locator(OFFICIAL_BTN)).toBeDisabled()
  await expect.poll(async () => dist(await settled(page), await pointOf(page, 'PAD')), { timeout: 10_000 }).toBeLessThan(3)
})

test('T2: the drag readout is truthful about the live planner (off vs ready), with no "computing…" rows', async ({ page }) => {
  const at = await open(page)
  const readout = page.locator('.hl-edit-drag')
  // live off (static build, nothing reported)
  await hold(page, at, { x: at.x - 60, y: at.y + 10 })
  await expect(readout).toHaveAttribute('data-live', 'off')
  await expect(readout.locator('.hl-edit-drag__snap')).toContainText(STATIC_SNAP)
  await expect(readout).not.toContainText('computing')
  await expect(readout.locator('.hl-edit-pending')).toHaveCount(2)
  await expect(readout.locator('.hl-edit-pending').first()).toContainText('on release')
  // L6: the readout is compact and clear of the drop point (the pointer)
  const box = (await readout.boundingBox())!
  const drop = { x: at.x - 60, y: at.y + 10 }
  expect(box.width).toBeLessThanOrEqual(320)
  expect(box.height).toBeLessThanOrEqual(240)
  expect(box.x > drop.x + 12 || box.y > drop.y + 12, `readout ${JSON.stringify(box)} clear of the drop point ${JSON.stringify(drop)}`).toBe(true)
  await page.mouse.up()
  await page.keyboard.press('Escape')
  await noStrip(page)

  // live ready (what the live layer reports through the seam)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hl:live-status', { detail: 'ready' })))
  const at2 = await center(page)
  await hold(page, at2, { x: at2.x - 60, y: at2.y + 10 })
  await expect(readout).toHaveAttribute('data-live', 'ready')
  await expect(readout.locator('.hl-edit-drag__snap')).toContainText(LIVE_SNAP)
  await expect(readout).not.toContainText('offline')
  await expect(readout).not.toContainText('computing')
  await page.mouse.up()
  await expect(strip(page)).toContainText('What this change costs', { timeout: 10_000 })
  await expect(card(page)).not.toContainText(STATIC_SNAP)

  // and unreachable again: back to the static text
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hl:live-status', { detail: 'offline' })))
  const at3 = await center(page)
  await hold(page, at3, { x: at3.x - 60, y: at3.y + 10 })
  await expect(readout.locator('.hl-edit-drag__snap')).toContainText(STATIC_SNAP)
  await page.mouse.up()
})

test('T2: dropping next to P5 says why P5 is refused, and the rover still snaps to a valid pad', async ({ page }) => {
  await open(page)
  // P5 lies ~4 km south-west of the official pad: zoom out (wheel, over the map centre) until it is on the map
  const canvas = (await page.locator('.maplibregl-canvas').first().boundingBox())!
  const inside = (p: Pt) => p.x > canvas.x + 20 && p.x < canvas.x + canvas.width - 20 && p.y > canvas.y + 20 && p.y < canvas.y + canvas.height - 20
  for (let i = 0; i < 6 && !inside(await pointOf(page, 'P5')); i++) {
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    await page.mouse.wheel(0, 300)
    await settled(page)
  }
  const target = await pointOf(page, 'P5')
  expect(inside(target), `P5 ${JSON.stringify(target)} on the map ${JSON.stringify(canvas)}`).toBe(true)
  const start = await settled(page)
  await hold(page, start, target)
  const refused = page.locator('.hl-edit-drag__refused')
  await expect(refused).toHaveAttribute('data-refused', 'pad_default')
  await expect(refused).toHaveText(/^P5 is not a valid rover pad: slope up to \d+\.\d° on the 20 × 20 m block \(limit 5°\)/)
  // snapping unchanged: the target is another pad
  await expect(page.locator('.hl-edit-drag__snap')).not.toContainText('P5')
  await page.mouse.up()
  await expect(strip(page)).toContainText('What this change costs', { timeout: 10_000 })
  await expect(roverEl(page)).not.toHaveAttribute('data-select-pad', 'pad_default')
  await page.keyboard.press('Escape')
})
