/**
 * L13 (team lead Sun 12:54, D111): 3D is the default Plan view, and every planning interaction works
 * in 3D (at plan_view.pitch_deg, the open pose). On the built app, both viewports:
 *   - /?intro=0#/ opens in 3D (the 3D button is checked; on a slow software-GL runner the D38 fallback
 *     may then switch to 2D, and only with its dismissible note); T switches to 2D
 *   - ?view=2d forces 2D (no terrain), ?view=3d forces 3D (no fallback: the interaction tests below)
 *   - in 3D: a left click on the S7 pill opens its card; a left drag on the rover moves it with the
 *     drag readout; a right drag pans; the cursor readout follows the pointer; a layer toggle shows
 *     and hides its layer
 * Not a screenshot test. The file name ends in map-input.spec.ts so playwright.config.ts runs it with
 * the click-sensitive specs (one worker, after the screenshots; issue #131).
 * Run: cd web && npm run build && npx playwright test tests/visual/plan3d-map-input.spec.ts
 */
import { expect, test, type Page } from 'playwright/test'

const card = (page: Page) => page.locator('.hl-sidebar__body')
const cam = (page: Page) => page.locator('[data-camera-center]').first()
const mapEl = (page: Page) => page.locator('.maplibregl-map').first()
const center = async (page: Page) => (await cam(page).getAttribute('data-camera-center'))!
const radio = (page: Page, v: '2D' | '3D') => page.locator('.hl-terrain-seg [role="radio"]', { hasText: v })

/** The planning map in forced 3D at the open pose, with the rover handle in place; returns the map box. */
async function open3d(page: Page) {
  await page.goto('/?intro=0&view=3d#/')
  await page.locator('.hl-edit-rover').waitFor({ timeout: 60_000 })
  await expect(mapEl(page)).toHaveAttribute('data-terrain', '3d', { timeout: 60_000 })
  await expect(cam(page)).toHaveAttribute('data-camera-pitch', /^[1-9]/, { timeout: 20_000 })
  expect(Number(await cam(page).getAttribute('data-camera-pitch'))).toBeGreaterThanOrEqual(30)
  return (await page.locator('.maplibregl-canvas').boundingBox())!
}

/** A spot on the map with nothing on it (no marker, pill, control or readout under the pointer). */
async function emptySpot(page: Page, box: { x: number; y: number; width: number; height: number }) {
  for (const [fx, fy] of [
    [0.5, 0.75],
    [0.3, 0.7],
    [0.7, 0.3],
    [0.35, 0.35],
    [0.65, 0.65],
    [0.5, 0.25],
    [0.4, 0.55],
    [0.6, 0.45],
  ]) {
    const x = box.x + box.width * fx
    const y = box.y + box.height * fy
    const free = await page.evaluate(
      ([x, y]) => {
        for (let dx = -70; dx <= 70; dx += 10)
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

test.describe('L13: the view Plan mode opens with', () => {
  test('the default is 3D; T switches to 2D', async ({ page }) => {
    await page.goto('/?intro=0#/')
    await page.locator('.hl-edit-rover').waitFor({ timeout: 60_000 })
    // 3D was asked for at once; the slow-GPU fallback (D38) may switch to 2D afterwards, with its note
    await expect(mapEl(page)).toHaveAttribute('data-terrain', /3d|flat/, { timeout: 60_000 })
    if ((await mapEl(page).getAttribute('data-terrain')) === 'flat') {
      await expect(mapEl(page)).toHaveAttribute('data-terrain-fallback', 'slow3d')
      await expect(page.locator('.hl-terrain-notice')).toContainText('Switched to 2D: low frame rate · T to try 3D')
      return
    }
    await expect(radio(page, '3D')).toHaveAttribute('aria-checked', 'true')
    await page.locator('.maplibregl-canvas').focus()
    await page.keyboard.press('t')
    await expect(radio(page, '2D')).toHaveAttribute('aria-checked', 'true')
    await expect(mapEl(page)).toHaveAttribute('data-terrain', 'flat', { timeout: 10_000 })
    await expect(cam(page)).toHaveAttribute('data-camera-pitch', '0', { timeout: 10_000 })
  })

  test('?view=2d forces 2D: no terrain, the 2D button checked', async ({ page }) => {
    await page.goto('/?intro=0&view=2d#/')
    await page.locator('.hl-edit-rover').waitFor({ timeout: 60_000 })
    await expect(radio(page, '2D')).toHaveAttribute('aria-checked', 'true')
    await page.waitForTimeout(1000)
    await expect(mapEl(page)).toHaveAttribute('data-terrain', 'off')
  })
})

test.describe('L13: planning interactions in 3D (?view=3d, open pose)', () => {
  test('a left click on the S7 pill opens its card', async ({ page }) => {
    await open3d(page)
    const s7 = page.getByRole('button', { name: /^S7: / })
    await expect(s7).toBeVisible({ timeout: 10_000 })
    await expect(card(page)).not.toContainText('Science target')
    await s7.click()
    await expect(card(page)).toContainText('Science target', { timeout: 10_000 })
    await expect(card(page)).toContainText('S7')
  })

  test('a left drag on the rover moves it, with the drag readout', async ({ page }) => {
    await open3d(page)
    const before = await center(page)
    const b = (await page.locator('.hl-edit-rover').boundingBox())!
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x - 60, at.y + 10, { steps: 12 })
    await expect(page.locator('.hl-edit-rover')).toHaveClass(/is-dragging/)
    await expect(page.locator('.hl-edit-drag-host')).not.toBeEmpty({ timeout: 10_000 })
    await page.mouse.up()
    expect(await center(page)).toBe(before) // the map did not move
    await expect(card(page)).toContainText('What this change costs', { timeout: 15_000 })
    await page.keyboard.press('Escape')
  })

  test('a right drag pans (the ground follows the pointer)', async ({ page }) => {
    const box = await open3d(page)
    const at = await emptySpot(page, box)
    const before = await center(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(at.x + 60, at.y + 20, { steps: 10 })
    await page.mouse.up({ button: 'right' })
    await expect(cam(page)).not.toHaveAttribute('data-camera-center', before, { timeout: 10_000 })
    expect(Number(await cam(page).getAttribute('data-camera-pitch'))).toBeGreaterThanOrEqual(30) // still tilted
  })

  test('the cursor readout follows the pointer', async ({ page }) => {
    const box = await open3d(page)
    const at = await emptySpot(page, box)
    const lon = page.locator('.hl-cursor-readout__row--lon')
    await page.mouse.move(at.x, at.y)
    await page.mouse.move(at.x + 5, at.y + 5, { steps: 2 })
    await expect(lon).toContainText(/\d/, { timeout: 10_000 })
    const first = await lon.innerText()
    await page.mouse.move(at.x + 120, at.y, { steps: 4 })
    await expect(lon).not.toHaveText(first, { timeout: 10_000 })
  })

  test('a layer toggle shows and hides its layer', async ({ page }) => {
    await open3d(page)
    if (page.viewportSize()!.width < 1280) await page.locator('.hl-rail__toggle').click() // tablet: the rail is a sheet
    const row = page.locator('.hl-ovl__layer').first()
    await row.waitFor({ timeout: 20_000 })
    const id = (await row.getAttribute('data-overlay'))!
    const sw = row.getByRole('switch')
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(mapEl(page)).toHaveAttribute('data-overlays-on', new RegExp(`(^| )${id}( |$)`), { timeout: 10_000 })
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(mapEl(page)).not.toHaveAttribute('data-overlays-on', new RegExp(`(^| )${id}( |$)`), { timeout: 10_000 })
    await expect(mapEl(page)).toHaveAttribute('data-terrain', '3d')
  })
})
