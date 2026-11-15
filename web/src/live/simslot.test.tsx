// D110 "Send to simulator" on #/plan/{hash}: the plan's mission.json (contracts/bundle/mission.schema.json).
//  - a live result -> its sim_plan manifest entry, results/{hash}/mission.json (WP9b);
//  - the official plan -> the API's /results/{official_hash}/mission.json, then sim/official/mission.json (WP9c);
//  - 404 everywhere -> "Simulator file not available for this plan", no link;
//  - hooks for the WP8c harness: data-sim-export and data-origin on the control;
//  - the mock's mission.json is a valid mission (origin computed_live, labels.live).
import { afterEach, describe, expect, it, vi } from 'vitest'
import missionExample from '../../../contracts/bundle/examples/mission.mission_planer.json'
import missionSchema from '../../../contracts/bundle/mission.schema.json'
import { checkSchema, type JsonSchema } from '../data/schema'
import type { Manifest } from '../data/types'
import { dataUrl } from '../env'
import { downloadMission, isMissionText, missionControlProps, missionVersion, OFFICIAL_MISSION_PATH, officialMissionUrl, probeMission } from '../ui/cards/simslot'
import { createApiClient } from './client'
import { LIVE_LABEL, PRECOMPUTED_LABEL, SIM_EXPORT_ENABLED, SIM_EXPORT_MODE, simExportModeFrom } from './config'
import { createMockFetch } from './mock/fetch'
import { MOCK_OFFICIAL_HASH } from './mock/hashes'
import { MOCK_MISSION_LIVE, MOCK_SIM_FILE, mockFinishedTree, mockResultFile } from './mock/result'
import { MOCK_STAGES, RUN_RECORD_LIVE } from './mock/fixtures'
import { officialMissionApiUrl } from './index'
import { missionTarget, SimSlot } from './simslot'
import { textOf, toHtml } from './testing/html'
import type { RunRecord } from './types'

const API = 'http://api.test'
const LIVE_HASH = (RUN_RECORD_LIVE as RunRecord).hash
const base = (h: string) => `${API}/api/v1/results/${h}`
const MISSION_TEXT = JSON.stringify(MOCK_MISSION_LIVE)
const json = (status: number, body: string) => new Response(body, { status })

/**
 * Inline the schema's local #/$defs refs (checkSchema does not follow $ref) and drop object/array
 * `const`s (checkSchema compares those by identity); the test checks those parts against the
 * contract's own example instead, which the mock keeps unchanged.
 */
function inlineDefs(node: unknown, defs: Record<string, unknown>): unknown {
  if (Array.isArray(node)) return node.map((n) => inlineDefs(n, defs))
  if (!node || typeof node !== 'object') return node
  const { $ref, $defs: _d, ...rest } = node as Record<string, unknown>
  void _d
  if (rest.const && typeof rest.const === 'object') delete rest.const
  const out = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, inlineDefs(v, defs)]))
  if (typeof $ref === 'string') return { ...(inlineDefs(defs[$ref.replace('#/$defs/', '')], defs) as object), ...out }
  return out
}

describe('VITE_SIM_EXPORT modes (D116)', () => {
  it('unset/0/anything else -> off; official -> official; 1/true/all -> all; off in this environment', () => {
    for (const v of [undefined, '', '0', 'false', 'yes', 'OFFICIAL', 'All']) expect(simExportModeFrom(v)).toBe('off')
    expect(simExportModeFrom('official')).toBe('official')
    for (const v of ['1', 'true', 'all', true]) expect(simExportModeFrom(v)).toBe('all')
    expect(SIM_EXPORT_MODE).toBe('off')
    expect(SIM_EXPORT_ENABLED).toBe(false)
  })

  it("'official': the official plan from the static file only (no API URL), nothing for a live result", () => {
    const live = mockFinishedTree(true)('manifest.json') as Manifest
    expect(missionTarget(live, base(MOCK_OFFICIAL_HASH), 'precomputed', 'official')).toEqual({ origin: 'precomputed', urls: [officialMissionUrl()] })
    expect(missionTarget(live, base(LIVE_HASH), 'computed_live', 'official')).toBeNull()
    expect(toHtml(<SimSlot enabled mode="official" manifest={live} base={base(LIVE_HASH)} origin="computed_live" />)).toBe('')
    const html = toHtml(<SimSlot enabled mode="official" manifest={live} base={base(MOCK_OFFICIAL_HASH)} origin="precomputed" />)
    expect(html).toContain(`href="${officialMissionUrl()}"`)
    expect(html).toContain('data-origin="precomputed"')
    expect(html).not.toContain('api.test')
  })

  it("'all': live results and the official plan (API copy first); 'off': nothing", () => {
    const live = mockFinishedTree(true)('manifest.json') as Manifest
    expect(missionTarget(live, base(LIVE_HASH), 'computed_live', 'all')!.urls).toEqual([`${base(LIVE_HASH)}/mission.json`])
    expect(missionTarget(live, base(MOCK_OFFICIAL_HASH), 'precomputed', 'all')!.urls[0]).toBe(`${base(MOCK_OFFICIAL_HASH)}/mission.json`)
    expect(toHtml(<SimSlot enabled mode="off" manifest={live} base={base(LIVE_HASH)} origin="computed_live" />)).toBe('')
  })
})

describe('the mock live job serves a mission.json (WP9b shape)', () => {
  it('validates against contracts/bundle/mission.schema.json, origin computed_live with labels.live', () => {
    const s = inlineDefs(missionSchema, (missionSchema as { $defs: Record<string, unknown> }).$defs) as JsonSchema
    expect(checkSchema(MOCK_MISSION_LIVE, s)).toEqual([])
    // everything but the origin and the who/when fields is the contract example as given
    const changed = Object.keys(MOCK_MISSION_LIVE).filter((k) => JSON.stringify((MOCK_MISSION_LIVE as Record<string, unknown>)[k]) !== JSON.stringify((missionExample as Record<string, unknown>)[k]))
    expect(changed.sort()).toEqual(['created_utc', 'mission_id', 'origin', 'origin_label', 'planner', 'title'])
    expect(MOCK_MISSION_LIVE.origin).toBe('computed_live')
    expect(MOCK_MISSION_LIVE.origin_label).toBe(LIVE_LABEL)
    expect(MOCK_MISSION_LIVE.planner.routing_grid_res_m).toBe(3)
  })

  it('a finished mock job lists it in the manifest (kind sim_plan) and serves it; before that, neither', async () => {
    const m = mockResultFile('manifest.json', MOCK_STAGES) as Record<string, { kind?: string; file?: string }>
    expect(Object.values(m).filter((e) => e.kind === 'sim_plan').map((e) => e.file)).toEqual([MOCK_SIM_FILE])
    expect(mockResultFile(MOCK_SIM_FILE, MOCK_STAGES)).toBe(MOCK_MISSION_LIVE)
    expect(mockResultFile(MOCK_SIM_FILE, MOCK_STAGES.slice(0, -1))).toBeNull()
    const early = mockResultFile('manifest.json', MOCK_STAGES.slice(0, -1)) as Record<string, { kind?: string }>
    expect(Object.values(early).some((e) => e.kind === 'sim_plan')).toBe(false)
  })
})

describe('where the mission.json is', () => {
  const live = mockFinishedTree(true)('manifest.json') as Manifest
  const plain = mockFinishedTree(false)('manifest.json') as Manifest

  it('a live result: the sim_plan entry under the result base, else results/{hash}/mission.json', () => {
    expect(missionTarget(live, base(LIVE_HASH), 'computed_live')).toEqual({ origin: 'computed_live', urls: [`${base(LIVE_HASH)}/mission.json`] })
    expect(missionTarget(plain, base(LIVE_HASH), 'computed_live')).toEqual({ origin: 'computed_live', urls: [`${base(LIVE_HASH)}/mission.json`] })
    const other = { x: { value: null, units: null, file: 'sim/plan_v2.json', script: 's', commit: 'c', utc: 'u', kind: 'sim_plan' } } as unknown as Manifest
    expect(missionTarget(other, base(LIVE_HASH), 'computed_live')!.urls).toEqual([`${base(LIVE_HASH)}/sim/plan_v2.json`])
    expect(missionTarget(null, base(LIVE_HASH), null)).toBeNull()
  })

  it('the official plan: the API copy first, then the static sim/official/mission.json (dataUrl-relative)', () => {
    expect(OFFICIAL_MISSION_PATH).toBe('../sim/official/mission.json')
    expect(officialMissionUrl()).toBe(dataUrl('../sim/official/mission.json', 'real'))
    expect(new URL(officialMissionUrl(), 'https://x.test/app/').pathname).toBe('/sim/official/mission.json')
    expect(missionTarget(plain, base(MOCK_OFFICIAL_HASH), 'precomputed')).toEqual({
      origin: 'precomputed',
      urls: [`${base(MOCK_OFFICIAL_HASH)}/mission.json`, officialMissionUrl()],
    })
  })

  it('the live layer finds the official hash through /defaults and /plans/import (only a computed result)', async () => {
    const fetch = createMockFetch({ importAnswer: (inputs) => ({ hash: MOCK_OFFICIAL_HASH, inputs, computed: true }) })
    const client = createApiClient({ base: API, fetch })
    expect(await officialMissionApiUrl(client)).toBe(`${base(MOCK_OFFICIAL_HASH)}/mission.json`)
    expect(fetch.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /defaults', 'POST /plans/import'])
    const notComputed = createApiClient({ base: API, fetch: createMockFetch({ importAnswer: (inputs) => ({ hash: MOCK_OFFICIAL_HASH, inputs, computed: false }) }) })
    expect(await officialMissionApiUrl(notComputed)).toBeNull()
    const down = createApiClient({ base: API, fetch: () => Promise.reject(new TypeError('Failed to fetch')) })
    expect(await officialMissionApiUrl(down)).toBeNull()
  })
})

describe('the check (probeMission): found, 404, failure', () => {
  it('a live result: found, with the format version read from the file', async () => {
    const fetch = createMockFetch({ trees: { [LIVE_HASH]: mockFinishedTree(true) } })
    const p = await probeMission([`${base(LIVE_HASH)}/mission.json`], () => fetch)
    expect(p).toMatchObject({ state: 'ok', url: `${base(LIVE_HASH)}/mission.json`, version: '1.1.0' })
  })

  it('404 -> missing; a 200 that is not a mission (an HTML fallback page) counts as missing too', async () => {
    const fetch = createMockFetch({ trees: { [LIVE_HASH]: mockFinishedTree(false) } })
    expect(await probeMission([`${base(LIVE_HASH)}/mission.json`], () => fetch)).toEqual({ state: 'missing' })
    expect(await probeMission(['/x'], () => async () => json(200, '<!doctype html><title>app</title>'))).toEqual({ state: 'missing' })
  })

  it('the official plan falls back to the static file when the API has none', async () => {
    const api = `${base(MOCK_OFFICIAL_HASH)}/mission.json`
    const fetchFor = (u: string) => async () => (u === api ? json(404, '{}') : json(200, MISSION_TEXT.replace('computed_live', 'precomputed')))
    expect(await probeMission([api, officialMissionUrl()], fetchFor)).toMatchObject({ state: 'ok', url: officialMissionUrl(), version: '1.1.0' })
  })

  it('a server error or network failure is "failed" (the link stays), not "missing"', async () => {
    expect(await probeMission(['/a'], () => async () => json(500, ''))).toEqual({ state: 'failed', message: 'HTTP 500' })
    expect(await probeMission(['/a'], () => () => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ state: 'failed', message: 'Failed to fetch' })
  })

  it('reads only the version: no full parse needed', () => {
    expect(isMissionText(MISSION_TEXT)).toBe(true)
    expect(missionVersion(MISSION_TEXT)).toBe('1.1.0')
    expect(missionVersion('{"kind":"homeline_mission"}')).toBeNull()
    expect(isMissionText('{"kind":"pad-local"}')).toBe(false)
  })
})

describe('the slot: states and harness hooks', () => {
  const live = mockFinishedTree(true)('manifest.json') as Manifest
  const url = `${base(LIVE_HASH)}/mission.json`

  it('ready: the link to results/{hash}/mission.json, download name mission.json, format version, hooks', () => {
    const html = toHtml(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'ok', url, version: '1.1.0', text: MISSION_TEXT }} />)
    expect(html).toMatch(/<a [^>]*href="http:\/\/api\.test\/api\/v1\/results\/[0-9a-f]{16}\/mission\.json"/)
    expect(html).toContain('download="mission.json"')
    expect(html).toContain('data-sim-export="ready"')
    expect(html).toContain('data-origin="computed_live"')
    expect(html).toContain('data-sim-version="1.1.0"')
    const text = textOf(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'ok', url, version: '1.1.0', text: MISSION_TEXT }} />)
    expect(text).toContain('Download mission.json') // the link's accessible name
    expect(text).toContain('mission.json format 1.1.0')
    expect(text).toContain(LIVE_LABEL)
  })

  it('the official plan: data-origin precomputed, labels.precomputed, the static path when that is where it was found', () => {
    const s = officialMissionUrl()
    const html = toHtml(<SimSlot enabled manifest={live} base={base(MOCK_OFFICIAL_HASH)} origin="precomputed" probe={{ state: 'ok', url: s, version: '1.1.0', text: MISSION_TEXT }} />)
    expect(html).toContain(`href="${s}"`)
    expect(html).toContain('data-origin="precomputed"')
    expect(textOf(<SimSlot enabled manifest={live} base={base(MOCK_OFFICIAL_HASH)} origin="precomputed" />)).toContain(PRECOMPUTED_LABEL)
  })

  it('missing: the honest message with the hooks, no link; failed: the link with the reason', () => {
    const miss = toHtml(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'missing' }} />)
    expect(miss).toContain('Simulator file not available for this plan')
    expect(miss).toContain('data-sim-export="missing"')
    expect(miss).toContain('data-origin="computed_live"')
    expect(miss).not.toContain('<a ')
    const failed = toHtml(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'failed', message: 'HTTP 502' }} />)
    expect(failed).toContain(`href="${url}"`)
    expect(failed).toContain('data-sim-export="failed"')
    expect(failed).toContain('HTTP 502')
  })

  it('flag off: nothing, whatever the plan', () => {
    expect(toHtml(<SimSlot enabled={false} manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'ok', url, version: '1.1.0', text: MISSION_TEXT }} />)).toBe('')
  })
})

describe('download: fetch -> Blob -> object URL (SIM-1), data-state', () => {
  /** Stub the browser bits saveMissionText uses (object URLs, a[download].click); returns what was saved. */
  function stubSave() {
    const saved: { name: string; size: number; revoked: boolean }[] = []
    const urls = new Map<string, { name: string; size: number; revoked: boolean }>()
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      const id = `blob:test/${urls.size}`
      urls.set(id, { name: '', size: (b as Blob).size, revoked: false })
      return id
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((id) => void (urls.get(id)!.revoked = true))
    const a = { href: '', download: '', click: () => saved.push({ ...urls.get(a.href)!, name: a.download }), remove: () => {} }
    vi.stubGlobal('document', { createElement: () => a, body: { appendChild: () => {} } })
    return { saved, urls }
  }
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('a found file is saved as mission.json through a blob URL, which is revoked', async () => {
    vi.useFakeTimers()
    const { saved, urls } = stubSave()
    expect(await downloadMission('/x', MISSION_TEXT)).toEqual({ state: 'done' })
    expect(saved).toEqual([{ name: 'mission.json', size: new Blob([MISSION_TEXT]).size, revoked: false }])
    vi.runAllTimers()
    expect([...urls.values()].every((u) => u.revoked)).toBe(true)
  })

  it('without a checked body it fetches the URL (cross-origin API) and saves that', async () => {
    const { saved } = stubSave()
    const fetch = createMockFetch({ trees: { [LIVE_HASH]: mockFinishedTree(true) } })
    expect(await downloadMission(`${base(LIVE_HASH)}/mission.json`, null, () => fetch)).toEqual({ state: 'done' })
    expect(saved.map((x) => x.name)).toEqual(['mission.json'])
    expect(fetch.calls.map((c) => c.path)).toEqual([`/results/${LIVE_HASH}/mission.json`])
  })

  it('404 -> unavailable (missing); 5xx, network error or a failed save -> unavailable with the reason', async () => {
    stubSave()
    const fetch = createMockFetch({ trees: { [LIVE_HASH]: mockFinishedTree(false) } })
    expect(await downloadMission(`${base(LIVE_HASH)}/mission.json`, null, () => fetch)).toEqual({ state: 'unavailable', reason: null })
    expect(await downloadMission('/a', null, () => async () => json(503, ''))).toEqual({ state: 'unavailable', reason: 'HTTP 503' })
    expect(await downloadMission('/a', null, () => () => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ state: 'unavailable', reason: 'Failed to fetch' })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('no blob URLs')
    })
    expect(await downloadMission('/a', MISSION_TEXT)).toEqual({ state: 'unavailable', reason: 'no blob URLs' })
  })

  /** A click on the control (no DOM): the element's attributes and the status line next to it. */
  async function click(props: ReturnType<typeof missionControlProps>) {
    const attrs = new Map<string, string>(Object.entries({ 'data-state': props['data-state'] }))
    const status = { textContent: '' }
    const el = { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => void attrs.set(k, v), parentElement: { querySelector: () => status } }
    let prevented = false
    props.onClick({ currentTarget: el, preventDefault: () => (prevented = true) } as unknown as MouseEvent)
    expect(prevented).toBe(true) // never the plain cross-origin link
    expect(attrs.get('data-state')).toBe('downloading')
    await vi.waitFor(() => expect(attrs.get('data-state')).not.toBe('downloading'))
    return { state: attrs.get('data-state'), status: status.textContent }
  }

  it('the control: idle -> downloading -> done; a 404 at click time -> unavailable with the message', async () => {
    stubSave()
    const url = `${base(LIVE_HASH)}/mission.json`
    const ok = missionControlProps({ state: 'ok', url, version: '1.1.0', text: MISSION_TEXT }, url, 'computed_live')
    expect(ok['data-state']).toBe('idle')
    expect(ok.download).toBe('mission.json')
    expect(await click(ok)).toEqual({ state: 'done', status: 'mission.json saved' })
    const gone = createMockFetch({ trees: { [LIVE_HASH]: mockFinishedTree(false) } })
    const unchecked = missionControlProps({ state: 'checking' }, url, 'computed_live', () => gone)
    expect(await click(unchecked)).toEqual({ state: 'unavailable', status: 'Simulator file not available for this plan' })
    const broken = missionControlProps({ state: 'failed', message: 'x' }, url, 'computed_live', () => async () => json(500, ''))
    expect(await click(broken)).toEqual({ state: 'unavailable', status: 'Download failed (HTTP 500)' })
  })

  it('rendered hooks: data-state idle on the control, unavailable on the missing message', () => {
    const live = mockFinishedTree(true)('manifest.json') as Manifest
    expect(toHtml(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" />)).toContain('data-state="idle"')
    expect(toHtml(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'missing' }} />)).toContain('data-state="unavailable"')
  })
})
