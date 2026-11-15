/**
 * L7c (D111): one player at a time, through the activity store (web/src/state/activity.ts).
 * Players: the intro, the replay (timeline Play), the flythrough. The storm is a setting the replay
 * honours: "storm replay" = the storm switch on + Play.
 *   - pairs matrix: for every ordered pair (A, B) of players, start A, then B: A stopped cleanly (its
 *     control released, its chrome / camera back) and B runs (html[data-activity] = B, its control
 *     pressed, the clock advancing). The intro only plays on its own at load, so it is an A, never a B.
 *     Replay <-> storm replay is the same player with the setting changed: it keeps running.
 *   - editing (a rover drag) stops the running player; a mode switch stops the running player.
 * L2b: the timeline lives in the Plan bottom drawer (views/planBottom.tsx). Collapsed (the default) it
 * is one line with the slim scrubber (Play, scrub, EVA time; no .hl-tl chart); the full timeline is the
 * drawer's Timeline tab. The viewer reaches either, so every rule runs in both: 'timeline' opens the
 * drawer and picks the Timeline tab (as a viewer does), 'collapsed' presses the slim scrubber's Play.
 * The intro plays at load with the drawer collapsed, so the intro pairs press the slim Play.
 * Not a screenshot test: the visual config runs it in the serial click project (CLICK_SPECS), 1440x900
 * only (the 3D flythrough in software GL is slow; the rules do not depend on the viewport).
 * Run: cd web && npm run build && npx playwright test tests/visual/activity-players.spec.ts
 */
import { expect, test, type Locator, type Page } from 'playwright/test'

type P = 'replay' | 'flythrough' | 'storm'
/** How the viewer reaches the replay control: the drawer's Timeline tab, or the collapsed slim scrubber. */
type Drawer = 'timeline' | 'collapsed'
const DRAWERS: Drawer[] = ['timeline', 'collapsed']

test.skip(({ viewport }) => (viewport?.width ?? 0) !== 1440, 'rules are viewport-independent: one click project')
test.setTimeout(180_000)

const html = (page: Page) => page.locator('html')
const play = (page: Page) => page.locator('.hl-tl__play')
const fly = (page: Page) => page.locator('.hl-fly-btn:not(.hl-fly-speed)')
const storm = (page: Page) => page.locator('.hl-storm-btn')
const clock = (page: Page) => page.locator('.hl-tl__clockvalue').first()
/** The clock's playing state: the full timeline, or the slim scrubber (one of them is mounted). */
const clockState = (page: Page) => page.locator('.hl-tl, .plan-scrub')
const GRIP = '[aria-controls="hl-lay-plan-bottom"]'
const CLICK = { timeout: 30_000 }

/** Pages whose map has flown (it stays in 3D afterwards). */
const flown = new WeakSet<Page>()
/**
 * Click `loc`. Once the flythrough has flown, the map is in 3D and software GL starves the page's main
 * thread: a real click's after-action wait outlasts its timeout (#131, notes/L7a.md), in CI even after
 * the flight. Then the button gets a DOM click (the same handler; what is under test is the store, not
 * the pointer path, which shell-layout / story-intro / hover-replay cover).
 */
async function press(page: Page, loc: Locator): Promise<void> {
  if ((await html(page).getAttribute('data-activity')) === 'flythrough') flown.add(page)
  if (flown.has(page)) await loc.evaluate((b: HTMLElement) => b.click())
  else await loc.click(CLICK)
}

const clockValue = (s: string): number => s.split(/[^0-9]+/).filter(Boolean).reduce((a, p) => a * 60 + Number(p), 0)

async function advancing(page: Page): Promise<void> {
  const from = clockValue(await clock(page).innerText())
  await expect.poll(async () => clockValue(await clock(page).innerText()), { timeout: 20_000 }).not.toBe(from)
}

async function openPlan(page: Page, drawer: Drawer): Promise<void> {
  await page.goto('/?intro=0#/')
  await play(page).waitFor({ timeout: 60_000 })
  await storm(page).waitFor({ timeout: 60_000 })
  await expect(page.locator(GRIP)).toHaveAttribute('aria-expanded', 'false') // collapsed by default
  if (drawer === 'collapsed') {
    await expect(page.locator('.plan-bottom .plan-scrub .hl-tl__play')).toBeVisible()
    return
  }
  // open the drawer and pick its Timeline tab, as a viewer does
  await page.locator(GRIP).click(CLICK)
  await expect(page.locator(GRIP)).toHaveAttribute('aria-expanded', 'true')
  await page.locator('#hl-lay-plan-bottom-tab-timeline').click(CLICK)
  await expect(page.locator('#hl-lay-plan-bottom-tab-timeline')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#hl-lay-plan-bottom .hl-tl .hl-tl__play')).toBeVisible({ timeout: 30_000 })
}

async function setStorm(page: Page, on: boolean): Promise<void> {
  if ((await storm(page).getAttribute('aria-pressed')) !== String(on)) await press(page, storm(page))
  await expect(storm(page)).toHaveAttribute('aria-pressed', String(on))
}

/** Start player `p` from its control. */
async function startPlayer(page: Page, p: P): Promise<void> {
  if (p === 'flythrough') {
    await press(page, fly(page))
    flown.add(page)
    return
  }
  await setStorm(page, p === 'storm')
  if ((await play(page).getAttribute('aria-pressed')) !== 'true') await press(page, play(page))
}

/**
 * `p` runs: the store says so, its control is pressed, the mission clock plays (and moves, `moving`).
 * After a flythrough the map stays in 3D; in software GL under load a frame can then take over 1 s and
 * the dock ticker drops such steps as stalls (ticker.ts MAX_STEP_MS), so there the clock's playing
 * state (.hl-tl[data-state], or the slim scrubber's .plan-scrub[data-state]) is the check, not its
 * movement.
 */
async function expectRunning(page: Page, p: P, moving = true): Promise<void> {
  await expect(clockState(page)).toHaveAttribute('data-state', 'playing', { timeout: 30_000 })
  await expect(html(page)).toHaveAttribute('data-activity', p === 'flythrough' ? 'flythrough' : 'replay', { timeout: 30_000 })
  if (p === 'flythrough') {
    await expect(fly(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(play(page)).toHaveAttribute('aria-pressed', 'false')
  } else {
    await expect(play(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(fly(page)).toHaveCount(0) // D145: no Flythrough button while FLY is hidden
    await expect(storm(page)).toHaveAttribute('aria-pressed', String(p === 'storm'))
  }
  if (moving) await advancing(page)
}

/** `p` stopped cleanly (its own control released). */
async function expectStopped(page: Page, p: P | 'intro'): Promise<void> {
  if (p === 'flythrough') {
    await expect(fly(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.hl-fly-speed')).toBeHidden()
  } else if (p === 'intro') {
    await expect(html(page)).not.toHaveAttribute('data-story', 'on')
    await expect(html(page)).not.toHaveAttribute('data-story-chrome', 'hide')
  } else await expect(play(page)).toHaveAttribute('aria-pressed', 'false')
}

test.describe('pairs: start A, then B', () => {
  // every ordered pair of the three viewer-started players, each on a fresh page (a 3D flight in
  // software GL is too slow to chain them in one test)
  const players: P[] = ['replay', 'flythrough', 'storm']
  for (const drawer of DRAWERS)
    for (const a of players)
      for (const b of players) {
        if (a === b) continue
        // hidden, D145: the Flythrough button is hidden with FLY
        const flies = a === 'flythrough' || b === 'flythrough'
        ;(flies ? test.skip : test)(`${a} -> ${b} (${drawer})${flies ? ' (hidden, D145)' : ''}`, async ({ page }) => {
          await openPlan(page, drawer)
          await startPlayer(page, a)
          await expectRunning(page, a)
          await startPlayer(page, b)
          await expectRunning(page, b, a !== 'flythrough' || b === 'flythrough')
          // replay <-> storm replay: one player, the setting changed (it keeps running)
          if (a === 'flythrough' || b === 'flythrough') await expectStopped(page, a)
          // its own control stops B
          await press(page, b === 'flythrough' ? fly(page) : play(page))
          await expect(html(page)).toHaveAttribute('data-activity', 'none', { timeout: 30_000 })
        })
      }

  test.describe('the intro, then B', () => {
    test.use({ reducedMotion: 'no-preference' }) // the intro never plays under reduced motion
    for (const b of ['replay', 'flythrough', 'storm'] as const)
      (b === 'flythrough' ? test.skip : test)(`intro -> ${b}${b === 'flythrough' ? ' (hidden, D145)' : ''}`, async ({ page }) => {
        await page.goto('/#/')
        await page.locator('html[data-story-chrome="hide"]').waitFor({ state: 'attached', timeout: 60_000 })
        await expect(html(page)).toHaveAttribute('data-activity', 'intro')
        // collapsed at load: the viewer presses the slim scrubber's Play
        await expect(page.locator(GRIP)).toHaveAttribute('aria-expanded', 'false')
        await startPlayer(page, b)
        await expectStopped(page, 'intro')
        await expectRunning(page, b)
      })
  })
})

for (const drawer of DRAWERS)
  test(`editing stops the replay (rover drag, ${drawer})`, async ({ page }) => {
    await openPlan(page, drawer)
    const rover = page.locator('.hl-edit-rover')
    await rover.waitFor({ timeout: 60_000 })
    await startPlayer(page, 'storm')
    await expectRunning(page, 'storm')
    if (drawer === 'timeline') {
      // started from the Timeline tab; the expanded drawer refits the map above it, which puts the rover
      // pad under the storm card at 1440x900, so the viewer collapses the drawer (that is no edit and
      // stops nothing) to reach the rover
      await press(page, page.locator(GRIP))
      await expect(page.locator(GRIP)).toHaveAttribute('aria-expanded', 'false')
      await expectRunning(page, 'storm')
      await expect(rover).toBeVisible()
    }
    // nothing covers the rover: the press lands on it
    const onTop = () =>
      rover.evaluate((r) => {
        const c = r.getBoundingClientRect()
        return r.contains(document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2))
      })
    await expect.poll(onTop, { timeout: 10_000 }).toBe(true)
    const b = (await rover.boundingBox())!
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x - 60, at.y + 10, { steps: 12 })
    await expect(html(page)).toHaveAttribute('data-activity', 'none')
    await page.mouse.up()
    await expectStopped(page, 'replay')
    // the storm stays on: a setting, not a player
    await expect(storm(page)).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
  })

for (const drawer of DRAWERS)
  for (const p of ['replay', 'flythrough'] as const)
    // hidden, D145: the flythrough variant needs the Flythrough button
    ;(p === 'flythrough' ? test.skip : test)(`a mode switch stops the ${p} (${drawer})${p === 'flythrough' ? ' (hidden, D145)' : ''}`, async ({ page }) => {
      await openPlan(page, drawer)
      await startPlayer(page, p)
      await expectRunning(page, p)
      // REPORT is hidden (no tab): Science is the other shown mode
      await press(page, page.locator('.hl-modes__tab', { hasText: 'Science' }).first())
      await expect(page).toHaveURL(/#\/stations/)
      await expect(html(page)).toHaveAttribute('data-activity', 'none')
      // back in Plan: nothing plays, the clock stands still
      await press(page, page.locator('.hl-modes__tab', { hasText: 'Plan' }).first())
      await play(page).waitFor({ timeout: 60_000 })
      await expect(play(page)).toHaveAttribute('aria-pressed', 'false')
      const t0 = await clock(page).innerText()
      await page.waitForTimeout(800)
      expect(await clock(page).innerText()).toBe(t0)
    })
