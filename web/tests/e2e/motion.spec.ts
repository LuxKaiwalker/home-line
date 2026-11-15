/**
 * §6 test 7 — motion (package L5, D111): with prefers-reduced-motion (the config default,
 * reducedMotion: 'reduce') the containers open without animation, and opening a container never shifts
 * the map (no layout shift other than the camera recentre: the map element keeps its box). The descent
 * intro never plays under reduced motion.
 */
import { expect, test, type Page } from 'playwright/test'
import { build, container, gotoPlan, IDS, mapBox, opener } from './planning'

/** Running animations / transitions on the element and its subtree. */
const running = (page: Page, id: string) =>
  page.locator(`#hl-lay-${id}`).evaluate((el) => {
    const host = el.closest('.hl-lay-bottom, .hl-lay-pop') ?? el
    return host.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length
  })

const OPENERS: { id: string; owner: string; live?: boolean }[] = [
  { id: IDS.bottom, owner: 'L2' },
  { id: IDS.layers, owner: 'L2' },
  { id: IDS.legend, owner: 'L2' },
  { id: IDS.editRoute, owner: 'L3', live: true },
]

test.describe('reduced motion @clicks', () => {
  for (const o of OPENERS) {
    // TODO(L2 / L3 as named): containers not mounted yet.
    test.fixme(`${o.id}: opens without animation and without moving the map (TODO ${o.owner})`, async ({ page }) => {
      test.skip(!!o.live && build() !== 'live', 'live container: only with the API reachable')
      await gotoPlan(page)
      const before = await mapBox(page)
      await opener(page, o.id).click()
      await expect(container(page, o.id)).toBeVisible()
      expect(await running(page, o.id)).toBe(0)
      expect(await mapBox(page)).toEqual(before)
    })
  }
})

test('reduced motion: the descent intro does not play', async ({ page }) => {
  await page.goto('/#/')
  await page.locator('.hl-edit-rover').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(1_000)
  await expect(page.locator('html[data-story-chrome="hide"]')).toHaveCount(0)
})
