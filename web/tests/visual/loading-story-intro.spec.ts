/**
 * L12 (D111): the intro loading screen and the full-screen intro.
 *   - the loading screen (inline in index.html) is on screen before any JS runs;
 *   - the intro covers the whole viewport (100dvw x 100dvh) with the chrome hidden, at both projects;
 *   - 'Skip intro' works from the loading screen and from the playing intro;
 *   - 'Full screen' and F use the Fullscreen API and never skip the intro (nor reach focus mode);
 *   - no intro (reduced motion, ?intro=0, capture) = no loading screen; the capture storyboard still runs.
 * Not a screenshot test: real clicks while the map animates, so the file name puts it in the serial
 * click projects of ../../playwright.config.ts (CLICK_SPECS, issue #131).
 * Run: cd web && npm run build && npx playwright test tests/visual/loading-story-intro.spec.ts
 */
import { expect, test, type Page } from 'playwright/test'

const LOADING = '#hl-loading'

async function introPlaying(page: Page): Promise<void> {
  await page.goto('/?view=2d#/')
  await page.locator('html[data-story-chrome="hide"]').waitFor({ state: 'attached', timeout: 60_000 })
}

test.describe('intro loading screen (L12)', () => {
  test.use({ reducedMotion: 'no-preference' }) // the intro never plays under reduced motion

  test('the loading screen is visible before any JS runs', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'no-preference', baseURL: test.info().project.use.baseURL })
    const page = await ctx.newPage()
    await page.goto('/?view=2d#/')
    const el = page.locator(LOADING)
    await expect(el).toBeVisible()
    await expect(el.locator('.hl-loading__mark')).toHaveText('HOMELINE')
    await expect(el.getByRole('progressbar')).toBeVisible()
    await expect(el.getByRole('link', { name: 'Skip intro' })).toBeVisible()
    // it covers the viewport on the first paint (render-blocking stylesheet, no script)
    const vp = page.viewportSize()!
    const b = (await el.boundingBox())!
    expect([b.x, b.y, Math.round(b.width), Math.round(b.height)]).toEqual([0, 0, vp.width, vp.height])
    await ctx.close()
  })

  test('the loading screen is on the first painted frame', async ({ page }) => {
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById('hl-loading')
        ;(window as unknown as { __firstFrame: boolean }).__firstFrame = !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).position === 'fixed'
      })
    })
    await page.goto('/?view=2d#/')
    await page.waitForFunction(() => (window as unknown as { __firstFrame?: boolean }).__firstFrame !== undefined)
    expect(await page.evaluate(() => (window as unknown as { __firstFrame: boolean }).__firstFrame)).toBe(true)
  })

  test('the intro covers the full viewport with the chrome hidden', async ({ page }) => {
    await introPlaying(page)
    // one snapshot of the page at t = 0 (the intro moves on while a test round-trips, SW GL is slow)
    const r = await page.evaluate(() => {
      const box = (s: string) => {
        const e = document.querySelector(s)
        if (!e) return null
        const b = e.getBoundingClientRect()
        return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
      }
      const op = (s: string) => (document.querySelector(s) ? Number(getComputedStyle(document.querySelector(s)!).opacity) : null)
      const loading = document.getElementById('hl-loading')
      const skip = loading?.querySelector('[data-hl-act=skip]')
      const head = document.querySelector('.collapse-headline')
      return {
        vp: [innerWidth, innerHeight],
        map: box('.console-map'),
        canvas: box('.console-map canvas.maplibregl-canvas'),
        opacity: ['.hl-topbar', '.hl-rail', '.hl-dock', '.maplibregl-control-container'].map(op),
        headlineShown: !!head && !(head as HTMLElement).hidden && getComputedStyle(head).visibility !== 'hidden',
        phase: document.documentElement.dataset.hlIntro,
        loadingPointer: loading ? getComputedStyle(loading).pointerEvents : null,
        skipShown: !!skip && getComputedStyle(skip).display !== 'none' && skip.getBoundingClientRect().width > 0,
      }
    })
    const [w, h] = r.vp
    expect(r.map).toEqual([0, 0, w, h])
    expect(r.canvas?.slice(2)).toEqual([w, h])
    expect(r.opacity).toEqual([0, 0, 0, 0])
    expect(r.headlineShown).toBe(false)
    // the loading screen has faded into the intro: it no longer takes the pointer, its buttons stay
    expect(r.phase).toBe('playing')
    expect(r.loadingPointer).toBe('none')
    expect(r.skipShown).toBe(true)
  })

  test('Skip intro on the loading screen: no intro plays', async ({ page }) => {
    await page.goto('/?view=2d#/')
    await page.locator('html[data-hl-intro="loading"]').waitFor({ state: 'attached', timeout: 30_000 })
    await page.locator(`${LOADING} [data-hl-act=skip]`).click({ timeout: 5_000 })
    await expect(page.locator(LOADING)).toHaveCount(0)
    await expect(page).not.toHaveURL(/intro=0/) // handled in the page, no reload
    await page.locator('.hl-tl__play').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(3_000)
    await expect(page.locator('html')).not.toHaveAttribute('data-story', 'on')
    await expect(page.locator('html')).not.toHaveAttribute('data-story-full', 'on')
    const vp = page.viewportSize()!
    const map = (await page.locator('.console-map').boundingBox())!
    expect(map.width).toBeLessThan(vp.width) // the map is in its shell slot
  })

  test('Skip intro during the intro ends it', async ({ page }) => {
    await introPlaying(page)
    await page.locator(`${LOADING} [data-hl-act=skip]`).click({ timeout: 5_000 })
    await expect(page.locator('html')).not.toHaveAttribute('data-story', 'on')
    await expect(page.locator('html')).not.toHaveAttribute('data-story-full', 'on')
    await expect(page.locator(LOADING)).toHaveCount(0)
    await expect(page).not.toHaveURL(/intro=0/)
  })

  test('Esc skips the playing intro (RR1)', async ({ page }) => {
    await introPlaying(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).not.toHaveAttribute('data-story', 'on')
    await expect(page.locator(LOADING)).toHaveCount(0)
  })

  test('F and the Full screen button never skip the intro', async ({ page }) => {
    await introPlaying(page)
    await page.keyboard.press('f')
    await page.waitForTimeout(300)
    await expect(page.locator('html')).toHaveAttribute('data-story', 'on')
    await expect(page.locator('.hl-shell')).not.toHaveAttribute('data-focus', 'on') // not the focus-mode shortcut
    // the Full screen button: its pointer input never reaches the intro's skip listeners (an event, not a
    // real click: entering full screen resizes the headless window, which is slow in software GL)
    await page.locator(`${LOADING} [data-hl-act=fullscreen]`).dispatchEvent('pointerdown')
    await page.waitForTimeout(300)
    await expect(page.locator('html')).toHaveAttribute('data-story', 'on')
    // any other input still skips at once (M10, D9)
    await page.keyboard.press('x')
    await expect(page.locator('html')).not.toHaveAttribute('data-story', 'on')
  })
})

test.describe('no intro, no loading screen (L12)', () => {
  test('reduced motion: removed at boot', async ({ page }) => {
    await page.goto('/?view=2d#/')
    await page.locator('.hl-tl__play').waitFor({ timeout: 30_000 })
    await expect(page.locator(LOADING)).toHaveCount(0)
  })

  test('?intro=0: removed at boot', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/?intro=0&view=2d#/')
    await page.locator('.hl-tl__play').waitFor({ timeout: 30_000 })
    await expect(page.locator(LOADING)).toHaveCount(0)
  })

  test('capture: no loading screen and the intro storyboard still runs', async ({ page }) => {
    test.setTimeout(240_000)
    await page.goto('/?capture=intro#/')
    await expect(page.locator(LOADING)).toHaveCount(0)
    await page.waitForFunction(() => !!(window as unknown as { __capture?: unknown }).__capture, null, { timeout: 60_000 })
    const r = await page.evaluate(async () => {
      const c = (window as unknown as { __capture: { id: string; frames: number; ready: Promise<void>; seek(n: number): Promise<{ frame: number }> } }).__capture
      await c.ready
      const s = await c.seek(120)
      return { id: c.id, frames: c.frames, frame: s.frame }
    })
    expect(r).toEqual({ id: 'intro', frames: expect.any(Number), frame: 120 })
    expect(r.frames).toBeGreaterThan(120)
    await expect(page.locator('html')).toHaveAttribute('data-story-frame', '120')
  })
})
