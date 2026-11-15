/**
 * L13 (team lead Sun 12:54, D111): 3D is the default Plan view, and every planning interaction works
 * in 3D (at plan_view.pitch_deg, the open pose). On the built app:
 *   - /?intro=0#/ opens in 3D (the 3D button is checked; on a slow software-GL runner the D38 fallback
 *     may then switch to 2D, and only with its dismissible note); T switches to 2D
 *   - ?view=2d forces 2D (no terrain), ?view=3d forces 3D (no fallback: the interaction tests below)
 *   - in 3D (one page, 1440x900 only: CI time budget): a left click on the S7 pill opens its card; a left drag on the rover moves it with the
 *     drag readout; a right drag pans; the cursor readout follows the pointer; a layer toggle shows
 *     and hides its layer
 * Not a screenshot test. The file name ends in map-input.spec.ts so playwright.config.ts runs it with
 * the click-sensitive specs (one worker, after the screenshots; issue #131).
 * Run: cd web && npm run build && npx playwright test tests/visual/plan3d-map-input.spec.ts
 */
import { expect, test, type Page } from 'playwright/test'

// 3D in software GL (CI): every frame of the terrain is slow, and each input event waits for one
// (issue #131); the interactions themselves are checked with their usual timeouts
test.describe.configure({ timeout: 180_000 })

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

// One page for four of them, the rover drag on its own (each page load in 3D software GL costs 20-50 s on CI, and the visual job has a
// 15 min budget), at the desktop viewport; the same interactions in 2D run at both viewports in
// map-input.spec.ts / rover-click.spec.ts.
test('L13: planning interactions in 3D (?view=3d, open pose): right-drag pan, cursor readout, layer toggle, pill click', async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1280, '3D interactions run once, at 1440x900 (CI time budget); 1024x768 runs them in 2D')
  test.setTimeout(240_000)
  const box0 = await open3d(page)

  await test.step('a right drag pans (the ground follows the pointer)', async () => {
    const at = await emptySpot(page, box0)
    const before = await center(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(at.x + 60, at.y + 20, { steps: 10 })
    await page.mouse.up({ button: 'right' })
    await expect(cam(page)).not.toHaveAttribute('data-camera-center', before, { timeout: 10_000 })
    expect(Number(await cam(page).getAttribute('data-camera-pitch'))).toBeGreaterThanOrEqual(30) // still tilted
  })

  await test.step('the cursor readout follows the pointer', async () => {
    const box = (await page.locator('.maplibregl-canvas').boundingBox())!
    const at = await emptySpot(page, box)
    const lon = page.locator('.hl-cursor-readout__row--lon')
    await page.mouse.move(at.x, at.y)
    await page.mouse.move(at.x + 5, at.y + 5, { steps: 2 })
    await expect(lon).toContainText(/\d/, { timeout: 10_000 })
    const first = await lon.innerText()
    await page.mouse.move(at.x + 120, at.y, { steps: 4 })
    await expect(lon).not.toHaveText(first, { timeout: 10_000 })
  })

  await test.step('a layer toggle shows and hides its layer', async () => {
    const row = page.locator('.hl-ovl__layer').first()
    await row.waitFor({ timeout: 20_000 })
    const id = (await row.getAttribute('data-overlay'))!
    const sw = row.getByRole('switch')
    const on = new RegExp(`(^| )${id}( |$)`)
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(mapEl(page)).toHaveAttribute('data-overlays-on', on, { timeout: 10_000 })
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(mapEl(page)).not.toHaveAttribute('data-overlays-on', on, { timeout: 10_000 })
  })

  await test.step('a left click on the S7 pill opens its card', async () => {
    const s7 = page.getByRole('button', { name: /^S7: / })
    await expect(s7).toBeVisible({ timeout: 10_000 })
    await expect(card(page)).not.toContainText('Science target')
    await s7.click()
    await expect(card(page)).toContainText('Science target', { timeout: 10_000 })
    await expect(card(page)).toContainText('S7')
  })

  await expect(mapEl(page)).toHaveAttribute('data-terrain', '3d') // 3D all along
})

test('L13: a left drag on the rover in 3D (?view=3d, open pose) moves it, with the drag readout', async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1280, '3D interactions run once, at 1440x900 (CI time budget); 1024x768 runs them in 2D')
  await open3d(page)
  await test.step('a left drag on the rover moves it, with the drag readout', async () => {
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
  })

  await expect(mapEl(page)).toHaveAttribute('data-terrain', '3d') // 3D all along
})
