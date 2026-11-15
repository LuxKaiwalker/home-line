/**
 * Plan declutter target (L2f, D111; L0 §2 method): in the default Plan state the panels cover at most
 * 25 % of the map work area at 1440 × 900 and at most 35 % at 1024 × 768 (?view=2d, no intro).
 * Method (L0 notes/L0-shots.mjs): an 8 px grid over everything below the top bar; a point is "map" when
 * the element on top is the map canvas, a map marker or a map label; anything else covers the map.
 * Also: no console aside and no live aside in the shell frame (?legacy=1 keeps them), one map-edge tool
 * column holding every map control, the Rover button opens the rover card with the "Rover pad" text,
 * and the cursor readout is a one-line chip at the bottom left. Not a screenshot test; it clicks one
 * button only after the measurement.
 * Run: cd web && npm run build && npx playwright test tests/visual/plan-coverage.spec.ts
 */
import { expect, test, type Page } from 'playwright/test'

const TARGET: Record<string, number> = { '1440x900': 25, '1024x768': 35 }

async function open(page: Page, q = ''): Promise<void> {
  await page.goto(`/?intro=0&view=2d${q}#/`)
  await page.locator('.plan-layout .plan-tools').waitFor({ timeout: 30_000 })
  await page.locator('.plan-layout .plan-summary').waitFor({ timeout: 30_000 })
  await page.locator('.console-map canvas.maplibregl-canvas').waitFor({ timeout: 30_000 })
  await page.locator('.plan-tools .maplibregl-ctrl-zoom-in').waitFor({ timeout: 30_000 })
}

/** Share (%) of the work area below the top bar that is not the map (L0's grid sampling). */
async function covered(page: Page): Promise<{ pct: number; by: Record<string, number> }> {
  return page.evaluate(() => {
    const top = document.querySelector('.hl-topbar')?.getBoundingClientRect().bottom ?? 0
    const step = 8
    let n = 0
    let map = 0
    const by: Record<string, number> = {}
    for (let y = top + step / 2; y < innerHeight; y += step)
      for (let x = step / 2; x < innerWidth; x += step) {
        n++
        const el = document.elementFromPoint(x, y)
        const isMap = !!el && ((el.tagName === 'CANVAS' && !!el.closest('.console-map')) || !!el.closest('.maplibregl-marker, .hl-label, .maplibregl-canvas-container'))
        if (isMap) map++
        else {
          const k = el ? (el.closest('[class]')?.className.toString().split(' ')[0] ?? el.tagName) : '(none)'
          by[k] = (by[k] ?? 0) + 1
        }
      }
    const pct = (v: number) => Math.round((1000 * v) / n) / 10
    return { pct: pct(n - map), by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, pct(v)])) }
  })
}

test('default Plan state: panels cover at most 25 % (1440) / 35 % (1024) of the map', async ({ page }, info) => {
  const vp = info.project.use.viewport!
  const target = TARGET[`${vp.width}x${vp.height}`] ?? 35
  await open(page)
  // no side columns in the shell frame: the console aside and the live aside are gone
  await expect(page.locator('aside.console-panel')).toHaveCount(0)
  await expect(page.locator('.console-live')).toHaveCount(0)
  // the intro's 2D notice (toast) is not a panel: let it go if it is there
  await page.waitForTimeout(1000)
  const c = await covered(page)
  info.annotations.push({ type: 'coverage', description: `${c.pct} % ${JSON.stringify(c.by)}` })
  expect(c.pct, JSON.stringify(c.by)).toBeLessThanOrEqual(target)
})

test('one map-edge tool column; the Rover button opens the rover card; cursor chip bottom left', async ({ page }) => {
  await open(page)
  const tools = page.locator('.plan-layout .plan-tools')
  // every map control sits in the column: zoom, compass, Layers, 2D/3D, Flythrough, Storm, Rover, Full screen, Plan summary (L2e)
  for (const sel of ['.maplibregl-ctrl-zoom-in', '.hl-compass', '[aria-controls="hl-lay-layers"]', '.hl-terrain-ctrl', '.hl-fly-btn', '.hl-storm-btn', '[aria-controls="hl-lay-rover"]', '[data-testid="plan-summary"]'])
    await expect(tools.locator(sel).first(), sel).toBeAttached()
  // no other floating control clusters at MapLibre's corners (the scale bar stays)
  for (const corner of ['top-left', 'top-right', 'bottom-right'])
    await expect(page.locator(`.console-map .maplibregl-ctrl-${corner} .maplibregl-ctrl`).filter({ visible: true }), corner).toHaveCount(0)
  // the cursor readout: one line, bottom left, clear of the map centre
  const map = (await page.locator('.console-map').boundingBox())!
  await page.mouse.move(map.x + map.width * 0.4, map.y + map.height * 0.4)
  await page.mouse.move(map.x + map.width * 0.4 + 10, map.y + map.height * 0.4 + 6)
  const chip = page.locator('.plan-layout .plan-cursor .hl-cursor-readout')
  await expect(chip).toBeVisible({ timeout: 10_000 })
  const b = (await chip.boundingBox())!
  expect(b.height).toBeLessThanOrEqual(40)
  expect(b.x).toBeLessThan(map.x + map.width / 2)
  expect(b.y).toBeGreaterThan(map.y + map.height * 0.75)
  // the Rover button opens the rover card with the console's "Rover pad" text (L0 row 5)
  const rover = tools.locator('[aria-controls="hl-lay-rover"]')
  await expect(rover).toHaveAttribute('aria-expanded', 'false')
  await rover.click()
  const card = page.locator('#hl-lay-rover')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Pad in use')
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
})

test('?legacy=1 keeps the console aside', async ({ page }) => {
  await page.goto('/?intro=0&legacy=1#/')
  await expect(page.locator('aside.console-panel [role="radiogroup"][aria-label="Variant"]')).toBeVisible({ timeout: 30_000 })
})
