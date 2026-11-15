/**
 * Plan-port e2e (spec "Port Mission Planer into Plan", W0b): one planning interface on the Plan page.
 * Skeleton: one real smoke test plus test.fixme placeholders that the wave-1 packages fill in as their
 * features land (replace `test.fixme` by `test` in the package that ships the feature).
 * Run: cd web && npm run build && NODE_PATH=$PWD/node_modules npx playwright test -c ../tests/e2e/plan-route/playwright.config.ts
 */
import { expect, test, type Page } from 'playwright/test'

/** Open the Plan page (#/) of the built app and wait for its map. */
async function openPlan(page: Page): Promise<void> {
  await page.goto('/?intro=0#/')
  await expect(page.locator('.maplibregl-map canvas.maplibregl-canvas').first()).toBeVisible({ timeout: 60_000 })
}

test.describe('smoke', () => {
  test('#/ opens the Plan page with its map', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await openPlan(page)
    await expect(page.locator('.hl-modes__tab[aria-current="page"]')).toHaveText(/Plan/)
    expect(page.url()).toMatch(/#\/$/)
    expect(errors).toEqual([])
  })
})

test.describe('pad switch', () => {
  test.fixme('switching the start pad re-routes every leg from the new pad', async ({ page }) => {
    await openPlan(page)
  })
})

test.describe('add stops', () => {
  test.fixme('adding a science stop appends a routed leg and updates the totals', async ({ page }) => {
    await openPlan(page)
  })
  test.fixme('reordering stops re-routes only the changed legs', async ({ page }) => {
    await openPlan(page)
  })
})

test.describe('free point', () => {
  test.fixme('clicking the map adds a free waypoint routed on the grid', async ({ page }) => {
    await openPlan(page)
  })
})

test.describe('infeasible leg', () => {
  test.fixme('a leg with no route is marked infeasible with its reason, and export is blocked', async ({ page }) => {
    await openPlan(page)
  })
})

test.describe('export', () => {
  test.fixme('Send to MARVIS / mission.json carries the plan on screen (contracts/bundle/mission.schema.json)', async ({ page }) => {
    await openPlan(page)
  })
})

test.describe('share link', () => {
  test.fixme('the share link reopens the same plan (stops, order, pad)', async ({ page }) => {
    await openPlan(page)
  })
})

test.describe('undo', () => {
  test.fixme('Ctrl+Z undoes the last plan edit and Ctrl+Shift+Z redoes it', async ({ page }) => {
    await openPlan(page)
  })
})
