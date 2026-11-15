// WP13 (L6 W-2, W-6; 10.7 F2, N5) known answers, on the mock API only:
//   W-2  a running job shows the stage list (nominal -> bands -> partner -> route -> summary), the
//        current stage, the elapsed time and the expected total from measured stage times
//        ("expected ~6 min" with stations only, +1 min per free point), never an exact promise
//   F2   while queued: "Queued · position N" with N = queue_position + 1 (route panel, pad card, plan
//        view of the legacy card, import status)
//   N5   a 429 job_in_progress reads "You already have a plan computing · try again in N s";
//        queue_full alike; never the raw code
//   W-6  a feasible result shows its tightest margin and binding limit (result timeline) with a trust
//        chip; "Estimate" (pad card) and "Computed live" (route result) are the same Badge component
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCatalog } from '../../edit/options'
import type { StationGeo, StopProbe } from '../../edit/route/model'
import { busyText, expectedText, expectedTotalS, fmtElapsed, JOB_STAGES, JobProgress, queueText, stageRows } from '../../edit/route/progress'
import { failureText, ROUTE_TEXT } from '../../edit/route/text'
import type { TimelineEvent } from '../../data/types'
import { all, byClass, hasClass, installDom, type FakeNode } from '../../ui/testing/dom'
import type { RailSection } from '../../ui/shell/store'
import { tightestMargin } from '../../views/decisions'
import { createApiClient } from '../client'
import { JOB_TIMING } from '../config'
import type { LiveState } from '../health'
import { failedJobScript, HEALTH_WARM, JOB_QUEUED, jobScript } from '../mock/fixtures'
import { createMockFetch } from '../mock/fetch'
import { MOCK_PAD_VALID, PAD_CHECK_VALID } from '../mock/pads'
import { withRouteMock } from '../mock/route'
import type { PadToolState } from '../padtool'
import { ImportStatus } from '../planview'
import { mockLiveLoader } from '../result'
import { textOf, toHtml } from '../testing/html'
import type { Job, PadScreen } from '../types'
import { PadToolPanel } from '../view'
import { FakeWindow } from '../../edit/route/testing'
import { mountRoutePanel } from './mount'
import type { RouteConsoleMap } from './map'

const PUB = resolve(__dirname, '../../../public/data')
const json = (p: string) => JSON.parse(readFileSync(resolve(PUB, p), 'utf8'))
const catalog = buildCatalog(json('scenarios/index.json'), json('scenarios/pads/index.json'), json('stations.json'))
const stations: StationGeo[] = (json('stations.json') as StationGeo[]).map(({ id, name, lon, lat }) => ({ id, name, lon, lat }))
const probe = (): StopProbe => ({ inGrid: true, assessed: true, walkable: true, reachable: true })
const FAST = { pollInitialMs: 1, pollFactor: 1, pollMaxMs: 1 }
/** the official tree's timeline: the mock result tree has none, so the test serves this one as the route's */
const TIMELINE = json('timeline_nom_104.json') as TimelineEvent[]

describe('W-2 / F2: the progress model (pure)', () => {
  it('stage list in plan_job order; current stage running, earlier ones done; an unknown stage is appended', () => {
    expect([...JOB_STAGES]).toEqual(['nominal', 'bands', 'partner', 'route', 'summary'])
    const rows = stageRows({ status: 'running', stage: 'partner', stagesDone: ['nominal', 'bands'] })
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      ['nominal', 'done'],
      ['bands', 'done'],
      ['partner', 'running'],
      ['route', 'waiting'],
      ['summary', 'waiting'],
    ])
    expect(rows[0].label).toBe('Nominal band') // copy deck stepper.stages.nominal
    expect(rows[2].label).toBe('Partner line') // copy deck stepper.stages.partner
    expect(stageRows({ status: 'running', stage: 'hud', stagesDone: ['nominal'] }).map((r) => r.name)).toEqual([...JOB_STAGES, 'hud'])
    expect(stageRows({ status: 'queued', stage: null, stagesDone: [] }).every((r) => r.state === 'waiting')).toBe(true)
  })

  it('expected total from the measured stage times: ~6 min with stations only, +1 min per free point; labelled as an expectation', () => {
    expect(expectedTotalS(JOB_TIMING, 0)).toBe(360)
    expect(expectedText(expectedTotalS(JOB_TIMING, 0))).toBe('expected ~6 min')
    expect(expectedText(expectedTotalS(JOB_TIMING, 2))).toBe('expected ~8 min')
    // the per-stage typical ranges are the measured ones
    expect(JOB_TIMING.stageS).toMatchObject({ nominal: [110, 135], bands: [210, 300], partner: [20, 20], route: [20, 80] })
    expect(fmtElapsed(65_000)).toBe('1:05')
    expect(fmtElapsed(-5)).toBe('0:00')
  })

  it('queue position is shown 1-based (queue_position + 1)', () => {
    expect(queueText(0)).toBe('Queued · position 1')
    expect(queueText(2)).toBe('Queued · position 3')
    expect(queueText(null)).toBe('Queued')
    expect(queueText(undefined)).toBe('Queued')
  })

  it('JobProgress: current stage, elapsed and expected while running; the queue position while queued', () => {
    const running = textOf(<JobProgress job={{ status: 'running', stage: 'bands', stagesDone: ['nominal'] }} elapsedMs={83_000} timing={JOB_TIMING} />)
    expect(running).toContain('Running: Variant bands')
    expect(running).toContain('1:23 elapsed')
    expect(running).toContain('expected ~6 min')
    expect(running).toContain('Nominal band · Done')
    expect(running).toContain('Variant bands · Running')
    expect(running).toContain('Summary · Waiting')
    expect(toHtml(<JobProgress job={{ status: 'running', stage: 'bands', stagesDone: ['nominal'] }} elapsedMs={0} />)).toMatch(/data-job-stage="bands" data-state="running" aria-current="step"/)
    const queued = textOf(<JobProgress job={{ status: 'queued', stage: null, stagesDone: [], queuePosition: 0 }} elapsedMs={4_000} timing={JOB_TIMING} />)
    expect(queued).toContain('Queued · position 1')
    expect(queued).toContain('0:04 elapsed')
  })
})

describe('N5: a 429 "not now" reads as a sentence', () => {
  it('job_in_progress and queue_full with and without retry_after_s', () => {
    expect(busyText('job_in_progress', 42)).toBe('You already have a plan computing · try again in 42 s')
    expect(busyText('queue_full', 30)).toBe('Live planning is full right now · try again in 30 s')
    expect(busyText('job_in_progress', null)).toBe('You already have a plan computing · try again when it is done')
    expect(busyText('route_station_unknown', 5)).toBeNull()
  })
  it('the route panel failure text (429 job_in_progress / queue_full) never shows the raw code', () => {
    const t1 = failureText({ status: 429, code: 'job_in_progress', message: 'at most 1 heavy job', stop: null, retryAfterS: 17 }, () => null)
    expect(t1).toBe('You already have a plan computing · try again in 17 s')
    const t2 = failureText({ status: 429, code: 'queue_full', message: 'queue full', stop: null, retryAfterS: 9 }, () => null)
    expect(t2).toBe('Live planning is full right now · try again in 9 s')
    expect(t1 + t2).not.toMatch(/job_in_progress|queue_full/)
  })
})

// --- the pad card and the legacy full plan (pure views) ---

const SCREEN: PadScreen = { pad: MOCK_PAD_VALID, stations: [{ id: 'S1', reachable: true, t_out_min: 10, t_home_min: 12 }], feasible_evas: 3, best_route: null, label: 'screen' }
const ACTIONS = { click() {}, useNearest() {}, computePlan() {}, cancelPlan() {}, clear() {} } as never
function padState(plan: PadToolState['plan']): PadToolState {
  return {
    live: { kind: 'ready', health: HEALTH_WARM },
    pad: MOCK_PAD_VALID,
    check: { kind: 'done', result: PAD_CHECK_VALID },
    preview: { kind: 'done', screen: SCREEN },
    plan,
    record: { kind: 'idle' },
  } as PadToolState
}

describe('pad card and legacy plan view', () => {
  it('the card carries the Estimate badge (the shared Badge component)', () => {
    const html = toHtml(PadToolPanel({ state: padState({ kind: 'idle' }), actions: ACTIONS, engineHref: '#', route: { status: 'ready', compute() {} } }))
    expect(html).toMatch(/<span class="hl-route-badge hl-route-badge--estimate live-estimate" data-badge="estimate"[^>]*>Estimate<\/span>/)
    expect(html).not.toContain('data-badge="computed"')
  })

  it('F2: while the panel job is queued the card says "Queued · position N" (N = queue_position + 1), with elapsed and expected', () => {
    const progress = { job: { status: 'queued', stage: null, stagesDone: [], queuePosition: 0 }, since: 1_000, freePoints: 1 }
    const txt = textOf(PadToolPanel({ state: padState({ kind: 'idle' }), actions: ACTIONS, engineHref: '#', route: { status: 'running', compute() {}, progress }, now: 11_000 }))
    expect(txt).toContain(ROUTE_TEXT.cardRunning)
    expect(txt).toContain('Queued · position 1')
    expect(txt).toContain('0:10 elapsed')
    expect(txt).toContain('expected ~7 min') // one free point
    const run = { job: { status: 'running', stage: 'route', stagesDone: ['nominal', 'bands', 'partner'], queuePosition: null }, since: 0, freePoints: 0 }
    expect(textOf(PadToolPanel({ state: padState({ kind: 'idle' }), actions: ACTIONS, engineHref: '#', route: { status: 'running', compute() {}, progress: run }, now: 200_000 }))).toContain('Running: Route · 3:20 elapsed · expected ~6 min')
  })

  it('F2 / W-2 (legacy full plan, VITE_ROUTE_EDIT=0): queue position, then the stage list with elapsed and expected', () => {
    const queued: Job = { ...JOB_QUEUED, queue_position: 1 }
    const q = textOf(PadToolPanel({ state: padState({ kind: 'running', job: queued, result: null, since: 0 }), actions: ACTIONS, engineHref: '#', now: 3_000 }))
    expect(q).toContain('Queued · position 2')
    expect(q).toContain('0:03 elapsed')
    const running = jobScript(['nominal', 'bands', 'partner', 'route', 'summary'])[2] // running "bands", nominal done
    const r = textOf(PadToolPanel({ state: padState({ kind: 'running', job: running, result: null, since: 0 }), actions: ACTIONS, engineHref: '#', now: 125_000 }))
    expect(r).toContain('Running: Variant bands · 2:05 elapsed · expected ~6 min')
    expect(r).toContain('Nominal band · Done')
    expect(r).toContain('Summary · Waiting')
  })

  it('N5 (legacy full plan): a 429 job_in_progress reads as a sentence, not "The plan failed: job_in_progress"', () => {
    const txt = textOf(PadToolPanel({ state: padState({ kind: 'failed', job: null, error: 'job_in_progress', retryAfterS: 25, result: null }), actions: ACTIONS, engineHref: '#' }))
    expect(txt).toContain('You already have a plan computing · try again in 25 s')
    expect(txt).not.toContain('job_in_progress')
    const qf = textOf(PadToolPanel({ state: padState({ kind: 'failed', job: null, error: 'queue_full', retryAfterS: 8, result: null }), actions: ACTIONS, engineHref: '#' }))
    expect(qf).toContain('Live planning is full right now · try again in 8 s')
    // any other failure keeps its text
    const other = failedJobScript()[3]
    expect(textOf(PadToolPanel({ state: padState({ kind: 'failed', job: other, error: other.error!, retryAfterS: null, result: null }), actions: ACTIONS, engineHref: '#' }))).toContain(`The plan failed: ${other.error}`)
  })

  it('F2 (plan import): computing while queued says "Queued · position N"', () => {
    const txt = textOf(ImportStatus({ state: { kind: 'computing', inputs: {}, job: { ...JOB_QUEUED, queue_position: 4 } } }))
    expect(txt).toContain('Queued · position 5')
    expect(txt).not.toMatch(/· queued/)
  })
})

// --- the Edit-route panel on the mock API ---

function fakeConsoleMap(): RouteConsoleMap {
  const data = new Map<string, unknown>()
  const layers: Record<string, unknown>[] = []
  const box = { dataset: {} as Record<string, string> }
  return {
    map: {
      getSource: (id) => (data.has(id) ? { setData: (d: unknown) => data.set(id, d) } : undefined),
      addSource: (id, spec) => data.set(id, spec.data),
      addLayer: (spec) => layers.push(spec),
      getLayer: (id) => layers.find((l) => l.id === id),
      getContainer: () => box as unknown as HTMLElement,
    },
    whenReady: async () => {},
    setScenarioData: async () => {},
    setRoute: async () => {},
  }
}

let root: FakeNode
let cleanup: (() => void) | null = null
beforeEach(() => {
  ;({ container: root } = installDom())
})
afterEach(() => {
  act(() => {
    cleanup?.()
    render(null, root as unknown as Element)
  })
  cleanup = null
})
const flush = () => new Promise((r) => setTimeout(r, 2))
async function until(fn: () => boolean, what: string) {
  for (let i = 0; i < 400; i++) {
    if (fn()) return
    await act(async () => {
      await flush()
    })
  }
  throw new Error(`timed out waiting for ${what}`)
}
const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
const q = (cls: string) => byClass(root, cls)
const click = (n: FakeNode) => act(() => void n.dispatch('click'))

/**
 * The route mock with a gate on the job polls (each poll waits for release()), an optional answer in
 * place of the submit (a 429), and the official timeline served as the route result's timeline.
 */
function gatedFetch(o: { submit?: Response; timeline?: boolean } = {}) {
  const inner = withRouteMock(createMockFetch())
  let allowed = 0
  const fn = async (input: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    if (method === 'POST' && input.includes('/jobs') && o.submit) return o.submit.clone()
    if (method === 'GET' && /\/jobs\/[^/]+$/.test(input)) {
      while (allowed <= 0) await new Promise((r) => setTimeout(r, 1))
      allowed--
    }
    if (o.timeline && /\/results\/[^/]+\/timeline_nom_104\.json$/.test(input)) return new Response(JSON.stringify(TIMELINE), { status: 200, headers: { 'Content-Type': 'application/json' } })
    return inner(input, init)
  }
  return { fetch: Object.assign(fn, { calls: inner.calls }), release: (n = 1) => void (allowed += n) }
}

async function setup(fetch: ReturnType<typeof gatedFetch>['fetch']) {
  const client = createApiClient({ base: 'http://api.test', fetch })
  let section: RailSection | null = null
  cleanup = mountRoutePanel({
    client,
    loaderFor: mockLiveLoader(fetch),
    onLiveState: (fn) => {
      fn({ kind: 'ready', health: HEALTH_WARM } as LiveState)
      return () => {}
    },
    cmap: fakeConsoleMap(),
    restore: async () => {},
    catalog,
    stations,
    probe,
    job: FAST,
    register: (s) => {
      section = s
      return () => (section = null)
    },
    win: new FakeWindow(),
  })
  await until(() => section !== null, 'the rail section')
  const s = section as unknown as RailSection
  act(() => render(s.render() as ComponentChildren, root as unknown as Element))
  await until(() => q('hl-route__hash')[0]?.textContent.includes(ROUTE_TEXT.hashPending) === false, 'the engine identity')
}
function orderedS2S4() {
  click(all(root, (n) => n.getAttribute('data-value') === 'ordered')[0])
  for (const id of ['S2', 'S4']) {
    const row = all(root, (n) => n.getAttribute('data-station') === id)[0]
    const cb = all(row, (n) => hasClass(n, 'hl-route__check'))[0] as FakeNode & { checked?: boolean }
    cb.checked = true
    act(() => void cb.dispatch('change'))
  }
}

describe('Edit-route panel (mock API)', () => {
  it('F2 + W-2: "Queued · position 3" while queued (queue_position 2), then the stage list, current stage, elapsed and expected; the map stays usable', async () => {
    const g = gatedFetch()
    await setup(g.fetch)
    orderedS2S4()
    click(q('hl-route__compute')[0])
    // the submit answers queued, queue_position 2 (contracts/backend/examples/job.queued.json)
    await until(() => /Queued · position 3/.test(text(q('hl-route__progress')[0] ?? root)), 'the queue position')
    const prog = () => text(q('hl-route__progress')[0])
    expect(prog()).toMatch(/Queued · position 3 · \d+:\d\d elapsed · expected ~6 min/)
    expect(prog()).not.toMatch(/position 2\b/)
    // first poll: running "nominal"
    g.release()
    await until(() => prog().includes('Running: Nominal band'), 'the first stage')
    const stages = all(q('hl-route__progress')[0], (n) => n.getAttribute('data-job-stage') !== null)
    expect(stages.map((n) => n.getAttribute('data-job-stage'))).toEqual(['nominal', 'bands', 'partner', 'route', 'summary', 'hud'].slice(0, stages.length))
    expect(stages.slice(0, 5).map((n) => n.getAttribute('data-job-stage'))).toEqual(['nominal', 'bands', 'partner', 'route', 'summary'])
    expect(stages[0].getAttribute('data-state')).toBe('running')
    expect(prog()).toMatch(/\d+:\d\d elapsed/)
    expect(prog()).toContain('expected ~6 min')
    // second poll: nominal done, bands running
    g.release()
    await until(() => prog().includes('Running: Variant bands'), 'the second stage')
    expect(all(q('hl-route__progress')[0], (n) => n.getAttribute('data-job-stage') === 'nominal')[0].getAttribute('data-state')).toBe('done')
    // the map stays usable: the rail section is a panel, nothing modal; the stop list is only locked
    expect(all(root, (n) => n.getAttribute('aria-modal') === 'true')).toEqual([])
    g.release(10)
    await until(() => q('hl-route__result').length > 0, 'the result')
  })

  it('W-6: a feasible result carries the Computed live badge and its tightest margin + binding limit with a trust chip', async () => {
    const g = gatedFetch({ timeline: true })
    g.release(100)
    await setup(g.fetch)
    orderedS2S4()
    click(q('hl-route__compute')[0])
    await until(() => q('hl-route__result').length > 0, 'the result')
    const res = q('hl-route__result')[0]
    expect(res.getAttribute('data-trust')).toBe('live')
    const badge = all(res, (n) => n.getAttribute('data-badge') !== null)
    expect(badge.map((b) => [b.getAttribute('data-badge'), text(b)])).toEqual([['computed', 'Computed live']])
    expect(hasClass(badge[0], 'hl-route-badge')).toBe(true)
    const tight = tightestMargin(TIMELINE)!
    const m = q('hl-route__margin')[0]
    expect(Number(m.getAttribute('data-margin'))).toBe(tight.e.margin_min)
    expect(m.getAttribute('data-binding')).toBe(tight.e.margin_binding ?? '')
    expect(text(m)).toContain(`Tightest margin ${Math.round(tight.e.margin_min!)} min`)
    expect(text(m)).toMatch(/binding: (O₂|daylight|dose|EVA length)/)
    expect(all(m, (n) => hasClass(n, 'hl-chip--live')).length).toBe(1) // the trust chip
    // no Estimate badge on a computed result
    expect(all(res, (n) => n.getAttribute('data-badge') === 'estimate')).toEqual([])
  })

  it('W-6: no timeline in the result tree: the margin line says so (never guessed)', async () => {
    const g = gatedFetch()
    g.release(100)
    await setup(g.fetch)
    orderedS2S4()
    click(q('hl-route__compute')[0])
    await until(() => q('hl-route__result').length > 0, 'the result')
    expect(q('hl-route__margin')[0].getAttribute('data-margin')).toBe('none')
  })

  it('N5: a 429 job_in_progress on submit reads "You already have a plan computing · try again in N s"', async () => {
    const body = { error: 'job_in_progress', detail: 'at most 1 heavy job at a time from one address', retry_after_s: 42 }
    const g = gatedFetch({ submit: new Response(JSON.stringify(body), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '42' } }) })
    await setup(g.fetch)
    orderedS2S4()
    click(q('hl-route__compute')[0])
    await until(() => q('hl-route__failed').length > 0, 'the refusal')
    const f = text(q('hl-route__failed')[0])
    expect(f).toContain('You already have a plan computing · try again in 42 s')
    expect(f).not.toContain('job_in_progress')
  })

  it('N5: a 429 queue_full reads as a sentence too', async () => {
    const body = { error: 'queue_full', detail: 'queue full', retry_after_s: 30 }
    const g = gatedFetch({ submit: new Response(JSON.stringify(body), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } }) })
    await setup(g.fetch)
    orderedS2S4()
    click(q('hl-route__compute')[0])
    await until(() => q('hl-route__failed').length > 0, 'the refusal')
    expect(text(q('hl-route__failed')[0])).toContain('Live planning is full right now · try again in 30 s')
  })
})
