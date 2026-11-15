// L10 (D111, Notion §10.2 last bullet, §10.3 L10): the flythrough chase camera.
// - reduced motion: the follow camera cuts every camera.flythrough.reduced_cut_s instead of gliding
//   (story director and the live flythrough's gate);
// - the storyboards that use the follow camera (flythrough, kiosk) show the route, the stations and the
//   crew marker (the crew layers ride in the route group);
// - the live flythrough switches the route and the stations on and puts them back.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CREW_LAYERS, ROUTE_LAYERS } from '../map/furniture/index'
import { cutGate, FLY_GROUPS } from '../map/flythrough/fly'
import { CHASE } from './config'
import { Director } from './director'
import { FOLLOW_TARGET, parseStoryboard } from './storyboard'

const STORY = new URL('../../public/story/', import.meta.url)
const readStory = (f: string): unknown => JSON.parse(readFileSync(new URL(f, STORY), 'utf8'))

/** A follow storyboard on a stub chase pose: the target's lon is the EVA minute. */
function followDirector(reduced: boolean): Director {
  const sb = parseStoryboard({
    id: 'l10',
    version: '1',
    title: 'l10',
    size: [1920, 1080],
    fps: 60,
    steps: [
      { t: 0, clock: { t_min: 0, playing: true, speed: 4 }, camera: { target: FOLLOW_TARGET } },
      { t: 30 },
    ],
  })
  return new Director(sb, { targets: () => null, tMax: 360, reduced, cutS: CHASE.reducedCutS, follow: (t) => ({ target: [t, 0], altM: 175, bearing: 0, pitch: 55 }) })
}

describe('L10 reduced motion: stepped cuts', () => {
  it('without reduced motion the chase camera moves on every frame', () => {
    const d = followDirector(false)
    const seen = new Set<number>()
    for (let n = 0; n < 240; n++) seen.add(d.stateAtFrame(n).camera!.target[0])
    expect(seen.size).toBe(240)
  })
  it('with reduced motion it holds, then cuts every reduced_cut_s (2 s) to the crew at that time', () => {
    expect(CHASE.reducedCutS).toBe(2)
    const d = followDirector(true)
    const xs: number[] = []
    for (let n = 0; n <= 60 * 10; n++) xs.push(d.stateAtFrame(n).camera!.target[0])
    const distinct = [...new Set(xs)]
    expect(distinct).toEqual([0, 8, 16, 24, 32, 40]) // 4 EVA min/s × 2 s per cut, 10 s
    // each cut lands exactly at the cut time's clock
    expect(d.stateAt(4.0).camera!.target[0]).toBe(16)
    expect(d.stateAt(5.99).camera!.target[0]).toBe(16)
    expect(d.stateAt(6.0).camera!.target[0]).toBe(24)
  })
  it('the live flythrough gate lets one cut through per interval while playing, every scrub while paused', () => {
    const g = cutGate(2000)
    expect(g(0, true)).toBe(true)
    expect(g(500, true)).toBe(false)
    expect(g(1999, true)).toBe(false)
    expect(g(2000, true)).toBe(true)
    expect(g(2100, false)).toBe(true) // a scrub moves at once
    expect(g(2200, true)).toBe(false)
  })
})

describe('L10: what the flythrough draws', () => {
  it('the crew marker layers ride in the route group (drawn whenever the route is)', () => {
    for (const id of CREW_LAYERS) expect(ROUTE_LAYERS).toContain(id)
  })
  it('the live flythrough switches the route and the stations on', () => {
    expect([...FLY_GROUPS].sort()).toEqual(['route', 'stations'])
  })
  for (const f of ['flythrough.json', 'kiosk.json']) {
    it(`${f}: from the first follow keyframe on, route, stations and the clock are on`, () => {
      const sb = parseStoryboard(readStory(f))
      const first = sb.steps.find((s) => s.camera?.target === FOLLOW_TARGET)
      expect(first).toBeTruthy()
      const d = new Director(sb, { targets: () => [0, 0], tMax: 360, reduced: false, follow: () => ({ target: [0, 0], altM: 175, bearing: 0, pitch: 55 }) })
      for (let t = first!.t; t <= d.duration; t += 1) {
        const st = d.stateAt(t)
        expect(st.layers.route).toBe(true)
        expect(st.layers.stations).toBe(true)
        expect(st.clock).not.toBeNull()
      }
    })
  }
  it('the furniture moves the crew marker on every clock change and keeps the legs following the clock in a live story', () => {
    const furn = readFileSync(new URL('../map/furniture/index.ts', import.meta.url), 'utf8')
    const eff = furn.slice(furn.indexOf('const t = mission.clock.t.value'), furn.indexOf('effect(() => {\n        void ui.reducedMotion'))
    expect(eff).toContain('this.renderCrew(t)')
    expect(eff).toContain('if (this.paused) this.clockWhilePaused()')
  })
})

describe('L10: a capture step settles under the frozen clock', () => {
  const src = readFileSync(new URL('./attach.ts', import.meta.url), 'utf8')
  const settle = src.slice(src.indexOf('async function settle('), src.indexOf('function runCapture('))
  it('waits for the style, the tiles and the terrain, not map.loaded() (false while a transition or the zoom cross-fade runs on the frozen clock)', () => {
    expect(settle).toContain('map.isStyleLoaded() && map.areTilesLoaded()')
    expect(settle).not.toMatch(/map\.loaded\(\)/)
  })
  it('the furniture writes route data and the pulse paint only on change (no write per animation frame)', () => {
    const furn = readFileSync(new URL('../map/furniture/index.ts', import.meta.url), 'utf8')
    expect(furn).toContain('if (!first && f === this.drawFrac) return')
    expect(furn).toContain('if (key === this.pulseKey) return')
  })
})
