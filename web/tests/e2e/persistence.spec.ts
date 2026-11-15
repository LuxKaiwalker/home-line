/**
 * §6 test 4 — persistence (package L5, D111): the open/closed state of the drawers, the bottom drawer's
 * tab and the collapsible sections survive a reload (layout store, key hl.layout.v1); with localStorage
 * blocked the app still works and starts from the defaults (every container closed, bottom drawer
 * collapsed). Cards and popovers are transient and never remembered (L1).
 */
import { expect, test } from 'playwright/test'
import { blockStorage, bottomTab, build, container, gotoPlan, IDS, LAYOUT_KEY, opener, pageErrors } from './planning'

test.describe('persistence @clicks', () => {
  // TODO(L2): containers mounted and the store bound to localStorage (bindLayoutStorage; blocked on the
  // live privacy test, see notes/L1.md "Persistence is NOT bound yet").
  test.fixme('bottom drawer, its tab and the Edit-route drawer survive a reload (TODO L2, L3)', async ({ page }) => {
    await gotoPlan(page)
    await opener(page, IDS.bottom).click()
    await bottomTab(page, IDS.planTable).click()
    if (build() === 'live') await opener(page, IDS.editRoute).click()
    await opener(page, IDS.layers).click() // transient: not remembered
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), LAYOUT_KEY)).not.toBeNull()
    await page.reload()
    await gotoPlan(page)
    await expect(opener(page, IDS.bottom)).toHaveAttribute('aria-expanded', 'true')
    await expect(bottomTab(page, IDS.planTable)).toHaveAttribute('aria-selected', 'true')
    if (build() === 'live') await expect(container(page, IDS.editRoute)).toBeVisible()
    await expect(container(page, IDS.layers)).toBeHidden()
  })

  // TODO(L2): defaults and toggling need the containers.
  test.fixme('localStorage blocked: defaults, and the containers still open and close (TODO L2)', async ({ page }) => {
    await blockStorage(page)
    const errors = pageErrors(page)
    await gotoPlan(page)
    await expect(opener(page, IDS.bottom)).toHaveAttribute('aria-expanded', 'false')
    await expect(container(page, IDS.editRoute)).toBeHidden()
    await opener(page, IDS.bottom).click()
    await expect(opener(page, IDS.bottom)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(opener(page, IDS.bottom)).toHaveAttribute('aria-expanded', 'false')
    expect(errors).toEqual([])
  })
})

test('localStorage blocked: the Plan view loads without an uncaught error', async ({ page }) => {
  await blockStorage(page)
  const errors = pageErrors(page)
  await gotoPlan(page)
  await expect(page.locator('.console-map canvas').first()).toBeVisible()
  await expect(page.locator('.hl-tl__play').filter({ visible: true })).toHaveCount(1)
  expect(errors).toEqual([])
})
