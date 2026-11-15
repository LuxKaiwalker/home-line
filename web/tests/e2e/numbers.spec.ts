/**
 * §6 test 5 — numbers (package L5, D111). Layout only: no number may change.
 *   - Value snapshot: covered by the existing CI job `value-snapshot` (.github/workflows/design.yml:
 *     `npm run values:snapshot -- --check ../tests/fixtures/values_baseline.json`); this spec only checks
 *     that the job is still there, so the reference cannot silently disappear.
 *   - Trust chips: the headline strip (30-min, 60-min, tightest margin) carries one chip per number, and
 *     the plan table keeps its chips.
 *   - "Computed live": a live route result carries the live label and data-trust="live".
 */
import { readFileSync } from 'node:fs'
import { expect, test } from 'playwright/test'
import { bottomTab, build, container, gotoPlan, IDS, opener, routeResult, showEditRoute } from './planning'

test('value snapshot: the CI job still runs --check against the committed baseline', () => {
  const wf = readFileSync(new URL('../../../.github/workflows/design.yml', import.meta.url), 'utf8')
  expect(wf).toMatch(/^\s{2}value-snapshot:/m)
  expect(wf).toContain('npm run values:snapshot -- --check ../tests/fixtures/values_baseline.json')
})

// TODO(L2): the headline strip in #hl-topbar-plan.
test.fixme('headline strip: 30-min, 60-min and tightest margin, each with its trust chip (TODO L2)', async ({ page }) => {
  await gotoPlan(page)
  const strip = page.locator('#hl-topbar-plan')
  await expect(strip).toBeVisible()
  const nums = strip.locator('.num')
  expect(await nums.count()).toBeGreaterThanOrEqual(3)
  expect(await strip.locator('.hl-chip').count()).toBeGreaterThanOrEqual(await nums.count())
})

// TODO(L2): plan table in the bottom drawer.
test.fixme('plan table keeps its trust chips @clicks (TODO L2)', async ({ page }) => {
  await gotoPlan(page)
  await opener(page, IDS.bottom).click()
  await bottomTab(page, IDS.planTable).click()
  const table = container(page, IDS.bottom)
  await expect(table.getByRole('table')).toBeVisible()
  expect(await table.locator('.hl-chip').count()).toBeGreaterThan(0)
})

test('a live route result is labelled "Computed live" @clicks', async ({ page }) => {
  test.skip(build() !== 'live', 'live result: only with the API reachable')
  test.setTimeout(180_000)
  await gotoPlan(page)
  await showEditRoute(page)
  const compute = page.locator('.hl-route__compute').filter({ visible: true }).first()
  await expect(compute).toBeEnabled({ timeout: 15_000 })
  await compute.click()
  const result = routeResult(page)
  await expect(result).toBeVisible({ timeout: 120_000 })
  await expect(result).toContainText('Computed live')
  await expect(result.locator('.hl-route__prov')).toHaveAttribute('href', /.+/)
})
