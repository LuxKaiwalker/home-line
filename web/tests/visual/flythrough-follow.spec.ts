/**
 * L10 (D111, team lead test 12:39): the flythrough camera chases the crew instead of being the crew.
 * During the flythrough the route legs, the stations and the crew marker are drawn, and the crew is in
 * the frame. Not a screenshot test (map canvases are software-rendered here); it lives with the visual
 * specs so their config runs it against the built app.
 * Run: cd web && npm run build && npx playwright test tests/visual/flythrough-follow.spec.ts
 */
import { expect, test, type Page } from 'playwright/test'

interface Probe {
  layers: Record<string, string | null>
  crewPx: [number, number] | null
  size: [number, number]
}

/** Mean grey and the share of near-black pixels of a PNG screenshot (decoded in the page, no deps). */
async function frameStats(page: Page, png: Buffer): Promise<{ mean: number; blackFrac: number }> {
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let sum = 0
    let black = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3
      sum += v
      if (v < 12) black++
    }
    return { mean: sum / n, blackFrac: black / n }
  }, png.toString('base64'))
}

test.describe('L10 flythrough chase camera', () => {
  test('capture: route legs and the crew marker are drawn, the crew is in frame, the frame is not black', async ({ page }, info) => {
    // a capture frame waits for every tile: in CI's software GL frame 0 alone outlasts 4 min, so this one
    // runs on request (HL_CAPTURE_SPEC=1, the L10 / Kcap dry runs); the live test below runs everywhere
    test.skip(!process.env.HL_CAPTURE_SPEC, 'capture steps are too slow for CI software GL (set HL_CAPTURE_SPEC=1)')
    test.skip(info.project.name !== '1024x768', 'one size is enough')
    test.setTimeout(240_000)
    await page.goto('/?capture=flythrough#/')
    await page.waitForFunction(() => !!(window as unknown as { __capture?: unknown }).__capture, undefined, { timeout: 60_000 })
    await page.evaluate(() => (window as unknown as { __capture: { ready: Promise<void> } }).__capture.ready)
    // t = 10 s of the storyboard: the crew walks out (EVA min 40). One frame: a capture step waits for
    // every tile in software GL (tens of seconds); the dry run (notes/L10.md) samples the whole flight.
    for (const frame of [600]) {
      await page.evaluate((n) => (window as unknown as { __capture: { seek(n: number): Promise<unknown> } }).__capture.seek(n), frame)
      const p = (await page.evaluate(() => (window as unknown as { __capture: { probe(): unknown } }).__capture.probe())) as Probe
      expect(p.layers['route-done']).toBe('visible')
      expect(p.layers['route-coming']).toBe('visible')
      expect(p.layers['station-rings']).toBe('visible')
      expect(p.layers['crew-dot']).toBe('visible')
      await expect(page.locator('.maplibregl-map')).toHaveAttribute('data-crew', 'shown')
      // the crew marker is drawn, inside the frame, near the middle (a chase camera looks at the crew)
      expect(p.crewPx).not.toBeNull()
      const [x, y] = p.crewPx!
      const [w, h] = p.size
      expect(x).toBeGreaterThan(w * 0.2)
      expect(x).toBeLessThan(w * 0.8)
      expect(y).toBeGreaterThan(h * 0.2)
      expect(y).toBeLessThan(h * 0.85)
      const shot = await page.locator('.maplibregl-canvas').screenshot()
      await info.attach(`flythrough-f${frame}.png`, { body: shot, contentType: 'image/png' })
      const s = await frameStats(page, shot)
      expect(s.blackFrac).toBeLessThan(0.05)
      expect(s.mean).toBeGreaterThan(30)
    }
  })

  test('live: the Flythrough button draws the route and the crew marker; hover does not stop it', async ({ page }, info) => {
    test.skip(info.project.name !== '1024x768', 'one size is enough')
    test.setTimeout(180_000)
    await page.goto('/?intro=0&view=2d#/') // L13: the start this test was written for (3D is now the Plan default)
    const btn = page.locator('.hl-fly-btn:not(.hl-fly-speed)').first()
    await btn.waitFor({ state: 'visible', timeout: 60_000 })
    await btn.click()
    const map = page.locator('.maplibregl-map').first()
    await expect(map).toHaveAttribute('data-flythrough', 'on', { timeout: 60_000 })
    await expect(map).toHaveAttribute('data-crew', 'shown', { timeout: 30_000 })
    // hover over the map (synthetic moves: in software GL every real mouse event waits for a frame, #131)
    await page.evaluate(() => {
      const c = document.querySelector('.maplibregl-canvas')!
      const r = c.getBoundingClientRect()
      for (let i = 0; i < 10; i++) {
        const o = { bubbles: true, clientX: r.left + (r.width * (i + 2)) / 14, clientY: r.top + (r.height * (i + 2)) / 14 }
        c.dispatchEvent(new PointerEvent('pointermove', o))
        c.dispatchEvent(new MouseEvent('mousemove', o))
      }
    })
    await expect(map).toHaveAttribute('data-flythrough', 'on')
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
  })
})
