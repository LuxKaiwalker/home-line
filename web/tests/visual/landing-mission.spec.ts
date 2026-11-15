/**
 * J1 (D132): the landing page.
 *   - the bare site URL plays the L12 intro on the first visit (loading screen; the first click skips)
 *     and then lands on the Mission Planer (#/mission);
 *   - with no intro (?intro=0) the bare URL lands on #/mission at once;
 *   - #/ still opens Plan, and the Mission Planer tab shows with FLY kept in the mode tabs and no dock.
 * Not a screenshot test: real clicks during the intro, so the file name is in the serial click projects
 * of ../../playwright.config.ts (CLICK_SPECS).
 * Run: cd web && npm run build && npx playwright test tests/visual/landing-mission.spec.ts
 */
import { expect, test } from 'playwright/test'

const LOADING = '#hl-loading'

test.describe('landing (D132): intro first, then #/mission', () => {
  test.use({ reducedMotion: 'no-preference' }) // the intro never plays under reduced motion

  test('bare URL: the intro loading screen, Skip intro, then the Mission Planer', async ({ page }) => {
    await page.goto('/')
    await page.locator('html[data-hl-intro]').waitFor({ state: 'attached', timeout: 30_000 })
    expect(new URL(page.url()).hash).toBe('') // the intro plays on the Plan map first
    await expect(page.locator('body')).toHaveAttribute('data-route', 'console')
    await page.locator(`${LOADING} [data-hl-act=skip]`).click({ timeout: 10_000 })
    await expect(page).toHaveURL(/#\/mission$/, { timeout: 30_000 })
    await expect(page.locator('body')).toHaveAttribute('data-route', 'mission')
    await expect(page.locator(LOADING)).toHaveCount(0)
    // replace, not push: Back does not return to the bare address
    expect(await page.evaluate(() => history.length)).toBe(1)
  })

  test('#/ plays the intro and stays on Plan', async ({ page }) => {
    await page.goto('/#/')
    await page.locator('html[data-hl-intro]').waitFor({ state: 'attached', timeout: 30_000 })
    await page.locator(`${LOADING} [data-hl-act=skip]`).click({ timeout: 10_000 })
    await expect(page.locator(LOADING)).toHaveCount(0)
    await page.waitForTimeout(1_000)
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.locator('body')).toHaveAttribute('data-route', 'console')
  })
})

test.describe('landing (D132): no intro', () => {
  test('bare URL with ?intro=0 lands on #/mission at once; FLY is in the mode tabs; no dock', async ({ page }) => {
    await page.goto('/?intro=0')
    await expect(page).toHaveURL(/\?intro=0#\/mission$/)
    await expect(page.locator('body')).toHaveAttribute('data-route', 'mission')
    await expect(page.locator(LOADING)).toHaveCount(0)
    await expect(page.locator('.hl-modes__tab')).toHaveCount(4)
    await expect(page.locator('.hl-modes__tab[href="#/fly/hud"]')).toBeVisible()
    await expect(page.locator('[data-dock]')).toHaveAttribute('data-dock', 'none')
    await expect(page.locator('.mp-export')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.mp-export .mp-origin')).toHaveText('Mission Planer: browser estimate on the 5 m grid, not part of the validated scorecard')
  })
})
