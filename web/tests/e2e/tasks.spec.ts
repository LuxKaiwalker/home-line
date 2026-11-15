/**
 * §10.4 part B acceptance — planning tasks T1–T9 (§10.1) as Playwright scripts (package L5, D111/D114;
 * steps from L6's audit, notes/L6-top10.md and docs/design/planning-usability.md).
 * Builds: live with the API reachable (all of T1–T9); live with the API unreachable (T1, T2 on the
 * official pads, T7 and T9 pass; T3–T6 and T8 show the offline note instead of dead controls); static.
 * The I1 mouse mapping is unchanged (D114): left drags objects, right-drag pans.
 * Owners of the fixme steps: L2/L3 (containers), L7b (Official plan, truthful drag readout, P5 reason),
 * L8 (step hints, disabled reasons, progress with expected time, undo/redo buttons), waypoint tickets
 * W-1…W-6 and WP6 (#130: Add waypoint, ghost route), S1 (mission.json).
 * All tests here use real pointer input: @clicks.
 */
import { expect, test, type Page } from 'playwright/test'
import { build, container, copy, dragRover, gotoPlan, IDS, opener, roverAt, routeResult } from './planning'

const live = () => test.skip(build() !== 'live', 'needs the API reachable')
const notStatic = () => test.skip(build() === 'static', 'live builds only')
const changeSummary = (page: Page) => page.getByText('What this change costs').first()

test.describe('part B tasks @clicks', () => {
  // T1 — understand the map: legend captions for the field, the thread and the margin.
  // TODO(L2): legend corner chip (Popover id legend).
  test.fixme('T1: the legend explains field, thread and margin (TODO L2)', async ({ page }) => {
    await gotoPlan(page)
    await opener(page, IDS.legend).click()
    const legend = container(page, IDS.legend)
    await expect(legend).toBeVisible()
    await expect(legend).toContainText(/homeline|reach/i) // the coloured field
    await expect(legend).toContainText(/route|thread/i)
    await expect(legend).toContainText(/margin/i)
  })

  // T2 — move the rover: dragging the rover itself shows validity at once (all builds; offline = official pads).
  test('T2: dragging the rover shows a readout, the change summary follows on release', async ({ page }) => {
    await gotoPlan(page)
    const at = await roverAt(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x - 60, at.y + 10, { steps: 12 })
    await expect(page.locator('.hl-edit-rover')).toHaveClass(/is-dragging/)
    await expect(page.locator('.hl-edit-drag-host')).not.toBeEmpty({ timeout: 5_000 })
    await page.mouse.up()
    await expect(changeSummary(page)).toBeVisible({ timeout: 10_000 })
  })

  // TODO(L7b): L6 #3 — with the API up the readout claims live planning is offline.
  test.fixme('T2: the drag readout is truthful about the live planner (TODO L7b)', async ({ page }) => {
    notStatic()
    await gotoPlan(page)
    const at = await roverAt(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x - 60, at.y + 10, { steps: 12 })
    const readout = page.locator('.hl-edit-drag-host')
    await expect(readout).not.toBeEmpty({ timeout: 5_000 })
    if (build() === 'live') await expect(readout).not.toContainText(copy.edit.snapStatic)
    else await expect(readout).toContainText(/offline/i)
    await page.mouse.up()
  })

  // TODO(L3): L0 #14 — readout and change summary in the rover MarkerCard (id rover).
  test.fixme('T2: the change summary opens in the rover card (TODO L3)', async ({ page }) => {
    await gotoPlan(page)
    await dragRover(page)
    await expect(container(page, IDS.rover)).toBeVisible()
    await expect(container(page, IDS.rover)).toContainText('What this change costs')
  })

  // T3 — choose stations and their order in the Edit-route drawer; ghost route while choosing.
  // TODO(L3 drawer; waypoint W-4 checkboxes enabled or with a reason; W-3 / WP6 ghost route).
  test.fixme('T3: tick and reorder stops; the ghost route follows (TODO L3, W-3, W-4)', async ({ page }) => {
    live()
    await gotoPlan(page)
    await opener(page, IDS.editRoute).click()
    const drawer = container(page, IDS.editRoute)
    const s7 = drawer.getByRole('checkbox', { name: /S7/ })
    await expect(s7).toBeEnabled()
    await s7.check()
    await expect(drawer.locator('.hl-route__leg').first()).toBeVisible()
    await expect(page.locator('.hl-ghost-route, [data-ghost-route]').first()).toBeVisible()
  })

  // T4 — add, move and delete a free waypoint. TODO(waypoint WP6, #130).
  test.fixme('T4: Add waypoint, click the map, move and delete it (TODO WP6 #130)', async ({ page }) => {
    live()
    await gotoPlan(page)
    await opener(page, IDS.editRoute).click()
    await container(page, IDS.editRoute).getByRole('button', { name: /add waypoint/i }).click()
    const at = await roverAt(page)
    await page.mouse.click(at.x + 120, at.y - 80)
    const wp = page.locator('[data-waypoint]').first()
    await expect(wp).toBeVisible()
    const b = (await wp.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 40, b.y + 20, { steps: 8 })
    await page.mouse.up()
    await wp.focus()
    await page.keyboard.press('Delete')
    await expect(page.locator('[data-waypoint]')).toHaveCount(0)
  })

  // T5 — one compute button; progress with stages and expected time; the map stays usable.
  // TODO(waypoint W-1 one button, W-2 expected time; L8 progress stage list).
  test.fixme('T5: one compute button, progress with stage and expected time, map usable (TODO W-1, W-2, L8)', async ({ page }) => {
    live()
    test.setTimeout(180_000)
    await gotoPlan(page)
    await opener(page, IDS.editRoute).click()
    const compute = page.getByRole('button', { name: /compute/i }).filter({ visible: true })
    await expect(compute).toHaveCount(1)
    await compute.click()
    const progress = container(page, IDS.editRoute).locator('[role="progressbar"], .hl-route__progress').first()
    await expect(progress).toBeVisible()
    await expect(container(page, IDS.editRoute)).toContainText(/expected|about \d+ min|~\s?\d+ min/i)
    // map usable during the job (I1: right-drag pans)
    const cam = page.locator('[data-camera-center]').first()
    const before = await cam.getAttribute('data-camera-center')
    const at = await roverAt(page)
    await page.mouse.move(at.x - 200, at.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(at.x - 140, at.y + 20, { steps: 8 })
    await page.mouse.up({ button: 'right' })
    await expect(cam).not.toHaveAttribute('data-camera-center', before!)
    await expect(routeResult(page)).toBeVisible({ timeout: 120_000 })
  })

  // T6 — understand the result: feasible/infeasible, failing leg and limit, margin, "Computed live".
  // TODO(waypoint W-6): a feasible route shows its tightest margin. ("Computed live" passes today: numbers.spec.ts.)
  test.fixme('T6: the result says feasible or not, the margin and "Computed live" (TODO W-6)', async ({ page }) => {
    live()
    test.setTimeout(180_000)
    await gotoPlan(page)
    await opener(page, IDS.editRoute).click()
    await page.locator('.hl-route__compute').filter({ visible: true }).click()
    const r = routeResult(page)
    await expect(r).toBeVisible({ timeout: 120_000 })
    await expect(r).toContainText('Computed live')
    await expect(r.locator('.hl-route__ok, .hl-route__infeasible')).toHaveCount(1)
    await expect(r).toContainText(/margin/i)
    await expect(r.locator('.num[data-trust="live"]').first()).toBeVisible()
  })

  // T7 — undo: Ctrl-Z after a rover move puts the rover back (all builds, also with the API down).
  test('T7: Ctrl-Z undoes a rover move', async ({ page }) => {
    await gotoPlan(page)
    const start = await roverAt(page)
    await dragRover(page)
    await expect(changeSummary(page)).toBeVisible({ timeout: 10_000 })
    const moved = await roverAt(page)
    expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(5)
    await page.locator('.console-map canvas').first().focus().catch(() => {})
    await page.keyboard.press('Control+z')
    await expect.poll(async () => {
      const p = await roverAt(page)
      return Math.hypot(p.x - start.x, p.y - start.y)
    }, { timeout: 10_000 }).toBeLessThan(3)
  })

  // TODO(L8, waypoint W-5): visible undo/redo buttons with a reason when disabled.
  test.fixme('T7: undo and redo buttons are visible and say why when disabled (TODO L8, W-5)', async ({ page }) => {
    await gotoPlan(page)
    const undo = page.getByRole('button', { name: copy.buttons.undo }).filter({ visible: true }).first()
    const redo = page.getByRole('button', { name: copy.buttons.redo }).filter({ visible: true }).first()
    await expect(undo).toBeVisible()
    await expect(redo).toBeVisible()
    await expect(undo).toHaveAttribute('title', copy.edit.undoEmpty)
    await dragRover(page)
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(redo).toBeEnabled()
  })

  // T8 — save to My plans, copy a permalink, export JSON and mission.json.
  // TODO(L3 My plans in the drawer; S1 mission.json).
  test.fixme('T8: save to My plans, permalink, Export JSON, mission.json (TODO L3, S1)', async ({ page, context }) => {
    live()
    test.setTimeout(180_000)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await gotoPlan(page)
    await opener(page, IDS.editRoute).click()
    await page.locator('.hl-route__compute').filter({ visible: true }).click()
    await expect(routeResult(page)).toBeVisible({ timeout: 120_000 })
    const drawer = container(page, IDS.editRoute)
    await drawer.getByRole('button', { name: /save/i }).first().click()
    await opener(page, IDS.myPlans).click()
    await expect(container(page, IDS.myPlans).getByRole('listitem').first()).toBeVisible()
    await drawer.getByRole('button', { name: /permalink|copy link/i }).first().click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/#\/plan\/[0-9a-f]+/)
    const json = page.waitForEvent('download')
    await drawer.getByRole('button', { name: copy.buttons.exportJson }).first().click()
    expect((await json).suggestedFilename()).toMatch(/\.json$/)
    const mission = page.waitForEvent('download')
    await drawer.getByRole('button', { name: /mission\.json/i }).first().click()
    expect((await mission).suggestedFilename()).toBe('mission.json')
  })

  // T9 — one visible "Official plan" action brings the official plan back (all builds).
  // TODO(L7b): L6 #1, no such action on design.
  test.fixme('T9: "Official plan" returns to the official plan (TODO L7b)', async ({ page }) => {
    await gotoPlan(page)
    const start = await roverAt(page)
    await dragRover(page)
    await expect(changeSummary(page)).toBeVisible({ timeout: 10_000 })
    const back = page.getByRole('button', { name: copy.nav.officialPlan })
    await expect(back).toHaveCount(1)
    await back.click()
    await expect.poll(async () => {
      const p = await roverAt(page)
      return Math.hypot(p.x - start.x, p.y - start.y)
    }, { timeout: 10_000 }).toBeLessThan(3)
    await expect(page.locator('.hl-edit-rover')).toHaveAttribute('data-select-pad', 'rank1')
  })

  // §10.4.1 — API unreachable: the tasks that need the planner show the offline note, no dead controls.
  test('API down: T3–T6 and T8 show the offline note instead of dead controls', async ({ page }) => {
    test.skip(build() !== 'livedown', 'live build with the API down only')
    await gotoPlan(page)
    await expect(page.locator('.live-status[data-state="offline"]')).toBeVisible()
    await expect(page.locator('.hl-route__compute, .hl-route__check').filter({ visible: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /compute/i }).filter({ visible: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /add waypoint/i }).filter({ visible: true })).toHaveCount(0)
  })

  // TODO(L8; L6 L-05): with the API down the route entry vanishes without a word; L8 puts a short
  // "needs the live planner" note where the Edit-route opener would be.
  test.fixme('API down: a "needs the live planner" note replaces the route entry (TODO L8)', async ({ page }) => {
    test.skip(build() !== 'livedown', 'live build with the API down only')
    await gotoPlan(page)
    await expect(page.getByText(/needs (the )?live plann/i).filter({ visible: true }).first()).toBeVisible()
  })

  // §10.4.2 — no control is clickable without a visible effect or a stated reason: every visible disabled
  // control in the Plan view says why (title, aria-describedby or aria-disabled with a description).
  // TODO(L8): "every disabled control says why (tooltip)".
  test.fixme('no disabled control without a stated reason (TODO L8)', async ({ page }) => {
    await gotoPlan(page)
    if (build() === 'live') await opener(page, IDS.editRoute).click()
    const silent = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button:disabled, input:disabled, select:disabled, [aria-disabled="true"]')]
        .filter((e) => e.offsetParent !== null)
        .filter((e) => !(e.title || e.getAttribute('aria-describedby') || e.closest('[title]')))
        .map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? e.outerHTML.slice(0, 80)),
    )
    expect(silent).toEqual([])
  })
})
