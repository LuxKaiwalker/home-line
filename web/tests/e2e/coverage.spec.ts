/**
 * §6 test 1 — map coverage (package L5, D111). Every build (static, live with the API reachable, live
 * with the API unreachable) at 1440×900 and 1024×768:
 *   - default Plan state: ≤ 25 % (1440×900) / ≤ 35 % (1024×768) of the work area covered, measured with
 *     L0's hit-test grid (planning.ts measureCoverage; L0 baseline 75–79 % live, 50–55 % static);
 *   - any single drawer open (right: edit-route; bottom: plan-bottom expanded): ≥ 60 % of the map width
 *     and ≥ 60 % of the map height stay visible (coverage-math.ts visibleShare).
 * The covered-by-container breakdown is attached to every result (coverage.json).
 */
import { expect, test, type Page } from 'playwright/test'
import { LIMITS, visibleShare } from './coverage-math'
import { build, Clicks, container, drawerObstacles, gotoPlan, IDS, mapBox, measureCoverage, opener } from './planning'

const vpName = (page: Page) => `${page.viewportSize()!.width}x${page.viewportSize()!.height}`

test.describe('map coverage, default Plan state', () => {
  // TODO(L2, L3): fails until the console aside, the live aside, the open rail and the 120 px dock leave
  // the map (L0 §2: 75.2 % / 78.0 % live). Flip to test() when L2 and L3 are on design.
  test.fixme('panels cover ≤ 25 % (1440×900) / ≤ 35 % (1024×768) of the map', async ({ page }) => {
    await gotoPlan(page)
    const cov = await measureCoverage(page)
    await test.info().attach('coverage.json', { body: JSON.stringify({ build: build(), ...cov }, null, 1), contentType: 'application/json' })
    const limit = LIMITS.defaultCoveredPct[vpName(page)]
    expect(limit, 'viewport has a target').toBeDefined()
    expect(cov.coveredPct, JSON.stringify(cov.by)).toBeLessThanOrEqual(limit)
  })
})

test.describe('map coverage, one drawer open @clicks', () => {
  const drawers: { id: string; label: string; open: (page: Page, c: Clicks) => Promise<void>; live: boolean; owner: string }[] = [
    {
      id: IDS.bottom,
      label: 'bottom drawer (plan table / timeline) expanded',
      live: false,
      owner: 'L2',
      open: async (page, c) => c.click(opener(page, IDS.bottom)),
    },
    {
      id: IDS.editRoute,
      label: 'Edit-route drawer',
      live: true,
      owner: 'L3',
      open: async (page, c) => c.click(opener(page, IDS.editRoute)),
    },
  ]
  for (const d of drawers) {
    // TODO(L2: plan-bottom; L3: edit-route): the containers are not mounted yet.
    test.fixme(`${d.label} leaves ≥ 60 % of the map width and height (${d.owner})`, async ({ page }) => {
      test.skip(d.live && build() !== 'live', 'live container: only with the API reachable')
      await gotoPlan(page)
      const before = await mapBox(page)
      const c = new Clicks()
      await d.open(page, c)
      await expect(container(page, d.id)).toBeVisible()
      await page.waitForTimeout(500) // drawer measured and reported (layoutInsets)
      const map = await mapBox(page)
      // the map is overlaid, not shrunk (§6 test 7: no layout shift other than the recentre)
      expect(map).toEqual(before)
      const share = visibleShare(map, await drawerObstacles(page))
      await test.info().attach('share.json', { body: JSON.stringify({ build: build(), map, share }), contentType: 'application/json' })
      expect(share.width).toBeGreaterThanOrEqual(LIMITS.minVisibleShare)
      expect(share.height).toBeGreaterThanOrEqual(LIMITS.minVisibleShare)
    })
  }
})
