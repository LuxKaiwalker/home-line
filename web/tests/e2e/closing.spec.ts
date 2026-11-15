/**
 * §6 test 3 — closing (package L5, D111): Esc closes the topmost container, focus returns to the
 * element that opened it, aria-expanded follows the state. One map-edge popover, one card and one drawer
 * per side at a time (§4 rules). Opened from the keyboard (focus the opener, Enter) so the focus return
 * is checked against a known element. All tests here click: @clicks.
 */
import { expect, test, type Locator, type Page } from 'playwright/test'
import { build, container, expectFocused, gotoPlan, IDS, opener } from './planning'

interface Target {
  id: string
  owner: string
  live?: boolean
  /** the element that opens it and gets focus back */
  opener: (page: Page) => Locator
}

const TARGETS: Target[] = [
  { id: IDS.layers, owner: 'L2', opener: (p) => opener(p, IDS.layers) },
  { id: IDS.legend, owner: 'L2', opener: (p) => opener(p, IDS.legend) },
  { id: IDS.bottom, owner: 'L2', opener: (p) => opener(p, IDS.bottom) },
  { id: IDS.station, owner: 'L2', opener: (p) => p.getByRole('button', { name: /^S7: / }) },
  { id: IDS.editRoute, owner: 'L3', live: true, opener: (p) => opener(p, IDS.editRoute) },
]

async function openByKey(page: Page, op: Locator): Promise<void> {
  await op.focus()
  await page.keyboard.press('Enter')
}

/** aria-expanded on the opener when it is a disclosure (station pills are not). */
async function expectExpanded(op: Locator, v: 'true' | 'false'): Promise<void> {
  if ((await op.getAttribute('aria-controls')) !== null) await expect(op).toHaveAttribute('aria-expanded', v)
}

test.describe('Esc closes the topmost container @clicks', () => {
  for (const t of TARGETS) {
    // TODO(L2 / L3 as named): containers not mounted on design yet.
    test.fixme(`${t.id}: Esc closes it, focus back on the opener, aria-expanded (TODO ${t.owner})`, async ({ page }) => {
      test.skip(!!t.live && build() !== 'live', 'live container: only with the API reachable')
      await gotoPlan(page)
      const op = t.opener(page)
      await expectExpanded(op, 'false')
      await openByKey(page, op)
      await expect(container(page, t.id)).toBeVisible()
      await expectExpanded(op, 'true')
      await page.keyboard.press('Escape')
      await expect(container(page, t.id)).toBeHidden()
      await expectExpanded(op, 'false')
      await expectFocused(op)
    })
  }

  // TODO(L2): bottom drawer + layers popover.
  test.fixme('two containers: Esc closes the last opened first, then the other (TODO L2)', async ({ page }) => {
    await gotoPlan(page)
    const grip = opener(page, IDS.bottom)
    const layers = opener(page, IDS.layers)
    await openByKey(page, grip)
    await expect(container(page, IDS.bottom)).toBeVisible()
    await openByKey(page, layers)
    await expect(container(page, IDS.layers)).toBeVisible()
    await expect(container(page, IDS.bottom)).toBeVisible() // a popover does not close the bottom drawer
    await page.keyboard.press('Escape')
    await expect(container(page, IDS.layers)).toBeHidden()
    await expect(container(page, IDS.bottom)).toBeVisible()
    await expectFocused(layers)
    await page.keyboard.press('Escape')
    await expect(grip).toHaveAttribute('aria-expanded', 'false')
  })

  // TODO(L2): layers + legend popovers.
  test.fixme('one map-edge popover at a time (TODO L2)', async ({ page }) => {
    await gotoPlan(page)
    await opener(page, IDS.layers).click()
    await expect(container(page, IDS.layers)).toBeVisible()
    await opener(page, IDS.legend).click()
    await expect(container(page, IDS.legend)).toBeVisible()
    await expect(container(page, IDS.layers)).toBeHidden()
    await expect(opener(page, IDS.layers)).toHaveAttribute('aria-expanded', 'false')
  })

  // TODO(L2): station MarkerCard.
  test.fixme('one station card at a time (TODO L2)', async ({ page }) => {
    await gotoPlan(page)
    await page.getByRole('button', { name: /^S7: / }).click()
    await expect(container(page, IDS.station)).toContainText('S7')
    await page.getByRole('button', { name: /^S1: / }).click()
    await expect(page.locator(`#${'hl-lay-' + IDS.station}`)).toHaveCount(1)
    await expect(container(page, IDS.station)).toContainText('S1')
    await expect(container(page, IDS.station)).not.toContainText('S7')
  })
})
