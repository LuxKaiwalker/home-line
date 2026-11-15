/**
 * Visual regression of the L1 layout containers (D111): the /styleguide "Layout containers" section
 * (right drawer with a collapsible section, collapsed bottom drawer, marker card, map-edge popover on a
 * stand-in map area). Element screenshot of #sg-layout at both viewports; same baseline rule as
 * screens.spec.ts (see its header): no committed baseline → passes with the annotation `no-baseline`
 * and the current PNG is saved to test-results/visual-current/__screenshots__/ for adoption from CI.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { expect, test } from 'playwright/test'

const FIXED_NOW = process.env.HL_SNAPSHOT_NOW ?? '2026-11-15T11:00:00Z'
const CURRENT_DIR = resolve(import.meta.dirname, '../../test-results/visual-current/__screenshots__')

test('styleguide-layout', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.clock.setFixedTime(new Date(FIXED_NOW))
  await page.goto('#/styleguide')
  const section = page.locator('#sg-layout')
  await section.waitFor({ state: 'visible', timeout: 45_000 })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await section.scrollIntoViewIfNeeded()
  // the containers are where the spec says: drawer ≤ 40 % of the map width, card and popover button inside
  const map = await page.locator('#sg-layout .sg-map').boundingBox()
  const drawer = await page.locator('#sg-layout .hl-lay-drawer').boundingBox()
  expect(map && drawer).toBeTruthy()
  expect(drawer!.width).toBeLessThanOrEqual(map!.width * 0.4 + 1)
  await expect(page.locator('#sg-layout .hl-lay-card')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show the mission timeline' })).toHaveAttribute('aria-expanded', 'false')
  expect(errors, 'uncaught page errors').toEqual([])

  const file = 'styleguide-layout.png'
  const baseline = info.snapshotPath(file, { kind: 'screenshot' })
  try {
    if (existsSync(baseline)) await expect(section).toHaveScreenshot(file)
    else info.annotations.push({ type: 'no-baseline', description: `${basename(baseline)}: not compared` })
  } finally {
    const png = await section.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' })
    const out = resolve(CURRENT_DIR, basename(baseline))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, png)
  }
})
