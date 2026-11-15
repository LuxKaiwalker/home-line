/**
 * §6 test 2 — reachability (package L5, D111). Every core item of §4 (Edit route, layers, legend,
 * station card, search, timeline, plan table, My plans, Send to simulator, Official plan) is reachable
 * from the default Plan state in ≤ 2 clicks, and by keyboard (Tab to the opener, Enter; arrows in a
 * tab list; Ctrl-K for the palette). Live-only items (Edit route, My plans, Send to simulator) run on the
 * live build with the API reachable; with the API down they must be absent (static-first.spec.ts).
 * All tests here use real clicks: @clicks (serial projects).
 */
import { expect, test, type Page } from 'playwright/test'
import { bottomTab, build, Clicks, container, copy, dragRover, expectFocused, gotoPlan, IDS, opener, tabTo } from './planning'

const MAX_CLICKS = 2
const liveOnly = () => test.skip(build() !== 'live', 'live item: only with the API reachable')

interface Item {
  name: string
  owner: string | null // null: passes on design today
  live?: boolean
  /** clicks from the default state; returns what must then be visible */
  byClicks: (page: Page, c: Clicks) => Promise<void>
  byKeys: (page: Page) => Promise<void>
}

const ITEMS: Item[] = [
  {
    name: 'Edit route',
    owner: 'L3',
    live: true,
    byClicks: async (page, c) => {
      await c.click(opener(page, IDS.editRoute))
      await expect(container(page, IDS.editRoute)).toBeVisible()
      await expect(opener(page, IDS.editRoute)).toHaveAttribute('aria-expanded', 'true')
    },
    byKeys: async (page) => {
      await tabTo(page, opener(page, IDS.editRoute))
      await page.keyboard.press('Enter')
      await expect(container(page, IDS.editRoute)).toBeVisible()
      await expectFocused(container(page, IDS.editRoute)) // focus moves in (close button)
    },
  },
  {
    name: 'layers',
    owner: 'L2',
    byClicks: async (page, c) => {
      await c.click(opener(page, IDS.layers))
      await expect(container(page, IDS.layers)).toBeVisible()
    },
    byKeys: async (page) => {
      await tabTo(page, opener(page, IDS.layers))
      await page.keyboard.press('Enter')
      await expect(container(page, IDS.layers)).toBeVisible()
    },
  },
  {
    name: 'legend',
    owner: 'L2',
    byClicks: async (page, c) => {
      await c.click(opener(page, IDS.legend))
      await expect(container(page, IDS.legend)).toBeVisible()
    },
    byKeys: async (page) => {
      await tabTo(page, opener(page, IDS.legend))
      await page.keyboard.press('Enter')
      await expect(container(page, IDS.legend)).toBeVisible()
    },
  },
  {
    name: 'station card',
    owner: 'L2',
    byClicks: async (page, c) => {
      await c.click(page.getByRole('button', { name: /^S7: / }))
      await expect(container(page, IDS.station)).toBeVisible()
      await expect(container(page, IDS.station)).toContainText('S7')
      expect(new URL(page.url()).hash, 'a station click selects only (Q1), no navigation').toBe('#/')
    },
    byKeys: async (page) => {
      await page.keyboard.press('Control+k')
      await page.getByRole('combobox', { name: copy.nav.search }).fill('S7')
      await expect(page.getByRole('option', { selected: true })).toContainText('S7')
      await page.keyboard.press('Enter')
      await expect(container(page, IDS.station)).toBeVisible()
      await expect(container(page, IDS.station)).toContainText('S7')
    },
  },
  {
    name: 'search',
    owner: null,
    byClicks: async (page, c) => {
      await c.click(page.getByRole('button', { name: copy.nav.search }))
      await expect(page.getByRole('combobox', { name: copy.nav.search })).toBeVisible()
    },
    byKeys: async (page) => {
      await page.keyboard.press('Control+k')
      await expect(page.getByRole('combobox', { name: copy.nav.search })).toBeFocused()
    },
  },
  {
    name: 'timeline',
    owner: 'L2',
    byClicks: async (page, c) => {
      await expect(page.locator('.hl-tl__play').filter({ visible: true })).toHaveCount(1) // slim scrubber: 0 clicks
      await c.click(opener(page, IDS.bottom))
      if ((await bottomTab(page, IDS.timeline).getAttribute('aria-selected')) !== 'true') await c.click(bottomTab(page, IDS.timeline))
      await expect(bottomTab(page, IDS.timeline)).toHaveAttribute('aria-selected', 'true')
      await expect(container(page, IDS.bottom)).toBeVisible()
    },
    byKeys: async (page) => {
      await tabTo(page, opener(page, IDS.bottom))
      await page.keyboard.press('Enter')
      await expect(opener(page, IDS.bottom)).toHaveAttribute('aria-expanded', 'true')
      await selectTabByKeys(page, IDS.timeline)
    },
  },
  {
    name: 'plan table',
    owner: 'L2',
    byClicks: async (page, c) => {
      await c.click(opener(page, IDS.bottom))
      if ((await bottomTab(page, IDS.planTable).getAttribute('aria-selected')) !== 'true') await c.click(bottomTab(page, IDS.planTable))
      await expect(bottomTab(page, IDS.planTable)).toHaveAttribute('aria-selected', 'true')
      await expect(container(page, IDS.bottom).getByRole('table')).toBeVisible()
    },
    byKeys: async (page) => {
      await tabTo(page, opener(page, IDS.bottom))
      await page.keyboard.press('Enter')
      await selectTabByKeys(page, IDS.planTable)
      await expect(container(page, IDS.bottom).getByRole('table')).toBeVisible()
    },
  },
  {
    name: 'My plans',
    owner: 'L3',
    live: true,
    byClicks: async (page, c) => {
      await c.click(opener(page, IDS.editRoute))
      const sec = opener(page, IDS.myPlans)
      if ((await sec.getAttribute('aria-expanded')) !== 'true') await c.click(sec)
      await expect(container(page, IDS.myPlans)).toBeVisible()
    },
    byKeys: async (page) => {
      await tabTo(page, opener(page, IDS.editRoute))
      await page.keyboard.press('Enter')
      const sec = opener(page, IDS.myPlans)
      await tabTo(page, sec)
      if ((await sec.getAttribute('aria-expanded')) !== 'true') await page.keyboard.press('Enter')
      await expect(container(page, IDS.myPlans)).toBeVisible()
    },
  },
  {
    name: 'Send to simulator',
    owner: 'L3',
    live: true,
    byClicks: async (page, c) => {
      await c.click(opener(page, IDS.editRoute))
      await expect(container(page, IDS.editRoute).getByText(copy.simulator.sendSlot).first()).toBeVisible()
    },
    byKeys: async (page) => {
      await tabTo(page, opener(page, IDS.editRoute))
      await page.keyboard.press('Enter')
      await expect(container(page, IDS.editRoute).getByText(copy.simulator.sendSlot).first()).toBeVisible()
    },
  },
  {
    // T9: one visible action back to the official plan once the plan differs from it
    name: 'Official plan',
    owner: 'L7b',
    byClicks: async (page, c) => {
      await dragRover(page) // a change (not counted: it is what makes the action relevant)
      await c.click(page.getByRole('button', { name: copy.nav.officialPlan }))
    },
    byKeys: async (page) => {
      await dragRover(page)
      await tabTo(page, page.getByRole('button', { name: copy.nav.officialPlan }))
      await page.keyboard.press('Enter')
    },
  },
]

/** Arrow keys through the bottom drawer's tab list until `tab` is selected. */
async function selectTabByKeys(page: Page, tab: string): Promise<void> {
  const target = bottomTab(page, tab)
  const selected = page.locator(`#hl-lay-${IDS.bottom}-tab-${IDS.planTable}, #hl-lay-${IDS.bottom}-tab-${IDS.timeline}`).and(page.locator('[aria-selected="true"]'))
  await selected.focus()
  for (let i = 0; i < 4 && (await target.getAttribute('aria-selected')) !== 'true'; i++) await page.keyboard.press('ArrowRight')
  await expect(target).toHaveAttribute('aria-selected', 'true')
  await expect(target).toBeFocused()
}

test.describe('reachability from the default Plan state @clicks', () => {
  for (const item of ITEMS) {
    const def = item.owner ? test.fixme : test
    const owner = item.owner ? ` (TODO ${item.owner})` : ''
    def(`${item.name}: ≤ ${MAX_CLICKS} clicks${owner}`, async ({ page }) => {
      if (item.live) liveOnly()
      await gotoPlan(page)
      const c = new Clicks()
      await item.byClicks(page, c)
      expect(c.n).toBeLessThanOrEqual(MAX_CLICKS)
    })
    def(`${item.name}: by keyboard${owner}`, async ({ page }) => {
      if (item.live) liveOnly()
      await gotoPlan(page)
      await item.byKeys(page)
    })
  }
})
