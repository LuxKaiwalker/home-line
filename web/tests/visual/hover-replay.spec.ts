/**
 * L7a (D111, team lead test Sun 12:39, blocking): pointer hover never changes state.
 *   - Plan, replay running (timeline Play): pointer moves over the map leave it running (clock still
 *     advancing, never reset, Play still pressed) and the thread stays the crew's; Play stops it.
 *   - Plan, no replay: a hover shows only the passive tooltip (field lookup, labelled estimate); no
 *     thread from the pointer, the clock, the address and the selection card are unchanged.
 *   - Plan: the thread from the pointer appears only with Alt held (the explicit mode).
 *   - Fly (HUD): hovering its map leaves the replay running; a click on the map stops it (as designed).
 *   - Flythrough: hovering the map leaves it flying; a key stops it (as designed).
 * Not a screenshot test: it lives here so the visual config runs it on both projects against the
 * built app. The thread's start is read from the map container's data-thread-from (map/furniture).
 * Run: cd web && npm run build && npx playwright test tests/visual/hover-replay.spec.ts
 */
import { expect, test, type Locator, type Page } from 'playwright/test'

type Box = { x: number; y: number; width: number; height: number }

const mapEl = (page: Page) => page.locator('[data-thread-from]').first()

/** The planning map, loaded, with the rover handle in place; returns the map box. */
async function openPlan(page: Page): Promise<Box> {
  await page.goto('/?intro=0#/')
  await page.locator('.hl-edit-rover').waitFor({ timeout: 60_000 })
  await page.locator('.hl-tl__play').waitFor({ timeout: 30_000 })
  return (await page.locator('.maplibregl-canvas').boundingBox())!
}

/** Minutes of an "hh:mm" / "mm:ss"-like clock text (only the order matters). */
const clockValue = (s: string): number => s.split(/[^0-9]+/).filter(Boolean).reduce((a, p) => a * 60 + Number(p), 0)

/** Move the pointer across the map in small steps (a hover, no button). */
async function hoverAcross(page: Page, box: Box, steps = 8): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(box.x + box.width * (0.3 + i * 0.05), box.y + box.height * (0.55 + (i % 2) * 0.05), { steps: 4 })
    await page.waitForTimeout(120)
  }
}

/** The clock keeps advancing: each reading is later than the one before. */
async function expectAdvancing(clock: Locator, from: string): Promise<string> {
  await expect.poll(async () => clockValue(await clock.innerText()), { timeout: 10_000 }).toBeGreaterThan(clockValue(from))
  return clock.innerText()
}

test('Plan: hover during the replay leaves it running; Play stops it', async ({ page }) => {
  const box = await openPlan(page)
  const play = page.locator('.hl-tl__play')
  const clock = page.locator('.hl-tl__clockvalue').first()
  await play.click()
  await expect(play).toHaveAttribute('aria-pressed', 'true')
  let last = await expectAdvancing(clock, await clock.innerText())
  for (let round = 0; round < 3; round++) {
    await hoverAcross(page, box)
    await expect(play).toHaveAttribute('aria-pressed', 'true')
    // the thread is the crew's: the pointer never takes it over during the replay
    await expect(mapEl(page)).toHaveAttribute('data-thread-from', 'crew')
    last = await expectAdvancing(clock, last)
  }
  // Alt held does not take it over during the replay either
  await page.keyboard.down('Alt')
  await hoverAcross(page, box, 3)
  await expect(mapEl(page)).toHaveAttribute('data-thread-from', 'crew')
  await page.keyboard.up('Alt')
  await expect(play).toHaveAttribute('aria-pressed', 'true')
  // the explicit click stops the replay, as designed
  await play.click()
  await expect(play).toHaveAttribute('aria-pressed', 'false')
})

test('Plan: a hover is a passive tooltip only (estimate); the route to the pointer needs Alt', async ({ page }) => {
  const box = await openPlan(page)
  const clock = page.locator('.hl-tl__clockvalue').first()
  const t0 = await clock.innerText()
  const url0 = page.url()
  const card0 = await page.locator('.hl-sidebar__body').innerText()
  await hoverAcross(page, box)
  const tip = page.locator('.hl-hover-tip')
  await expect(tip).toBeVisible()
  await expect(tip).toHaveAttribute('data-estimate', 'true')
  await expect(tip).toHaveText(/^(Estimate: home in [0-9.]+ min · hold Alt for the way home|No time home known here)$/)
  await expect(mapEl(page)).toHaveAttribute('data-thread-from', 'none')
  await page.waitForTimeout(500)
  expect(await clock.innerText()).toBe(t0)
  expect(page.url()).toBe(url0)
  expect(await page.locator('.hl-sidebar__body').innerText()).toBe(card0)
  // the explicit mode: Alt held over the map draws the thread from the pointer
  await page.keyboard.down('Alt')
  await hoverAcross(page, box, 2)
  await expect(mapEl(page)).toHaveAttribute('data-thread-from', 'pointer')
  await page.keyboard.up('Alt')
  await expect(mapEl(page)).toHaveAttribute('data-thread-from', 'none')
  expect(page.url()).toBe(url0)
})

test('Fly: hover over the HUD map leaves the replay running; a click stops it', async ({ page }) => {
  await page.goto('/?intro=0#/fly/hud')
  const play = page.locator('.hl-hud-play')
  await play.waitFor({ timeout: 60_000 })
  const canvas = page.locator('.hl-hud-stage canvas').first()
  const time = page.locator('.hl-hud-time')
  await play.click()
  let last = await expectAdvancing(time, await time.innerText())
  const box = (await canvas.boundingBox())!
  await hoverAcross(page, box)
  last = await expectAdvancing(time, last)
  await hoverAcross(page, box)
  last = await expectAdvancing(time, last)
  // an explicit click on the map (drag-anywhere) stops the replay, as designed
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  const stopped = await time.innerText()
  await page.waitForTimeout(800)
  expect(await time.innerText()).toBe(stopped)
})

test('Flythrough: hover leaves it flying; a key stops it', async ({ page }) => {
  const box = await openPlan(page)
  const fly = page.locator('.hl-fly-btn:not(.hl-fly-speed)')
  const clock = page.locator('.hl-tl__clockvalue').first()
  await fly.click()
  await expect(fly).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 })
  let last = await expectAdvancing(clock, await clock.innerText())
  await hoverAcross(page, box)
  await expect(fly).toHaveAttribute('aria-pressed', 'true')
  last = await expectAdvancing(clock, last)
  // an explicit key stops it, as designed (DESIGN §3.4)
  await page.keyboard.press('Escape')
  await expect(fly).toHaveAttribute('aria-pressed', 'false')
})
