// I3 (instant browser path): the EVA start card in the Edit-route drawer. Known answers: the default is
// clock.json's instant and computes with the data as is; moving the start recomputes once on the next
// frame with the moved data, labels it "custom start · outside the validated scenario" (card + estimate
// head), and Send to simulator exports the moved data; Reset (or picking the default) is the default again.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOCK, evaClock, utcAtSolLmst } from '../../../ui/route-panel/settings/marstime'
import { all, installDom, type FakeNode } from '../../../ui/testing/dom'
import { buildCatalog } from '../../options'
import { createRouteController, type RouteJobs } from '../controller'
import { createRouteStore } from '../store'
import { CUSTOM_START_LABEL, DEFAULT_START_MS } from './adapter'
import { createRouteEstimate } from './estimate'
import { StartBox, START_TEXT } from './start'
import type { EstimateCore } from './types'
import { EstimateBox } from './view'

const PUB = resolve(__dirname, '../../../../public/data')
const json = (p: string) => JSON.parse(readFileSync(resolve(PUB, p), 'utf8'))
const catalog = buildCatalog(json('scenarios/index.json'), json('scenarios/pads/index.json'), json('stations.json'))
const stations = (json('stations.json') as { id: string; name: string; lon: number; lat: number }[]).map(({ id, name, lon, lat }) => ({ id, name, lon, lat }))
const ID = { engine_tree: '0123456789abcdef0123456789abcdef01234567', config_hash: 'sha256:1fef9c5747acbd487e0a3090f6e9617eba1c8627e25095db683e18ab7589099d', terrain_hash: `sha256:${'0'.repeat(64)}` }
const PAD = { lon: 137.401783, lat: -4.77748 }
const jobs: RouteJobs = { run: () => ({ promise: new Promise(() => {}), cancel() {} }) }
const flush = () => new Promise((r) => setTimeout(r, 0))

interface StubData {
  start: number | null
}

function setup() {
  const store = createRouteStore({ catalog, identity: ID })
  const ctl = createRouteController({ store, jobs, stations, pad: () => PAD })
  const seen: (number | null)[] = []
  const exported: (number | null)[] = []
  const core: EstimateCore = {
    load: vi.fn(async (): Promise<StubData> => ({ start: null })),
    compute(d) {
      seen.push((d as StubData).start)
      return { legs: [], totals: { walkMin: 1, evaMin: 1, o2UsedL: 1, o2LeftL: 1 }, tightest: null, feasibility: { feasible: true } }
    },
    mission: (_r, ctx) => {
      exported.push((ctx.data as StubData).start)
      return { mission_id: 'm-0123456789ab' }
    },
    atStart: (d, startMs) => (startMs === null ? d : { ...(d as StubData), start: startMs }),
    clockAt: (_d, startMs) => evaClock(startMs ?? DEFAULT_START_MS, PAD),
    sunSite: () => PAD,
  }
  const q: (() => void)[] = []
  const est = createRouteEstimate({ store, pad: () => PAD, core, raf: (fn) => void q.push(fn), save: () => {} })
  const frame = () => q.splice(0).forEach((f) => f())
  return { store, ctl, est, seen, exported, frame }
}

async function ready(s: ReturnType<typeof setup>) {
  s.frame()
  await act(async () => void (await flush()))
  s.frame()
}

describe('EVA start in the Edit-route drawer (I3)', () => {
  it('default = clock.json instant (D31): the data as is; a moved start recomputes once and exports the moved data', async () => {
    const s = setup()
    s.ctl.toggle('S7', true)
    await ready(s)
    expect(s.est.start.peek()).toBeNull()
    expect(s.seen).toEqual([null])
    const st = s.est.state.peek()
    expect(st.kind === 'ready' && st.startMs).toBeNull()

    const later = DEFAULT_START_MS + 2 * 3600_000
    s.est.setStart(later)
    s.frame()
    expect(s.seen).toEqual([null, later])
    await s.est.exportMission()
    expect(s.exported).toEqual([later])

    // picking the default instant again (to the second) is the default, not a custom start
    s.est.setStart(DEFAULT_START_MS + 400)
    expect(s.est.start.peek()).toBeNull()
    s.frame()
    expect(s.seen.at(-1)).toBeNull()
    s.est.dispose()
  })

  it('the default instant is the one in clock.json (eva.start_utc, rounded to the second)', () => {
    expect(new Date(Math.round(DEFAULT_START_MS / 1000) * 1000).toISOString().replace('.000Z', 'Z')).toBe(json('conditions/clock.json').eva.start_utc)
  })

  describe('view', () => {
    let root: FakeNode
    beforeEach(() => {
      ;({ container: root } = installDom())
    })
    afterEach(() => act(() => render(null, root as unknown as Element)))
    const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
    const startCard = () => all(root, (n) => n.getAttribute('data-eva-start') !== null)[0]

    it('the card shows once the data is loaded; default has no custom label; a moved start is labelled on the card and the estimate', async () => {
      const s = setup()
      act(() => render(<StartBox est={s.est} />, root as unknown as Element))
      expect(startCard()).toBeUndefined() // nothing loaded yet: the sun needs the pad
      s.ctl.toggle('S7', true)
      await ready(s)
      act(() => render(<EstimateBox est={s.est} route={s.store.route.peek()} />, root as unknown as Element))
      expect(startCard().getAttribute('data-eva-start')).toBe('default')
      expect(all(root, (n) => n.getAttribute('data-start-custom') !== null)).toHaveLength(0)
      expect(text(startCard())).toContain('Sol 5074, 09:00:00 LMST')
      expect(text(startCard())).toContain('Default: 09:00:00 LMST')

      // Mars sol + LMST: the next sol at 14:00 LMST
      const moved = utcAtSolLmst(5075, 14, CLOCK.galeLonEastDeg)
      await act(async () => {
        s.est.setStart(moved)
        s.frame()
        await flush()
      })
      expect(startCard().getAttribute('data-eva-start')).toBe('custom')
      expect(text(all(root, (n) => n.getAttribute('data-start-custom') !== null)[0])).toBe(CUSTOM_START_LABEL)
      expect(CUSTOM_START_LABEL).toBe('custom start · outside the validated scenario')
      expect(text(all(root, (n) => n.getAttribute('data-estimate-start') === 'custom')[0])).toBe(CUSTOM_START_LABEL)
      expect(text(startCard())).toContain('Sol 5075, 14:00:00 LMST')
      // the daylight left shrinks by the hours moved (5 h of LMST = 5 Mars hours)
      const dl = Number(text(all(root, (n) => n.getAttribute('data-start-daylight') !== null)[0]).replace(' min', ''))
      expect(dl).toBeLessThan(evaClock(DEFAULT_START_MS, PAD).tDarkMin! - 300)

      // Reset: back to the default
      const reset = all(root, (n) => n.getAttribute('data-start-reset') !== null)[0]
      await act(async () => {
        reset.dispatch('click')
        s.frame()
        await flush()
      })
      expect(s.est.start.peek()).toBeNull()
      expect(startCard().getAttribute('data-eva-start')).toBe('default')
      expect(all(root, (n) => n.getAttribute('data-estimate-start') !== null)).toHaveLength(0)
    })

    it('a start after sunset: the sun is down and the card says so', async () => {
      const s = setup()
      s.ctl.toggle('S7', true)
      await ready(s)
      await act(async () => {
        s.est.setStart(utcAtSolLmst(5074, 22, CLOCK.galeLonEastDeg))
        await flush()
      })
      act(() => render(<StartBox est={s.est} />, root as unknown as Element))
      expect(text(all(root, (n) => n.getAttribute('data-start-daylight') !== null)[0])).toBe(START_TEXT.sunDown)
      expect(text(startCard())).toContain(START_TEXT.sunDownNote)
    })
  })
})
