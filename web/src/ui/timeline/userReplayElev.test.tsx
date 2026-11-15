// PORT F15: elevation in the user-route replay. A profile for a route on the real terrain heights
// (public/data/fp3d/far.f32.gz), main's Margin / Elevation switch, the replay-clock marker, the
// "Estimate" height, main's "No height known…" message, and nothing for the official replay.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPlanningStore, type PlanningStore } from '../../state/planning'
import { missionClock } from '../../state/mission'
import { MOCK_ROUTE_RESULTS, resetRouteResults, type RouteResults } from '../../state/routeResults'
import { buildUserReplay, loadUserReplay, replayOfficialPlan } from '../../state/userReplay'
import { all, installDom, type FakeNode } from '../testing/dom'
import { heightAtT, replayElevation } from './elevation'
import { heightSamplerFrom, type HeightSampler } from './elevationData'
import { UserReplayReadout } from './userReplay'
import { setHeightSource } from './userReplayElev'

const READY: RouteResults = {
  ...MOCK_ROUTE_RESULTS,
  status: 'ready',
  legs: [
    MOCK_ROUTE_RESULTS.legs[0],
    MOCK_ROUTE_RESULTS.legs[1],
    { ...MOCK_ROUTE_RESULTS.legs[2], minutes: 20, o2L: 10, feasible: true, path: [[137.408, -4.765], [137.385, -4.78]] },
  ],
  marginMin: 12.5,
}

const dataDir = new URL('../../../public/data/', import.meta.url)
function realSampler(): HeightSampler {
  const idx = JSON.parse(readFileSync(new URL('fp3d/index.json', dataDir), 'utf8'))
  const raw = readFileSync(new URL(idx.far.file, dataDir))
  const buf = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
  return heightSamplerFrom(idx, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
}

let store: PlanningStore
let root: FakeNode
const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
const tick = () => act(async () => void (await Promise.resolve()))

beforeEach(() => {
  const { document: doc } = installDom()
  root = doc.createElement('div')
  doc.body.appendChild(root)
  store = createPlanningStore()
  store.addStop({ lon: 137.396, lat: -4.772, id: 'w1', stopMin: 10 } as never)
  store.addStop({ lon: 137.408, lat: -4.765, id: 's3', stopMin: 5 } as never)
  resetRouteResults()
  replayOfficialPlan()
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  replayOfficialPlan()
  resetRouteResults()
})

describe('user replay elevation on the real terrain heights (fp3d/far.f32.gz)', () => {
  it('gives a profile along the legs on the replay clock, flat during the stops', () => {
    const s = realSampler()
    expect(s.resM).toBe(8)
    const u = buildUserReplay(READY, store.state.peek().route)!
    const e = replayElevation(u, s.heightAt)!
    expect(e).not.toBeNull()
    expect(e.home).toBe(true)
    expect(e.tEnd).toBeCloseTo(u.totalMin, 9)
    expect(e.points[0].t).toBe(0)
    for (let k = 1; k < e.points.length; k++) expect(e.points[k].t).toBeGreaterThanOrEqual(e.points[k - 1].t)
    for (const p of e.points) expect(Number.isFinite(p.z)).toBe(true)
    // Gale crater floor heights (areoid metres), not a flat line
    expect(e.zMin).toBeLessThan(-3000)
    expect(e.zMax).toBeGreaterThan(e.zMin)
    // dwell at W1 (leg 0 ends 18.5, 10 min stop): same height across the stop, no grade
    const dw = e.points.find((p) => p.t === 28.5)!
    expect(dw.deg).toBeNull()
    expect(heightAtT(e, 20)).toBeCloseTo(heightAtT(e, 18.5), 6)
    // back at the pad: the replay's last point is the pad's height
    expect(e.points[e.points.length - 1].z).toBeCloseTo(s.heightAt(137.385, -4.78)!.z, 6)
  })

  it('an unknown height on the route gives no profile (unknown stays unknown)', () => {
    const u = buildUserReplay(READY, store.state.peek().route)!
    expect(replayElevation(u, (lon, lat) => ({ x: lon, y: lat, z: lon > 137.4 ? NaN : -4000 }))).toBeNull()
  })
})

describe('Margin / Elevation switch in the user replay (PORT F15)', () => {
  it('nothing for the official replay', () => {
    setHeightSource(async () => realSampler())
    act(() => render(<UserReplayReadout store={store} />, root as unknown as Element))
    expect(text(root)).toBe('')
  })

  it('switch, strip with the replay-clock marker, and the Estimate height', async () => {
    setHeightSource(async () => realSampler())
    act(() => render(<UserReplayReadout store={store} />, root as unknown as Element))
    act(() => void loadUserReplay(READY, store.state.peek().route))
    await tick()
    await tick()
    const tabs = all(root, (n) => n.getAttribute('role') === 'tab')
    expect(tabs.map(text)).toEqual(['Margin', 'Elevation'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(all(root, (n) => n.hasAttribute('data-elev-strip')).length).toBe(0)
    const h = all(root, (n) => n.hasAttribute('data-replay-height'))[0]
    expect(text(h)).toMatch(/^Estimate Height -[0-9,]+ m$/)
    act(() => void tabs[1].dispatch('click', {}))
    expect(all(root, (n) => n.hasAttribute('data-elev-strip')).length).toBe(1)
    expect(all(root, (n) => n.localName === 'path' && n.hasAttribute('data-slope-class')).length).toBeGreaterThan(0)
    const cursor = () => parseFloat(String(all(root, (n) => n.hasAttribute('data-elev-cursor'))[0].style.left))
    expect(cursor()).toBe(0)
    act(() => missionClock.seek(28.5))
    expect(cursor()).toBeCloseTo((28.5 / 79.5) * 100, 6) // follows the replay clock
    expect(text(root)).toContain('Margin 12.5 min')
  })

  it("main's message when no height is known along the route", async () => {
    setHeightSource(async () => null)
    act(() => render(<UserReplayReadout store={store} />, root as unknown as Element))
    act(() => void loadUserReplay(READY, store.state.peek().route))
    await tick()
    await tick()
    act(() => void all(root, (n) => n.getAttribute('role') === 'tab')[1].dispatch('click', {}))
    expect(text(root)).toContain('No height known along part of this route: no elevation profile.')
    expect(text(all(root, (n) => n.hasAttribute('data-replay-height'))[0])).toBe('Estimate Height —')
  })
})
