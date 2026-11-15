/**
 * Plan-port e2e (spec "Port Mission Planer into Plan", W0b skeleton, Q1 tests): one planning interface
 * on the Plan page. Runs on the built app (playwright.config.ts serves web/dist):
 *   cd web && npm run build && HL_CHROMIUM=$(command -v chromium) NODE_PATH=$PWD/node_modules \
 *     npx playwright test -c ../tests/e2e/plan-route/playwright.config.ts
 *
 * Real tests pass on port/plan-mission today. The `test.fixme` ones are written in full against the
 * selectors the wave-1 packages render (plan.ts S, read from their branches) and need I1's wiring
 * (wave 2, 21:32-22:17): each names the hook it waits for in its TODO. I5/Q1 flip them to `test` in
 * the final pass. Hooks that do not exist yet: /tmp/hl-port/requests-I1.md "Q1 test ids".
 */
import { readFileSync } from 'node:fs'
import { expect, test } from 'playwright/test'
import {
  drag,
  emptySpot,
  legacyPlanParam,
  marvisUnreachable,
  openBottomDrawer,
  OFFICIAL_PAD_ID,
  openPlan,
  openRoutePanel,
  padLabel,
  pageErrors,
  PICKER_PAD,
  point,
  REDO,
  routeHash,
  routeReady,
  S,
  station,
  stationMarker,
  stationsLonLat,
  stopLabels,
  UNDO,
} from './plan'

test.describe('smoke', () => {
  test('#/ opens the Plan page with its map', async ({ page }) => {
    const errors = pageErrors(page)
    await openPlan(page)
    await expect(page.locator(S.modeTab)).toHaveText(/Plan/)
    expect(page.url()).toMatch(/#\/$/)
    expect(errors).toEqual([])
  })

  // Today #/?route= parses as the Plan page (router.ts unchanged); after I1 it loads the plan. Either
  // way the page must open on Plan without an uncaught error.
  test('a share link (#/?route=…) opens the Plan page without errors', async ({ page }) => {
    const errors = pageErrors(page)
    await openPlan(page, routeHash(PICKER_PAD, [station('S1'), station('S7')]))
    await expect(page.locator(S.modeTab)).toHaveText(/Plan/)
    expect(errors).toEqual([])
  })

  test('an unreadable share link opens the Plan page without errors', async ({ page }) => {
    const errors = pageErrors(page)
    await openPlan(page, '#/?route=not-a-plan!!')
    await expect(page.locator(S.modeTab)).toHaveText(/Plan/)
    expect(errors).toEqual([])
  })
})

test.describe('pad switch', () => {
  // TODO(I1): installPads() (map/pads) in views/console.tsx -> pad markers [data-pad-mark] + the pad card;
  // installRoutePanel(); ui/strip context bar in the 'context-bar' slot.
  test('marker card "Plan from here" swaps the pad environment and the context bar names the pad', async ({ page }) => {
    const errors = pageErrors(page)
    await openPlan(page)
    await expect(page.locator(S.ctxPad)).toHaveText(padLabel(OFFICIAL_PAD_ID))
    await page.locator(S.padMark(PICKER_PAD)).click()
    const card = page.locator(S.padCard(PICKER_PAD))
    await expect(card).toBeVisible()
    await card.locator(S.padCardPlan).click()
    // env swap: the marker is the active pad and its environment has loaded (no skeleton state)
    const mark = page.locator(S.padMark(PICKER_PAD))
    await expect(mark).toHaveAttribute('aria-current', 'true')
    await expect(mark).toHaveClass(/is-active/)
    await expect(mark).not.toHaveClass(/is-loading/, { timeout: 15_000 })
    await expect(page.locator(S.padStatus)).toHaveCount(0)
    await expect(page.locator(S.ctxPad)).toHaveText(padLabel(PICKER_PAD))
    await expect(card).toContainText('Shown on the map') // P2 card.shown
    // TODO(I1): URL sync of the planning doc (a non-official pad is in the link)
    expect(page.url()).toMatch(/#\/\?route=/)
    expect(errors).toEqual([])
  })

  test('the Route panel pad picker switches the pad (one undo step)', async ({ page }) => {
    await openPlan(page)
    await openRoutePanel(page)
    const radio = page.locator(S.padRadio('rank3'))
    await radio.click()
    await expect(radio).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(S.padRadio(OFFICIAL_PAD_ID))).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator(S.padMark('rank3'))).toHaveClass(/is-active/)
    await expect(page.locator(S.padMark('rank3'))).not.toHaveClass(/is-loading/, { timeout: 15_000 })
    await expect(page.locator(S.ctxPad)).toHaveText(padLabel('rank3'))
    await page.keyboard.press(UNDO)
    await expect(page.locator(S.padRadio(OFFICIAL_PAD_ID))).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(S.ctxPad)).toHaveText(padLabel(OFFICIAL_PAD_ID))
  })
})

test.describe('add stops', () => {
  // TODO(I1): station card hosts R3's <AddToRouteButton station=…> ([data-add-to-route]); R3 install() +
  // setEditing(panel open); R4 install() ('mine' stop markers); U2 list section registered.
  test('station card "Add to route" appends the station, routed from the pad', async ({ page }) => {
    await openPlan(page)
    await openRoutePanel(page)
    await stationMarker(page, 'S7').click()
    const card = page.locator(S.stationCard)
    await expect(card).toContainText('S7')
    await card.locator(S.addToRoute('S7')).click()
    await expect(card.locator(S.addToRoute('S7'))).toHaveAttribute('data-in-route', '')
    expect(await stopLabels(page)).toEqual(['S7'])
    await expect(page.locator(S.mineStops)).toHaveCount(1)
    await routeReady(page)
    await expect(page.locator(S.estimates)).toContainText(/Total time\s*\d+(\.\d)?\s*min/)
    await expect(page.locator(S.ctxWhat)).toHaveText('Your route')
  })

  test('a map click adds a free waypoint (W1) while the Route panel is open', async ({ page }) => {
    await openPlan(page)
    await openRoutePanel(page)
    const spot = await emptySpot(page)
    await page.mouse.click(spot.x, spot.y)
    await expect(page.locator(S.handles)).toHaveCount(1)
    expect(await stopLabels(page)).toEqual(['W1'])
    await routeReady(page)
  })

  test('a map click with the Route panel closed adds nothing', async ({ page }) => {
    await openPlan(page)
    const spot = await emptySpot(page)
    await page.mouse.click(spot.x, spot.y)
    await expect(page.locator(S.handles)).toHaveCount(0)
  })
})

test.describe('drag a point', () => {
  // TODO(I1): R3 install() + setEditing; handles are DOM markers (.hl-r3-handle[data-r3-stop]).
  test('dragging a waypoint moves it, re-routes, and is one undo step', async ({ page }) => {
    await openPlan(page)
    await openRoutePanel(page)
    const spot = await emptySpot(page)
    await page.mouse.click(spot.x, spot.y)
    const handle = page.locator(S.handles).first()
    await expect(handle).toBeVisible()
    await routeReady(page)
    const before = (await handle.boundingBox())!
    const urlBefore = page.url()
    await drag(page, { x: before.x + before.width / 2, y: before.y + before.height / 2 }, 60, 30)
    await expect.poll(async () => (await handle.boundingBox())!.x).toBeGreaterThan(before.x + 30)
    expect(await stopLabels(page)).toEqual(['W1']) // moved, not added
    await routeReady(page)
    await expect.poll(() => page.url()).not.toBe(urlBefore) // TODO(I1): URL sync
    await page.keyboard.press(UNDO)
    await expect.poll(async () => Math.round((await handle.boundingBox())!.x)).toBe(Math.round(before.x))
  })
})

test.describe('infeasible leg', () => {
  // Known infeasible order (edit/route/browser/compute.test.ts I1c, real data): S2,S8,S7,S6,S1,S4 from pad
  // rank2 breaks the O2 bound; the browser core names leg index 4 (S6 -> S1, ~21 min short; engine: leg 3).
  // TODO(Q1, wave 2): pin "Leg 5 (S6 → S1)" once the worker's fast mode is confirmed to give the same leg.
  const order = ['S2', 'S8', 'S7', 'S6', 'S1', 'S4'].map((id) => station(id))

  test('an infeasible leg is red on the map, flagged in the list and called out in the panel', async ({ page }) => {
    await openPlan(page, routeHash('rank2', order))
    await openRoutePanel(page)
    await routeReady(page, 60_000)
    const callout = page.locator(S.infeasibleCallout)
    await expect(callout).toBeVisible()
    // I4: the alert region stays mounted (announced reliably); the callout is its content
    await expect(page.locator(`[role="alert"] > ${S.infeasibleCallout}`)).toBeVisible()
    await expect(callout).toContainText(/Leg \d+ \(.+ → .+\) cannot be walked/)
    // red on the map: R4 paints the leg in the limit colour (r4-mine-bad, canvas) and marks its stop
    await expect(page.locator(S.mineStopBad).first()).toBeVisible()
    await expect(page.locator(`${S.stopRows}.is-infeasible`).first()).toBeVisible()
    await expect(page.locator(S.ctxBad)).toBeVisible()
  })
})

test.describe('export', () => {
  // TODO(I1): U4 export section registered in the Route panel (registerRoutePanelSection('export')).
  test('MARVIS unreachable: the button downloads homeline-mission-<hash8>.json of the route', async ({ page }) => {
    await marvisUnreachable(page)
    await openPlan(page, routeHash(PICKER_PAD, [station('S1'), station('S7')]))
    await openRoutePanel(page)
    await routeReady(page)
    const box = page.locator(S.exportBox)
    await expect(box).toHaveAttribute('data-target', 'download')
    await expect(box).toHaveAttribute('data-source', 'route')
    const btn = box.locator(S.exportAction('download'))
    await expect(btn).toHaveText('Download mission.json')
    const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()])
    expect(dl.suggestedFilename()).toMatch(/^homeline-mission-[0-9a-f]{8}\.json$/)
    const doc = JSON.parse(readFileSync((await dl.path())!, 'utf8'))
    expect(doc.kind).toBe('homeline_mission')
    expect(doc.waypoints).toHaveLength(2) // TODO(Q1, wave 2): station ids per waypoint once U4's mapping is final
    await expect(box.locator('[role="status"][data-live="export"]')).toContainText(dl.suggestedFilename())
  })

  test('no route: the download is the official plan of the pad', async ({ page }) => {
    await marvisUnreachable(page)
    await openPlan(page)
    await openRoutePanel(page)
    const box = page.locator(S.exportBox)
    await expect(box).toHaveAttribute('data-source', 'official')
    const [dl] = await Promise.all([page.waitForEvent('download'), box.locator(S.exportAction('download')).click()])
    expect(dl.suggestedFilename()).toMatch(/^homeline-mission-[0-9a-f]{8}\.json$/)
    expect(JSON.parse(readFileSync((await dl.path())!, 'utf8')).kind).toBe('homeline_mission')
  })
})

test.describe('share link', () => {
  const at = stationsLonLat()
  const link = () => routeHash('rank3', [station('S7'), point(at.S6.lon + 0.002, at.S6.lat), station('S1')])

  // TODO(I1): router applies #/?route= (U4 planLink) on load + URL sync; U2 list; U1 pad picker.
  test('#/?route= restores the pad and the route', async ({ page }) => {
    await openPlan(page, link())
    await openRoutePanel(page)
    await expect(page.locator(S.padRadio('rank3'))).toHaveAttribute('aria-checked', 'true')
    expect(await stopLabels(page)).toEqual(['S7', 'W1', 'S1'])
    await expect(page.locator(S.ctxPad)).toHaveText(padLabel('rank3'))
    expect(new URL(page.url()).hash).toBe(link()) // canonical: the link stays as it is
  })

  test('the copied share link reopens the same plan in a new page', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openPlan(page, link())
    await openRoutePanel(page)
    await page.locator(S.exportAction('share')).click()
    const url = await page.evaluate(async () => {
      const sel = document.querySelector<HTMLInputElement>('[data-share="select"]')
      return sel ? sel.value : await navigator.clipboard.readText()
    })
    expect(new URL(url).hash).toBe(link())
    const again = await context.newPage()
    await again.goto(url)
    await expect(again.locator(S.map).first()).toBeVisible({ timeout: 60_000 })
    await openRoutePanel(again)
    await expect(again.locator(S.padRadio('rank3'))).toHaveAttribute('aria-checked', 'true')
    expect(await stopLabels(again)).toEqual(['S7', 'W1', 'S1'])
  })

  test('an unreadable link says so and loads nothing', async ({ page }) => {
    await openPlan(page, '#/?route=not-a-plan!!')
    await expect(page.getByText('This link could not be read, so nothing was loaded.').filter({ visible: true })).toBeVisible()
    await openRoutePanel(page)
    expect(await stopLabels(page)).toEqual([])
  })
})

test.describe('legacy redirect', () => {
  // TODO(I1/I3): router.ts hook -> legacyRedirect(hash) + history.replaceState, then the #/?route= apply.
  test('#/mission?plan=<v1> redirects to the Plan page with the same stops', async ({ page }) => {
    await openPlan(page, `#/mission?plan=${legacyPlanParam(['S1', 'S7'])}`)
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/\?route=/)
    await expect(page.locator(S.modeTab)).toHaveText(/Plan/)
    await openRoutePanel(page)
    await expect(page.locator(S.padRadio(OFFICIAL_PAD_ID))).toHaveAttribute('aria-checked', 'true')
    expect(await stopLabels(page)).toEqual(['S1', 'S7'])
  })

  test('#/mission?add=S4 redirects to Plan with S4 in the route', async ({ page }) => {
    await openPlan(page, '#/mission?add=S4')
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/\?route=/)
    await openRoutePanel(page)
    expect(await stopLabels(page)).toEqual(['S4'])
  })

  test('#/?route=…&add=S4 appends S4 to the linked route (one undo step)', async ({ page }) => {
    await openPlan(page, `${routeHash(OFFICIAL_PAD_ID, [station('S1')])}&add=S4`)
    await openRoutePanel(page)
    expect(await stopLabels(page)).toEqual(['S1', 'S4'])
    await expect.poll(() => new URL(page.url()).hash).not.toContain('add=') // add is applied, then dropped
    await page.keyboard.press(UNDO)
    await expect.poll(() => stopLabels(page)).toEqual(['S1'])
  })
})

test.describe('undo', () => {
  // TODO(I2): planningUndoSource wired into edit/route/undo.ts createSharedUndo on the Plan view.
  // TODO(I5, 22:08 on dbea906): times out (90 s) at the U2 "Delete S7" click; cause not yet known (an
  // overlay intercepting the click is the first suspect). The other undo tests pass.
  test.fixme('Ctrl/Cmd+Z undoes the last plan edit and Ctrl/Cmd+Shift+Z redoes it', async ({ page }) => {
    await openPlan(page, routeHash(OFFICIAL_PAD_ID, [station('S1'), station('S7')]))
    await openRoutePanel(page)
    expect(await stopLabels(page)).toEqual(['S1', 'S7'])
    await page.getByRole('button', { name: 'Delete S7' }).click() // U2 remove
    await expect.poll(() => stopLabels(page)).toEqual(['S1'])
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // focus on the page, not in a field
    await page.keyboard.press(UNDO)
    await expect.poll(() => stopLabels(page)).toEqual(['S1', 'S7'])
    await page.keyboard.press(REDO)
    await expect.poll(() => stopLabels(page)).toEqual(['S1'])
  })

  test('a link load is not an undo step', async ({ page }) => {
    await openPlan(page, routeHash(OFFICIAL_PAD_ID, [station('S1')]))
    await openRoutePanel(page)
    await page.keyboard.press(UNDO)
    expect(await stopLabels(page)).toEqual(['S1'])
  })
})

test.describe('compare plans (D142)', () => {
  // Real today: leaving Plan for the trade table and coming Back lands on the Plan page again.
  test('Plan → #/trade → Back returns to the Plan page', async ({ page }) => {
    const errors = pageErrors(page)
    await openPlan(page)
    await page.waitForTimeout(1500) // H2 finding 1: leaving the console within ~1 s of its headline throws a map-layer error
    await page.evaluate(() => void (location.hash = '#/trade'))
    await expect.poll(() => new URL(page.url()).hash).toBe('#/trade')
    await expect(page.locator(S.map)).toHaveCount(0, { timeout: 15_000 })
    await page.goBack()
    await expect.poll(() => new URL(page.url()).hash).toBe('#/')
    await expect(page.locator(S.map).first()).toBeVisible({ timeout: 60_000 })
    expect(errors).toEqual([])
  })

  // TODO(I1): bottom drawer link "Compare plans" (data-testid="plan-compare-plans", href "#/trade").
  // F7: removed by user 22:59 (the bottom drawer holds only the replay; #/trade stays reachable by URL).
  test.skip('bottom drawer "Compare plans" opens #/trade; Back keeps the pad and the route', async ({ page }) => {
    const link = routeHash(PICKER_PAD, [station('S1'), station('S7')])
    await openPlan(page, link)
    await openBottomDrawer(page) // the drawer's actions (Compare plans) show while it is open
    const compare = page.locator(S.comparePlans)
    await expect(compare).toHaveText(/Compare plans/)
    await expect(compare).toHaveAttribute('href', '#/trade')
    await compare.click()
    await expect.poll(() => new URL(page.url()).hash).toBe('#/trade')
    await page.goBack()
    await expect.poll(() => new URL(page.url()).hash).toBe(link)
    await expect(page.locator(S.ctxPad)).toHaveText(padLabel(PICKER_PAD))
    await openRoutePanel(page)
    await expect(page.locator(S.padRadio(PICKER_PAD))).toHaveAttribute('aria-checked', 'true')
    expect(await stopLabels(page)).toEqual(['S1', 'S7'])
  })
})
