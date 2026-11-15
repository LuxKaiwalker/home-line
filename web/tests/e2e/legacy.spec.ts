/**
 * §6 test 8 — legacy (DESIGN U0, kit rule 10; package L5, D111): `?legacy=1` still renders the old
 * layout (header.topbar + nav, the console aside beside the map) and none of the D111 containers.
 */
import { expect, test } from 'playwright/test'

test('?legacy=1 shows the old layout', async ({ page }) => {
  await page.goto('/?legacy=1&intro=0#/')
  await page.locator('.hl-frame-legacy').waitFor({ timeout: 60_000 })
  await expect(page.locator('.hl-shell')).toHaveCount(0)
  await expect(page.locator('header.topbar')).toBeVisible()
  await expect(page.locator('.console-map canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.console-panel')).toBeVisible()
  await expect(page.locator('.hl-lay-drawer, .hl-lay-bottom, .hl-lay-card, .hl-lay-pop')).toHaveCount(0)
  await expect(page.locator('#hl-topbar-plan')).toHaveCount(0)
})
