/**
 * L2a (D111): the Plan headline strip in the top bar (#hl-topbar-plan). Runs on both visual projects
 * (1440×900, 1024×768) against the built app. Checks:
 *   - three numbers (30-min reach, 60-min reach, tightest margin), each a .num with its .hl-chip;
 *   - the Scenario and Walkback-budget chips open their console section in a popover (one at a time);
 *     a choice there updates the strip; Esc closes the popover and focus returns to the chip;
 *   - those two sections left the side panel (they live in the popovers now);
 *   - ?legacy=1 has no strip and keeps them in the side panel.
 * Run: cd web && npm run build && npx playwright test tests/visual/plan-strip.spec.ts
 */
import { expect, test } from 'playwright/test'

test('the headline strip shows three numbers with trust chips', async ({ page }) => {
  await page.goto('/?intro=0#/')
  const strip = page.locator('#hl-topbar-plan .hl-strip__nums')
  await expect(strip.locator('.hl-strip__item')).toHaveCount(3, { timeout: 30_000 })
  await expect(strip.locator('.num')).toHaveCount(3, { timeout: 30_000 })
  await expect(strip.locator('.hl-chip')).toHaveCount(3)
  await expect(strip.locator('.num-unbacked')).toHaveCount(0)
  // the strip fits the top bar: it ends before the top bar's own buttons
  const end = await page.locator('.hl-topbar__end').boundingBox()
  const row = await page.locator('#hl-topbar-plan .hl-strip__row').boundingBox()
  expect(row!.x + row!.width).toBeLessThanOrEqual(end!.x + 1)
})

test('the scenario and budget chips open their sections in a popover; Esc returns focus to the chip', async ({ page }) => {
  await page.goto('/?intro=0#/')
  const scenario = page.locator('.hl-strip__chip[aria-controls="hl-lay-scenario"]')
  const budget = page.locator('.hl-strip__chip[aria-controls="hl-lay-budget"]')
  await scenario.waitFor({ timeout: 30_000 })
  // not in the side panel any more
  await expect(page.locator('.console-panel .panel-body [role="radiogroup"][aria-label="Variant"]')).toHaveCount(0)
  await expect(page.locator('[role="radiogroup"][aria-label="Variant"]')).toBeHidden()
  await scenario.click()
  await expect(scenario).toHaveAttribute('aria-expanded', 'true')
  const variants = page.locator('#hl-lay-scenario [role="radiogroup"][aria-label="Variant"] button')
  await expect(variants.first()).toBeVisible()
  const pick = page.locator('#hl-lay-scenario [role="radiogroup"][aria-label="Variant"] button:not([aria-checked="true"]):not([disabled])').first()
  const v = ((await pick.textContent()) ?? '').trim()
  await pick.click()
  await expect(scenario).toContainText(v)
  await expect(scenario).toHaveAttribute('aria-expanded', 'true') // a choice inside keeps it open
  await page.keyboard.press('Escape')
  await expect(scenario).toHaveAttribute('aria-expanded', 'false')
  await expect(scenario).toBeFocused()
  // one popover at a time
  await scenario.click()
  await budget.click()
  await expect(budget).toHaveAttribute('aria-expanded', 'true')
  await expect(scenario).toHaveAttribute('aria-expanded', 'false')
  const b60 = page.locator('#hl-lay-budget [role="radiogroup"][aria-label="Walkback budget"] button', { hasText: '60' })
  await b60.click()
  await expect(budget).toContainText('60 min')
})

test('?legacy=1 keeps the old side panel and has no strip', async ({ page }) => {
  await page.goto('/?intro=0&legacy=1#/')
  await expect(page.locator('.console-panel [role="radiogroup"][aria-label="Variant"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.hl-strip__row')).toHaveCount(0)
})
