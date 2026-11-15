/**
 * Plan bottom drawer (L2b, D111; L0 rows 4 and 5) in a real browser, both viewports of the visual config.
 * Not a screenshot test.
 *   - Collapsed: one line along the bottom map edge with the route summary and the slim scrubber.
 *   - Expanded: at most 40 % of the map height; tab "Timeline" first and default (F7), tab "Plan table" (route legs + stations tables, trust
 *     chips, no unbacked number) and tab "Timeline" (the timeline dock body).
 *   - RR1 issue 1: with a selection open, the timeline track keeps its width (≥ the 360 px sidebar
 *     token; it was crushed to about 90 px) and no side panel covers the drawer.
 * Run: cd web && npm run build && npx playwright test tests/visual/plan-bottom.spec.ts
 */
import { expect, test, type Page } from 'playwright/test'

type Box = { x: number; y: number; width: number; height: number }
async function box(page: Page, sel: string): Promise<Box> {
  const b = await page.locator(sel).first().boundingBox()
  expect(b, sel).not.toBeNull()
  return b!
}
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const DRAWER = '.plan-layout .plan-bottom'
const GRIP = '[aria-controls="hl-lay-plan-bottom"]'
const tab = (page: Page, id: string) => page.locator(`#hl-lay-plan-bottom-tab-${id}`)

async function open(page: Page): Promise<void> {
  await page.goto('/?intro=0#/')
  await page.locator(`${DRAWER} .hl-tl__play`).waitFor({ timeout: 30_000 })
  await page.locator(`${DRAWER} .plan-summary`).waitFor({ timeout: 30_000 })
}

test('collapsed: one line with the route summary and the slim scrubber', async ({ page }) => {
  await open(page)
  const d = await box(page, DRAWER)
  const map = await box(page, '.console-map')
  expect(d.height).toBeLessThanOrEqual(48)
  expect(Math.round(d.x)).toBe(Math.round(map.x))
  expect(Math.round(d.width)).toBe(Math.round(map.width))
  expect(Math.round(d.y + d.height)).toBe(Math.round(map.y + map.height))
  await expect(page.locator(GRIP)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator(`${DRAWER} .plan-summary .num`).first()).toBeVisible()
  await expect(page.locator(`${DRAWER} input[type=range]`)).toBeVisible()
  await expect(page.locator('.hl-tl__play').filter({ visible: true })).toHaveCount(1)
  expect(await page.locator(`${DRAWER} .num-unbacked`).count()).toBe(0)
})

test('expanded: ≤ 40 % of the map; plan table and timeline tabs', async ({ page }) => {
  await open(page)
  const map = await box(page, '.console-map')
  await page.locator(GRIP).click()
  await expect(page.locator(GRIP)).toHaveAttribute('aria-expanded', 'true')
  // F7: the replay (timeline) is the leftmost tab and the default; the plan table comes next
  await expect(page.locator('#hl-lay-plan-bottom-tab-timeline + #hl-lay-plan-bottom-tab-plan-table')).toHaveCount(1)
  await expect(tab(page, 'timeline')).toHaveAttribute('aria-selected', 'true')
  await tab(page, 'plan-table').click()
  await expect(tab(page, 'plan-table')).toHaveAttribute('aria-selected', 'true')
  const body = page.locator('#hl-lay-plan-bottom')
  await expect(body.locator('.route-legs')).toBeVisible({ timeout: 30_000 })
  await expect(body.getByRole('table').first()).toBeVisible()
  await expect(body.locator('section', { has: page.locator('h3', { hasText: /^Stations$/ }) })).toHaveCount(1)
  expect(await body.locator('.num').count()).toBeGreaterThan(0)
  expect(await body.locator('.num-unbacked').count()).toBe(0)
  expect((await box(page, DRAWER)).height).toBeLessThanOrEqual(map.height * 0.4 + 1)
  expect(await box(page, '.console-map')).toEqual(map) // overlay: the map box does not change

  await tab(page, 'timeline').click()
  await expect(tab(page, 'timeline')).toHaveAttribute('aria-selected', 'true')
  await expect(body.locator('.hl-tl__track')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.hl-tl__play').filter({ visible: true })).toHaveCount(1) // one timeline at a time
  expect((await box(page, DRAWER)).height).toBeLessThanOrEqual(map.height * 0.4 + 1)

  await page.keyboard.press('Escape') // the drawer is the topmost container: Esc collapses it
  await expect(page.locator(GRIP)).toHaveAttribute('aria-expanded', 'false')
})

test('RR1 issue 1: a selection never squeezes or covers the timeline', async ({ page }) => {
  await open(page)
  await page.locator(GRIP).click()
  await tab(page, 'timeline').click()
  const track = '#hl-lay-plan-bottom .hl-tl__track'
  await page.locator(track).waitFor({ timeout: 30_000 })
  // select station S7 through the search palette (opens its card: sidebar or station card)
  await page.keyboard.press('Control+k')
  const search = page.getByRole('combobox', { name: 'Search' })
  await search.fill('S7')
  await expect(page.getByRole('option', { selected: true })).toContainText('S7')
  await search.press('Enter')
  await page.waitForTimeout(500) // panels measured
  await expect(page.locator(GRIP)).toHaveAttribute('aria-expanded', 'true')
  expect((await box(page, track)).width).toBeGreaterThanOrEqual(360)
  const side = page.locator('.hl-shell[data-sidebar="open"] .hl-sidebar')
  if (await side.count()) expect(overlaps(await box(page, '.hl-sidebar'), await box(page, DRAWER))).toBe(false)
})
