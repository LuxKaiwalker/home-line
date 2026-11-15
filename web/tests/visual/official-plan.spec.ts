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
 * Not a screenshot test. Run: cd web && npm run build && npx playwright test tests/visual/official-plan.spec.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from 'playwright/test'

type Pt = { x: number; y: number }
const PADS = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../public/data/scenarios/pads/index.json'), 'utf8')).pads as { id: string; lon: number; lat: number }[]
const pad = (id: string) => PADS.find((p) => p.id === id)!

const OFFICIAL_BTN = '.hl-topbar__plan .hl-officialplan button'
const STATIC_SNAP = 'Live planning is offline: the rover snaps between the precomputed parking options'
const LIVE_SNAP = 'Release to snap to a parking option · for a custom spot, click the map (live planner)'

const roverEl = (page: Page) => page.locator('.hl-edit-rover')
const card = (page: Page) => page.locator('.hl-sidebar__body')

async function center(page: Page): Promise<Pt> {
  const b = (await roverEl(page).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** Centre of the map canvas: the map keeps its centre lon/lat when the sidebar opens or closes. */
async function mapCenter(page: Page): Promise<Pt> {
  const b = (await page.locator('.maplibregl-canvas').first().boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** The rover relative to the map centre (independent of the sidebar resizing the map). */
async function rel(page: Page): Promise<Pt> {
  const [r, m] = await Promise.all([center(page), mapCenter(page)])
  return { x: r.x - m.x, y: r.y - m.y }
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

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
  const home = await rel(page)
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
  await expect(card(page)).toContainText('What this change costs', { timeout: 10_000 })
  await expect(btn).toBeEnabled() // an open draft already differs
  await page.keyboard.press('Enter')
  await expect(card(page)).not.toContainText('What this change costs', { timeout: 5_000 })
  await expect(roverEl(page)).not.toHaveAttribute('data-select-pad', 'rank1')
  await expect(btn).toBeEnabled()
  await expect(btn).toHaveAttribute('title', /^Back to the official plan/)
  expect(dist(await rel(page), home)).toBeGreaterThan(5)

  // select something, then return to the official plan
  await roverEl(page).click()
  await expect(card(page)).toContainText('Parking option', { timeout: 5_000 })
  await btn.click()
  await expect(roverEl(page)).toHaveAttribute('data-select-pad', 'rank1')
  await expect(btn).toBeDisabled()
  await expect.poll(async () => dist(await rel(page), home), { timeout: 5_000 }).toBeLessThan(2)
  await expect(card(page)).not.toContainText('Parking option')
  await expect(card(page)).not.toContainText('What this change costs')
})

test('T9: "Official plan" discards a released draft that was not kept', async ({ page }) => {
  const at = await open(page)
  const home = await rel(page)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x - 60, at.y + 10, { steps: 12 })
  await page.mouse.up()
  await expect(card(page)).toContainText('What this change costs', { timeout: 10_000 })
  await page.locator(OFFICIAL_BTN).click()
  await expect(card(page)).not.toContainText('What this change costs', { timeout: 5_000 })
  await expect(page.locator(OFFICIAL_BTN)).toBeDisabled()
  await expect.poll(async () => dist(await rel(page), home), { timeout: 5_000 }).toBeLessThan(2)
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
  await expect(card(page)).not.toContainText('What this change costs', { timeout: 5_000 })

  // live ready (what the live layer reports through the seam)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hl:live-status', { detail: 'ready' })))
  const at2 = await center(page)
  await hold(page, at2, { x: at2.x - 60, y: at2.y + 10 })
  await expect(readout).toHaveAttribute('data-live', 'ready')
  await expect(readout.locator('.hl-edit-drag__snap')).toContainText(LIVE_SNAP)
  await expect(readout).not.toContainText('offline')
  await expect(readout).not.toContainText('computing')
  await page.mouse.up()
  await expect(card(page)).toContainText('What this change costs', { timeout: 10_000 })
  await expect(card(page)).not.toContainText(STATIC_SNAP)

  // and unreachable again: back to the static text
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hl:live-status', { detail: 'offline' })))
  const at3 = await center(page)
  await hold(page, at3, { x: at3.x - 60, y: at3.y + 10 })
  await expect(readout.locator('.hl-edit-drag__snap')).toContainText(STATIC_SNAP)
  await page.mouse.up()
})

/** Screen position of the rover after cycling to the next pad with the arrow key (a known lon/lat). */
async function cycleTo(page: Page, id: string): Promise<Pt> {
  await page.keyboard.press('ArrowRight')
  await expect(card(page)).toContainText('What this change costs', { timeout: 10_000 })
  await expect.poll(async () => (await page.locator('.hl-edit-delta').textContent()) ?? '', { timeout: 5_000 }).not.toBe('')
  void id
  await settled(page)
  return rel(page)
}

test('T2: dropping next to P5 says why P5 is refused, and the rover still snaps to a valid pad', async ({ page }) => {
  await open(page)
  const at = await rel(page)
  // three known screen points (rank1, rank2, rank4) from the keyboard alternative (arrow keys cycle the valid pads)
  await roverEl(page).click()
  await expect(card(page)).toContainText('Official rover pad', { timeout: 5_000 })
  const p2 = await cycleTo(page, 'rank2')
  await cycleTo(page, 'rank3')
  const p4 = await cycleTo(page, 'rank4')
  await page.keyboard.press('Escape')
  await expect(card(page)).not.toContainText('What this change costs', { timeout: 5_000 })
  // affine lon/lat -> px from the three points (a few km of Mercator: linear)
  const [a, b, c] = [pad('rank1'), pad('rank2'), pad('rank4')]
  const solve = (va: number, vb: number, vc: number) => {
    // v = k0 + k1 * lon + k2 * lat
    const d = (b.lon - a.lon) * (c.lat - a.lat) - (c.lon - a.lon) * (b.lat - a.lat)
    const k1 = ((vb - va) * (c.lat - a.lat) - (vc - va) * (b.lat - a.lat)) / d
    const k2 = ((c.lon - a.lon) * (vb - va) - (b.lon - a.lon) * (vc - va)) / d
    return (lon: number, lat: number) => va + k1 * (lon - a.lon) + k2 * (lat - a.lat)
  }
  const fx = solve(at.x, p2.x, p4.x)
  const fy = solve(at.y, p2.y, p4.y)
  const p5 = pad('pad_default')
  await settled(page)
  const m = await mapCenter(page)
  const target = { x: m.x + fx(p5.lon, p5.lat), y: m.y + fy(p5.lon, p5.lat) }
  const vp = page.viewportSize()!
  expect(target.x, 'P5 on screen').toBeGreaterThan(0)
  expect(target.y, 'P5 on screen').toBeLessThan(vp.height)

  const start = await center(page)
  await hold(page, start, target)
  const refused = page.locator('.hl-edit-drag__refused')
  console.log('P5 drop', JSON.stringify({ at, p2, p4, target }), await page.locator('.hl-edit-drag').textContent())
  await expect(refused).toHaveAttribute('data-refused', 'pad_default')
  await expect(refused).toHaveText(/^P5 is not a valid rover pad: slope up to \d+\.\d° on the 20 × 20 m block \(limit 5°\)/)
  // snapping unchanged: the target is another pad
  await expect(page.locator('.hl-edit-drag__snap')).not.toContainText('P5')
  await page.mouse.up()
  await expect(card(page)).toContainText('What this change costs', { timeout: 10_000 })
  await expect(roverEl(page)).toBeVisible()
  await page.keyboard.press('Escape')
})
