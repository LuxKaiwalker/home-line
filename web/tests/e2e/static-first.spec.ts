/**
 * §6 test 6 — static first (kit rule 4; package L5, D111; D114: the published build is live).
 *   - VITE_LIVE off (static build): no live container, no live button, no live label, no status line.
 *   - Live build, API unreachable: the offline banner shows and the live controls are hidden, not
 *     disabled (no Edit-route opener, no compute button, no rover pad tool, no empty live column).
 *   - Live build, API reachable: no offline banner; the Edit-route opener is there.
 */
import { expect, test, type Page } from 'playwright/test'
import { build, container, copy, domId, gotoPlan, IDS, opener } from './planning'

const OFFLINE = 'Live planning is offline · showing precomputed plans' // config/backend.yaml labels.offline

/** Live-only things that must not be visible (static build, or API down). */
async function expectNoLiveControls(page: Page): Promise<void> {
  await expect(page.locator(`[aria-controls="${domId(IDS.editRoute)}"]`).filter({ visible: true })).toHaveCount(0)
  await expect(container(page, IDS.editRoute)).toBeHidden()
  await expect(container(page, IDS.crew)).toBeHidden()
  await expect(container(page, IDS.myPlans)).toBeHidden()
  await expect(page.locator('.hl-route__compute').filter({ visible: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Compute( full)? plan$/ }).filter({ visible: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: copy.buttons.setAsPad }).filter({ visible: true })).toHaveCount(0)
  await expect(page.getByText(copy.simulator.sendSlot).filter({ visible: true })).toHaveCount(0)
}

test('static build: no live container, button or label', async ({ page }) => {
  test.skip(build() !== 'static', 'static build only')
  await gotoPlan(page)
  await expect(page.locator('.live-status')).toHaveCount(0)
  await expect(page.locator('.console-live')).toHaveCount(0)
  await expect(page.locator(`#${domId(IDS.editRoute)}, #${domId(IDS.crew)}, #${domId(IDS.myPlans)}`)).toHaveCount(0)
  await expect(page.getByText('Computed live').filter({ visible: true })).toHaveCount(0)
  await expectNoLiveControls(page)
})

test('API unreachable: offline banner, live controls hidden', async ({ page }) => {
  test.skip(build() !== 'livedown', 'live build with the API down only')
  await gotoPlan(page)
  const banner = page.locator('.live-status[data-state="offline"]')
  await expect(banner).toBeVisible()
  await expect(banner).toHaveText(OFFLINE)
  await expectNoLiveControls(page)
})

// TODO(L3): Q8 — the live aside stays as an empty 340 px column while the API is down (L0 §2).
test.fixme('API unreachable: no empty live column (TODO L3)', async ({ page }) => {
  test.skip(build() !== 'livedown', 'live build with the API down only')
  await gotoPlan(page)
  await expect(page.locator('.console-live').filter({ visible: true })).toHaveCount(0)
})

test('API reachable: no offline banner', async ({ page }) => {
  test.skip(build() !== 'live', 'live build with the API reachable only')
  await gotoPlan(page)
  await expect(page.locator('.live-status')).toBeHidden()
})

// TODO(L3): the "Edit route" opener at the map edge.
test.fixme('API reachable: the Edit-route opener is shown (TODO L3)', async ({ page }) => {
  test.skip(build() !== 'live', 'live build with the API reachable only')
  await gotoPlan(page)
  await expect(opener(page, IDS.editRoute)).toBeVisible()
  await expect(opener(page, IDS.editRoute)).toHaveAttribute('aria-expanded', 'false')
})
