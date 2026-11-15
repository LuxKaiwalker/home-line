// I4 known answers for the EVA start card in the instant estimate: the default start (clock.json, D31)
// passes no override (the estimate is exactly I1b's); moving the start recomputes once on the next frame
// with the moved start's clock, labels the card and the estimate "custom start · outside the validated
// scenario"; Reset goes back to the default.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCatalog } from '../../options'
import { createRouteController, type RouteJobs } from '../controller'
import type { StationGeo } from '../model'
import { createRouteStore } from '../store'
import { all, byClass, installDom, type FakeNode } from '../../../ui/testing/dom'
import { CUSTOM_START_LABEL, DEFAULT_START_MS } from '../browser/start'
import { createRouteEstimate } from './estimate'
import type { EstimateCore, EstimateResult, EstimateStart } from './types'
import { EstimateView } from './view'

const PUB = resolve(__dirname, '../../../../public/data')
const json = (p: string) => JSON.parse(readFileSync(resolve(PUB, p), 'utf8'))
const catalog = buildCatalog(json('scenarios/index.json'), json('scenarios/pads/index.json'), json('stations.json'))
const stations: StationGeo[] = (json('stations.json') as StationGeo[]).map(({ id, name, lon, lat }) => ({ id, name, lon, lat }))
const ID = { engine_tree: '0123456789abcdef0123456789abcdef01234567', config_hash: 'sha256:1fef9c5747acbd487e0a3090f6e9617eba1c8627e25095db683e18ab7589099d', terrain_hash: `sha256:${'0'.repeat(64)}` }
const PAD = { lon: 137.401783, lat: -4.77748 }
const MIN = 60_000

function setup() {
  /** the arguments each compute got: the 4th (start) must be absent at the default */
  const calls: { argc: number; start: EstimateStart | undefined }[] = []
  const core: EstimateCore = {
    load: vi.fn(async () => ({ grid: 'official' })),
    compute(...args: unknown[]) {
      calls.push({ argc: args.length, start: args[3] as EstimateStart | undefined })
      const r: EstimateResult = {
        legs: [{ leg: 0, from: 'pad', to: 'S4', walkMin: 10, o2UsedL: 5, marginMin: 60, binding: 'O2' }],
        totals: { walkMin: 20, evaMin: 80, o2UsedL: 10, o2LeftL: 1000 },
        tightest: { marginMin: 42, binding: 'daylight', leg: 0 },
        feasibility: { feasible: true },
      }
      return r
    },
    mission: async () => ({}),
  }
  const store = createRouteStore({ catalog, identity: ID })
  const ctl = createRouteController({ store, jobs: { run: () => ({ promise: new Promise(() => {}), cancel() {} }) } as RouteJobs, stations, pad: () => PAD })
  const q: (() => void)[] = []
  const frame = () => q.splice(0).forEach((f) => f())
  const est = createRouteEstimate({ store, pad: () => PAD, core, raf: (fn) => void q.push(fn) })
  return { store, ctl, est, calls, frame, frames: () => q.length }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

async function ready(s: ReturnType<typeof setup>) {
  s.ctl.toggle('S4', true)
  s.frame()
  await act(async () => void (await flush()))
  s.frame()
}

describe('EVA start in the instant estimate (I4)', () => {
  it('default start: compute gets no start argument (the estimate is clock.json’s, as before I4)', async () => {
    const s = setup()
    await ready(s)
    expect(s.est.start.peek()).toBeNull()
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].argc).toBe(3)
    const st = s.est.state.peek()
    expect(st.kind === 'ready' && st.startMs).toBeNull()
    expect(st.kind === 'ready' && st.key).toBe(JSON.stringify([PAD, [{ station: 'S4' }]]))
  })

  it('moving the start recomputes once on the next frame with the moved clock; Reset returns to the default', async () => {
    const s = setup()
    await ready(s)
    s.est.setStart(DEFAULT_START_MS + 120 * MIN)
    s.est.setStart(DEFAULT_START_MS + 125 * MIN)
    expect(s.frames()).toBe(1)
    s.frame()
    expect(s.calls).toHaveLength(2)
    const c = s.calls[1].start!
    expect(c.evaStartUtc).toBe('2026-11-14T12:56:18Z')
    expect(c.mslSol).toBe(5074)
    expect(c.tDarkMin).toBeCloseTo(578.67 - 125, 1)
    const st = s.est.state.peek()
    expect(st.kind === 'ready' && st.startMs).toBe(DEFAULT_START_MS + 125 * MIN)
    // within a second of the default is the default
    s.est.setStart(DEFAULT_START_MS + 400)
    expect(s.est.start.peek()).toBeNull()
    s.frame()
    expect(s.calls.at(-1)!.argc).toBe(3)
    // route edits keep the moved start
    s.est.setStart(DEFAULT_START_MS - 60 * MIN)
    s.ctl.toggle('S1', true)
    expect(s.frames()).toBe(1)
    s.frame()
    expect(s.calls.at(-1)!.start!.tDarkMin).toBeCloseTo(578.67 + 60, 1)
    s.est.setStart(null)
    s.frame()
    expect(s.calls.at(-1)!.argc).toBe(3)
    s.est.dispose()
  })

  describe('card', () => {
    let root: FakeNode
    beforeEach(() => {
      ;({ container: root } = installDom())
    })
    afterEach(() => act(() => render(null, root as unknown as Element)))
    const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
    const show = (s: ReturnType<typeof setup>) => act(() => render(<EstimateView est={s.est} state={s.est.state.peek()} route={s.store.route.peek()} />, root as unknown as Element))

    it('default: sol 5074, 09:00:00 LMST, 578.7 min of daylight, no custom label, no reset', async () => {
      const s = setup()
      await ready(s)
      show(s)
      const card = byClass(root, 'hl-route__start')[0]
      expect(card.getAttribute('data-eva-start')).toBe('default')
      expect(text(all(card, (n) => n.getAttribute('data-start') === 'local')[0])).toBe('Sol 5074, 09:00:00 LMST')
      expect(text(all(card, (n) => n.getAttribute('data-start') === 'daylight')[0])).toBe('578.7 min')
      expect(all(root, (n) => n.getAttribute('data-custom-start') !== null)).toHaveLength(0)
      expect(all(root, (n) => n.getAttribute('data-estimate-start') !== null)).toHaveLength(0)
      expect(byClass(root, 'hl-route__start-reset')).toHaveLength(0)
    })

    it('a moved start: the card and the estimate say "custom start · outside the validated scenario"; Reset goes back', async () => {
      const s = setup()
      await ready(s)
      s.est.setStart(DEFAULT_START_MS + 120 * MIN)
      s.frame()
      show(s)
      const card = byClass(root, 'hl-route__start')[0]
      expect(card.getAttribute('data-eva-start')).toBe('custom')
      expect(text(all(card, (n) => n.getAttribute('data-custom-start') !== null)[0])).toBe(CUSTOM_START_LABEL)
      expect(CUSTOM_START_LABEL).toBe('custom start · outside the validated scenario')
      expect(text(all(root, (n) => n.getAttribute('data-estimate-start') === 'custom')[0])).toBe(CUSTOM_START_LABEL)
      expect(text(all(card, (n) => n.getAttribute('data-start') === 'daylight')[0])).toBe('458.7 min')
      act(() => void byClass(root, 'hl-route__start-reset')[0].dispatch('click'))
      expect(s.est.start.peek()).toBeNull()
      s.frame()
      show(s)
      expect(byClass(root, 'hl-route__start')[0].getAttribute('data-eva-start')).toBe('default')
      expect(all(root, (n) => n.getAttribute('data-estimate-start') !== null)).toHaveLength(0)
    })
  })
})
