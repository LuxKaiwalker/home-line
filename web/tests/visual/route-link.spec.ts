/**
 * D131 "Plan your route" header link and the Edit-route drawer in the URL (#/?panel=route), in a real
 * browser. Not a screenshot test: a click spec (serial click projects of ../../playwright.config.ts).
 *   - static build (CI's web/dist, VITE_LIVE off) and live builds with route editing off: no link;
 *   - live build with route editing on (live mock): the link shows next to the mode switcher; a click
 *     opens Plan with the drawer open and the URL has panel=route; Back closes the drawer (the app
 *     stays); × closes it and drops the panel; loading the URL opens it.
 * Run (live mock):
 *   VITE_LIVE=1 VITE_LIVE_MOCK=1 npx vite build --outDir /tmp/dist-live
 *   HL_VISUAL_DIST=/tmp/dist-live HL_E2E_LIVE=1 npx playwright test tests/visual/route-link.spec.ts
 * Add HL_E2E_ROUTE_EDIT=0 (and VITE_ROUTE_EDIT=0 on the build) for the route-editing-off case.
 */
import { expect, test } from 'playwright/test'

const LIVE = process.env.HL_E2E_LIVE === '1'
const ROUTE_EDIT = process.env.HL_E2E_ROUTE_EDIT !== '0'
const LINK = '.hl-topbar__routelink'
const DRAWER = '#hl-lay-edit-route'
const panelInUrl = (url: string) => new URL(url).hash.includes('panel=route')

test.describe('Plan your route (D131)', () => {
  test('no link without live route editing', async ({ page }) => {
    test.skip(LIVE && ROUTE_EDIT, 'live build with route editing on')
    await page.goto('/?intro=0#/')
    await page.locator('.hl-modes').first().waitFor({ timeout: 30_000 })
    await page.locator('.hl-tl__play').waitFor({ timeout: 30_000 }) // the console (and any live chunk) is up
    await expect(page.locator(LINK)).toHaveCount(0)
  })

  test.describe('live build, route editing on', () => {
    test.skip(!LIVE || !ROUTE_EDIT, 'needs a live build with route editing on (HL_E2E_LIVE=1)')

    test('the link opens the drawer, Back closes it, the URL opens it', async ({ page }) => {
      await page.goto('/?intro=0#/report/cuff')
      await page.goto('/?intro=0#/')
      const link = page.locator(LINK)
      await expect(link).toBeVisible({ timeout: 30_000 })
      await expect(link).toHaveText('Plan your route')
      await expect(page.locator(DRAWER)).toBeHidden()
      await link.click({ timeout: 5_000 })
      await expect(page.locator(DRAWER)).toBeVisible()
      expect(panelInUrl(page.url())).toBe(true)
      await expect(page.locator('body')).toHaveAttribute('data-mode', 'plan')

      await page.goBack()
      await expect(page.locator(DRAWER)).toBeHidden()
      expect(panelInUrl(page.url())).toBe(false)
      expect(new URL(page.url()).hash).toBe('#/') // still in the app: Back only closed the drawer

      // the drawer's own opener pushes the panel; × removes it
      await page.locator('.hl-editroute__open').click({ timeout: 5_000 })
      await expect(page.locator(DRAWER)).toBeVisible()
      expect(panelInUrl(page.url())).toBe(true)
      await page.locator(`${DRAWER} .hl-lay-close`).first().click({ timeout: 5_000 })
      await expect(page.locator(DRAWER)).toBeHidden()
      expect(panelInUrl(page.url())).toBe(false)
    })

    test('loading #/?panel=route opens Plan with the drawer open', async ({ page }) => {
      await page.goto('/?intro=0#/?panel=route')
      await expect(page.locator(DRAWER)).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('body')).toHaveAttribute('data-mode', 'plan')
      await page.keyboard.press('Escape')
      await expect(page.locator(DRAWER)).toBeHidden()
      expect(panelInUrl(page.url())).toBe(false)
    })
  })
})
