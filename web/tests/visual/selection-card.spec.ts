/**
 * L2e (D111, team lead 16:51): every selection opens as a pop-up card on the map, not the right sidebar.
 * Not a screenshot test: it lives here so the visual config runs it (serial click project, ?view=2d)
 * against the built app.
 *   - A click on a parking option (P2), a scored site (S8) and a landmark opens its card anchored at the
 *     object (#hl-lay-selection; a scored site is a station: #hl-lay-station), focus moves into the
 *     card, the card never covers the object's point, the right sidebar stays closed, no Details toggle.
 *   - Esc closes it and focus returns to what was clicked.
 *   - ?legacy=1 keeps the old layout: its side panel, no pop-up card.
 * Run: cd web && npm run build && npx playwright test tests/visual/selection-card.spec.ts
 */
import { expect, test, type Page } from 'playwright/test'

type Pt = { x: number; y: number }

/** Screen point of a labels.json label: its 0 × 0 marker sits on the label's lon/lat (MapLibre translate). */
async function pointOf(page: Page, code: string): Promise<Pt> {
  return page.evaluate((c) => {
    const el = document.querySelector<HTMLElement>(`.hl-label[data-code="${c}"]`)
    const map = el?.closest('.maplibregl-map')
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el?.style.transform ?? '')
    if (!el || !map || !m) throw new Error(`no label ${c}`)
    const r = map.getBoundingClientRect()
    return { x: r.left + Number(m[1]), y: r.top + Number(m[2]) }
  }, code)
}

async function openPlan(page: Page): Promise<void> {
  await page.goto('/?intro=0&view=2d#/')
  await page.locator('.hl-edit-rover').waitFor({ timeout: 60_000 })
  await page.locator('.hl-label[data-code="P2"]').waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForLoadState('networkidle')
}

/** The first landmark whose pill is on screen. */
async function landmarkCode(page: Page): Promise<string> {
  const pill = page.locator('.hl-label[data-kind="landmark"] .hl-label__pill:visible').first()
  await pill.waitFor({ timeout: 15_000 })
  return (await pill.locator('xpath=..').getAttribute('data-code'))!
}

const activeCode = (page: Page) => page.evaluate(() => (document.activeElement?.closest('.hl-label') as HTMLElement | null)?.dataset.code ?? null)
const focusInCard = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.sel-card'))

for (const [what, code, cardId, title] of [
  ['a parking option', 'P2', 'hl-lay-selection', 'Parking option'],
  ['a scored site', 'S8', 'hl-lay-station', 'S8'],
  ['a landmark', '', 'hl-lay-selection', ''],
] as const) {
  test(`a click on ${what} opens its pop-up card at the object; Esc closes it and focus returns`, async ({ page }) => {
    await openPlan(page)
    const c = code || (await landmarkCode(page))
    const pill = page.locator(`.hl-label[data-code="${c}"] .hl-label__pill`)
    const pressed = await pill.isVisible()
    if (pressed) await pill.click()
    // a label without a clear spot at this size keeps its box but hides (labels.css): the same click
    // through the DOM (the map's capture handler selects it as for a pointer click)
    else await pill.evaluate((el: HTMLElement) => el.click())
    const card = page.locator(`#${cardId}`)
    await card.locator('.hl-card').first().waitFor({ timeout: 30_000 })
    await expect(card).toHaveAttribute('role', 'dialog')
    await expect(card.locator('.hl-lay-card__title')).toContainText(title || c)
    await expect(page.locator('.sel-card')).toHaveCount(1) // one card at a time
    // the card keeps the content: trust chips on its numbers
    await expect(card.locator('.hl-chip__mark').first()).toBeAttached()
    // focus moved into the card
    expect(await focusInCard(page)).toBe(true)
    // the right sidebar does not open; its Details toggle is gone
    await expect(page.locator('.hl-shell')).toHaveAttribute('data-sidebar', 'closed')
    await expect(page.locator('.hl-topbar button[aria-controls="hl-sidebar"]')).toHaveCount(0)
    // the card never covers the object (its point), and stays inside the map
    await page.waitForTimeout(300) // the lazy body grows; the card re-places itself
    const b = (await card.boundingBox())!
    const p = await pointOf(page, c)
    const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
    expect(inside, `card ${JSON.stringify(b)} covers ${c} at ${JSON.stringify(p)}`).toBe(false)
    const map = (await page.locator('.console-map').boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(map.x - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(map.x + map.width + 1)
    // Esc closes it; focus goes back to what was clicked (a hidden label: nothing was pressed)
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    if (pressed) expect(await activeCode(page)).toBe(c)
    else expect(await focusInCard(page)).toBe(false)
  })
}

test('× closes the card and returns focus; a new selection opens one card again', async ({ page }) => {
  await openPlan(page)
  await page.locator('.hl-label[data-code="P2"] .hl-label__pill').click()
  const card = page.locator('#hl-lay-selection')
  await card.locator('.hl-card').first().waitFor({ timeout: 30_000 })
  await card.locator('.hl-lay-close').click()
  await expect(card).toHaveCount(0)
  expect(await activeCode(page)).toBe('P2')
  // the next object on screen opens its own card, and only that one
  const next = page.locator('.hl-label:not([data-code="P2"]) .hl-label__pill:visible').first()
  await next.click()
  await expect(page.locator('.sel-card')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('.hl-shell')).toHaveAttribute('data-sidebar', 'closed')
})

test('?legacy=1 keeps the old layout: its side panel, no pop-up card', async ({ page }) => {
  await page.goto('/?intro=0&legacy=1&view=2d#/')
  await expect(page.locator('.console-panel')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.hl-shell')).toHaveCount(0)
  const pill = page.locator('.hl-label[data-code="P2"] .hl-label__pill')
  if (await pill.isVisible().catch(() => false)) {
    await pill.click()
    await page.waitForTimeout(500)
  }
  await expect(page.locator('.sel-card')).toHaveCount(0)
  await expect(page.locator('.console-panel')).toBeVisible()
})
